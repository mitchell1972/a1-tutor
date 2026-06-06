# ExamPrep Agent

JAMB/SSCE daily question drill bot for Nigerian students.  
20 questions/day via Telegram or WhatsApp. Flutterwave payments (NGN → GBP).

## Quick Start

```bash
cp .env.example .env
# Edit .env with your keys:
#   TELEGRAM_BOT_TOKEN (from @BotFather)
#   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN (from Meta Business)
#   FLUTTERWAVE_PUBLIC_KEY, FLUTTERWAVE_SECRET_KEY (from Flutterwave dashboard)

npm install
npm run seed     # Populate question bank (60 questions)
npm start        # Launch Telegram bot + webhook server + scheduler
```

## Registration Flow

1. Student sends `/start` on Telegram
2. Picks exam → subjects → delivery time → channel
3. Gets 3-day free trial
4. Questions arrive daily at chosen time

## Payment

| Plan | Price (NGN) | Duration |
|------|-------------|----------|
| Weekly | ₦500 | 7 days |
| Monthly | ₦1,500 | 30 days |
| Termly | ₦4,000 | 90 days |
| Yearly | ₦12,000 | 365 days |

Students pay via Flutterwave (card, bank transfer, USSD).  
You receive GBP in your UK account.

## Architecture

```
Telegram Bot (node-telegram-bot-api)
         │
    Express Server (:3456)
    ├── /webhook/flutterwave  ← Flutterwave payment confirmations
    └── /webhook/whatsapp     ← WhatsApp incoming messages
         │
    Scheduler (node-cron)
    ├── Checks every minute for due deliveries
    └── Dispatches via Telegram or WhatsApp
         │
    Question Engine
    ├── Picks 20 questions across subjects
    ├── Balances difficulty (30/40/30 easy/medium/hard)
    └── Ensures fair rotation (least-used first)
```

## Adding Questions

Edit `scripts/seed-questions.js` and add entries following this format:

```js
{
  subject: 'physics',        // Must match config/subjects.js
  exam: 'jamb',              // jamb | ssce | neco
  year: 2024,
  topic: 'mechanics',        // Must match subject's topics in config
  difficulty: 2,             // 1 = easy, 2 = medium, 3 = hard
  text: 'Question text here',
  options: { A: '...', B: '...', C: '...', D: '...' },
  answer: 'A',
  explanation: 'Why A is correct'
}
```

Then run `npm run seed` again. (It won't duplicate if questions already exist.)

## Scaling Notes

- **Current:** JSONL files in `./data/` — fine for <10,000 users
- **At scale:** Swap `src/db.js` for PostgreSQL. The interface stays identical.
- **WhatsApp rate limits:** Meta allows ~80 msgs/sec for approved businesses. The 4-second delay between questions keeps you well within limits.

## Project Structure

```
exam-prep-agent/
├── config/subjects.js      # All constants, subject definitions, plans
├── data/                   # JSONL database files
├── scripts/seed-questions.js
├── src/
│   ├── index.js            # Entry point
│   ├── db.js               # Data layer
│   ├── question-engine.js  # Question picker + formatter
│   ├── telegram-bot.js     # Telegram handlers
│   ├── whatsapp-sender.js  # WhatsApp Cloud API
│   ├── payments.js         # Flutterwave integration
│   ├── scheduler.js        # Daily dispatch
│   ├── server.js           # Express webhooks
│   └── analytics.js        # Stats + reporting
├── AGENTS.md
├── SOUL.md
├── package.json
└── .env.example
```
