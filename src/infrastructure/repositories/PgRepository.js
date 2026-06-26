// src/infrastructure/repositories/PgRepository.js
// Postgres-backed repository. Same method contract as JsonlRepository, but async.
// Used in production (when DATABASE_URL is set); JsonlRepository remains the
// zero-dependency fallback for local dev and tests.
import pg from 'pg';
import { genId, normalizePhone, nowISO } from './helpers.js';
import { bankExam } from '../../config/subjects.js';

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
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_last4 text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS autobill_plan text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS autobill_status text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_source text;
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

CREATE TABLE IF NOT EXISTS affiliates (
  id text PRIMARY KEY,
  user_id text,                 -- bot user who owns this affiliate account
  name text,
  tag text UNIQUE,              -- the ?start= payload that attributes signups
  percent int DEFAULT 20,       -- revenue share frozen at join time
  bank_name text, account_number text, account_name text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliates_tag ON affiliates(tag);
CREATE INDEX IF NOT EXISTS idx_affiliates_user ON affiliates(user_id);

CREATE TABLE IF NOT EXISTS commissions (
  id text PRIMARY KEY,
  affiliate_id text,
  user_id text,                 -- the referred student who paid
  tx_ref text,
  plan text,
  amount_paid numeric,
  commission numeric,
  status text DEFAULT 'pending',  -- pending | paid
  created_at timestamptz DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON commissions(affiliate_id, status);

CREATE TABLE IF NOT EXISTS sessions (
  key text PRIMARY KEY,
  data jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);
`;

const TABLES = new Set(['users', 'questions', 'responses', 'subscriptions', 'dispatches', 'affiliates', 'commissions']);

export class PgRepository {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async init() {
    // Serialize schema setup across concurrent processes. Running the DDL (ALTER TABLE /
    // CREATE INDEX) from many parallel generator runs at once deadlocks — both against each
    // other and against concurrent inserts. A session advisory lock makes inits wait their turn.
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [72727401]);
      await client.query(SCHEMA);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [72727401]).catch(() => {});
      client.release();
    }
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
          channel, questions_per_subject, ref_source, subscription_status, trial_start, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11, now(), now(), now())
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
        data.ref_source ?? null,
        data.subscription_status ?? 'trial',
      ]
    );
    return rows[0];
  }

  async updateUser(id, updates) {
    const plainCols = new Set([
      'subscription_status', 'subscription_expiry', 'phone', 'exam_type',
      'delivery_hour', 'delivery_minute', 'channel', 'questions_per_subject',
      'card_token', 'card_email', 'card_last4', 'autobill_plan', 'autobill_status',
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

  // Signups + conversion per referral source (campaign tracking for channel ads).
  async getRefStats() {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(ref_source, '(organic)') AS source,
              count(*)::int AS signups,
              count(*) FILTER (WHERE subscription_status = 'active')::int AS paying,
              count(*) FILTER (WHERE subscription_status = 'trial')::int  AS on_trial,
              count(*) FILTER (WHERE subscription_status = 'expired')::int AS expired
       FROM users GROUP BY 1 ORDER BY signups DESC`
    );
    return rows;
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

  // Telegram users who received today's questions but haven't answered any yet —
  // candidates for the re-engagement nudge. Coarse access filter (trial/active);
  // the service confirms live access before sending. WhatsApp is excluded here
  // because proactive sends outside the 24h window need an approved template.
  async getUsersToNudge() {
    const { rows } = await this.pool.query(
      `SELECT u.* FROM users u
       WHERE u.telegram_id IS NOT NULL
         AND u.subscription_status IN ('trial', 'active')
         AND EXISTS (SELECT 1 FROM dispatches d
                     WHERE d.user_id = u.id AND d.dispatched_at >= date_trunc('day', now()))
         AND NOT EXISTS (SELECT 1 FROM responses r
                         WHERE r.user_id = u.id AND r.answered_at >= date_trunc('day', now()))`
    );
    return rows;
  }

  // Students for the daily sign-up reminder: real students (never affiliates/partners) who are
  // not already paying. telegram_id required (the reminder is a Telegram DM).
  async getStudentsToRemind() {
    const { rows } = await this.pool.query(
      `SELECT id, telegram_id FROM users
       WHERE telegram_id IS NOT NULL
         AND (subscription_status IS NULL OR subscription_status NOT IN ('active', 'partner'))`
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
      [subject, bankExam(exam), excludeIds]
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

  async updateQuestionTopic(id, topic) {
    await this.pool.query('UPDATE questions SET topic = $1 WHERE id = $2', [topic, id]);
  }

  async updateQuestionExplanation(id, explanation) {
    await this.pool.query('UPDATE questions SET explanation = $1 WHERE id = $2', [explanation, id]);
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

  // Used by payment reconciliation to detect webhook-dropped payments.
  async getSubscriptionByTxRef(txRef) {
    const { rows } = await this.pool.query(
      'SELECT * FROM subscriptions WHERE tx_ref = $1 LIMIT 1', [txRef]
    );
    return rows[0] || null;
  }

  async getTotalRevenue() {
    // Sum what was actually paid — survives price changes over time.
    const { rows } = await this.pool.query(
      "SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM subscriptions WHERE status = 'active'"
    );
    return Number(rows[0].total);
  }

  // Questions a user has answered — used to personalise the trial-ending paywall.
  async getAnswerCount(userId) {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS n FROM responses WHERE user_id = $1', [userId]
    );
    return rows[0].n;
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

  // ─── Affiliates & commissions ──────────────────────

  async createAffiliate({ user_id, name, tag, percent }) {
    const id = genId('aff');
    const { rows } = await this.pool.query(
      `INSERT INTO affiliates (id, user_id, name, tag, percent, status, created_at)
       VALUES ($1,$2,$3,$4,$5,'active', now()) RETURNING *`,
      [id, user_id ?? null, name ?? null, tag, percent ?? 20]
    );
    return rows[0];
  }

  async getAffiliateByUser(userId) {
    const { rows } = await this.pool.query('SELECT * FROM affiliates WHERE user_id = $1', [userId]);
    return rows[0] || null;
  }

  async getAffiliateByTag(tag) {
    const { rows } = await this.pool.query("SELECT * FROM affiliates WHERE tag = $1 AND status = 'active'", [tag]);
    return rows[0] || null;
  }

  async updateAffiliateBank(id, { bank_name, account_number, account_name }) {
    const { rows } = await this.pool.query(
      'UPDATE affiliates SET bank_name = $1, account_number = $2, account_name = $3 WHERE id = $4 RETURNING *',
      [bank_name, account_number, account_name, id]
    );
    return rows[0] || null;
  }

  async createCommission({ affiliate_id, user_id, tx_ref, plan, amount_paid, commission }) {
    const id = genId('com');
    const { rows } = await this.pool.query(
      `INSERT INTO commissions (id, affiliate_id, user_id, tx_ref, plan, amount_paid, commission, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending', now()) RETURNING *`,
      [id, affiliate_id, user_id, tx_ref ?? null, plan ?? null, amount_paid, commission]
    );
    return rows[0];
  }

  // One affiliate's headline numbers: referred signups, how many pay, earnings.
  async getAffiliateEarnings(affiliateId, tag) {
    const { rows: u } = await this.pool.query(
      `SELECT count(*)::int AS referred,
              count(*) FILTER (WHERE subscription_status = 'active')::int AS paying
       FROM users WHERE ref_source = $1`, [tag]
    );
    const { rows: c } = await this.pool.query(
      `SELECT COALESCE(SUM(commission), 0)::numeric AS earned,
              COALESCE(SUM(commission) FILTER (WHERE status = 'pending'), 0)::numeric AS pending
       FROM commissions WHERE affiliate_id = $1`, [affiliateId]
    );
    return {
      referred: u[0].referred,
      paying: u[0].paying,
      earned: Number(c[0].earned),
      pending: Number(c[0].pending),
    };
  }

  // Active affiliates with a Telegram contact + headline stats — for the daily digest.
  // (referred/paying mirror getAffiliateEarnings; commissions summed per affiliate.)
  async getAffiliatesForDigest() {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.tag, u.telegram_id,
              (SELECT count(*) FROM users ru WHERE ru.ref_source = a.tag)::int AS referred,
              (SELECT count(*) FROM users ru WHERE ru.ref_source = a.tag AND ru.subscription_status = 'active')::int AS paying,
              COALESCE((SELECT SUM(commission) FROM commissions c WHERE c.affiliate_id = a.id), 0)::numeric AS earned,
              COALESCE((SELECT SUM(commission) FROM commissions c WHERE c.affiliate_id = a.id AND c.status = 'pending'), 0)::numeric AS pending
       FROM affiliates a
       JOIN users u ON u.id = a.user_id
       WHERE a.status = 'active' AND u.telegram_id IS NOT NULL`
    );
    return rows.map(r => ({
      id: r.id, tag: r.tag, telegram_id: r.telegram_id,
      referred: Number(r.referred), paying: Number(r.paying),
      earned: Number(r.earned), pending: Number(r.pending),
    }));
  }

  // Admin payout view: every affiliate with pending commission, plus bank details.
  async getPendingPayouts() {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.name, a.tag, a.bank_name, a.account_number, a.account_name,
              COALESCE(SUM(c.commission), 0)::numeric AS pending
       FROM affiliates a
       JOIN commissions c ON c.affiliate_id = a.id AND c.status = 'pending'
       GROUP BY a.id ORDER BY pending DESC`
    );
    return rows.map(r => ({ ...r, pending: Number(r.pending) }));
  }

  async markCommissionsPaid(affiliateId) {
    const { rowCount } = await this.pool.query(
      "UPDATE commissions SET status = 'paid', paid_at = now() WHERE affiliate_id = $1 AND status = 'pending'",
      [affiliateId]
    );
    return rowCount;
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
