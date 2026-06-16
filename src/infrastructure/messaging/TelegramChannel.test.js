// Unit tests for TelegramChannel.send() — focuses on the plain-text fallback that
// keeps a message deliverable when its Markdown can't be parsed (the bug that was
// silently dropping maths/chemistry questions). Pure: no network, mocked bot + limiter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramChannel } from './TelegramChannel.js';

function makeChannel() {
  // webhookUrl set -> polling:false -> constructor makes no network calls.
  const ch = new TelegramChannel('123:dummy', { webhookUrl: 'https://example.com/wh' });
  ch.limiter = { schedule: (fn) => fn() };   // run immediately, no rate-limit wait
  return ch;
}

function parseError() {
  const e = new Error("ETELEGRAM: 400 Bad Request: can't parse entities");
  e.response = {
    statusCode: 400,
    body: { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 261" },
  };
  return e;
}

test('resends as plain text when Markdown fails to parse, preserving the keyboard', async () => {
  const ch = makeChannel();
  const calls = [];
  ch.bot = { sendMessage: async (chatId, text, opts) => {
    calls.push(opts);
    if (calls.length === 1) throw parseError();   // first (Markdown) attempt fails
    return { message_id: 7 };
  } };

  const res = await ch.send(123, 'Solve for x_1 when 2*x = *6', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: 'A', callback_data: 'answer:1:A' }]] },
  });

  assert.equal(calls.length, 2, 'should retry exactly once');
  assert.equal(calls[0].parse_mode, 'Markdown', 'first attempt uses Markdown');
  assert.equal(calls[1].parse_mode, undefined, 'retry drops parse_mode');
  assert.ok(calls[1].reply_markup, 'retry keeps the inline keyboard');
  assert.deepEqual(res, { message_id: 7 }, 'returns the successful send result');
});

test('does NOT retry on a non-parse error (re-throws)', async () => {
  const ch = makeChannel();
  let n = 0;
  ch.bot = { sendMessage: async () => { n++; const e = new Error('boom'); e.response = { statusCode: 500, body: { error_code: 500, description: 'internal error' } }; throw e; } };
  await assert.rejects(() => ch.send(1, 'hi', { parse_mode: 'Markdown' }));
  assert.equal(n, 1, 'no retry on 500');
});

test('does NOT retry a parse error when there was no parse_mode to blame', async () => {
  const ch = makeChannel();
  let n = 0;
  ch.bot = { sendMessage: async () => { n++; throw parseError(); } };
  await assert.rejects(() => ch.send(1, 'hi', {}));
  assert.equal(n, 1, 'plain message already — retry would not help');
});

test('swallows 403 (user blocked the bot) without throwing', async () => {
  const ch = makeChannel();
  ch.bot = { sendMessage: async () => { const e = new Error('blocked'); e.response = { statusCode: 403, body: { error_code: 403, description: 'Forbidden: bot was blocked by the user' } }; throw e; } };
  const res = await ch.send(1, 'hi', { parse_mode: 'Markdown' });
  assert.equal(res, undefined, 'returns quietly on 403');
});

test('happy path: returns the send result and does not retry', async () => {
  const ch = makeChannel();
  let n = 0;
  ch.bot = { sendMessage: async () => { n++; return { message_id: 42 }; } };
  const res = await ch.send(1, 'hi', { parse_mode: 'Markdown' });
  assert.equal(n, 1);
  assert.deepEqual(res, { message_id: 42 });
});
