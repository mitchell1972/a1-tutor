// src/services/MockService.js
// Timed mock exams under real CBT conditions: JAMB pacing, no feedback until the
// end, score out of 400, then teacher-style corrections afterwards — the bit no
// CBT practice app bothers with. State lives in the sessions table (key
// mock:{userId}) so a mock survives restarts and works across instances.
import { SUBJECTS, formatTopic } from '../config/subjects.js';
import { pickWithDifficultyMix, shuffleArray } from '../domain/QuestionAllocator.js';

const SECONDS_PER_QUESTION = 45;          // a touch over JAMB's 40s to allow for phone typing
const TARGET_QUESTIONS = 40;              // ~JAMB quarter-length: long enough to mean something

export class MockService {
  constructor({ repo, questionService }) {
    this.repo = repo;
    this.questionService = questionService;
  }

  _key(userId) { return `mock:${userId}`; }

  async getActive(userId) {
    const s = await this.repo.getSession(this._key(userId));
    return s && s.ids?.length ? s : null;
  }

  /**
   * Start a mock for this user: questions spread evenly across their subjects,
   * exam-filtered, excluding everything they've ever been sent in daily drills.
   */
  async start(user) {
    const subjects = user.subjects || [];
    if (!subjects.length) throw new Error('no_subjects');

    const per = Math.max(2, Math.floor(TARGET_QUESTIONS / subjects.length));
    const excludeIds = await this.repo.getAllDispatchedIds(user.id);

    const picked = [];
    for (const subject of subjects) {
      const pool = await this.repo.getQuestionsBySubject(subject, per * 6, {
        excludeIds, exam: user.exam_type || null,
      });
      picked.push(...pickWithDifficultyMix(pool, per));
    }
    if (picked.length < 5) return null;   // bank too thin for this combo — shouldn't happen at 4k+

    const ids = shuffleArray(picked).map(q => q.id);
    const limitSec = Math.ceil((ids.length * SECONDS_PER_QUESTION) / 60) * 60;

    const session = {
      ids, idx: 0, correct: 0,
      perSubject: {},                      // { subject: { total, correct } }
      wrongIds: [],
      startedAt: new Date().toISOString(),
      limitSec,
    };
    await this.repo.setSession(this._key(user.id), session);

    for (const q of picked) await this.repo.markQuestionUsed(q.id);
    return { session, total: ids.length, limitMin: Math.round(limitSec / 60) };
  }

  async currentQuestion(userId) {
    const s = await this.getActive(userId);
    if (!s) return null;
    const q = await this.repo.getQuestion(s.ids[s.idx]);
    return { question: q, index: s.idx, total: s.ids.length, session: s };
  }

  secondsLeft(session) {
    const elapsed = (Date.now() - new Date(session.startedAt).getTime()) / 1000;
    return Math.max(0, Math.round(session.limitSec - elapsed));
  }

  /**
   * Record one answer. Returns { finished, timedOut, next?, index, total, secondsLeft }
   * — deliberately NO correctness feedback mid-exam (real CBT conditions).
   */
  async answer(user, questionId, chosen) {
    const s = await this.getActive(user.id);
    if (!s) return { error: 'no_mock' };
    if (s.ids[s.idx] !== questionId) return { error: 'stale' };   // old button tapped

    const timedOut = this.secondsLeft(s) <= 0;
    if (!timedOut) {
      const result = await this.questionService.processAnswer(user.id, questionId, chosen);
      const q = result.question;
      const subj = q?.subject || 'unknown';
      if (!s.perSubject[subj]) s.perSubject[subj] = { total: 0, correct: 0 };
      s.perSubject[subj].total++;
      if (result.correct) { s.correct++; s.perSubject[subj].correct++; }
      else s.wrongIds.push(questionId);
      s.idx++;
    }

    const finished = timedOut || s.idx >= s.ids.length;
    if (finished) {
      const report = this._score(s, timedOut);
      await this.repo.deleteSession(this._key(user.id));
      // Park the wrong ids for the post-exam corrections button.
      await this.repo.setSession(`mockfix:${user.id}`, { wrongIds: s.wrongIds });
      return { finished: true, timedOut, report };
    }

    await this.repo.setSession(this._key(user.id), s);
    const q = await this.repo.getQuestion(s.ids[s.idx]);
    return { finished: false, next: q, index: s.idx, total: s.ids.length, secondsLeft: this.secondsLeft(s) };
  }

  _score(s, timedOut) {
    const answered = s.idx;
    const total = s.ids.length;
    const subjects = Object.entries(s.perSubject).map(([id, v]) => ({
      name: SUBJECTS[id]?.name || id,
      total: v.total, correct: v.correct,
      pct: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    }));
    // JAMB-style: each subject worth 100; unanswered questions score 0.
    const subjectCount = Math.max(subjects.length, 1);
    const jambScale = subjects.reduce((a, x) => a + x.pct, 0);
    const outOf = subjectCount * 100;
    const elapsedSec = Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000);

    return {
      answered, total, correct: s.correct,
      pct: total ? Math.round((s.correct / total) * 100) : 0,
      jambScore: jambScale, jambOutOf: outOf,
      subjects, timedOut,
      paceSec: answered ? Math.round(elapsedSec / answered) : 0,
      wrongCount: s.wrongIds.length,
    };
  }

  /** The teaching moment: corrections for what they missed (capped to avoid spam). */
  async corrections(userId, cap = 10) {
    const s = await this.repo.getSession(`mockfix:${userId}`);
    const ids = (s?.wrongIds || []).slice(0, cap);
    if (!ids.length) return [];
    const qs = await this.repo.getQuestionsByIds(ids);
    return qs.map(q => ({
      text: q.text,
      topic: formatTopic(q.topic || 'general'),
      answer: q.answer,
      answerText: (typeof q.options === 'string' ? JSON.parse(q.options) : q.options || {})[q.answer] || '',
      explanation: q.explanation || '',
    }));
  }
}
