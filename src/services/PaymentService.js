// src/services/PaymentService.js
// Orchestrates payment link creation and webhook processing.
import { getPlan, PLANS } from '../config/plans.js';
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
    const user = this.repo.getUser(userId);
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
   * Process a Flutterwave webhook event.
   * Activates subscription on successful payment.
   */
  async processWebhook(event) {
    const parsed = this.flutterwave.parseWebhookEvent(event);

    if (parsed.type !== 'payment_successful') {
      return { action: 'ignored', reason: parsed.type };
    }

    const { userId, plan, txRef } = parsed;

    // Server-side verification
    const verification = await this.flutterwave.verifyTransaction(txRef);
    if (!verification.verified) {
      console.warn(`PaymentService: server-side verification failed for ${txRef}`);
      return { action: 'verification_failed' };
    }

    // Activate subscription
    const endDate = calculateEndDate(plan);

    this.repo.createSubscription({
      user_id: userId,
      plan,
      status: 'active',
      start_date: new Date().toISOString().split('T')[0],
      end_date: endDate,
      tx_ref: txRef,
      amount: parsed.amount,
      flw_id: parsed.flwId,
    });

    this.repo.updateUser(userId, {
      subscription_status: 'active',
      subscription_expiry: new Date(endDate).toISOString(),
    });

    return {
      action: 'activated',
      userId,
      plan,
      endDate,
    };
  }

  /**
   * Get all available plans for display.
   */
  getPlans() {
    return PLANS;
  }
}
