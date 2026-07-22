/**
 * Simple in-memory session store for multi-step conversations.
 * Keyed by Telegram user/chat ID.
 */

const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {});
  }
  return sessions.get(id);
}

function setSession(id, data) {
  sessions.set(id, { ...getSession(id), ...data });
}

function clearSession(id) {
  sessions.delete(id);
}

function hasSession(id) {
  return sessions.has(id);
}

module.exports = {
  getSession,
  setSession,
  clearSession,
  hasSession,
};
