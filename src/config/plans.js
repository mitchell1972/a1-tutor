// src/config/plans.js — Subscription plans and pricing
// Immutable config

export const PLANS = {
  weekly:  { amount: 500,   days: 7,   label: '1 Week' },
  monthly: { amount: 2000,  days: 30,  label: '1 Month' },
  termly:  { amount: 5000,  days: 90,  label: 'Exam Season Pass (3 months)' },
  yearly:  { amount: 15000, days: 365, label: '1 Year' },
};

// Default affiliate revenue share (% of every payment a referred student makes,
// for the lifetime of that student). Frozen onto each affiliate at join time.
export const AFFILIATE_PERCENT = 20;

// One-time charge used to verify + tokenize a card at signup ("save card" flow).
// Small but real — Flutterwave needs an actual charge to issue a reusable card token.
export const CARD_SETUP_FEE = 100;

export function getPlan(planId) {
  return PLANS[planId] || null;
}
