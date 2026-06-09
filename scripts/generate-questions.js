// scripts/generate-questions.js
// Syllabus-grounded, AI-generated, two-stage-validated question generator for the bank.
//
// Pipeline:  generate (DeepSeek) -> validate (independent DeepSeek pass) -> dedup -> seed Postgres
//
// Questions are generated OFFLINE and banked (generated once, reused by every student).
// Only questions that PASS validation (answer key confirmed correct + on-syllabus) are inserted.
//
// Usage:
//   DEEPSEEK_API_KEY=sk-... DATABASE_URL=postgres://...  \
//     node scripts/generate-questions.js --exams jamb,ssce --subjects english,mathematics --per-topic 3
//
//   # Quality proof — generate + validate but DON'T write to the bank, print samples:
//   node scripts/generate-questions.js --exams jamb,ssce --subjects english --per-topic 2 --dry-run
//
// Flags:
//   --exams       comma list of exam ids (default: jamb,ssce). Valid: jamb, ssce, neco, post_utme, gst, squad, ican
//   --subjects    comma list of subject ids (default: all SECONDARY subjects)
//   --topics      comma list of topic ids to restrict to (default: all topics for the subject)
//   --per-topic   questions to generate per (exam × subject × topic) before validation (default: 3)
//   --dry-run     generate + validate, print samples, but do NOT insert into the bank
//   --max         hard cap on total questions inserted this run (safety; default: unlimited)
//   --ingest <p>  ingest harvested questions from a .jsonl file or dir (e.g. scraped past papers):
//                 normalize -> two-stage validate -> dedup -> seed (keeps source/year/topic from the file)
//   --no-validate (ingest only) trust the source's answer key; skip the independent re-solve pass
//   --min-year/--max-year  (ingest only) only seed questions whose year falls in the window (e.g. --min-year 2016)
//   --floor       (predict) minimum questions per syllabus topic — the full-coverage guarantee (default 2)
//   --analyze     (predict) print the AI-predicted per-topic plan for each subject and exit — no generation
//   --retag       reclassify past questions tagged "general"/untagged onto syllabus topics (sharpens prediction)
//
// Env:
//   DEEPSEEK_API_KEY (or AI_API_KEY)         — required (unless --help)
//   DEEPSEEK_MODEL   (or AI_MODEL)           — default: deepseek-v4-flash
//   DEEPSEEK_BASE_URL(or AI_BASE_URL)        — default: https://api.deepseek.com
//   DATABASE_URL     (or DATABASE_PUBLIC_URL)— Postgres; if absent, falls back to local JsonlRepository

import 'dotenv/config';
import axios from 'axios';
import { EXAM_TYPES, SUBJECTS, formatTopic } from '../src/config/subjects.js';
import { PgRepository } from '../src/infrastructure/repositories/PgRepository.js';
import { JsonlRepository } from '../src/infrastructure/repositories/JsonlRepository.js';
import fs from 'node:fs';
import path from 'node:path';

// ─── Config ────────────────────────────────────────────────
const API_KEY  = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY;
const BASE_URL = process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL || 'https://api.deepseek.com';
const MODEL    = process.env.DEEPSEEK_MODEL    || process.env.AI_MODEL    || 'deepseek-v4-flash';

// Secondary subjects (the ones that apply to JAMB / SSCE / NECO)
const SECONDARY_SUBJECTS = [
  'english', 'mathematics', 'physics', 'chemistry', 'biology',
  'economics', 'government', 'literature', 'commerce', 'accounting',
  'geography', 'crs', 'agric_science',
];

const DIFFICULTY_LABELS = { 1: 'easy', 2: 'medium', 3: 'hard' };

// ─── Tiny arg parser ───────────────────────────────────────
function parseArgs(argv) {
  const out = { exams: 'jamb,ssce', subjects: '', topics: '', 'per-topic': '3', mode: 'syllabus', year: '', 'dry-run': false, max: '', ingest: '', 'no-validate': false, 'min-year': '', 'max-year': '', floor: '', analyze: false, retag: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out['dry-run'] = true;
    else if (a === '--no-validate') out['no-validate'] = true;
    else if (a === '--analyze') out.analyze = true;
    else if (a === '--retag') out.retag = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Normalised text for de-duplication (case/space/punctuation-insensitive)
export function normText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Robust JSON extraction — handles models that wrap output in ```json fences or prose.
export function extractJson(content) {
  if (!content) return null;
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const first = Math.min(...['{', '['].map((c) => { const i = s.indexOf(c); return i === -1 ? Infinity : i; }));
  const lastObj = s.lastIndexOf('}'); const lastArr = s.lastIndexOf(']');
  const last = Math.max(lastObj, lastArr);
  if (first !== Infinity && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch { /* ignore */ }
  }
  return null;
}

// Normalise a raw generated question into a clean record, or null if unusable.
// Tolerant of numeric options and answers returned as the option *value* instead of its letter
// (common with maths), which the original strict check wrongly dropped as "malformed".
export function normalizeQuestion(q) {
  if (!q || typeof q.text !== 'string' || q.text.trim().length < 8) return null;
  const o = q.options;
  if (!o || typeof o !== 'object') return null;
  const options = {};
  for (const k of ['A', 'B', 'C', 'D']) {
    if (o[k] === undefined || o[k] === null) return null;
    options[k] = String(o[k]).trim();          // coerce numbers/expressions to string
    if (!options[k]) return null;
  }
  if (new Set(['A', 'B', 'C', 'D'].map((k) => normText(options[k]))).size !== 4) return null; // distinct

  let answer = String(q.answer ?? '').trim().toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(answer)) {
    // model returned the answer VALUE rather than its letter — map it back to the letter
    const hit = ['A', 'B', 'C', 'D'].find((k) => normText(options[k]) === normText(q.answer));
    if (!hit) return null;
    answer = hit;
  }
  const difficulty = [1, 2, 3].includes(q.difficulty) ? q.difficulty : 2;
  return { text: q.text.trim(), options, answer, difficulty, explanation: String(q.explanation || '').trim() };
}

// ─── DeepSeek client ───────────────────────────────────────
const ai = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 180000,
});

async function chat(messages, { temperature = 0.7, retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      // NB: no forced response_format — v4-flash is a reasoning model and may not
      // support JSON mode; the prompts demand JSON and extractJson() is tolerant.
      const { data } = await ai.post('/chat/completions', {
        model: MODEL,
        messages,
        temperature,
      });
      return data?.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      const status = err.response?.status;
      if (attempt > retries || (status && status >= 400 && status < 500 && status !== 429)) {
        throw new Error(`DeepSeek error (${status || err.code}): ${err.response?.data?.error?.message || err.message}`);
      }
      await sleep(1500 * attempt); // back off on 429/5xx/network
    }
  }
}

// ─── Stage 1: generate ─────────────────────────────────────
async function generateForTopic(examLabel, subjectName, topic, n) {
  const topicLabel = formatTopic(topic);
  const sys = `You are a senior Nigerian examiner who writes ${examLabel} multiple-choice questions for ${subjectName}. ` +
    `Every question must: match the ${examLabel} syllabus and standard, be factually correct, have EXACTLY ONE correct option, ` +
    `use four plausible options, be unambiguous, and use Nigerian context where natural. Avoid trick wording.`;
  const user = `Generate ${n} ${examLabel} ${subjectName} multiple-choice questions on the topic "${topicLabel}". ` +
    `Vary the difficulty (some easy, some medium, some hard). ` +
    `Return ONLY a JSON object of this exact shape:\n` +
    `{"questions":[{"text":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","difficulty":1,"explanation":"why the answer is correct"}]}\n` +
    `difficulty is 1 (easy), 2 (medium) or 3 (hard). No markdown, no commentary.`;

  const content = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { temperature: 0.85 }
  );
  const parsed = extractJson(content);
  const arr = Array.isArray(parsed) ? parsed : parsed?.questions;
  return Array.isArray(arr) ? arr : [];
}

// ─── Stage 2: independent validation ───────────────────────
// A SECOND model pass that re-derives the answer from scratch and checks syllabus fit.
async function validateQuestion(examLabel, subjectName, q) {
  const sys = `You are a meticulous ${examLabel} ${subjectName} fact-checker. You independently solve the question, ` +
    `then judge it. Be strict: reject anything with a wrong/ambiguous answer key or off-syllabus content.`;
  const user = `Question: ${q.text}\n` +
    `A) ${q.options.A}\nB) ${q.options.B}\nC) ${q.options.C}\nD) ${q.options.D}\n` +
    `The author marked the answer as: ${q.answer}\n\n` +
    `Independently determine the correct option, then respond ONLY as JSON:\n` +
    `{"correct_answer":"A|B|C|D","valid":true|false,"on_syllabus":true|false,"issue":"short reason if not valid"}\n` +
    `Set valid=true ONLY if exactly one option is correct, it is on the ${examLabel} ${subjectName} syllabus, and it is unambiguous.`;

  const content = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { temperature: 0 }
  );
  const v = extractJson(content) || {};
  const ok = v.valid === true && v.on_syllabus !== false && v.correct_answer === q.answer;
  return { ok, verifierAnswer: v.correct_answer, issue: v.issue || (v.correct_answer !== q.answer ? `verifier says ${v.correct_answer}` : 'unspecified') };
}

// ─── Prediction: weight generation toward historically-frequent topics ──
async function topicFrequency(repo, exam, subjectId) {
  let rows = [];
  try { rows = await repo.getQuestionsBySubject(subjectId, 1_000_000, { exam }); } catch { /* fresh bank */ }
  const freq = new Map();
  for (const r of rows) {
    if (!r.topic) continue;
    const yr = Number(r.year) || 0;
    const recency = yr ? Math.max(1, yr - 2018) : 1; // newer past papers weigh more
    freq.set(r.topic, (freq.get(r.topic) || 0) + recency);
  }
  return freq;
}

// [{topic, n, score}] — hotter topics get more questions (1×…3× perTopic), hottest first.
export function allocateByFrequency(topics, freq, perTopic) {
  const max = Math.max(1, ...topics.map((t) => freq.get(t) || 0));
  return topics
    .map((t) => {
      const score = freq.get(t) || 0;
      return { topic: t, score, n: Math.max(1, Math.round(perTopic * (1 + 2 * (score / max)))) };
    })
    .sort((a, b) => b.n - a.n);
}

// ─── Prediction: examiner-style planning from real past questions ──
// Reads the granular topics of banked PAST questions (source=past) for this exam+subject and
// returns Map<granularTopic, {total, recent}> (recent = year >= 2022) — the empirical signal.
async function pastTopicDistribution(repo, exam, subjectId) {
  let rows = [];
  try { rows = await repo.getQuestionsBySubject(subjectId, 1_000_000, { exam }); } catch { /* fresh bank */ }
  const dist = new Map();
  for (const r of rows) {
    if (r.source !== 'past') continue;            // only REAL past questions inform the prediction
    const t = String(r.topic || '').trim().toLowerCase();
    if (!t || t === 'general') continue;          // skip untagged
    const cur = dist.get(t) || { total: 0, recent: 0 };
    cur.total += 1;
    if ((Number(r.year) || 0) >= 2022) cur.recent += 1;
    dist.set(t, cur);
  }
  return dist;
}

// Examiner-style planner: maps the granular past-question areas onto the syllabus topic ids,
// allocates MORE to hot areas, but guarantees every syllabus topic at least `floor`. The code
// then RECONCILES the model's answer against the real syllabus so coverage holds no matter what
// the model returns (every topic present once, integer n >= floor; missing → perTopic fallback).
async function planExamCoverage(examLabel, subject, pastDist, perTopic, floor) {
  const topics = subject.topics;
  const target = perTopic * topics.length;
  const ranked = [...pastDist.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 30);
  const signal = ranked.length
    ? ranked.map(([t, c]) => `${t} (${c.total}${c.recent ? `, ${c.recent} since 2022` : ''})`).join('\n')
    : '(no tagged past questions for this subject)';

  const sys = `You are a senior ${examLabel} ${subject.name} examiner and exam strategist. You decide how many ` +
    `practice questions to write per syllabus topic so a student is drilled hardest on what examiners actually ` +
    `test most, while STILL covering every part of the syllabus so nothing can catch them out.`;
  const user = `SYLLABUS TOPIC IDS (use these EXACT ids; every one must appear once, each with at least ${floor}):\n` +
    `${topics.join(', ')}\n\n` +
    `REAL PAST-QUESTION FREQUENCY — ${examLabel} ${subject.name}, 2016-2025 (descriptive area -> times seen). ` +
    `Map these onto the syllabus ids to judge which are HOT; higher count and more "since 2022" = hotter:\n${signal}\n\n` +
    `Allocate about ${target} questions total across the syllabus topics. Rules:\n` +
    `- Every syllabus topic gets at least ${floor} (full-coverage guarantee for trust).\n` +
    `- Give visibly more to the hot topics the past data implies; keep cold ones at or near ${floor}.\n` +
    `- Mark hot=true only for the genuinely high-frequency topics.\n` +
    `- Return ONLY JSON: {"plan":[{"topic":"<exact syllabus id>","n":<integer >= ${floor}>,"hot":true|false,"why":"<= 6 words"}]}\n` +
    `- Include EVERY syllabus topic exactly once. No prose, no markdown.`;

  let parsed = null;
  try {
    const content = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.3 });
    parsed = extractJson(content);
  } catch (err) {
    console.warn(`   ⚠️  planner failed (${err.message}) — falling back to uniform coverage`);
  }
  const byId = new Map((Array.isArray(parsed?.plan) ? parsed.plan : []).map((p) => [String(p.topic), p]));
  return topics
    .map((t) => {
      const p = byId.get(t);
      const n = p ? Math.max(floor, Math.round(Number(p.n)) || floor) : perTopic; // missing → uniform fallback
      return { topic: t, n, hot: !!(p && p.hot), why: (p && typeof p.why === 'string') ? p.why.slice(0, 40) : '' };
    })
    .sort((a, b) => b.n - a.n);
}

// ─── Main ──────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(headerHelp()); return; }
  if (args.ingest) { await runIngest(args); return; }
  if (args.retag) { await runRetag(args); return; }

  const dryRun = !!args['dry-run'];
  if (!API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY (or AI_API_KEY) is required.');
    process.exit(1);
  }

  const exams = args.exams.split(',').map((s) => s.trim()).filter(Boolean);
  for (const e of exams) {
    if (!Object.values(EXAM_TYPES).some((t) => t.id === e)) {
      console.error(`❌ Unknown exam id "${e}". Valid: ${Object.values(EXAM_TYPES).map((t) => t.id).join(', ')}`);
      process.exit(1);
    }
  }
  const subjectIds = (args.subjects ? args.subjects.split(',') : SECONDARY_SUBJECTS)
    .map((s) => s.trim()).filter(Boolean);
  for (const s of subjectIds) {
    if (!SUBJECTS[s]) { console.error(`❌ Unknown subject id "${s}".`); process.exit(1); }
  }
  const topicFilter = args.topics ? new Set(args.topics.split(',').map((s) => s.trim())) : null;
  const perTopic = Math.max(1, parseInt(args['per-topic'], 10) || 3);
  const maxInsert = args.max ? parseInt(args.max, 10) : Infinity;
  const floor = args.floor ? Math.max(1, parseInt(args.floor, 10) || 2) : 2;
  const analyze = !!args.analyze;

  const mode = (args.mode || 'syllabus').toLowerCase();
  if (!['syllabus', 'predict'].includes(mode)) { console.error('❌ --mode must be "syllabus" or "predict"'); process.exit(1); }
  const source = mode === 'predict' ? 'predicted' : 'ai_original';
  const genYear = args.year ? (parseInt(args.year, 10) || null) : null;

  // Repository: production Postgres if available, else local Jsonl
  let repo;
  const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (dbUrl && !dryRun) {
    process.env.DATABASE_URL = dbUrl;
    repo = new PgRepository(dbUrl);
    await repo.init();
  } else {
    repo = new JsonlRepository();
    if (repo.init) await repo.init();
  }

  console.log(`\n🧠 Generator [${mode}] — model=${MODEL}  exams=[${exams.join(',')}]  subjects=${subjectIds.length}  per-topic=${perTopic}  source=${source}${genYear ? `  year=${genYear}` : ''}  ${dryRun ? '(DRY RUN — nothing written)' : ''}`);

  const totals = { generated: 0, malformed: 0, dup: 0, rejected: 0, inserted: 0 };
  const samples = [];

  for (const exam of exams) {
    const examLabel = Object.values(EXAM_TYPES).find((t) => t.id === exam).label;
    for (const sid of subjectIds) {
      const subject = SUBJECTS[sid];
      const topics = subject.topics.filter((t) => !topicFilter || topicFilter.has(t));

      // Build a dedup set from what's already banked for this subject+exam
      const seen = new Set();
      try {
        const existing = await repo.getQuestionsBySubject(sid, 1_000_000, { exam });
        for (const q of existing) seen.add(normText(q.text));
      } catch { /* fresh bank / jsonl */ }

      // Topic plan:
      //   predict → an examiner-style AI planner reads the real past-question frequency and gives
      //             hot syllabus areas more questions while guaranteeing every topic >= floor
      //             (coverage for trust). syllabus → uniform coverage across all topics.
      let plan;
      if (mode === 'predict' || analyze) {
        const pastDist = await pastTopicDistribution(repo, exam, sid);
        plan = await planExamCoverage(examLabel, subject, pastDist, perTopic, floor);
        const hot = plan.filter((p) => p.hot).slice(0, 6).map((p) => `${p.topic}(${p.n})`).join(', ');
        const tagged = [...pastDist.values()].reduce((a, c) => a + c.total, 0);
        console.log(`   ${exam}/${sid}: 🔮 predicted-hot → ${hot || '(no past-question signal — uniform)'}  | floor=${floor} | plan=${plan.reduce((a, p) => a + p.n, 0)}q across ${plan.length} topics (from ${tagged} tagged past Qs)`);
        if (analyze) {
          for (const p of plan) console.log(`        ${p.hot ? '🔥' : '  '} ${String(p.n).padStart(2)}  ${p.topic}${p.why ? ` — ${p.why}` : ''}`);
          continue; // --analyze = prediction report only, no generation
        }
      } else {
        plan = topics.map((t) => ({ topic: t, n: perTopic }));
      }

      let kept = 0;
      for (const { topic, n } of plan) {
        if (totals.inserted >= maxInsert) break;
        let raw = [];
        try {
          raw = await generateForTopic(examLabel, subject.name, topic, n);
        } catch (err) {
          console.warn(`   ⚠️  gen failed [${exam}/${sid}/${topic}]: ${err.message}`);
          continue;
        }
        totals.generated += raw.length;

        for (const q of raw) {
          if (totals.inserted >= maxInsert) break;
          const nq = normalizeQuestion(q);
          if (!nq) { totals.malformed++; continue; }
          const key = normText(nq.text);
          if (seen.has(key)) { totals.dup++; continue; }

          let verdict;
          try { verdict = await validateQuestion(examLabel, subject.name, nq); }
          catch (err) { console.warn(`   ⚠️  validate failed: ${err.message}`); totals.rejected++; continue; }
          if (!verdict.ok) { totals.rejected++; continue; }

          seen.add(key);
          const record = {
            subject: sid, exam, year: genYear, topic, source,
            difficulty: nq.difficulty, text: nq.text,
            options: nq.options, answer: nq.answer, explanation: nq.explanation,
          };

          if (dryRun) { if (samples.length < 6) samples.push(record); }
          else { await repo.addQuestion(record); }
          totals.inserted++; kept++;
        }
        await sleep(400); // gentle pacing between topics
      }
      console.log(`   ${exam}/${sid}: +${kept} kept`);
    }
  }

  console.log(`\n📊 generated=${totals.generated}  malformed=${totals.malformed}  duplicate=${totals.dup}  rejected=${totals.rejected}  ${dryRun ? 'would-insert' : 'inserted'}=${totals.inserted}`);
  const passRate = totals.generated ? Math.round((totals.inserted / totals.generated) * 100) : 0;
  console.log(`   validation pass rate: ${passRate}%`);

  if (dryRun && samples.length) {
    console.log('\n──────── SAMPLE (verified) questions ────────');
    for (const s of samples) {
      console.log(`\n[${s.exam}/${s.subject}/${s.topic} · ${DIFFICULTY_LABELS[s.difficulty]}]`);
      console.log(s.text);
      for (const k of ['A', 'B', 'C', 'D']) console.log(`  ${k}) ${s.options[k]}`);
      console.log(`  ✓ ${s.answer} — ${s.explanation}`);
    }
  }

  if (!dryRun) {
    try { console.log(`\n🗄️  bank now holds ${await repo.getTotalQuestions()} questions.`); } catch { /* noop */ }
  }
  await repo.pool?.end?.().catch(() => {}); // close pg pool so the process can exit
}

// ─── Ingest: validate + seed externally-harvested questions (e.g. scraped past papers) ──
// Reads bank-shaped JSONL records from a file or directory and runs them through the SAME
// dedup + two-stage validator as generation. Scraped answer keys are frequently wrong, so by
// default only questions whose answer the verifier independently confirms are seeded.
async function runIngest(args) {
  const dryRun = !!args['dry-run'];
  const validate = !args['no-validate'];
  if (validate && !API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY (or AI_API_KEY) is required to validate ingested questions — or pass --no-validate to trust the source keys.');
    process.exit(1);
  }

  const target = args.ingest;
  let files = [];
  try {
    const stat = fs.statSync(target);
    files = stat.isDirectory()
      ? fs.readdirSync(target).filter((f) => f.endsWith('.jsonl')).sort().map((f) => path.join(target, f))
      : [target];
  } catch {
    console.error(`❌ --ingest path not found: ${target}`);
    process.exit(1);
  }
  if (!files.length) { console.error(`❌ no .jsonl files found in ${target}`); process.exit(1); }

  const maxInsert = args.max ? parseInt(args.max, 10) : Infinity;
  const minYear = args['min-year'] ? parseInt(args['min-year'], 10) : null;
  const maxYear = args['max-year'] ? parseInt(args['max-year'], 10) : null;

  // Connect to Postgres if available (read for dedup even in dry-run; only writes are gated).
  let repo;
  const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (dbUrl) { process.env.DATABASE_URL = dbUrl; repo = new PgRepository(dbUrl); await repo.init(); }
  else { repo = new JsonlRepository(); if (repo.init) await repo.init(); }

  console.log(`\n📥 Ingest — files=${files.length}  validate=${validate ? `yes (model=${MODEL})` : 'NO (trusting source keys)'}  ${dryRun ? '(DRY RUN — nothing written)' : ''}`);

  const totals = { read: 0, malformed: 0, dup: 0, rejected: 0, inserted: 0, outOfWindow: 0 };
  const seenCache = new Map(); // `${exam}:${subject}` -> Set(normText) — primed from the bank, grows as we keep
  const samples = [];

  async function seenFor(exam, subject) {
    const k = `${exam}:${subject}`;
    if (seenCache.has(k)) return seenCache.get(k);
    const set = new Set();
    try {
      const existing = await repo.getQuestionsBySubject(subject, 1_000_000, { exam });
      for (const q of existing) set.add(normText(q.text));
    } catch { /* fresh bank */ }
    seenCache.set(k, set);
    return set;
  }

  for (const file of files) {
    if (totals.inserted >= maxInsert) break;
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean); }
    catch (err) { console.warn(`   ⚠️  cannot read ${path.basename(file)}: ${err.message}`); continue; }

    let kept = 0;
    for (const line of lines) {
      if (totals.inserted >= maxInsert) break;
      totals.read++;
      let rec;
      try { rec = JSON.parse(line); } catch { totals.malformed++; continue; }

      const sid = rec.subject, exam = rec.exam;
      if (!SUBJECTS[sid] || !Object.values(EXAM_TYPES).some((t) => t.id === exam)) { totals.malformed++; continue; }
      const recYear = Number.isInteger(rec.year) ? rec.year : parseInt(rec.year, 10);
      if (recYear && ((minYear && recYear < minYear) || (maxYear && recYear > maxYear))) { totals.outOfWindow++; continue; }
      const nq = normalizeQuestion(rec);
      if (!nq) { totals.malformed++; continue; }

      const seen = await seenFor(exam, sid);
      const key = normText(nq.text);
      if (seen.has(key)) { totals.dup++; continue; }

      if (validate) {
        const examLabel = Object.values(EXAM_TYPES).find((t) => t.id === exam).label;
        let verdict;
        try { verdict = await validateQuestion(examLabel, SUBJECTS[sid].name, nq); }
        catch (err) { console.warn(`   ⚠️  validate failed: ${err.message}`); totals.rejected++; continue; }
        if (!verdict.ok) { totals.rejected++; continue; }
      }

      seen.add(key);
      const record = {
        subject: sid, exam,
        year: Number.isInteger(rec.year) ? rec.year : (parseInt(rec.year, 10) || null),
        topic: rec.topic || 'general',
        source: rec.source || 'past',
        difficulty: nq.difficulty, text: nq.text,
        options: nq.options, answer: nq.answer, explanation: nq.explanation,
      };
      if (dryRun) { if (samples.length < 8) samples.push(record); }
      else { await repo.addQuestion(record); }
      totals.inserted++; kept++;
    }
    console.log(`   ${path.basename(file)}: read ${lines.length} → +${kept} kept`);
  }

  console.log(`\n📊 read=${totals.read}  malformed=${totals.malformed}  out-of-window=${totals.outOfWindow}  duplicate=${totals.dup}  rejected=${totals.rejected}  ${dryRun ? 'would-insert' : 'inserted'}=${totals.inserted}`);
  const passRate = totals.read ? Math.round((totals.inserted / totals.read) * 100) : 0;
  console.log(`   ${validate ? 'verified-keep' : 'kept'} rate: ${passRate}%`);

  if (dryRun && samples.length) {
    console.log('\n──────── SAMPLE past questions ────────');
    for (const s of samples) {
      console.log(`\n[${s.exam}/${s.subject}/${s.topic}${s.year ? ' · ' + s.year : ''}]`);
      console.log(s.text);
      for (const k of ['A', 'B', 'C', 'D']) console.log(`  ${k}) ${s.options[k]}`);
      console.log(`  ✓ ${s.answer}${s.explanation ? ' — ' + s.explanation : ''}`);
    }
  }

  if (!dryRun) {
    try { console.log(`\n🗄️  bank now holds ${await repo.getTotalQuestions()} questions.`); } catch { /* noop */ }
  }
  await repo.pool?.end?.().catch(() => {}); // close pg pool so the process can exit
}

// ─── Re-tag: classify untagged ("general"/null) past questions onto syllabus topic ids ──
// Past questions scraped without a clean topic contribute NO signal to the predict planner.
// This reclassifies each into the subject's syllabus taxonomy so prediction sharpens everywhere.
async function classifyTopics(examLabel, subject, questions) {
  const ids = subject.topics;
  const list = questions.map((q, i) => `${i}. ${String(q.text).slice(0, 240)}`).join('\n');
  const sys = `You are a ${examLabel} ${subject.name} examiner. Classify each question into the single most appropriate syllabus topic.`;
  const user = `SYLLABUS TOPIC IDS: ${ids.join(', ')}\n\n` +
    `For each numbered question below, choose the ONE best-fitting topic id from the list above.\n${list}\n\n` +
    `Return ONLY JSON: {"labels":[{"i":<index>,"topic":"<exact id from the list>"}]}. Use only the given ids; include every index.`;
  let parsed = null;
  try {
    const content = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0 });
    parsed = extractJson(content);
  } catch (err) { console.warn(`   ⚠️  classify failed: ${err.message}`); }
  const map = new Map((Array.isArray(parsed?.labels) ? parsed.labels : []).map((l) => [Number(l.i), String(l.topic)]));
  return questions.map((_, i) => map.get(i));
}

async function runRetag(args) {
  const dryRun = !!args['dry-run'];
  if (!API_KEY) { console.error('❌ DEEPSEEK_API_KEY (or AI_API_KEY) is required for --retag.'); process.exit(1); }
  const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!dbUrl) { console.error('❌ --retag operates on the live bank — set DATABASE_URL.'); process.exit(1); }
  process.env.DATABASE_URL = dbUrl;
  const repo = new PgRepository(dbUrl);
  await repo.init();

  const exams = args.exams.split(',').map((s) => s.trim()).filter(Boolean);
  const subjectIds = (args.subjects ? args.subjects.split(',') : SECONDARY_SUBJECTS).map((s) => s.trim()).filter(Boolean);
  const BATCH = 10;

  console.log(`\n🏷️  Re-tag — exams=[${exams.join(',')}]  subjects=${subjectIds.length}  ${dryRun ? '(DRY RUN — nothing written)' : ''}`);
  const totals = { scanned: 0, retagged: 0 };

  for (const exam of exams) {
    const et = Object.values(EXAM_TYPES).find((t) => t.id === exam);
    if (!et) { console.warn(`   ⚠️  unknown exam "${exam}"`); continue; }
    for (const sid of subjectIds) {
      const subject = SUBJECTS[sid];
      if (!subject) continue;
      const valid = new Set(subject.topics);
      let rows = [];
      try { rows = await repo.getQuestionsBySubject(sid, 1_000_000, { exam }); } catch { /* fresh */ }
      const todo = rows.filter((r) => r.source === 'past' && (!r.topic || String(r.topic).trim().toLowerCase() === 'general'));
      if (!todo.length) continue;
      totals.scanned += todo.length;
      let tagged = 0;
      for (let i = 0; i < todo.length; i += BATCH) {
        const chunk = todo.slice(i, i + BATCH);
        const labels = await classifyTopics(et.label, subject, chunk);
        for (let j = 0; j < chunk.length; j++) {
          const t = labels[j];
          if (t && valid.has(t)) {
            if (!dryRun) await repo.updateQuestionTopic(chunk[j].id, t);
            tagged++;
          }
        }
      }
      totals.retagged += tagged;
      console.log(`   ${exam}/${sid}: re-tagged ${tagged}/${todo.length}`);
    }
  }
  console.log(`\n📊 scanned=${totals.scanned}  re-tagged=${totals.retagged}${dryRun ? '  (DRY RUN — nothing written)' : ''}`);
  await repo.pool?.end?.().catch(() => {});
}

function headerHelp() {
  return 'Generate validated JAMB/SSCE questions into the bank.\n' +
    '  --mode syllabus (default)   even coverage across every syllabus topic        (source=ai_original)\n' +
    '  --mode predict [--year Y]   examiner-style AI planner reads real past-question frequency, weights\n' +
    '                              generation toward hot areas, floors every topic for coverage (source=predicted)\n' +
    '  --floor N                   (predict) min questions per topic — the coverage guarantee (default 2)\n' +
    '  --analyze                   (predict) print the predicted per-topic plan per subject and exit (no generation)\n\n' +
    '  node scripts/generate-questions.js --exams jamb,ssce --subjects english,mathematics --per-topic 3\n' +
    '  node scripts/generate-questions.js --mode predict --year 2026 --subjects physics --exams jamb\n' +
    '  node scripts/generate-questions.js --mode predict --analyze --subjects physics --exams jamb   # see the prediction\n' +
    '  node scripts/generate-questions.js --subjects english --per-topic 2 --dry-run    # quality proof, no writes\n\n' +
    '  --ingest <file|dir>          validate + seed harvested questions (e.g. scraped past papers); --no-validate trusts source keys\n' +
    '  node scripts/generate-questions.js --ingest data/scraped --dry-run               # preview what would be kept\n\n' +
    '  --retag                      reclassify "general"/untagged past questions onto syllabus topics (sharpens prediction)\n' +
    '  node scripts/generate-questions.js --retag --dry-run                              # preview the re-tagging';
}

main().then(() => process.exit(0)).catch((err) => { console.error('FATAL:', err); process.exit(1); });
