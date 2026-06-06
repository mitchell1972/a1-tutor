// src/domain/QuestionAllocator.js
// Pure domain logic: picks N questions per subject with difficulty balancing.
// Zero dependencies. Testable in isolation.

import { DIFFICULTY_MIX } from '../config/subjects.js';

/**
 * Build a per-subject allocation: exactly `count` questions for each subject.
 * English is always included (compulsory).
 */
export function allocatePerSubject(subjects, questionsPerSubject) {
  return subjects.map(subject => ({ subject, count: questionsPerSubject }));
}

/**
 * Pick `count` questions from `pool`, respecting difficulty mix.
 * Returns the picked questions in shuffled order.
 */
export function pickWithDifficultyMix(pool, count, mix = DIFFICULTY_MIX) {
  const easy = pool.filter(q => q.difficulty === 1);
  const medium = pool.filter(q => q.difficulty === 2);
  const hard = pool.filter(q => q.difficulty === 3);

  const easyCount = Math.round(count * mix.easy);
  const mediumCount = Math.round(count * mix.medium);
  const hardCount = count - easyCount - mediumCount;

  const picked = [
    ...easy.slice(0, easyCount),
    ...medium.slice(0, mediumCount),
    ...hard.slice(0, hardCount),
  ];

  // Fill gaps from any category if one is short
  if (picked.length < count) {
    const remaining = pool.filter(q => !picked.find(p => p.id === q.id));
    picked.push(...remaining.slice(0, count - picked.length));
  }

  return shuffleArray(picked).slice(0, count);
}

export function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
