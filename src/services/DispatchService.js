// src/services/DispatchService.js
// Orchestrates daily question dispatch across channels.
// This is the scheduler's entry point into the application layer.
import { checkAccess } from '../domain/SubscriptionValidator.js';

export class DispatchService {
  constructor({ repo, questionService, subscriptionService, telegram, whatsapp, whatsappDailyTemplate, whatsappTemplateLang }) {
    this.repo = repo;
    this.questionService = questionService;
    this.subscriptionService = subscriptionService;
    this.telegram = telegram;
    this.whatsapp = whatsapp;
    // Phase 2: approved Meta template used for the proactive daily push.
    this.whatsappDailyTemplate = whatsappDailyTemplate || null;
    this.whatsappTemplateLang = whatsappTemplateLang || 'en';
  }

  /**
   * Called by the scheduler every minute with current WAT hour/minute.
   */
  async dispatchAt(hour, minute) {
    const dueUsers = await this.repo.getUsersDueForDelivery(hour, minute);
    if (dueUsers.length === 0) return;

    console.log(`📤 Dispatching to ${dueUsers.length} users at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} WAT`);

    for (const user of dueUsers) {
      try {
        await this._dispatchToUser(user);
        await this._sleep(2000); // gap between users
      } catch (err) {
        console.error(`Dispatch failed for ${user.id}:`, err.message);
      }
    }
  }

  async _dispatchToUser(user) {
    // Check already dispatched today
    if (await this.questionService.isAlreadyDispatchedToday(user.id)) return;

    // Check access (trial or paid)
    const access = await this.subscriptionService.getStatus(user.id);
    if (!access.valid) {
      if (access.reason === 'trial_expired') {
        await this.subscriptionService.expireTrial(user.id);
        await this._notifyTrialExpired(user);
      }
      return;
    }

    // WhatsApp: proactive sends outside Meta's 24-hour window need an approved
    // template. Send the template prompt and generate questions only when the
    // student taps "Start" (handled by WhatsAppBotAdapter) — so we never burn
    // questions on a push the student never opens.
    if (user.channel === 'whatsapp' && user.phone) {
      if (this.whatsappDailyTemplate) {
        await this.whatsapp.sendTemplate(user.phone, this.whatsappDailyTemplate, this.whatsappTemplateLang);
        return;
      }
      // No template configured — only works inside the 24h window (e.g. testing).
      console.warn(`WhatsApp daily template not set (WHATSAPP_DAILY_TEMPLATE) — attempting direct send to ${user.id}; will fail outside the 24h window.`);
      const questions = await this.questionService.generateDailySet(user);
      if (questions.length) {
        await this.whatsapp.sendText(user.phone, `📚 Daily Drill — ${questions.length} questions. Answer each to get the next!`);
        await this.whatsapp.sendQuestion(user.phone, questions[0], 0, questions.length);
      }
      return;
    }

    // Telegram: send directly.
    if (user.telegram_id) {
      const questions = await this.questionService.generateDailySet(user);
      if (questions.length === 0) {
        console.warn(`No questions available for ${user.id}`);
        return;
      }
      await this._dispatchTelegram(user, questions);
    }
  }

  async _dispatchTelegram(user, questions) {
    const total = questions.length;
    const subjectCount = user.subjects?.length || 1;
    const perSubject = Math.round(questions.length / Math.max(subjectCount, 1));

    await this.telegram.send(user.telegram_id,
      `🌅 *Good Morning!*\n📚 ${total} questions today (${perSubject} per subject across ${subjectCount} subject${subjectCount > 1 ? 's' : ''}). Answer each to get the next. Good luck! 🚀`,
      { parse_mode: 'Markdown' }
    );

    // Send-on-answer: only the first question goes out now; the rest follow as
    // the student answers (TelegramBotAdapter._onAnswer). Keeps the 7am burst
    // to one message per student.
    const q = questions[0];
    const formatted = this.questionService.formatQuestion(q, 0, total);
    const options = q.options || {};
    await this.telegram.sendWithKeyboard(
      user.telegram_id,
      `*${formatted.header}*\n\n${formatted.body}`,
      Object.entries(options).map(([key, val]) => ([{
        text: `${key}) ${val.length > 40 ? val.slice(0, 37) + '...' : val}`,
        callback_data: `answer:${q.id}:${key}`,
      }]))
    );
  }

  async _notifyTrialExpired(user) {
    const msg = `⏰ *Your 5-day free trial has ended!*\n\n` +
      `Subscribe to continue receiving daily JAMB/SSCE questions:\n` +
      `• ₦500/week\n• ₦1,500/month\n• ₦4,000/3 months\n\n` +
      `Type /subscribe to keep learning! 📚`;

    if (user.telegram_id) {
      await this.telegram.sendWithKeyboard(user.telegram_id, msg, [
        [{ text: '💳 Subscribe Now', callback_data: 'menu:subscribe' }],
      ]);
    } else if (user.phone) {
      await this.whatsapp.sendText(user.phone, msg.replace(/\*/g, ''));
    }
  }

  async notifyPaymentConfirmed(userId, plan, endDate) {
    const user = await this.repo.getUser(userId);
    if (!user) return;

    const msg = `✅ *Payment Confirmed!*\n\n` +
      `Your ${plan} plan is active until ${new Date(endDate).toLocaleDateString('en-GB')}.\n` +
      `Daily questions will arrive at your scheduled time. 📚`;

    if (user.telegram_id) {
      await this.telegram.send(user.telegram_id, msg, { parse_mode: 'Markdown' });
    } else if (user.phone) {
      await this.whatsapp.sendText(user.phone, msg.replace(/\*/g, ''));
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
