// src/infrastructure/messaging/WhatsAppChannel.test.js
// Unit tests for the WhatsApp adapter's pure logic: signature verification,
// inbound parsing, and phone normalisation. No network — safe to run anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { WhatsAppChannel } from './WhatsAppChannel.js';
import { normalizePhone } from '../repositories/JsonlRepository.js';

const channel = (overrides = {}) => new WhatsAppChannel({
  phoneNumberId: '000', accessToken: 'test', verifyToken: 'vt', ...overrides,
});

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ─── verifySignature ─────────────────────────────────

test('verifySignature accepts a correctly-signed body', () => {
  const ch = channel({ appSecret: 'shh' });
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  assert.equal(ch.verifySignature(body, sign('shh', body)), true);
});

test('verifySignature rejects a tampered body', () => {
  const ch = channel({ appSecret: 'shh' });
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  const goodSig = sign('shh', body);
  const tampered = Buffer.from(JSON.stringify({ hello: 'evil' }));
  assert.equal(ch.verifySignature(tampered, goodSig), false);
});

test('verifySignature rejects a wrong secret', () => {
  const ch = channel({ appSecret: 'shh' });
  const body = Buffer.from('payload');
  assert.equal(ch.verifySignature(body, sign('not-the-secret', body)), false);
});

test('verifySignature rejects a missing signature header', () => {
  const ch = channel({ appSecret: 'shh' });
  assert.equal(ch.verifySignature(Buffer.from('x'), undefined), false);
});

test('verifySignature skips (returns true) when no app secret configured', () => {
  const ch = channel({ appSecret: undefined });
  assert.equal(ch.verifySignature(Buffer.from('x'), undefined), true);
});

// ─── parseIncoming ───────────────────────────────────

function inbound(message) {
  return { entry: [{ changes: [{ value: { messages: [message] } }] }] };
}

test('parseIncoming reads an interactive button reply', () => {
  const parsed = channel().parseIncoming(inbound({
    from: '2348012345678', type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: 'answer:q_1:A', title: 'A) 42' } },
  }));
  assert.deepEqual(parsed, { type: 'interactive', from: '2348012345678', id: 'answer:q_1:A', title: 'A) 42' });
});

test('parseIncoming reads an interactive list reply', () => {
  const parsed = channel().parseIncoming(inbound({
    from: '2348012345678', type: 'interactive',
    interactive: { type: 'list_reply', list_reply: { id: 'exam:jamb', title: 'JAMB / UTME' } },
  }));
  assert.equal(parsed.type, 'interactive');
  assert.equal(parsed.id, 'exam:jamb');
});

test('parseIncoming reads a template quick-reply button (type button)', () => {
  const parsed = channel().parseIncoming(inbound({
    from: '2348012345678', type: 'button',
    button: { payload: 'daily:start', text: 'Start drill' },
  }));
  assert.equal(parsed.type, 'interactive');
  assert.equal(parsed.id, 'daily:start');
});

test('parseIncoming reads a plain text message', () => {
  const parsed = channel().parseIncoming(inbound({
    from: '2348012345678', type: 'text', text: { body: 'menu' },
  }));
  assert.deepEqual(parsed, { type: 'text', from: '2348012345678', body: 'menu' });
});

test('parseIncoming returns null for a status-only / empty payload', () => {
  assert.equal(channel().parseIncoming({ entry: [{ changes: [{ value: {} }] }] }), null);
  assert.equal(channel().parseIncoming({}), null);
});

// ─── normalizePhone ──────────────────────────────────

test('normalizePhone canonicalises Nigerian formats to 234XXXXXXXXXX', () => {
  assert.equal(normalizePhone('08012345678'), '2348012345678');   // local 0-prefix
  assert.equal(normalizePhone('+2348012345678'), '2348012345678'); // +234
  assert.equal(normalizePhone('2348012345678'), '2348012345678');  // already canonical
  assert.equal(normalizePhone('+234 801 234 5678'), '2348012345678'); // spaced
});
