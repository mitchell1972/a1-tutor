// src/infrastructure/messaging/WhatsAppChannel.js
// Adapter: Meta WhatsApp Cloud API. Only does I/O — no business logic.
import axios from 'axios';
import crypto from 'node:crypto';
import { RateLimiter } from '../RateLimiter.js';

export class WhatsAppChannel {
  constructor({ phoneNumberId, accessToken, verifyToken, appSecret, ratePerSec = 20 }) {
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
    this.verifyToken = verifyToken;
    this.appSecret = appSecret; // used to verify inbound webhook signatures
    this.baseUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}`;
    this._warnedNoSecret = false;
    this.limiter = new RateLimiter(ratePerSec);

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // ─── Output ────────────────────────────────────────

  async _post(payload, label) {
    try {
      const { data } = await this.limiter.schedule(() => this.client.post('/messages', payload));
      return { ok: true, id: data.messages?.[0]?.id };
    } catch (err) {
      console.error(`WhatsApp ${label} failed:`, err.response?.data || err.message);
      return { ok: false, error: err.response?.data || err.message };
    }
  }

  async sendText(to, text) {
    return this._post({
      messaging_product: 'whatsapp', to, type: 'text', text: { body: this._truncate(text, 4096) },
    }, 'sendText');
  }

  /**
   * Reply buttons. WhatsApp hard-caps these at 3 — use sendList for more.
   * buttons: [{ id, title }]
   */
  async sendButtons(to, body, buttons, { header, footer } = {}) {
    const interactive = {
      type: 'button',
      body: { text: this._truncate(body, 1024) },
      action: {
        buttons: buttons.slice(0, 3).map(b => ({
          type: 'reply',
          reply: { id: this._truncate(b.id, 256), title: this._truncate(b.title, 20) },
        })),
      },
    };
    if (header) interactive.header = { type: 'text', text: this._truncate(header, 60) };
    if (footer) interactive.footer = { text: this._truncate(footer, 60) };

    return this._post({
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'interactive', interactive,
    }, 'sendButtons');
  }

  /**
   * List message — single-select, up to 10 rows. Used for menus with >3 options.
   * sections: [{ title?, rows: [{ id, title, description? }] }]
   */
  async sendList(to, body, buttonText, sections, { header, footer } = {}) {
    const safeSections = sections.map(s => {
      const section = {
        rows: s.rows.slice(0, 10).map(r => {
          const row = { id: this._truncate(r.id, 200), title: this._truncate(r.title, 24) };
          if (r.description) row.description = this._truncate(r.description, 72);
          return row;
        }),
      };
      if (s.title) section.title = this._truncate(s.title, 24);
      return section;
    });

    const interactive = {
      type: 'list',
      body: { text: this._truncate(body, 1024) },
      action: { button: this._truncate(buttonText, 20), sections: safeSections },
    };
    if (header) interactive.header = { type: 'text', text: this._truncate(header, 60) };
    if (footer) interactive.footer = { text: this._truncate(footer, 60) };

    return this._post({
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'interactive', interactive,
    }, 'sendList');
  }

  /**
   * Send one question as a LIST message so all options show.
   * (Reply buttons cap at 3 and would silently drop a 4th option.)
   * Each row id is `answer:<questionId>:<optionKey>` for the inbound router.
   */
  async sendQuestion(to, question, index, total) {
    const options = question.options || {};
    const rows = Object.entries(options).slice(0, 10).map(([key, val]) => {
      const text = String(val);
      const row = { id: `answer:${question.id}:${key}`, title: this._truncate(`${key}) ${text}`, 24) };
      if (text.length > 20) row.description = this._truncate(text, 72);
      return row;
    });

    const subject = (question.subject || '').toUpperCase();
    const topic = (question.topic || '').replace(/_/g, ' ');

    return this.sendList(
      to,
      question.text,
      'Choose answer',
      [{ title: 'Options', rows }],
      { header: `Q${index + 1}/${total}`, footer: `${subject}${topic ? ' | ' + topic : ''}` }
    );
  }

  /**
   * Send an intro line followed by a batch of questions, 4s apart
   * (well within Meta's ~80 msg/sec ceiling). Used for on-demand drills.
   */
  async sendQuestions(to, questions, introText) {
    if (introText) await this.sendText(to, introText);
    const results = [];
    for (let i = 0; i < questions.length; i++) {
      results.push(await this.sendQuestion(to, questions[i], i, questions.length));
      if (i < questions.length - 1) await this._sleep(4000);
    }
    return results;
  }

  /**
   * Send a pre-approved template message. Required for proactive sends
   * outside Meta's 24-hour customer-service window (e.g. the 7am daily push).
   */
  async sendTemplate(to, name, languageCode = 'en', components = []) {
    const template = { name, language: { code: languageCode } };
    if (components.length) template.components = components;
    return this._post({
      messaging_product: 'whatsapp', to, type: 'template', template,
    }, 'sendTemplate');
  }

  // ─── Webhook ───────────────────────────────────────

  verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token === this.verifyToken) {
      return { verified: true, challenge };
    }
    return { verified: false };
  }

  /**
   * Verify the X-Hub-Signature-256 header Meta stamps on every webhook POST.
   * `rawBody` MUST be the unparsed request body (Buffer or string).
   * If no app secret is configured, verification is skipped (with one warning).
   */
  verifySignature(rawBody, signatureHeader) {
    if (!this.appSecret) {
      if (!this._warnedNoSecret) {
        console.warn('⚠️  WhatsAppChannel: WHATSAPP_APP_SECRET not set — inbound webhooks are NOT signature-verified.');
        this._warnedNoSecret = true;
      }
      return true;
    }
    if (!signatureHeader) return false;

    const expected = 'sha256=' + crypto
      .createHmac('sha256', this.appSecret)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Normalise an inbound webhook into one of:
   *   { type: 'interactive', from, id, title }  — button reply, list reply, or template button
   *   { type: 'text', from, body }
   *   { type: 'unknown', from }
   *   null
   * The `id` carries the routing prefix (answer:/exam:/preset:/time:/menu:/plan:/daily:).
   */
  parseIncoming(body) {
    try {
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return null;

      const from = message.from;

      if (message.type === 'interactive') {
        const reply = message.interactive?.button_reply || message.interactive?.list_reply;
        if (reply) return { type: 'interactive', from, id: reply.id, title: reply.title };
        return { type: 'unknown', from };
      }

      // Quick-reply buttons on template messages arrive as type 'button'.
      if (message.type === 'button') {
        return { type: 'interactive', from, id: message.button?.payload || message.button?.text, title: message.button?.text };
      }

      if (message.type === 'text') {
        return { type: 'text', from, body: message.text.body };
      }

      return { type: 'unknown', from };
    } catch (err) {
      console.error('WhatsApp parse error:', err);
      return null;
    }
  }

  // ─── Helpers ───────────────────────────────────────

  _truncate(str, max) {
    if (str === null || str === undefined) return '';
    str = String(str);
    return str.length > max ? str.slice(0, max - 3) + '...' : str;
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
