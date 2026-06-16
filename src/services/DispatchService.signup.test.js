// Unit tests for the daily sign-up reminder (DispatchService.runSignupNudge).
// Pure stubs — no DB, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchService } from './DispatchService.js';

function makeService(students = [], sessions = {}) {
  const sent = [];
  const repo = {
    getStudentsToRemind: async () => students,
    getSession: async (k) => sessions[k] || null,
    setSession: async (k, v) => { sessions[k] = v; },
  };
  const telegram = { sendWithKeyboard: async (...a) => { sent.push(a); } };
  const svc = new DispatchService({
    repo, questionService: {}, subscriptionService: {}, paymentService: {}, telegram, whatsapp: {},
  });
  svc._sleep = async () => {};
  return { svc, sent, sessions };
}

test('messages every student with the features reminder + subscribe CTA, and marks them', async () => {
  const { svc, sent, sessions } = makeService([
    { id: 's1', telegram_id: 111 },
    { id: 's2', telegram_id: 222 },
  ]);
  const r = await svc.runSignupNudge();
  assert.equal(r.sent, 2);
  assert.equal(r.skipped, 0);
  assert.equal(sent.length, 2);
  assert.equal(sent[0][0], 111);                       // sent to the student's telegram_id
  assert.match(sent[0][1], /9,000\+ practice questions/); // features listed
  assert.deepEqual(sent[0][2], [[{ text: '💳 See plans & sign up', callback_data: 'menu:subscribe' }]]); // CTA
  assert.ok(sessions['signup_nudge:s1']?.day, 'per-day marker set');
});

test('skips a student already reminded today (idempotent on restart)', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { svc, sent } = makeService([{ id: 's1', telegram_id: 111 }], { 'signup_nudge:s1': { day: today } });
  const r = await svc.runSignupNudge();
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0);
});

test('no students → no work', async () => {
  const { svc, sent } = makeService([]);
  assert.deepEqual(await svc.runSignupNudge(), { sent: 0, skipped: 0 });
  assert.equal(sent.length, 0);
});
