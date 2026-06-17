// src/infrastructure/payment/FlutterwaveGateway.js
// Flutterwave API adapter — collects NGN from Nigerian students, settles in GBP to UK account.
import axios from 'axios';
import crypto from 'node:crypto';
import { getPlan } from '../../config/plans.js';

export class FlutterwaveGateway {
  constructor({ secretKey, publicKey, webhookSecret, redirectUrl }) {
    this.secretKey = secretKey;
    this.publicKey = publicKey;
    this.webhookSecret = webhookSecret;
    this.redirectUrl = redirectUrl || 'https://t.me/A1TutorPrep_bot';

    this.client = axios.create({
      baseURL: 'https://api.flutterwave.com/v3',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    });
  }

  /**
   * Create a payment link for a student to complete their subscription.
   */
  async createPaymentLink({ userId, email, phone, plan, name }) {
    const p = getPlan(plan);

    const payload = {
      tx_ref: `exambot-${userId}-${plan}-${Date.now()}`,
      amount: p?.amount || 500,
      currency: 'NGN',
      payment_options: 'card,account,ussd,banktransfer,qr',
      redirect_url: this.redirectUrl,
      customer: {
        email: email || `${(phone || userId || 'student').toString().replace(/[^a-zA-Z0-9]/g, '')}@students.a1tutor.ng`,
        phonenumber: phone,
        name: name || 'Student',
      },
      customizations: {
        title: 'A1 Tutor',
        description: p ? `${p.label} Subscription` : 'Subscription',
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
   * Create a CARD-ONLY payment link that verifies + tokenizes the student's card
   * (the "save card" flow). The small charge is real; the reusable token arrives
   * with the charge.completed webhook and is read via verifyTransaction().
   */
  async createCardSetupLink({ userId, email, phone, name, plan, amount }) {
    const payload = {
      tx_ref: `a1-cardsetup-${userId}-${plan}-${Date.now()}`,
      amount,
      currency: 'NGN',
      payment_options: 'card', // tokenization needs a card — no transfer/USSD here
      redirect_url: this.redirectUrl,
      customer: {
        email: email || `${(phone || userId || 'student').toString().replace(/[^a-zA-Z0-9]/g, '')}@students.a1tutor.ng`,
        phonenumber: phone,
        name: name || 'Student',
      },
      customizations: {
        title: 'A1 Tutor — Save Card',
        description: 'One-time card check. Your plan starts automatically when your free trial ends.',
      },
      meta: { user_id: userId, plan, purpose: 'card_setup' },
    };

    const { data } = await this.client.post('/payments', payload);
    if (data.status !== 'success') throw new Error(data.message || 'Card setup link failed');
    return { link: data.data.link, txRef: payload.tx_ref };
  }

  /**
   * Charge a previously saved card token (auto-billing at trial end / renewals).
   */
  async chargeToken({ token, email, amount, txRef, narration }) {
    try {
      const { data } = await this.client.post('/tokenized-charges', {
        token,
        currency: 'NGN',
        country: 'NG',
        amount,
        email,
        tx_ref: txRef,
        narration: narration || 'A1 Tutor subscription',
      });
      const ok = data.status === 'success' && data.data?.status === 'successful';
      return { success: ok, flwId: data.data?.id || null, status: data.data?.status || data.status };
    } catch (err) {
      return { success: false, flwId: null, status: err.response?.data?.message || err.message };
    }
  }

  /**
   * Verify webhook signature from Flutterwave.
   */
  verifyWebhook(signature, payload) {
    if (!this.webhookSecret) return true; // skip verification if not configured

    // Flutterwave V3 sends the configured secret hash *verbatim* in the `verif-hash`
    // header — it is NOT an HMAC of the payload. Compare it directly, constant-time.
    const got = Buffer.from(String(signature || ''));
    const want = Buffer.from(this.webhookSecret);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  /**
   * Parse a Flutterwave webhook event into a standardised action.
   */
  parseWebhookEvent(event) {
    if (event.event === 'charge.completed' && event.data?.status === 'successful') {
      const base = {
        userId: event.data.meta?.user_id,
        plan: event.data.meta?.plan,
        txRef: event.data.tx_ref,
        amount: event.data.amount,
        flwId: event.data.id,
      };
      // "Save card" flow: small card-only charge whose job is to mint a reusable token.
      if (event.data.meta?.purpose === 'card_setup') {
        return { type: 'card_setup_successful', ...base };
      }
      return { type: 'payment_successful', ...base };
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
   * Server-side verification of a transaction. Prefer the numeric Flutterwave id
   * (`/transactions/{id}/verify`); fall back to tx_ref via verify_by_reference.
   * (Previously this passed tx_ref to the id endpoint — every check 404'd.)
   */
  async verifyTransaction(flwId, txRef = null) {
    try {
      const path = flwId
        ? `/transactions/${flwId}/verify`
        : `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`;
      const { data } = await this.client.get(path);
      const d = data.data || {};
      return {
        verified: data.status === 'success' && d.status === 'successful',
        status: d.status,
        amount: d.amount,
        currency: d.currency,
        meta: d.meta,
        card: d.card || null,                       // includes the reusable token for card payments
        customerEmail: d.customer?.email || null,
      };
    } catch (err) {
      return { verified: false };
    }
  }

  /**
   * List successful transactions, for the daily payment-reconciliation safety net.
   * Pages defensively and caps pages to avoid a runaway on large accounts.
   */
  async listSuccessfulTransactions({ maxPages = 5 } = {}) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const { data } = await this.client.get('/transactions', {
          params: { status: 'successful', page },
        });
        const batch = data?.data || [];
        out.push(...batch);
        const totalPages = data?.meta?.page_info?.total_pages ?? 1;
        if (batch.length === 0 || page >= totalPages) break;
      } catch (err) {
        console.warn(`FlutterwaveGateway.listSuccessfulTransactions page ${page} failed: ${err.message}`);
        break;
      }
    }
    return out;
  }
}
