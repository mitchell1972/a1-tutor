// src/services/DispatchService.js
// Orchestrates daily question dispatch across channels.
// This is the scheduler's entry point into the application layer.
import { checkAccess } from '../domain/SubscriptionValidator.js';
import { TRIAL_DAYS } from '../config/subjects.js';
import { getPlan, PLANS } from '../config/plans.js';

export class DispatchService {
  constructor({ repo, questionService, subscriptionService, paymentService, telegram, whatsapp, whatsappDailyTemplate, whatsappTemplateLang }) {
    this.repo = repo;
    this.questionService = questionService;
    this.subscriptionService = subscriptionService;
    this.paymentService = paymentService;
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
    let access = await this.subscriptionService.getStatus(user.id);
    if (!access.valid) {
      if (access.reason === 'trial_expired') {
        // Saved a card and didn't cancel? Charge their plan now and carry on seamlessly.
        const result = await this.paymentService.autoChargeTrialEnd(user);
        if (result.charged) {
          await this._notifyAutoCharged(user, result.plan, result.endDate);
          access = await this.subscriptionService.getStatus(user.id); // now active
        } else {
          await this.subscriptionService.expireTrial(user.id);
          await this._notifyTrialExpired(user, result.reason);
          return;
        }
      } else {
        return;
      }
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
      await this._dispatchTelegram(user, questions, access);
    }
  }

  // Trial countdown line for the morning message. Card savers are reassured;
  // everyone else is nudged toward saving a card or subscribing before the lock.
  _trialCountdownLine(user, access) {
    if (access?.status !== 'trial') return '';
    const d = access.daysLeft;
    const left = d <= 1 ? '⏳ *Trial ends today!*' : `⏳ Free trial: *${d} days left*.`;
    const tail = (user.card_token && user.autobill_status === 'on')
      ? ` Your ${getPlan(user.autobill_plan)?.label || ''} plan starts automatically after — /cancel anytime.`
      : ' Save a card (/start → 💳) or /subscribe to continue after.';
    return `\n${left}${tail}\n`;
  }

  async _dispatchTelegram(user, questions, access = null) {
    const total = questions.length;
    const subjectCount = user.subjects?.length || 1;
    const perSubject = Math.round(questions.length / Math.max(subjectCount, 1));

    await this.telegram.send(user.telegram_id,
      `🌅 *Good Morning!*\n📚 ${total} questions today (${perSubject} per subject across ${subjectCount} subject${subjectCount > 1 ? 's' : ''}). Answer each to get the next. Good luck! 🚀\n` +
      this._trialCountdownLine(user, access),
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

  async _notifyTrialExpired(user, failReason = null) {
    const chargeFailed = user.card_token && user.autobill_status === 'on' && failReason;
    const msg = (chargeFailed
      ? `⚠️ *Your trial ended and we couldn't charge your saved card.*\n\n`
      : `⏰ *Your ${TRIAL_DAYS}-day free trial has ended!*\n\n`) +
      `Subscribe to continue receiving daily JAMB/SSCE questions:\n` +
      `• ₦${PLANS.weekly.amount}/week\n• ₦${PLANS.monthly.amount.toLocaleString()}/month\n• ₦${PLANS.termly.amount.toLocaleString()} Exam Season Pass (3 months)\n\n` +
      `Pay by card, bank transfer or USSD — type /subscribe to keep learning! 📚`;

    if (user.telegram_id) {
      await this.telegram.sendWithKeyboard(user.telegram_id, msg, [
        [{ text: '💳 Subscribe Now', callback_data: 'menu:subscribe' }],
      ]);
    } else if (user.phone) {
      await this.whatsapp.sendText(user.phone, msg.replace(/\*/g, ''));
    }
  }

  // Card saver's trial just ended and the auto-charge went through.
  async _notifyAutoCharged(user, planId, endDate) {
    const plan = getPlan(planId);
    const msg = `✅ *Welcome aboard!*\n\n` +
      `Your free trial ended, so your saved card was charged ₦${plan ? plan.amount.toLocaleString() : ''} ` +
      `for the ${plan?.label || planId} plan — active until ${new Date(endDate).toLocaleDateString('en-GB')}.\n\n` +
      `Your daily questions continue uninterrupted. 📚 (Manage with /subscribe · /cancel)`;

    if (user.telegram_id) {
      await this.telegram.send(user.telegram_id, msg, { parse_mode: 'Markdown' });
    } else if (user.phone) {
      await this.whatsapp.sendText(user.phone, msg.replace(/\*/g, ''));
    }
  }

  // Card-setup payment landed: confirm enrolment in trial-end auto-billing.
  async notifyCardSaved(userId, planId, last4) {
    const user = await this.repo.getUser(userId);
    if (!user) return;
    const plan = getPlan(planId);

    const msg = `💳 *Card saved${last4 ? ` (•••• ${last4})` : ''}!*\n\n` +
      `When your free trial ends, your ${plan?.label || planId} plan (₦${plan ? plan.amount.toLocaleString() : ''}) ` +
      `starts automatically — no interruption to your daily questions.\n\n` +
      `Changed your mind? Type /cancel any time before the trial ends.`;

    if (user.telegram_id) {
      await this.telegram.send(user.telegram_id, msg, { parse_mode: 'Markdown' });
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
