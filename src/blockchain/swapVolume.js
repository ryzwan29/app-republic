/**
 * swapVolume.js — Track swap volume via backend API (SQLite database)
 *
 * Data disimpan di server db/swapvolume.db — persist across browser/restart.
 * Semua user share data yang sama → APR akurat untuk semua orang.
 */

const API_BASE = '/api/swap-volume';

// Pair key selalu format "WRAI-X"
function makePairKey(symbolA, symbolB) {
  const other = symbolA === 'WRAI' ? symbolB : symbolA;
  return `WRAI-${other}`;
}

/**
 * Dipanggil setelah swap berhasil di Swap.jsx
 */
export async function recordSwapVolume(fromSymbol, toSymbol, amountInUSD, wallet = null, txHash = null) {
  if (!amountInUSD || amountInUSD <= 0) return;

  try {
    if (fromSymbol === 'WRAI' || toSymbol === 'WRAI') {
      // Direct pair
      const pairKey = makePairKey(fromSymbol, toSymbol);
      await fetch(`${API_BASE}/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairKey, volumeUSD: amountInUSD, fromSymbol, toSymbol, wallet, txHash }),
      });
    } else {
      // Multi-hop: split volume ke dua pair
      const half = amountInUSD / 2;
      await Promise.all([
        fetch(`${API_BASE}/record`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairKey: `WRAI-${fromSymbol}`, volumeUSD: half, fromSymbol, toSymbol: 'WRAI', wallet, txHash }),
        }),
        fetch(`${API_BASE}/record`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairKey: `WRAI-${toSymbol}`, volumeUSD: half, fromSymbol: 'WRAI', toSymbol, wallet, txHash }),
        }),
      ]);
    }
  } catch (err) {
    console.warn('[recordSwapVolume] gagal simpan ke server:', err.message);
    // Tidak throw — gagal record tidak boleh ganggu UX swap
  }
}

// Cache volume supaya tidak spam API
let _volumeCache = {};
let _lastFetch = 0;
const CACHE_TTL = 60_000; // 60 detik

export async function fetchAllVolumes24h() {
  const now = Date.now();
  if (now - _lastFetch < CACHE_TTL) return _volumeCache;

  try {
    const res = await fetch(`${API_BASE}/all`);
    if (res.ok) {
      _volumeCache = await res.json();
      _lastFetch = now;
    }
  } catch (err) {
    console.warn('[fetchAllVolumes24h] gagal fetch dari server:', err.message);
  }
  return _volumeCache;
}

/**
 * Hitung APR — synchronous, pakai volumes dari fetchAllVolumes24h()
 */
export function calcAPR(token0Symbol, token1Symbol, tvlUSD, volumes) {
  if (!tvlUSD || tvlUSD <= 0) return null;
  const other = token0Symbol === 'WRAI' ? token1Symbol : token0Symbol;
  const pairKey = `WRAI-${other}`;
  const volume24h = volumes[pairKey] || 0;
  if (volume24h <= 0) return 0;
  const FEE = 0.003;
  return (volume24h * FEE * 365 / tvlUSD) * 100;
}