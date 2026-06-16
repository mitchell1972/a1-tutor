// src/infrastructure/generation/dailyGenerator.js
// Runs the proven question generator (scripts/generate-questions.js) as a child process on a
// daily schedule. Predict mode = examiner-weighted from real past-question frequency, with a
// full-syllabus coverage floor (for exams with no past-question base, it degrades to even
// syllabus coverage). Volume is set by --per-topic; --max is a hard backstop.
//
// Reuses the CLI script verbatim (it self-executes on run), so generation logic lives in ONE
// place. Requires DEEPSEEK_API_KEY (or AI_API_KEY) + DATABASE_URL in the process env.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/generate-questions.js'
);

// Each exam tests a DIFFERENT set of subjects — generating the secondary subjects for, say,
// GST would bank nonsense ("English" tagged GST). These lists pin each exam to its real syllabus.
const SECONDARY = ['english', 'mathematics', 'physics', 'chemistry', 'biology', 'economics',
  'government', 'literature', 'commerce', 'accounting', 'geography', 'crs', 'agric_science'];
const GST_SUBJECTS = ['gst_english', 'gst_logic', 'gst_nigeria', 'gst_entrepreneurship', 'gst_computer', 'gst_statistics'];
const DEPARTMENTAL = ['engineering_math', 'thermodynamics', 'electrical_circuits', 'anatomy', 'physiology',
  'biochemistry', 'constitutional_law', 'nigerian_legal_system', 'microeconomics', 'macroeconomics',
  'financial_accounting', 'political_science', 'sociology', 'organic_chemistry', 'calculus', 'genetics'];

// exam id -> subjects to generate for it. post-UTME screens the JAMB/secondary subjects;
// GST (100-level) and "squad" (departmental courses) carry their own subject sets.
export const EXAM_SUBJECTS = {
  jamb: SECONDARY,
  ssce: SECONDARY,
  neco: SECONDARY,
  post_utme: SECONDARY,
  gst: GST_SUBJECTS,
  squad: DEPARTMENTAL,
};

// Exams the daily job tops up unless overridden by GEN_EXAMS. NECO is intentionally left out:
// it shares WAEC/SSCE's syllabus, so it's cheaper to reuse the SSCE bank than to generate dupes.
export const DEFAULT_EXAMS = ['jamb', 'ssce', 'post_utme', 'gst', 'squad'];

function runGenerator(exam, { perTopic, max, mode, year, subjects }) {
  return new Promise((resolve) => {
    const args = [SCRIPT, '--mode', mode, '--exams', exam, '--per-topic', String(perTopic), '--max', String(max)];
    if (subjects && subjects.length) args.push('--subjects', subjects.join(','));
    if (year) args.push('--year', String(year));
    let out = '';
    let child;
    try {
      child = spawn('node', args, { env: process.env });
    } catch (err) {
      return resolve(`${exam}: spawn failed — ${err.message}`);
    }
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => resolve(`${exam}: error — ${err.message}`));
    child.on('close', (code) => {
      const m = out.match(/📊[^\n]*/);          // the generator's summary line
      resolve(`${exam}: ${m ? m[0] : `finished (exit ${code})`}`);
    });
  });
}

// Generate for each exam sequentially (gentle on DB + DeepSeek rate limits), each with its own
// subject set. `exams` (or env GEN_EXAMS) overrides which exams run; defaults to DEFAULT_EXAMS.
export async function runDailyGeneration({ perTopic = 4, maxPerExam = 700, mode = 'predict', year, exams } = {}) {
  const yr = year || new Date().getFullYear();
  const examList = (Array.isArray(exams) && exams.length) ? exams : DEFAULT_EXAMS;
  console.log(`🧠 Daily generation starting — exams=[${examList.join(', ')}], mode=${mode}, per-topic=${perTopic}, max/exam=${maxPerExam}, year=${yr}`);
  const results = {};
  for (const exam of examList) {
    const subjects = EXAM_SUBJECTS[exam];
    if (!subjects) { console.warn(`   ⚠️  no subject set defined for exam "${exam}" — skipping`); continue; }
    const r = await runGenerator(exam, { perTopic, max: maxPerExam, mode, year: yr, subjects });
    console.log('   ' + r);
    results[exam] = r;
  }
  console.log('🧠 Daily generation complete.');
  return results;
}
