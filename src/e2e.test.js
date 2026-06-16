// src/e2e.test.js
// END-TO-END journey test. Drives the REAL services against REAL persistence
// (JsonlRepository in a throwaway temp dir) through a full student lifecycle, exercising every
// major area of the agent in one run:
//   register → access/trial → drill → answer+AI-feedback → practice-by-year → NECO reuse →
//   trial expiry → paywall → pay → activate, plus the affiliate-commission path (mock repo,
//   since affiliates are a Postgres-only feature). No network: Flutterwave + AI are stubbed.
//
// JsonlRepository reads DATA_DIR at module-load, so we set it BEFORE importing it (dynamic import).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// JsonlRepository reads DATA_DIR at module-load, and the services transitively load it — so set
// DATA_DIR FIRST, then dynamic-import everything, keeping all loads after this line (a static
// import would be hoisted above it and write to the real data/ dir).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'a1tutor-e2e-'));
process.env.DATA_DIR = TMP;
const { JsonlRepository } = await import('./infrastructure/repositories/JsonlRepository.js');
const { UserService } = await import('./services/UserService.js');
const { QuestionService } = await import('./services/QuestionService.js');
const { SubscriptionService } = await import('./services/SubscriptionService.js');
const { PaymentService } = await import('./services/PaymentService.js');
const { bankExam } = await import('./config/subjects.js');
after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

// ── Harness: real services, real repo, stubbed payment gateway ──
const repo = new JsonlRepository();
const flutterwave = {
  createPaymentLink: async () => ({ link: 'https://pay.test/checkout/abc', txRef: 'tx-e2e-1' }),
  parseWebhookEvent: (e) => ({ type: 'payment_successful', userId: e.userId, plan: e.plan, txRef: e.txRef, amount: e.amount, flwId: e.flwId }),
  verifyTransaction: async () => ({ verified: true, amount: 2000, card: null, customerEmail: 'student@test.ng' }),
};
const userService = new UserService({ repo });
const questionService = new QuestionService({ repo });
const subscriptionService = new SubscriptionService({ repo });
const paymentService = new PaymentService({ repo, flutterwave });

// Seed a small bank: JAMB English (drill), JAMB Physics 2023 past + 2026 predicted (by-year),
// WAEC/SSCE Maths (NECO inherits this via the bankExam alias). Answer is always 'A'.
const Q = (o) => repo.addQuestion({ difficulty: 2, options: { A: '1', B: '2', C: '3', D: '4' }, answer: 'A', explanation: 'Because A is the right one — here is the reasoning.', ...o });
Q({ subject: 'english', exam: 'jamb', topic: 'comprehension', source: 'predicted', text: 'JAMB English Q1' });
Q({ subject: 'english', exam: 'jamb', topic: 'comprehension', source: 'predicted', text: 'JAMB English Q2' });
Q({ subject: 'physics', exam: 'jamb', topic: 'mechanics', source: 'past', year: 2023, text: 'JAMB Physics 2023 (past paper)' });
Q({ subject: 'physics', exam: 'jamb', topic: 'waves', source: 'predicted', year: 2026, text: 'JAMB Physics predicted 2026' });
Q({ subject: 'mathematics', exam: 'ssce', topic: 'algebra', source: 'predicted', text: 'WAEC/SSCE Maths (NECO shares this)' });

// Journey state shared across the ordered steps.
let user, necoUser;

test('1. registration validates input and creates a trial user', async () => {
  await assert.rejects(() => userService.registerUser({ telegramId: 9, examType: 'jamb', subjects: ['english'] }), /Minimum 2 subjects/);
  await assert.rejects(() => userService.registerUser({ telegramId: 9, examType: 'bogus', subjects: ['english', 'physics'] }), /Invalid exam type/);

  user = await userService.registerUser({ telegramId: 111, examType: 'jamb', subjects: ['english', 'physics'] });
  assert.equal(user.exam_type, 'jamb');
  assert.equal(user.subscription_status, 'trial');
  assert.ok(user.trial_start, 'trial_start anchored at signup');
  assert.ok(user.subjects.includes('english') && user.subjects.includes('physics'));
});

test('2. a fresh user is on a valid free trial', async () => {
  const s = await subscriptionService.getStatus(user.id);
  assert.equal(s.valid, true);
  assert.equal(s.status, 'trial');
});

test('3. drill returns questions for the chosen subject/topic', async () => {
  const qs = await questionService.getTopicQuestions(user, 'english', 'comprehension', 5);
  assert.ok(qs.length >= 1);
  assert.ok(qs.every(q => q.subject === 'english' && q.exam === 'jamb'));
});

test('4. answering records a response and the AI explanation is always shown', async () => {
  const [q] = await questionService.getTopicQuestions(user, 'english', 'comprehension', 1);
  const result = await questionService.processAnswer(user.id, q.id, 'A'); // 'A' = seeded correct answer
  assert.equal(result.correct, true);

  const fb = questionService.formatFeedback(result);
  assert.match(fb, /Correct/);
  assert.match(fb, /Because A is the right one/, 'explanation is included in feedback');

  assert.equal((await repo.getResponses(user.id)).length, 1, 'response persisted');
});

test('5. practice-by-year offers only real past-paper years and serves that year', async () => {
  const years = await questionService.getAvailableYears(user, 'physics');
  assert.deepEqual(years, [2023], 'predicted 2026 is excluded; only the past-paper year shows');

  const set = await questionService.getYearQuestions(user, 'physics', 2023, 5);
  assert.equal(set.length, 1);
  assert.equal(set[0].source, 'past');
  assert.equal(String(set[0].year), '2023');
});

test('6. a NECO student is served from the WAEC/SSCE bank (reuse alias)', async () => {
  assert.equal(bankExam('neco'), 'ssce');
  necoUser = await userService.registerUser({ telegramId: 222, examType: 'neco', subjects: ['english', 'mathematics'] });
  const qs = await questionService.getTopicQuestions(necoUser, 'mathematics', 'algebra', 5);
  assert.ok(qs.length >= 1, 'NECO maths is served');
  assert.ok(qs.every(q => q.exam === 'ssce'), 'served from the SSCE bank');
});

test('7. once the trial window passes, access is denied (paywall)', async () => {
  await repo.updateUser(user.id, { trial_start: new Date(Date.now() - 3 * 86400000).toISOString() });
  const s = await subscriptionService.getStatus(user.id);
  assert.equal(s.valid, false);
  assert.equal(s.status, 'trial_expired');
});

test('8. payment: a link is created and a successful webhook activates the plan', async () => {
  const { link } = await paymentService.createPaymentLink(user.id, 'monthly');
  assert.match(link, /^https:\/\//);

  const res = await paymentService.processWebhook({ userId: user.id, plan: 'monthly', txRef: 'tx-e2e-1', amount: 2000, flwId: 'flw-1' });
  assert.equal(res.action, 'activated');

  const sub = await repo.getActiveSubscription(user.id);
  assert.ok(sub && sub.status === 'active' && sub.plan === 'monthly', 'active subscription recorded');

  const s = await subscriptionService.getStatus(user.id);
  assert.equal(s.valid, true);
  assert.equal(s.status, 'active', 'paid access overrides the expired trial');
});

test('9. a referred student\'s payment credits the affiliate (mock repo)', async () => {
  const commissions = [];
  const mockRepo = {
    getUser: async () => ({ id: 'ref-student', ref_source: 'p_aff1' }),
    getActiveSubscription: async () => null,
    createSubscription: async () => ({}),
    updateUser: async () => ({}),
    getAffiliateByTag: async (tag) => (tag === 'p_aff1' ? { id: 'aff-1', user_id: 'a-different-user', tag, percent: 20 } : null),
    createCommission: async (c) => { commissions.push(c); return c; },
  };
  const ps = new PaymentService({ repo: mockRepo, flutterwave });
  await ps.processWebhook({ userId: 'ref-student', plan: 'monthly', txRef: 'tx-ref-1', amount: 2000, flwId: 'flw-2' });

  assert.equal(commissions.length, 1, 'commission logged');
  assert.equal(commissions[0].affiliate_id, 'aff-1');
  assert.equal(commissions[0].commission, 400, '20% of ₦2,000');
});
