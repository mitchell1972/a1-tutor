// Validates the daily generator's exam->subjects wiring against the real config, so a typo'd
// subject id (which the CLI would reject at runtime) is caught here instead of on the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAM_SUBJECTS, DEFAULT_EXAMS } from './dailyGenerator.js';
import { SUBJECTS, EXAM_TYPES } from '../../config/subjects.js';

const EXAM_IDS = new Set(Object.values(EXAM_TYPES).map((t) => t.id));

test('every default exam is a known exam with a non-empty subject set', () => {
  for (const ex of DEFAULT_EXAMS) {
    assert.ok(EXAM_IDS.has(ex), `"${ex}" is a known exam id`);
    const subs = EXAM_SUBJECTS[ex];
    assert.ok(Array.isArray(subs) && subs.length > 0, `"${ex}" has a subject set`);
  }
});

test('every subject in every exam set exists in SUBJECTS', () => {
  for (const [exam, subs] of Object.entries(EXAM_SUBJECTS)) {
    for (const s of subs) {
      assert.ok(SUBJECTS[s], `exam "${exam}" references unknown subject "${s}"`);
    }
  }
});

test('GST and squad are wired to their own subjects, not the secondary ones', () => {
  // Guards against the trap of generating e.g. "English" tagged GST.
  assert.ok(EXAM_SUBJECTS.gst.every((s) => s.startsWith('gst_')), 'gst uses gst_* subjects');
  assert.ok(!EXAM_SUBJECTS.squad.includes('english'), 'squad is not the secondary set');
  assert.ok(EXAM_SUBJECTS.post_utme.includes('english'), 'post_utme screens secondary subjects');
});
