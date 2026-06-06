// src/services/SubscriptionService.js
// Orchestrates subscription lifecycle: trial checks, expiry, notifications.
import { checkAccess } from '../domain/SubscriptionValidator.js';
import { getPlan, PLANS } from '../config/plans.js';
import { TRIAL_DAYS } from '../config/subjects.js';

export class SubscriptionService {
  constructor({ repo }) {
    this.repo = repo;
  }

  /**
   * Check a user's current access status with full context.
   */
  async getStatus(userId) {
    const user = await this.repo.getUser(userId);
    if (!user) return { valid: false, reason: 'not_found' };

    const activeSub = await this.repo.getActiveSubscription(userId);
    const access = checkAccess(user, activeSub);

    return {
      ...access,
      trialDaysTotal: TRIAL_DAYS,
      activePlan: activeSub?.plan || null,
      planLabel: activeSub ? getPlan(activeSub.plan)?.label : null,
      subscriptionEndDate: activeSub?.end_date || null,
      subscriptionStartDate: activeSub?.start_date || null,
    };
  }

  /**
   * Check if user has valid access. Used by dispatch service.
   */
  async hasAccess(userId) {
    const status = await this.getStatus(userId);
    return status.valid;
  }

  /**
   * Get list of users whose trial just expired (for notification).
   */
  async getRecentlyExpiredTrials() {
    const users = await this.repo.all('users');
    return users.filter(u => {
      if (u.subscription_status !== 'trial') return false;
      const trialStart = u.trial_start ? new Date(u.trial_start) : new Date(u.created_at);
      const trialEnd = new Date(trialStart);
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
      trialEnd.setHours(23, 59, 59, 999);

      const now = new Date();
      // Expired within last 24 hours
      return now > trialEnd && (now - trialEnd) < 24 * 60 * 60 * 1000;
    });
  }

  /**
   * Activate a subscription after confirmed payment.
   */
  async activate(userId, plan, endDate) {
    await this.repo.updateUser(userId, {
      subscription_status: 'active',
      subscription_expiry: new Date(endDate).toISOString(),
    });

    return await this.repo.getUser(userId);
  }

  /**
   * Expire a user's trial (mark as expired).
   */
  async expireTrial(userId) {
    await this.repo.updateUser(userId, { subscription_status: 'expired' });
  }

  /**
   * Get formatted subscription text for display to user.
   */
  async getDisplayInfo(userId) {
    const status = await this.getStatus(userId);
    const plans = PLANS;

    let text = '';

    if (status.status === 'trial') {
      text = `🟡 Free Trial — ${status.daysLeft} day${status.daysLeft !== 1 ? 's' : ''} left\n` +
        `(Total: ${TRIAL_DAYS} days free)\n\n` +
        `Subscribe to continue after your trial:`;
    } else if (status.status === 'active') {
      const endDate = new Date(status.subscriptionEndDate);
      text = `🟢 Active — Until ${endDate.toLocaleDateString('en-GB')}\n` +
        `Plan: ${status.planLabel}\n` +
        `${status.daysLeft} day${status.daysLeft !== 1 ? 's' : ''} remaining\n\n` +
        `Extend your subscription:`;
    } else {
      text = `🔴 No active subscription\n\nSubscribe to get daily questions:`;
    }

    return { text, status, plans };
  }
}
