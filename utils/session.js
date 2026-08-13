/**
 * Simple in-memory session store for multi-step conversations.
 * Keyed by Telegram user/chat ID with 15-minute TTL expiration.
 */

const sessions = new Map();
const SESSION_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

const ADMIN_STATES = {
  UPLOAD_KEYS: 'admin_upload_keys',
  MANAGE_CATEGORY: 'admin_manage_category',
  MANAGE_AMOUNT: 'admin_manage_amount',
  MANAGE_UPI: 'admin_manage_upi',
  MANAGE_MESSAGE: 'admin_manage_message',
  EDIT_SETTING_DOWNLOAD_MSG: 'admin_edit_setting_download_msg',
  EDIT_SETTING_VIP_INFO: 'admin_edit_setting_vip_info',
  EDIT_SETTING_USAGE_TEXT: 'admin_edit_setting_usage_text',
  EDIT_SETTING_USAGE_MEDIA: 'admin_edit_setting_usage_media',
  UPLOAD_EXTENSION_FILE: 'admin_upload_extension_file',
  CREATE_COUPON_CODE: 'admin_create_coupon_code',
  CREATE_COUPON_PERCENT: 'admin_create_coupon_percent',
  EDIT_SETTING_WELCOME_MESSAGE: 'admin_edit_setting_welcome_message',
};

const USER_STATES = {
  AWAITING_UTR: 'user_awaiting_utr',
  SPECIAL_OFFER_PENDING: 'user_special_offer_pending',
  AWAITING_TICKET_MESSAGE: 'user_awaiting_ticket_message',
  AWAITING_COUPON: 'user_awaiting_coupon',
  AWAITING_REVIEW: 'user_awaiting_review',
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

function getAllSessions() {
  const activeSessions = new Map();
  const now = Date.now();
  for (const [id, sess] of sessions.entries()) {
    if (now - (sess.updatedAt || 0) <= SESSION_TTL_MS) {
      activeSessions.set(id, sess);
    } else {
      sessions.delete(id);
    }
  }
  return activeSessions;
}

module.exports = {
  getSession,
  setSession,
  clearSession,
  hasSession,
  getAllSessions,
  ADMIN_STATES,
  USER_STATES,
};
