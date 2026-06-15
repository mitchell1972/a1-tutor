// Unit tests for the re-engagement nudge (DispatchService.runEngagementNudge).
// Pure stubs — no DB, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchService } from './DispatchService.js';

function makeService(opts = {}) {
  const {
    candidates = [{ id: 'u1', telegram_id: 111 }],
    session = {},                                   // getSession result (idempotency marker)
    access = { valid: true, status: 'trial', daysLeft: 2 },
    dispatches = [{ question_ids: ['q1'] }],
    question = { id: 'q1', options: { A: 'apple', B: 'banana' } },
  } = opts;

  const sent = [];
  const setSessions = [];
  const repo = {
    getUsersToNudge: async () => candidates,
    getSession: async () => session,
    getTodayDispatches: async () => dispatches,
    getQuestion: async () => question,
    setSession: async (k, v) => { setSessions.push({ k, v }); },
  };
  const subscriptionService = { getStatus: async () => access };
  const questionService = { formatQuestion: () => ({ header: 'Q 1/1', body: 'What is X?' }) };
  const telegram = {
    send: async (...a) => { sent.push(['send', ...a]); },
    sendWithKeyboard: async (...a) => { sent.push(['kb', ...a]); },
  };
  const svc = new DispatchService({
    repo, questionService, subscriptionService, paymentService: {}, telegram, whatsapp: {},
  });
  svc._sleep = async () => {}; // don't actually wait in tests
  return { svc, sent, setSessions };
}

test('nudges a valid candidate, sends the question, and marks them', async () => {
  const { svc, sent, setSessions } = makeService();
  const r = await svc.runEngagementNudge();
  assert.equal(r.nudged, 1);
  assert.equal(r.skipped, 0);
  assert.ok(sent.some(s => s[0] === 'send'), 'sends the intro message');
  assert.ok(sent.some(s => s[0] === 'kb'), 'sends the question with answer buttons');
  assert.equal(setSessions.length, 1);
  assert.equal(setSessions[0].k, 'nudge:u1');
  assert.ok(setSessions[0].v.date, 'marker carries a date');
});

test('skips a candidate already nudged today (idempotent)', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { svc, sent, setSessions } = makeService({ session: { date: today } });
  const r = await svc.runEngagementNudge();
  assert.equal(r.nudged, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0, 'no message sent');
  assert.equal(setSessions.length, 0);
});

test('skips a candidate whose access has lapsed since this morning', async () => {
  const { svc, sent } = makeService({ access: { valid: false, status: 'trial_expired', daysLeft: 0 } });
  const r = await svc.runEngagementNudge();
  assert.equal(r.nudged, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0, 'never nudges an expired user to drill');
});

test('no candidates → no work, no sends', async () => {
  const { svc, sent } = makeService({ candidates: [] });
  const r = await svc.runEngagementNudge();
  assert.deepEqual(r, { nudged: 0, skipped: 0 });
  assert.equal(sent.length, 0);
});

test('skips when there is no dispatched question to resend', async () => {
  const { svc, sent, setSessions } = makeService({ dispatches: [] });
  const r = await svc.runEngagementNudge();
  assert.equal(r.nudged, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0);
  assert.equal(setSessions.length, 0, 'no marker set if nothing was sent');
});
