// src/config/plans.js — Subscription plans and pricing
// Immutable config

// One-off "Exam Season Pass" is the headline conversion product: a single payment,
// no renewal, that activates the student until their exam date (see computeEndDate)
// — clamped so ₦2,000 can't accidentally become a 12-month pass, and a student who
// buys just after an exam still gets a sensible minimum window. Price via env.
const SEASON_PASS_PRICE = Number(process.env.SEASON_PASS_PRICE || process.env.SEASON_PASS_AMOUNT) || 2000;

export const PLANS = {
  season:  { amount: SEASON_PASS_PRICE, untilExam: true, fallbackDays: 120, minDays: 14, maxDays: 150, label: 'Exam Season Pass' },
  weekly:  { amount: 500,   days: 7,   label: '1 Week' },
  monthly: { amount: 2000,  days: 30,  label: '1 Month' },
  termly:  { amount: 5000,  days: 90,  label: '3-Month Pass' },
  yearly:  { amount: 15000, days: 365, label: '1 Year' },
};

// Plan offered by one-tap CTAs (trial-end paywall, re-engagement).
export const DEFAULT_PLAN = 'season';

// Default affiliate revenue share (% of every payment a referred student makes,
// for the lifetime of that student). Frozen onto each affiliate at join time.
export const AFFILIATE_PERCENT = 20;

export function getPlan(planId) {
  return PLANS[planId] || null;
}
