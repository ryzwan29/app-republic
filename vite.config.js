import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { pathToFileURL } from 'url';
import path from 'path';

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
    server: {
      proxy: {
        '/rpc': {
          target: 'https://evm-rpc.republicai.io',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rpc/, ''),
        },
      },
    },
  };
});