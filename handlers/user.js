const { Markup } = require('telegraf');
const QRCode = require('qrcode');
const db = require('../database');
const config = require('../config');
const { STATIC_GUIDES, SUPPORT_HANDLE, PUBLIC_GROUP_ID, ADMIN_CHAT_ID } = config;
const { getSession, setSession, clearSession, USER_STATES } = require('../utils/session');
const { isAdmin } = require('./admin');
const {
  notifyPaymentAttempt,
  notifyKeyDelivered,
  notifyUtrFailed,
  contactAdminKeyboard,
} = require('../utils/notifications');

function validityLabel(period) {
  const map = {
    '15m': 'Free 15 Min Demo',
    '1d': '1 Day',
    '3d': '3 Days',
    '7d': '7 Days',
    '15d': '15 Days',
    '30d': '30 Days',
    'lifetime': 'Lifetime Access',
    'vip': 'Learn website creation with AI',
  };
  return map[period] || period;
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎁 Get free key', 'menu:free_key')],
    [Markup.button.callback('🛒 Buy key', 'menu:buy')],
    [Markup.button.callback('🔑 My keys', 'menu:my_keys')],
    [Markup.button.callback('🧠 Learn and master AI', 'menu:learn_ai')],
    [Markup.button.callback('⬇️ Download Extension', 'menu:download')],
    [Markup.button.callback('🎁 Refer & Earn', 'menu:referral')],
    [Markup.button.callback('📖 How to use', 'menu:usage')],
    [Markup.button.callback('🎫 Raise a ticket', 'menu:ticket')],
  ]);
}

// Delivery keyboard shown after any successful key delivery
function deliveryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📖 How to Use', 'menu:usage')],
    [Markup.button.callback('⬇️ Download extension', 'menu:download')],
    [Markup.button.callback('« Back to Main Menu', 'menu:main')],
  ]);
}

// Paid plans keyboard: excludes '15m' (free tripwire) and 'vip' (separate flow)
function buyCategoriesKeyboard() {
  const categories = db
    .getAllCategories()
    .filter((cat) => cat.validity_period !== 'vip' && cat.validity_period !== '15m');
  if (categories.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);
  }

  const buttons = categories.map((cat) => {
    const available = db.getAvailableKeyCount(cat.id);
    const priceTag = `₹${cat.amount}`;
    const label = `${validityLabel(cat.validity_period)} — ${priceTag}${available === 0 ? ' (Out of stock)' : ''}`;
    return [Markup.button.callback(label, `buy:${cat.id}`)];
  });

  buttons.push([Markup.button.callback('« Back to Menu', 'menu:main')]);
  return Markup.inlineKeyboard(buttons);
}

// Discount-aware buy keyboard (same filters, but labels show discounted price)
function discountedBuyCategoriesKeyboard(discount) {
  const categories = db
    .getAllCategories()
    .filter((cat) => cat.validity_period !== 'vip' && cat.validity_period !== '15m');
  if (categories.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);
  }

  const buttons = categories.map((cat) => {
    const available = db.getAvailableKeyCount(cat.id);
    const finalPrice = Math.ceil(cat.amount * (1 - discount));
    const label = `${validityLabel(cat.validity_period)} — ~~₹${cat.amount}~~ ₹${finalPrice}${available === 0 ? ' (Out of stock)' : ''}`;
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
  if (session && session.discountTimeoutId) {
    clearTimeout(session.discountTimeoutId);
  }
  clearSession(userId);
}

async function checkGroupMembership(ctx, userId) {
  if (!config.DISCUSSION_GROUP_ID) {
    return true;
  }
  try {
    const member = await ctx.telegram.getChatMember(config.DISCUSSION_GROUP_ID, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error('Error checking group membership:', err);
    return false;
  }
}

async function sendGatekeeperPrompt(ctx) {
  const text =
    `🛑 <b>Wait! You need to join our community first.</b>\n\n` +
    `To use this bot and get your Freeflow key, you must be a member of our official discussion group.\n\n` +
    `Tap the button below to join, then click 'Verify Join' to continue!`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('Join Group', config.DISCUSSION_GROUP_LINK || 'https://t.me')],
    [Markup.button.callback('✅ Verify Join', 'verify_join')],
  ]);

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

async function showMainMenu(ctx) {
  const text =
    `👋 Welcome to the License Key Bot!\n\n` +
    `Purchase a license for our browser extension, pay via UPI, and receive your key instantly after verification.\n\n` +
    `Choose an option below:`;

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...mainMenuKeyboard() });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', ...mainMenuKeyboard() });
  }
}

async function sendMainMenu(ctx) {
  const text =
    `👋 Welcome to the License Key Bot!\n\n` +
    `Choose an option below:`;
  await ctx.reply(text, { parse_mode: 'HTML', ...mainMenuKeyboard() });
}

async function showCategorySelection(ctx) {
  const categories = db
    .getAllCategories()
    .filter((cat) => cat.validity_period !== 'vip' && cat.validity_period !== '15m');

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
}

/**
 * Generate a dynamic UPI QR code buffer using the global UPI ID.
 */
async function generateUpiQr(amount) {
  const upiString = `upi://pay?pa=${config.UPI_ID}&pn=${encodeURIComponent(config.MERCHANT_NAME)}&am=${amount}&cu=INR`;
  return QRCode.toBuffer(upiString, { width: 300, margin: 2 });
}

// ─── Special Offer forfeit warning ────────────────────────────────────────────
function specialOfferWarningMessage() {
  return {
    text: `⚠️ <b>Wait! You will lose this deal if you go back.</b>\n\nAre you sure you want to forfeit your 50% discount?`,
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback('🔥 Unlock Deal', 'offer:accept')],
      [Markup.button.callback('❌ Pay Full Price', 'offer:decline_final')],
    ]),
  };
}

function registerUserHandlers(bot) {

  // ─── /start with urgency interceptor ──────────────────────────────────────

  bot.command('start', async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    try {
      const userId = ctx.from.id;
      const username = ctx.from.username;

      // ── Referral payload interception ──────────────────────────────────────
      const payload = ctx.startPayload || '';
      if (payload.startsWith('REF_')) {
        const referrerId = Number(payload.replace('REF_', ''));

        // Only process referral if this is a genuinely new user
        const isNewUser = db.registerUser(userId, username);

        if (isNewUser && referrerId && referrerId !== userId) {
          db.addReferral(referrerId, userId);
          const count = db.getReferralCount(referrerId);

          // Reward: every 3 successful referrals, gift a free 1d key
          if (count > 0 && count % 3 === 0) {
            const oneDayCategory = db.getCategoryByValidity('1d');
            if (oneDayCategory) {
              const rewardKey = db.getAvailableKey(oneDayCategory.id);
              if (rewardKey) {
                db.markKeySold(rewardKey.id, referrerId);
                // Notify logs channel about referral reward delivery
                await notifyKeyDelivered(bot, { id: referrerId, username: null }, rewardKey.key_string, oneDayCategory);
                try {
                  await bot.telegram.sendMessage(
                    referrerId,
                    `🎉 <b>Referral Reward!</b>\n\nYou've successfully referred <b>${count}</b> friends — here is your free <b>1-Day</b> license key:\n\n<code>${rewardKey.key_string}</code>\n\nKeep sharing and earn more free keys!`,
                    { parse_mode: 'HTML', ...mainMenuKeyboard() }
                  );
                } catch (err) {
                  console.error('Failed to send referral reward:', err.message);
                }
              }
            }
          }
        }
      } else {
        // Normal start — upsert (update username if changed)
        db.upsertUser(userId, username);
      }

      const session = getSession(userId);

      // Urgency gate: block navigation if special offer is pending
      if (session.state === USER_STATES.SPECIAL_OFFER_PENDING) {
        const { text, keyboard } = specialOfferWarningMessage();
        return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
      }

      safeClearSession(userId);

      const isMember = await checkGroupMembership(ctx, userId);
      if (!isMember) {
        return sendGatekeeperPrompt(ctx);
      }

      await showMainMenu(ctx);
    } catch (err) {
      console.error('Start command error:', err);
      await ctx.reply('Welcome! Please try again in a moment.');
    }
  });

  bot.action('menu:main', async (ctx) => {
    await ctx.answerCbQuery();
    safeClearSession(ctx.from.id);
    await showMainMenu(ctx);
  });

  bot.action('menu:buy', async (ctx) => {
    await ctx.answerCbQuery();
    await showCategorySelection(ctx);
  });

  bot.action('menu:vip', async (ctx) => {
    await ctx.answerCbQuery();
    db.upsertUser(ctx.from.id, ctx.from.username);

    const isMember = await checkGroupMembership(ctx, ctx.from.id);
    if (!isMember) {
      return sendGatekeeperPrompt(ctx);
    }

    const text = db.getSetting(
      'vip_info',
      '🚀 <b>Learn website creation with AI</b>\n\nGet exclusive access to our step-by-step guides and AI website building resources.'
    );

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Get access', 'menu:vip_checkout')],
      [Markup.button.callback('Cancel', 'menu:main')],
    ]);

    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  });

  // ─── VIP Checkout — dynamic QR ────────────────────────────────────────────

  bot.action('menu:vip_checkout', async (ctx) => {
    await ctx.answerCbQuery();
    db.upsertUser(ctx.from.id, ctx.from.username);

    const isMember = await checkGroupMembership(ctx, ctx.from.id);
    if (!isMember) {
      return sendGatekeeperPrompt(ctx);
    }

    const category = db.getAllCategories().find((c) => c.validity_period === 'vip');
    if (!category) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('« Back to Menu', 'menu:main')],
      ]);
      const text = 'Access to this program is not configured yet. Please check back later!';
      try {
        return await ctx.editMessageText(text, keyboard);
      } catch {
        return await ctx.reply(text, keyboard);
      }
    }

    safeClearSession(ctx.from.id);

    setSession(ctx.from.id, {
      state: USER_STATES.AWAITING_UTR,
      categoryId: category.id,
      expectedAmount: category.amount,
    });

    await notifyPaymentAttempt(bot, ctx.from, category);

    const caption =
      `🚀 <b>Learn website creation with AI Access</b>\n\n` +
      `💰 Amount: <b>₹${category.amount}</b>\n\n` +
      (category.custom_message ? `${category.custom_message}\n\n` : '') +
      `Scan the QR code below to pay via UPI.\n\n` +
      `💬 <b>Reply with your 12-digit UTR/RRN number once paid.</b>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Cancel', 'menu:main')],
    ]);

    try {
      if (!config.UPI_ID) {
        return ctx.reply(
          caption + '\n\n⚠️ UPI ID not configured. Please contact support.',
          { parse_mode: 'HTML', ...keyboard }
        );
      }
      const qrBuffer = await generateUpiQr(category.amount);
      await ctx.replyWithPhoto(
        { source: qrBuffer },
        { caption, parse_mode: 'HTML', ...keyboard }
      );
    } catch (err) {
      console.error('VIP QR generation error:', err);
      await ctx.reply(caption + '\n\n⚠️ QR generation failed. Please contact support.', {
        parse_mode: 'HTML',
        ...keyboard,
      });
    }
  });

  bot.action('verify_join', async (ctx) => {
    const isMember = await checkGroupMembership(ctx, ctx.from.id);
    if (isMember) {
      await ctx.answerCbQuery('✅ Welcome!');
      await showMainMenu(ctx);
    } else {
      await ctx.answerCbQuery('❌ You have not joined the group yet!', { show_alert: true });
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

  bot.action('menu:download', async (ctx) => {
    await ctx.answerCbQuery();
    const extensionFileId = db.getSetting('extension_file_id', null);
    const downloadMsg = db.getSetting('download_msg', 'Here is the latest version of Freeflow!');
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);

    if (extensionFileId) {
      try {
        await ctx.replyWithDocument(extensionFileId, {
          caption: downloadMsg,
          parse_mode: 'HTML',
          ...keyboard,
        });
      } catch (err) {
        console.error('Failed to send extension document:', err);
        await ctx.reply(downloadMsg, { parse_mode: 'HTML', ...keyboard });
      }
    } else {
      try {
        await ctx.editMessageText(downloadMsg, { parse_mode: 'HTML', ...keyboard });
      } catch {
        await ctx.reply(downloadMsg, { parse_mode: 'HTML', ...keyboard });
      }
    }
  });

  // ─── My Keys (alias supports both action names) ───────────────────────────

  bot.action(['menu:my_keys', 'menu:mykeys'], async (ctx) => {
    await ctx.answerCbQuery();
    db.upsertUser(ctx.from.id, ctx.from.username);

    const keys = db.getUserKeys(ctx.from.id);
    let text;

    if (keys.length === 0) {
      text = '🔑 You have no purchased keys yet.\n\nTap "Buy key" to get started.';
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

  // ─── Learn AI (placeholder) ───────────────────────────────────────────────

  bot.action('menu:learn_ai', async (ctx) => {
    await ctx.answerCbQuery();
    const text = db.getSetting(
      'vip_info',
      '🧠 <b>Learn and Master AI</b>\n\nAI Mastery resources coming soon! Stay tuned.'
    );
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Get access', 'menu:vip_checkout')],
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  });

  // ─── Raise a Ticket ───────────────────────────────────────────────────────

  bot.action('menu:ticket', async (ctx) => {
    await ctx.answerCbQuery();
    setSession(ctx.from.id, { state: USER_STATES.AWAITING_TICKET_MESSAGE });

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Cancel', 'menu:main')],
    ]);

    try {
      await ctx.editMessageText(
        `🎫 <b>Raise a Ticket</b>\n\nPlease type your request or issue in a single message below. It will be forwarded directly to our admin team.`,
        { parse_mode: 'HTML', ...keyboard }
      );
    } catch {
      await ctx.reply(
        `🎫 <b>Raise a Ticket</b>\n\nPlease type your request or issue in a single message below. It will be forwarded directly to our admin team.`,
        { parse_mode: 'HTML', ...keyboard }
      );
    }
  });

  // ─── Support (legacy alias) ────────────────────────────────────────────────

  bot.action('menu:support', async (ctx) => {
    await ctx.answerCbQuery();
    setSession(ctx.from.id, { state: USER_STATES.AWAITING_TICKET_MESSAGE });
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Cancel', 'menu:main')],
    ]);
    try {
      await ctx.editMessageText(
        `🎫 <b>Raise a Ticket</b>\n\nPlease type your request or issue in a single message below. It will be forwarded directly to our admin team.`,
        { parse_mode: 'HTML', ...keyboard }
      );
    } catch {
      await ctx.reply(
        `🎫 <b>Raise a Ticket</b>\n\nPlease type your request or issue in a single message below. It will be forwarded directly to our admin team.`,
        { parse_mode: 'HTML', ...keyboard }
      );
    }
  });

  // ─── Refer & Earn ─────────────────────────────────────────────────────────

  bot.action('menu:referral', async (ctx) => {
    await ctx.answerCbQuery();
    db.upsertUser(ctx.from.id, ctx.from.username);

    const count = db.getReferralCount(ctx.from.id);
    const botUsername = ctx.botInfo?.username || 'freeflowkeybot';
    const referralLink = `https://t.me/${botUsername}?start=REF_${ctx.from.id}`;

    const nextReward = 3 - (count % 3);
    const progressText = count % 3 === 0 && count > 0
      ? `🎉 You just hit a milestone! Keep going for more rewards.`
      : `🔜 <b>${nextReward} more invite${nextReward === 1 ? '' : 's'}</b> to earn your next free key!`;

    const text =
      `🎁 <b>Refer & Earn</b>\n\n` +
      `Invite 3 friends to get a <b>Free 1-Day Premium Key!</b>\n\n` +
      `📊 You currently have <b>${count}</b> successful invite${count === 1 ? '' : 's'}.\n` +
      `${progressText}\n\n` +
      `👇 <b>Your unique referral link:</b>\n<code>${referralLink}</code>\n\n` +
      `Share this link and earn a free key for every 3 people who join through you!`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('📤 Share Link', `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join Freeflow and get a free trial key!')}`)],
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);

    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  });

  // ─── Usage Guide — media-aware ─────────────────────────────────────────────

  bot.action('menu:usage', async (ctx) => {
    await ctx.answerCbQuery();

    const usageText = db.getSetting('usage_text', null) || STATIC_GUIDES.usage;
    const mediaFileId = db.getSetting('usage_media_file_id', null);
    const mediaType = db.getSetting('usage_media_type', null);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Back to Menu', 'menu:main')],
    ]);

    try {
      if (mediaFileId && mediaType === 'video') {
        await ctx.replyWithVideo(mediaFileId, {
          caption: usageText,
          parse_mode: 'HTML',
          ...keyboard,
        });
      } else if (mediaFileId && mediaType === 'document') {
        await ctx.replyWithDocument(mediaFileId, {
          caption: usageText,
          parse_mode: 'HTML',
          ...keyboard,
        });
      } else {
        try {
          await ctx.editMessageText(usageText, { parse_mode: 'HTML', ...keyboard });
        } catch {
          await ctx.reply(usageText, { parse_mode: 'HTML', ...keyboard });
        }
      }
    } catch (err) {
      console.error('Usage guide send error:', err);
      await ctx.reply(usageText, { parse_mode: 'HTML', ...keyboard });
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

  // ─── 🎁 Free Key Tripwire ─────────────────────────────────────────────────

  bot.action('menu:free_key', async (ctx) => {
    await ctx.answerCbQuery();
    db.upsertUser(ctx.from.id, ctx.from.username);

    // Group membership check
    const isMember = await checkGroupMembership(ctx, ctx.from.id);
    if (!isMember) {
      return sendGatekeeperPrompt(ctx);
    }

    // Find the 15m free category
    const freeCategory = db.getCategoryByValidity('15m');
    if (!freeCategory) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Buy a Plan', 'menu:buy')],
        [Markup.button.callback('« Back to Menu', 'menu:main')],
      ]);
      try {
        await ctx.editMessageText(
          '❌ Free trial is not available right now. Please check back later or purchase a plan.',
          keyboard
        );
      } catch {
        await ctx.reply(
          '❌ Free trial is not available right now.',
          keyboard
        );
      }
      return;
    }

    // Check if already claimed
    const alreadyClaimed = db.hasUserClaimedCategory(ctx.from.id, freeCategory.id);
    if (alreadyClaimed) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Buy a Plan', 'menu:buy')],
        [Markup.button.callback('« Back to Menu', 'menu:main')],
      ]);
      try {
        await ctx.editMessageText(
          '❌ You have already claimed your free trial key.\n\nPurchase a standard plan to continue using Freeflow!',
          keyboard
        );
      } catch {
        await ctx.reply(
          '❌ You have already claimed your free trial key.',
          keyboard
        );
      }
      return;
    }

    // Fetch and deliver the free key
    const key = db.getAvailableKey(freeCategory.id);
    if (!key) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Buy a Plan', 'menu:buy')],
        [Markup.button.callback('« Back to Menu', 'menu:main')],
      ]);
      try {
        await ctx.editMessageText(
          'Sorry, free trial keys are currently out of stock. Please purchase a plan or check back shortly.',
          keyboard
        );
      } catch {
        await ctx.reply('Sorry, free trial keys are currently out of stock.', keyboard);
      }
      return;
    }

    db.markKeySold(key.id, ctx.from.id);
    await notifyKeyDelivered(bot, ctx.from, key.key_string, freeCategory);

    // Send the free key
    await ctx.reply(
      `🎉 <b>Your Free Trial Key:</b>\n\n<code>${key.key_string}</code>`,
      { parse_mode: 'HTML' }
    );

    // Immediately follow with the Special Offer message
    const offerKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📖 Usage Guide', 'menu:usage')],
      [Markup.button.callback('🔥 Get a 50% off Deal', 'offer:accept')],
      [Markup.button.callback('⬇️ Download extension', 'menu:download')],
      [Markup.button.callback('« Go to main menu', 'offer:decline_warn')],
    ]);

    await ctx.reply(
      `Here is your free trial key which you can use to test our extension.\n\n` +
        `Click 'Usage Guide' below to learn how to use our extension. Trust me you will definitely love the extension, so I am giving you a limited time special offer to get <b>50% OFF</b> from the regular price!`,
      { parse_mode: 'HTML', ...offerKeyboard }
    );

    // Lock in special offer state
    setSession(ctx.from.id, { state: USER_STATES.SPECIAL_OFFER_PENDING });
  });

  // ─── Offer Actions ────────────────────────────────────────────────────────

  bot.action('offer:decline_warn', async (ctx) => {
    await ctx.answerCbQuery();
    const { text, keyboard } = specialOfferWarningMessage();
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  });

  bot.action('offer:decline_final', async (ctx) => {
    await ctx.answerCbQuery();
    // Clear only the offer state; preserve other session data
    setSession(ctx.from.id, { state: null, discount: null, discountExpiresAt: null });
    await sendMainMenu(ctx);
  });

  bot.action('offer:accept', async (ctx) => {
    await ctx.answerCbQuery('🔥 50% Discount Unlocked!');

    const userId = ctx.from.id;
    const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours

    // Clear any previous discount timer
    const existingSession = getSession(userId);
    if (existingSession && existingSession.discountTimeoutId) {
      clearTimeout(existingSession.discountTimeoutId);
    }

    // Set 2-hour auto-expiry timeout for the discount
    const discountTimeoutId = setTimeout(async () => {
      const sess = getSession(userId);
      if (sess && sess.discount === 0.5) {
        setSession(userId, {
          discount: null,
          discountExpiresAt: null,
          discountTimeoutId: null,
        });
        try {
          await bot.telegram.sendMessage(
            userId,
            `⏰ <b>Your 50% discount has expired!</b>\n\nThe special offer window has closed. You can still purchase at the regular price from the menu.`,
            { parse_mode: 'HTML', ...mainMenuKeyboard() }
          );
        } catch (err) {
          console.error('Failed to send discount expiry message:', err.message);
        }
      }
    }, 2 * 60 * 60 * 1000);

    setSession(userId, {
      state: null,
      discount: 0.5,
      discountExpiresAt: expiresAt,
      discountTimeoutId,
    });

    const discountKeyboard = discountedBuyCategoriesKeyboard(0.5);

    try {
      await ctx.editMessageText(
        `🔥 <b>Discount Unlocked!</b>\n\nThis 50% OFF deal is strictly valid for the next <b>2 Hours</b>. Select your plan above to checkout before time runs out!`,
        { parse_mode: 'HTML', ...discountKeyboard }
      );
    } catch {
      await ctx.reply(
        `🔥 <b>Discount Unlocked!</b>\n\nThis 50% OFF deal is strictly valid for the next <b>2 Hours</b>. Select your plan above to checkout before time runs out!`,
        { parse_mode: 'HTML', ...discountKeyboard }
      );
    }
  });

  // ─── Purchase flow — Dynamic QR Checkout ──────────────────────────────────

  bot.action(/^buy:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = Number(ctx.match[1]);
    const category = db.getCategoryById(categoryId);

    if (!category) {
      return ctx.reply('This plan is no longer available.');
    }

    db.upsertUser(ctx.from.id, ctx.from.username);

    const session = getSession(ctx.from.id);

    // ── Lazy discount expiry check ──────────────────────────────────────────
    if (session.discount && session.discountExpiresAt && Date.now() > session.discountExpiresAt) {
      if (session.discountTimeoutId) clearTimeout(session.discountTimeoutId);
      setSession(ctx.from.id, {
        discount: null,
        discountExpiresAt: null,
        discountTimeoutId: null,
      });
      await ctx.reply(
        `⏰ <b>Your 50% discount has expired!</b>\n\nYou can still purchase at the regular price below.`,
        { parse_mode: 'HTML', ...buyCategoriesKeyboard() }
      );
      return;
    }

    // ── Pricing logic ───────────────────────────────────────────────────────
    let finalPrice = category.amount;
    const isDiscounted = session.discount === 0.5 && session.discountExpiresAt && Date.now() < session.discountExpiresAt;
    if (isDiscounted) {
      finalPrice = Math.ceil(category.amount * 0.5);
    }

    // Save expected amount for UTR validation
    setSession(ctx.from.id, { expectedAmount: finalPrice });

    // ── Dynamic QR Generation ───────────────────────────────────────────────
    const cancelKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Cancel', 'menu:main')],
    ]);

    if (!config.UPI_ID) {
      // Fallback: no QR, send text checkout
      const fallbackCaption = isDiscounted
        ? `🛒 <b>Special Offer Checkout!</b>\n\nOriginal Price: ₹${category.amount}\n<b>Your Price: ₹${finalPrice}</b>\n\n⚠️ UPI ID not configured. Please contact support.`
        : `🛒 <b>Checkout</b>\n\nPrice: ₹${finalPrice}\n\n⚠️ UPI ID not configured. Please contact support.`;

      // Lock/reserve key for 10 minutes
      const reservedKey = db.reserveAvailableKey(categoryId, ctx.from.id);
      if (!reservedKey) {
        return ctx.reply(
          'Sorry, this plan is currently out of stock. Please try another plan or check back shortly.',
          buyCategoriesKeyboard()
        );
      }
      const timerId = _startReservationTimer(bot, ctx.from.id, categoryId, category, session);
      setSession(ctx.from.id, { state: USER_STATES.AWAITING_UTR, categoryId, timerId });
      await notifyPaymentAttempt(bot, ctx.from, category);
      return ctx.reply(fallbackCaption, { parse_mode: 'HTML', ...cancelKeyboard });
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

    const timerId = _startReservationTimer(bot, ctx.from.id, categoryId, category, session);

    setSession(ctx.from.id, {
      state: USER_STATES.AWAITING_UTR,
      categoryId,
      timerId,
      expectedAmount: finalPrice,
    });

    await notifyPaymentAttempt(bot, ctx.from, category);

    const checkoutCaption = isDiscounted
      ? `🛒 <b>Special Offer Checkout!</b>\n\nOriginal Price: ₹${category.amount}\n<b>Your Price: ₹${finalPrice}</b>\n\nPlease scan the QR code above to pay, or copy the UPI ID below:\n\n👉 <b>Tap to copy UPI ID:</b> <code>${config.UPI_ID}</code>\n\n⚠️ <i>You have exactly 1 Hour to complete this payment and send your UTR number below.</i>`
      : `🛒 <b>Checkout</b>\n\nPrice: ₹${finalPrice}\n\n` +
        (category.custom_message ? `${category.custom_message}\n\n` : '') +
        `Please scan the QR code above to pay, or copy the UPI ID below:\n\n👉 <b>Tap to copy UPI ID:</b> <code>${config.UPI_ID}</code>\n\n⚠️ <i>You have exactly 1 Hour to complete this payment and send your UTR number below.</i>`;

    try {
      const qrBuffer = await generateUpiQr(finalPrice);
      await ctx.replyWithPhoto(
        { source: qrBuffer },
        { caption: checkoutCaption, parse_mode: 'HTML', ...cancelKeyboard }
      );
    } catch (err) {
      console.error('QR generation error:', err);
      await ctx.reply(
        checkoutCaption + '\n\n⚠️ QR generation failed. Please contact support.',
        { parse_mode: 'HTML', ...cancelKeyboard }
      );
    }
  });

  function _startReservationTimer(bot, userId, categoryId, category, session) {
    return setTimeout(async () => {
      const sess = getSession(userId);
      if (sess.state === USER_STATES.AWAITING_UTR && sess.categoryId === categoryId) {
        clearSession(userId);
        try {
          await bot.telegram.sendMessage(
            userId,
            `⏳ <b>Payment Window Expired</b>\n\nYour 1-hour payment window has expired. Please restart the checkout process if you still wish to purchase.`,
            { parse_mode: 'HTML', ...mainMenuKeyboard() }
          );
        } catch (err) {
          console.error('Failed to send reservation expiry message:', err.message);
        }
      }
    }, 60 * 60 * 1000); // 1 hour
  }

  // ─── UTR verification ─────────────────────────────────────────────────────

  bot.on('text', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return;

    const session = getSession(ctx.from.id);

    // Urgency interceptor — block text while special offer is pending
    if (session.state === USER_STATES.SPECIAL_OFFER_PENDING) {
      const { text, keyboard } = specialOfferWarningMessage();
      return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }

    // ─── Ticket forwarding ─────────────────────────────────────────────────
    if (session.state === USER_STATES.AWAITING_TICKET_MESSAGE) {
      clearSession(ctx.from.id);

      const alertText =
        `🚨 <b>New Support Ticket</b>\n` +
        `<b>From:</b> @${ctx.from.username || 'NoUsername'} (ID: <code>${ctx.from.id}</code>)\n` +
        `<b>Name:</b> ${ctx.from.first_name || ''}\n\n` +
        `<b>Message:</b>\n${ctx.message.text}`;

      try {
        await bot.telegram.sendMessage(config.ADMIN_CHAT_ID, alertText, { parse_mode: 'HTML' });
      } catch (err) {
        console.error('Failed to forward ticket to admin:', err.message);
      }

      return ctx.reply(
        '✅ Your ticket has been successfully submitted. Our admin will contact you shortly.',
        { ...mainMenuKeyboard() }
      );
    }


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

    // Use captured expectedAmount (respects active discount)
    const expectedAmount = session.expectedAmount || category.amount;

    const result = db.processPaymentClaim({
      utr,
      userId: ctx.from.id,
      categoryId: session.categoryId,
      expectedAmount,
    });

    // Clean up discount state and timers on any outcome
    const discountTimeoutId = session.discountTimeoutId;
    safeClearSession(ctx.from.id);
    if (discountTimeoutId) clearTimeout(discountTimeoutId);

    if (result.ok) {
      if (category.validity_period === 'vip') {
        let inviteText = '';
        try {
          if (!config.VIP_GROUP_ID) {
            throw new Error('VIP_GROUP_ID is not configured');
          }
          const inviteLink = await ctx.telegram.createChatInviteLink(config.VIP_GROUP_ID, { member_limit: 1 });
          inviteText = `Click the unique link below to join our private group. (This link will only work once!)\n\n${inviteLink.invite_link}`;
        } catch (err) {
          console.error('Failed to generate VIP group invite link:', err);
          inviteText = `VIP Group link could not be generated. Please contact support.`;
        }

        await ctx.reply(
          `🎉 <b>VIP Payment Verified!</b>\n\n` +
            `Welcome to the Inner Circle! ${inviteText}`,
          {
            parse_mode: 'HTML',
            ...deliveryKeyboard(),
          }
        );

        if (PUBLIC_GROUP_ID) {
          try {
            const rawName = ctx.from.username || ctx.from.first_name || 'User';
            const maskedName =
              rawName.length <= 2 ? `${rawName}**` : `${rawName.slice(0, -2)}**`;

            await bot.telegram.sendMessage(
              PUBLIC_GROUP_ID,
              `👑 <b>New VIP Member!</b> A huge thanks to <b>${maskedName}</b> for joining the Private VIP Group! 🚀`,
              { parse_mode: 'HTML' }
            );
          } catch (err) {
            console.error('Failed to send public group VIP notification:', err.message);
          }
        }

        return;
      }

      await notifyKeyDelivered(bot, ctx.from, result.key, category);

      const wasDiscounted = expectedAmount < category.amount;
      const deliveryMsg = wasDiscounted
        ? `🎉 <b>Payment Verified!</b>\n\n` +
          `Here is your license key:\n\n` +
          `<code>${result.key}</code>\n\n` +
          `Plan: ${validityLabel(category.validity_period)}\n` +
          `Original Price: ₹${category.amount} | You Paid: ₹${expectedAmount} (50% OFF! 🎉)\n\n` +
          `Tap "How to Use" below if you need setup help.`
        : `🎉 <b>Payment Verified!</b>\n\n` +
          `Here is your license key:\n\n` +
          `<code>${result.key}</code>\n\n` +
          `Plan: ${validityLabel(category.validity_period)}\n` +
          `Amount Paid: ₹${result.amount}\n\n` +
          `Tap "How to Use" below if you need setup help.`;

      await ctx.reply(deliveryMsg, {
        parse_mode: 'HTML',
        ...deliveryKeyboard(),
      });

      if (PUBLIC_GROUP_ID) {
        try {
          const rawName = ctx.from.username || ctx.from.first_name || 'User';
          const maskedName =
            rawName.length <= 2 ? `${rawName}**` : `${rawName.slice(0, -2)}**`;

          await bot.telegram.sendMessage(
            PUBLIC_GROUP_ID,
            `🎉 <b>New Purchase!</b>\n\nA huge thanks to <b>${maskedName}</b> for grabbing a Freeflow Pro key! 🚀\n\nGet yours instantly via our bot!`,
            { parse_mode: 'HTML' }
          );
        } catch (err) {
          console.error('Failed to send public group notification:', err.message);
        }
      }

      return;
    }

    const reasonMap = {
      not_found: 'UTR not found in payment records yet',
      already_used: 'UTR already claimed',
      amount_mismatch: `Amount received (₹${result.received}) is less than required (₹${expectedAmount})`,
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
    if (ctx.chat?.type !== 'private') return;
    safeClearSession(ctx.from.id);
    await ctx.reply('Cancelled.', mainMenuKeyboard());
  });

  // Global fallback for unrecognized text from non-admin users not in AWAITING_UTR state
  bot.on('text', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return;
    if (isAdmin(ctx)) return next();

    const session = getSession(ctx.from.id);
    if (session.state === USER_STATES.AWAITING_UTR) return next();

    await ctx.reply(
      "I didn't quite catch that! 🤖\n\nPlease type /start to view the main menu or begin a new purchase."
    );
  });
}

module.exports = { registerUserHandlers, USER_STATES, mainMenuKeyboard };
