// src/config/container.js
// Dependency Injection container — the composition root.
// Wires all layers together. No circular dependencies.
import { JsonlRepository } from '../infrastructure/repositories/JsonlRepository.js';
import { PgRepository } from '../infrastructure/repositories/PgRepository.js';
import { FlutterwaveGateway } from '../infrastructure/payment/FlutterwaveGateway.js';
import { TelegramChannel } from '../infrastructure/messaging/TelegramChannel.js';
import { WhatsAppChannel } from '../infrastructure/messaging/WhatsAppChannel.js';
import { CronScheduler } from '../infrastructure/scheduler/CronScheduler.js';
import { runDailyGeneration } from '../infrastructure/generation/dailyGenerator.js';
import { DeepSeekClient } from '../infrastructure/ai/DeepSeekClient.js';

import { UserService } from '../services/UserService.js';
import { QuestionService } from '../services/QuestionService.js';
import { PaymentService } from '../services/PaymentService.js';
import { SubscriptionService } from '../services/SubscriptionService.js';
import { DispatchService } from '../services/DispatchService.js';
import { AnalyticsService } from '../services/AnalyticsService.js';
import { CoachService } from '../services/CoachService.js';

import { TelegramBotAdapter } from '../presentation/TelegramBot.js';
import { WhatsAppBotAdapter } from '../presentation/WhatsAppBotAdapter.js';
import { HttpServer } from '../presentation/HttpServer.js';

export async function buildContainer(env) {
  // ─── Infrastructure ────────────────────────────────

  // Postgres in production (DATABASE_URL set); JSONL files for local/dev fallback.
  const repo = env.DATABASE_URL
    ? new PgRepository(env.DATABASE_URL)
    : new JsonlRepository();
  if (typeof repo.init === 'function') await repo.init();
  console.log(`🗄️  Repository: ${env.DATABASE_URL ? 'Postgres' : 'JSONL files'}`);

  const flutterwave = new FlutterwaveGateway({
    secretKey: env.FLUTTERWAVE_SECRET_KEY,
    publicKey: env.FLUTTERWAVE_PUBLIC_KEY,
    webhookSecret: env.FLUTTERWAVE_WEBHOOK_SECRET,
    redirectUrl: env.FLUTTERWAVE_REDIRECT_URL,
  });

  // Webhook mode when a public URL is available (production); polling locally.
  const webhookBase = env.WEBHOOK_BASE_URL
    || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : null);
  const telegramChannel = new TelegramChannel(env.TELEGRAM_BOT_TOKEN, {
    ratePerSec: Number(env.TELEGRAM_RATE_PER_SEC) || 25,
    webhookUrl: webhookBase ? `${webhookBase.replace(/\/+$/, '')}/webhook/telegram` : null,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || null,
  });

  const whatsappChannel = new WhatsAppChannel({
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
    ratePerSec: Number(env.WHATSAPP_RATE_PER_SEC) || 20,
  });

  // ─── Services ──────────────────────────────────────

  const userService = new UserService({ repo });
  const questionService = new QuestionService({ repo });
  const paymentService = new PaymentService({ repo, flutterwave });
  const subscriptionService = new SubscriptionService({ repo });
  const analyticsService = new AnalyticsService({ repo });

  // In-app AI (coach notes, misconception spotting). Reuses the DeepSeek creds
  // already on Railway for nightly generation; degrades gracefully if absent.
  const ai = new DeepSeekClient({
    apiKey: env.DEEPSEEK_API_KEY || env.AI_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL || env.AI_BASE_URL,
    model: env.DEEPSEEK_MODEL || env.AI_MODEL,
  });

  const dispatchService = new DispatchService({
    repo,
    questionService,
    subscriptionService,
    paymentService,
    telegram: telegramChannel,
    whatsapp: whatsappChannel,
    whatsappDailyTemplate: env.WHATSAPP_DAILY_TEMPLATE || null,
    whatsappTemplateLang: env.WHATSAPP_TEMPLATE_LANG || 'en',
  });

  // ─── Scheduler ─────────────────────────────────────

  // Daily auto-generation (predict mode: examiner-weighted from real past questions, with a
  // full-syllabus coverage floor). OFF unless GEN_ENABLED=true, so a deploy alone can't run up a
  // bill. Tunables: GEN_PER_TOPIC (volume + even coverage), GEN_MAX_PER_EXAM (hard backstop),
  // GEN_CRON (schedule, server TZ), GEN_MODE.
  const dailyJobs = [];
  if (env.GEN_ENABLED === 'true' || env.GEN_ENABLED === '1') {
    dailyJobs.push({
      name: 'question-generation',
      cron: env.GEN_CRON || '0 4 * * *',   // 04:00 server time (UTC), daily
      fn: () => runDailyGeneration({
        perTopic: Number(env.GEN_PER_TOPIC) || 4,
        maxPerExam: Number(env.GEN_MAX_PER_EXAM) || 700,
        mode: env.GEN_MODE || 'predict',
      }),
    });
    console.log('🧠 Daily question generation: ENABLED');
  }

  const coachService = new CoachService({
    repo, analyticsService, ai,
    telegram: telegramChannel,
    whatsapp: whatsappChannel,
  });

  // Weekly AI coach notes (Sunday 17:00 UTC = 18:00 WAT). On when the AI key
  // exists; COACH_ENABLED=false switches it off.
  if (ai.enabled && env.COACH_ENABLED !== 'false') {
    dailyJobs.push({
      name: 'weekly-coach-notes',
      cron: env.COACH_CRON || '0 17 * * 0',
      fn: () => coachService.runWeekly(),
    });
    console.log('🧑‍🏫 Weekly AI coach notes: ENABLED');
  }

  const scheduler = new CronScheduler(
    (hour, minute) => dispatchService.dispatchAt(hour, minute),
    dailyJobs
  );

  // ─── Presentation ──────────────────────────────────

  const telegramBot = new TelegramBotAdapter({
    channel: telegramChannel,
    userService,
    questionService,
    subscriptionService,
    paymentService,
    dispatchService,
    analyticsService,
    coachService,
  });

  const whatsappBot = new WhatsAppBotAdapter({
    channel: whatsappChannel,
    repo,
    userService,
    questionService,
    subscriptionService,
    paymentService,
    analyticsService,
  });

  const httpServer = new HttpServer({
    paymentService,
    dispatchService,
    whatsapp: whatsappChannel,
    whatsappBot,
    telegram: telegramChannel,
    repo,
  });

  return {
    repo,
    flutterwave,
    telegramChannel,
    whatsappChannel,
    userService,
    questionService,
    paymentService,
    subscriptionService,
    dispatchService,
    analyticsService,
    coachService,
    scheduler,
    telegramBot,
    whatsappBot,
    httpServer,
  };
}
