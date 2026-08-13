const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
const { telegrafThrottler } = require('telegraf-throttler');
const ExcelJS = require('exceljs');
const { BOT_TOKEN, ADMIN_CHAT_ID, DB_PATH } = require('./config');
const { initDatabase } = require('./database');
const db = require('./database');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerUserHandlers } = require('./handlers/user');
const { extractUtr, extractAmount } = require('./utils/regex');
const { notifyTransactionCaptured } = require('./utils/notifications');

// Dedicated logs channel for automated alerts (payment, delivery, UTR failures)
const LOGS_CHAT_ID = process.env.LOGS_CHAT_ID || ADMIN_CHAT_ID;

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

bot.on('new_chat_members', async (ctx) => {
  const { DISCUSSION_GROUP_ID } = require('./config');
  if (!DISCUSSION_GROUP_ID || ctx.chat.id !== Number(DISCUSSION_GROUP_ID)) return;
  
  for (const member of ctx.message.new_chat_members) {
    if (member.is_bot) continue;
    try {
      await ctx.reply(
        `🎉 <b>Welcome to the Freeflow Inner Circle, ${member.first_name}!</b>\n\nCheck the pinned messages for the setup guide and feel free to ask questions!`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.error('Welcome failed:', e.message);
    }
  }
});

// ─── /getdata — Admin Excel Export ────────────────────────────────────────────

bot.command('getdata', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  if (ctx.from.id !== Number(ADMIN_CHAT_ID)) {
    return ctx.reply('⛔ Unauthorized.');
  }

  try {
    await ctx.reply('⏳ Generating sales data export...');

    const rows = db.getSalesData();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Freeflow Bot';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Sales Data');

    sheet.columns = [
      { header: 'Username',     key: 'username',  width: 22 },
      { header: 'User ID',      key: 'user_id',   width: 15 },
      { header: 'Key Bought',   key: 'key_string', width: 38 },
      { header: 'Plan',         key: 'category',  width: 16 },
      { header: 'Date Claimed', key: 'sold_at',   width: 22 },
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FF2B579A' },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    for (const row of rows) {
      sheet.addRow({
        username:   row.username ? `@${row.username}` : 'N/A',
        user_id:    row.user_id,
        key_string: row.key_string,
        category:   row.category,
        sold_at:    row.sold_at,
      });
    }

    // Write to buffer and send — no temp file needed, no disk leak
    const buffer = await workbook.xlsx.writeBuffer();

    await ctx.replyWithDocument(
      { source: Buffer.from(buffer), filename: 'Freeflow_Sales_Data.xlsx' },
      { caption: `📊 <b>Sales Export</b>\n\n${rows.length} records exported.`, parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('getdata command error:', err);
    await ctx.reply(`❌ Failed to generate export: ${err.message}`);
  }
});

// Launch Telegraf Bot
bot.launch().then(() => {
  console.log('✅ License bot is running...');
  console.log(`Bot: @freeflowkeybot | Admin: ${ADMIN_CHAT_ID} | Logs: ${LOGS_CHAT_ID}`);
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

    // ── Auto-Verification Matchup ─────────────────────────────────────────
    const { getAllSessions, USER_STATES } = require('./utils/session');
    const { fulfillOrder } = require('./handlers/user');
    const allSessions = getAllSessions();
    let autoVerified = false;
    
    for (const [userId, s] of allSessions.entries()) {
      if (s.state === USER_STATES.AWAITING_UTR && Number(s.expectedAmount) === Number(amount)) {
        // Match found! Fulfill order
        const orderResult = await fulfillOrder(bot, userId, amount, utr);
        
        if (orderResult.ok) {
          autoVerified = true;
          try {
            await bot.telegram.sendMessage(
              LOGS_CHAT_ID,
              `⚡ <b>Auto-Verification Success (Webhook)!</b>\n\nUTR: <code>${utr}</code>\nAmount: ₹${amount}\nMatched User: ${userId}`,
              { parse_mode: 'HTML' }
            );
          } catch (err) {}
        }
        break;
      }
    }

    return res.status(200).json({ success: true, utr, amount, autoVerified });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook HTTP server listening on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
