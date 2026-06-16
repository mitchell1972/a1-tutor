// src/infrastructure/messaging/TelegramChannel.js
// Adapter: wraps node-telegram-bot-api. Only does I/O — no business logic.
import TelegramBot from 'node-telegram-bot-api';
import { RateLimiter } from '../RateLimiter.js';

export class TelegramChannel {
  constructor(token, { ratePerSec = 25, webhookUrl = null, webhookSecret = null } = {}) {
    if (!token) throw new Error('TelegramChannel: token required');
    this.webhookUrl = webhookUrl;
    this.webhookSecret = webhookSecret;
    // Webhook mode (production) lets us run multiple instances; polling is the
    // local-dev default (only one process may poll a given token at a time).
    this.bot = new TelegramBot(token, webhookUrl ? { polling: false } : { polling: true });
    // Global pacer so we never exceed Telegram's ~30 msg/sec per-bot limit.
    this.limiter = new RateLimiter(ratePerSec);
  }

  mode() {
    return this.webhookUrl ? 'webhook' : 'polling';
  }

  async setupWebhook() {
    if (!this.webhookUrl) return;
    try {
      const opts = this.webhookSecret ? { secret_token: this.webhookSecret } : {};
      await this.bot.setWebHook(this.webhookUrl, opts);
    } catch (err) {
      console.error('TelegramChannel: setWebHook failed (check token/URL):', err.message);
    }
  }

  // Feed an inbound update (from the webhook route) to the bot's handlers.
  processUpdate(update) {
    this.bot.processUpdate(update);
  }

  onText(pattern, handler) {
    this.bot.onText(pattern, handler);
  }

  onCallback(handler) {
    this.bot.on('callback_query', handler);
  }

  // ─── Output ────────────────────────────────────────

  async send(chatId, text, opts = {}) {
    try {
      return await this.limiter.schedule(() => this.bot.sendMessage(chatId, text, opts));
    } catch (err) {
      if (err.response?.statusCode === 403) {
        console.warn(`TelegramChannel: user ${chatId} blocked the bot`);
        return;
      }
      // Telegram refuses a whole message when its Markdown can't be parsed — e.g. a
      // question whose text contains an unbalanced * _ [ or ` (rife in maths/chemistry).
      // Rather than silently drop it (the student taps and gets nothing), resend once
      // as plain text so they still receive the content. Buttons are preserved.
      if (opts.parse_mode && this._isParseError(err)) {
        console.warn(`TelegramChannel: markdown parse error for ${chatId}; resending as plain text`);
        const { parse_mode, ...rest } = opts;
        return await this.limiter.schedule(() => this.bot.sendMessage(chatId, text, rest));
      }
      throw err;
    }
  }

  // True when Telegram rejected a message because its entities (Markdown/HTML) are malformed.
  _isParseError(err) {
    const code = err.response?.statusCode ?? err.response?.body?.error_code;
    const desc = err.response?.body?.description || err.message || '';
    return code === 400 && /can'?t parse entities|parse entities/i.test(desc);
  }

  async sendWithKeyboard(chatId, text, keyboard) {
    return this.send(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async sendUrlButton(chatId, text, buttons) {
    return this.send(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons.map(b => [{
          text: b.label,
          url: b.url,
        }]),
      },
    });
  }

  async editMessage(chatId, messageId, text, keyboard) {
    const opts = { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' };
    if (keyboard) opts.reply_markup = { inline_keyboard: keyboard };
    return this.limiter.schedule(() => this.bot.editMessageText(text, opts));
  }

  async editKeyboard(chatId, messageId, keyboard) {
    return this.limiter.schedule(() => this.bot.editMessageReplyMarkup(
      { inline_keyboard: keyboard },
      { chat_id: chatId, message_id: messageId }
    ));
  }

  async answerCallback(queryId, text = '', showAlert = false) {
    return this.bot.answerCallbackQuery({ callback_query_id: queryId, text, show_alert: showAlert });
  }

  // ─── Helpers ───────────────────────────────────────

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
