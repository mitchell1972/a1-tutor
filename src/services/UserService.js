// src/services/UserService.js
// Orchestrates user registration, profile management, and access control.
import { SUBJECTS, SUBJECT_PRESETS, EXAM_TYPES, QUESTIONS_PER_SUBJECT, TRIAL_DAYS } from '../config/subjects.js';
import { checkAccess } from '../domain/SubscriptionValidator.js';
import { normalizePhone } from '../infrastructure/repositories/JsonlRepository.js';

export class UserService {
  constructor({ repo }) {
    this.repo = repo;
  }

  // ─── Registration ──────────────────────────────────

  async startRegistration(telegramId) {
    const existing = await this.repo.getUserByTelegram(telegramId);
    if (existing) return { isReturning: true, user: existing };

    return {
      isReturning: false,
      step: 'exam_type',
      telegramId,
    };
  }

  async registerUser({ telegramId, phone, examType, subjects, deliveryHour, deliveryMinute, channel }) {
    // Validate
    if (!EXAM_TYPES[examType?.toUpperCase()]) throw new Error(`Invalid exam type: ${examType}`);
    if (!subjects || subjects.length < 2) throw new Error('Minimum 2 subjects required');
    if (!subjects.includes('english')) subjects = ['english', ...subjects.filter(s => s !== 'english')];

    let resolvedChannel = channel || (phone && !telegramId ? 'whatsapp' : 'telegram');
    if (resolvedChannel === 'whatsapp' && !phone) {
      // WhatsApp needs a number to address messages. A Telegram user who picks
      // "WhatsApp delivery" but has no number is still reachable on Telegram,
      // so fall back rather than crash. (WhatsApp-native signup always has a phone.)
      if (telegramId) resolvedChannel = 'telegram';
      else throw new Error('WhatsApp channel requires a phone number');
    }

    const data = {
      exam_type: examType,
      subjects,
      delivery_hour: deliveryHour ?? 7,
      delivery_minute: deliveryMinute ?? 0,
      channel: resolvedChannel,
      questions_per_subject: QUESTIONS_PER_SUBJECT,
    };
    if (telegramId) data.telegram_id = telegramId;
    if (phone) data.phone = normalizePhone(phone);

    return await this.repo.createUser(data);
  }

  // ─── Access ────────────────────────────────────────

  async checkUserAccess(userId) {
    const user = await this.repo.getUser(userId);
    if (!user) return { valid: false, reason: 'not_found' };

    const activeSub = await this.repo.getActiveSubscription(userId);
    return checkAccess(user, activeSub);
  }

  // ─── Profile ───────────────────────────────────────

  async getProfile(userId) {
    const user = await this.repo.getUser(userId);
    if (!user) return null;

    return {
      id: user.id,
      examType: EXAM_TYPES[user.exam_type?.toUpperCase()]?.label || user.exam_type,
      subjects: (user.subjects || []).map(s => ({
        id: s,
        name: SUBJECTS[s]?.name || s,
        icon: SUBJECTS[s]?.icon || '📝',
      })),
      deliveryTime: `${String(user.delivery_hour || 7).padStart(2, '0')}:${String(user.delivery_minute || 0).padStart(2, '0')} WAT`,
      channel: user.channel,
      questionsPerSubject: user.questions_per_subject || QUESTIONS_PER_SUBJECT,
      subscriptionStatus: user.subscription_status,
      trialDaysLeft: this._trialDaysLeft(user),
    };
  }

  // ─── Helpers ───────────────────────────────────────

  getSubjectNames(subjectIds) {
    return subjectIds.map(s => SUBJECTS[s]?.name || s);
  }

  getSubjectIcons(subjectIds) {
    return subjectIds.map(s => SUBJECTS[s]?.icon || '📝');
  }

  getPresets() {
    return SUBJECT_PRESETS;
  }

  getExamTypes() {
    return EXAM_TYPES;
  }

  getAllSubjects() {
    return SUBJECTS;
  }

  _trialDaysLeft(user) {
    if (user.subscription_status !== 'trial') return 0;
    const trialStart = user.trial_start ? new Date(user.trial_start) : new Date();
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
    return Math.max(0, Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)));
  }
}
