import { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../App.jsx';
import { LoadingOverlay } from '../components/LoadingSpinner.jsx';
import { TokenIcon } from '../components/TokenSelector.jsx';
import { getProvider, getWeb3Provider } from '../blockchain/evm.js';
import { CONTRACTS, FAUCET_ABI } from '../blockchain/tokens.js';
import { getOraclePrice } from '../blockchain/amm.js';

const PRICE_REFRESH_SEC = 60;
const USD_TARGET = 100;

const FAUCET_TOKENS = [
  { symbol: 'USDT' },
  { symbol: 'USDC' },
  { symbol: 'WBTC' },
  { symbol: 'WETH' },
];

function formatTokenAmount(amount) {
  if (!amount || isNaN(amount)) return '—';
  if (amount >= 1000) return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (amount >= 1)    return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return amount.toLocaleString(undefined, { maximumSignificantDigits: 5 });
}

// Cloudflare Turnstile test keys (work on localhost, no domain needed):
//   Site key  : 1x00000000000000000000AA  → always passes (dev)
//   Site key  : 2x00000000000000000000AB  → always blocks  (test rejection)
//   Site key  : 3x00000000000000000000FF  → forces interactive challenge
// For production set VITE_TURNSTILE_SITE_KEY in .env to your real site key.
const TURNSTILE_SITE_KEY =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

// Script URL — render=explicit so we control when widgets mount
const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=cfTurnstileReady';

// ── Turnstile widget component ─────────────────────────────────────────────────
function TurnstileWidget({ onVerify, onExpire, onError, resetKey }) {
  const containerRef = useRef(null);
  const widgetIdRef  = useRef(null);

  useEffect(() => {
    let cancelled = false;

    function mountWidget() {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      // Clean up previous widget
      if (widgetIdRef.current !== null) {
        try { window.turnstile.remove(widgetIdRef.current); } catch {}
        widgetIdRef.current = null;
      }
      containerRef.current.innerHTML = '';
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey:            TURNSTILE_SITE_KEY,
        theme:              'dark',
        callback:           onVerify,
        'expired-callback': onExpire,
        'error-callback':   onError,
      });
    }

    // If turnstile is already loaded, render immediately
    if (window.turnstile) {
      mountWidget();
      return () => { cancelled = true; };
    }

    // Inject script once
    const SCRIPT_ID = 'cf-turnstile-script';
    if (!document.getElementById(SCRIPT_ID)) {
      // Attach a global callback that Cloudflare will call when ready
      window.cfTurnstileReady = () => {
        document.querySelectorAll('[data-ts-pending]').forEach(el => {
          el.dispatchEvent(new Event('ts-ready'));
        });
      };
      const script    = document.createElement('script');
      script.id       = SCRIPT_ID;
      script.src      = TURNSTILE_SCRIPT_SRC;
      script.async    = true;
      script.defer    = true;
      document.head.appendChild(script);
    }

    // Mark container so the global callback can find it
    if (containerRef.current) containerRef.current.setAttribute('data-ts-pending', '1');

    // Listen for ready event dispatched by global callback
    function onReady() {
      if (!cancelled) mountWidget();
    }
    containerRef.current?.addEventListener('ts-ready', onReady, { once: true });

    // Fallback: poll every 200ms in case script already fired before listener attached
    const poll = setInterval(() => {
      if (window.turnstile) { clearInterval(poll); if (!cancelled) mountWidget(); }
    }, 200);

    return () => {
      cancelled = true;
      clearInterval(poll);
      if (widgetIdRef.current !== null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="flex justify-center min-h-[65px] items-center" />;
}

export default function Faucet() {
  const { evmAddress, connectEVM, refreshBalances, addNotification, removeNotification } = useWallet();
  const [claimStatus,  setClaimStatus]  = useState(null);
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const [txPending,    setTxPending]    = useState(false);

  // Turnstile state
  const [tsToken,      setTsToken]      = useState(null);   // verified token from widget
  const [tsResetKey,   setTsResetKey]   = useState(0);      // increment to reset widget
  const [tsError,      setTsError]      = useState(null);   // error message

  // Oracle prices
  const [prices,        setPrices]       = useState({});
  const [pricesLoading, setPricesLoading]= useState(true);
  const [countdown,     setCountdown]    = useState(PRICE_REFRESH_SEC);
  const [priceFlash,    setPriceFlash]   = useState(false);
  const [lastUpdated,   setLastUpdated]  = useState(null);

  // ── Oracle price refresh ──────────────────────────────────────────────────
  const fetchPricesRef = useRef(null);

  const fetchPrices = useCallback(async (silent = false) => {
    if (!silent) setPricesLoading(true);
    try {
      const results = await Promise.all(
        FAUCET_TOKENS.map(({ symbol }) => getOraclePrice(symbol).catch(() => null))
      );
      const map = {};
      FAUCET_TOKENS.forEach(({ symbol }, i) => { map[symbol] = results[i]; });
      setPrices(map);
      setLastUpdated(new Date());
      setCountdown(PRICE_REFRESH_SEC);
      setPriceFlash(true);
      setTimeout(() => setPriceFlash(false), 1500);
    } finally {
      if (!silent) setPricesLoading(false);
    }
  }, []);

  fetchPricesRef.current = fetchPrices;

  useEffect(() => {
    fetchPricesRef.current(false);
    const interval = setInterval(() => fetchPricesRef.current(true), PRICE_REFRESH_SEC * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, []);

  // ── Cooldown ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (evmAddress) checkCooldown();
  }, [evmAddress]);

  useEffect(() => {
    if (cooldownSecs <= 0) return;
    const timer = setInterval(() => setCooldownSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldownSecs]);

  async function checkCooldown() {
    try {
      const faucet = new ethers.Contract(CONTRACTS.FAUCET, FAUCET_ABI, getProvider());
      const remaining = await faucet.cooldownRemaining(evmAddress);
      setCooldownSecs(Number(remaining));
    } catch {
      setCooldownSecs(0);
    }
  }

  function formatCooldown(secs) {
    if (secs <= 0) return null;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  // ── Turnstile callbacks ───────────────────────────────────────────────────
  function handleTsVerify(token) {
    setTsToken(token);
    setTsError(null);
  }

  function handleTsExpire() {
    setTsToken(null);
    setTsError('Challenge expired — please complete it again.');
  }

  function handleTsError() {
    setTsToken(null);
    setTsError('Challenge failed to load. Check your connection.');
  }

  function resetTurnstile() {
    setTsToken(null);
    setTsError(null);
    setTsResetKey(k => k + 1);
  }

  // ── Claim ─────────────────────────────────────────────────────────────────
  async function handleClaim() {
    if (!evmAddress) { connectEVM(); return; }
    if (cooldownSecs > 0) return;

    if (!tsToken) {
      setTsError('Please complete the human verification challenge first.');
      return;
    }

    setTxPending(true);
    setClaimStatus('pending');
    const pendingId = addNotification('Verifying challenge...', 'pending', 0);

    try {
      // Step 1 — verify Turnstile token server-side
      const verifyRes = await fetch('/api/verify-turnstile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tsToken, walletAddress: evmAddress }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyData.success) {
        throw new Error(verifyData.error || 'Human verification failed. Please try again.');
      }

      // Step 2 — fetch latest prices right before claim
      const freshPrices = await Promise.all(
        FAUCET_TOKENS.map(({ symbol }) => getOraclePrice(symbol).catch(() => null))
      );

      // Step 3 — call faucet contract
      removeNotification(pendingId);
      const pendingId2 = addNotification('Sending transaction...', 'pending', 0);

      const web3Provider = await getWeb3Provider();
      const signer = await web3Provider.getSigner();
      const faucet = new ethers.Contract(CONTRACTS.FAUCET, FAUCET_ABI, signer);
      const tx = await faucet.claim();
      await tx.wait();

      removeNotification(pendingId2);
      setClaimStatus('success');

      const parts = FAUCET_TOKENS.map(({ symbol }, i) => {
        const p = freshPrices[i];
        return `${p ? formatTokenAmount(USD_TARGET / p) : '?'} ${symbol}`;
      }).join(' + ');
      addNotification(`Claimed: ${parts} 🎉`, 'success');

      await refreshBalances();
      await checkCooldown();
      // Reset Turnstile after successful claim (token is single-use)
      resetTurnstile();
      setTimeout(() => setClaimStatus(null), 4000);

    } catch (err) {
      const msg = err.reason || err.message || '';
      setClaimStatus('error');

      if (msg.toLowerCase().includes('verification') || msg.toLowerCase().includes('challenge')) {
        setTsError(msg);
        resetTurnstile();
      } else if (msg.includes('24 jam') || msg.includes('cooldown') || msg.includes('wait')) {
        addNotification('You are on cooldown. Wait 24 hours before claiming again.', 'warning');
        await checkCooldown();
      } else if (msg.includes('lifetime') || msg.includes('cap')) {
        addNotification('Lifetime cap reached for this token.', 'warning');
      } else if (msg.includes('rejected') || msg.includes('denied')) {
        addNotification('Transaction rejected.', 'error');
        resetTurnstile();
      } else {
        addNotification(`Claim failed: ${msg.slice(0, 80)}`, 'error');
        resetTurnstile();
      }
      setTimeout(() => setClaimStatus(null), 3000);
    } finally {
      setTxPending(false);
      // Make sure any lingering pending notification is removed
      removeNotification(pendingId);
    }
  }

  const canClaim     = evmAddress && cooldownSecs === 0 && !txPending && !!tsToken;
  const cooldownLabel = formatCooldown(cooldownSecs);
  const totalUSD     = USD_TARGET * FAUCET_TOKENS.length;
  const updatedLabel  = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {txPending && <LoadingOverlay text="Claiming tokens..." />}

      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="font-display font-bold text-3xl text-white mb-2">Testnet Faucet</h1>
        <p className="text-slate-400 text-base max-w-md mx-auto">
          Claim <span className="text-white font-semibold">${USD_TARGET} worth</span> of each token at live oracle prices. 24-hour cooldown per wallet.
        </p>
      </div>

      {/* Warning */}
      <div className="mb-6 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="1.5" className="flex-shrink-0 mt-0.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <path d="M12 9v4M12 17h.01"/>
        </svg>
        <div>
          <div className="text-amber-400 font-display font-semibold text-sm mb-0.5">Testnet Only</div>
          <div className="text-slate-400 text-xs">These tokens only exist on Republic Testnet (Chain ID: 77701) and have no real-world value.</div>
        </div>
      </div>

      {/* Wallet */}
      {!evmAddress ? (
        <div className="glass-card p-6 mb-6 text-center">
          <p className="text-slate-400 mb-4">Connect your wallet to claim testnet tokens</p>
          <button onClick={connectEVM} className="btn-primary">Connect MetaMask</button>
        </div>
      ) : (
        <div className="mb-6 glass-card p-4 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
          <span className="text-xs text-slate-400 font-display">Connected:</span>
          <span className="font-mono text-xs text-blue-300">{evmAddress}</span>
        </div>
      )}

      {/* Token cards */}
      <div className={`glass-card p-6 mb-6 transition-all duration-300 ${priceFlash ? 'border-blue-400/30' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs text-slate-500 font-display uppercase tracking-wider">
            You will receive (~${totalUSD} total)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchPricesRef.current(false)}
              disabled={pricesLoading}
              title="Refresh prices now"
              className="text-slate-600 hover:text-blue-400 transition-colors disabled:opacity-30"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={pricesLoading ? 'animate-spin' : ''}>
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <span className="text-xs font-mono tabular-nums">
              {pricesLoading
                ? <span className="text-amber-400 animate-pulse">Updating...</span>
                : priceFlash
                  ? <span className="text-green-400">✓ Updated {updatedLabel}</span>
                  : <span className="text-slate-600">Refresh in {countdown}s</span>
              }
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {FAUCET_TOKENS.map(({ symbol }) => {
            const price  = prices[symbol];
            const amount = (price != null && price > 0) ? USD_TARGET / price : null;

            return (
              <div
                key={symbol}
                className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-300 ${
                  priceFlash
                    ? 'bg-blue-900/20 border-blue-500/30'
                    : 'bg-slate-800/40 border-slate-700/30'
                }`}
              >
                <TokenIcon symbol={symbol} size={36} />
                <div className="flex-1 min-w-0">
                  <span className={`font-display font-bold text-base leading-none transition-colors duration-300 ${
                    priceFlash ? 'text-green-300' : 'text-white'
                  }`}>
                    {pricesLoading
                      ? <span className="text-slate-500 text-sm animate-pulse">···</span>
                      : amount !== null ? formatTokenAmount(amount)
                      : <span className="text-slate-500 text-sm">—</span>
                    }
                  </span>
                  <div className="text-slate-400 text-xs mt-0.5">{symbol}</div>
                  <div className={`text-xs mt-0.5 transition-colors duration-300 ${priceFlash ? 'text-blue-400' : 'text-slate-600'}`}>
                    {pricesLoading ? '...'
                      : price != null
                        ? `$${price >= 1
                            ? price.toLocaleString(undefined, { maximumFractionDigits: 2 })
                            : price.toFixed(6)
                          } / ${symbol}`
                        : 'Oracle N/A'
                    }
                  </div>
                </div>
                <div className="text-xs font-display font-semibold text-green-400 bg-green-900/20 border border-green-500/20 px-2 py-1 rounded-lg flex-shrink-0">
                  $100
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-600">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block animate-pulse" />
          Amounts calculated from on-chain oracle prices, refreshed every {PRICE_REFRESH_SEC}s.
        </div>
      </div>

      {/* ── Cloudflare Turnstile ─────────────────────────────────────────── */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          {/* Cloudflare shield icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-orange-400" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2z"/>
          </svg>
          <span className="text-sm font-display font-semibold text-white">Human Verification</span>
          <span className="text-xs text-slate-500 ml-auto">Powered by Cloudflare</span>
        </div>

        {cooldownSecs > 0 ? (
          /* On cooldown — no need to show challenge */
          <div className="flex items-center justify-center py-4 gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span className="text-slate-400 text-sm font-display">
              Cooldown active: <span className="text-white font-bold">{cooldownLabel}</span>
            </span>
          </div>
        ) : !evmAddress ? (
          <p className="text-slate-500 text-sm text-center py-2">Connect your wallet to see the challenge</p>
        ) : (
          <>
            <p className="text-slate-400 text-xs mb-4">
              Complete the challenge below to prove you're human. This prevents bot abuse while still allowing legitimate claims with multiple wallets.
            </p>

            <TurnstileWidget
              onVerify={handleTsVerify}
              onExpire={handleTsExpire}
              onError={handleTsError}
              resetKey={tsResetKey}
            />

            {/* Status row */}
            <div className="mt-3 flex items-center justify-center gap-2 text-sm">
              {tsToken ? (
                <span className="flex items-center gap-1.5 text-green-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Verification passed
                </span>
              ) : tsError ? (
                <span className="flex items-center gap-1.5 text-red-400 text-xs text-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {tsError}
                </span>
              ) : (
                <span className="text-slate-500 text-xs">Complete the challenge above to enable claiming</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Claim button */}
      <div className="glass-card p-6 mb-6">
        <button
          onClick={handleClaim}
          disabled={!canClaim}
          className={`w-full py-4 rounded-2xl font-display font-bold text-lg transition-all duration-200 ${
            claimStatus === 'success'
              ? 'bg-green-500/20 border border-green-500/40 text-green-400'
              : claimStatus === 'error'
                ? 'bg-red-500/20 border border-red-500/40 text-red-400'
                : !evmAddress || cooldownSecs > 0 || !tsToken
                  ? 'opacity-40 cursor-not-allowed bg-slate-700/20 border border-slate-600/20 text-slate-500'
                  : 'btn-primary'
          }`}
        >
          {claimStatus === 'success' ? '✓ Claimed! Tokens are in your wallet'
           : claimStatus === 'error'   ? '✗ Failed, try again'
           : claimStatus === 'pending' ? 'Verifying & Claiming...'
           : !evmAddress               ? 'Connect Wallet'
           : cooldownSecs > 0          ? `Cooldown: ${cooldownLabel}`
           : !tsToken                  ? 'Complete the Challenge Above'
           : `Claim $${totalUSD} Worth of Tokens`}
        </button>

        <p className="text-center text-slate-600 text-xs mt-3">
          ${USD_TARGET} each: USDT · USDC · WBTC · WETH · 24h cooldown · Turnstile protected
        </p>
      </div>

      {/* How to use */}
      <div className="glass-card p-6 mb-4">
        <h3 className="font-display font-semibold text-white mb-4">How to use</h3>
        <div className="space-y-3">
          {[
            ['1', 'Connect MetaMask and switch to Republic Testnet (Chain ID: 77701)'],
            ['2', 'Complete the Cloudflare Turnstile human verification challenge'],
            ['3', `Click "Claim $${totalUSD} Worth of Tokens"`],
            ['4', 'Confirm the transaction in MetaMask'],
            ['5', 'Tokens appear in your wallet within seconds'],
          ].map(([step, text]) => (
            <div key={step} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-900/40 border border-blue-500/30 flex items-center justify-center text-blue-400 font-mono text-xs flex-shrink-0">
                {step}
              </div>
              <span className="text-slate-400 text-sm">{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Contract addresses */}
      <div className="glass-card p-5">
        <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-3">Contract Addresses</div>
        <div className="space-y-2">
          {[
            ['Faucet', CONTRACTS.FAUCET],
            ['USDT',   CONTRACTS.USDT],
            ['USDC',   CONTRACTS.USDC],
            ['WBTC',   CONTRACTS.WBTC],
            ['WETH',   CONTRACTS.WETH],
            ['WRAI',   CONTRACTS.WRAI],
          ].map(([name, addr]) => (
            <div key={name} className="flex justify-between items-center">
              <span className="text-slate-500 text-xs">{name}</span>
              <span className="font-mono text-xs text-blue-300 bg-blue-900/20 px-2 py-0.5 rounded">{addr}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}