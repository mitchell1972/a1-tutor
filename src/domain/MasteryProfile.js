// src/domain/MasteryProfile.js
// Pure domain logic: per-user topic mastery, adaptive selection weights,
// exam-readiness scoring, and adaptive difficulty. Zero dependencies.

import { DIFFICULTY_MIX } from '../config/subjects.js';

/**
 * Build a mastery profile from a user's response history.
 * Returns { [subject]: { [topic]: { answered, correct, accuracy, recentAccuracy, lastAnswered } } }
 * recentAccuracy = accuracy over the last (up to) 10 attempts on that topic.
 */
export function buildMasteryProfile(responses, getQuestion) {
  const profile = {};
  // Oldest first so "recent" windows are genuinely the latest attempts.
  const ordered = [...responses].sort((a, b) => new Date(a.answered_at) - new Date(b.answered_at));

  for (const r of ordered) {
    const q = getQuestion(r.question_id);
    if (!q || !q.subject || !q.topic) continue;

    if (!profile[q.subject]) profile[q.subject] = {};
    if (!profile[q.subject][q.topic]) {
      profile[q.subject][q.topic] = { answered: 0, correct: 0, recent: [], lastAnswered: null };
    }
    const t = profile[q.subject][q.topic];
    t.answered++;
    if (r.correct) t.correct++;
    t.recent.push(r.correct ? 1 : 0);
    if (t.recent.length > 10) t.recent.shift();
    t.lastAnswered = r.answered_at;
  }

  for (const subject of Object.values(profile)) {
    for (const t of Object.values(subject)) {
      t.accuracy = t.answered ? Math.round((t.correct / t.answered) * 100) : 0;
      t.recentAccuracy = t.recent.length
        ? Math.round((t.recent.reduce((a, b) => a + b, 0) / t.recent.length) * 100)
        : 0;
      delete t.recent;
    }
  }
  return profile;
}

/**
 * Selection weights per syllabus topic — the heart of adaptive drilling.
 * Weak topics weigh heaviest, unseen topics next (coverage), mastered topics least.
 * Returns { [topic]: weight } with weights roughly in [0.4 .. 2.5].
 */
export function topicSelectionWeights(subjectProfile = {}, syllabusTopics = []) {
  const weights = {};
  for (const topic of syllabusTopics) {
    const t = subjectProfile[topic];
    if (!t || t.answered === 0) { weights[topic] = 1.5; continue; }   // unseen → coverage

    // Shrink accuracy toward 50% when the sample is small, so two lucky answers
    // don't mark a topic "mastered".
    const confidence = Math.min(t.answered, 5) / 5;
    const effAcc = (t.accuracy / 100) * confidence + 0.5 * (1 - confidence);

    if (effAcc >= 0.85 && t.answered >= 5) { weights[topic] = 0.4; continue; }  // mastered → maintenance
    weights[topic] = 1 + (1 - effAcc) * 1.5;                                     // weaker → heavier
  }
  return weights;
}

/**
 * Exam-readiness score for one subject: 0–100 across the WHOLE syllabus.
 * Unseen topics count as 0 (you can't be ready for what you've never touched),
 * and thin samples are discounted — so the score rewards coverage AND accuracy.
 * Returns { score, coverage, strongest: [{topic, accuracy}], weakest: [{topic, accuracy}] }
 */
export function readiness(subjectProfile = {}, syllabusTopics = []) {
  if (!syllabusTopics.length) return { score: 0, coverage: 0, strongest: [], weakest: [] };

  let sum = 0;
  let covered = 0;
  const rated = [];

  for (const topic of syllabusTopics) {
    const t = subjectProfile[topic];
    if (!t || t.answered === 0) continue;
    covered++;
    const confidence = Math.min(t.answered, 5) / 5;
    sum += (t.accuracy / 100) * confidence;
    if (t.answered >= 3) rated.push({ topic, accuracy: t.accuracy });
  }

  rated.sort((a, b) => b.accuracy - a.accuracy);
  return {
    score: Math.round((sum / syllabusTopics.length) * 100),
    coverage: Math.round((covered / syllabusTopics.length) * 100),
    strongest: rated.slice(0, 2),
    weakest: rated.slice(-2).reverse().filter(w => w.accuracy < 75),
  };
}

/**
 * Adaptive difficulty: strong recent form earns harder questions; struggling
 * students get more easy ones to rebuild confidence. Default mix otherwise.
 */
export function difficultyMixFor(recentAccuracy, answered = 0) {
  if (answered < 10) return DIFFICULTY_MIX;                       // not enough signal yet
  if (recentAccuracy >= 85) return { easy: 0.15, medium: 0.35, hard: 0.50 };
  if (recentAccuracy >= 70) return DIFFICULTY_MIX;                // 0.30 / 0.40 / 0.30
  if (recentAccuracy >= 50) return { easy: 0.40, medium: 0.40, hard: 0.20 };
  return { easy: 0.50, medium: 0.35, hard: 0.15 };
}
