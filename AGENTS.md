# AGENTS.md — ExamPrep Agent

## What This Is

A JAMB/SSCE daily question drill agent. Students register via Telegram or WhatsApp, pick subjects, and receive 20 questions daily at their scheduled time. Payments handled through Flutterwave (collecting NGN, settling to GBP).

## Architecture

```
Telegram Bot ←→ Node.js Agent ←→ WhatsApp Cloud API
                     │
              ┌──────┼──────┐
              │      │      │
         Question  Scheduler  Payments
          Engine   (cron)    (Flutterwave)
              │      │      │
              └──────┼──────┘
                     │
              Express Server
           (webhooks on :3456)
```

## Quick Start

```bash
cd exam-prep-agent
cp .env.example .env
# Fill in your keys
npm install
npm run seed    # Populate question bank
npm start       # Launch everything
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.js` | Entry point — starts bot, server, scheduler |
| `src/db.js` | JSONL-based data layer (swap for PG at scale) |
| `src/question-engine.js` | Daily question set generator |
| `src/telegram-bot.js` | Telegram registration + answer handling |
| `src/whatsapp-sender.js` | WhatsApp Cloud API integration |
| `src/payments.js` | Flutterwave payment links + webhook processing |
| `src/scheduler.js` | CRON dispatcher (checks every minute) |
| `src/server.js` | Express server for Flutterwave + WA webhooks |
| `src/analytics.js` | Stats, leaderboards, admin dashboard |
| `config/subjects.js` | All subjects, topics, plans, constants |
| `scripts/seed-questions.js` | Initial question bank (60 questions to start) |

## Environment Variables

All in `.env`:
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` — Meta Business
- `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET` — Flutterwave dashboard
- `PORT` — webhook server port (default 3456)

## Data

All data stored as JSONL files in `./data/`:
- `users.jsonl` — student profiles
- `questions.jsonl` — question bank
- `responses.jsonl` — every answer ever given
- `subscriptions.jsonl` — payment records
- `dispatches.jsonl` — daily question dispatch log

## Flows

### Registration Flow
1. Student sends /start on Telegram
2. Picks exam type (JAMB/SSCE/NECO)
3. Picks subject combination (preset or custom)
4. Sets delivery time (WAT)
5. Chooses channel (Telegram or WhatsApp)
6. Gets 3-day free trial

### Daily Delivery Flow
1. Scheduler fires at user's delivery time (WAT)
2. Question engine generates 20 questions
3. Questions sent via Telegram inline keyboard or WhatsApp interactive buttons
4. Student taps answers → instant feedback
5. After Q20 → final report with score, streak, weak areas

### Payment Flow
1. Student opens /subscribe or gets trial-expired notification
2. Selects plan → gets Flutterwave payment link
3. Pays via card/bank transfer/USSD on Flutterwave checkout
4. Flutterwave webhook hits /webhook/flutterwave
5. Subscription activated automatically
6. Confirmation message sent to student

## Red Lines
- Never share student data externally
- Never modify subscription records manually without explicit request
- Test payments ONLY in Flutterwave sandbox mode
- Question quality matters — always verify before adding to bank
