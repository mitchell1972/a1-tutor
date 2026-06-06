// src/services/DispatchService.js
// Orchestrates daily question dispatch across channels.
// This is the scheduler's entry point into the application layer.
import { checkAccess } from '../domain/SubscriptionValidator.js';

export class DispatchService {
  constructor({ repo, questionService, subscriptionService, telegram, whatsapp }) {
    this.repo = repo;
    this.questionService = questionService;
    this.subscriptionService = subscriptionService;
    this.telegram = telegram;
    this.whatsapp = whatsapp;
  }

  /**
   * Called by the scheduler every minute with current WAT hour/minute.
   */
  async dispatchAt(hour, minute) {
    const dueUsers = this.repo.getUsersDueForDelivery(hour, minute);
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
    if (this.questionService.isAlreadyDispatchedToday(user.id)) return;

    // Check access (trial or paid)
    const access = this.subscriptionService.getStatus(user.id);
    if (!access.valid) {
      if (access.reason === 'trial_expired') {
        this.subscriptionService.expireTrial(user.id);
        await this._notifyTrialExpired(user);
      }
      return;
    }

    // Generate questions
    const questions = this.questionService.generateDailySet(user);
    if (questions.length === 0) {
      console.warn(`No questions available for ${user.id}`);
      return;
    }

    // Dispatch
    if (user.channel === 'whatsapp' && user.phone) {
      await this._dispatchWhatsApp(user, questions);
    } else if (user.telegram_id) {
      await this._dispatchTelegram(user, questions);
    }
  }

  async _dispatchTelegram(user, questions) {
    const total = questions.length;

    const subjectCount = user.subjects?.length || 1;
    const perSubject = questions.length / Math.max(subjectCount, 1);

    await this.telegram.send(user.telegram_id,
      `🌅 *Good Morning!*\n📚 Your daily questions are here: ${Math.round(perSubject)} per subject across ${subjectCount} subject${subjectCount > 1 ? 's' : ''}. Good luck! 🚀`,
      { parse_mode: 'Markdown' }
    );

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const formatted = this.questionService.formatQuestion(q, i, total);
      const options = q.options || {};

      await this.telegram.sendWithKeyboard(
        user.telegram_id,
        `*${formatted.header}*\n\n${formatted.body}`,
        Object.entries(options).map(([key, val]) => ([{
          text: `${key}) ${val.length > 40 ? val.slice(0, 37) + '...' : val}`,
          callback_data: `answer:${q.id}:${key}:${i}:${total}`,
        }]))
      );

      if (i < total - 1) await this._sleep(3000);
    }
  }

  async _dispatchWhatsApp(user, questions) {
    await this.whatsapp.sendBatch(user.phone, questions);
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
    const user = this.repo.getUser(userId);
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
