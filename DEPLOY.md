# Deployment Guide for Book Status Checker Worker

This guide explains how to deploy the Cloudflare Worker that checks book status every 10 minutes and sends Telegram notifications.

## Prerequisites

1. **Cloudflare Account** - You're already logged in with: `ngn999@proton.me`
2. **Telegram Bot** (optional but recommended for notifications)

## Deployment Steps

### 1. Set Required Secrets

The worker needs API tokens and configuration secrets. Run these commands:

```bash
# Set the dataesb API authentication token
echo "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczpcL1wvYi5kYXRhZXNiLmNvbVwvYXBpXC92MVwvb3BlbmlkQXV0aG9yaXphdGlvblwvdXdlaVZ1ZSIsImlhdCI6MTc3NTQ1MDI5OSwiZXhwIjoxNzc1NDkzNDk5LCJuYmYiOjE3NzU0NTAyOTksImp0aSI6ImVrNzZQRVRUUjlVaXJJQTMiLCJzdWIiOjMwNjUzMzU2LCJwcnYiOiI4MzRmZWEzMGE1ODExNWFhNTgyMGEwNGZkMTE1NjE3OGI2NGMzY2NjIn0.Yl_wqc1Mh5OXe8I1x_ov6rhGkykwdiwCmmyoxeO_nRM" | npx wrangler secret put AUTH_TOKEN

# Set Telegram bot token (get from @BotFather)
echo "YOUR_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN

# Set Telegram chat ID (your user ID)
echo "YOUR_CHAT_ID" | npx wrangler secret put TELEGRAM_CHAT_ID
```

### 2. Deploy the Worker

Run the deployment command:

```bash
npx wrangler deploy
```

### 3. Verify Deployment

After deployment, you'll get a URL like:
- `https://dataesb-book-checker.YOUR_USERNAME.workers.dev`

Test it by visiting:
- `https://dataesb-book-checker.YOUR_USERNAME.workers.dev/` - Manual book check
- `https://dataesb-book-checker.YOUR_USERNAME.workers.dev/health` - Health check
- `https://dataesb-book-checker.YOUR_USERNAME.workers.dev/test-telegram` - Test Telegram notifications

## Configuration Details

### Current Configuration
- **Worker Name**: `dataesb-book-checker`
- **Book ID**: `2007176121` ("三大家绘水浒英雄传")
- **Library Code**: `2700` (余杭区图书馆)
- **Check Frequency**: Every 10 minutes (`*/10 * * * *`)
- **Notifications**: Telegram (when books become available)

### Monitoring
View logs in real-time:
```bash
npx wrangler tail
```

### Update Configuration

To change book ID or other settings, edit `wrangler.jsonc` and redeploy:

```bash
# After editing wrangler.jsonc
npx wrangler deploy
```

## Telegram Bot Setup (Optional)

### 1. Create a Telegram Bot
1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Use `/newbot` to create a new bot
3. Copy the bot token (looks like `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your Chat ID
1. Start a chat with your new bot
2. Message [@userinfobot](https://t.me/userinfobot) to get your chat ID
3. Or visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`

### 3. Set Telegram Secrets
```bash
echo "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz" | npx wrangler secret put TELEGRAM_BOT_TOKEN
echo "987654321" | npx wrangler secret put TELEGRAM_CHAT_ID
```

## Worker Endpoints

- `/` or `/check` - Manual book status check
- `/health` - Health check (returns "OK")
- `/test-telegram` - Test Telegram notifications

## Cron Schedule

The worker runs automatically every 10 minutes with this cron expression: `*/10 * * * *`

This means it runs at:
- 00, 10, 20, 30, 40, 50 minutes past every hour
- 24/7 monitoring

## Troubleshooting

### Common Issues

1. **Authentication Error**: The AUTH_TOKEN might have expired. Get a new token from the dataesb API.

2. **Telegram Not Working**: 
   - Verify bot token and chat ID
   - Send `/start` to your bot first
   - Check bot privacy settings in @BotFather

3. **KV Namespace Errors**: On first deploy, KV namespace will be auto-created.

4. **Cron Not Running**: 
   - Check worker logs: `npx wrangler tail`
   - Verify deployment: `npx wrangler deploy --dry-run`

### Logs and Monitoring

```bash
# View live logs
npx wrangler tail

# Filter for errors
npx wrangler tail --status error

# Specific search term
npx wrangler tail --search "book check"
```

## Update Worker Code

After making changes:

```bash
# TypeScript compilation check
npx tsc --noEmit

# Generate updated types
npx wrangler types

# Deploy changes
npx wrangler deploy
```

## Support

For issues with:
- Cloudflare Workers: [Cloudflare Docs](https://developers.cloudflare.com/workers/)
- Wrangler CLI: `npx wrangler docs`
- This project: Check the code in `src/` directory