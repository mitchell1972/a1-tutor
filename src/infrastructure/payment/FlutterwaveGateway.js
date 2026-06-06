// src/infrastructure/payment/FlutterwaveGateway.js
// Flutterwave API adapter — collects NGN from Nigerian students, settles in GBP to UK account.
import axios from 'axios';
import crypto from 'node:crypto';

export class FlutterwaveGateway {
  constructor({ secretKey, publicKey, webhookSecret, redirectUrl }) {
    this.secretKey = secretKey;
    this.publicKey = publicKey;
    this.webhookSecret = webhookSecret;
    this.redirectUrl = redirectUrl || 'https://t.me/ExamPrepBot';

    this.client = axios.create({
      baseURL: 'https://api.flutterwave.com/v3',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    });
  }

  /**
   * Create a payment link for a student to complete their subscription.
   */
  async createPaymentLink({ userId, email, phone, plan, name }) {
    const planAmounts = { weekly: 500, monthly: 1500, termly: 4000, yearly: 12000 };
    const planLabels = { weekly: '1 Week Subscription', monthly: '1 Month Subscription', termly: '3 Month Subscription', yearly: '1 Year Subscription' };

    const payload = {
      tx_ref: `exambot-${userId}-${plan}-${Date.now()}`,
      amount: planAmounts[plan] || 500,
      currency: 'NGN',
      payment_options: 'card,account,ussd,banktransfer,qr',
      redirect_url: this.redirectUrl,
      customer: {
        email: email || `${phone}@exambot.ng`,
        phonenumber: phone,
        name: name || 'Student',
      },
      customizations: {
        title: 'ExamPrep Bot',
        description: planLabels[plan] || 'Subscription',
      },
      meta: { user_id: userId, plan },
    };

    const { data } = await this.client.post('/payments', payload);

    if (data.status !== 'success') {
      throw new Error(data.message || 'Payment creation failed');
    }

    return { link: data.data.link, txRef: payload.tx_ref };
  }

  /**
   * Verify webhook signature from Flutterwave.
   */
  verifyWebhook(signature, payload) {
    if (!this.webhookSecret) return true; // skip verification if not configured

    const hash = crypto.createHmac('sha256', this.webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return hash === signature;
  }

  /**
   * Parse a Flutterwave webhook event into a standardised action.
   */
  parseWebhookEvent(event) {
    if (event.event === 'charge.completed' && event.data?.status === 'successful') {
      return {
        type: 'payment_successful',
        userId: event.data.meta?.user_id,
        plan: event.data.meta?.plan,
        txRef: event.data.tx_ref,
        amount: event.data.amount,
        flwId: event.data.id,
      };
    }

    if (event.event === 'subscription.cancelled') {
      return {
        type: 'subscription_cancelled',
        userId: event.data.meta?.user_id,
      };
    }

    return { type: 'unknown' };
  }

  /**
   * Server-side verification of a transaction.
   */
  async verifyTransaction(transactionId) {
    try {
      const { data } = await this.client.get(`/transactions/${transactionId}/verify`);
      return {
        verified: data.status === 'success',
        status: data.data?.status,
        amount: data.data?.amount,
        currency: data.data?.currency,
        meta: data.data?.meta,
      };
    } catch (err) {
      return { verified: false };
    }
  }
}
