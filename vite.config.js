import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { pathToFileURL } from 'url';
import path from 'path';

// EVM providers tried in order — mirrors server.js
const EVM_PROVIDERS = [
  'https://evm-rpc.republicai.io',
  'https://evmrpc-t.republicai.nodestake.org',
  'https://testnet-evm-republic.provewithryd.xyz',
];

function apiRoutesPlugin() {
  return {
    name: 'api-routes',
    configureServer(server) {
      // Parse JSON body helper (pengganti express.json() di Vite middleware)
      function parseBody(req) {
        return new Promise((resolve) => {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try { resolve(JSON.parse(body)); } catch { resolve({}); }
          });
        });
      }

      // ── /rpc → EVM JSON-RPC dengan fallback ke 3 provider ──────────────────
      server.middlewares.use('/rpc', async (req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', async () => {
          const body = Buffer.concat(chunks);

          for (const url of EVM_PROVIDERS) {
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 8000);

              const upstream = await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    body.length ? body : undefined,
                signal:  controller.signal,
              });

              clearTimeout(timer);

              if (!upstream.ok) {
                console.warn(`[/rpc] ${url} → HTTP ${upstream.status}, trying next…`);
                continue;
              }

              const data = Buffer.from(await upstream.arrayBuffer());
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(data);
              return;
            } catch (err) {
              console.warn(`[/rpc] ${url} failed: ${err.message}, trying next…`);
            }
          }

          console.error('[/rpc] All EVM providers failed');
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'All EVM RPC providers are unreachable.' }));
        });
      });

      // Helper untuk route handler dari file
      function registerRoute(route, file) {
        server.middlewares.use(route, async (req, res) => {
          try {
            const filePath = path.resolve(`./api/${file}`);
            const fileUrl  = pathToFileURL(filePath).href + '?t=' + Date.now();
            const { handler } = await import(fileUrl);
            await handler(req, res);
          } catch (err) {
            console.error(`[api/${file}]`, err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err.message) }));
          }
        });
      }

      registerRoute('/api/analyze',          'analyze.js');
      registerRoute('/api/trading-assistant', 'trading-assistant.js');
      registerRoute('/api/verify-turnstile', 'verify-turnstile.js');

      // ── Swap Volume API ──────────────────────────────────────────────────────
      server.middlewares.use('/api/swap-volume/record', async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405); res.end(); return;
        }
        try {
          const body = await parseBody(req);
          const { recordSwap } = await import(
            pathToFileURL(path.resolve('./api/swapVolumeDb.js')).href + '?t=' + Date.now()
          );
          const { pairKey, volumeUSD, fromSymbol, toSymbol, wallet, txHash } = body;
          if (!pairKey || !volumeUSD || !fromSymbol || !toSymbol) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing required fields' }));
            return;
          }
          recordSwap({ pairKey, volumeUSD: parseFloat(volumeUSD), fromSymbol, toSymbol, wallet, txHash });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error('[/api/swap-volume/record]', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/swap-volume/all', async (req, res) => {
        try {
          const { getAllVolumes24h } = await import(
            pathToFileURL(path.resolve('./api/swapVolumeDb.js')).href + '?t=' + Date.now()
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(getAllVolumes24h()));
        } catch (err) {
          console.error('[/api/swap-volume/all]', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);
  return {
    plugins: [react(), apiRoutesPlugin()],
  };
});