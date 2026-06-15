// src/domain/SubscriptionValidator.js
// Pure domain logic: subscription status checks.
// Zero dependencies.

import { TRIAL_DAYS } from '../config/subjects.js';
import { getPlan } from '../config/plans.js';

/**
 * Check if a user has valid access (trial or paid).
 * Returns { valid, status, daysLeft, reason }
 */
export function checkAccess(user, activeSubscription) {
  const now = new Date();

  // Paid subscription active
  if (activeSubscription && activeSubscription.status === 'active') {
    const endDate = new Date(activeSubscription.end_date);
    if (endDate >= now) {
      const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
      return { valid: true, status: 'active', daysLeft, reason: null };
    }
    // Subscription expired
    return { valid: false, status: 'expired', daysLeft: 0, reason: 'subscription_expired' };
  }

  // Free trial — anchor to trial_start; if it's somehow missing, fall back to
  // the signup date (NEVER "now", which would hand out a fresh window on every
  // check and never expire). Mirrors SubscriptionService.getRecentlyExpiredTrials.
  if (user.subscription_status === 'trial' || !user.subscription_status) {
    const trialStart = new Date(user.trial_start || user.created_at || 0);
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

    if (now <= trialEnd) {
      const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      return { valid: true, status: 'trial', daysLeft, reason: null };
    }

    return { valid: false, status: 'trial_expired', daysLeft: 0, reason: 'trial_expired' };
  }

  return { valid: false, status: 'expired', daysLeft: 0, reason: 'subscription_expired' };
}

/**
 * Calculate subscription end date from a plan.
 */
export function calculateEndDate(planId) {
  const days = getPlan(planId)?.days || 30;
  const end = new Date();
  end.setDate(end.getDate() + days);
  return end.toISOString().split('T')[0];
}
