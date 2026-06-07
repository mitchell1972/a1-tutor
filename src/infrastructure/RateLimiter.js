// src/infrastructure/RateLimiter.js
// Global outbound pacer. Spaces scheduled tasks so they never exceed a fixed
// rate (e.g. Telegram's ~30 messages/second per bot). Single-process, in-memory:
// every send across the app funnels through one instance per channel.
export class RateLimiter {
  constructor(ratePerSec = 25) {
    this.interval = 1000 / Math.max(1, ratePerSec);
    this.nextSlot = 0;
  }

  /**
   * Run `fn` no sooner than the next free time slot, advancing the slot so
   * subsequent calls are spaced by `interval` ms. Returns fn's result.
   */
  schedule(fn) {
    const now = Date.now();
    const runAt = Math.max(now, this.nextSlot);
    this.nextSlot = runAt + this.interval;
    const delay = runAt - now;
    if (delay <= 0) return Promise.resolve().then(fn);
    return new Promise((resolve, reject) => {
      setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), delay);
    });
  }
}
