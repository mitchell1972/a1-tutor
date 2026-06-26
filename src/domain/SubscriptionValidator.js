// src/domain/SubscriptionValidator.js
// Pure domain logic: subscription status checks.
// Zero dependencies.

import { TRIAL_DAYS, examTargetDate } from '../config/subjects.js';
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
 * Subscription end date for a plan. For one-off "until exam" plans (the season
 * pass) the end is the student's exam date (derived from their exam_type), clamped
 * to [minDays, maxDays] so a single small payment can't become a year-long pass, and
 * a student who buys just after their exam still gets a sensible minimum window.
 * Returns YYYY-MM-DD. `user` and `now` are injectable for testing.
 */
export function computeEndDate(planId, user = {}, now = new Date()) {
  const plan = getPlan(planId);
  const DAY = 24 * 60 * 60 * 1000;
  const iso = (dt) => new Date(dt).toISOString().split('T')[0];

  if (plan?.untilExam) {
    const minEnd = new Date(now.getTime() + (plan.minDays ?? 14) * DAY);
    const maxEnd = new Date(now.getTime() + (plan.maxDays ?? 150) * DAY);
    const exam = user?.exam_type ? examTargetDate(user.exam_type, now) : null;
    let end = exam || new Date(now.getTime() + (plan.fallbackDays ?? 120) * DAY);
    if (end < minEnd) end = minEnd;
    if (end > maxEnd) end = maxEnd;
    return iso(end);
  }

  const days = plan?.days || 30;
  return iso(new Date(now.getTime() + days * DAY));
}

/**
 * Calculate subscription end date from a plan (legacy entry — delegates to
 * computeEndDate with no user context).
 */
export function calculateEndDate(planId) {
  return computeEndDate(planId, {}, new Date());
}
