// src/config/container.js
// Dependency Injection container — the composition root.
// Wires all layers together. No circular dependencies.
import { JsonlRepository } from '../infrastructure/repositories/JsonlRepository.js';
import { FlutterwaveGateway } from '../infrastructure/payment/FlutterwaveGateway.js';
import { TelegramChannel } from '../infrastructure/messaging/TelegramChannel.js';
import { WhatsAppChannel } from '../infrastructure/messaging/WhatsAppChannel.js';
import { CronScheduler } from '../infrastructure/scheduler/CronScheduler.js';

import { UserService } from '../services/UserService.js';
import { QuestionService } from '../services/QuestionService.js';
import { PaymentService } from '../services/PaymentService.js';
import { SubscriptionService } from '../services/SubscriptionService.js';
import { DispatchService } from '../services/DispatchService.js';
import { AnalyticsService } from '../services/AnalyticsService.js';

import { TelegramBotAdapter } from '../presentation/TelegramBot.js';
import { WhatsAppBotAdapter } from '../presentation/WhatsAppBotAdapter.js';
import { HttpServer } from '../presentation/HttpServer.js';

export async function buildContainer(env) {
  // ─── Infrastructure ────────────────────────────────

  const repo = new JsonlRepository();

  const flutterwave = new FlutterwaveGateway({
    secretKey: env.FLUTTERWAVE_SECRET_KEY,
    publicKey: env.FLUTTERWAVE_PUBLIC_KEY,
    webhookSecret: env.FLUTTERWAVE_WEBHOOK_SECRET,
    redirectUrl: env.FLUTTERWAVE_REDIRECT_URL,
  });

  const telegramChannel = new TelegramChannel(env.TELEGRAM_BOT_TOKEN);

  const whatsappChannel = new WhatsAppChannel({
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
  });

  // ─── Services ──────────────────────────────────────

  const userService = new UserService({ repo });
  const questionService = new QuestionService({ repo });
  const paymentService = new PaymentService({ repo, flutterwave });
  const subscriptionService = new SubscriptionService({ repo });
  const analyticsService = new AnalyticsService({ repo });

  const dispatchService = new DispatchService({
    repo,
    questionService,
    subscriptionService,
    telegram: telegramChannel,
    whatsapp: whatsappChannel,
    whatsappDailyTemplate: env.WHATSAPP_DAILY_TEMPLATE || null,
    whatsappTemplateLang: env.WHATSAPP_TEMPLATE_LANG || 'en',
  });

  // ─── Scheduler ─────────────────────────────────────

  const scheduler = new CronScheduler(
    (hour, minute) => dispatchService.dispatchAt(hour, minute)
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
    scheduler,
    telegramBot,
    whatsappBot,
    httpServer,
  };
}
