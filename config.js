require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const ADMIN_CHAT_ID = Number(requireEnv('ADMIN_CHAT_ID'));
if (Number.isNaN(ADMIN_CHAT_ID)) {
  throw new Error('ADMIN_CHAT_ID must be a numeric Telegram chat ID');
}

module.exports = {
  BOT_TOKEN: requireEnv('BOT_TOKEN'),
  ADMIN_CHAT_ID,
  SUPPORT_HANDLE: process.env.SUPPORT_HANDLE || 'admin',
  DB_PATH: process.env.DB_PATH || (process.env.RAILWAY_ENVIRONMENT ? '/data/bot.db' : './data/bot.db'),
  VALIDITY_PERIODS: ['1d', '7d', '14d', '30d'],
  STATIC_GUIDES: {
    install: `📦 *How to Install Freeflow*

1. Download the extension ZIP file from the link provided and extract it.
2. Open Chrome and go to \`chrome://extensions\`
3. Toggle on *Developer mode* in the top right corner.
4. Click *Load unpacked* and select your extracted Freeflow folder.

You are ready to go!

Need help? Use the Support button from the main menu.`,
    usage: `🚀 *How to Use Freeflow*

1. Open the Lovable web app in your browser.
2. Click the Freeflow extension icon in your toolbar.
3. Enter your purchased License Key to unlock the pro features.
4. Type your idea into the Freeflow prompt box and watch it automate the build process in Lovable in under 60 seconds!

Tip: Do not share your license key with anyone.`,
  },
};
