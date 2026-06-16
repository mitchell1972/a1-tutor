#!/usr/bin/env node
// scripts/affiliate-whatsapp-digest.js
//
// Decides which affiliate partners to message on WhatsApp today with their
// referral stats. The deterministic half of the daily digest: it talks to the
// production Postgres, compares against the last numbers we sent, and prints a
// plan. The flaky half — actually driving WhatsApp Web — is done by the
// scheduled task that calls this; keeping them apart means the "who do we
// message and what do we say" decision is testable and never half-runs.
//
// Rules (what Mitchell asked for):
//   • only message a partner when their numbers CHANGED since last time
//     (no spamming an identical "0 paying" every morning), and
//   • never message a partner whose link has 0 signups yet.
//
// Usage:
//   node scripts/affiliate-whatsapp-digest.js
//       → prints a JSON plan: { toMessage: [...], skipped: [...], all: [...] }
//   node scripts/affiliate-whatsapp-digest.js --commit "School Hub" 17 0
//       → records that those numbers were sent (advances the state file).
//         The task calls this only AFTER a WhatsApp send succeeds, so a failed
//         send leaves the state untouched and the partner is retried next run.
//
// State file: ~/.a1tutor-digest-last.json  → { "<partner name>": {signups, paying} }
// DB url:     <repo>/.pgurl                 → postgres connection string

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(os.homedir(), '.a1tutor-digest-last.json');

// Partner roster: the tag(s) their student sign-up links carry → the WhatsApp
// number to ping (international format, no '+'). Partners onboard via Telegram
// so we have no phone on file in the DB — this mapping is maintained by hand.
// Add a partner here once their link starts pulling signups.
export const PARTNERS = [
  { name: 'School Hub', tags: ['ref_schoolhub', 'p_x7ujqu'], whatsapp: '2349060212942' },
  // Tutor Ginux — enable once his pinned video goes live and his link has signups:
  // { name: 'Tutor Ginux', tags: ['p_XXXXXX'], whatsapp: '2348053010593' },
];

// Single-line on purpose: a browser-typed multi-line message risks sending
// half-composed (Enter sends in WhatsApp Web). No emojis — they don't type
// reliably over the web client; '—' and '.' are safe.
export function composeMessage(name, signups, paying) {
  return `A1 Tutor partner update — students joined via your link: ${signups}. `
    + `Currently paying: ${paying}. `
    + `Thanks for promoting A1 Tutor! Reply here anytime if you have questions.`;
}

// Pure decision for one partner. Exported so the spam-prevention rules are unit
// tested without a database.
export function decide(partner, stats, last) {
  const row = { name: partner.name, whatsapp: partner.whatsapp, signups: stats.signups, paying: stats.paying };
  if (!stats.signups) return { action: 'skip', reason: 'no signups yet', row };
  if (last && last.signups === stats.signups && last.paying === stats.paying) {
    return { action: 'skip', reason: 'unchanged since last update', row };
  }
  return { action: 'message', row: { ...row, message: composeMessage(partner.name, stats.signups, stats.paying) } };
}

function readPgUrl() {
  return fs.readFileSync(path.join(REPO_ROOT, '.pgurl'), 'utf8').trim();
}
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

async function statsFor(client, tags) {
  // Mirrors PgRepository.getAffiliateEarnings: signups = users on this tag,
  // paying = those with an active subscription.
  const { rows } = await client.query(
    `SELECT count(*)::int AS signups,
            count(*) FILTER (WHERE subscription_status = 'active')::int AS paying
       FROM users
      WHERE ref_source = ANY($1)`,
    [tags]
  );
  return rows[0];
}

async function commit(name, signups, paying) {
  if (!name || Number.isNaN(signups) || Number.isNaN(paying)) {
    console.error('usage: --commit "<partner name>" <signups> <paying>');
    process.exit(2);
  }
  const state = readState();
  state[name] = { signups, paying };
  writeState(state);
  console.log(JSON.stringify({ committed: { name, signups, paying } }));
}

async function plan() {
  const client = new pg.Client({ connectionString: readPgUrl() });
  await client.connect();
  const state = readState();
  const out = { generatedFor: PARTNERS.length, toMessage: [], skipped: [], all: [] };
  try {
    for (const p of PARTNERS) {
      const stats = await statsFor(client, p.tags);
      out.all.push({ name: p.name, whatsapp: p.whatsapp, ...stats });
      const d = decide(p, stats, state[p.name] || null);
      if (d.action === 'message') out.toMessage.push(d.row);
      else out.skipped.push({ ...d.row, reason: d.reason });
    }
  } finally {
    await client.end();
  }
  console.log(JSON.stringify(out, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === '--commit') return commit(rest[0], Number(rest[1]), Number(rest[2]));
  return plan();
}

// Only run when invoked directly, so the test file can import the pure helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
