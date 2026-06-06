// src/presentation/TelegramBot.js
// Presentation adapter: handles Telegram I/O. Delegates ALL business logic to services.
// Thin, testable, replaceable.
import { SUBJECTS, SUBJECT_PRESETS, EXAM_TYPES, QUESTIONS_PER_SUBJECT, TRIAL_DAYS } from '../config/subjects.js';

export class TelegramBotAdapter {
  constructor({ channel, userService, questionService, subscriptionService, paymentService, dispatchService, analyticsService }) {
    this.tg = channel;
    this.userService = userService;
    this.questionService = questionService;
    this.subscriptionService = subscriptionService;
    this.paymentService = paymentService;
    this.dispatchService = dispatchService;
    this.analyticsService = analyticsService;

    // In-memory registration sessions
    this._sessions = new Map();

    this._registerHandlers();
  }

  _session(chatId) {
    if (!this._sessions.has(chatId)) this._sessions.set(chatId, {});
    return this._sessions.get(chatId);
  }

  // ─── Handler Registration ──────────────────────────

  _registerHandlers() {
    this.tg.onText(/\/start/, this._handleStart.bind(this));
    this.tg.onText(/\/drill/, this._handleDrillCmd.bind(this));
    this.tg.onText(/\/stats/, this._handleStatsCmd.bind(this));
    this.tg.onText(/\/subscribe/, this._handleSubscribeCmd.bind(this));
    this.tg.onCallback(this._handleCallback.bind(this));
  }

  // ─── /start ────────────────────────────────────────

  async _handleStart(msg) {
    const chatId = msg.chat.id;
    const result = this.userService.startRegistration(chatId);

    if (result.isReturning) {
      const user = result.user;
      const profile = this.userService.getProfile(user.id);
      const subStatus = this.subscriptionService.getStatus(user.id);

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
    const session = this._session(chatId);
    session.step = 'exam_type';
    session.telegramId = chatId;

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
    const session = this._session(chatId);

    try {
      await this.tg.answerCallback(queryId);

      if (data.startsWith('exam:'))     await this._onExam(chatId, session, data.split(':')[1], query.message.message_id);
      else if (data.startsWith('preset:')) await this._onPreset(chatId, session, data.split(':')[1], query.message.message_id);
      else if (data.startsWith('subject:')) await this._onSubjectToggle(chatId, session, data.split(':')[1], query.message.message_id, queryId);
      else if (data === 'subjects:done') await this._onSubjectsDone(chatId, session, query.message.message_id, queryId);
      else if (data.startsWith('time:'))  await this._onTime(chatId, session, data.split(':').slice(1), query.message.message_id);
      else if (data.startsWith('menu:'))  await this._onMenu(chatId, data.split(':')[1]);
      else if (data.startsWith('plan:'))  await this._onPlan(chatId, data.split(':')[1]);
      else if (data.startsWith('answer:')) await this._onAnswer(chatId, data);

    } catch (err) {
      console.error('Callback error:', err);
      this.tg.send(chatId, '⚠️ Something went wrong. Please /start again.');
    }
  }

  // ─── Registration Steps ────────────────────────────

  async _onExam(chatId, session, examType, msgId) {
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

    await this.tg.editMessage(chatId, msgId,
      `*Choose your subject combination:*\n\n` +
      `${compulsoryMsg}Pick your subjects (${compulsory ? '3-4' : '4-6'} recommended).`,
      keyboard
    );
  }

  async _onPreset(chatId, session, preset, msgId) {
    if (preset !== 'custom') {
      const presetSubjects = SUBJECT_PRESETS[preset]?.subjects || [];
      session.selectedSubjects = [...new Set(presetSubjects)];
      session.step = 'delivery_time';

      const names = session.selectedSubjects.map(s => `${SUBJECTS[s]?.icon} ${SUBJECTS[s]?.name}`).join('\n');
      await this.tg.editMessage(chatId, msgId,
        `*Your subjects:*\n${names}\n\n*When should I send your daily questions?* (West Africa Time)`,
        this._timeKeyboard()
      );
      return;
    }

    session.selectedSubjects = ['english'];
    await this.tg.editMessage(chatId, msgId,
      `*Select your subjects:*\n\nTap to toggle. English is compulsory. Choose 3-4 total.`,
      this._subjectKeyboard(session.selectedSubjects)
    );
  }

  async _onSubjectToggle(chatId, session, subjectId, msgId, queryId) {
    if (subjectId === 'english') return;

    if (session.selectedSubjects.includes(subjectId)) {
      session.selectedSubjects = session.selectedSubjects.filter(s => s !== subjectId);
    } else {
      if (session.selectedSubjects.length >= 6) {
        return this.tg.answerCallback(queryId, 'Maximum 6 subjects!', true);
      }
      session.selectedSubjects.push(subjectId);
    }

    await this.tg.editKeyboard(chatId, msgId, this._subjectKeyboard(session.selectedSubjects));
  }

  async _onSubjectsDone(chatId, session, msgId, queryId) {
    if (session.selectedSubjects.length < 2) {
      return this.tg.answerCallback(queryId, 'Select at least 2 subjects!', true);
    }

    session.step = 'delivery_time';
    const names = session.selectedSubjects.map(s => `${SUBJECTS[s]?.icon} ${SUBJECTS[s]?.name}`).join('\n');
    await this.tg.editMessage(chatId, msgId,
      `*Your subjects:*\n${names}\n\n*When should I send your daily questions?* (West Africa Time)`,
      this._timeKeyboard()
    );
  }

  async _onTime(chatId, session, timeParts, msgId) {
    const [hour, minute] = timeParts.map(Number);
    session.delivery_hour = hour;
    session.delivery_minute = minute;

    // WhatsApp is now its own front door (students register there directly),
    // so the Telegram bot always registers Telegram delivery — no channel step.
    const user = this.userService.registerUser({
      telegramId: chatId,
      examType: session.exam_type,
      subjects: session.selectedSubjects,
      deliveryHour: session.delivery_hour,
      deliveryMinute: session.delivery_minute,
      channel: 'telegram',
    });

    this._sessions.delete(chatId);

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
      `Questions start at your next delivery time!\n\n` +
      `Start now with a practice round?`,
      [
        [{ text: '🎯 Start Practice Drill Now', callback_data: 'menu:drill' }],
        [{ text: '💳 Subscribe (₦500/week)', callback_data: 'menu:subscribe' }],
      ]
    );
  }

  // ─── Menu ──────────────────────────────────────────

  async _onMenu(chatId, action) {
    const user = this.userService.repo.getUserByTelegram(chatId);
    if (!user) return this.tg.send(chatId, 'Please /start first!');

    switch (action) {
      case 'drill':     return this._startDrill(chatId, user);
      case 'stats':     return this._showStats(chatId, user);
      case 'subscribe': return this._showSubscription(chatId, user);
      case 'help':      return this._showHelp(chatId, user);
      case 'main':
      default:          return this.tg.sendWithKeyboard(chatId, '📋 Main Menu', this._mainMenuKeyboard(user));
    }
  }

  // ─── Drill ─────────────────────────────────────────

  async _startDrill(chatId, user) {
    const access = this.subscriptionService.getStatus(user.id);
    if (!access.valid) {
      return this.tg.sendWithKeyboard(chatId,
        '🔒 Access required. Subscribe to continue:',
        this._plansKeyboard(user.id)
      );
    }

    if (this.questionService.isAlreadyDispatchedToday(user.id)) {
      return this.tg.sendWithKeyboard(chatId,
        '✅ You\'ve already completed today\'s drill!\nCome back tomorrow.',
        this._mainMenuKeyboard(user)
      );
    }

    await this.tg.send(chatId,
      `📚 *Starting Your Drill*\n${QUESTIONS_PER_SUBJECT} questions per subject coming up. Good luck! 🚀`,
      { parse_mode: 'Markdown' }
    );

    const questions = this.questionService.generateDailySet(user);
    const total = questions.length;

    for (let i = 0; i < questions.length; i++) {
      const formatted = this.questionService.formatQuestion(questions[i], i, total);
      const opts = questions[i].options || {};

      await this.tg.sendWithKeyboard(chatId,
        `*${formatted.header}*\n\n${formatted.body}`,
        Object.entries(opts).map(([k, v]) => ([{
          text: `${k}) ${v.length > 40 ? v.slice(0, 37) + '...' : v}`,
          callback_data: `answer:${questions[i].id}:${k}:${i}:${total}`,
        }]))
      );

      if (i < total - 1) await this.tg.sleep(3000);
    }
  }

  async _handleDrillCmd(msg) {
    const user = this.userService.repo.getUserByTelegram(msg.chat.id);
    if (!user) return this.tg.send(msg.chat.id, 'Please /start first!');
    return this._startDrill(msg.chat.id, user);
  }

  // ─── Answer ────────────────────────────────────────

  async _onAnswer(chatId, data) {
    const parts = data.split(':');
    const questionId = parts[1];
    const chosenAnswer = parts[2];
    const questionIndex = parseInt(parts[3]);
    const total = parseInt(parts[4]);

    const user = this.userService.repo.getUserByTelegram(chatId);
    if (!user) return;
    const result = this.questionService.processAnswer(user.id, questionId, chosenAnswer);
    if (result.error) return;

    const feedback = this.questionService.formatFeedback(result);

    const progress = this.questionService.getCumulativeProgress(user.id, total);

    await this.tg.send(chatId,
      `${feedback}\n\n📊 So far: ${progress.correct}/${progress.answered} correct`,
      { parse_mode: 'Markdown' }
    );

    if (progress.isComplete) {
      await this.tg.sleep(1000);

      const today = new Date().toISOString().split('T')[0];
      const todayResponses = this.userService.repo.getResponsesByDate(user.id, today);
      const report = this.questionService.formatDailyReport(user.id, todayResponses);
      await this.tg.send(chatId, report, { parse_mode: 'Markdown' });
    }
  }

  // ─── Stats ─────────────────────────────────────────

  async _showStats(chatId, user) {
    const analytics = this.analyticsService.getUserAnalytics(user.id);
    if (!analytics) return;

    const weekSummary = analytics.trend.map(t =>
      `• ${t.day}: ${t.total > 0 ? `${t.score}% (${t.correct}/${t.total})` : '—'}`
    ).join('\n');

    let msg = `📊 *Your Stats*\n\n`;
    msg += `🔥 Streak: ${analytics.streak} day${analytics.streak !== 1 ? 's' : ''}\n`;
    msg += `📅 Today: ${analytics.today.total > 0 ? `${analytics.today.score}% (${analytics.today.correct}/${analytics.today.total})` : 'Not yet started'}\n\n`;
    msg += `*This Week:*\n${weekSummary}\n`;

    if (analytics.weakAreas.length > 0) {
      msg += `\n*Areas to improve:*\n`;
      analytics.weakAreas.forEach(a => {
        msg += `• ${SUBJECTS[a.subject]?.name || a.subject}: ${a.topic.replace(/_/g, ' ')} (${a.accuracy}%)\n`;
      });
    }

    await this.tg.sendWithKeyboard(chatId, msg, this._mainMenuKeyboard(user));
  }

  async _handleStatsCmd(msg) {
    const user = this.userService.repo.getUserByTelegram(msg.chat.id);
    if (!user) return this.tg.send(msg.chat.id, 'Please /start first!');
    return this._showStats(msg.chat.id, user);
  }

  // ─── Subscription ──────────────────────────────────

  async _showSubscription(chatId, user) {
    const info = this.subscriptionService.getDisplayInfo(user.id);
    await this.tg.sendWithKeyboard(chatId, info.text, this._plansKeyboard(user.id));
  }

  async _handleSubscribeCmd(msg) {
    const user = this.userService.repo.getUserByTelegram(msg.chat.id);
    if (!user) return this.tg.send(msg.chat.id, 'Please /start first!');
    return this._showSubscription(msg.chat.id, user);
  }

  async _onPlan(chatId, planId) {
    const user = this.userService.repo.getUserByTelegram(chatId);
    if (!user) return;

    const planAmounts = { weekly: 500, monthly: 1500, termly: 4000, yearly: 12000 };
    const planLabels = { weekly: '1 Week', monthly: '1 Month', termly: '3 Months', yearly: '1 Year' };

    try {
      const { link } = await this.paymentService.createPaymentLink(user.id, planId);

      await this.tg.send(chatId,
        `💳 *Complete Your Payment*\n\n` +
        `Plan: ${planLabels[planId]}\n` +
        `Amount: ₦${planAmounts[planId].toLocaleString()}\n\n` +
        `Click below to pay securely via Flutterwave:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `💳 Pay ₦${planAmounts[planId].toLocaleString()}`, url: link }],
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
      `/subscribe — Manage subscription\n\n` +
      `*Free Trial:* ${TRIAL_DAYS} days, no payment needed.\n` +
      `*After trial:* ₦500/week, ₦1,500/month, or ₦4,000/term.`,
      { parse_mode: 'Markdown', ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) }
    );
  }

  // ─── Keyboards (presentation concern) ──────────────

  _mainMenuKeyboard(user) {
    const status = user.subscription_status === 'active' ? '🟢 Active' :
      user.subscription_status === 'trial' ? `🟡 Trial (${TRIAL_DAYS}d free)` : '🔴 Expired';

    return [
      [{ text: '🎯 Start Today\'s Drill', callback_data: 'menu:drill' }],
      [{ text: '📊 My Stats', callback_data: 'menu:stats' }],
      [{ text: '💳 Subscribe', callback_data: 'menu:subscribe' }],
      [{ text: '❓ Help', callback_data: 'menu:help' }],
      [{ text: `${status} | ${user.subjects?.length || 0} subjects`, callback_data: 'menu:main' }],
    ];
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
    return [
      [{ text: '₦500 / Week', callback_data: 'plan:weekly' }],
      [{ text: '₦1,500 / Month', callback_data: 'plan:monthly' }],
      [{ text: '₦4,000 / 3 Months', callback_data: 'plan:termly' }],
      [{ text: '₦12,000 / Year', callback_data: 'plan:yearly' }],
      [{ text: '« Back', callback_data: 'menu:main' }],
    ];
  }
}
