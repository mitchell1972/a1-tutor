// Unit tests for the /admin owner dashboard command.
// Calls the prototype method with a fake `this` — no full bot construction needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramBotAdapter } from './TelegramBot.js';

const adminCmd = TelegramBotAdapter.prototype._handleAdminCmd;

function mk(adminChatId) {
  const sent = [];
  const ctx = {
    adminChatId,
    tg: { send: async (id, text, opts) => { sent.push({ id, text, opts }); } },
    analyticsService: {
      getAdminStats: async () => ({
        users: { total: 38, active: 1, trial: 10, expired: 24 },
        revenue: { total: 500, currency: 'NGN' },
        questions: { total: 11016 },
        byExam: { post_utme: 13, jamb: 11, undefined: 3 }, // junk key must be filtered
      }),
    },
    userService: {
      repo: {
        getRefStats: async () => ([
          { source: 'ref_schoolhub', signups: 20, paying: 0, on_trial: 3, expired: 17 },
          { source: 'p_81yhpw', signups: 7, paying: 1, on_trial: 3, expired: 3 },
        ]),
        getPendingPayouts: async () => ([{ tag: 'p_81yhpw', name: 'Examic Hub', pending: 100, bank_name: null }]),
      },
    },
  };
  return { ctx, sent };
}

test('/admin shows the full dashboard to the owner', async () => {
  const { ctx, sent } = mk('999');
  await adminCmd.call(ctx, { chat: { id: 999 } });
  assert.equal(sent.length, 1);
  const t = sent[0].text;
  assert.match(t, /Admin Dashboard/);
  assert.match(t, /Paying: \*1\*/);
  assert.match(t, /Trial: \*10\*/);
  assert.match(t, /Expired: \*24\*/);
  assert.match(t, /₦500/);                  // revenue
  assert.match(t, /ref_schoolhub.*20/);     // source breakdown w/ conversion
  assert.match(t, /p_81yhpw/);
  assert.match(t, /post_utme 13/);          // by exam
  assert.doesNotMatch(t, /undefined/);      // junk exam key filtered out
  assert.match(t, /Payouts owed:[\s\S]*₦100/); // commissions owed
  assert.match(t, /Examic Hub/);
});

test('/admin refuses non-admins and leaks no stats', async () => {
  const { ctx, sent } = mk('999');
  await adminCmd.call(ctx, { chat: { id: 111 } });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /for the bot owner/);
  assert.doesNotMatch(sent[0].text, /Dashboard|Revenue|Paying/);
});

test('/admin handles a clean slate (no payouts owed, no refs)', async () => {
  const { ctx, sent } = mk('999');
  ctx.userService.repo.getRefStats = async () => [];
  ctx.userService.repo.getPendingPayouts = async () => [];
  await adminCmd.call(ctx, { chat: { id: 999 } });
  assert.match(sent[0].text, /Payouts owed:\* none/);
});
