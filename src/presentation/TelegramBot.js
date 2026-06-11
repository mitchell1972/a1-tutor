// src/presentation/TelegramBot.js
// Presentation adapter: handles Telegram I/O. Delegates ALL business logic to services.
// Thin, testable, replaceable.
import { SUBJECTS, SUBJECT_PRESETS, EXAM_TYPES, QUESTIONS_PER_SUBJECT, TRIAL_DAYS } from '../config/subjects.js';
import { PLANS, getPlan, AFFILIATE_PERCENT } from '../config/plans.js';

export class TelegramBotAdapter {
  constructor({ channel, userService, questionService, subscriptionService, paymentService, dispatchService, analyticsService, coachService, adminChatId }) {
    this.tg = channel;
    this.adminChatId = adminChatId ? String(adminChatId) : null;
    this.userService = userService;
    this.questionService = questionService;
    this.subscriptionService = subscriptionService;
    this.paymentService = paymentService;
    this.dispatchService = dispatchService;
    this.analyticsService = analyticsService;
    this.coachService = coachService;

    this._registerHandlers();
  }

  // Registration state lives in the repository, so it survives restarts and is
  // shared across instances (keyed by Telegram chat id).
  _getSession(chatId) { return this.userService.repo.getSession('tg:' + chatId); }
  _setSession(chatId, data) { return this.userService.repo.setSession('tg:' + chatId, data); }
  _clearSession(chatId) { return this.userService.repo.deleteSession('tg:' + chatId); }

  // ─── Handler Registration ──────────────────────────

  _registerHandlers() {
    this.tg.onText(/\/start/, this._handleStart.bind(this));
    this.tg.onText(/\/drill/, this._handleDrillCmd.bind(this));
    this.tg.onText(/\/stats/, this._handleStatsCmd.bind(this));
    this.tg.onText(/\/subscribe/, this._handleSubscribeCmd.bind(this));
    this.tg.onText(/\/cancel/, this._handleCancelCmd.bind(this));
    this.tg.onText(/\/coach/, this._handleCoachCmd.bind(this));
    this.tg.onText(/\/refs/, this._handleRefsCmd.bind(this));
    this.tg.onText(/\/affiliate/, this._handleAffiliateCmd.bind(this));
    this.tg.onText(/\/bank (.+)/, this._handleBankCmd.bind(this));
    this.tg.onText(/\/payouts(.*)/, this._handlePayoutsCmd.bind(this));
    this.tg.onCallback(this._handleCallback.bind(this));
  }

  // ─── /start ────────────────────────────────────────

  async _handleStart(msg) {
    const chatId = msg.chat.id;
    // Deep-link payload ("/start ref_jambpast" from t.me/Bot?start=ref_jambpast) —
    // the campaign tag for ad tracking. Sanitised; first touch wins at registration.
    const refPayload = (String(msg.text || '').match(/^\/start\s+([A-Za-z0-9_-]{1,32})/) || [])[1] || null;
    const result = await this.userService.startRegistration(chatId);

    if (result.isReturning) {
      const user = result.user;
      const profile = await this.userService.getProfile(user.id);
      const subStatus = await this.subscriptionService.getStatus(user.id);

      const statusEmoji = subStatus.status === 'active' ? '🟢' :
        subStatus.status === 'trial' ? '🟡' : '🔴';

      const daysInfo = subStatus.status === 'trial'
        ? `\n🎁 Trial: ${subStatus.daysLeft} of ${TRIAL_DAYS} days left`
        : subStatus.status === 'active'
          ? `\n📅 Active until: ${new Date(subStatus.subscriptionEndDate).toLocaleDateString('en-GB')}`
          : '';

      await this.tg.sendWithKeyboard(chatId,
        `👋 *Welcome back, Scholar!*\n\n` +
        `📚 Exam: ${profile.examType}\n` +
        `📖 Subjects: ${profile.subjects.map(s => `${s.icon} ${s.name}`).join(', ')}\n` +
        `⏰ Delivery: ${profile.deliveryTime}\n` +
        `${statusEmoji} Status: ${profile.subscriptionStatus}${daysInfo}\n\n` +
        `What would you like to do?`,
        this._mainMenuKeyboard(user)
      );
      return;
    }

    // New user
    await this._setSession(chatId, { step: 'exam_type', telegramId: chatId, ref: refPayload });

    await this.tg.sendWithKeyboard(chatId,
      `🎓 *Welcome to ExamPrep Bot!*\n\n` +
      `I'll send you ${QUESTIONS_PER_SUBJECT} questions per subject, every day.\n\n` +
      `*First — what are you preparing for?*`,
      [
        [{ text: '🎓 JAMB/UTME', callback_data: 'exam:jamb' }],
        [{ text: '📝 WAEC/SSCE', callback_data: 'exam:ssce' }],
        [{ text: '🏫 NECO', callback_data: 'exam:neco' }],
        [{ text: '🏥 Post-UTME Screening', callback_data: 'exam:post_utme' }],
        [{ text: '🎓 University GST (100L)', callback_data: 'exam:gst' }],
        [{ text: '📚 Departmental Courses', callback_data: 'exam:squad' }],
      ]
    );
  }

  // ─── Callback Router ───────────────────────────────

  async _handleCallback(query) {
    const chatId = query.message.chat.id;
    const data = query.data;
    const queryId = query.id;

    try {
      await this.tg.answerCallback(queryId);

      if (data.startsWith('exam:'))     await this._onExam(chatId, data.split(':')[1], query.message.message_id);
      else if (data.startsWith('preset:')) await this._onPreset(chatId, data.split(':')[1], query.message.message_id);
      else if (data.startsWith('subject:')) await this._onSubjectToggle(chatId, data.split(':')[1], query.message.message_id, queryId);
      else if (data === 'subjects:done') await this._onSubjectsDone(chatId, query.message.message_id, queryId);
      else if (data.startsWith('time:'))  await this._onTime(chatId, data.split(':').slice(1), query.message.message_id);
      else if (data.startsWith('menu:'))  await this._onMenu(chatId, data.split(':')[1]);
      else if (data.startsWith('plan:'))  await this._onPlan(chatId, data.split(':')[1]);
      else if (data.startsWith('autobill:')) await this._onAutobillPlan(chatId, data.split(':')[1]);
      else if (data === 'aff:join') await this._onAffiliateJoin(chatId);
      else if (data === 'aff:menu') await this._handleAffiliateCmd({ chat: { id: chatId } });
      else if (data.startsWith('answer:')) await this._onAnswer(chatId, data, query.message.message_id);

    } catch (err) {
      console.error('Callback error:', err);
      this.tg.send(chatId, '⚠️ Something went wrong. Please /start again.');
    }
  }

  // ─── Registration Steps ────────────────────────────

  async _onExam(chatId, examType, msgId) {
    const session = await this._getSession(chatId);
    session.exam_type = examType;
    session.step = 'subjects';

    // Set compulsory subject based on exam type
    const examCfg = EXAM_TYPES[examType?.toUpperCase()];
    const compulsory = examCfg?.compulsorySubject;

    if (compulsory) {
      session.selectedSubjects = [compulsory];
    } else {
      session.selectedSubjects = [];
    }

    // Filter presets relevant to this exam type
    const presets = this.userService.getPresets();
    const isUniversity = ['post_utme','gst','squad'].includes(examType);
    const relevantPresets = Object.entries(presets).filter(([key]) =>
      isUniversity ? key.startsWith('uni_') : !key.startsWith('uni_')
    );

    const keyboard = relevantPresets.map(([k, v]) => ([{ text: v.label, callback_data: `preset:${k}` }]));
    keyboard.push([{ text: '🔧 Custom Selection', callback_data: 'preset:custom' }]);

    const compulsoryMsg = compulsory
      ? `${SUBJECTS[compulsory]?.icon || ''} ${SUBJECTS[compulsory]?.name || compulsory} is automatically included.\n`
      : '';

    await this._setSession(chatId, session);
    await this.tg.editMessage(chatId, msgId,
      `*Choose your subject combination:*\n\n` +
      `${compulsoryMsg}Pick your subjects (${compulsory ? '3-4' : '4-6'} recommended).`,
      keyboard
    );
  }

  async _onPreset(chatId, preset, msgId) {
    const session = await this._getSession(chatId);
    if (preset !== 'custom') {
      const presetSubjects = SUBJECT_PRESETS[preset]?.subjects || [];
      session.selectedSubjects = [...new Set(presetSubjects)];
      session.step = 'delivery_time';
      await this._setSession(chatId, session);

      const names = session.selectedSubjects.map(s => `${SUBJECTS[s]?.icon} ${SUBJECTS[s]?.name}`).join('\n');
      await this.tg.editMessage(chatId, msgId,
        `*Your subjects:*\n${names}\n\n*When should I send your daily questions?* (West Africa Time)`,
        this._timeKeyboard()
      );
      return;
    }

    session.selectedSubjects = ['english'];
    await this._setSession(chatId, session);
    await this.tg.editMessage(chatId, msgId,
      `*Select your subjects:*\n\nTap to toggle. English is compulsory. Choose 3-4 total.`,
      this._subjectKeyboard(session.selectedSubjects)
    );
  }

  async _onSubjectToggle(chatId, subjectId, msgId, queryId) {
    if (subjectId === 'english') return;
    const session = await this._getSession(chatId);
    if (!session.selectedSubjects) session.selectedSubjects = ['english'];

    if (session.selectedSubjects.includes(subjectId)) {
      session.selectedSubjects = session.selectedSubjects.filter(s => s !== subjectId);
    } else {
      if (session.selectedSubjects.length >= 6) {
        return this.tg.answerCallback(queryId, 'Maximum 6 subjects!', true);
      }
      session.selectedSubjects.push(subjectId);
    }

    await this._setSession(chatId, session);
    await this.tg.editKeyboard(chatId, msgId, this._subjectKeyboard(session.selectedSubjects));
  }

  async _onSubjectsDone(chatId, msgId, queryId) {
    const session = await this._getSession(chatId);
    if (!session.selectedSubjects || session.selectedSubjects.length < 2) {
      return this.tg.answerCallback(queryId, 'Select at least 2 subjects!', true);
    }

    session.step = 'delivery_time';
    await this._setSession(chatId, session);
    const names = session.selectedSubjects.map(s => `${SUBJECTS[s]?.icon} ${SUBJECTS[s]?.name}`).join('\n');
    await this.tg.editMessage(chatId, msgId,
      `*Your subjects:*\n${names}\n\n*When should I send your daily questions?* (West Africa Time)`,
      this._timeKeyboard()
    );
  }

  async _onTime(chatId, timeParts, msgId) {
    const session = await this._getSession(chatId);
    const [hour, minute] = timeParts.map(Number);
    session.delivery_hour = hour;
    session.delivery_minute = minute;

    // WhatsApp is now its own front door (students register there directly),
    // so the Telegram bot always registers Telegram delivery — no channel step.
    const user = await this.userService.registerUser({
      telegramId: chatId,
      examType: session.exam_type,
      subjects: session.selectedSubjects,
      deliveryHour: session.delivery_hour,
      deliveryMinute: session.delivery_minute,
      channel: 'telegram',
      refSource: session.ref || null,
    });

    await this._clearSession(chatId);

    const subjectNames = user.subjects.map(s => `${SUBJECTS[s]?.icon} ${SUBJECTS[s]?.name}`).join(', ');
    const timeStr = `${String(user.delivery_hour).padStart(2, '0')}:${String(user.delivery_minute).padStart(2, '0')} WAT`;

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

    await this.tg.editMessage(chatId, msgId,
      `🎉 *You're all set, Scholar!*\n\n` +
      `📚 Exam: ${EXAM_TYPES[session.exam_type?.toUpperCase()]?.label}\n` +
      `📖 Subjects: ${subjectNames}\n` +
      `⏰ Delivery: Daily at ${timeStr}\n\n` +
      `🎁 *${TRIAL_DAYS}-Day Free Trial* — ends ${trialEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}\n` +
      `I'll count down your trial each day. Save a card now and your plan starts automatically when the trial ends (cancel anytime with /cancel) — or just pay later by card, transfer or USSD.\n\n` +
      `Start now with a practice round?`,
      [
        [{ text: '🎯 Start Practice Drill Now', callback_data: 'menu:drill' }],
        [{ text: '💳 Save card — auto-start after trial', callback_data: 'menu:savecard' }],
        [{ text: '💰 See plans', callback_data: 'menu:subscribe' }],
      ]
    );
  }

  // ─── Menu ──────────────────────────────────────────

  async _onMenu(chatId, action) {
    const user = await this.userService.repo.getUserByTelegram(chatId);
    if (!user) return this.tg.send(chatId, 'Please /start first!');

    switch (action) {
      case 'drill':     return this._startDrill(chatId, user);
      case 'stats':     return this._showStats(chatId, user);
      case 'subscribe': return this._showSubscription(chatId, user);
      case 'savecard':  return this._showSaveCard(chatId, user);
      case 'coach':     return this._sendCoachNote(chatId, user);
      case 'help':      return this._showHelp(chatId, user);
      case 'main':
      default:          return this.tg.sendWithKeyboard(chatId, '📋 Main Menu', this._mainMenuKeyboard(user));
    }
  }

  // ─── Save card (trial-end auto-billing) ─────────────

  async _showSaveCard(chatId, user) {
    if (user.card_token && user.autobill_status === 'on') {
      return this.tg.send(chatId,
        `💳 Card already saved${user.card_last4 ? ` (•••• ${user.card_last4})` : ''} — your ` +
        `*${user.autobill_plan}* plan starts automatically when your trial ends.\n/cancel to stop it.`,
        { parse_mode: 'Markdown' });
    }
    await this.tg.sendWithKeyboard(chatId,
      `💳 *Save a card for after your trial*\n\n` +
      `Pick the plan to start automatically when your free trial ends. ` +
      `A one-time ₦100 card check applies now; you can /cancel before the trial ends and you won't be charged again.`,
      [
        ...['weekly', 'monthly', 'termly'].map(id =>
          [{ text: `₦${PLANS[id].amount.toLocaleString()} — ${PLANS[id].label}`, callback_data: `autobill:${id}` }]),
        [{ text: '« Back', callback_data: 'menu:main' }],
      ]
    );
  }

  async _onAutobillPlan(chatId, planId) {
    const user = await this.userService.repo.getUserByTelegram(chatId);
    if (!user) return;

    try {
      const { link } = await this.paymentService.createCardSetupLink(user.id, planId);
      await this.tg.send(chatId,
        `💳 *Save your card*\n\n` +
        `Tap below to complete the one-time ₦100 card check. ` +
        `Your plan then starts automatically when your free trial ends — /cancel anytime before that.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Save card (₦100 one-time)', url: link }],
              [{ text: '« Back to plans', callback_data: 'menu:savecard' }],
            ],
          },
        }
      );
    } catch (err) {
      console.error('Card setup link failed:', err);
      await this.tg.send(chatId, '⚠️ Card service temporarily unavailable. Try again later.');
    }
  }

  async _handleCancelCmd(msg) {
    const user = await this.userService.repo.getUserByTelegram(msg.chat.id);
    if (!user) return this.tg.send(msg.chat.id, 'Please /start first!');

    if (user.card_token && user.autobill_status === 'on') {
      await this.paymentService.cancelAutobill(user.id);
      return this.tg.send(msg.chat.id,
        `✅ *Auto-billing cancelled.*\n\nYour card will NOT be charged when the trial ends. ` +
        `Your trial (and any active plan) runs to its end date — after that, /subscribe to continue. ` +
        `You can re-enable anytime from /start → 💳.`,
        { parse_mode: 'Markdown' });
    }
    return this.tg.send(msg.chat.id,
      `Nothing to cancel — no auto-billing is set up. ` +
      `Subscriptions here are pay-as-you-go: when your current access ends, you simply choose whether to pay again. ` +
      `Check /subscribe for your status.`);
  }

  // ─── Drill ─────────────────────────────────────────

  async _startDrill(chatId, user) {
    const access = await this.subscriptionService.getStatus(user.id);
    if (!access.valid) {
      return this.tg.sendWithKeyboard(chatId,
        '🔒 Access required. Subscribe to continue:',
        this._plansKeyboard(user.id)
      );
    }

    if (await this.questionService.isAlreadyDispatchedToday(user.id)) {
      return this.tg.sendWithKeyboard(chatId,
        '✅ You\'ve already completed today\'s drill!\nCome back tomorrow.',
        this._mainMenuKeyboard(user)
      );
    }

    const questions = await this.questionService.generateDailySet(user);
    if (!questions.length) {
      return this.tg.sendWithKeyboard(chatId,
        '⚠️ No questions available right now. Try again later.',
        this._mainMenuKeyboard(user)
      );
    }

    await this.tg.send(chatId,
      `📚 *Starting Your Drill*\n${questions.length} questions — answer each to get the next. Good luck! 🚀`,
      { parse_mode: 'Markdown' }
    );

    // Send-on-answer: send only the first question; the rest follow as answers
    // come in. This keeps the 7am burst to one message per student.
    await this._sendQuestion(chatId, questions[0], 0, questions.length);
  }

  async _sendQuestion(chatId, question, index, total) {
    const formatted = this.questionService.formatQuestion(question, index, total);
    const opts = question.options || {};
    await this.tg.sendWithKeyboard(chatId,
      `*${formatted.header}*\n\n${formatted.body}`,
      Object.entries(opts).map(([k, v]) => ([{
        text: `${k}) ${v.length > 40 ? v.slice(0, 37) + '...' : v}`,
        callback_data: `answer:${question.id}:${k}`,
      }]))
    );
  }

  async _handleDrillCmd(msg) {
    const user = await this.userService.repo.getUserByTelegram(msg.chat.id);
    if (!user) return this.tg.send(msg.chat.id, 'Please /start first!');
    return this._startDrill(msg.chat.id, user);
  }

  // ─── Answer ────────────────────────────────────────

  async _onAnswer(chatId, data, messageId) {
    const parts = data.split(':');
    const questionId = parts[1];
    const chosenAnswer = parts[2];

    const user = await this.userService.repo.getUserByTelegram(chatId);
    if (!user) return;
    const result = await this.questionService.processAnswer(user.id, questionId, chosenAnswer);
    if (result.error) return;

    // Remove the answered question's buttons so it can't be tapped twice.
    if (messageId) {
      try { await this.tg.editKeyboard(chatId, messageId, []); } catch { /* message too old; ignore */ }
    }

    const feedback = this.questionService.formatFeedback(result);
    const { question: next, index, total } = await this.questionService.getNextQuestion(user.id, questionId);
    const progress = await this.questionService.getCumulativeProgress(user.id, total);

    await this.tg.send(chatId,
      `${feedback}\n\n📊 So far: ${progress.correct}/${progress.answered} correct`,
      { parse_mode: 'Markdown' }
    );

    if (next) {
      await this.tg.sleep(400);
      await this._sendQuestion(chatId, next, index, total);
    } else {
      await this.tg.sleep(600);
      const today = new Date().toISOString().split('T')[0];
      const todayResponses = await this.userService.repo.getResponsesByDate(user.id, today);
      const report = await this.questionService.formatDailyReport(user.id, todayResponses);
      await this.tg.send(chatId, report, { parse_mode: 'Markdown' });
    }
  }

  // ─── Stats ─────────────────────────────────────────

  async _showStats(chatId, user) {
    const analytics = await this.analyticsService.getUserAnalytics(user.id);
    if (!analytics) return;

    const weekSummary = analytics.trend.map(t =>
      `• ${t.day}: ${t.total > 0 ? `${t.score}% (${t.correct}/${t.total})` : '—'}`
    ).join('\n');

    let msg = `📊 *Your Stats*\n\n`;
    msg += `🔥 Streak: ${analytics.streak} day${analytics.streak !== 1 ? 's' : ''}\n`;
    msg += `📅 Today: ${analytics.today.total > 0 ? `${analytics.today.score}% (${analytics.today.correct}/${analytics.today.total})` : 'Not yet started'}\n\n`;

    // Exam readiness — the confidence meter (coverage × accuracy across the syllabus)
    const readiness = Object.values(analytics.readiness || {}).filter(r => r.coverage > 0);
    if (readiness.length) {
      msg += `*🎓 Exam readiness:*\n`;
      for (const r of readiness) {
        const bar = '▓'.repeat(Math.round(r.score / 10)) + '░'.repeat(10 - Math.round(r.score / 10));
        msg += `${bar} ${r.score}% — ${r.name}\n`;
      }
      msg += `_Readiness grows with both accuracy AND syllabus coverage._\n\n`;
    }

    msg += `*This Week:*\n${weekSummary}\n`;

    if (analytics.weakAreas.length > 0) {
      msg += `\n*Areas to improve (I'm already drilling you harder on these):*\n`;
      analytics.weakAreas.forEach(a => {
        msg += `• ${SUBJECTS[a.subject]?.name || a.subject}: ${a.topic.replace(/_/g, ' ')} (${a.accuracy}%)\n`;
      });
    }

    await this.tg.sendWithKeyboard(chatId, msg, this._mainMenuKeyboard(user));
  }

  // ─── AI Coach ──────────────────────────────────────

  async _sendCoachNote(chatId, user) {
    if (!this.coachService) return this.tg.send(chatId, '🧑‍🏫 Coach is not available right now.');
    await this.tg.send(chatId, '🧑‍🏫 Looking at your progress…');

    const { limited, note } = await this.coachService.onDemandNote(user);
    if (limited) {
      return this.tg.send(chatId, '🧑‍🏫 You already had a coach note today — practise some questions and ask me again tomorrow!');
    }
    if (!note) {
      return this.tg.send(chatId, '🧑‍🏫 Answer a few more questions first (at least 5) so I have something to coach you on — then try /coach again.');
    }
    await this.tg.send(chatId, `🧑‍🏫 *Coach's note*\n\n${note}`, { parse_mode: 'Markdown' });
  }

  // ─── Affiliate programme ───────────────────────────

  async _handleAffiliateCmd(msg) {
    const chatId = msg.chat.id;
    const user = await this.userService.repo.getUserByTelegram(chatId);
    if (!user) return this.tg.send(chatId, 'Please /start first!');
    if (typeof this.userService.repo.getAffiliateByUser !== 'function') {
      return this.tg.send(chatId, 'Affiliate programme not available right now.');
    }

    const aff = await this.userService.repo.getAffiliateByUser(user.id);
    if (!aff) {
      return this.tg.sendWithKeyboard(chatId,
        `🤝 *Earn with A1 Tutor*\n\n` +
        `Share your personal link and earn *${AFFILIATE_PERCENT}% of every payment* your students make — ` +
        `not once, but *every time they renew, for life*.\n\n` +
        `Example: refer 20 students on the ₦${PLANS.monthly.amount.toLocaleString()}/month plan and earn ` +
        `₦${(20 * Math.round(PLANS.monthly.amount * AFFILIATE_PERCENT / 100)).toLocaleString()} *every month* they stay subscribed.\n\n` +
        `Payouts monthly to your Nigerian bank account (₦5,000 minimum).`,
        [[{ text: '✅ Join the programme', callback_data: 'aff:join' }],
         [{ text: '« Back', callback_data: 'menu:main' }]]
      );
    }

    const e = await this.userService.repo.getAffiliateEarnings(aff.id, aff.tag);
    const bank = aff.account_number
      ? `${aff.bank_name} ••${String(aff.account_number).slice(-4)} (${aff.account_name})`
      : '⚠️ not set — send: /bank BankName AccountNumber Account Name';
    await this.tg.send(chatId,
      `🤝 *Your affiliate dashboard*\n\n` +
      `🔗 Your link:\n\`https://t.me/A1TutorPrep_bot?start=${aff.tag}\`\n\n` +
      `👥 Students referred: ${e.referred}\n` +
      `🟢 Currently paying: ${e.paying}\n` +
      `💰 Lifetime earned: ₦${e.earned.toLocaleString()}\n` +
      `⏳ Pending payout: ₦${e.pending.toLocaleString()}\n` +
      `🏦 Bank: ${bank}\n\n` +
      `You earn ${aff.percent}% of every payment your students make, forever. Share your link anywhere — channels, groups, status.`,
      { parse_mode: 'Markdown' });
  }

  async _onAffiliateJoin(chatId) {
    const user = await this.userService.repo.getUserByTelegram(chatId);
    if (!user) return;
    const existing = await this.userService.repo.getAffiliateByUser(user.id);
    if (existing) return this._handleAffiliateCmd({ chat: { id: chatId } });

    // Short unique tag; retry on the (unlikely) collision.
    let aff = null;
    for (let i = 0; i < 5 && !aff; i++) {
      const tag = 'p_' + Math.random().toString(36).slice(2, 8);
      if (await this.userService.repo.getAffiliateByTag(tag)) continue;
      aff = await this.userService.repo.createAffiliate({
        user_id: user.id, name: user.name || null, tag, percent: AFFILIATE_PERCENT,
      });
    }
    if (!aff) return this.tg.send(chatId, '⚠️ Could not create your affiliate account. Try again.');

    await this.tg.send(chatId,
      `🎉 *You're in!*\n\n` +
      `🔗 Your personal link:\n\`https://t.me/A1TutorPrep_bot?start=${aff.tag}\`\n\n` +
      `Share it in channels, class groups, WhatsApp status — anywhere students are. ` +
      `Every student who joins through it is yours: you earn *${aff.percent}% of every payment they ever make*.\n\n` +
      `🏦 To receive payouts, add your bank details:\n\`/bank BankName AccountNumber Account Name\`\n` +
      `e.g. \`/bank Opay 8012345678 Chidi Okafor\`\n\n` +
      `Track everything anytime with /affiliate.`,
      { parse_mode: 'Markdown' });
  }

  async _handleBankCmd(msg, match) {
    const chatId = msg.chat.id;
    const user = await this.userService.repo.getUserByTelegram(chatId);
    if (!user) return this.tg.send(chatId, 'Please /start first!');
    const aff = await this.userService.repo.getAffiliateByUser(user.id);
    if (!aff) return this.tg.send(chatId, 'Join the programme first: /affiliate');

    const parts = String(match?.[1] || '').trim().split(/\s+/);
    const accIdx = parts.findIndex(x => /^\d{10}$/.test(x));
    if (accIdx === -1 || parts.length < 3) {
      return this.tg.send(chatId,
        'Format: /bank BankName AccountNumber Account Name\ne.g. /bank GTBank 0123456789 Chidi Okafor\n(account number must be 10 digits)');
    }
    const bank_name = parts.slice(0, accIdx).join(' ');
    const account_number = parts[accIdx];
    const account_name = parts.slice(accIdx + 1).join(' ');
    if (!bank_name || !account_name) {
      return this.tg.send(chatId, 'Format: /bank BankName AccountNumber Account Name');
    }

    await this.userService.repo.updateAffiliateBank(aff.id, { bank_name, account_number, account_name });
    await this.tg.send(chatId,
      `🏦 Bank saved: ${bank_name} ••${account_number.slice(-4)} (${account_name}).\nPayouts go out monthly once you reach ₦5,000 pending.`);
  }

  // Admin: pending payouts list, and "/payouts paid <affiliateId>" to settle one.
  async _handlePayoutsCmd(msg, match) {
    const chatId = msg.chat.id;
    if (!this.adminChatId || String(chatId) !== this.adminChatId) return; // silent for non-admins

    const args = String(match?.[1] || '').trim().split(/\s+/).filter(Boolean);
    if (args[0] === 'paid' && args[1]) {
      const n = await this.userService.repo.markCommissionsPaid(args[1]);
      return this.tg.send(chatId, `✅ Marked ${n} commission record(s) as paid for ${args[1]}.`);
    }

    const rows = await this.userService.repo.getPendingPayouts();
    if (!rows.length) return this.tg.send(chatId, 'No pending payouts. 🎉');
    let out = `💸 *Pending payouts*\n\n`;
    let total = 0;
    for (const r of rows) {
      total += r.pending;
      out += `*${r.name || r.tag}* (\`${r.id}\`)\n`;
      out += `  ₦${r.pending.toLocaleString()} → ${r.bank_name || '⚠️ no bank'} ${r.account_number || ''} ${r.account_name || ''}\n`;
    }
    out += `\n*Total: ₦${total.toLocaleString()}*\n\nAfter transferring, settle with: /payouts paid <id>`;
    await this.tg.send(chatId, out, { parse_mode: 'Markdown' });
  }

  // ─── /refs — campaign tracking report (admin only) ──

  async _handleRefsCmd(msg) {
    const chatId = msg.chat.id;
    if (!this.adminChatId || String(chatId) !== this.adminChatId) {
      // Echo the requester's chat id so the owner can configure ADMIN_TELEGRAM_ID.
      return this.tg.send(chatId,
        `This report is for the bot owner.\n(Your chat id is \`${chatId}\` — if you ARE the owner, set ADMIN_TELEGRAM_ID to this value.)`,
        { parse_mode: 'Markdown' });
    }

    if (typeof this.userService.repo.getRefStats !== 'function') {
      return this.tg.send(chatId, 'Ref stats not available on this storage backend.');
    }
    const rows = await this.userService.repo.getRefStats();
    if (!rows.length) return this.tg.send(chatId, 'No signups yet.');

    let out = `📈 *Signups by source*\n\n`;
    for (const r of rows) {
      out += `*${r.source}* — ${r.signups} signup${r.signups !== 1 ? 's' : ''}`;
      out += `  (🟢 ${r.paying} paying · 🟡 ${r.on_trial} trial · 🔴 ${r.expired} expired)\n`;
    }
    out += `\n_Tag your ads with t.me/A1TutorPrep\\_bot?start=ref\\_CHANNEL to track them here._`;
    await this.tg.send(chatId, out, { parse_mode: 'Markdown' });
  }

  async _handleCoachCmd(msg) {
    const user = await this.userService.repo.getUserByTelegram(msg.chat.id);
    if (!user) return this.tg.send(msg.chat.id, 'Please /start first!');
    return this._sendCoachNote(msg.chat.id, user);
  }

  async _handleStatsCmd(msg) {
    const user = await this.userService.repo.getUserByTelegram(msg.chat.id);
    if (!user) return this.tg.send(msg.chat.id, 'Please /start first!');
    return this._showStats(msg.chat.id, user);
  }

  // ─── Subscription ──────────────────────────────────

  async _showSubscription(chatId, user) {
    const info = await this.subscriptionService.getDisplayInfo(user.id);
    await this.tg.sendWithKeyboard(chatId, info.text, this._plansKeyboard(user.id));
  }

  async _handleSubscribeCmd(msg) {
    const user = await this.userService.repo.getUserByTelegram(msg.chat.id);
    if (!user) return this.tg.send(msg.chat.id, 'Please /start first!');
    return this._showSubscription(msg.chat.id, user);
  }

  async _onPlan(chatId, planId) {
    const user = await this.userService.repo.getUserByTelegram(chatId);
    if (!user) return;

    const plan = getPlan(planId);
    if (!plan) return;

    try {
      const { link } = await this.paymentService.createPaymentLink(user.id, planId);

      await this.tg.send(chatId,
        `💳 *Complete Your Payment*\n\n` +
        `Plan: ${plan.label}\n` +
        `Amount: ₦${plan.amount.toLocaleString()}\n\n` +
        `Click below to pay securely via Flutterwave:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `💳 Pay ₦${plan.amount.toLocaleString()}`, url: link }],
              [{ text: '« Back to Plans', callback_data: 'menu:subscribe' }],
            ],
          },
        }
      );
    } catch (err) {
      console.error('Payment link failed:', err);
      await this.tg.send(chatId, '⚠️ Payment service temporarily unavailable. Try again later.');
    }
  }

  // ─── Help ──────────────────────────────────────────

  async _showHelp(chatId, user) {
    const kb = user ? this._mainMenuKeyboard(user) : undefined;
    await this.tg.send(chatId,
      `❓ *Help*\n\n` +
      `ExamPrep sends ${QUESTIONS_PER_SUBJECT} JAMB/SSCE questions per subject, daily.\n\n` +
      `*Commands:*\n` +
      `/start — Register or re-register\n` +
      `/drill — Start today's practice\n` +
      `/stats — View your performance\n` +
      `/subscribe — Manage subscription\n` +
      `/cancel — Stop trial-end auto-billing\n` +
      `/coach — Personal AI coach note on your progress\n` +
      `/affiliate — Earn ${AFFILIATE_PERCENT}% sharing A1 Tutor\n\n` +
      `*Free Trial:* ${TRIAL_DAYS} days. Save a card to continue automatically after — or pay by card/transfer/USSD when it ends.\n` +
      `*Plans:* ₦${PLANS.weekly.amount}/week, ₦${PLANS.monthly.amount.toLocaleString()}/month, or ₦${PLANS.termly.amount.toLocaleString()} for the Exam Season Pass.`,
      { parse_mode: 'Markdown', ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) }
    );
  }

  // ─── Keyboards (presentation concern) ──────────────

  _mainMenuKeyboard(user) {
    const status = user.subscription_status === 'active' ? '🟢 Active' :
      user.subscription_status === 'trial' ? `🟡 Trial (${TRIAL_DAYS}d free)` : '🔴 Expired';

    const rows = [
      [{ text: '🎯 Start Today\'s Drill', callback_data: 'menu:drill' }],
      [{ text: '📊 My Stats', callback_data: 'menu:stats' }, { text: '🧑‍🏫 AI Coach', callback_data: 'menu:coach' }],
      [{ text: '💳 Subscribe', callback_data: 'menu:subscribe' }],
    ];
    // Trial users without a saved card get the auto-continue shortcut.
    if (user.subscription_status === 'trial' && !(user.card_token && user.autobill_status === 'on')) {
      rows.push([{ text: '💳 Save card — auto-continue after trial', callback_data: 'menu:savecard' }]);
    }
    rows.push([{ text: '🤝 Earn with us', callback_data: 'aff:menu' }]);
    rows.push([{ text: '❓ Help', callback_data: 'menu:help' }]);
    rows.push([{ text: `${status} | ${user.subjects?.length || 0} subjects`, callback_data: 'menu:subscribe' }]);
    return rows;
  }

  _timeKeyboard() {
    return [
      [{ text: '6:00 AM', callback_data: 'time:6:0' }, { text: '7:00 AM', callback_data: 'time:7:0' }],
      [{ text: '8:00 AM', callback_data: 'time:8:0' }, { text: '9:00 AM', callback_data: 'time:9:0' }],
      [{ text: '🌙 8:00 PM', callback_data: 'time:20:0' }],
    ];
  }

  _subjectKeyboard(selected) {
    const subjects = Object.values(SUBJECTS);
    const rows = [];
    for (let i = 0; i < subjects.length; i += 2) {
      const row = [];
      for (let j = i; j < Math.min(i + 2, subjects.length); j++) {
        const s = subjects[j];
        const checked = selected.includes(s.id) ? '✅ ' : '';
        row.push({ text: `${checked}${s.icon} ${s.name}`, callback_data: `subject:${s.id}` });
      }
      rows.push(row);
    }
    rows.push([{ text: '✔️ Confirm Selection', callback_data: 'subjects:done' }]);
    return rows;
  }

  _plansKeyboard(userId) {
    const rows = Object.entries(PLANS).map(([id, p]) =>
      [{ text: `₦${p.amount.toLocaleString()} — ${p.label}`, callback_data: `plan:${id}` }]);
    rows.push([{ text: '« Back', callback_data: 'menu:main' }]);
    return rows;
  }
}
