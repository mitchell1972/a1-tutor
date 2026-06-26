// src/config/plans.js — Subscription plans and pricing
// Immutable config

// One-off "Exam Season Pass" is the headline conversion product: a single payment,
// no renewal, that activates the student until their exam date (see computeEndDate)
// — clamped so ₦2,000 can't accidentally become a 12-month pass, and a student who
// buys just after an exam still gets a sensible minimum window. Price via env.
const SEASON_PASS_AMOUNT = Number(process.env.SEASON_PASS_AMOUNT) || 2000;

export const PLANS = {
  season:  { amount: SEASON_PASS_AMOUNT, untilExam: true, fallbackDays: 120, minDays: 14, maxDays: 150, label: 'Exam Season Pass' },
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

// Card-on-file ("save card → auto-charge at trial end") is OFF by default: in a
// card-averse market nobody saved one and it gated conversion. The primary path is
// hosted checkout (createPaymentLink → transfer/USSD/card, no stored card required).
export const CARD_ONFILE_ENABLED =
  process.env.CARD_ONFILE_ENABLED === 'true' || process.env.CARD_ONFILE_ENABLED === '1';

// One-time charge used to verify + tokenize a card ("save card" flow — gated off above).
export const CARD_SETUP_FEE = 100;

export function getPlan(planId) {
  return PLANS[planId] || null;
}
