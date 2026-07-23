const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
const { telegrafThrottler } = require('telegraf-throttler');
const fs = require('fs');
const { BOT_TOKEN, ADMIN_CHAT_ID, DB_PATH } = require('./config');
const { initDatabase } = require('./database');
const db = require('./database');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerUserHandlers } = require('./handlers/user');
const { extractUtr, extractAmount } = require('./utils/regex');
const { notifyTransactionCaptured } = require('./utils/notifications');

// Initialize database
initDatabase();

const bot = new Telegraf(BOT_TOKEN);

// Rate limiter middleware to prevent Telegram 429 errors
const throttler = telegrafThrottler();
bot.use(throttler);

// Global error handling — bot should not crash on bad inputs
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  try {
    ctx.reply('Something went wrong. Please try /start again.').catch(() => {});
  } catch {
    // ignore
  }
});

// Register bot handlers (Admin & User)
registerAdminHandlers(bot);
registerUserHandlers(bot);

// Launch Telegraf Bot
bot.launch().then(() => {
  console.log('✅ License bot is running...');
  console.log('Bot: @freeflowkeybot | Admin chat:', ADMIN_CHAT_ID);
});

// Express Webhook Server for MacroDroid / Bank SMS
const app = express();
app.use(bodyParser.json());

app.post('/macrodroid-webhook', async (req, res) => {
  try {
    const { secret, sms_text } = req.body || {};
    const expectedSecret = process.env.WEBHOOK_SECRET || 'macrodroid_secret_key';

    if (!secret || secret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized: Invalid secret' });
    }

    if (!sms_text || typeof sms_text !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid sms_text' });
    }

    const utr = extractUtr(sms_text);
    const amount = extractAmount(sms_text);

    if (!utr || amount === null) {
      return res.status(200).json({ success: false, reason: 'Could not extract UTR or amount from SMS text' });
    }

    const result = db.insertTransaction(utr, amount);

    if (result.duplicate) {
      return res.status(200).json({ success: false, reason: 'duplicate', utr, amount });
    }

    await notifyTransactionCaptured(bot, utr, amount);
    return res.status(200).json({ success: true, utr, amount });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook HTTP server listening on port ${PORT}`);
});

// 24-Hour Off-Site Database Backup to Admin Chat
const BACKUP_INTERVAL = 24 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    if (fs.existsSync(DB_PATH)) {
      await bot.telegram.sendDocument(
        ADMIN_CHAT_ID,
        {
          source: DB_PATH,
          filename: `bot-backup-${new Date().toISOString().slice(0, 10)}.db`,
        },
        { caption: '📦 <b>Daily Database Backup</b>', parse_mode: 'HTML' }
      );
      console.log('✅ Daily DB backup sent to admin chat');
    }
  } catch (err) {
    console.error('Failed to send daily DB backup:', err.message);
  }
}, BACKUP_INTERVAL);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
