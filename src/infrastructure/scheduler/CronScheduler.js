// src/infrastructure/scheduler/CronScheduler.js
// Adapter: wraps node-cron. Only handles timing — delegates to service layer.
import cron from 'node-cron';

export class CronScheduler {
  constructor(dispatchFn) {
    this.dispatchFn = dispatchFn;
    this.inProgress = false;
    this.job = null;
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
  }

  stop() {
    if (this.job) {
      this.job.stop();
      console.log('⏰ Scheduler stopped');
    }
  }

  _getWAT() {
    const now = new Date();
    const watOffset = 60; // UTC+1 in minutes
    const localOffset = now.getTimezoneOffset();
    return new Date(now.getTime() + (watOffset + localOffset) * 60000);
  }
}
