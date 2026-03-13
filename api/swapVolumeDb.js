// api/swapVolumeDb.js
// SQLite database untuk tracking swap volume — dipakai untuk kalkulasi APR
// Pakai better-sqlite3 (synchronous, zero config) — sama seperti faucet.db

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR    = path.join(__dirname, '..', 'db');
const DB_PATH   = path.join(DB_DIR, 'swapvolume.db');

mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS swap_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pair_key    TEXT    NOT NULL,
    volume_usd  REAL    NOT NULL,
    from_symbol TEXT    NOT NULL,
    to_symbol   TEXT    NOT NULL,
    wallet      TEXT,
    tx_hash     TEXT,
    swapped_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_swap_pair ON swap_events(pair_key);
  CREATE INDEX IF NOT EXISTS idx_swap_time ON swap_events(swapped_at);
`);

const ONE_DAY_SECONDS = 24 * 60 * 60;

// Record swap baru
export function recordSwap({ pairKey, volumeUSD, fromSymbol, toSymbol, wallet = null, txHash = null }) {
  db.prepare(`
    INSERT INTO swap_events (pair_key, volume_usd, from_symbol, to_symbol, wallet, tx_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(pairKey, volumeUSD, fromSymbol, toSymbol, wallet || null, txHash || null);
}

// Ambil total volume 24h untuk satu pair
export function getVolume24h(pairKey) {
  const since = Math.floor(Date.now() / 1000) - ONE_DAY_SECONDS;
  const row = db.prepare(`
    SELECT COALESCE(SUM(volume_usd), 0) as total
    FROM swap_events
    WHERE pair_key = ? AND swapped_at > ?
  `).get(pairKey, since);
  return row ? row.total : 0;
}

// Ambil volume 24h untuk semua pair sekaligus
export function getAllVolumes24h() {
  const since = Math.floor(Date.now() / 1000) - ONE_DAY_SECONDS;
  const rows = db.prepare(`
    SELECT pair_key, COALESCE(SUM(volume_usd), 0) as total
    FROM swap_events
    WHERE swapped_at > ?
    GROUP BY pair_key
  `).all(since);
  const result = {};
  for (const row of rows) result[row.pair_key] = row.total;
  return result;
}

// Stats untuk debug
export function getStats() {
  return {
    totalSwaps:   db.prepare('SELECT COUNT(*) as n FROM swap_events').get().n,
    last24h:      db.prepare(`SELECT COUNT(*) as n FROM swap_events WHERE swapped_at > strftime('%s','now') - 86400`).get().n,
    uniqueWallets: db.prepare('SELECT COUNT(DISTINCT wallet) as n FROM swap_events').get().n,
  };
}

// Cleanup events lebih dari 7 hari (opsional, jalankan periodic)
export function pruneOld() {
  const since = Math.floor(Date.now() / 1000) - 7 * ONE_DAY_SECONDS;
  db.prepare('DELETE FROM swap_events WHERE swapped_at < ?').run(since);
}

export default db;