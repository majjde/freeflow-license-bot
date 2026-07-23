const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./config');

let db;

function withTransaction(fn) {
  getDb().exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    getDb().exec('COMMIT');
    return result;
  } catch (err) {
    getDb().exec('ROLLBACK');
    throw err;
  }
}

function initDatabase() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );

    CREATE TABLE IF NOT EXISTS Categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      validity_period TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL,
      upi_id TEXT NOT NULL,
      custom_message TEXT DEFAULT '',
      qr_photo_file_id TEXT
    );

    CREATE TABLE IF NOT EXISTS Keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_string TEXT NOT NULL UNIQUE,
      category_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'sold')),
      sold_to INTEGER,
      sold_at TEXT,
      reserved_by INTEGER,
      reserved_until TEXT,
      FOREIGN KEY (category_id) REFERENCES Categories(id),
      FOREIGN KEY (sold_to) REFERENCES Users(user_id)
    );

    CREATE TABLE IF NOT EXISTS Transactions (
      utr TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'unclaimed' CHECK(status IN ('unclaimed', 'claimed')),
      claimed_by INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      FOREIGN KEY (claimed_by) REFERENCES Users(user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_keys_category_status ON Keys(category_id, status);
    CREATE INDEX IF NOT EXISTS idx_keys_sold_to ON Keys(sold_to);
  `);

  // Safely alter table to add reservation columns if upgrading existing database
  try {
    db.exec('ALTER TABLE Keys ADD COLUMN reserved_by INTEGER;');
  } catch {}
  try {
    db.exec('ALTER TABLE Keys ADD COLUMN reserved_until TEXT;');
  } catch {}

  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// ─── Users ───────────────────────────────────────────────────────────────────

function upsertUser(userId, username) {
  getDb()
    .prepare(`
      INSERT INTO Users (user_id, username)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET username = excluded.username
    `)
    .run(userId, username || null);
}

function getUser(userId) {
  return getDb().prepare('SELECT * FROM Users WHERE user_id = ?').get(userId);
}

// ─── Categories ──────────────────────────────────────────────────────────────

function getAllCategories() {
  return getDb().prepare('SELECT * FROM Categories ORDER BY id ASC').all();
}

function getCategoryById(id) {
  return getDb().prepare('SELECT * FROM Categories WHERE id = ?').get(id);
}

function getCategoryByValidity(validityPeriod) {
  return getDb()
    .prepare('SELECT * FROM Categories WHERE validity_period = ?')
    .get(validityPeriod);
}

function upsertCategory({ validityPeriod, amount, upiId, customMessage, qrPhotoFileId }) {
  const existing = getCategoryByValidity(validityPeriod);

  if (existing) {
    getDb()
      .prepare(`
        UPDATE Categories
        SET amount = ?, upi_id = ?, custom_message = ?,
            qr_photo_file_id = COALESCE(?, qr_photo_file_id)
        WHERE validity_period = ?
      `)
      .run(amount, upiId, customMessage || '', qrPhotoFileId || null, validityPeriod);
    return getCategoryByValidity(validityPeriod);
  }

  const result = getDb()
    .prepare(`
      INSERT INTO Categories (validity_period, amount, upi_id, custom_message, qr_photo_file_id)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(validityPeriod, amount, upiId, customMessage || '', qrPhotoFileId || null);

  return getCategoryById(Number(result.lastInsertRowid));
}

function updateCategoryQr(categoryId, qrPhotoFileId) {
  getDb()
    .prepare('UPDATE Categories SET qr_photo_file_id = ? WHERE id = ?')
    .run(qrPhotoFileId, categoryId);
}

function deleteCategory(categoryId) {
  return withTransaction(() => {
    getDb()
      .prepare("DELETE FROM Keys WHERE category_id = ? AND status = 'available'")
      .run(categoryId);

    const result = getDb()
      .prepare('DELETE FROM Categories WHERE id = ?')
      .run(categoryId);

    return result.changes > 0;
  });
}

function getAvailableKeyCount(categoryId) {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) AS count
      FROM Keys
      WHERE category_id = ? AND status = 'available'
        AND (reserved_until IS NULL OR reserved_until < datetime('now', '+5 hours', '+30 minutes'))
    `)
    .get(categoryId);
  return row ? row.count : 0;
}

// ─── Keys ────────────────────────────────────────────────────────────────────

function bulkInsertKeys(categoryId, keyStrings) {
  return withTransaction(() => {
    const insert = getDb().prepare(`
      INSERT OR IGNORE INTO Keys (key_string, category_id, status)
      VALUES (?, ?, 'available')
    `);

    let inserted = 0;
    let skipped = 0;
    for (const key of keyStrings) {
      const result = insert.run(key, categoryId);
      if (result.changes > 0) inserted++;
      else skipped++;
    }
    return { inserted, skipped };
  });
}

function reserveAvailableKey(categoryId, userId) {
  return withTransaction(() => {
    // 1. Clear expired reservations
    getDb()
      .prepare(`
        UPDATE Keys
        SET reserved_by = NULL, reserved_until = NULL
        WHERE status = 'available'
          AND reserved_until IS NOT NULL
          AND reserved_until < datetime('now', '+5 hours', '+30 minutes')
      `)
      .run();

    // 2. Check if user already has an active reservation for this category
    const existing = getDb()
      .prepare(`
        SELECT * FROM Keys
        WHERE category_id = ? AND status = 'available' AND reserved_by = ?
          AND reserved_until > datetime('now', '+5 hours', '+30 minutes')
        LIMIT 1
      `)
      .get(categoryId, userId);

    if (existing) {
      return existing;
    }

    // 3. Find an unreserved key and lock it for 10 minutes (IST)
    const keyToReserve = getDb()
      .prepare(`
        SELECT * FROM Keys
        WHERE category_id = ? AND status = 'available'
          AND (reserved_until IS NULL OR reserved_until < datetime('now', '+5 hours', '+30 minutes'))
        LIMIT 1
      `)
      .get(categoryId);

    if (!keyToReserve) {
      return null;
    }

    getDb()
      .prepare(`
        UPDATE Keys
        SET reserved_by = ?, reserved_until = datetime('now', '+5 hours', '+30 minutes', '+10 minutes')
        WHERE id = ?
      `)
      .run(userId, keyToReserve.id);

    return getDb().prepare('SELECT * FROM Keys WHERE id = ?').get(keyToReserve.id);
  });
}

function getAvailableKey(categoryId, userId = null) {
  if (userId) {
    const reserved = getDb()
      .prepare(`
        SELECT * FROM Keys
        WHERE category_id = ? AND status = 'available' AND reserved_by = ?
        LIMIT 1
      `)
      .get(categoryId, userId);
    if (reserved) return reserved;
  }

  return getDb()
    .prepare(`
      SELECT * FROM Keys
      WHERE category_id = ? AND status = 'available'
        AND (reserved_until IS NULL OR reserved_until < datetime('now', '+5 hours', '+30 minutes'))
      LIMIT 1
    `)
    .get(categoryId);
}

function markKeySold(keyId, userId) {
  getDb()
    .prepare(`
      UPDATE Keys
      SET status = 'sold', sold_to = ?, sold_at = datetime('now', '+5 hours', '+30 minutes'),
          reserved_by = NULL, reserved_until = NULL
      WHERE id = ?
    `)
    .run(userId, keyId);
}

function getUserKeys(userId) {
  return getDb()
    .prepare(`
      SELECT k.key_string, k.sold_at, c.validity_period, c.amount
      FROM Keys k
      JOIN Categories c ON c.id = k.category_id
      WHERE k.sold_to = ? AND k.status = 'sold'
      ORDER BY k.sold_at DESC
    `)
    .all(userId);
}

// ─── Transactions ────────────────────────────────────────────────────────────

function insertTransaction(utr, amount) {
  try {
    getDb()
      .prepare(`
        INSERT INTO Transactions (utr, amount, status)
        VALUES (?, ?, 'unclaimed')
      `)
      .run(utr, amount);
    return { success: true, duplicate: false };
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed')) {
      return { success: false, duplicate: true };
    }
    throw err;
  }
}

function getTransaction(utr) {
  return getDb().prepare('SELECT * FROM Transactions WHERE utr = ?').get(utr);
}

function claimTransaction(utr, userId) {
  const result = getDb()
    .prepare(`
      UPDATE Transactions
      SET status = 'claimed', claimed_by = ?
      WHERE utr = ? AND status = 'unclaimed'
    `)
    .run(userId, utr);
  return result.changes > 0;
}

/**
 * Atomically claim a transaction and deliver a key.
 */
function processPaymentClaim({ utr, userId, categoryId, expectedAmount }) {
  return withTransaction(() => {
    const txn = getTransaction(utr);
    if (!txn) return { ok: false, reason: 'not_found' };
    if (txn.status === 'claimed') return { ok: false, reason: 'already_used' };

    // Forgiving amount: Overpayments allowed, underpayments rejected
    if (txn.amount < expectedAmount) {
      return { ok: false, reason: 'amount_mismatch', expected: expectedAmount, received: txn.amount };
    }

    const key = getAvailableKey(categoryId, userId);
    if (!key) return { ok: false, reason: 'no_keys' };

    const claimed = claimTransaction(utr, userId);
    if (!claimed) return { ok: false, reason: 'already_used' };

    markKeySold(key.id, userId);

    return {
      ok: true,
      key: key.key_string,
      amount: txn.amount,
    };
  });
}

module.exports = {
  initDatabase,
  getDb,
  upsertUser,
  getUser,
  getAllCategories,
  getCategoryById,
  getCategoryByValidity,
  upsertCategory,
  updateCategoryQr,
  deleteCategory,
  getAvailableKeyCount,
  bulkInsertKeys,
  reserveAvailableKey,
  getAvailableKey,
  markKeySold,
  getUserKeys,
  insertTransaction,
  getTransaction,
  claimTransaction,
  processPaymentClaim,
};
