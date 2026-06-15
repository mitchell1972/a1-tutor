// src/infrastructure/repositories/JsonlRepository.js
// Single JSONL-backed repository implementing all persistence needs.
// Swap for PostgreSQL at scale — same interface.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genId, normalizePhone, nowISO, todayISO, daysAgo } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

export class JsonlRepository {
  constructor() {
    this._cache = new Map();
    this._sessionStore = new Map(); // registration state (single-process)
  }

  // ─── file I/O ─────────────────────────────────────

  _file(table) {
    return path.join(DATA_DIR, `${table}.jsonl`);
  }

  _read(table) {
    const file = this._file(table);
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf-8').trim();
    if (!raw) return [];
    return raw.split('\n').map(line => JSON.parse(line));
  }

  _append(table, record) {
    fs.appendFileSync(this._file(table), JSON.stringify(record) + '\n');
  }

  _write(table, records) {
    fs.writeFileSync(this._file(table), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  }

  all(table) {
    return this._read(table);
  }

  count(table) {
    return this._read(table).length;
  }

  // ─── Users ─────────────────────────────────────────

  findUser(query) {
    const [key] = Object.keys(query);
    return this._read('users').find(u => u[key] === query[key]) || null;
  }

  getUser(id) {
    return this.findUser({ id });
  }

  getUserByTelegram(telegramId) {
    return this.findUser({ telegram_id: telegramId });
  }

  getUserByPhone(phone) {
    return this.findUser({ phone: normalizePhone(phone) });
  }

  createUser(data) {
    const user = {
      id: genId('usr'),
      ...data,
      subscription_status: 'trial',
      trial_start: todayISO(),
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    this._append('users', user);
    return user;
  }

  updateUser(id, updates) {
    const users = this._read('users');
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    users[idx] = { ...users[idx], ...updates, updated_at: nowISO() };
    this._write('users', users);
    return users[idx];
  }

  getUsersDueForDelivery(hour, minute) {
    return this._read('users').filter(u => {
      if (u.subscription_status !== 'trial' && u.subscription_status !== 'active') return false;
      if (u.subscription_expiry && new Date(u.subscription_expiry) < new Date()) return false;
      return (u.delivery_hour ?? 7) === hour && (u.delivery_minute ?? 0) === minute;
    });
  }

  // Parity with PgRepository.getUsersToNudge: Telegram users dispatched today but
  // who have not answered any question today.
  getUsersToNudge() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const dispatchedToday = new Set(
      this._read('dispatches')
        .filter(d => new Date(d.dispatched_at) >= start)
        .map(d => d.user_id)
    );
    const answeredToday = new Set(
      this._read('responses')
        .filter(r => new Date(r.answered_at) >= start)
        .map(r => r.user_id)
    );
    return this._read('users').filter(u =>
      u.telegram_id &&
      (u.subscription_status === 'trial' || u.subscription_status === 'active') &&
      dispatchedToday.has(u.id) && !answeredToday.has(u.id)
    );
  }

  // ─── Questions ─────────────────────────────────────

  getQuestionsBySubject(subject, count, opts = {}) {
    const { excludeIds = [], exam = null } = opts;
    let questions = this._read('questions')
      .filter(q => q.subject === subject)
      .filter(q => !excludeIds.includes(q.id));

    // Filter by exam type (JAMB, SSCE, NECO)
    if (exam) {
      questions = questions.filter(q => q.exam === exam);
    }

    // Sort by times_used ascending (fair rotation — least used first)
    questions.sort((a, b) => (a.times_used || 0) - (b.times_used || 0));
    return questions;
  }

  getQuestion(id) {
    return this._read('questions').find(q => q.id === id) || null;
  }

  addQuestion(question) {
    const q = { id: genId('q'), times_used: 0, last_used: null, created_at: nowISO(), ...question };
    this._append('questions', q);
    return q;
  }

  markQuestionUsed(id) {
    const questions = this._read('questions');
    const idx = questions.findIndex(q => q.id === id);
    if (idx === -1) return;
    questions[idx].times_used = (questions[idx].times_used || 0) + 1;
    questions[idx].last_used = nowISO();
    this._write('questions', questions);
  }

  getTotalQuestions() {
    return this._read('questions').length;
  }

  // ─── Responses ─────────────────────────────────────

  recordResponse(data) {
    const r = { id: genId('rsp'), ...data, answered_at: nowISO() };
    this._append('responses', r);
    return r;
  }

  getResponses(userId, opts = {}) {
    const { limit = 1000, since = null } = opts;
    let responses = this._read('responses')
      .filter(r => r.user_id === userId)
      .sort((a, b) => new Date(b.answered_at) - new Date(a.answered_at));

    if (since) responses = responses.filter(r => new Date(r.answered_at) >= new Date(since));
    return responses.slice(0, limit);
  }

  getResponsesByDate(userId, date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return this._read('responses').filter(r => {
      if (r.user_id !== userId) return false;
      const d = new Date(r.answered_at);
      return d >= start && d <= end;
    });
  }

  getAllUserResponseDates(userId) {
    return this._read('responses')
      .filter(r => r.user_id === userId)
      .map(r => r.answered_at);
  }

  // ─── Subscriptions ─────────────────────────────────

  createSubscription(data) {
    const sub = { id: genId('sub'), ...data, created_at: nowISO() };
    this._append('subscriptions', sub);
    return sub;
  }

  getActiveSubscription(userId) {
    return this._read('subscriptions')
      .filter(s => s.user_id === userId && s.status === 'active')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  }

  getAllSubscriptions(userId) {
    return this._read('subscriptions')
      .filter(s => s.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  getTotalRevenue() {
    const plans = { weekly: 500, monthly: 1500, termly: 4000, yearly: 12000 };
    return this._read('subscriptions')
      .filter(s => s.status === 'active')
      .reduce((sum, s) => sum + (plans[s.plan] || 0), 0);
  }

  // ─── Dispatches ────────────────────────────────────

  logDispatch(userId, questionIds) {
    this._append('dispatches', { user_id: userId, question_ids: questionIds, dispatched_at: nowISO() });
  }

  getTodayDispatches(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this._read('dispatches').filter(d =>
      d.user_id === userId && new Date(d.dispatched_at) >= today
    );
  }

  /**
   * Get ALL question IDs ever dispatched to a user.
   * Used to guarantee zero duplicate questions.
   */
  getAllDispatchedIds(userId) {
    const dispatches = this._read('dispatches').filter(d => d.user_id === userId);
    return dispatches.flatMap(d => d.question_ids || []);
  }

  // ─── Affiliates (digest only; full affiliate support is Postgres-backed) ──
  getAffiliatesForDigest() {
    const affiliates = this._read('affiliates');
    if (!affiliates.length) return [];
    const users = this._read('users');
    const commissions = this._read('commissions');
    return affiliates
      .filter(a => (a.status || 'active') === 'active')
      .map(a => {
        const u = users.find(x => x.id === a.user_id);
        if (!u || !u.telegram_id) return null;
        const referred = users.filter(ru => ru.ref_source === a.tag);
        const comms = commissions.filter(c => c.affiliate_id === a.id);
        return {
          id: a.id, tag: a.tag, telegram_id: u.telegram_id,
          referred: referred.length,
          paying: referred.filter(ru => ru.subscription_status === 'active').length,
          earned: comms.reduce((s, c) => s + (c.commission || 0), 0),
          pending: comms.filter(c => c.status === 'pending').reduce((s, c) => s + (c.commission || 0), 0),
        };
      })
      .filter(Boolean);
  }

  // ─── Sessions (in-memory; single-process fallback) ──

  getSession(key) {
    return this._sessionStore.get(key) || {};
  }

  setSession(key, data) {
    this._sessionStore.set(key, data || {});
  }

  deleteSession(key) {
    this._sessionStore.delete(key);
  }
}

// ─── Shared Helpers (re-exported for back-compat) ─────
export { genId, normalizePhone, nowISO, todayISO, daysAgo } from './helpers.js';
