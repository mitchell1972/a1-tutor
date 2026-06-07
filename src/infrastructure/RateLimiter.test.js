// src/infrastructure/RateLimiter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from './RateLimiter.js';

test('schedule runs the task and returns its value', async () => {
  const rl = new RateLimiter(1000);
  assert.equal(await rl.schedule(() => 42), 42);
  assert.equal(await rl.schedule(async () => 'x'), 'x');
});

test('schedule paces consecutive tasks by ~the interval', async () => {
  const rl = new RateLimiter(50); // 20ms between tasks
  const times = await Promise.all([1, 2, 3, 4].map(() => rl.schedule(() => Date.now())));
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] - times[i - 1] >= 15, `gap ${i} was ${times[i] - times[i - 1]}ms (expected ~20)`);
  }
});

test('schedule propagates task errors', async () => {
  const rl = new RateLimiter(1000);
  await assert.rejects(() => rl.schedule(() => { throw new Error('boom'); }), /boom/);
});
