// Tests the exam-bank alias used so NECO students are served from the WAEC/SSCE bank
// (same syllabus) rather than an empty NECO bank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankExam, EXAM_BANK_ALIAS } from './subjects.js';

test('NECO maps to the SSCE bank', () => {
  assert.equal(bankExam('neco'), 'ssce');
  assert.equal(EXAM_BANK_ALIAS.neco, 'ssce');
});

test('non-aliased exams are unchanged', () => {
  for (const ex of ['jamb', 'ssce', 'post_utme', 'gst', 'squad']) {
    assert.equal(bankExam(ex), ex);
  }
});

test('null/undefined passes through (no exam filter applied)', () => {
  assert.equal(bankExam(null), null);
  assert.equal(bankExam(undefined), null);
});
