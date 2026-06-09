// src/infrastructure/scheduler/CronScheduler.js
// Adapter: wraps node-cron. Only handles timing — delegates to service layer.
import cron from 'node-cron';

export class CronScheduler {
  constructor(dispatchFn, dailyJobs = []) {
    this.dispatchFn = dispatchFn;
    this.dailyJobs = dailyJobs;   // [{ name, cron, fn }] — each runs on its own cron expression
    this.inProgress = false;
    this.job = null;
    this.daily = [];
  }

  /**
   * Start checking every minute for users due for delivery.
   */
  start() {
    console.log('⏰ Scheduler started — checking every minute for WAT deliveries');
    this.job = cron.schedule('* * * * *', async () => {
      if (this.inProgress) return;
      this.inProgress = true;
      try {
        const now = this._getWAT();
        await this.dispatchFn(now.getHours(), now.getMinutes());
      } catch (err) {
        console.error('Scheduler error:', err);
      } finally {
        this.inProgress = false;
      }
    });

    // Daily jobs (e.g. question generation) — each on its own cron, guarded against overlap.
    for (const j of this.dailyJobs) {
      if (!j || !j.cron || typeof j.fn !== 'function') continue;
      console.log(`⏰ Daily job scheduled: "${j.name}" at "${j.cron}"`);
      let running = false;
      this.daily.push(cron.schedule(j.cron, async () => {
        if (running) return;            // skip if the previous run is still going
        running = true;
        try { await j.fn(); }
        catch (err) { console.error(`Daily job "${j.name}" error:`, err); }
        finally { running = false; }
      }));
    }
  }

  stop() {
    if (this.job) this.job.stop();
    for (const j of this.daily) j.stop();
    console.log('⏰ Scheduler stopped');
  }

  _getWAT() {
    const now = new Date();
    const watOffset = 60; // UTC+1 in minutes
    const localOffset = now.getTimezoneOffset();
    return new Date(now.getTime() + (watOffset + localOffset) * 60000);
  }
}
