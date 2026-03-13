// api/verify-turnstile.js
// 1. Verifikasi Cloudflare Turnstile token
// 2. Cek IP + wallet di database SQLite (24 jam cooldown)
// 3. Catat claim ke database setelah TX sukses

import { canClaimByIP, canClaimByWallet, recordClaim } from './db.js';

const TURNSTILE_SECRET     = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function getClientIP(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function formatCooldown(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} jam ${m} menit`;
  return `${m} menit`;
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

  // Parse body
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw); }
  catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
    return;
  }

  const { token, walletAddress, action } = body;
  const ip = getClientIP(req);

  // ── action: 'record' — catat TX sukses ke DB ─────────────────────────────
  // Dipanggil dari Faucet.jsx setelah faucet.claim() berhasil on-chain
  if (action === 'record') {
    if (!walletAddress) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing walletAddress' }));
      return;
    }
    try {
      recordClaim(ip, walletAddress, body.txHash || null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      console.error('[verify-turnstile/record]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Failed to record claim' }));
    }
    return;
  }

  // ── action: 'verify' (default) ────────────────────────────────────────────
  if (!token) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Missing Turnstile token' }));
    return;
  }

  // 1. Cek IP cooldown dulu
  const ipCheck = canClaimByIP(ip);
  if (!ipCheck.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: `IP ini sudah claim. Coba lagi dalam ${formatCooldown(ipCheck.remainingSeconds)}.`,
      remainingSeconds: ipCheck.remainingSeconds,
      blockedBy: 'ip',
    }));
    return;
  }

  // 2. Cek wallet cooldown
  if (walletAddress) {
    const walletCheck = canClaimByWallet(walletAddress);
    if (!walletCheck.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: `Wallet ini sudah claim. Coba lagi dalam ${formatCooldown(walletCheck.remainingSeconds)}.`,
        remainingSeconds: walletCheck.remainingSeconds,
        blockedBy: 'wallet',
      }));
      return;
    }
  }

  // 3. Verifikasi Turnstile token ke Cloudflare
  if (!TURNSTILE_SECRET) {
    console.warn('[verify-turnstile] TURNSTILE_SECRET_KEY tidak di-set — skip (dev mode)');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, dev: true }));
    return;
  }

  try {
    const form = new URLSearchParams();
    form.append('secret',   TURNSTILE_SECRET);
    form.append('response', token);
    form.append('remoteip', ip);

    const cfRes  = await fetch(TURNSTILE_VERIFY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    form.toString(),
    });
    const cfData = await cfRes.json();

    if (cfData.success) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      const code = cfData['error-codes']?.[0] ?? 'unknown';
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `Challenge gagal (${code})` }));
    }
  } catch (err) {
    console.error('[verify-turnstile]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Verification service unavailable' }));
  }
}