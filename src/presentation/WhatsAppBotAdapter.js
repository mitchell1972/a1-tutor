// src/presentation/WhatsAppBotAdapter.js
// Presentation adapter: handles WhatsApp I/O (registration, drills, answers).
// Thin — delegates ALL business logic to the same services as the Telegram bot.
// The student's phone number is captured automatically from every inbound message,
// so WhatsApp is a full sign-up-and-drill front door (no Telegram required).
import { SUBJECTS, SUBJECT_PRESETS, EXAM_TYPES, QUESTIONS_PER_SUBJECT, TRIAL_DAYS } from '../config/subjects.js';
import { normalizePhone } from '../infrastructure/repositories/JsonlRepository.js';

const EXAM_OPTIONS = [
  { id: 'exam:jamb',      title: 'JAMB / UTME' },
  { id: 'exam:ssce',      title: 'WAEC / SSCE' },
  { id: 'exam:neco',      title: 'NECO' },
  { id: 'exam:post_utme', title: 'Post-UTME Screening' },
  { id: 'exam:gst',       title: 'University GST (100L)' },
  { id: 'exam:squad',     title: 'Departmental Courses' },
];

const TIME_OPTIONS = [
  { id: 'time:6:0',  title: '6:00 AM' },
  { id: 'time:7:0',  title: '7:00 AM' },
  { id: 'time:8:0',  title: '8:00 AM' },
  { id: 'time:9:0',  title: '9:00 AM' },
  { id: 'time:20:0', title: '8:00 PM' },
];

const PLAN_ROWS = [
  { id: 'plan:weekly',  title: '₦500 / Week',      description: '7 days access' },
  { id: 'plan:monthly', title: '₦1,500 / Month',   description: '30 days access' },
  { id: 'plan:termly',  title: '₦4,000 / 3 Months', description: '90 days access' },
  { id: 'plan:yearly',  title: '₦12,000 / Year',   description: '365 days access' },
];

export class WhatsAppBotAdapter {
  constructor({ channel, repo, userService, questionService, subscriptionService, paymentService, analyticsService }) {
    this.channel = channel;
    this.repo = repo;
    this.userService = userService;
    this.questionService = questionService;
    this.subscriptionService = subscriptionService;
    this.paymentService = paymentService;
    this.analyticsService = analyticsService;

    // In-memory registration sessions, keyed by normalised phone.
    // (Lost on restart — registration is short, same trade-off as the Telegram bot.)
    this._sessions = new Map();
  }

  _session(phone) {
    if (!this._sessions.has(phone)) this._sessions.set(phone, {});
    return this._sessions.get(phone);
  }

  // ─── Inbound router ────────────────────────────────

  async handleInbound(parsed) {
    if (!parsed || !parsed.from) return;
    const phone = normalizePhone(parsed.from);

    try {
      if (parsed.type === 'interactive' && parsed.id) {
        return await this._routeInteractive(phone, parsed.id);
      }
      if (parsed.type === 'text') {
        return await this._handleText(phone, parsed.body || '');
      }
      // unknown message type
      const user = await this.repo.getUserByPhone(phone);
      return user ? this._showMenu(phone, user) : this._startRegistration(phone);
    } catch (err) {
      console.error('WhatsAppBot handleInbound error:', err);
      await this.channel.sendText(phone, '⚠️ Something went wrong. Reply "menu" to try again.');
    }
  }

  async _routeInteractive(phone, id) {
    const parts = id.split(':');
    switch (parts[0]) {
      case 'exam':   return this._onExam(phone, parts[1]);
      case 'preset': return this._onPreset(phone, parts[1]);
      case 'time':   return this._onTime(phone, Number(parts[1]), Number(parts[2]));
      case 'menu':   return this._onMenu(phone, parts[1]);
      case 'plan':   return this._onPlan(phone, parts[1]);
      case 'answer': return this._handleAnswer(phone, parts[1], parts[2]);
      case 'daily':  return this._onMenu(phone, 'drill'); // 7am template "Start" button
      default:       return this._handleText(phone, id);
    }
  }

  async _handleText(phone, text) {
    const t = (text || '').trim().toLowerCase();
    const user = await this.repo.getUserByPhone(phone);

    // Any message from someone without an account starts sign-up.
    if (!user) return this._startRegistration(phone);

    if (/(drill|question)/.test(t)) return this._onMenu(phone, 'drill');
    if (/(stat|score|progress)/.test(t)) return this._onMenu(phone, 'stats');
    if (/(subscribe|pay|plan|price)/.test(t)) return this._onMenu(phone, 'subscribe');
    if (/help/.test(t)) return this._onMenu(phone, 'help');
    return this._showMenu(phone, user);
  }

  // ─── Registration ──────────────────────────────────

  async _startRegistration(phone) {
    this._sessions.set(phone, { step: 'exam' });
    await this.channel.sendList(
      phone,
      'Welcome to ExamPrep! 🎓 I send you exam questions to drill every day — JAMB, WAEC, NECO, Post-UTME, GST and more.\n\nLet\'s set you up in under a minute. What are you preparing for?',
      'Choose exam',
      [{ title: 'Exams', rows: EXAM_OPTIONS }],
      { header: 'Welcome 🎓' }
    );
  }

  async _onExam(phone, examType) {
    if (!examType || !EXAM_TYPES[examType.toUpperCase()]) return this._startRegistration(phone);

    const session = this._session(phone);
    session.exam_type = examType;
    session.step = 'preset';

    const isUniversity = ['post_utme', 'gst', 'squad'].includes(examType);
    const rows = Object.entries(SUBJECT_PRESETS)
      .filter(([key]) => (isUniversity ? key.startsWith('uni_') : !key.startsWith('uni_')))
      .map(([key, v]) => ({
        id: `preset:${key}`,
        title: v.label,
        description: v.subjects.map(s => SUBJECTS[s]?.name || s).slice(0, 3).join(', '),
      }));

    await this.channel.sendList(
      phone,
      'Great. Pick the subject combination that fits you:',
      'Choose subjects',
      [{ title: 'Subject combos', rows }],
      { header: 'Your subjects' }
    );
  }

  async _onPreset(phone, presetKey) {
    const session = this._session(phone);
    const preset = SUBJECT_PRESETS[presetKey];
    if (!session.exam_type || !preset) return this._startRegistration(phone);

    session.subjects = [...new Set(preset.subjects)];
    session.step = 'time';

    const names = session.subjects.map(s => SUBJECTS[s]?.name || s).join(', ');
    await this.channel.sendList(
      phone,
      `Subjects locked in:\n${names}\n\nWhen should I send your daily questions? (West Africa Time)`,
      'Choose time',
      [{ title: 'Delivery time', rows: TIME_OPTIONS }],
      { header: 'Delivery time' }
    );
  }

  async _onTime(phone, hour, minute) {
    const session = this._session(phone);
    if (!session.exam_type || !session.subjects) return this._startRegistration(phone);

    let user;
    try {
      user = await this.userService.registerUser({
        phone,
        examType: session.exam_type,
        subjects: session.subjects,
        deliveryHour: Number.isFinite(hour) ? hour : 7,
        deliveryMinute: Number.isFinite(minute) ? minute : 0,
        channel: 'whatsapp',
      });
    } catch (err) {
      console.error('WhatsApp registerUser failed:', err.message);
      await this.channel.sendText(phone, '⚠️ Could not complete signup. Reply "menu" to retry.');
      return;
    }

    this._sessions.delete(phone);

    const subjectNames = user.subjects.map(s => SUBJECTS[s]?.name || s).join(', ');
    const timeStr = `${String(user.delivery_hour).padStart(2, '0')}:${String(user.delivery_minute).padStart(2, '0')} WAT`;

    await this.channel.sendButtons(
      phone,
      `🎉 You're all set!\n\n📖 Subjects: ${subjectNames}\n⏰ Daily at ${timeStr}\n🎁 ${TRIAL_DAYS}-day free trial active.\n\nStart a practice round now?`,
      [
        { id: 'menu:drill', title: '🎯 Start drill' },
        { id: 'menu:subscribe', title: '💳 Subscribe' },
        { id: 'menu:help', title: '❓ Help' },
      ],
      { header: 'Welcome aboard 🎓' }
    );
  }

  // ─── Menu ──────────────────────────────────────────

  async _onMenu(phone, action) {
    const user = await this.repo.getUserByPhone(phone);
    if (!user) return this._startRegistration(phone);

    switch (action) {
      case 'drill':     return this._startDrill(phone, user);
      case 'stats':     return this._showStats(phone, user);
      case 'subscribe': return this._showSubscribe(phone, user);
      case 'help':      return this._showHelp(phone, user);
      default:          return this._showMenu(phone, user);
    }
  }

  async _showMenu(phone, user) {
    await this.channel.sendButtons(
      phone,
      '📋 What would you like to do?',
      [
        { id: 'menu:drill', title: '🎯 Today\'s drill' },
        { id: 'menu:stats', title: '📊 My stats' },
        { id: 'menu:subscribe', title: '💳 Subscribe' },
      ],
      { header: 'ExamPrep' }
    );
  }

  // ─── Drill ─────────────────────────────────────────

  async _startDrill(phone, user) {
    const access = await this.subscriptionService.getStatus(user.id);
    if (!access.valid) {
      await this.channel.sendText(phone, '🔒 Your access has ended. Subscribe to keep drilling:');
      return this._showSubscribe(phone, user);
    }

    if (await this.questionService.isAlreadyDispatchedToday(user.id)) {
      return this.channel.sendText(phone, '✅ You\'ve already done today\'s drill. Come back tomorrow! 💪');
    }

    let questions;
    try {
      questions = await this.questionService.generateDailySet(user);
    } catch (err) {
      console.error('generateDailySet failed:', err.message);
      return this.channel.sendText(phone, '⚠️ No questions available right now. Try again later.');
    }
    if (!questions.length) {
      return this.channel.sendText(phone, '⚠️ No questions available right now. Try again later.');
    }

    await this.channel.sendQuestions(
      phone,
      questions,
      `📚 Daily Drill — ${questions.length} questions. Tap an option to answer. Let's go! 🚀`
    );
  }

  // ─── Answer ────────────────────────────────────────

  async _handleAnswer(phone, questionId, answerKey) {
    const user = await this.repo.getUserByPhone(phone);
    if (!user) return this._startRegistration(phone);
    if (!questionId || !answerKey) return;

    const result = await this.questionService.processAnswer(user.id, questionId, answerKey);
    if (result.error) return;

    const feedback = this.questionService.formatFeedback(result);
    const total = await this.questionService.getTotalDispatchedToday(user.id);
    const progress = await this.questionService.getCumulativeProgress(user.id, total);

    await this.channel.sendText(phone, `${feedback}\n\n📊 So far: ${progress.correct}/${progress.answered} correct`);

    if (progress.isComplete) {
      const today = new Date().toISOString().split('T')[0];
      const todayResponses = await this.repo.getResponsesByDate(user.id, today);
      const report = await this.questionService.formatDailyReport(user.id, todayResponses);
      await this.channel.sendText(phone, report);
    }
  }

  // ─── Stats ─────────────────────────────────────────

  async _showStats(phone, user) {
    const a = await this.analyticsService.getUserAnalytics(user.id);
    if (!a) return this.channel.sendText(phone, 'No stats yet — do a drill first!');

    let msg = `📊 Your Stats\n\n`;
    msg += `🔥 Streak: ${a.streak} day${a.streak !== 1 ? 's' : ''}\n`;
    msg += `📅 Today: ${a.today.total > 0 ? `${a.today.score}% (${a.today.correct}/${a.today.total})` : 'Not started'}\n`;
    msg += `🎯 Overall: ${a.overall.accuracy}% (${a.overall.totalAnswered} answered)\n`;

    if (a.weakAreas.length) {
      msg += `\nAreas to improve:\n`;
      a.weakAreas.forEach(w => {
        msg += `• ${SUBJECTS[w.subject]?.name || w.subject}: ${(w.topic || '').replace(/_/g, ' ')} (${w.accuracy}%)\n`;
      });
    }

    await this.channel.sendText(phone, msg);
  }

  // ─── Subscription ──────────────────────────────────

  async _showSubscribe(phone, user) {
    const info = await this.subscriptionService.getDisplayInfo(user.id);
    await this.channel.sendList(
      phone,
      info.text,
      'Choose plan',
      [{ title: 'Plans', rows: PLAN_ROWS }],
      { header: 'Subscribe' }
    );
  }

  async _onPlan(phone, planId) {
    const user = await this.repo.getUserByPhone(phone);
    if (!user) return this._startRegistration(phone);

    try {
      const { link } = await this.paymentService.createPaymentLink(user.id, planId);
      const labels = { weekly: '1 Week', monthly: '1 Month', termly: '3 Months', yearly: '1 Year' };
      await this.channel.sendText(
        phone,
        `💳 Pay for ${labels[planId] || 'your plan'} securely here:\n${link}\n\nYour subscription activates automatically once payment is confirmed.`
      );
    } catch (err) {
      console.error('WhatsApp payment link failed:', err.message);
      await this.channel.sendText(phone, '⚠️ Payment service is busy. Please try again shortly.');
    }
  }

  // ─── Help ──────────────────────────────────────────

  async _showHelp(phone) {
    await this.channel.sendText(
      phone,
      `❓ Help\n\nI send ${QUESTIONS_PER_SUBJECT} questions per subject every day.\n\nReply with:\n• "drill" — today's questions\n• "stats" — your progress\n• "subscribe" — manage your plan\n• "menu" — main menu\n\n🎁 ${TRIAL_DAYS}-day free trial, then from ₦500/week.`
    );
  }
}
