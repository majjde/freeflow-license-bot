const { Telegraf } = require('telegraf');
const { BOT_TOKEN } = require('./config');
const { initDatabase } = require('./database');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerUserHandlers } = require('./handlers/user');
const { registerPaymentListener } = require('./handlers/paymentListener');

// Initialize database
initDatabase();

const bot = new Telegraf(BOT_TOKEN);

// Global error handling — bot should not crash on bad inputs
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  try {
    ctx.reply('Something went wrong. Please try /start again.').catch(() => {});
  } catch {
    // ignore
  }
});

// Register handlers (order matters for text message routing)
registerAdminHandlers(bot);
registerUserHandlers(bot);
registerPaymentListener(bot);

// Launch
bot.launch().then(() => {
  console.log('✅ License bot is running...');
  console.log('Bot: @freeflowkeybot | Admin chat:', require('./config').ADMIN_CHAT_ID);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
