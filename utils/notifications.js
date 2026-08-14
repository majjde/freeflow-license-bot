const { Markup } = require('telegraf');
const { ADMIN_CHAT_ID, SUPPORT_HANDLE, DISCUSSION_GROUP_ID } = require('../config');

// Dedicated logs channel: if LOGS_CHAT_ID is set, automated alerts go there.
// Interactive admin workflows always stay on ADMIN_CHAT_ID.
const LOGS_CHAT_ID = process.env.LOGS_CHAT_ID || ADMIN_CHAT_ID;

async function notifyAdmin(bot, message, extra = {}) {
  try {
    await bot.telegram.sendMessage(LOGS_CHAT_ID, message, {
      parse_mode: 'HTML',
      ...extra,
    });
  } catch (err) {
    console.error('Failed to send log notification:', err.message);
  }
}

function formatUser(user) {
  const username = user.username ? `@${user.username}` : 'N/A';
  const name = (user.first_name || '') + (user.last_name ? ` ${user.last_name}` : '');
  return `<b>User:</b> ${username}\n<b>ID:</b> <code>${user.id}</code>\n<b>Contact:</b> <a href="tg://user?id=${user.id}">${name || 'Click to message'}</a>`;
}

async function notifyPaymentAttempt(bot, user, category) {
  await notifyAdmin(
    bot,
    `💳 <b>Payment Claim Started</b>\n\n${formatUser(user)}\n<b>Category:</b> ${category.validity_period} (₹${category.amount})`
  );
}

async function notifyKeyDelivered(bot, user, keyString, category) {
  await notifyAdmin(
    bot,
    `✅ <b>Key Delivered</b>\n\n${formatUser(user)}\n<b>Category:</b> ${category.validity_period}\n<b>Key:</b> <code>${keyString}</code>`
  );
}

async function notifyUtrFailed(bot, user, utr, reason) {
  await notifyAdmin(
    bot,
    `❌ <b>UTR Match Failed</b>\n\n${formatUser(user)}\n<b>UTR:</b> <code>${utr}</code>\n<b>Reason:</b> ${reason}`
  );
}

async function notifyTransactionCaptured(bot, utr, amount) {
  await notifyAdmin(
    bot,
    `📥 <b>Payment Captured</b>\n\n<b>UTR:</b> <code>${utr}</code>\n<b>Amount:</b> ₹${amount}\n<b>Status:</b> unclaimed`
  );
}

function contactAdminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url('Contact Admin', `https://t.me/${SUPPORT_HANDLE.replace('@', '')}`)],
    [Markup.button.callback('« Back to Menu', 'menu:main')],
  ]);
}

async function broadcastToGroup(bot, htmlText) {
  if (!DISCUSSION_GROUP_ID) return;
  try {
    await bot.telegram.sendMessage(DISCUSSION_GROUP_ID, htmlText, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Group broadcast failed:', err.message);
  }
}

module.exports = {
  notifyAdmin,
  notifyPaymentAttempt,
  notifyKeyDelivered,
  notifyUtrFailed,
  notifyTransactionCaptured,
  contactAdminKeyboard,
  broadcastToGroup,
  LOGS_CHAT_ID,
};
