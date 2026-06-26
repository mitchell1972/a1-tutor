// Tests for the trial-end conversion moment:
//  - SubscriptionService.getExpiringTrials (who gets the day-before nudge)
//  - DispatchService.runTrialEndingPaywall (one-tap hosted-checkout, idempotent)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionService } from './SubscriptionService.js';
import { DispatchService } from './DispatchService.js';

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();

test('getExpiringTrials returns only trials ending within the next 24h (excludes paid/fresh/expired/partner)', async () => {
  const repo = { all: async () => ([
    { id: 'u1', subscription_status: 'trial',   trial_start: ago(1.5) }, // ~0.5d left → INCLUDED
    { id: 'u2', subscription_status: 'trial',   trial_start: ago(0.1) }, // ~1.9d left → excluded
    { id: 'u3', subscription_status: 'active',  trial_start: ago(1.5) }, // already paid → excluded
    { id: 'u4', subscription_status: 'trial',   trial_start: ago(3)   }, // already expired → excluded
    { id: 'u5', subscription_status: 'partner', trial_start: ago(1.5) }, // affiliate → excluded
  ]) };
  const due = await new SubscriptionService({ repo }).getExpiringTrials(24);
  assert.deepEqual(due.map(u => u.id), ['u1']);
});

function mkDispatch({ expiring, preMarked = false }) {
  const sent = [];
  const sessions = {};
  if (preMarked) sessions['trial_paywall:u1'] = { sent: true };
  const repo = {
    getSession: async (k) => sessions[k] || null,
    setSession: async (k, v) => { sessions[k] = v; },
    getAnswerCount: async () => 12,
  };
  const subscriptionService = { getExpiringTrials: async () => expiring };
  const paymentService = { createPaymentLink: async () => ({ link: 'https://pay.example/x' }) };
  const telegram = { sendWithKeyboard: async (id, text, kb) => { sent.push({ id, text, kb }); } };
  const svc = new DispatchService({ repo, subscriptionService, paymentService, telegram, whatsapp: {}, questionService: {} });
  return { svc, sent, sessions };
}

test('runTrialEndingPaywall sends a one-tap hosted-checkout button and marks idempotent', async () => {
  const { svc, sent, sessions } = mkDispatch({ expiring: [{ id: 'u1', telegram_id: 111 }] });
  const r = await svc.runTrialEndingPaywall();

  assert.equal(r.sent, 1);
  assert.equal(sent.length, 1);
  // Primary button is a DIRECT url to the hosted page — one tap, no card-on-file step.
  assert.equal(sent[0].kb[0][0].url, 'https://pay.example/x');
  assert.match(sent[0].text, /trial ends tomorrow/i);
  assert.match(sent[0].text, /12 questions/); // uses the student's own engagement
  assert.equal(sessions['trial_paywall:u1'].sent, true);
});

test('runTrialEndingPaywall is idempotent — skips a trial already nudged', async () => {
  const { svc, sent } = mkDispatch({ expiring: [{ id: 'u1', telegram_id: 111 }], preMarked: true });
  const r = await svc.runTrialEndingPaywall();
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0);
});
