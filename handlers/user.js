const { Markup } = require('telegraf');
const db = require('../database');
const { STATIC_GUIDES, SUPPORT_HANDLE } = require('../config');
const { getSession, setSession, clearSession } = require('../utils/session');
const { isAdmin } = require('./admin');
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
  const map = {
    '15m': 'Free 15 Min Demo',
    '1d': '1 Day',
    '3d': '3 Days',
    '7d': '7 Days',
    '15d': '15 Days',
    '30d': '30 Days',
  };
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

function safeClearSession(userId) {
  const session = getSession(userId);
  if (session && session.timerId) {
    clearTimeout(session.timerId);
  }
  clearSession(userId);
}

function registerUserHandlers(bot) {
  bot.command('start', async (ctx) => {
    try {
      db.upsertUser(ctx.from.id, ctx.from.username);
      safeClearSession(ctx.from.id);

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
    safeClearSession(ctx.from.id);
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

  // ─── Purchase flow (10-Minute Vault) ────────────────────────────────────────

  bot.action(/^buy:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = Number(ctx.match[1]);
    const category = db.getCategoryById(categoryId);

    if (!category) {
      return ctx.reply('This plan is no longer available.');
    }

    db.upsertUser(ctx.from.id, ctx.from.username);

    // Free 15 Min Demo Bypass
    if (category.validity_period === '15m') {
      const alreadyClaimed = db.hasUserClaimedCategory(ctx.from.id, categoryId);
      if (alreadyClaimed) {
        return ctx.reply(
          '❌ You have already claimed your free 15-minute demo key. Please purchase a standard plan to continue using Freeflow.',
          buyCategoriesKeyboard()
        );
      }

      const key = db.getAvailableKey(categoryId);
      if (!key) {
        return ctx.reply(
          'Sorry, this plan is currently out of stock. Please try another plan or check back shortly.',
          buyCategoriesKeyboard()
        );
      }

      db.markKeySold(key.id, ctx.from.id);
      await notifyKeyDelivered(bot, ctx.from, key.key_string, category);

      return ctx.reply(
        `🎉 <b>Here is your Free 15 Min Demo Key:</b>\n\n<code>${key.key_string}</code>\n\nEnjoy testing Freeflow!`,
        {
          parse_mode: 'HTML',
          ...mainMenuKeyboard(),
        }
      );
    }

    // Lock/reserve key for 10 minutes
    const reservedKey = db.reserveAvailableKey(categoryId, ctx.from.id);
    if (!reservedKey) {
      return ctx.reply(
        'Sorry, this plan is currently out of stock. Please try another plan or check back shortly.',
        buyCategoriesKeyboard()
      );
    }

    // Clear any previous reservation timer
    const oldSession = getSession(ctx.from.id);
    if (oldSession && oldSession.timerId) {
      clearTimeout(oldSession.timerId);
    }

    // Set 10-minute auto-expiry timeout
    const userId = ctx.from.id;
    const timerId = setTimeout(async () => {
      const sess = getSession(userId);
      if (sess.state === USER_STATES.AWAITING_UTR && sess.categoryId === categoryId) {
        clearSession(userId);
        try {
          await bot.telegram.sendMessage(
            userId,
            `⏱️ <b>Reservation Expired</b>\n\nYour 10-minute key reservation for <b>${validityLabel(category.validity_period)}</b> has expired.\n\nIf you still wish to purchase, please select a plan from the menu.`,
            { parse_mode: 'HTML', ...mainMenuKeyboard() }
          );
        } catch (err) {
          console.error('Failed to send reservation expiry message:', err.message);
        }
      }
    }, 10 * 60 * 1000);

    setSession(ctx.from.id, {
      state: USER_STATES.AWAITING_UTR,
      categoryId,
      timerId,
    });

    await notifyPaymentAttempt(bot, ctx.from, category);

    const caption =
      `💳 <b>${validityLabel(category.validity_period)} License</b>\n\n` +
      `💰 Amount: <b>₹${category.amount}</b>\n` +
      `📱 UPI ID: <code>${category.upi_id}</code>\n\n` +
      (category.custom_message ? `${category.custom_message}\n\n` : '') +
      `🔒 <b>Key Reserved for 10 Minutes!</b>\n` +
      `Scan the QR code above or pay using the UPI ID.\n\n` +
      `💬 <b>Reply to this message with your 12-digit UTR/RRN number once paid.</b>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Cancel', 'menu:main')],
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

  // ─── UTR verification (Forgiving Input) ───────────────────────────────────

  bot.on('text', async (ctx, next) => {
    const session = getSession(ctx.from.id);

    if (session.state !== USER_STATES.AWAITING_UTR || !session.categoryId) {
      return next();
    }

    const textInput = ctx.message.text ? ctx.message.text.trim() : '';

    // Intelligently extract 12-digit UTR from user input
    const utrMatch = textInput.match(/\d{12}/);
    if (!utrMatch) {
      return ctx.reply(
        "❌ I couldn't find a valid 12-digit UTR in your message.\n\nPlease reply with the correct 12-digit UTR/RRN number.\n\n💡 *Where to find it:* Look for a 12-digit number (often starting with 3 or 4) in your UPI app's payment confirmation screen or your bank SMS.",
        { parse_mode: 'Markdown' }
      );
    }

    const utr = utrMatch[0];

    const category = db.getCategoryById(session.categoryId);
    if (!category) {
      safeClearSession(ctx.from.id);
      return ctx.reply('This plan is no longer available. Please start again.', mainMenuKeyboard());
    }

    db.upsertUser(ctx.from.id, ctx.from.username);

    const result = db.processPaymentClaim({
      utr,
      userId: ctx.from.id,
      categoryId: session.categoryId,
      expectedAmount: category.amount,
    });

    safeClearSession(ctx.from.id);

    if (result.ok) {
      await notifyKeyDelivered(bot, ctx.from, result.key, category);

      await ctx.reply(
        `🎉 <b>Payment Verified!</b>\n\n` +
          `Here is your license key:\n\n` +
          `<code>${result.key}</code>\n\n` +
          `Plan: ${validityLabel(category.validity_period)}\n` +
          `Amount Paid: ₹${result.amount}\n\n` +
          `Tap "How to Install" in the main menu if you need setup help.`,
        {
          parse_mode: 'HTML',
          ...mainMenuKeyboard(),
        }
      );
      return;
    }

    const reasonMap = {
      not_found: 'UTR not found in payment records yet',
      already_used: 'UTR already claimed',
      amount_mismatch: `Amount received (₹${result.received}) is less than required (₹${category.amount})`,
      no_keys: 'No keys available in stock',
    };

    const reason = reasonMap[result.reason] || 'Verification failed';
    await notifyUtrFailed(bot, ctx.from, utr, reason);

    await ctx.reply(
      `❌ UTR verification issue: ${reason}.\n\n` +
        `If you just paid, please wait a few seconds and send the UTR again. If the issue persists, contact support with your payment screenshot.`,
      contactAdminKeyboard()
    );
  });

  bot.command('cancel', async (ctx) => {
    safeClearSession(ctx.from.id);
    await ctx.reply('Cancelled.', mainMenuKeyboard());
  });

  // Global fallback for unrecognized text from non-admin users not in AWAITING_UTR state
  bot.on('text', async (ctx, next) => {
    if (isAdmin(ctx)) return next();

    const session = getSession(ctx.from.id);
    if (session.state === USER_STATES.AWAITING_UTR) return next();

    await ctx.reply(
      "I didn't quite catch that! 🤖\n\nPlease type /start to view the main menu or begin a new purchase."
    );
  });
}

module.exports = { registerUserHandlers, USER_STATES, mainMenuKeyboard };
