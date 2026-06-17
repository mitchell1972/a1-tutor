// src/services/DispatchService.js
// Orchestrates daily question dispatch across channels.
// This is the scheduler's entry point into the application layer.
import { checkAccess } from '../domain/SubscriptionValidator.js';
import { TRIAL_DAYS, EXAM_TYPES, daysToExam } from '../config/subjects.js';
import { getPlan, PLANS } from '../config/plans.js';

export class DispatchService {
  constructor({ repo, questionService, subscriptionService, paymentService, telegram, whatsapp, whatsappDailyTemplate, whatsappTemplateLang, adminChatId }) {
    this.repo = repo;
    this.questionService = questionService;
    this.subscriptionService = subscriptionService;
    this.paymentService = paymentService;
    this.telegram = telegram;
    this.whatsapp = whatsapp;
    this.adminChatId = adminChatId || null;
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

  // "📅 218 days to JAMB 2027" — daily urgency, sharper as the exam nears.
  _examCountdownLine(user) {
    const t = daysToExam(user.exam_type);
    if (!t) return '';
    const label = EXAM_TYPES[user.exam_type?.toUpperCase()]?.label || user.exam_type?.toUpperCase();
    const push = t.days <= 30 ? ' — FINAL PUSH! 💪' : t.days <= 90 ? ' — it\'s getting close!' : ' — every day counts.';
    return `📅 *${t.days} days* to ${label} ${t.year}${push}\n`;
  }

  async _dispatchTelegram(user, questions, access = null) {
    const total = questions.length;
    const subjectCount = user.subjects?.length || 1;
    const perSubject = Math.round(questions.length / Math.max(subjectCount, 1));

    await this.telegram.send(user.telegram_id,
      `🌅 *Good Morning!*\n` +
      this._examCountdownLine(user) +
      `📚 ${total} questions today (${perSubject} per subject across ${subjectCount} subject${subjectCount > 1 ? 's' : ''}). Answer each to get the next. Good luck! 🚀\n` +
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

  // ─── Re-engagement nudge ───────────────────────────
  // Re-prompts students who received today's questions but haven't answered any.
  // Wired as an env-gated job (NUDGE_ENABLED); NUDGE_CRON sets the schedule, which may
  // fire more than once a day (e.g. 2pm + 6pm WAT). Idempotent per run-slot — a student
  // is nudged at most once per scheduled run, so extra runs re-remind those still
  // inactive, while a restart can't double-fire the same run. Telegram only.
  async runEngagementNudge() {
    const candidates = await this.repo.getUsersToNudge();
    if (!candidates.length) return { nudged: 0, skipped: 0 };

    // One nudge per run-slot = UTC date + hour. Runs at different hours (e.g. 13:00,
    // 17:00) each get a distinct slot → a still-inactive student gets a repeat nudge;
    // a same-hour re-run (e.g. after a restart) is skipped.
    const now = new Date();
    const slot = `${now.toISOString().slice(0, 10)}:${now.getUTCHours()}`;
    let nudged = 0;
    let skipped = 0;
    for (const user of candidates) {
      try {
        const marker = await this.repo.getSession(`nudge:${user.id}`);
        if (marker?.slot === slot) { skipped++; continue; }

        // Confirm live access — a trial may have lapsed since the morning push.
        const access = await this.subscriptionService.getStatus(user.id);
        if (!access.valid) { skipped++; continue; }

        const sent = await this._sendNudge(user, access);
        if (sent) {
          await this.repo.setSession(`nudge:${user.id}`, { slot });
          nudged++;
          await this._sleep(1500); // gentle pacing, mirrors dispatch
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`Nudge failed for ${user.id}:`, err.message);
      }
    }
    console.log(`🔔 Engagement nudge: ${nudged} sent, ${skipped} skipped (${candidates.length} candidates)`);
    return { nudged, skipped };
  }

  // Re-sends today's first (unanswered) question so a single tap resumes the normal
  // send-on-answer flow. Telegram only — WhatsApp proactive needs an approved template.
  async _sendNudge(user, access) {
    if (!user.telegram_id) return false;

    const dispatches = await this.repo.getTodayDispatches(user.id);
    const ids = dispatches.flatMap(d => d.question_ids || []);
    if (!ids.length) return false;
    const q = await this.repo.getQuestion(ids[0]);
    if (!q) return false;

    const trialLine = access?.status === 'trial'
      ? (access.daysLeft <= 1
          ? ' ⏳ Your free trial ends today — don\'t miss out!'
          : ` ⏳ ${access.daysLeft} days left on your free trial.`)
      : '';
    await this.telegram.send(user.telegram_id,
      `📚 *Your questions are waiting!*\nYou haven't answered today's practice yet — here's your first one. It takes about 2 minutes.${trialLine}`,
      { parse_mode: 'Markdown' });

    const formatted = this.questionService.formatQuestion(q, 0, ids.length);
    const options = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || {});
    await this.telegram.sendWithKeyboard(user.telegram_id,
      `*${formatted.header}*\n\n${formatted.body}`,
      Object.entries(options).map(([key, val]) => ([{
        text: `${key}) ${String(val).length > 40 ? String(val).slice(0, 37) + '...' : val}`,
        callback_data: `answer:${q.id}:${key}`,
      }]))
    );
    return true;
  }

  // ─── Daily sign-up reminder ────────────────────────
  // Once-a-day morning DM to STUDENTS only (never affiliates/partners, never paying users)
  // reminding them of the features and nudging them to sign up. A per-UTC-day marker makes a
  // restart-retry on the same day idempotent. Env-gated (SIGNUP_NUDGE_ENABLED).
  async runSignupNudge() {
    const students = await this.repo.getStudentsToRemind();
    if (!students.length) return { sent: 0, skipped: 0 };

    const day = new Date().toISOString().slice(0, 10);
    let sent = 0;
    let skipped = 0;
    for (const u of students) {
      try {
        const marker = await this.repo.getSession(`signup_nudge:${u.id}`);
        if (marker?.day === day) { skipped++; continue; }   // already reminded today
        await this._sendSignupNudge(u);
        await this.repo.setSession(`signup_nudge:${u.id}`, { day });
        sent++;
        await this._sleep(1500); // gentle pacing
      } catch (err) {
        console.error(`Signup reminder failed for ${u.id}:`, err.message);
      }
    }
    console.log(`📣 Signup reminder: ${sent} sent, ${skipped} skipped (${students.length} students)`);
    return { sent, skipped };
  }

  async _sendSignupNudge(user) {
    const text =
      `🌅 *Good morning!* Your A1 Tutor account is ready and waiting.\n\n` +
      `Everything you need for JAMB, WAEC, NECO & Post-UTME:\n` +
      `✅ 9,000+ practice questions across 30+ subjects\n` +
      `📅 Real past papers — practise by year (e.g. JAMB Physics 2023)\n` +
      `💡 A clear, step-by-step explanation on every question\n` +
      `📝 Timed mock exams, daily practice & AI coaching\n\n` +
      `Sign up for full access and keep your prep on track 👇`;
    return this.telegram.sendWithKeyboard(user.telegram_id, text, [
      [{ text: '💳 See plans & sign up', callback_data: 'menu:subscribe' }],
    ]);
  }

  // ─── Affiliate daily digest ────────────────────────
  // Messages each affiliate whose link has pulled at least one signup their headline
  // numbers (signups, paying, earnings) on Telegram. Env-gated (AFFILIATE_DIGEST_ENABLED).
  async runAffiliateDigest() {
    if (typeof this.repo.getAffiliatesForDigest !== 'function') return { sent: 0, skipped: 0 };
    const affiliates = await this.repo.getAffiliatesForDigest();
    if (!affiliates.length) return { sent: 0, skipped: 0 };

    let sent = 0;
    let skipped = 0;
    for (const a of affiliates) {
      try {
        // Only ping partners whose link has actually pulled signups — no spamming dormant ones.
        if (!a.referred || !a.telegram_id) { skipped++; continue; }
        await this._sendAffiliateDigest(a);
        sent++;
        await this._sleep(1500);
      } catch (err) {
        console.error(`Affiliate digest failed for ${a.id}:`, err.message);
      }
    }
    console.log(`📊 Affiliate digest: ${sent} sent, ${skipped} skipped (${affiliates.length} affiliates)`);
    return { sent, skipped };
  }

  // ─── Daily payment reconciliation ──────────────────
  // Safety net for dropped webhooks: re-checks Flutterwave's successful payments
  // against the subscriptions table, auto-activates any the webhook missed, and
  // alerts the admin. Env-gated (RECONCILE_ENABLED).
  async runPaymentReconciliation() {
    const r = await this.paymentService.reconcile({ autoFix: true });
    if (r.missing > 0 && this.adminChatId) {
      const lines = r.gaps.map(g =>
        `• ${g.txRef} (₦${g.amount}) — ${g.fixed ? 'auto-activated ✅' : 'NEEDS ATTENTION: ' + g.reason}`);
      const msg = `⚠️ *Payment reconciliation*\n` +
        `${r.checked} checked · ${r.missing} not recorded · ${r.fixed} auto-fixed · ${r.failed} failed\n\n` +
        lines.join('\n');
      try { await this.telegram.send(this.adminChatId, msg, { parse_mode: 'Markdown' }); }
      catch (err) { console.error('Reconciliation admin alert failed:', err.message); }
    }
    console.log(`💳 Reconciliation: ${r.checked} checked, ${r.missing} missing, ${r.fixed} fixed, ${r.failed} failed`);
    return r;
  }

  async _sendAffiliateDigest(a) {
    if (!a.telegram_id) return;
    const lines = [
      `📊 *Your A1 Tutor partner update*`,
      ``,
      `👥 Students joined via your link: *${a.referred}*`,
      `🟢 Currently paying: *${a.paying}*`,
    ];
    if (a.earned > 0) lines.push(`💰 Earned so far: *₦${a.earned.toLocaleString()}*`);
    if (a.pending > 0) lines.push(`⏳ Pending payout: *₦${a.pending.toLocaleString()}*`);
    lines.push(``, `Keep sharing your link to grow this! Full details anytime with /affiliate.`);
    await this.telegram.send(a.telegram_id, lines.join('\n'), { parse_mode: 'Markdown' });
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
