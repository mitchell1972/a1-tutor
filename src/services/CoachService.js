// src/services/CoachService.js
// The AI study coach: turns a student's mastery profile into a short personal
// note — praise for what's working, focus for what isn't, and (when the data
// shows a pattern) the likely misconception behind their repeated mistakes.
// ONE LLM call per note keeps cost a fraction of a penny per student.
import { SUBJECTS, formatTopic } from '../config/subjects.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class CoachService {
  constructor({ repo, analyticsService, ai, telegram, whatsapp }) {
    this.repo = repo;
    this.analyticsService = analyticsService;
    this.ai = ai;
    this.telegram = telegram;
    this.whatsapp = whatsapp;
  }

  /**
   * Build and return the coach note for one user (null if AI is off or the
   * student has no answer history yet).
   */
  async coachNoteFor(user) {
    if (!this.ai?.enabled) return null;

    const a = await this.analyticsService.getUserAnalytics(user.id);
    if (!a || a.overall.totalAnswered < 5) return null;

    // Readiness lines per chosen subject
    const readinessLines = Object.values(a.readiness || {})
      .map(r => `${r.name}: ${r.score}% ready (syllabus coverage ${r.coverage}%)` +
        (r.strongest.length ? `; strongest ${r.strongest.map(t => formatTopic(t.topic)).join(', ')}` : '') +
        (r.weakest.length ? `; weakest ${r.weakest.map(t => `${formatTopic(t.topic)} ${t.accuracy}%`).join(', ')}` : ''))
      .join('\n');

    // Misconception evidence: their recent WRONG answers on the single weakest topic.
    const wrongEvidence = await this._wrongAnswerEvidence(user.id, a.weakAreas?.[0]);

    const sys = 'You are a warm, plain-spoken Nigerian exam tutor sending a short WhatsApp-style note to your student. ' +
      'Encourage first, then give ONE clear focus. If wrong-answer evidence is provided, name the likely misconception ' +
      'in simple words (e.g. "you mix up mean and median") and one tip to fix it. ' +
      'Maximum 5 short sentences, under 90 words, no headings, no bullet lists, no markdown. Address them directly.';

    const userMsg =
      `Student: ${user.name || 'Scholar'} (exam: ${user.exam_type?.toUpperCase() || 'JAMB'})\n` +
      `Streak: ${a.streak} days. This week: ${a.trend.map(t => t.total ? `${t.score}%` : '—').join(' ')}\n` +
      `Overall accuracy: ${a.overall.accuracy}% over ${a.overall.totalAnswered} questions.\n` +
      `Readiness:\n${readinessLines || '(no readiness data yet)'}\n` +
      (wrongEvidence ? `\nRecent wrong answers on their weakest topic (${wrongEvidence.topicLabel}):\n${wrongEvidence.lines}\n` : '') +
      `\nWrite the note now.`;

    return this.ai.chat([{ role: 'system', content: sys }, { role: 'user', content: userMsg }], { temperature: 0.7, maxTokens: 220 });
  }

  /**
   * On-demand /coach: rate-limited to one note per 24h per student.
   */
  async onDemandNote(user) {
    const key = `coach:${user.id}`;
    const session = await this.repo.getSession(key);
    if (session?.last && (Date.now() - new Date(session.last).getTime()) < DAY_MS) {
      return { limited: true, note: null };
    }
    const note = await this.coachNoteFor(user);
    if (note) await this.repo.setSession(key, { last: new Date().toISOString() });
    return { limited: false, note };
  }

  /**
   * Weekly run (cron): send a note to every active/trial student who answered
   * at least 10 questions in the last 7 days.
   */
  async runWeekly() {
    if (!this.ai?.enabled) { console.log('🧑‍🏫 Coach: AI not configured — skipping weekly run'); return; }

    const users = (await this.repo.all('users'))
      .filter(u => ['active', 'trial'].includes(u.subscription_status));
    console.log(`🧑‍🏫 Coach: weekly run over ${users.length} active/trial students`);

    let sent = 0;
    for (const user of users) {
      try {
        const weekAgo = new Date(Date.now() - 7 * DAY_MS).toISOString();
        const recent = await this.repo.getResponses(user.id, { since: weekAgo, limit: 1000 });
        if (recent.length < 10) continue;

        const note = await this.coachNoteFor(user);
        if (!note) continue;

        const msg = `🧑‍🏫 *Your weekly coach note*\n\n${note}`;
        if (user.telegram_id) await this.telegram.send(user.telegram_id, msg, { parse_mode: 'Markdown' });
        else if (user.phone) await this.whatsapp.sendText(user.phone, msg.replace(/\*/g, ''));
        sent++;
        await new Promise(r => setTimeout(r, 1500)); // pace AI + send rate
      } catch (err) {
        console.warn(`Coach: failed for ${user.id}: ${err.message}`);
      }
    }
    console.log(`🧑‍🏫 Coach: weekly run complete — ${sent} notes sent`);
  }

  // Up to 6 of the student's recent wrong answers on their weakest topic,
  // compressed for the prompt: question + what they picked vs what was right.
  async _wrongAnswerEvidence(userId, weakArea) {
    if (!weakArea) return null;
    const responses = await this.repo.getResponses(userId, { limit: 400 });
    const wrong = responses.filter(r => !r.correct);
    if (!wrong.length) return null;

    const qMap = new Map(
      (await this.repo.getQuestionsByIds([...new Set(wrong.map(r => r.question_id))])).map(q => [q.id, q])
    );

    const lines = [];
    for (const r of wrong) {
      const q = qMap.get(r.question_id);
      if (!q || q.subject !== weakArea.subject || q.topic !== weakArea.topic) continue;
      const opts = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || {});
      lines.push(`Q: ${String(q.text).slice(0, 110)} | picked ${r.chosen_answer}) ${String(opts[r.chosen_answer] ?? '').slice(0, 40)} | correct ${q.answer}) ${String(opts[q.answer] ?? '').slice(0, 40)}`);
      if (lines.length >= 6) break;
    }
    if (!lines.length) return null;
    return {
      topicLabel: `${SUBJECTS[weakArea.subject]?.name || weakArea.subject} — ${formatTopic(weakArea.topic)}`,
      lines: lines.join('\n'),
    };
  }
}
