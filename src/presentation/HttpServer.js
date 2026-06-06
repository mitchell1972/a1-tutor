// src/presentation/HttpServer.js
// Presentation adapter: Express server for Flutterwave & WhatsApp webhooks.
// Thin layer — delegates all logic to services.
import express from 'express';

export class HttpServer {
  constructor({ paymentService, dispatchService, whatsapp, questionService, repo }) {
    this.paymentService = paymentService;
    this.dispatchService = dispatchService;
    this.whatsapp = whatsapp;
    this.questionService = questionService;
    this.repo = repo;
    this.app = express();
    this._setupRoutes();
  }

  _setupRoutes() {
    // Raw body for Flutterwave signature verification
    this.app.use('/webhook/flutterwave', express.raw({ type: 'application/json' }));
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
        const parsed = this.whatsapp.parseIncoming(req.body);
        if (!parsed) return res.status(200).json({ status: 'no message' });

        if (parsed.type === 'answer') {
          const question = this.repo.getQuestion(parsed.questionId);
          if (!question) return res.status(200).json({ status: 'question not found' });

          const user = this.repo.getUserByPhone(parsed.from);
          if (!user) return res.status(200).json({ status: 'user not found' });

          const result = this.questionService.processAnswer(user.id, parsed.questionId, parsed.answer);
          if (result.error) return res.status(200).json({ status: result.error });

          const feedback = this.questionService.formatFeedback(result);
          await this.whatsapp.sendText(parsed.from, feedback);

          // Check if drill complete
          const todayDispatched = this.repo.getTodayDispatches(user.id);
          const totalToday = this.repo.getTodayDispatches(user.id)
            .reduce((sum, d) => sum + (d.question_ids?.length || 0), 0);
          const today = new Date().toISOString().split('T')[0];
          const todayResponses = this.repo.getResponsesByDate(user.id, today);

          if (todayResponses.length >= totalToday) {
            const report = this.questionService.formatDailyReport(user.id, todayResponses);
            await this.whatsapp.sendText(parsed.from, report);
          }
        }

        res.status(200).json({ status: 'ok' });
      } catch (err) {
        console.error('WhatsApp webhook error:', err);
        res.status(500).json({ error: 'internal' });
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
