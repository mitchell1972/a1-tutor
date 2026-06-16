// Tests for "practice by year": getAvailableYears + getYearQuestions.
// Pure — mock repo, no DB. Confirms only REAL past papers (source='past') for the chosen
// year are offered/served (predicted/ai questions tagged with a year are excluded).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionService } from './QuestionService.js';

const Q = (id, year, source = 'past', topic = 'mechanics', difficulty = 2) => ({
  id, year, source, topic, difficulty, subject: 'physics', exam: 'jamb',
  options: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer: 'A', text: 'question ' + id,
});

function svc(questions, responses = []) {
  const repo = {
    getQuestionsBySubject: async () => questions,
    getResponses: async () => responses,
  };
  return new QuestionService({ repo });
}

test('getAvailableYears returns distinct past-paper years, newest first', async () => {
  const s = svc([Q(1, 2023), Q(2, 2023), Q(3, 2021), Q(4, null), Q(5, 2026, 'predicted')]);
  const years = await s.getAvailableYears({ exam_type: 'jamb' }, 'physics');
  assert.deepEqual(years, [2023, 2021]); // null dropped; 2026 predicted (not 'past') dropped
});

test('getYearQuestions serves only real past papers from that year', async () => {
  const s = svc([Q(1, 2023), Q(2, 2023), Q(3, 2021), Q(4, 2023, 'predicted'), Q(5, 2023, 'ai_original')]);
  const qs = await s.getYearQuestions({ exam_type: 'jamb', id: 'u1' }, 'physics', 2023, 5);
  assert.equal(qs.length, 2);                       // only Q1, Q2 (past + 2023)
  assert.ok(qs.every(q => String(q.year) === '2023' && q.source === 'past'));
});

test('getYearQuestions returns [] when no past papers match the year', async () => {
  const s = svc([Q(1, 2021), Q(2, 2026, 'predicted')]);
  const qs = await s.getYearQuestions({ exam_type: 'jamb', id: 'u1' }, 'physics', 2023, 5);
  assert.equal(qs.length, 0);
});

test('getYearQuestions prefers questions the user has not answered yet', async () => {
  const all = [Q(1, 2023), Q(2, 2023), Q(3, 2023), Q(4, 2023), Q(5, 2023)];
  const answered = [{ question_id: '1' }, { question_id: '2' }];
  const s = svc(all, answered);
  const qs = await s.getYearQuestions({ exam_type: 'jamb', id: 'u1' }, 'physics', 2023, 3);
  // 3 fresh (3,4,5) available -> should avoid the answered ones
  assert.ok(qs.every(q => !['1', '2'].includes(q.id)));
});
