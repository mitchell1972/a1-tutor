// Unit tests for the daily affiliate digest (DispatchService.runAffiliateDigest).
// Pure stubs — no DB, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchService } from './DispatchService.js';

function makeService(affiliates = []) {
  const sent = [];
  const repo = { getAffiliatesForDigest: async () => affiliates };
  const telegram = { send: async (...a) => { sent.push(a); } };
  const svc = new DispatchService({
    repo, questionService: {}, subscriptionService: {}, paymentService: {}, telegram, whatsapp: {},
  });
  svc._sleep = async () => {};
  return { svc, sent };
}

test('messages an affiliate whose link has signups', async () => {
  const { svc, sent } = makeService([
    { id: 'a1', tag: 'p_x', telegram_id: 111, referred: 4, paying: 1, earned: 800, pending: 800 },
  ]);
  const r = await svc.runAffiliateDigest();
  assert.equal(r.sent, 1);
  assert.equal(r.skipped, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 111);                       // sent to their telegram_id
  assert.match(sent[0][1], /Students joined via your link/);
  assert.match(sent[0][1], /\*4\*/);                   // the referred count
  assert.match(sent[0][1], /Earned so far/);           // earnings shown when > 0
});

test('skips affiliates whose link has 0 signups (no spamming dormant partners)', async () => {
  const { svc, sent } = makeService([
    { id: 'a1', tag: 'p_x', telegram_id: 111, referred: 0, paying: 0, earned: 0, pending: 0 },
  ]);
  const r = await svc.runAffiliateDigest();
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0);
});

test('skips an affiliate with no telegram contact', async () => {
  const { svc, sent } = makeService([
    { id: 'a1', tag: 'p_x', telegram_id: null, referred: 5, paying: 2, earned: 0, pending: 0 },
  ]);
  const r = await svc.runAffiliateDigest();
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0);
});

test('no affiliates → no work', async () => {
  const { svc, sent } = makeService([]);
  const r = await svc.runAffiliateDigest();
  assert.deepEqual(r, { sent: 0, skipped: 0 });
  assert.equal(sent.length, 0);
});

test('omits the earnings lines when zero but still shows signups + paying', async () => {
  const { svc, sent } = makeService([
    { id: 'a1', tag: 'p_x', telegram_id: 111, referred: 3, paying: 0, earned: 0, pending: 0 },
  ]);
  await svc.runAffiliateDigest();
  assert.doesNotMatch(sent[0][1], /Earned so far/);
  assert.doesNotMatch(sent[0][1], /Pending payout/);
  assert.match(sent[0][1], /Currently paying: \*0\*/);
});
