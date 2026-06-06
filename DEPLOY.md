# Deploy A1 Tutor to Railway

## One-time Setup

### 1. Push to GitHub

```bash
cd ~/Documents/exam-prep-agent

# Create a repo on GitHub first (https://github.com/new)
# Name it e.g. "a1-tutor"

git add .
git commit -m "Ready for Railway deployment"
git remote add origin https://github.com/YOUR_USERNAME/a1-tutor.git
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Select the `a1-tutor` repo
3. Railway auto-detects Node.js and the `start` script

### 3. Mount a Volume (persistent data)

1. In your Railway project → **Service** → **Settings** → **Volumes**
2. Add volume: mount path `/app/data`
3. Railway uses this to persist your database across deploys

### 4. Set Environment Variables

Go to **Variables** tab and add these:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather) |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Cloud API |
| `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API |
| `WHATSAPP_VERIFY_TOKEN` | Any string you choose |
| `FLUTTERWAVE_PUBLIC_KEY` | `FLWPUBK-...` |
| `FLUTTERWAVE_SECRET_KEY` | `FLWSECK-...` |
| `FLUTTERWAVE_ENCRYPTION_KEY` | Your encryption key |
| `FLUTTERWAVE_WEBHOOK_SECRET` | `exambot_webhook_2025` |
| `PORT` | `3456` |
| `DATA_DIR` | `/app/data` |
| `DEFAULT_DELIVERY_HOUR` | `7` |
| `DEFAULT_DELIVERY_MINUTE` | `0` |

### 5. Set the Webhook URL in Flutterwave

Once deployed, your Railway URL will look like:

```
https://a1-tutor.up.railway.app
```

Update the Flutterwave webhook URL to:

```
https://a1-tutor.up.railway.app/webhook/flutterwave
```

## Deploying Updates

```bash
git add .
git commit -m "Describe your changes"
git push
```

Railway auto-deploys on push. 🚀

## Monitoring

- **Health check:** `https://a1-tutor.up.railway.app/health`
- **Railway dashboard:** Logs, metrics, and deploy history
- **Cost:** ~$5/month (512MB RAM, 1 vCPU)
