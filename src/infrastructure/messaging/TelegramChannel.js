// src/infrastructure/messaging/TelegramChannel.js
// Adapter: wraps node-telegram-bot-api. Only does I/O — no business logic.
import TelegramBot from 'node-telegram-bot-api';

export class TelegramChannel {
  constructor(token) {
    if (!token) throw new Error('TelegramChannel: token required');
    this.bot = new TelegramBot(token, { polling: true });
    this._handlers = {};
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
      return await this.bot.sendMessage(chatId, text, opts);
    } catch (err) {
      if (err.response?.statusCode === 403) {
        console.warn(`TelegramChannel: user ${chatId} blocked the bot`);
      } else {
        throw err;
      }
    }
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
    return this.bot.editMessageText(text, opts);
  }

  async editKeyboard(chatId, messageId, keyboard) {
    return this.bot.editMessageReplyMarkup(
      { inline_keyboard: keyboard },
      { chat_id: chatId, message_id: messageId }
    );
  }

  async answerCallback(queryId, text = '', showAlert = false) {
    return this.bot.answerCallbackQuery({ callback_query_id: queryId, text, show_alert: showAlert });
  }

  // ─── Helpers ───────────────────────────────────────

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
