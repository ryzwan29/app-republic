import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────────────────
try {
  const env = readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
} catch { /* .env not found — rely on real env vars */ }

const PORT = parseInt(process.env.PORT, 10) || 3001;

const EVM_PROVIDERS_DEFAULT = [
  process.env.RPC_TARGET || 'https://evm-rpc.republicai.io',
  'https://evmrpc-t.republicai.nodestake.org',
  'https://testnet-evm-republic.provewithryd.xyz',
];

// Live-sorted list — diupdate tiap RECHECK_INTERVAL ms
let evmProviders = [...EVM_PROVIDERS_DEFAULT];
const RECHECK_INTERVAL = 5 * 60 * 1000; // 5 menit

// ── Latency probe ─────────────────────────────────────────────────────────────
async function pingEVM(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { url, ms: Infinity, ok: false };
    await res.json();
    return { url, ms: Date.now() - t0, ok: true };
  } catch {
    clearTimeout(timer);
    return { url, ms: Infinity, ok: false };
  }
}

async function sortByLatency() {
  const results = await Promise.all(EVM_PROVIDERS_DEFAULT.map(pingEVM));
  results.sort((a, b) => a.ms - b.ms);
  evmProviders = results.map(r => r.url);

  const summary = results.map(r =>
    r.ok ? `${r.url} (${r.ms}ms)` : `${r.url} (unreachable)`
  ).join('\n  ');
  console.log(`[/rpc] Provider order updated:\n  ${summary}`);
}

// Jalankan probe pertama kali pas startup, lalu tiap 5 menit
sortByLatency();
setInterval(sortByLatency, RECHECK_INTERVAL);

const app = express();

// ── 1. /rpc → EVM JSON-RPC, pakai provider tercepat duluan ───────────────────
app.use('/rpc', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const body = req.body && req.body.length ? req.body : undefined;

  for (const url of evmProviders) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const upstream = await fetch(url, {
        method:  req.method === 'GET' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal:  controller.signal,
      });

      clearTimeout(timer);

      if (!upstream.ok) {
        console.warn(`[/rpc] ${url} → HTTP ${upstream.status}, trying next…`);
        continue;
      }

      const data = await upstream.arrayBuffer();
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(Buffer.from(data));
      return;

    } catch (err) {
      console.warn(`[/rpc] ${url} failed: ${err.message}, trying next…`);
    }
  }

  console.error('[/rpc] All EVM providers failed');
  res.status(502).json({ error: 'All EVM RPC providers are unreachable. Try again later.' });
});

// ── 2. /api/analyze ───────────────────────────────────────────────────────────
app.use('/api/analyze', async (req, res) => {
  try {
    const { handler } = await import('./api/analyze.js');
    await handler(req, res);
  } catch (err) {
    console.error('[/api/analyze]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── 3. /api/trading-assistant ─────────────────────────────────────────────────
app.use('/api/trading-assistant', express.json(), async (req, res) => {
  try {
    const { handler } = await import('./api/trading-assistant.js');
    await handler(req, res);
  } catch (err) {
    console.error('[/api/trading-assistant]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── 3b. /api/verify-turnstile ──────────────────────────────────────────────────
app.use('/api/explain-tx', async (req, res) => {
  const { handler } = await import('./api/explain-tx.js');
  await handler(req, res);
});
app.use('/api/verify-turnstile', async (req, res) => {
  try {
    const { handler } = await import('./api/verify-turnstile.js');
    await handler(req, res);
  } catch (err) {
    console.error('[/api/verify-turnstile]', err);
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

// ── 4. /api/swap-volume/record ────────────────────────────────────────────────
app.post('/api/swap-volume/record', express.json(), async (req, res) => {
  try {
    const { recordSwap } = await import('./api/swapVolumeDb.js');
    const { pairKey, volumeUSD, fromSymbol, toSymbol, wallet, txHash } = req.body;
    if (!pairKey || !volumeUSD || !fromSymbol || !toSymbol) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    recordSwap({ pairKey, volumeUSD: parseFloat(volumeUSD), fromSymbol, toSymbol, wallet, txHash });
    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/swap-volume/record]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 5. /api/swap-volume/all ───────────────────────────────────────────────────
app.get('/api/swap-volume/all', async (req, res) => {
  try {
    const { getAllVolumes24h } = await import('./api/swapVolumeDb.js');
    res.json(getAllVolumes24h());
  } catch (err) {
    console.error('[/api/swap-volume/all]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 6. Static Vite build + SPA fallback ──────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('/{*path}', (_, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✓ Republic DEX server running on http://localhost:${PORT}`);
  console.log(`  /rpc  → auto-sorted by latency (checking…)`);
  console.log(`  /api/analyze               → api/analyze.js`);
  console.log(`  /api/trading-assistant     → api/trading-assistant.js`);
  console.log(`  /api/verify-turnstile      → api/verify-turnstile.js`);
  console.log(`  /api/swap-volume/record    → api/swapVolumeDb.js`);
  console.log(`  /api/swap-volume/all       → api/swapVolumeDb.js`);
  console.log(`  static                     → ${distPath}`);
});