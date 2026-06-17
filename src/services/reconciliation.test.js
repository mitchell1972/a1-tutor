// Tests for the payment-reconciliation safety net:
// PaymentService.reconcile (detect + auto-fix webhook-dropped payments) and
// DispatchService.runPaymentReconciliation (admin alert only when there are gaps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentService } from './PaymentService.js';
import { DispatchService } from './DispatchService.js';

let txnMeta = {}; // tx_ref -> { user_id, plan }, read by the mock verifyTransaction

function mkPaymentService({ txns, existingRefs }) {
  const created = [];
  const updated = [];
  const repo = {
    getSubscriptionByTxRef: async (ref) =>
      existingRefs.includes(ref) ? { id: 'sub_existing', tx_ref: ref } : null,
    createSubscription: async (d) => { created.push(d); return { id: 'sub_new', ...d }; },
    updateUser: async (id, u) => { updated.push({ id, ...u }); return { id, ...u }; },
    // no getAffiliateByTag → _recordCommission returns early (commission skipped cleanly)
  };
  const flutterwave = {
    listSuccessfulTransactions: async () => txns,
    verifyTransaction: async (flwId, txRef) => ({
      verified: true,
      amount: txns.find(t => String(t.id) === String(flwId))?.amount,
      meta: txnMeta[txRef],
    }),
  };
  return { svc: new PaymentService({ repo, flutterwave }), created, updated };
}

test('reconcile auto-activates a webhook-dropped payment and skips already-recorded ones', async () => {
  txnMeta = {
    'exambot-usr_a-weekly-1': { user_id: 'usr_a', plan: 'weekly' },
    'exambot-usr_b-monthly-2': { user_id: 'usr_b', plan: 'monthly' },
  };
  const { svc, created, updated } = mkPaymentService({
    txns: [
      { id: '1', tx_ref: 'exambot-usr_a-weekly-1', amount: 500 },
      { id: '2', tx_ref: 'exambot-usr_b-monthly-2', amount: 2000 },
    ],
    existingRefs: ['exambot-usr_a-weekly-1'],
  });
  const r = await svc.reconcile({ autoFix: true });
  assert.equal(r.checked, 2);
  assert.equal(r.missing, 1);
  assert.equal(r.fixed, 1);
  assert.equal(r.failed, 0);
  assert.equal(created.length, 1);
  assert.equal(created[0].tx_ref, 'exambot-usr_b-monthly-2');
  assert.equal(created[0].status, 'active');
  assert.equal(updated[0].subscription_status, 'active');
});

test('reconcile ignores non-subscription tx_refs (card-setup + foreign refs)', async () => {
  txnMeta = {};
  const { svc, created } = mkPaymentService({
    txns: [
      { id: '3', tx_ref: 'a1-cardsetup-usr_c-weekly-3', amount: 50 },
      { id: '4', tx_ref: 'someoneelse-ref-4', amount: 999 },
    ],
    existingRefs: [],
  });
  const r = await svc.reconcile({ autoFix: true });
  assert.equal(r.checked, 0);
  assert.equal(r.missing, 0);
  assert.equal(created.length, 0);
});

test('reconcile flags (does not fix) a payment that fails server-side verification', async () => {
  const created = [];
  const repo = {
    getSubscriptionByTxRef: async () => null,
    createSubscription: async (d) => { created.push(d); return d; },
    updateUser: async () => {},
  };
  const flutterwave = {
    listSuccessfulTransactions: async () => [{ id: '5', tx_ref: 'exambot-usr_d-weekly-5', amount: 500 }],
    verifyTransaction: async () => ({ verified: false }),
  };
  const r = await new PaymentService({ repo, flutterwave }).reconcile({ autoFix: true });
  assert.equal(r.missing, 1);
  assert.equal(r.fixed, 0);
  assert.equal(r.failed, 1);
  assert.equal(r.gaps[0].reason, 'verify_failed');
  assert.equal(created.length, 0);
});

test('DispatchService alerts admin only when there are gaps', async () => {
  const sent = [];
  const telegram = { send: async (...a) => { sent.push(a); } };
  const withReport = (report) => new DispatchService({
    repo: {}, questionService: {}, subscriptionService: {},
    paymentService: { reconcile: async () => report },
    telegram, whatsapp: {}, adminChatId: 'admin1',
  });

  await withReport({ checked: 2, missing: 1, fixed: 1, failed: 0,
    gaps: [{ txRef: 'exambot-usr_b-monthly-2', amount: 2000, fixed: true }] }).runPaymentReconciliation();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'admin1');
  assert.match(sent[0][1], /Payment reconciliation/);
  assert.match(sent[0][1], /auto-activated/);

  sent.length = 0;
  await withReport({ checked: 2, missing: 0, fixed: 0, failed: 0, gaps: [] }).runPaymentReconciliation();
  assert.equal(sent.length, 0); // nothing dropped -> no alert
});
