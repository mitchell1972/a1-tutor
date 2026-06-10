// src/config/plans.js — Subscription plans and pricing
// Immutable config

export const PLANS = {
  weekly:  { amount: 500,   days: 7,   label: '1 Week' },
  monthly: { amount: 1500,  days: 30,  label: '1 Month' },
  termly:  { amount: 4000,  days: 90,  label: '3 Months' },
  yearly:  { amount: 12000, days: 365, label: '1 Year' },
};

// One-time charge used to verify + tokenize a card at signup ("save card" flow).
// Small but real — Flutterwave needs an actual charge to issue a reusable card token.
export const CARD_SETUP_FEE = 100;

export function getPlan(planId) {
  return PLANS[planId] || null;
}
