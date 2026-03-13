import { useState, useEffect } from 'react';
import { useWallet } from '../App.jsx';
import { TokenIcon } from '../components/TokenSelector.jsx';
import { LoadingOverlay } from '../components/LoadingSpinner.jsx';
import { getPoolReserves, getUserLPBalance, addLiquidity, removeLiquidity, getAllOraclePrices } from '../blockchain/amm.js';
import { formatBalance } from '../blockchain/evm.js';
import { POOL_PAIRS, TOKENS, CONTRACTS } from '../blockchain/tokens.js';
import { ethers } from 'ethers';
import { getProvider } from '../blockchain/evm.js';

// Fetch token prices from on-chain oracle
async function fetchTokenPrices() {
  try {
    const oraclePrices = await getAllOraclePrices();
    // Build price map; fall back to known stablecoin prices if oracle returns null
    return {
      WBTC: oraclePrices.WBTC  ?? 0,
      WETH: oraclePrices.WETH  ?? 0,
      USDT: oraclePrices.USDT  ?? 1,
      USDC: oraclePrices.USDC  ?? 1,
      WRAI: oraclePrices.WRAI  ?? 0,
      RAI:  oraclePrices.RAI   ?? 0,
    };
  } catch {
    return { WBTC: 0, WETH: 0, USDT: 1, USDC: 1, WRAI: 0, RAI: 0 };
  }
}

function calcTVL(pool, token0Symbol, token1Symbol, prices) {
  const r0 = parseFloat(pool.reserve0) || 0;
  const r1 = parseFloat(pool.reserve1) || 0;
  const p0 = prices[token0Symbol] || 0;
  const p1 = prices[token1Symbol] || 0;
  // If one side has price, mirror it for the other
  if (p0 > 0 && p1 === 0) return r0 * p0 * 2;
  if (p1 > 0 && p0 === 0) return r1 * p1 * 2;
  return r0 * p0 + r1 * p1;
}

function formatUSD(val) {
  if (!val || val === 0) return '—';
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(2)}K`;
  return `$${val.toFixed(2)}`;
}

const PAIR_ABI_MIN = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

const FACTORY_ABI_MIN = [
  'function getPair(address,address) view returns (address)',
];

// Ambil LP balance langsung dari factory + pair contract, bypass buildPath
async function getLPBalanceDirect(token0Addr, token1Addr, userAddress) {
  try {
    const provider = getProvider();
    const factory = new ethers.Contract(CONTRACTS.FACTORY, FACTORY_ABI_MIN, provider);
    const pairAddr = await factory.getPair(token0Addr, token1Addr);
    if (!pairAddr || pairAddr === ethers.ZeroAddress) return { balance: '0', pairAddr: null };
    const pair = new ethers.Contract(pairAddr, PAIR_ABI_MIN, provider);
    const balance = await pair.balanceOf(userAddress);
    return { balance: ethers.formatEther(balance), pairAddr };
  } catch {
    return { balance: '0', pairAddr: null };
  }
}

const TABS = ['Add Liquidity', 'Remove Liquidity', 'My Positions'];

export default function Liquidity() {
  const { evmAddress, balances, connectEVM, refreshBalances, addNotification, removeNotification } = useWallet();
  const [activeTab, setActiveTab] = useState('Add Liquidity');
  const [selectedPair, setSelectedPair] = useState(POOL_PAIRS[0]);
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [lpRemoveAmount, setLpRemoveAmount] = useState('');
  const [poolData, setPoolData] = useState({});
  const [userLP, setUserLP] = useState({});
  const [loading, setLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [tokenPrices, setTokenPrices] = useState({ WBTC: 0, WETH: 0, USDT: 1, USDC: 1, WRAI: 0, RAI: 0 });

  useEffect(() => {
    fetchAllPoolData();
    fetchTokenPrices().then(setTokenPrices);

    // Auto-refresh oracle prices every 60s
    const priceInterval = setInterval(() => {
      fetchTokenPrices().then(setTokenPrices);
    }, 60_000);
    return () => clearInterval(priceInterval);
  }, [evmAddress]);

  async function fetchAllPoolData() {
    setLoading(true);
    const pd = {};
    const ul = {};
    for (const pair of POOL_PAIRS) {
      const key = `${pair.token0}-${pair.token1}`;
      const t0addr = TOKENS[pair.token0].address;
      const t1addr = TOKENS[pair.token1].address;

      try {
        pd[key] = await getPoolReserves(pair.token0, pair.token1);
      } catch {
        pd[key] = { reserve0: '0', reserve1: '0', totalSupply: '0', pairAddress: null };
      }

      if (evmAddress) {
        try {
          // Pakai direct fetch, bukan lewat buildPath
          const { balance, pairAddr } = await getLPBalanceDirect(t0addr, t1addr, evmAddress);
          ul[key] = balance;
          if (pairAddr && pd[key]) pd[key].pairAddress = pairAddr;
        } catch {
          ul[key] = '0';
        }
      }
    }
    setPoolData(pd);
    setUserLP(ul);
    setLoading(false);
  }

  const pairKey = `${selectedPair.token0}-${selectedPair.token1}`;
  const currentPool = poolData[pairKey] || { reserve0: '0', reserve1: '0', totalSupply: '0' };
  const currentLP = userLP[pairKey] || '0';

  function handleAmount0Change(val) {
    setAmount0(val);
    if (val && parseFloat(currentPool.reserve0) > 0) {
      const ratio = parseFloat(currentPool.reserve1) / parseFloat(currentPool.reserve0);
      setAmount1((parseFloat(val) * ratio).toFixed(8));
    }
  }

  function handleAmount1Change(val) {
    setAmount1(val);
    if (val && parseFloat(currentPool.reserve1) > 0) {
      const ratio = parseFloat(currentPool.reserve0) / parseFloat(currentPool.reserve1);
      setAmount0((parseFloat(val) * ratio).toFixed(8));
    }
  }

  // Set amount berdasarkan % dari balance
  function setAmountByPct(pct, token, setter, otherSetter, isToken0) {
    const bal = parseFloat(balances[token] || '0');
    const val = (bal * pct / 100).toFixed(8);
    setter(val);
    // Auto-calculate pasangan
    if (isToken0 && parseFloat(currentPool.reserve0) > 0) {
      const ratio = parseFloat(currentPool.reserve1) / parseFloat(currentPool.reserve0);
      otherSetter((parseFloat(val) * ratio).toFixed(8));
    } else if (!isToken0 && parseFloat(currentPool.reserve1) > 0) {
      const ratio = parseFloat(currentPool.reserve0) / parseFloat(currentPool.reserve1);
      otherSetter((parseFloat(val) * ratio).toFixed(8));
    }
  }

  async function handleAddLiquidity() {
    if (!evmAddress) { connectEVM(); return; }
    if (!amount0 || !amount1) { addNotification('Enter both amounts', 'warning'); return; }
    const bal0 = balances[selectedPair.token0] || '0';
    const bal1 = balances[selectedPair.token1] || '0';
    if (parseFloat(amount0) > parseFloat(bal0)) { addNotification(`Insufficient ${selectedPair.token0}`, 'error'); return; }
    if (parseFloat(amount1) > parseFloat(bal1)) { addNotification(`Insufficient ${selectedPair.token1}`, 'error'); return; }

    setTxPending(true);
    const pendingId = addNotification('Adding liquidity...', 'pending', 0);
    try {
      await addLiquidity({
        token0Symbol: selectedPair.token0,
        token1Symbol: selectedPair.token1,
        amount0, amount1,
        userAddress: evmAddress,
      });
      addNotification(`Added ${parseFloat(amount0).toFixed(6)} ${selectedPair.token0} + ${parseFloat(amount1).toFixed(6)} ${selectedPair.token1} to pool`, 'success');
      setAmount0(''); setAmount1('');
      await Promise.all([fetchAllPoolData(), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Failed: ${msg}`, 'error');
    } finally {
      setTxPending(false);
      removeNotification(pendingId);
    }
  }

  async function handleRemoveLiquidity() {
    if (!evmAddress) { connectEVM(); return; }
    if (!lpRemoveAmount || parseFloat(lpRemoveAmount) === 0) { addNotification('Enter LP amount', 'warning'); return; }
    if (parseFloat(lpRemoveAmount) > parseFloat(currentLP)) { addNotification('Insufficient LP tokens', 'error'); return; }

    setTxPending(true);
    const pendingId = addNotification('Removing liquidity...', 'pending', 0);
    try {
      await removeLiquidity({
        token0Symbol: selectedPair.token0,
        token1Symbol: selectedPair.token1,
        lpAmount: lpRemoveAmount,
        userAddress: evmAddress,
      });
      addNotification('Liquidity removed successfully!', 'success');
      setLpRemoveAmount('');
      await Promise.all([fetchAllPoolData(), refreshBalances()]);
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      addNotification(msg.includes('rejected') ? 'Transaction rejected.' : `Failed: ${msg}`, 'error');
    } finally {
      setTxPending(false);
      removeNotification(pendingId);
    }
  }

  const totalSupply = parseFloat(currentPool.totalSupply) || 1;
  const lpShare = parseFloat(currentLP) / totalSupply * 100;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {txPending && <LoadingOverlay text="Processing transaction..." />}

      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-white mb-1">Liquidity</h1>
        <p className="text-slate-500 text-sm">Provide liquidity and earn 0.3% from every swap</p>
      </div>

      {/* Pool overview */}
      <div className="grid sm:grid-cols-4 gap-4 mb-8">
        {POOL_PAIRS.map(pair => {
          const key = `${pair.token0}-${pair.token1}`;
          const pool = poolData[key] || {};
          const userLPBal = userLP[key] || '0';
          return (
            <button
              key={key}
              onClick={() => setSelectedPair(pair)}
              className={`glass-card p-4 text-left transition-all duration-200 ${selectedPair === pair ? 'border-blue-500/50 shadow-glow-sm' : ''}`}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="flex -space-x-2">
                  <TokenIcon symbol={pair.token0} size={24} />
                  <TokenIcon symbol={pair.token1} size={24} />
                </div>
                <span className="font-display font-semibold text-white text-sm">{pair.token0}/{pair.token1}</span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">{pair.token0}</span>
                  <span className="text-slate-300 font-mono">{loading ? '...' : formatBalance(pool.reserve0)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">{pair.token1}</span>
                  <span className="text-slate-300 font-mono">{loading ? '...' : formatBalance(pool.reserve1)}</span>
                </div>
                {parseFloat(userLPBal) > 0 && (
                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-blue-900/30">
                    <span className="text-green-500">My LP</span>
                    <span className="text-green-400 font-mono">{formatBalance(userLPBal)}</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          {/* Tabs */}
          <div className="flex gap-1 mb-6 p-1 bg-black/20 rounded-xl">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 tab-btn text-xs py-2 ${activeTab === tab ? 'active' : ''}`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ADD LIQUIDITY */}
          {activeTab === 'Add Liquidity' && (
            <div>
              {/* Token 0 */}
              <div className="mb-3">
                <div className="flex justify-between mb-1.5 text-xs text-slate-500">
                  <span>{selectedPair.token0} Amount</span>
                  <span>Balance: {formatBalance(balances[selectedPair.token0])}</span>
                </div>
                <div className="input-container p-3 flex items-center gap-3">
                  <TokenIcon symbol={selectedPair.token0} size={24} />
                  <span className="font-display font-semibold text-white text-sm">{selectedPair.token0}</span>
                  <input
                    type="number"
                    value={amount0}
                    onChange={e => handleAmount0Change(e.target.value)}
                    placeholder="0.0"
                    className="input-field text-right text-base"
                  />
                </div>
                {/* % buttons token0 */}
                <div className="flex gap-1.5 mt-1.5">
                  {[25, 50, 75, 100].map(pct => (
                    <button
                      key={pct}
                      onClick={() => setAmountByPct(pct, selectedPair.token0, setAmount0, setAmount1, true)}
                      className="flex-1 text-xs py-1 rounded-lg bg-blue-900/20 border border-blue-900/30 text-slate-400 hover:text-blue-300 hover:border-blue-500/30 transition-colors font-display"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-center mb-3">
                <span className="text-blue-500 text-lg">+</span>
              </div>

              {/* Token 1 */}
              <div className="mb-5">
                <div className="flex justify-between mb-1.5 text-xs text-slate-500">
                  <span>{selectedPair.token1} Amount</span>
                  <span>Balance: {formatBalance(balances[selectedPair.token1])}</span>
                </div>
                <div className="input-container p-3 flex items-center gap-3">
                  <TokenIcon symbol={selectedPair.token1} size={24} />
                  <span className="font-display font-semibold text-white text-sm">{selectedPair.token1}</span>
                  <input
                    type="number"
                    value={amount1}
                    onChange={e => handleAmount1Change(e.target.value)}
                    placeholder="0.0"
                    className="input-field text-right text-base"
                  />
                </div>
                {/* % buttons token1 */}
                <div className="flex gap-1.5 mt-1.5">
                  {[25, 50, 75, 100].map(pct => (
                    <button
                      key={pct}
                      onClick={() => setAmountByPct(pct, selectedPair.token1, setAmount1, setAmount0, false)}
                      className="flex-1 text-xs py-1 rounded-lg bg-blue-900/20 border border-blue-900/30 text-slate-400 hover:text-blue-300 hover:border-blue-500/30 transition-colors font-display"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={handleAddLiquidity} disabled={txPending} className="btn-primary w-full py-3.5">
                {!evmAddress ? 'Connect Wallet' : 'Add Liquidity'}
              </button>
            </div>
          )}

          {/* REMOVE LIQUIDITY */}
          {activeTab === 'Remove Liquidity' && (
            <div>
              {/* LP balance info */}
              <div className="mb-4 p-3 rounded-xl bg-black/20 border border-blue-900/30">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-500">Your LP Balance</span>
                  <span className="text-white font-mono">{formatBalance(currentLP)} LP</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Pool Share</span>
                  <span className="text-white font-mono">{lpShare.toFixed(4)}%</span>
                </div>
              </div>

              <div className="mb-3">
                <div className="flex justify-between mb-1.5 text-xs text-slate-500">
                  <span>LP Tokens to Remove</span>
                  <button onClick={() => setLpRemoveAmount(currentLP)} className="text-blue-400 hover:text-blue-300">
                    MAX
                  </button>
                </div>
                <div className="input-container p-3 flex items-center gap-3">
                  <div className="flex -space-x-1.5">
                    <TokenIcon symbol={selectedPair.token0} size={20} />
                    <TokenIcon symbol={selectedPair.token1} size={20} />
                  </div>
                  <span className="text-sm text-slate-400 font-display">LP</span>
                  <input
                    type="number"
                    value={lpRemoveAmount}
                    onChange={e => setLpRemoveAmount(e.target.value)}
                    placeholder="0.0"
                    className="input-field text-right"
                  />
                </div>
              </div>

              <div className="flex gap-2 mb-5">
                {[25, 50, 75, 100].map(pct => (
                  <button
                    key={pct}
                    onClick={() => setLpRemoveAmount((parseFloat(currentLP) * pct / 100).toFixed(8))}
                    className="flex-1 tab-btn text-xs py-1.5"
                  >
                    {pct}%
                  </button>
                ))}
              </div>

              {/* Estimated receive */}
              {lpRemoveAmount && parseFloat(lpRemoveAmount) > 0 && parseFloat(currentPool.totalSupply) > 0 && (
                <div className="mb-4 p-3 rounded-xl bg-black/20 border border-blue-900/30 space-y-1.5 text-xs">
                  <div className="text-slate-500 mb-1">You will receive approximately:</div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{selectedPair.token0}</span>
                    <span className="text-white font-mono">
                      {(parseFloat(currentPool.reserve0) * parseFloat(lpRemoveAmount) / parseFloat(currentPool.totalSupply)).toFixed(6)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{selectedPair.token1}</span>
                    <span className="text-white font-mono">
                      {(parseFloat(currentPool.reserve1) * parseFloat(lpRemoveAmount) / parseFloat(currentPool.totalSupply)).toFixed(6)}
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={handleRemoveLiquidity}
                disabled={txPending || parseFloat(currentLP) === 0}
                className="btn-danger w-full py-3.5"
              >
                {!evmAddress ? 'Connect Wallet' : parseFloat(currentLP) === 0 ? 'No LP Tokens' : 'Remove Liquidity'}
              </button>
            </div>
          )}

          {/* MY POSITIONS */}
          {activeTab === 'My Positions' && (
            <div>
              {!evmAddress ? (
                <div className="text-center py-6">
                  <button onClick={connectEVM} className="btn-secondary text-sm">Connect Wallet to View Positions</button>
                </div>
              ) : (
                POOL_PAIRS.map(pair => {
                  const key = `${pair.token0}-${pair.token1}`;
                  const lp = userLP[key] || '0';
                  const pool = poolData[key] || {};
                  const ts = parseFloat(pool.totalSupply) || 1;
                  const share = parseFloat(lp) / ts * 100;
                  const myToken0 = parseFloat(pool.reserve0) * (parseFloat(lp) / ts);
                  const myToken1 = parseFloat(pool.reserve1) * (parseFloat(lp) / ts);
                  const hasLP = parseFloat(lp) > 0;

                  return (
                    <div key={key} className={`mb-3 p-4 rounded-xl border ${hasLP ? 'bg-green-900/10 border-green-500/20' : 'bg-black/20 border-blue-900/30'}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="flex -space-x-2">
                          <TokenIcon symbol={pair.token0} size={22} />
                          <TokenIcon symbol={pair.token1} size={22} />
                        </div>
                        <span className="font-display font-semibold text-white text-sm">{pair.token0}/{pair.token1}</span>
                        {hasLP && <span className="ml-auto text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full">Active</span>}
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">LP Tokens</span>
                          <span className={`font-mono ${hasLP ? 'text-green-400' : 'text-slate-400'}`}>{formatBalance(lp)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Pool Share</span>
                          <span className="font-mono text-white">{share.toFixed(4)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Pooled {pair.token0}</span>
                          <span className="font-mono text-white">{myToken0.toFixed(6)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Pooled {pair.token1}</span>
                          <span className="font-mono text-white">{myToken1.toFixed(6)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Pool stats */}
        <div className="space-y-4">
          {/* TVL Banner */}
          {(() => {
            const tvl = calcTVL(currentPool, selectedPair.token0, selectedPair.token1, tokenPrices);
            return tvl > 0 ? (
              <div className="glass-card p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">Total Value Locked</div>
                  <div className="text-2xl font-display font-bold text-white">{loading ? '...' : formatUSD(tvl)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500 mb-0.5">Est. APR (from fees)</div>
                  <div className="text-lg font-display font-semibold text-green-400">~variable</div>
                  <div className="text-xs text-slate-500">0.3% per swap</div>
                </div>
              </div>
            ) : null;
          })()}

          <div className="glass-card p-6">
            <h3 className="font-display font-semibold text-white mb-4 flex items-center gap-2">
              <div className="flex -space-x-2">
                <TokenIcon symbol={selectedPair.token0} size={22} />
                <TokenIcon symbol={selectedPair.token1} size={22} />
              </div>
              Pool Statistics
            </h3>
            <div className="space-y-3">
              {/* Reserve Token0 */}
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{selectedPair.token0} Reserve</span>
                <div className="text-right">
                  <div className="text-white font-mono">{loading ? '...' : formatBalance(currentPool.reserve0)}</div>
                  {tokenPrices[selectedPair.token0] > 0 && !loading && (
                    <div className="text-xs text-slate-500">{formatUSD(parseFloat(currentPool.reserve0) * tokenPrices[selectedPair.token0])}</div>
                  )}
                </div>
              </div>
              {/* Reserve Token1 */}
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{selectedPair.token1} Reserve</span>
                <div className="text-right">
                  <div className="text-white font-mono">{loading ? '...' : formatBalance(currentPool.reserve1)}</div>
                  {tokenPrices[selectedPair.token1] > 0 && !loading && (
                    <div className="text-xs text-slate-500">{formatUSD(parseFloat(currentPool.reserve1) * tokenPrices[selectedPair.token1])}</div>
                  )}
                </div>
              </div>
              <div className="border-t border-blue-900/20 pt-3 space-y-3">
                {[
                  ['Total LP Supply', formatBalance(currentPool.totalSupply) + ' LP'],
                  ['Your LP Balance', formatBalance(currentLP) + ' LP'],
                  ['Your Pool Share', lpShare.toFixed(4) + '%'],
                  ['Swap Fee', '0.3% → 100% to LPs'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-white font-mono text-right">{loading ? '...' : v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {parseFloat(currentPool.reserve0) > 0 && (() => {
            const poolRate = parseFloat(currentPool.reserve1) / parseFloat(currentPool.reserve0);
            const p0 = tokenPrices[selectedPair.token0];
            const p1 = tokenPrices[selectedPair.token1];
            const oracleRate = (p0 && p1) ? p0 / p1 : null;
            const deviation  = oracleRate ? ((poolRate - oracleRate) / oracleRate * 100) : null;
            const devColor   = deviation === null ? '' : Math.abs(deviation) > 5 ? 'text-red-400' : Math.abs(deviation) > 2 ? 'text-amber-400' : 'text-green-400';
            return (
              <div className="glass-card p-5">
                <h4 className="text-xs text-slate-500 font-display uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block animate-pulse"></span>
                  Pool vs Oracle Price
                </h4>
                {/* Pool rate */}
                <div className="flex items-center gap-2 text-sm mb-2">
                  <TokenIcon symbol={selectedPair.token0} size={20} />
                  <div className="flex-1">
                    <div className="text-xs text-slate-500 mb-0.5">Pool Price</div>
                    <span className="text-white font-mono">
                      1 {selectedPair.token0} = {poolRate.toFixed(6)} {selectedPair.token1}
                    </span>
                  </div>
                  {p0 > 0 && <span className="text-xs text-slate-500">{formatUSD(p0)}</span>}
                </div>
                {/* Oracle rate */}
                {oracleRate !== null && (
                  <div className="flex items-center gap-2 text-sm mb-3">
                    <TokenIcon symbol={selectedPair.token0} size={20} />
                    <div className="flex-1">
                      <div className="text-xs text-slate-500 mb-0.5">Oracle Market Price</div>
                      <span className="text-blue-300 font-mono">
                        1 {selectedPair.token0} = {oracleRate.toFixed(6)} {selectedPair.token1}
                      </span>
                    </div>
                  </div>
                )}
                {/* Deviation badge */}
                {deviation !== null && (
                  <div className={`text-xs px-2 py-1 rounded-lg border inline-flex items-center gap-1.5 ${
                    Math.abs(deviation) > 5
                      ? 'bg-red-900/20 border-red-500/20 text-red-400'
                      : Math.abs(deviation) > 2
                        ? 'bg-amber-900/20 border-amber-500/20 text-amber-400'
                        : 'bg-green-900/20 border-green-500/20 text-green-400'
                  }`}>
                    Pool is {deviation > 0 ? '+' : ''}{deviation.toFixed(2)}% {deviation > 0 ? 'above' : 'below'} oracle price
                    {Math.abs(deviation) > 5 && ' — arbitrage opportunity'}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}