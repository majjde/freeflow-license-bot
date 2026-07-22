const { Markup } = require('telegraf');
const { extractUtr, extractAmount } = require('../utils/regex');
const db = require('../database');
const { notifyTransactionCaptured } = require('../utils/notifications');
const { ADMIN_CHAT_ID } = require('../config');
const { getSession } = require('../utils/session');
const { ADMIN_STATES } = require('./admin');

/**
 * Listen for forwarded bank/UPI SMS in the admin chat and store UTR + amount.
 */
function registerPaymentListener(bot) {
  bot.on('text', async (ctx, next) => {
    if (ctx.chat.id !== ADMIN_CHAT_ID) {
      return next();
    }

    // Skip bot commands handled elsewhere
    if (ctx.message.text.startsWith('/')) {
      return next();
    }

    // Skip while admin is in a multi-step workflow (upload keys, manage category, etc.)
    const session = getSession(ctx.from.id);
    if (session.state && Object.values(ADMIN_STATES).includes(session.state)) {
      return next();
    }

    const text = ctx.message.text;
    const utr = extractUtr(text);
    const amount = extractAmount(text);

    if (!utr || amount === null) {
      return next();
    }

    const result = db.insertTransaction(utr, amount);

    if (result.duplicate) {
      await ctx.reply(`ℹ️ UTR <code>${utr}</code> already exists in the database.`, {
        parse_mode: 'HTML',
      });
      return;
    }

    await notifyTransactionCaptured(bot, utr, amount);
    await ctx.reply(`✅ Saved payment:\nUTR: <code>${utr}</code>\nAmount: ₹${amount}`, {
      parse_mode: 'HTML',
    });
  });
}

module.exports = { registerPaymentListener };
