import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env manually (no dotenv dependency needed) ──────────────────────────
try {
  const env = readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
} catch { /* .env not found — rely on real env vars */ }

const PORT       = parseInt(process.env.PORT, 10) || 3001; // default 3001 → reverse-proxy ke https domain
const RPC_TARGET = process.env.RPC_TARGET || 'https://evm-rpc.republicai.io';

const app = express();

// ── 1. /rpc → proxy to EVM RPC node ──────────────────────────────────────────
app.use('/rpc', createProxyMiddleware({
  target: RPC_TARGET,
  changeOrigin: true,
  pathRewrite: { '^/rpc': '' },
  on: {
    error: (err, req, res) => {
      console.error('[/rpc proxy error]', err.message);
      res.status(502).json({ error: 'RPC proxy error: ' + err.message });
    },
  },
}));

// ── 2. /api/analyze → AI analysis handler ────────────────────────────────────
app.use('/api/analyze', async (req, res) => {
  try {
    const { handler } = await import('./api/analyze.js');
    await handler(req, res);
  } catch (err) {
    console.error('[/api/analyze]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── 3. /api/verify-turnstile → Cloudflare Turnstile verification ──────────────
app.use('/api/verify-turnstile', async (req, res) => {
  try {
    const { handler } = await import('./api/verify-turnstile.js');
    await handler(req, res);
  } catch (err) {
    console.error('[/api/verify-turnstile]', err);
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

// ── 4. /api/swap-volume/record → catat swap ke database ──────────────────────
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

// ── 5. /api/swap-volume/all → ambil volume 24h semua pair ────────────────────
app.get('/api/swap-volume/all', async (req, res) => {
  try {
    const { getAllVolumes24h } = await import('./api/swapVolumeDb.js');
    res.json(getAllVolumes24h());
  } catch (err) {
    console.error('[/api/swap-volume/all]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 4. Serve Vite production build ────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback — all other routes serve index.html
app.get('/{*path}', (_, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✓ Republic DEX server running on http://localhost:${PORT}`);
  console.log(`  /rpc                       → ${RPC_TARGET}`);
  console.log(`  /api/analyze               → api/analyze.js`);
  console.log(`  /api/verify-turnstile      → api/verify-turnstile.js`);
  console.log(`  /api/swap-volume/record    → api/swapVolumeDb.js`);
  console.log(`  /api/swap-volume/all       → api/swapVolumeDb.js`);
  console.log(`  static                     → ${distPath}`);
});