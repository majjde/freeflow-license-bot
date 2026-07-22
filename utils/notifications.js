const { Markup } = require('telegraf');
const { ADMIN_CHAT_ID, SUPPORT_HANDLE } = require('../config');

async function notifyAdmin(bot, message, extra = {}) {
  try {
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, {
      parse_mode: 'HTML',
      ...extra,
    });
  } catch (err) {
    console.error('Failed to send admin notification:', err.message);
  }
}

function formatUser(user) {
  const username = user.username ? `@${user.username}` : 'N/A';
  return `<b>User:</b> ${username}\n<b>ID:</b> <code>${user.id}</code>`;
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

module.exports = {
  notifyAdmin,
  notifyPaymentAttempt,
  notifyKeyDelivered,
  notifyUtrFailed,
  notifyTransactionCaptured,
  contactAdminKeyboard,
};
