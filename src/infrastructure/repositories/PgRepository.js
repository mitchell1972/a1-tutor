// src/infrastructure/repositories/PgRepository.js
// Postgres-backed repository. Same method contract as JsonlRepository, but async.
// Used in production (when DATABASE_URL is set); JsonlRepository remains the
// zero-dependency fallback for local dev and tests.
import pg from 'pg';
import { genId, normalizePhone, nowISO } from './helpers.js';

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  telegram_id bigint,
  phone text,
  exam_type text,
  subjects jsonb DEFAULT '[]'::jsonb,
  delivery_hour int DEFAULT 7,
  delivery_minute int DEFAULT 0,
  channel text DEFAULT 'telegram',
  questions_per_subject int DEFAULT 10,
  subscription_status text DEFAULT 'trial',
  subscription_expiry timestamptz,
  trial_start timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_delivery ON users(delivery_hour, delivery_minute);

CREATE TABLE IF NOT EXISTS questions (
  id text PRIMARY KEY,
  subject text, exam text, year int, topic text, difficulty int,
  text text, options jsonb, answer text, explanation text,
  times_used int DEFAULT 0, last_used timestamptz, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject, exam);
CREATE INDEX IF NOT EXISTS idx_questions_times_used ON questions(times_used);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source text;

CREATE TABLE IF NOT EXISTS responses (
  id text PRIMARY KEY,
  user_id text, question_id text, chosen_answer text, correct boolean,
  answered_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_responses_user_time ON responses(user_id, answered_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  user_id text, plan text, status text, start_date text, end_date text,
  tx_ref text, amount numeric, flw_id text, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subs_user_status ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS dispatches (
  id bigserial PRIMARY KEY,
  user_id text, question_ids jsonb DEFAULT '[]'::jsonb, dispatched_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispatches_user_time ON dispatches(user_id, dispatched_at);

CREATE TABLE IF NOT EXISTS sessions (
  key text PRIMARY KEY,
  data jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);
`;

const TABLES = new Set(['users', 'questions', 'responses', 'subscriptions', 'dispatches']);

export class PgRepository {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async init() {
    await this.pool.query(SCHEMA);
  }

  async end() {
    await this.pool.end();
  }

  // ─── Generic ───────────────────────────────────────

  async all(table) {
    if (!TABLES.has(table)) return [];
    const { rows } = await this.pool.query(`SELECT * FROM ${table}`);
    return rows;
  }

  async count(table) {
    if (!TABLES.has(table)) return 0;
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    return rows[0].n;
  }

  // ─── Users ─────────────────────────────────────────

  async getUser(id) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async getUserByTelegram(telegramId) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    return rows[0] || null;
  }

  async getUserByPhone(phone) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE phone = $1', [normalizePhone(phone)]);
    return rows[0] || null;
  }

  async createUser(data) {
    const id = genId('usr');
    const { rows } = await this.pool.query(
      `INSERT INTO users
         (id, telegram_id, phone, exam_type, subjects, delivery_hour, delivery_minute,
          channel, questions_per_subject, subscription_status, trial_start, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'trial', now(), now(), now())
       RETURNING *`,
      [
        id,
        data.telegram_id ?? null,
        data.phone ?? null,
        data.exam_type ?? null,
        JSON.stringify(data.subjects ?? []),
        data.delivery_hour ?? 7,
        data.delivery_minute ?? 0,
        data.channel ?? 'telegram',
        data.questions_per_subject ?? 10,
      ]
    );
    return rows[0];
  }

  async updateUser(id, updates) {
    const plainCols = new Set([
      'subscription_status', 'subscription_expiry', 'phone', 'exam_type',
      'delivery_hour', 'delivery_minute', 'channel', 'questions_per_subject',
    ]);
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(updates)) {
      if (plainCols.has(k)) { sets.push(`${k} = $${i++}`); vals.push(v); }
      else if (k === 'subjects') { sets.push(`subjects = $${i++}::jsonb`); vals.push(JSON.stringify(v)); }
    }
    sets.push('updated_at = now()');
    vals.push(id);
    const { rows } = await this.pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals
    );
    return rows[0] || null;
  }

  async getUsersDueForDelivery(hour, minute) {
    const { rows } = await this.pool.query(
      `SELECT * FROM users
       WHERE subscription_status IN ('trial', 'active')
         AND (subscription_expiry IS NULL OR subscription_expiry >= now())
         AND COALESCE(delivery_hour, 7) = $1
         AND COALESCE(delivery_minute, 0) = $2`,
      [hour, minute]
    );
    return rows;
  }

  // ─── Questions ─────────────────────────────────────

  async getQuestionsBySubject(subject, count, opts = {}) {
    const { excludeIds = [], exam = null } = opts;
    const { rows } = await this.pool.query(
      `SELECT * FROM questions
       WHERE subject = $1
         AND ($2::text IS NULL OR exam = $2)
         AND NOT (id = ANY($3::text[]))
       ORDER BY COALESCE(times_used, 0) ASC`,
      [subject, exam, excludeIds]
    );
    return rows;
  }

  async getQuestion(id) {
    const { rows } = await this.pool.query('SELECT * FROM questions WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async getQuestionsByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const { rows } = await this.pool.query('SELECT * FROM questions WHERE id = ANY($1::text[])', [ids]);
    return rows;
  }

  async addQuestion(question) {
    const id = question.id || genId('q');
    const { rows } = await this.pool.query(
      `INSERT INTO questions
         (id, subject, exam, year, topic, difficulty, text, options, answer, explanation, source, times_used, last_used, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,0,NULL,now())
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        id, question.subject ?? null, question.exam ?? null, question.year ?? null,
        question.topic ?? null, question.difficulty ?? null, question.text ?? null,
        JSON.stringify(question.options ?? {}), question.answer ?? null, question.explanation ?? null,
        question.source ?? null,
      ]
    );
    return rows[0];
  }

  async markQuestionUsed(id) {
    await this.pool.query(
      'UPDATE questions SET times_used = COALESCE(times_used, 0) + 1, last_used = now() WHERE id = $1', [id]
    );
  }

  async getTotalQuestions() {
    const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM questions');
    return rows[0].n;
  }

  // ─── Responses ─────────────────────────────────────

  async recordResponse(data) {
    const id = genId('rsp');
    const { rows } = await this.pool.query(
      `INSERT INTO responses (id, user_id, question_id, chosen_answer, correct, answered_at)
       VALUES ($1,$2,$3,$4,$5,now()) RETURNING *`,
      [id, data.user_id, data.question_id, data.chosen_answer, data.correct]
    );
    return rows[0];
  }

  async getResponses(userId, opts = {}) {
    const { limit = 1000, since = null } = opts;
    const { rows } = await this.pool.query(
      `SELECT * FROM responses
       WHERE user_id = $1 AND ($2::timestamptz IS NULL OR answered_at >= $2)
       ORDER BY answered_at DESC LIMIT $3`,
      [userId, since, limit]
    );
    return rows;
  }

  async getResponsesByDate(userId, date) {
    const { rows } = await this.pool.query(
      `SELECT * FROM responses
       WHERE user_id = $1 AND answered_at >= $2::date AND answered_at < ($2::date + interval '1 day')`,
      [userId, date]
    );
    return rows;
  }

  async getAllUserResponseDates(userId) {
    const { rows } = await this.pool.query(
      'SELECT answered_at FROM responses WHERE user_id = $1', [userId]
    );
    return rows.map(r => new Date(r.answered_at).toISOString());
  }

  // ─── Subscriptions ─────────────────────────────────

  async createSubscription(data) {
    const id = genId('sub');
    const { rows } = await this.pool.query(
      `INSERT INTO subscriptions (id, user_id, plan, status, start_date, end_date, tx_ref, amount, flw_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) RETURNING *`,
      [id, data.user_id, data.plan, data.status, data.start_date ?? null, data.end_date ?? null,
       data.tx_ref ?? null, data.amount ?? null, data.flw_id ?? null]
    );
    return rows[0];
  }

  async getActiveSubscription(userId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`, [userId]
    );
    return rows[0] || null;
  }

  async getAllSubscriptions(userId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC', [userId]
    );
    return rows;
  }

  async getTotalRevenue() {
    const plans = { weekly: 500, monthly: 1500, termly: 4000, yearly: 12000 };
    const { rows } = await this.pool.query("SELECT plan FROM subscriptions WHERE status = 'active'");
    return rows.reduce((sum, s) => sum + (plans[s.plan] || 0), 0);
  }

  // ─── Dispatches ────────────────────────────────────

  async logDispatch(userId, questionIds) {
    await this.pool.query(
      `INSERT INTO dispatches (user_id, question_ids, dispatched_at) VALUES ($1, $2::jsonb, now())`,
      [userId, JSON.stringify(questionIds)]
    );
  }

  async getTodayDispatches(userId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM dispatches WHERE user_id = $1 AND dispatched_at >= date_trunc('day', now())`,
      [userId]
    );
    return rows;
  }

  async getAllDispatchedIds(userId) {
    const { rows } = await this.pool.query(
      'SELECT question_ids FROM dispatches WHERE user_id = $1', [userId]
    );
    return rows.flatMap(d => d.question_ids || []);
  }

  // ─── Sessions (registration state, shared across instances) ──

  async getSession(key) {
    const { rows } = await this.pool.query('SELECT data FROM sessions WHERE key = $1', [key]);
    return rows[0]?.data || {};
  }

  async setSession(key, data) {
    await this.pool.query(
      `INSERT INTO sessions (key, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET data = $2::jsonb, updated_at = now()`,
      [key, JSON.stringify(data || {})]
    );
  }

  async deleteSession(key) {
    await this.pool.query('DELETE FROM sessions WHERE key = $1', [key]);
  }
}
