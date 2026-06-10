// src/services/PaymentService.js
// Orchestrates payment link creation, webhook processing, and trial-end auto-billing.
import { getPlan, PLANS, CARD_SETUP_FEE } from '../config/plans.js';
import { calculateEndDate } from '../domain/SubscriptionValidator.js';

export class PaymentService {
  constructor({ repo, flutterwave }) {
    this.repo = repo;
    this.flutterwave = flutterwave;
  }

  /**
   * Create a payment link for the user.
   */
  async createPaymentLink(userId, planId) {
    const user = await this.repo.getUser(userId);
    if (!user) throw new Error('User not found');

    const plan = getPlan(planId);
    if (!plan) throw new Error(`Invalid plan: ${planId}`);

    return this.flutterwave.createPaymentLink({
      userId: user.id,
      email: user.email,
      phone: user.phone,
      plan: planId,
      name: user.name,
    });
  }

  /**
   * Create a card-only "save card" link: a small one-time charge (₦CARD_SETUP_FEE)
   * that tokenizes the student's card so their chosen plan can start automatically
   * when the free trial ends.
   */
  async createCardSetupLink(userId, planId) {
    const user = await this.repo.getUser(userId);
    if (!user) throw new Error('User not found');
    const plan = getPlan(planId);
    if (!plan) throw new Error(`Invalid plan: ${planId}`);

    return this.flutterwave.createCardSetupLink({
      userId: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      plan: planId,
      amount: CARD_SETUP_FEE,
    });
  }

  /**
   * Process a Flutterwave webhook event.
   * - payment_successful   → activate the paid subscription
   * - card_setup_successful → store the card token + enrol in trial-end auto-billing
   */
  async processWebhook(event) {
    const parsed = this.flutterwave.parseWebhookEvent(event);

    if (!['payment_successful', 'card_setup_successful'].includes(parsed.type)) {
      return { action: 'ignored', reason: parsed.type };
    }

    const { userId, plan, txRef, flwId } = parsed;
    if (!userId) return { action: 'ignored', reason: 'no_user_meta' };

    // Server-side verification (by Flutterwave numeric id; tx_ref as fallback)
    const verification = await this.flutterwave.verifyTransaction(flwId, txRef);
    if (!verification.verified) {
      console.warn(`PaymentService: server-side verification failed for ${txRef}`);
      return { action: 'verification_failed' };
    }

    if (parsed.type === 'card_setup_successful') {
      const token = verification.card?.token;
      if (!token) {
        console.warn(`PaymentService: card_setup ${txRef} verified but no card token returned`);
        return { action: 'card_setup_no_token', userId };
      }
      await this.repo.updateUser(userId, {
        card_token: token,
        card_email: verification.customerEmail,
        card_last4: verification.card?.last_4digits || null,
        autobill_plan: plan,
        autobill_status: 'on',
      });
      return { action: 'card_saved', userId, plan, last4: verification.card?.last_4digits || '' };
    }

    const result = await this._activate(userId, plan, txRef, parsed.amount, flwId);
    return { action: 'activated', ...result };
  }

  /**
   * Trial just ended: if the user saved a card and didn't cancel, charge their
   * chosen plan on the stored token and activate. Returns { charged, plan, endDate }.
   */
  async autoChargeTrialEnd(user) {
    if (!user?.card_token || user.autobill_status !== 'on') return { charged: false, reason: 'not_enrolled' };

    const planId = user.autobill_plan || 'weekly';
    const plan = getPlan(planId);
    if (!plan) return { charged: false, reason: 'bad_plan' };

    const txRef = `a1-autobill-${user.id}-${planId}-${Date.now()}`;
    const charge = await this.flutterwave.chargeToken({
      token: user.card_token,
      email: user.card_email || user.email || `${user.phone || user.id}@exambot.ng`,
      amount: plan.amount,
      txRef,
      narration: `A1 Tutor ${plan.label} plan`,
    });

    if (!charge.success) {
      console.warn(`PaymentService: auto-charge failed for ${user.id}: ${charge.status}`);
      return { charged: false, reason: charge.status };
    }

    const result = await this._activate(user.id, planId, txRef, plan.amount, charge.flwId);
    return { charged: true, ...result };
  }

  /**
   * Turn off trial-end auto-billing (the /cancel command). Card token is kept so
   * the student can re-enable without paying the setup fee again.
   */
  async cancelAutobill(userId) {
    await this.repo.updateUser(userId, { autobill_status: 'cancelled' });
    return this.repo.getUser(userId);
  }

  // Shared activation: record the subscription and flip the user to active.
  async _activate(userId, plan, txRef, amount, flwId) {
    const endDate = calculateEndDate(plan);

    await this.repo.createSubscription({
      user_id: userId,
      plan,
      status: 'active',
      start_date: new Date().toISOString().split('T')[0],
      end_date: endDate,
      tx_ref: txRef,
      amount,
      flw_id: flwId,
    });

    await this.repo.updateUser(userId, {
      subscription_status: 'active',
      subscription_expiry: new Date(endDate).toISOString(),
    });

    return { userId, plan, endDate };
  }

  /**
   * Get all available plans for display.
   */
  getPlans() {
    return PLANS;
  }
}
