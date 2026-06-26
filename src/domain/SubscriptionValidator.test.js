// Tests for subscription end-date logic — especially the one-off "season pass"
// that ends on the student's exam date, clamped so a small payment can't become a
// year-long pass and a late buyer still gets a usable minimum window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEndDate, calculateEndDate } from './SubscriptionValidator.js';

const addDays = (now, n) => new Date(now.getTime() + n * 86400000).toISOString().split('T')[0];

test('season pass ends ON the exam date when it falls inside the clamp window', () => {
  // JAMB target 2026-04-20 is ~109 days after this `now` → inside [14,150]
  const now = new Date('2026-01-01T00:00:00Z');
  assert.equal(computeEndDate('season', { exam_type: 'jamb' }, now), '2026-04-20');
});

test('season pass clamps UP to minDays when the exam is imminent', () => {
  const now = new Date('2026-04-15T00:00:00Z'); // JAMB 2026-04-20 is only 5 days away (< 14)
  assert.equal(computeEndDate('season', { exam_type: 'jamb' }, now), addDays(now, 14));
});

test('season pass clamps DOWN to maxDays when the exam is far away', () => {
  const now = new Date('2026-06-26T00:00:00Z'); // next JAMB is 2027-04-20 (~298 days > 150)
  assert.equal(computeEndDate('season', { exam_type: 'jamb' }, now), addDays(now, 150));
});

test('season pass falls back to fallbackDays when exam_type is missing', () => {
  const now = new Date('2026-06-26T00:00:00Z');
  assert.equal(computeEndDate('season', {}, now), addDays(now, 120));
});

test('recurring plans use plan.days and ignore the exam date', () => {
  const now = new Date('2026-06-26T00:00:00Z');
  assert.equal(computeEndDate('weekly', { exam_type: 'jamb' }, now), addDays(now, 7));
  assert.equal(computeEndDate('monthly', {}, now), addDays(now, 30));
  assert.equal(computeEndDate('termly', {}, now), addDays(now, 90));
  assert.equal(computeEndDate('yearly', {}, now), addDays(now, 365));
});

test('calculateEndDate still returns a valid date for legacy callers', () => {
  assert.match(calculateEndDate('weekly'), /^\d{4}-\d{2}-\d{2}$/);
});
