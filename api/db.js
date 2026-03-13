// api/db.js
// SQLite database untuk IP rate limiting faucet
// Pakai better-sqlite3 (synchronous, zero config)

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR    = path.join(__dirname, '..', 'db');
const DB_PATH   = path.join(DB_DIR, 'faucet.db');

// Pastikan folder db/ ada
mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL mode — lebih cepat untuk concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS claims (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ip             TEXT    NOT NULL,
    wallet_address TEXT    NOT NULL,
    claimed_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    tx_hash        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_claims_ip     ON claims(ip);
  CREATE INDEX IF NOT EXISTS idx_claims_wallet ON claims(wallet_address);
  CREATE INDEX IF NOT EXISTS idx_claims_time   ON claims(claimed_at);
`);

const COOLDOWN_SECONDS = 24 * 60 * 60; // 24 jam

// Cek apakah IP boleh claim
export function canClaimByIP(ip) {
  const since = Math.floor(Date.now() / 1000) - COOLDOWN_SECONDS;
  const row   = db.prepare(
    'SELECT claimed_at FROM claims WHERE ip = ? AND claimed_at > ? ORDER BY claimed_at DESC LIMIT 1'
  ).get(ip, since);

  if (!row) return { allowed: true };

  const nextAllowed = row.claimed_at + COOLDOWN_SECONDS;
  const remaining   = nextAllowed - Math.floor(Date.now() / 1000);
  return { allowed: false, remainingSeconds: remaining };
}

// Cek apakah wallet boleh claim
export function canClaimByWallet(wallet) {
  const since = Math.floor(Date.now() / 1000) - COOLDOWN_SECONDS;
  const row   = db.prepare(
    'SELECT claimed_at FROM claims WHERE wallet_address = ? AND claimed_at > ? ORDER BY claimed_at DESC LIMIT 1'
  ).get(wallet.toLowerCase(), since);

  if (!row) return { allowed: true };

  const nextAllowed = row.claimed_at + COOLDOWN_SECONDS;
  const remaining   = nextAllowed - Math.floor(Date.now() / 1000);
  return { allowed: false, remainingSeconds: remaining };
}

// Catat claim baru
export function recordClaim(ip, wallet, txHash = null) {
  db.prepare(
    'INSERT INTO claims (ip, wallet_address, claimed_at, tx_hash) VALUES (?, ?, strftime(\'%s\', \'now\'), ?)'
  ).run(ip, wallet.toLowerCase(), txHash);
}

// Stats (opsional, buat debug)
export function getStats() {
  return {
    totalClaims:   db.prepare('SELECT COUNT(*) as n FROM claims').get().n,
    last24h:       db.prepare(`SELECT COUNT(*) as n FROM claims WHERE claimed_at > strftime('%s','now') - 86400`).get().n,
    uniqueIPs:     db.prepare('SELECT COUNT(DISTINCT ip) as n FROM claims').get().n,
    uniqueWallets: db.prepare('SELECT COUNT(DISTINCT wallet_address) as n FROM claims').get().n,
  };
}

export default db;