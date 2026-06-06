// src/infrastructure/messaging/WhatsAppChannel.js
// Adapter: Meta WhatsApp Cloud API. Only does I/O — no business logic.
import axios from 'axios';

export class WhatsAppChannel {
  constructor({ phoneNumberId, accessToken, verifyToken }) {
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
    this.verifyToken = verifyToken;
    this.baseUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}`;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // ─── Output ────────────────────────────────────────

  async sendText(to, text) {
    try {
      const { data } = await this.client.post('/messages', {
        messaging_product: 'whatsapp', to, type: 'text', text: { body: text },
      });
      return { ok: true, id: data.messages?.[0]?.id };
    } catch (err) {
      console.error('WhatsApp sendText failed:', err.response?.data || err.message);
      return { ok: false, error: err.response?.data || err.message };
    }
  }

  async sendQuestion(to, question, index, total) {
    const options = question.options || {};
    const optionEntries = Object.entries(options).slice(0, 3); // WhatsApp max 3 buttons

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: { type: 'text', text: `Q${index + 1}/${total}` },
        body: { text: this._truncate(question.text, 1024) },
        footer: { text: `${question.subject?.toUpperCase() || ''} | ${question.topic || ''}` },
        action: {
          buttons: optionEntries.map(([key, val]) => ({
            type: 'reply',
            reply: {
              id: `${question.id}:${key}`,
              title: this._truncate(`${key}) ${val}`, 20),
            },
          })),
        },
      },
    };

    try {
      const { data } = await this.client.post('/messages', payload);
      return { ok: true, id: data.messages?.[0]?.id };
    } catch (err) {
      console.error('WhatsApp sendQuestion failed:', err.response?.data || err.message);
      return { ok: false, error: err.response?.data || err.message };
    }
  }

  async sendBatch(to, questions) {
    await this.sendText(to, `📚 *ExamPrep Daily Drill*\n${questions.length} questions coming up. Let's go! 🚀`);
    const results = [];
    for (let i = 0; i < questions.length; i++) {
      results.push(await this.sendQuestion(to, questions[i], i, questions.length));
      if (i < questions.length - 1) await this._sleep(4000);
    }
    return results;
  }

  // ─── Webhook ───────────────────────────────────────

  verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token === this.verifyToken) {
      return { verified: true, challenge };
    }
    return { verified: false };
  }

  parseIncoming(body) {
    try {
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return null;

      const from = message.from;

      if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
        const replyId = message.interactive.button_reply.id;
        return {
          type: 'answer',
          from,
          questionId: replyId.split(':')[0],
          answer: replyId.split(':')[1],
        };
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
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 3) + '...' : str;
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
