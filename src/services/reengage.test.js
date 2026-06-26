// Tests the re-engagement target selection: only expired-trial students with a
// Telegram id, excluding partners/affiliates, paying users, opted-out, already-sent,
// and anyone without a Telegram id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectReengageTargets, buildReengageMessage } from '../../scripts/reengage-expired.mjs';
import { getPlan, DEFAULT_PLAN } from '../config/plans.js';

test('selectReengageTargets picks only messageable expired students', () => {
  const users = [
    { id: 'a', subscription_status: 'expired', telegram_id: 1 },     // ✅
    { id: 'b', subscription_status: 'expired', telegram_id: 2 },     // opted out
    { id: 'c', subscription_status: 'expired', telegram_id: 3 },     // already sent
    { id: 'd', subscription_status: 'partner', telegram_id: 4 },     // affiliate
    { id: 'e', subscription_status: 'active',  telegram_id: 5 },     // paying
    { id: 'f', subscription_status: 'expired', telegram_id: null },  // no telegram
    { id: 'g', subscription_status: 'trial',   telegram_id: 7 },     // still on trial
  ];
  const got = selectReengageTargets(users, {
    optedOut: new Set(['b']),
    alreadySent: new Set(['c']),
  });
  assert.deepEqual(got.map(u => u.id), ['a']);
});

test('selectReengageTargets excludes admin/affiliate telegram ids and de-dupes duplicate rows', () => {
  const users = [
    { id: 'a',  subscription_status: 'expired', telegram_id: 1 },  // ✅
    { id: 'x',  subscription_status: 'expired', telegram_id: 9 },  // affiliate/admin tg → excluded
    { id: 'a2', subscription_status: 'expired', telegram_id: 1 },  // duplicate of 'a' → excluded
  ];
  const got = selectReengageTargets(users, { excludeTelegramIds: new Set(['9']) });
  assert.deepEqual(got.map(u => u.id), ['a']);
});

test('buildReengageMessage features the season pass price and the opt-out line', () => {
  const msg = buildReengageMessage(getPlan(DEFAULT_PLAN));
  assert.match(msg, /Exam Season Pass/);
  assert.match(msg, /₦2,000/);
  assert.match(msg, /\/stop/);
  assert.match(msg, /No card details saved/);
});
