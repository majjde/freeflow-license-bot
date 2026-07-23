/**
 * Simple in-memory session store for multi-step conversations.
 * Keyed by Telegram user/chat ID with 15-minute TTL expiration.
 */

const sessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

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
};
