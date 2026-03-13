/**
 * /api/verify-turnstile
 *
 * POST { token: string, walletAddress: string }
 * →    { success: boolean, error?: string }
 *
 * Verifies a Cloudflare Turnstile challenge token server-side.
 * Single-use tokens — each successful verify invalidates the token.
 *
 * Required env vars:
 *   TURNSTILE_SECRET_KEY  — from Cloudflare Dashboard → Turnstile → your site
 *
 * Local dev : served by Vite middleware (see vite.config.js)
 * Production : deploy as a serverless function (Vercel / Netlify / Cloudflare Workers)
 */

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Simple in-memory rate limiter: max 5 verify attempts per IP per minute
// In production consider using Redis / KV store instead
const rateLimitMap = new Map(); // ip → { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

export async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
    return;
  }

  // Read body
  let raw = '';
  for await (const chunk of req) raw += chunk;

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
    return;
  }

  const { token, walletAddress } = body;

  if (!token || typeof token !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Missing Turnstile token' }));
    return;
  }

  // Rate limit by IP
  const clientIp =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (!checkRateLimit(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Too many requests. Try again in a minute.' }));
    return;
  }

  // Missing secret key — fail open in dev so you can test without Cloudflare setup
  if (!TURNSTILE_SECRET) {
    console.warn('[verify-turnstile] TURNSTILE_SECRET_KEY not set — skipping verification (dev mode)');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, dev: true }));
    return;
  }

  // Verify with Cloudflare
  try {
    const form = new URLSearchParams();
    form.append('secret',   TURNSTILE_SECRET);
    form.append('response', token);
    form.append('remoteip', clientIp);

    const cfRes  = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const cfData = await cfRes.json();

    if (cfData.success) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      const code = cfData['error-codes']?.[0] ?? 'unknown';
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `Challenge failed (${code})` }));
    }
  } catch (err) {
    console.error('[verify-turnstile]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Verification service unavailable' }));
  }
}