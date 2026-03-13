import { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../App.jsx';
import { TokenSelector, TokenIcon } from '../components/TokenSelector.jsx';
import LoadingSpinner, { LoadingOverlay } from '../components/LoadingSpinner.jsx';
import {
  getAmountOut,
  getPriceImpact,
  executeSwap,
  getRouteSymbols,
  getOraclePrice,
  getOraclePriceImpact,
} from '../blockchain/amm.js';
import { formatBalance, getWeb3Provider } from '../blockchain/evm.js';
import { TOKENS, CONTRACTS } from '../blockchain/tokens.js';

const PRICE_REFRESH_SEC = 60;

const WRAI_ABI = [
  'function deposit() external payable',
  'function withdraw(uint256 amount) external',
];

function isWrapPair(from, to) {
  return (from === 'RAI' && to === 'WRAI') || (from === 'WRAI' && to === 'RAI');
}

function impactStyle(pct) {
  if (pct === null || pct === undefined) return { color: 'text-slate-400', label: '—' };
  if (pct > 10) return { color: 'text-red-500',    label: `${pct.toFixed(2)}%` };
  if (pct > 5)  return { color: 'text-red-400',    label: `${pct.toFixed(2)}%` };
  if (pct > 2)  return { color: 'text-amber-400',  label: `${pct.toFixed(2)}%` };
  if (pct > 0.5)return { color: 'text-yellow-300', label: `${pct.toFixed(2)}%` };
  return         { color: 'text-green-400',         label: `${pct.toFixed(2)}%` };
}

export default function Swap() {
  const { evmAddress, balances, connectEVM, refreshBalances, addNotification, removeNotification } = useWallet();
  const [fromToken,  setFromToken]  = useState('RAI');
  const [toToken,    setToToken]    = useState('USDT');
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount,   setToAmount]   = useState('');

  // AMM impact (from pool reserves)
  const [ammImpact, setAmmImpact] = useState(null);
  // Oracle impact — recalculated whenever oraclePrices OR amounts change
  const [oracleImpact, setOracleImpact] = useState(null);

  // Oracle price state + refresh UI
  const [oraclePrices,  setOraclePrices]  = useState({});
  const [oracleLoading, setOracleLoading] = useState(false);
  const [countdown,     setCountdown]     = useState(PRICE_REFRESH_SEC);
  const [priceFlash,    setPriceFlash]    = useState(false);  // triggers highlight animation
  const [lastUpdated,   setLastUpdated]   = useState(null);   // Date object

  const [slippage,       setSlippage]       = useState(0.5);
  const [customSlippage, setCustomSlippage] = useState('');
  const [quoting,  setQuoting]  = useState(false);
  const [swapping, setSwapping] = useState(false);

  const fromBalance = balances[fromToken] || '0';
  const toBalance   = balances[toToken]   || '0';
  const isWrap      = isWrapPair(fromToken, toToken);

  // ── 1. Oracle price fetch (60s interval) ──────────────────────────────────
  const fetchPricesRef = useRef(null);

  const fetchPrices = useCallback(async (silent = false) => {
    if (!silent) setOracleLoading(true);
    try {
      const [fp, tp] = await Promise.all([
        getOraclePrice(fromToken).catch(() => null),
        getOraclePrice(toToken).catch(()   => null),
      ]);
      setOraclePrices({ [fromToken]: fp, [toToken]: tp });
      setLastUpdated(new Date());
      setCountdown(PRICE_REFRESH_SEC);
      // Flash highlight to show prices just updated
      setPriceFlash(true);
      setTimeout(() => setPriceFlash(false), 1200);
    } finally {
      if (!silent) setOracleLoading(false);
    }
  }, [fromToken, toToken]);

  fetchPricesRef.current = fetchPrices;

  useEffect(() => {
    if (isWrap) {
      setOraclePrices({});
      setOracleLoading(false);
      return;
    }
    // Immediate fetch
    fetchPricesRef.current(false);
    // Interval
    const interval = setInterval(() => fetchPricesRef.current(true), PRICE_REFRESH_SEC * 1000);
    return () => clearInterval(interval);
  }, [fromToken, toToken, isWrap]);

  // ── 2. Countdown ticker (every second) ────────────────────────────────────
  useEffect(() => {
    if (isWrap) return;
    const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, [isWrap]);

  // ── 3. AMM quote (debounced, on amount/token change) ──────────────────────
  useEffect(() => {
    if (isWrap) {
      setToAmount(fromAmount);
      setAmmImpact(null);
      return;
    }
    const timer = setTimeout(async () => {
      if (!fromAmount || parseFloat(fromAmount) === 0) {
        setToAmount(''); setAmmImpact(null); setOracleImpact(null);
        return;
      }
      setQuoting(true);
      try {
        const [out, amm] = await Promise.all([
          getAmountOut(fromAmount, fromToken, toToken),
          getPriceImpact(fromAmount, fromToken, toToken),
        ]);
        setToAmount(out);
        setAmmImpact(amm);
      } catch {
        setToAmount(''); setAmmImpact(null);
      }
      setQuoting(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [fromAmount, fromToken, toToken, isWrap]);

  // ── 4. Oracle impact (recalculates whenever oraclePrices OR amounts change) ──
  //    This is the KEY fix — oraclePrices is in deps so it re-runs on every refresh
  useEffect(() => {
    if (isWrap || !fromAmount || !toAmount || parseFloat(toAmount) === 0) {
      setOracleImpact(null);
      return;
    }
    getOraclePriceImpact(fromToken, toToken, fromAmount, toAmount)
      .then(setOracleImpact)
      .catch(() => setOracleImpact(null));
  }, [fromToken, toToken, fromAmount, toAmount, oraclePrices, isWrap]);
  //                                             ^^^^^^^^^^^^ re-runs on every price refresh

  function swapTokens() {
    setFromToken(toToken); setToToken(fromToken);
    setFromAmount(toAmount); setToAmount(fromAmount);
  }

  async function handleSwap() {
    if (!evmAddress) { connectEVM(); return; }
    if (!fromAmount || parseFloat(fromAmount) === 0) {
      addNotification('Please enter an amount', 'warning'); return;
    }
    if (parseFloat(fromAmount) > parseFloat(fromBalance)) {
      addNotification('Insufficient balance', 'error'); return;
    }
    if (oracleImpact !== null && oracleImpact > 10) {
      addNotification(`⚠️ High price impact (${oracleImpact.toFixed(1)}% vs oracle). Proceed with caution.`, 'warning');
    }

    setSwapping(true);
    const pendingId = addNotification('Transaction pending...', 'pending', 0);
    try {
      if (fromToken === 'RAI' && toToken === 'WRAI') {
        const p = await getWeb3Provider();
        const wrai = new ethers.Contract(CONTRACTS.WRAI, WRAI_ABI, await p.getSigner());
        await (await wrai.deposit({ value: ethers.parseEther(fromAmount.toString()) })).wait();
      } else if (fromToken === 'WRAI' && toToken === 'RAI') {
        const p = await getWeb3Provider();
        const wrai = new ethers.Contract(CONTRACTS.WRAI, WRAI_ABI, await p.getSigner());
        await (await wrai.withdraw(ethers.parseEther(fromAmount.toString()))).wait();
      } else {
        if (!toAmount || toAmount === '0') {
          addNotification('No liquidity for this pair', 'error');
          setSwapping(false); return;
        }
        await executeSwap({ fromSymbol: fromToken, toSymbol: toToken, amountIn: fromAmount, amountOutMin: toAmount, slippage, userAddress: evmAddress });
      }
      addNotification(`Swapped ${fromAmount} ${fromToken} → ${parseFloat(toAmount || fromAmount).toFixed(6)} ${toToken}`, 'success');
      setFromAmount(''); setToAmount('');
      await refreshBalances();
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Swap failed: ${msg}`, 'error');
    } finally {
      setSwapping(false); removeNotification(pendingId);
    }
  }

  const effectiveSlippage = customSlippage ? parseFloat(customSlippage) : slippage;
  const routeSymbols = isWrap ? [fromToken, toToken] : getRouteSymbols(fromToken, toToken);
  const isMultihop   = !isWrap && routeSymbols.length > 2;

  const fromUSD = oraclePrices[fromToken];
  const toUSD   = oraclePrices[toToken];
  const oracleFairRate = (fromUSD && toUSD) ? fromUSD / toUSD : null;
  const executionRate  = (fromAmount && toAmount && parseFloat(fromAmount) > 0)
    ? parseFloat(toAmount) / parseFloat(fromAmount) : null;

  const featuredImpact = oracleImpact !== null ? oracleImpact : ammImpact;
  const { color: impactColor, label: impactLabel } = impactStyle(featuredImpact);

  const updatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      {swapping && <LoadingOverlay text="Swapping tokens..." />}

      <div className="mb-6 text-center">
        <h1 className="font-display font-bold text-3xl text-white mb-1">Swap</h1>
        <p className="text-slate-500 text-sm">Exchange tokens at live oracle market price</p>
      </div>

      <div className="glass-card p-6">
        {/* FROM */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500 font-display uppercase tracking-wider">You Pay</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                Balance: <span className="text-slate-300">{formatBalance(fromBalance)}</span>
              </span>
              <button onClick={() => setFromAmount((parseFloat(fromBalance) / 2).toFixed(6))} className="text-xs text-blue-400 hover:text-blue-300 font-display">HALF</button>
              <button onClick={() => setFromAmount(fromBalance)} className="text-xs text-blue-400 hover:text-blue-300 font-display">MAX</button>
            </div>
          </div>
          <div className="input-container p-4 flex items-center gap-3">
            <TokenSelector selected={fromToken} onSelect={setFromToken} exclude={[toToken]} />
            <div className="flex-1">
              <input type="number" value={fromAmount} onChange={e => setFromAmount(e.target.value)} placeholder="0.0" className="input-field text-right" min="0" />
            </div>
          </div>
          {fromUSD && fromAmount && parseFloat(fromAmount) > 0 && (
            <div className={`text-right text-xs mt-1 pr-1 transition-colors duration-300 ${priceFlash ? 'text-blue-400' : 'text-slate-500'}`}>
              ≈ ${(parseFloat(fromAmount) * fromUSD).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          )}
        </div>

        {/* SWAP ARROW */}
        <div className="flex justify-center my-3">
          <button onClick={swapTokens} className="w-10 h-10 rounded-xl bg-blue-900/30 border border-blue-500/20 flex items-center justify-center text-blue-400 hover:bg-blue-900/50 hover:border-blue-500/40 hover:text-blue-300 transition-all duration-200">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
            </svg>
          </button>
        </div>

        {/* TO */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500 font-display uppercase tracking-wider">You Receive</span>
            <span className="text-xs text-slate-500">Balance: <span className="text-slate-300">{formatBalance(toBalance)}</span></span>
          </div>
          <div className="input-container p-4 flex items-center gap-3">
            <TokenSelector selected={toToken} onSelect={setToToken} exclude={[fromToken]} />
            <div className="flex-1 relative">
              {quoting ? (
                <div className="flex justify-end"><LoadingSpinner size={20} /></div>
              ) : (
                <input type="number" value={toAmount ? parseFloat(toAmount).toFixed(6) : ''} readOnly placeholder="0.0" className="input-field text-right text-green-400" />
              )}
            </div>
          </div>
          {toUSD && toAmount && parseFloat(toAmount) > 0 && (
            <div className={`text-right text-xs mt-1 pr-1 transition-colors duration-300 ${priceFlash ? 'text-blue-400' : 'text-slate-500'}`}>
              ≈ ${(parseFloat(toAmount) * toUSD).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          )}
        </div>

        <div className="gradient-divider mb-5" />

        {/* WRAP BADGE */}
        {isWrap && (
          <div className="mb-5 p-3 rounded-xl bg-blue-900/20 border border-blue-500/20 text-center">
            <span className="text-blue-400 text-sm font-display">
              {fromToken === 'RAI' ? 'Wrapping RAI → WRAI (1:1, no fees)' : 'Unwrapping WRAI → RAI (1:1, no fees)'}
            </span>
          </div>
        )}

        {/* ORACLE IDLE PANEL (before user types amount) */}
        {!isWrap && oracleFairRate !== null && !fromAmount && (
          <div className={`mb-5 p-3 rounded-xl border transition-all duration-300 ${
            priceFlash ? 'bg-blue-900/30 border-blue-400/50' : 'bg-blue-950/40 border-blue-800/30'
          }`}>
            <div className="text-xs text-slate-500 mb-1.5 font-display uppercase tracking-wider flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${priceFlash ? 'bg-green-400' : 'bg-blue-400'} inline-block transition-colors duration-300`} />
              Oracle Market Price
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">1 {fromToken}</span>
              <span className={`font-mono transition-colors duration-300 ${priceFlash ? 'text-green-300' : 'text-blue-300'}`}>
                {oracleFairRate.toFixed(6)} {toToken}
              </span>
            </div>
            {fromUSD && toUSD && (
              <div className="flex justify-between text-xs mt-1 text-slate-600">
                <span>${fromUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {fromToken}</span>
                <span>${toUSD.toLocaleString(undefined, { maximumFractionDigits: 4 })} / {toToken}</span>
              </div>
            )}
          </div>
        )}

        {/* SWAP DETAILS */}
        {!isWrap && fromAmount && toAmount && parseFloat(toAmount) > 0 && (
          <div className="space-y-2.5 mb-5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Execution Rate</span>
              <span className="text-white font-mono">
                1 {fromToken} = {executionRate ? executionRate.toFixed(6) : '—'} {toToken}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 flex items-center gap-1">
                Market Rate
                {oracleLoading && <LoadingSpinner size={10} />}
                {!oracleLoading && oracleFairRate === null && <span className="text-xs text-slate-600">(oracle N/A)</span>}
              </span>
              <span className={`font-mono transition-colors duration-300 ${priceFlash ? 'text-green-300' : 'text-blue-300'}`}>
                {oracleFairRate ? `1 ${fromToken} = ${oracleFairRate.toFixed(6)} ${toToken}` : '—'}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-500 flex items-center gap-1">
                Price Impact
                <span className="text-xs text-slate-600">
                  {oracleImpact !== null ? '(vs oracle)' : ammImpact !== null ? '(vs pool)' : ''}
                </span>
              </span>
              <span className={`font-mono font-semibold text-base ${impactColor}`}>
                {quoting ? '...' : impactLabel}
              </span>
            </div>

            {featuredImpact !== null && featuredImpact > 5 && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                featuredImpact > 10
                  ? 'bg-red-900/20 border-red-500/30 text-red-400'
                  : 'bg-amber-900/20 border-amber-500/30 text-amber-400'
              }`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                {featuredImpact > 10
                  ? 'Very high price impact! Consider splitting this trade or adding liquidity first.'
                  : 'Moderate price impact — consider a smaller trade size.'}
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-slate-500">Fee (0.3%)</span>
              <span className="text-white font-mono">{(parseFloat(fromAmount) * 0.003).toFixed(6)} {fromToken}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Min. Received ({effectiveSlippage}% slippage)</span>
              <span className="text-white font-mono">
                {(parseFloat(toAmount) * (1 - effectiveSlippage / 100)).toFixed(6)} {toToken}
              </span>
            </div>
          </div>
        )}

        {/* SLIPPAGE */}
        {!isWrap && (
          <div className="mb-5">
            <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-2">Slippage Tolerance</div>
            <div className="flex items-center gap-2">
              {[0.1, 0.5, 1.0].map(s => (
                <button key={s} onClick={() => { setSlippage(s); setCustomSlippage(''); }}
                  className={`tab-btn ${slippage === s && !customSlippage ? 'active' : ''} px-3 py-1.5 text-xs`}>
                  {s}%
                </button>
              ))}
              <div className="flex-1 input-container flex items-center px-3 py-1.5">
                <input type="number" value={customSlippage}
                  onChange={e => { setCustomSlippage(e.target.value); setSlippage(parseFloat(e.target.value) || 0.5); }}
                  placeholder="Custom" className="w-full bg-transparent text-white text-xs font-mono outline-none" />
                <span className="text-slate-500 text-xs ml-1">%</span>
              </div>
            </div>
          </div>
        )}

        {/* SWAP BUTTON */}
        <button
          onClick={handleSwap}
          disabled={swapping || (evmAddress && (!fromAmount || parseFloat(fromAmount) === 0))}
          className={`btn-primary w-full py-4 text-base ${featuredImpact !== null && featuredImpact > 10 ? 'border border-red-500/50' : ''}`}
        >
          {!evmAddress                                          ? 'Connect Wallet to Swap'
           : !fromAmount                                        ? 'Enter an Amount'
           : parseFloat(fromAmount) > parseFloat(fromBalance)  ? 'Insufficient Balance'
           : quoting                                            ? 'Getting Quote...'
           : isWrap && fromToken === 'RAI'                      ? `Wrap ${fromToken} → ${toToken}`
           : isWrap && fromToken === 'WRAI'                     ? `Unwrap ${fromToken} → ${toToken}`
           : `Swap ${fromToken} → ${toToken}`}
        </button>
      </div>

      {/* ROUTE */}
      <div className="mt-4 glass-card p-4">
        <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-2">Route</div>
        <div className="flex items-center gap-2 flex-wrap">
          {routeSymbols.map((sym, i, arr) => (
            <div key={i} className="flex items-center gap-2">
              <span className="font-display text-sm text-slate-300">{sym}</span>
              {i < arr.length - 1 && (
                <>
                  <div className="border-t border-dashed border-blue-900/40 w-6" />
                  <div className={`text-xs px-2 rounded-full border ${isWrap ? 'badge-green border-green-500/30 text-green-400' : 'badge-blue'}`}>
                    {isWrap ? 'Wrap' : 'AMM'}
                  </div>
                  <div className="border-t border-dashed border-blue-900/40 w-6" />
                </>
              )}
            </div>
          ))}
        </div>
        {isMultihop && <p className="text-xs text-slate-600 mt-2">Routed via WRAI — no direct pool available</p>}
      </div>

      {/* ORACLE PRICE PANEL with countdown */}
      {!isWrap && (fromUSD || toUSD) && (
        <div className={`mt-4 glass-card p-4 transition-all duration-300 ${priceFlash ? 'border-blue-400/40' : ''}`}>
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-slate-500 font-display uppercase tracking-wider flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full inline-block transition-colors duration-300 ${
                oracleLoading ? 'bg-amber-400 animate-pulse' : priceFlash ? 'bg-green-400' : 'bg-blue-400 animate-pulse'
              }`} />
              Oracle Prices (USD)
            </div>
            <div className="flex items-center gap-2">
              {/* Manual refresh button */}
              <button
                onClick={() => fetchPricesRef.current(false)}
                disabled={oracleLoading}
                title="Refresh prices now"
                className="text-slate-600 hover:text-blue-400 transition-colors disabled:opacity-30"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className={oracleLoading ? 'animate-spin' : ''}>
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
              {/* Countdown */}
              <span className="text-xs text-slate-600 font-mono tabular-nums">
                {oracleLoading
                  ? 'Updating...'
                  : priceFlash
                    ? <span className="text-green-400 text-xs">✓ Updated {updatedLabel}</span>
                    : `Refresh in ${countdown}s`
                }
              </span>
            </div>
          </div>

          {/* Price rows */}
          <div className="grid grid-cols-2 gap-3">
            {[fromToken, toToken].map(sym => {
              const usd = sym === fromToken ? fromUSD : toUSD;
              return (
                <div key={sym} className="flex items-center gap-2">
                  <TokenIcon symbol={sym} size={20} />
                  <div>
                    <div className="text-xs text-slate-500">{sym}</div>
                    <div className={`text-sm font-mono transition-colors duration-300 ${priceFlash ? 'text-green-300' : 'text-white'}`}>
                      {usd != null
                        ? `$${usd.toLocaleString(undefined, { maximumFractionDigits: usd < 1 ? 6 : 2 })}`
                        : <span className="text-slate-600 text-xs">N/A</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
