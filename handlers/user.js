const { Markup } = require('telegraf');
const db = require('../database');
const { STATIC_GUIDES, SUPPORT_HANDLE } = require('../config');
const { getSession, setSession, clearSession } = require('../utils/session');
const { isValidUtr } = require('../utils/regex');
const {
  notifyPaymentAttempt,
  notifyKeyDelivered,
  notifyUtrFailed,
  contactAdminKeyboard,
} = require('../utils/notifications');

const USER_STATES = {
  AWAITING_UTR: 'user_awaiting_utr',
};

function validityLabel(period) {
  const map = { '1d': '1 Day', '7d': '7 Days', '14d': '14 Days', '30d': '30 Days' };
  return map[period] || period;
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛒 Buy Key', 'menu:buy')],
    [Markup.button.callback('🔑 My Keys', 'menu:mykeys')],
    [Markup.button.callback('📦 How to Install', 'menu:install')],
    [Markup.button.callback('🚀 How to Use', 'menu:usage')],
    [Markup.button.callback('💬 Support', 'menu:support')],
  ]);
}

function buyCategoriesKeyboard() {
  const categories = db.getAllCategories();
  if (categories.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);
  }

  const buttons = categories.map((cat) => {
    const available = db.getAvailableKeyCount(cat.id);
    const label = `${validityLabel(cat.validity_period)} — ₹${cat.amount}${available === 0 ? ' (Out of stock)' : ''}`;
    return [Markup.button.callback(label, `buy:${cat.id}`)];
  });

  buttons.push([Markup.button.callback('« Back to Menu', 'menu:main')]);
  return Markup.inlineKeyboard(buttons);
}

function registerUserHandlers(bot) {
  bot.command('start', async (ctx) => {
    try {
      db.upsertUser(ctx.from.id, ctx.from.username);
      clearSession(ctx.from.id);

      await ctx.reply(
        `👋 Welcome to the License Key Bot!\n\n` +
          `Purchase a license for our browser extension, pay via UPI, and receive your key instantly after verification.\n\n` +
          `Choose an option below:`,
        mainMenuKeyboard()
      );
    } catch (err) {
      console.error('Start command error:', err);
      await ctx.reply('Welcome! Please try again in a moment.');
    }
  });

  bot.action('menu:main', async (ctx) => {
    await ctx.answerCbQuery();
    clearSession(ctx.from.id);
    try {
      await ctx.editMessageText('🏠 Main Menu\n\nChoose an option:', mainMenuKeyboard());
    } catch {
      await ctx.reply('🏠 Main Menu\n\nChoose an option:', mainMenuKeyboard());
    }
  });

  bot.action('menu:buy', async (ctx) => {
    await ctx.answerCbQuery();
    const categories = db.getAllCategories();

    if (categories.length === 0) {
      const text = 'No plans available right now. Please check back later or contact support.';
      try {
        await ctx.editMessageText(text, buyCategoriesKeyboard());
      } catch {
        await ctx.reply(text, buyCategoriesKeyboard());
      }
      return;
    }

    const text = '🛒 Select a license plan:';
    try {
      await ctx.editMessageText(text, buyCategoriesKeyboard());
    } catch {
      await ctx.reply(text, buyCategoriesKeyboard());
    }
  });

  bot.action('menu:mykeys', async (ctx) => {
    await ctx.answerCbQuery();
    db.upsertUser(ctx.from.id, ctx.from.username);

    const keys = db.getUserKeys(ctx.from.id);
    let text;

    if (keys.length === 0) {
      text = '🔑 You have no purchased keys yet.\n\nTap "Buy Key" to get started.';
    } else {
      const lines = keys.map(
        (k, i) =>
          `${i + 1}. <code>${k.key_string}</code>\n   Plan: ${validityLabel(k.validity_period)} | ₹${k.amount}\n   Purchased: ${k.sold_at}`
      );
      text = `🔑 <b>Your License Keys</b>\n\n${lines.join('\n\n')}`;
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);

    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  });

  bot.action('menu:install', async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);
    try {
      await ctx.editMessageText(STATIC_GUIDES.install, { parse_mode: 'Markdown', ...keyboard });
    } catch {
      await ctx.reply(STATIC_GUIDES.install, { parse_mode: 'Markdown', ...keyboard });
    }
  });

  bot.action('menu:usage', async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);
    try {
      await ctx.editMessageText(STATIC_GUIDES.usage, { parse_mode: 'Markdown', ...keyboard });
    } catch {
      await ctx.reply(STATIC_GUIDES.usage, { parse_mode: 'Markdown', ...keyboard });
    }
  });

  bot.action('menu:support', async (ctx) => {
    await ctx.answerCbQuery();
    const text =
      `💬 <b>Support</b>\n\n` +
      `Need help? Contact the admin:\n` +
      `@${SUPPORT_HANDLE.replace('@', '')}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('Contact Admin', `https://t.me/${SUPPORT_HANDLE.replace('@', '')}`)],
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);

    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  });

  // ─── Purchase flow ─────────────────────────────────────────────────────────

  bot.action(/^buy:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = Number(ctx.match[1]);
    const category = db.getCategoryById(categoryId);

    if (!category) {
      return ctx.reply('This plan is no longer available.');
    }

    const available = db.getAvailableKeyCount(categoryId);
    if (available === 0) {
      return ctx.reply(
        'Sorry, this plan is currently out of stock. Please try another plan or contact support.',
        buyCategoriesKeyboard()
      );
    }

    const caption =
      `💳 <b>${validityLabel(category.validity_period)} License</b>\n\n` +
      `💰 Amount: <b>₹${category.amount}</b>\n` +
      `📱 UPI ID: <code>${category.upi_id}</code>\n\n` +
      (category.custom_message ? `${category.custom_message}\n\n` : '') +
      `Scan the QR code above and pay the exact amount.\n` +
      `After payment, tap <b>✅ I paid it</b> and enter your 12-digit UTR/RRN.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬇️ Download QR Code', `download_qr:${categoryId}`)],
      [Markup.button.callback('✅ I paid it', `paid:${categoryId}`)],
      [Markup.button.callback('« Back', 'menu:buy')],
    ]);

    if (category.qr_photo_file_id) {
      await ctx.replyWithPhoto(category.qr_photo_file_id, {
        caption,
        parse_mode: 'HTML',
        ...keyboard,
      });
    } else {
      await ctx.reply(
        caption + '\n\n⚠️ QR code not configured yet. Use the UPI ID above to pay manually.',
        { parse_mode: 'HTML', ...keyboard }
      );
    }
  });

  bot.action(/^download_qr:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = Number(ctx.match[1]);
    const category = db.getCategoryById(categoryId);

    if (!category?.qr_photo_file_id) {
      return ctx.reply('QR code is not available for this plan. Use the UPI ID to pay manually.');
    }

    try {
      await ctx.replyWithDocument(category.qr_photo_file_id, {
        caption: `QR Code for ${validityLabel(category.validity_period)} plan (₹${category.amount})`,
      });
    } catch {
      await ctx.reply(
        'Could not send as file. Long-press the QR image above and choose "Save to gallery" instead.'
      );
    }
  });

  bot.action(/^paid:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = Number(ctx.match[1]);
    const category = db.getCategoryById(categoryId);

    if (!category) {
      return ctx.reply('This plan is no longer available.');
    }

    db.upsertUser(ctx.from.id, ctx.from.username);
    setSession(ctx.from.id, {
      state: USER_STATES.AWAITING_UTR,
      categoryId,
    });

    await notifyPaymentAttempt(bot, ctx.from, category);

    await ctx.reply(
      `✅ Great! Please reply with your <b>12-digit UTR/RRN</b> number from your payment confirmation.\n\n` +
        `Plan: ${validityLabel(category.validity_period)} (₹${category.amount})\n\n` +
        `Type /cancel to go back.`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'menu:main')]]),
      }
    );
  });

  // ─── UTR verification ──────────────────────────────────────────────────────

  bot.on('text', async (ctx, next) => {
    const session = getSession(ctx.from.id);

    if (session.state !== USER_STATES.AWAITING_UTR || !session.categoryId) {
      return next();
    }

    const utr = ctx.message.text.trim();

    if (!isValidUtr(utr)) {
      return ctx.reply(
        '❌ Invalid UTR. Please enter exactly 12 digits (numbers only).\n\nExample: 123456789012'
      );
    }

    const category = db.getCategoryById(session.categoryId);
    if (!category) {
      clearSession(ctx.from.id);
      return ctx.reply('This plan is no longer available. Please start again.', mainMenuKeyboard());
    }

    db.upsertUser(ctx.from.id, ctx.from.username);

    const result = db.processPaymentClaim({
      utr,
      userId: ctx.from.id,
      categoryId: session.categoryId,
      expectedAmount: category.amount,
    });

    clearSession(ctx.from.id);

    if (result.ok) {
      await notifyKeyDelivered(bot, ctx.from, result.key, category);

      await ctx.reply(
        `🎉 <b>Payment Verified!</b>\n\n` +
          `Here is your license key:\n\n` +
          `<code>${result.key}</code>\n\n` +
          `Plan: ${validityLabel(category.validity_period)}\n` +
          `Amount: ₹${result.amount}\n\n` +
          `Tap "How to Install" in the main menu if you need setup help.`,
        {
          parse_mode: 'HTML',
          ...mainMenuKeyboard(),
        }
      );
      return;
    }

    const reasonMap = {
      not_found: 'UTR not found in payment records',
      already_used: 'UTR already claimed',
      amount_mismatch: `Amount mismatch (expected ₹${category.amount}, received ₹${result.received})`,
      no_keys: 'No keys available in stock',
    };

    const reason = reasonMap[result.reason] || 'Verification failed';
    await notifyUtrFailed(bot, ctx.from, utr, reason);

    await ctx.reply(
      `❌ UTR not found or already used. Please check again.\n\n` +
        `If the amount was deducted from your account, contact admin with your UTR and payment screenshot.`,
      contactAdminKeyboard()
    );
  });

  bot.command('cancel', async (ctx) => {
    clearSession(ctx.from.id);
    await ctx.reply('Cancelled.', mainMenuKeyboard());
  });
}

module.exports = { registerUserHandlers, USER_STATES, mainMenuKeyboard };
