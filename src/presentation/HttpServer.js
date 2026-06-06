// src/presentation/HttpServer.js
// Presentation adapter: Express server for Flutterwave & WhatsApp webhooks.
// Thin layer — delegates all logic to services.
import express from 'express';

export class HttpServer {
  constructor({ paymentService, dispatchService, whatsapp, whatsappBot, repo }) {
    this.paymentService = paymentService;
    this.dispatchService = dispatchService;
    this.whatsapp = whatsapp;
    this.whatsappBot = whatsappBot;
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

    // ─── Health ───────────────────────────────────────

    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        uptime: process.uptime(),
        questions: this.repo.getTotalQuestions(),
        users: this.repo.all('users').length,
      });
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
