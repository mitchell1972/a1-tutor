// Unit tests for the WhatsApp affiliate-digest decision logic.
// Pure — no DB, no network, no state file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, composeMessage } from './affiliate-whatsapp-digest.js';

const PARTNER = { name: 'School Hub', whatsapp: '2349060212942', tags: ['p_x7ujqu'] };

test('messages a partner the first time their link has signups (no prior state)', () => {
  const d = decide(PARTNER, { signups: 4, paying: 1 }, null);
  assert.equal(d.action, 'message');
  assert.equal(d.row.signups, 4);
  assert.equal(d.row.paying, 1);
  assert.match(d.row.message, /joined via your link: 4/);
  assert.match(d.row.message, /Currently paying: 1/);
});

test('skips a partner whose link has 0 signups (never spam a dormant partner)', () => {
  const d = decide(PARTNER, { signups: 0, paying: 0 }, null);
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'no signups yet');
});

test('skips when numbers are unchanged since the last update we sent', () => {
  const d = decide(PARTNER, { signups: 17, paying: 0 }, { signups: 17, paying: 0 });
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'unchanged since last update');
});

test('messages again when signups grew', () => {
  const d = decide(PARTNER, { signups: 20, paying: 0 }, { signups: 17, paying: 0 });
  assert.equal(d.action, 'message');
  assert.match(d.row.message, /joined via your link: 20/);
});

test('messages again when a referred student starts paying (paying changed, signups same)', () => {
  const d = decide(PARTNER, { signups: 17, paying: 1 }, { signups: 17, paying: 0 });
  assert.equal(d.action, 'message');
  assert.match(d.row.message, /Currently paying: 1/);
});

test('the message is a single line and emoji-free (safe to type into WhatsApp Web)', () => {
  const msg = composeMessage('School Hub', 17, 0);
  assert.equal(msg.includes('\n'), false);
  // No characters outside the basic typeable range (catches emoji).
  assert.ok(!/[\u{1F000}-\u{1FFFF}☀-➿]/u.test(msg));
});
