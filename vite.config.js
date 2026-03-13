import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { pathToFileURL } from 'url';
import path from 'path';

/**
 * Registers /api/* routes as Vite dev-server middleware.
 * In production, deploy files in /api/ as serverless functions.
 */
function apiRoutesPlugin() {
  return {
    name: 'api-routes',
    configureServer(server) {
      // Helper to wire up any /api/*.js handler
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

      registerRoute('/api/analyze',           'analyze.js');
      registerRoute('/api/verify-turnstile',  'verify-turnstile.js');
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