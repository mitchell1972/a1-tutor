// src/domain/StreakTracker.js
// Pure domain logic: calculates user streaks from response dates.
// Zero dependencies.

/**
 * Calculate the current consecutive-day streak from a list of answer dates.
 * @param {string[]} answerDates - ISO date strings of when user answered
 * @returns {number} current streak in days
 */
export function calculateStreak(answerDates) {
  if (!answerDates || answerDates.length === 0) return 0;

  const uniqueDays = new Set(
    answerDates.map(d => {
      const date = new Date(d);
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    })
  );

  const sorted = [...uniqueDays].sort().reverse();
  const now = new Date();

  // Streak must include today or yesterday
  const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

  if (sorted[0] !== today && sorted[0] !== yesterdayStr) return 0;

  let streak = 0;
  for (let i = 0; i < sorted.length; i++) {
    const expected = new Date();
    expected.setDate(expected.getDate() - i);
    const expectedStr = `${expected.getFullYear()}-${expected.getMonth()}-${expected.getDate()}`;
    if (sorted[i] === expectedStr) streak++;
    else break;
  }

  return streak;
}

/**
 * Identify weak areas from a list of responses.
 * Returns topics with < 60% accuracy (min 3 attempts), sorted worst first.
 */
export function identifyWeakAreas(responses, getQuestion) {
  const byTopic = new Map();

  for (const r of responses) {
    const q = getQuestion(r.question_id);
    if (!q) continue;

    const key = `${q.subject}:${q.topic}`;
    if (!byTopic.has(key)) {
      byTopic.set(key, { subject: q.subject, topic: q.topic, total: 0, correct: 0 });
    }
    const entry = byTopic.get(key);
    entry.total++;
    if (r.correct) entry.correct++;
  }

  return [...byTopic.values()]
    .filter(t => t.total >= 3)
    .map(t => ({ ...t, accuracy: Math.round((t.correct / t.total) * 100) }))
    .filter(t => t.accuracy < 60)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);
}

/**
 * Calculate daily stats from a set of responses.
 */
export function calculateDailyStats(responses, getQuestion) {
  const total = responses.length;
  const correct = responses.filter(r => r.correct).length;
  const bySubject = {};

  for (const r of responses) {
    const q = getQuestion(r.question_id);
    if (!q) continue;
    if (!bySubject[q.subject]) bySubject[q.subject] = { total: 0, correct: 0 };
    bySubject[q.subject].total++;
    if (r.correct) bySubject[q.subject].correct++;
  }

  return {
    total,
    correct,
    score: total ? Math.round((correct / total) * 100) : 0,
    bySubject,
  };
}
