// src/presentation/HttpServer.js
// Presentation adapter: Express server for Flutterwave & WhatsApp webhooks.
// Thin layer — delegates all logic to services.
import express from 'express';

export class HttpServer {
  constructor({ paymentService, dispatchService, whatsapp, whatsappBot, telegram, repo }) {
    this.paymentService = paymentService;
    this.dispatchService = dispatchService;
    this.whatsapp = whatsapp;
    this.whatsappBot = whatsappBot;
    this.telegram = telegram;
    this.repo = repo;
    this.app = express();
    this._setupRoutes();
  }

  _setupRoutes() {
    // Raw body for webhook signature verification (both providers sign the raw bytes)
    this.app.use('/webhook/flutterwave', express.raw({ type: 'application/json' }));
    this.app.use('/webhook/whatsapp', express.raw({ type: 'application/json' }));
    this.app.use(express.json());

    // ─── Flutterwave ──────────────────────────────────

    this.app.post('/webhook/flutterwave', async (req, res) => {
      try {
        const signature = req.headers['verif-hash'];
        const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        if (signature && !this.paymentService.flutterwave.verifyWebhook(signature, payload)) {
          console.warn('Invalid Flutterwave webhook signature');
          return res.status(401).json({ error: 'invalid signature' });
        }

        const result = await this.paymentService.processWebhook(payload);

        if (result.action === 'activated') {
          await this.dispatchService.notifyPaymentConfirmed(
            result.userId, result.plan, result.endDate
          );
        }

        res.status(200).json({ status: 'ok' });
      } catch (err) {
        console.error('Webhook error:', err);
        res.status(500).json({ error: 'internal' });
      }
    });

    // ─── WhatsApp ─────────────────────────────────────

    this.app.get('/webhook/whatsapp', (req, res) => {
      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
      const result = this.whatsapp.verifyWebhook(mode, token, challenge);

      if (result.verified) {
        res.status(200).send(result.challenge);
      } else {
        res.status(403).send('Verification failed');
      }
    });

    this.app.post('/webhook/whatsapp', async (req, res) => {
      try {
        // Verify Meta's signature over the raw body (the "secret stamp")
        const signature = req.headers['x-hub-signature-256'];
        if (!this.whatsapp.verifySignature(req.body, signature)) {
          console.warn('Invalid WhatsApp webhook signature — rejecting');
          return res.status(401).json({ error: 'invalid signature' });
        }

        const json = JSON.parse(req.body.toString('utf-8'));
        const parsed = this.whatsapp.parseIncoming(json);
        if (parsed) await this.whatsappBot.handleInbound(parsed);

        res.status(200).json({ status: 'ok' });
      } catch (err) {
        console.error('WhatsApp webhook error:', err);
        // Respond 200 so Meta doesn't retry-storm on a logic/parse error.
        res.status(200).json({ status: 'error' });
      }
    });

    // ─── Telegram (webhook mode) ──────────────────────

    this.app.post('/webhook/telegram', (req, res) => {
      try {
        if (this.telegram?.webhookSecret) {
          const got = req.headers['x-telegram-bot-api-secret-token'];
          if (got !== this.telegram.webhookSecret) {
            console.warn('Invalid Telegram webhook secret — rejecting');
            return res.status(401).json({ error: 'invalid secret' });
          }
        }
        this.telegram.processUpdate(req.body);
        res.sendStatus(200);
      } catch (err) {
        console.error('Telegram webhook error:', err);
        res.sendStatus(200); // ack so Telegram doesn't retry-storm
      }
    });

    // ─── Health ───────────────────────────────────────

    this.app.get('/health', async (req, res) => {
      try {
        res.json({
          status: 'ok',
          uptime: process.uptime(),
          questions: await this.repo.getTotalQuestions(),
          users: (await this.repo.all('users')).length,
        });
      } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
      }
    });
  }

  start(port = 3456) {
    return new Promise((resolve) => {
      this.app.listen(port, () => {
        console.log(`🌐 HTTP server on :${port}`);
        console.log(`   Flutterwave webhook: POST /webhook/flutterwave`);
        console.log(`   WhatsApp webhook:    POST /webhook/whatsapp`);
        resolve();
      });
    });
  }
}
