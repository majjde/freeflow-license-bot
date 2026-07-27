/**
 * Simple in-memory session store for multi-step conversations.
 * Keyed by Telegram user/chat ID with 15-minute TTL expiration.
 */

const sessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

const ADMIN_STATES = {
  UPLOAD_KEYS: 'admin_upload_keys',
  MANAGE_CATEGORY: 'admin_manage_category',
  MANAGE_AMOUNT: 'admin_manage_amount',
  MANAGE_UPI: 'admin_manage_upi',
  MANAGE_MESSAGE: 'admin_manage_message',
  MANAGE_QR: 'admin_manage_qr',
  EDIT_SETTING_DOWNLOAD_MSG: 'admin_edit_setting_download_msg',
  EDIT_SETTING_INSTALL: 'admin_edit_setting_install',
  EDIT_SETTING_USAGE: 'admin_edit_setting_usage',
  EDIT_SETTING_NOTICE: 'admin_edit_setting_notice',
  UPLOAD_EXTENSION_FILE: 'admin_upload_extension_file',
};

function getSession(id) {
  if (sessions.has(id)) {
    const sess = sessions.get(id);
    if (Date.now() - (sess.updatedAt || 0) > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
  if (!sessions.has(id)) {
    sessions.set(id, { updatedAt: Date.now() });
  }
  return sessions.get(id);
}

function setSession(id, data) {
  const current = getSession(id);
  sessions.set(id, { ...current, ...data, updatedAt: Date.now() });
}

function clearSession(id) {
  sessions.delete(id);
}

function hasSession(id) {
  const sess = sessions.get(id);
  if (!sess) return false;
  if (Date.now() - (sess.updatedAt || 0) > SESSION_TTL_MS) {
    sessions.delete(id);
    return false;
  }
  return true;
}

module.exports = {
  getSession,
  setSession,
  clearSession,
  hasSession,
  ADMIN_STATES,
};
