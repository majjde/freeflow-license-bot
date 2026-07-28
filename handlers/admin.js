const { Markup } = require('telegraf');
const db = require('../database');
const fs = require('fs');
const { ADMIN_CHAT_ID, VALIDITY_PERIODS, DB_PATH } = require('../config');
const { getSession, setSession, clearSession } = require('../utils/session');

const ADMIN_STATES = {
  UPLOAD_KEYS: 'admin_upload_keys',
  MANAGE_CATEGORY: 'admin_manage_category',
  MANAGE_AMOUNT: 'admin_manage_amount',
  MANAGE_UPI: 'admin_manage_upi',
  MANAGE_MESSAGE: 'admin_manage_message',
  MANAGE_QR: 'admin_manage_qr',
  EDIT_SETTING_DOWNLOAD_MSG: 'admin_edit_setting_download_msg',
  EDIT_SETTING_VIP_INFO: 'admin_edit_setting_vip_info',
  EDIT_SETTING_USAGE: 'admin_edit_setting_usage',
  UPLOAD_EXTENSION_FILE: 'admin_upload_extension_file',
};

function isAdmin(ctx) {
  return ctx.from && ctx.chat && ctx.chat.type === 'private' && ctx.chat.id === ADMIN_CHAT_ID;
}

function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📤 Upload Keys', 'admin:upload_keys')],
    [Markup.button.callback('⚙️ Manage Categories', 'admin:manage_categories')],
    [Markup.button.callback('⚙️ Bot Settings', 'admin:settings')],
    [Markup.button.callback('📊 Stock Overview', 'admin:stock')],
  ]);
}

function settingsSubmenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Edit VIP Info', 'admin_edit_setting:vip_info')],
    [Markup.button.callback('✏️ Edit Usage Guide', 'admin_edit_setting:usage')],
    [Markup.button.callback('✏️ Edit Download Msg', 'admin_edit_setting:download_msg')],
    [Markup.button.callback('📦 Upload Extension (.zip)', 'admin_upload_extension')],
    [Markup.button.callback('« Back', 'admin:panel')],
  ]);
}

function categorySelectKeyboard(prefix) {
  const categories = db.getAllCategories();
  const buttons = [];

  if (categories.length > 0) {
    for (const cat of categories) {
      buttons.push([
        Markup.button.callback(
          `${cat.validity_period} (₹${cat.amount})`,
          `${prefix}:${cat.id}`
        ),
      ]);
    }
  }

  for (const period of VALIDITY_PERIODS) {
    if (!categories.find((c) => c.validity_period === period)) {
      buttons.push([
        Markup.button.callback(`➕ Add ${period}`, `${prefix}_new:${period}`),
      ]);
    }
  }

  buttons.push([Markup.button.callback('« Back', 'admin:panel')]);
  return Markup.inlineKeyboard(buttons);
}

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

function parseKeysFromInput(text) {
  return text
    .split(/[\n,]+/)
    .map((k) => k.replace(/[^a-zA-Z0-9-]/g, '').trim())
    .filter((k) => k.length > 0);
}

function registerAdminHandlers(bot) {
  bot.command('admin', async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isAdmin(ctx)) {
      return ctx.reply('⛔ Unauthorized.');
    }
    await ctx.reply('🔐 <b>Admin Panel</b>\n\nSelect an action:', {
      parse_mode: 'HTML',
      ...adminPanelKeyboard(),
    });
  });

  bot.command('backup', async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isAdmin(ctx)) {
      return ctx.reply('⛔ Unauthorized.');
    }

    try {
      if (!fs.existsSync(DB_PATH)) {
        return ctx.reply('❌ Database file not found.');
      }

      await ctx.replyWithDocument(
        { source: DB_PATH, filename: 'bot.db' },
        {
          caption:
            '📦 Here is your latest database backup. You can open it using DB Browser for SQLite on your PC.',
        }
      );
    } catch (err) {
      console.error('Backup command error:', err);
      await ctx.reply(`❌ Failed to send backup: ${err.message}`);
    }
  });

  bot.action('admin:panel', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();
    clearSession(ctx.from.id);
    await ctx.editMessageText('🔐 <b>Admin Panel</b>\n\nSelect an action:', {
      parse_mode: 'HTML',
      ...adminPanelKeyboard(),
    });
  });

  // ─── Stock Overview ────────────────────────────────────────────────────────

  bot.action('admin:stock', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();

    const categories = db.getAllCategories();
    if (categories.length === 0) {
      return ctx.editMessageText('No categories configured yet.', adminPanelKeyboard());
    }

    const lines = categories.map((cat) => {
      const available = db.getAvailableKeyCount(cat.id);
      return `• <b>${cat.validity_period}</b>: ${available} keys available (₹${cat.amount})`;
    });

    await ctx.editMessageText(`📊 <b>Stock Overview</b>\n\n${lines.join('\n')}`, {
      parse_mode: 'HTML',
      ...adminPanelKeyboard(),
    });
  });

  // ─── Upload Keys ───────────────────────────────────────────────────────────

  bot.action('admin:upload_keys', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();

    await ctx.editMessageText(
      '📤 <b>Upload Keys</b>\n\nSelect a category to add keys:',
      { parse_mode: 'HTML', ...categorySelectKeyboard('admin_upload_cat') }
    );
  });

  bot.action(/^admin_upload_cat:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();

    const categoryId = Number(ctx.match[1]);
    const category = db.getCategoryById(categoryId);
    if (!category) {
      return ctx.editMessageText('Category not found.', adminPanelKeyboard());
    }

    setSession(ctx.from.id, {
      state: ADMIN_STATES.UPLOAD_KEYS,
      categoryId,
    });

    await ctx.editMessageText(
      `📤 Upload keys for <b>${category.validity_period}</b>\n\n` +
        'Send keys as:\n' +
        '• A plain text message (one per line or comma-separated)\n' +
        '• A .txt document\n\n' +
        'Type /cancel to abort.',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'admin:panel')]]),
      }
    );
  });

  // ─── Manage Categories ─────────────────────────────────────────────────────

  bot.action('admin:manage_categories', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();

    await ctx.editMessageText(
      '⚙️ <b>Manage Categories</b>\n\nSelect a category to configure:',
      { parse_mode: 'HTML', ...categorySelectKeyboard('admin_manage_cat') }
    );
  });

  bot.action(/^admin_manage_cat:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();

    const categoryId = Number(ctx.match[1]);
    const category = db.getCategoryById(categoryId);
    if (!category) {
      return ctx.editMessageText('Category not found.', adminPanelKeyboard());
    }

    const available = db.getAvailableKeyCount(categoryId);
    const text =
      `⚙️ <b>Category: ${category.validity_period}</b>\n\n` +
      `💰 Amount: ₹${category.amount}\n` +
      `📱 UPI ID: <code>${category.upi_id}</code>\n` +
      `💬 Message: ${category.custom_message || '(none)'}\n` +
      `🖼 QR Code: ${category.qr_photo_file_id ? '✅ Set' : '❌ Not set'}\n` +
      `🔑 Available keys: ${available}`;

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💰 Set Amount', `admin_set_amount:${categoryId}`)],
        [Markup.button.callback('📱 Set UPI ID', `admin_set_upi:${categoryId}`)],
        [Markup.button.callback('💬 Set Message', `admin_set_message:${categoryId}`)],
        [Markup.button.callback('🖼 Upload QR Code', `admin_set_qr:${categoryId}`)],
        [Markup.button.callback('🗑️ Delete Category', `admin_delete_cat:${categoryId}`)],
        [Markup.button.callback('« Back', 'admin:manage_categories')],
      ]),
    });
  });

  bot.action(/^admin_delete_cat:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    const categoryId = Number(ctx.match[1]);
    try {
      db.deleteCategory(categoryId);
      await ctx.answerCbQuery('Category deleted');
    } catch (err) {
      console.error('Failed to delete category:', err);
      await ctx.answerCbQuery('Failed to delete category');
    }
    clearSession(ctx.from.id);

    await ctx.editMessageText(
      '⚙️ <b>Manage Categories</b>\n\n✅ Category deleted. Select a category to configure:',
      { parse_mode: 'HTML', ...categorySelectKeyboard('admin_manage_cat') }
    );
  });

  bot.action(/^admin_manage_cat_new:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();

    const validityPeriod = ctx.match[1];

    if (validityPeriod === '15m') {
      const category = db.upsertCategory({
        validityPeriod,
        amount: 0,
        upiId: 'FREE',
        customMessage: 'Free 15 Min Demo Key',
        qrPhotoFileId: null,
      });

      return ctx.editMessageText(
        `✅ Category <b>Free 15 Min Demo (15m)</b> created free of cost (₹0)!\n\n` +
          `You can now upload keys for this category.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📤 Upload Keys Now', `admin_upload_cat:${category.id}`)],
            [Markup.button.callback('View Category', `admin_manage_cat:${category.id}`)],
            [Markup.button.callback('Admin Panel', 'admin:panel')],
          ]),
        }
      );
    }

    setSession(ctx.from.id, {
      state: ADMIN_STATES.MANAGE_CATEGORY,
      validityPeriod,
      draft: { validityPeriod, amount: null, upiId: null, customMessage: '', qrPhotoFileId: null },
    });

    await ctx.editMessageText(
      `➕ Creating category <b>${validityPeriod}</b>\n\nEnter the price in INR (e.g. 99 or 149.00):`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'admin:panel')]]),
      }
    );
    setSession(ctx.from.id, { state: ADMIN_STATES.MANAGE_AMOUNT });
  });

  // Category field setters for existing categories
  bot.action(/^admin_set_amount:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();
    const categoryId = Number(ctx.match[1]);
    setSession(ctx.from.id, { state: ADMIN_STATES.MANAGE_AMOUNT, categoryId, editing: true });
    await ctx.editMessageText('Enter new amount in INR:', Markup.inlineKeyboard([
      [Markup.button.callback('« Cancel', `admin_manage_cat:${categoryId}`)],
    ]));
  });

  bot.action(/^admin_set_upi:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();
    const categoryId = Number(ctx.match[1]);
    setSession(ctx.from.id, { state: ADMIN_STATES.MANAGE_UPI, categoryId, editing: true });
    await ctx.editMessageText('Enter UPI ID (e.g. name@upi):', Markup.inlineKeyboard([
      [Markup.button.callback('« Cancel', `admin_manage_cat:${categoryId}`)],
    ]));
  });

  bot.action(/^admin_set_message:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();
    const categoryId = Number(ctx.match[1]);
    setSession(ctx.from.id, { state: ADMIN_STATES.MANAGE_MESSAGE, categoryId, editing: true });
    await ctx.editMessageText('Enter custom message for buyers:', Markup.inlineKeyboard([
      [Markup.button.callback('« Cancel', `admin_manage_cat:${categoryId}`)],
    ]));
  });

  bot.action(/^admin_set_qr:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();
    const categoryId = Number(ctx.match[1]);
    setSession(ctx.from.id, { state: ADMIN_STATES.MANAGE_QR, categoryId });
    await ctx.editMessageText('Send the QR code as a photo:', Markup.inlineKeyboard([
      [Markup.button.callback('« Cancel', `admin_manage_cat:${categoryId}`)],
    ]));
  });

  // ─── Bot Settings & CMS ──────────────────────────────────────────────────

  bot.action('admin:settings', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();
    clearSession(ctx.from.id);
    await ctx.editMessageText('⚙️ <b>Bot Settings & Content Management</b>\n\nSelect an option to configure:', {
      parse_mode: 'HTML',
      ...settingsSubmenuKeyboard(),
    });
  });

  bot.action(/^admin_edit_setting:(vip_info|usage|download_msg)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();

    const key = ctx.match[1];
    const stateMap = {
      vip_info: ADMIN_STATES.EDIT_SETTING_VIP_INFO,
      usage: ADMIN_STATES.EDIT_SETTING_USAGE,
      download_msg: ADMIN_STATES.EDIT_SETTING_DOWNLOAD_MSG,
    };
    const titleMap = {
      vip_info: 'VIP Info',
      usage: 'How to Use Guide',
      download_msg: 'Download Message',
    };
    const settingKeyMap = {
      vip_info: 'vip_info',
      usage: 'usage',
      download_msg: 'download_msg',
    };

    const settingKey = settingKeyMap[key] || key;

    setSession(ctx.from.id, {
      state: stateMap[key],
      settingKey,
    });

    const currentVal = db.getSetting(settingKey, '(Not set)');

    await ctx.editMessageText(
      `✏️ <b>Edit ${titleMap[key]}</b>\n\n` +
        `Current content:\n<code>${currentVal}</code>\n\n` +
        `Please send the new formatted text for this setting (HTML tags supported, e.g. <b>bold</b>, <code>code</code>, etc.).\n\n` +
        `Type /cancel to abort.`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'admin:settings')]]),
      }
    );
  });

  bot.action('admin_upload_extension', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Unauthorized');
    await ctx.answerCbQuery();

    setSession(ctx.from.id, {
      state: ADMIN_STATES.UPLOAD_EXTENSION_FILE,
    });

    const currentFileId = db.getSetting('extension_file_id', null);

    await ctx.editMessageText(
      `📦 <b>Upload Extension (.zip)</b>\n\n` +
        `Current Status: ${currentFileId ? '✅ Extension file is set' : '❌ No extension file uploaded'}\n\n` +
        `Please send the extension <b>.zip file</b> as a Telegram document.\n\n` +
        `Type /cancel to abort.`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'admin:settings')]]),
      }
    );
  });

  // ─── Admin text / document / photo handlers ────────────────────────────────

  bot.on('document', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();

    const session = getSession(ctx.from.id);

    if (session.state === ADMIN_STATES.UPLOAD_EXTENSION_FILE) {
      try {
        const doc = ctx.message.document;
        const fileId = doc.file_id;
        db.setSetting('extension_file_id', fileId);
        clearSession(ctx.from.id);
        await ctx.reply(
          '✅ <b>Extension File Uploaded!</b>\n\nUsers can now download this extension directly from the bot menu.',
          {
            parse_mode: 'HTML',
            ...settingsSubmenuKeyboard(),
          }
        );
      } catch (err) {
        console.error('Extension upload error:', err);
        await ctx.reply('Failed to process extension file. Please try again.');
      }
      return;
    }

    if (session.state === ADMIN_STATES.UPLOAD_KEYS) {
      try {
        const doc = ctx.message.document;
        if (!doc.file_name?.endsWith('.txt') && doc.mime_type !== 'text/plain') {
          return ctx.reply('Please send a .txt file or paste keys as text.');
        }

        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await fetch(fileLink.href);
        const text = await response.text();
        const keys = parseKeysFromInput(text);

        if (keys.length === 0) {
          return ctx.reply('No valid keys found in the file.');
        }

        const { inserted, skipped } = db.bulkInsertKeys(session.categoryId, keys);
        clearSession(ctx.from.id);
        await ctx.reply(
          `✅ Uploaded ${inserted} key(s). ${skipped > 0 ? `${skipped} duplicate(s) skipped.` : ''}`,
          adminPanelKeyboard()
        );
      } catch (err) {
        console.error('Key upload error:', err);
        await ctx.reply('Failed to process file. Please try again.');
      }
      return;
    }

    return next();
  });

  bot.on('photo', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();

    const session = getSession(ctx.from.id);
    if (session.state === ADMIN_STATES.MANAGE_QR && session.categoryId) {
      const photos = ctx.message.photo;
      const fileId = photos[photos.length - 1].file_id;
      db.updateCategoryQr(session.categoryId, fileId);
      clearSession(ctx.from.id);
      await ctx.reply('✅ QR code updated.', Markup.inlineKeyboard([
        [Markup.button.callback('« Back to Category', `admin_manage_cat:${session.categoryId}`)],
      ]));
      return;
    }

    if (session.state === ADMIN_STATES.MANAGE_QR && session.draft) {
      const photos = ctx.message.photo;
      session.draft.qrPhotoFileId = photos[photos.length - 1].file_id;
      finalizeNewCategory(ctx, session);
      return;
    }

    return next();
  });

  async function finalizeNewCategory(ctx, session) {
    const { draft } = session;
    if (!draft.amount || !draft.upiId) {
      return ctx.reply('Missing amount or UPI ID. Please start again from Manage Categories.');
    }

    const category = db.upsertCategory({
      validityPeriod: draft.validityPeriod,
      amount: draft.amount,
      upiId: draft.upiId,
      customMessage: draft.customMessage,
      qrPhotoFileId: draft.qrPhotoFileId,
    });

    clearSession(ctx.from.id);
    await ctx.reply(
      `✅ Category <b>${category.validity_period}</b> saved!\n` +
        `Amount: ₹${category.amount}\nUPI: <code>${category.upi_id}</code>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('View Category', `admin_manage_cat:${category.id}`)],
          [Markup.button.callback('Admin Panel', 'admin:panel')],
        ]),
      }
    );
  }

  bot.on('text', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (ctx.message.text.startsWith('/')) return next();

    const session = getSession(ctx.from.id);
    const text = ctx.message.text.trim();

    try {
      // Dynamic CMS text setting update
      if (
        session.state === ADMIN_STATES.EDIT_SETTING_VIP_INFO ||
        session.state === ADMIN_STATES.EDIT_SETTING_USAGE ||
        session.state === ADMIN_STATES.EDIT_SETTING_DOWNLOAD_MSG
      ) {
        if (!session.settingKey) {
          clearSession(ctx.from.id);
          return ctx.reply('Session expired. Please try again from Bot Settings.');
        }

        db.setSetting(session.settingKey, ctx.message.text);
        const key = session.settingKey;
        clearSession(ctx.from.id);

        return ctx.reply(
          `✅ <b>Setting Updated Successfully!</b>\n\nThe <code>${key}</code> text has been updated.`,
          {
            parse_mode: 'HTML',
            ...settingsSubmenuKeyboard(),
          }
        );
      }

      // Upload keys via text
      if (session.state === ADMIN_STATES.UPLOAD_KEYS && session.categoryId) {
        const keys = parseKeysFromInput(text);
        if (keys.length === 0) {
          return ctx.reply('No valid keys found. Send one key per line or comma-separated.');
        }
        const { inserted, skipped } = db.bulkInsertKeys(session.categoryId, keys);
        clearSession(ctx.from.id);
        return ctx.reply(
          `✅ Uploaded ${inserted} key(s). ${skipped > 0 ? `${skipped} duplicate(s) skipped.` : ''}`,
          adminPanelKeyboard()
        );
      }

      // New category: amount
      if (session.state === ADMIN_STATES.MANAGE_AMOUNT) {
        const amount = parseFloat(text);
        if (Number.isNaN(amount) || amount < 0) {
          return ctx.reply('Invalid amount. Enter 0 for free plans or a positive number (e.g. 99).');
        }

        if (session.editing && session.categoryId) {
          const cat = db.getCategoryById(session.categoryId);
          db.upsertCategory({
            validityPeriod: cat.validity_period,
            amount,
            upiId: cat.upi_id,
            customMessage: cat.custom_message,
            qrPhotoFileId: cat.qr_photo_file_id,
          });
          clearSession(ctx.from.id);
          return ctx.reply('✅ Amount updated.', Markup.inlineKeyboard([
            [Markup.button.callback('« Back', `admin_manage_cat:${session.categoryId}`)],
          ]));
        }

        session.draft = session.draft || { validityPeriod: session.validityPeriod };
        session.draft.amount = amount;
        setSession(ctx.from.id, { state: ADMIN_STATES.MANAGE_UPI, draft: session.draft });
        return ctx.reply('Enter UPI ID (e.g. name@upi):');
      }

      // New/existing category: UPI
      if (session.state === ADMIN_STATES.MANAGE_UPI) {
        if (text.length < 3) {
          return ctx.reply('Invalid UPI ID. Try again.');
        }

        if (session.editing && session.categoryId) {
          const cat = db.getCategoryById(session.categoryId);
          db.upsertCategory({
            validityPeriod: cat.validity_period,
            amount: cat.amount,
            upiId: text,
            customMessage: cat.custom_message,
            qrPhotoFileId: cat.qr_photo_file_id,
          });
          clearSession(ctx.from.id);
          return ctx.reply('✅ UPI ID updated.', Markup.inlineKeyboard([
            [Markup.button.callback('« Back', `admin_manage_cat:${session.categoryId}`)],
          ]));
        }

        session.draft.upiId = text;
        setSession(ctx.from.id, { state: ADMIN_STATES.MANAGE_MESSAGE, draft: session.draft });
        return ctx.reply('Enter a short custom message for buyers (or send - to skip):');
      }

      // New category: custom message
      if (session.state === ADMIN_STATES.MANAGE_MESSAGE) {
        if (session.editing && session.categoryId) {
          const cat = db.getCategoryById(session.categoryId);
          db.upsertCategory({
            validityPeriod: cat.validity_period,
            amount: cat.amount,
            upiId: cat.upi_id,
            customMessage: text === '-' ? '' : text,
            qrPhotoFileId: cat.qr_photo_file_id,
          });
          clearSession(ctx.from.id);
          return ctx.reply('✅ Message updated.', Markup.inlineKeyboard([
            [Markup.button.callback('« Back', `admin_manage_cat:${session.categoryId}`)],
          ]));
        }

        session.draft.customMessage = text === '-' ? '' : text;
        setSession(ctx.from.id, { state: ADMIN_STATES.MANAGE_QR, draft: session.draft });
        return ctx.reply('Send the QR code photo for this category (or send - to skip):');
      }

      if (session.state === ADMIN_STATES.MANAGE_QR && session.draft && text === '-') {
        finalizeNewCategory(ctx, session);
        return;
      }
    } catch (err) {
      console.error('Admin handler error:', err);
      await ctx.reply('Something went wrong. Please try again.');
      clearSession(ctx.from.id);
      return;
    }

    return next();
  });

  bot.command('cancel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    clearSession(ctx.from.id);
    await ctx.reply('Cancelled.', adminPanelKeyboard());
  });
}

module.exports = { registerAdminHandlers, isAdmin, ADMIN_STATES };
