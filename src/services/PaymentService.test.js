// Tests that _activate (the single canonical activation path used by both the
// webhook and the reconciliation job) honours the season pass's exam-date end AND
// keeps affiliate-commission attribution intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentService } from './PaymentService.js';
import { computeEndDate } from '../domain/SubscriptionValidator.js';

function mkRepo() {
  const created = [], updated = [], commissions = [];
  const user = { id: 'usr_a', exam_type: 'jamb', ref_source: 'p_aff' };
  const repo = {
    getUser: async () => user,
    createSubscription: async (d) => { created.push(d); return { id: 'sub_x', ...d }; },
    updateUser: async (id, u) => { updated.push({ id, ...u }); return { id, ...u }; },
    getAffiliateByTag: async (tag) => (tag === 'p_aff' ? { id: 'aff_1', tag, percent: 20 } : null),
    createCommission: async (c) => { commissions.push(c); return c; },
  };
  return { repo, created, updated, commissions, user };
}

test('_activate season pass: subscription ends on the exam date and commission is recorded', async () => {
  const { repo, created, updated, commissions, user } = mkRepo();
  const svc = new PaymentService({ repo, flutterwave: {} });

  const r = await svc._activate('usr_a', 'season', 'tx1', 2000, 'flw1');

  const expectedEnd = computeEndDate('season', user);
  assert.equal(created[0].plan, 'season');
  assert.equal(created[0].status, 'active');
  assert.equal(created[0].end_date, expectedEnd);
  assert.equal(updated[0].subscription_status, 'active');
  assert.equal(r.endDate, expectedEnd);

  // Affiliate attribution preserved: 20% of ₦2,000 = ₦400
  assert.equal(commissions.length, 1);
  assert.equal(commissions[0].affiliate_id, 'aff_1');
  assert.equal(commissions[0].commission, 400);
});

test('_activate weekly plan ends in 7 days, unaffected by the exam date', async () => {
  const { repo, created } = mkRepo();
  const svc = new PaymentService({ repo, flutterwave: {} });
  await svc._activate('usr_a', 'weekly', 'tx2', 500, 'flw2');
  assert.equal(created[0].end_date, computeEndDate('weekly', { exam_type: 'jamb' }));
});
