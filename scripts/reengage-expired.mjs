// scripts/reengage-expired.mjs
// Re-engagement campaign: message expired-trial students the one-tap "Exam Season
// Pass" offer — the warmest leads we have. DRY-RUN by default (prints who it would
// message + a sample, sends nothing); sends only with --send or REENGAGE_SEND=1.
// Idempotent (per-user `reengage:<id>` marker), rate-limited, opt-out respected
// (`reengage_optout:<id>`, set by the bot's /stop command).
//
//   railway run node scripts/reengage-expired.mjs            # dry run
//   railway run node scripts/reengage-expired.mjs --send     # actually send
import https from 'https';
import { fileURLToPath } from 'url';
import { PgRepository } from '../src/infrastructure/repositories/PgRepository.js';
import { FlutterwaveGateway } from '../src/infrastructure/payment/FlutterwaveGateway.js';
import { PaymentService } from '../src/services/PaymentService.js';
import { getPlan, DEFAULT_PLAN } from '../src/config/plans.js';

// Pure selection — testable. Expired-trial students with a Telegram id, not opted
// out, not already messaged this campaign. Partners/affiliates ('partner') and
// paying users ('active') are excluded by the status check.
export function selectReengageTargets(users, { optedOut = new Set(), alreadySent = new Set(), excludeTelegramIds = new Set() } = {}) {
  const seen = new Set();
  return users.filter(u => {
    if (u.subscription_status !== 'expired' || !u.telegram_id) return false;
    const tg = String(u.telegram_id);
    if (excludeTelegramIds.has(tg)) return false;   // admin / affiliates / partners
    if (optedOut.has(u.id) || alreadySent.has(u.id)) return false;
    if (seen.has(tg)) return false;                 // de-dupe duplicate user rows
    seen.add(tg);
    return true;
  });
}

export function buildReengageMessage(plan) {
  return (
    `👋 Your A1 Tutor free trial ended — but your exam hasn't.\n\n` +
    `Come back with the *${plan.label}*: one payment of *₦${plan.amount.toLocaleString()}* — ` +
    `daily questions, timed mock exams & AI coaching all the way to your exam. No renewals.\n\n` +
    `Tap below to continue — pay by *bank transfer, USSD or card*. No card details saved.\n\n` +
    `_(Reply /stop to opt out of these reminders.)_`
  );
}

function tgSend(token, chatId, text, link, plan) {
  const body = JSON.stringify({
    chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: `💳 Get the ${plan.label} — ₦${plan.amount.toLocaleString()}`, url: link }]] },
  });
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, data: d })); });
    req.on('error', e => resolve({ status: 0, data: e.message }));
    req.write(body); req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const SEND = process.argv.includes('--send') || process.env.REENGAGE_SEND === '1';
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const repo = new PgRepository(process.env.DATABASE_URL);
  const flutterwave = new FlutterwaveGateway({ secretKey: process.env.FLUTTERWAVE_SECRET_KEY });
  const paymentService = new PaymentService({ repo, flutterwave });
  const plan = getPlan(DEFAULT_PLAN);

  const users = await repo.all('users');
  const optedOut = new Set();
  const alreadySent = new Set();
  for (const u of users) {
    if ((await repo.getSession(`reengage_optout:${u.id}`))?.optout) optedOut.add(u.id);
    if ((await repo.getSession(`reengage:${u.id}`))?.sent) alreadySent.add(u.id);
  }

  // Never message ourselves or our partners: exclude the admin, every affiliate
  // owner, and any partner-status account. A telegram id can carry both a 'partner'
  // row and a stale 'expired' student row, so we exclude by telegram id.
  const excludeTelegramIds = new Set();
  if (process.env.ADMIN_TELEGRAM_ID) excludeTelegramIds.add(String(process.env.ADMIN_TELEGRAM_ID));
  for (const u of users) if (u.subscription_status === 'partner' && u.telegram_id) excludeTelegramIds.add(String(u.telegram_id));
  try {
    const { rows } = await repo.pool.query(
      'SELECT DISTINCT u.telegram_id FROM affiliates a JOIN users u ON u.id = a.user_id WHERE u.telegram_id IS NOT NULL');
    for (const r of rows) excludeTelegramIds.add(String(r.telegram_id));
  } catch (e) { console.warn('affiliate-exclusion query failed:', e.message); }

  const targets = selectReengageTargets(users, { optedOut, alreadySent, excludeTelegramIds });
  const expiredTotal = users.filter(u => u.subscription_status === 'expired').length;

  console.log(`Re-engagement ${SEND ? '(SEND — live)' : '(DRY-RUN — nothing will be sent)'}`);
  console.log(`Expired: ${expiredTotal} · opted-out: ${optedOut.size} · already-sent: ${alreadySent.size} · excluded (admin/affiliate/partner): ${excludeTelegramIds.size} · to message: ${targets.length}`);
  console.log('--- sample message ---\n' + buildReengageMessage(plan) + '\n----------------------');
  console.log('Target telegram ids: ' + (targets.map(t => t.telegram_id).join(', ') || '(none)'));

  if (!SEND) {
    console.log('\nDry run complete. Re-run with --send (needs TELEGRAM_BOT_TOKEN) to actually message them.');
    await repo.pool?.end?.();
    return;
  }
  if (!token) { console.log('TELEGRAM_BOT_TOKEN not set — cannot send.'); await repo.pool?.end?.(); return; }

  let sent = 0, failed = 0;
  for (const u of targets) {
    try {
      const { link } = await paymentService.createPaymentLink(u.id, DEFAULT_PLAN);
      const r = await tgSend(token, u.telegram_id, buildReengageMessage(plan), link, plan);
      let ok = false; try { ok = JSON.parse(r.data).ok; } catch { /* non-json */ }
      if (ok) { await repo.setSession(`reengage:${u.id}`, { sent: true }); sent++; }
      else { failed++; console.warn(`  ${u.telegram_id}: HTTP ${r.status} ${String(r.data).slice(0, 120)}`); }
      await sleep(1500); // rate-limit
    } catch (err) { failed++; console.error(`  ${u.telegram_id}: ${err.message}`); }
  }
  console.log(`\nDone: ${sent} sent, ${failed} failed.`);
  await repo.pool?.end?.();
}

// Run only when invoked directly — importing for tests must not trigger main().
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
