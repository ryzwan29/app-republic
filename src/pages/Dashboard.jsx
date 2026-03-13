import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../App.jsx';
import { TokenIcon } from '../components/TokenSelector.jsx';
import { Skeleton } from '../components/LoadingSpinner.jsx';
import { getLatestBlock, getStakingPool, getDelegations, getRewards } from '../blockchain/cosmos.js';
import { getUserLPBalance } from '../blockchain/amm.js';
import { getTotalUserStaked } from '../blockchain/staking.js';
import { formatBalance } from '../blockchain/evm.js';
import { POOL_PAIRS } from '../blockchain/tokens.js';

export default function Dashboard() {
  const { evmAddress, cosmosAddress, balances, loadingBalances, connectEVM, connectCosmos, refreshBalances } = useWallet();
  const [chainInfo, setChainInfo] = useState({ height: '—', time: '' });
  const [stakingPool, setStakingPool] = useState({ bondedTokens: '0' });
  const [lpPositions, setLpPositions] = useState([]);
  const [totalStaked, setTotalStaked] = useState('0');
  const [delegations, setDelegations] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [loadingExtra, setLoadingExtra] = useState(false);

  useEffect(() => {
    fetchChainData();
  }, []);

  useEffect(() => {
    if (evmAddress) {
      fetchUserData();
    }
  }, [evmAddress, cosmosAddress]);

  async function fetchChainData() {
    try {
      const [block, pool] = await Promise.all([getLatestBlock(), getStakingPool()]);
      setChainInfo(block);
      setStakingPool(pool);
    } catch {}
  }

  async function fetchUserData() {
    setLoadingExtra(true);
    try {
      // LP positions
      const positions = [];
      for (const pair of POOL_PAIRS) {
        try {
          const bal = await getUserLPBalance(pair.token0, pair.token1, evmAddress);
          if (parseFloat(bal) > 0) {
            positions.push({ ...pair, lpBalance: bal });
          }
        } catch {}
      }
      setLpPositions(positions);

      // Total EVM staked
      const staked = await getTotalUserStaked(evmAddress);
      setTotalStaked(staked);

      // Cosmos delegations
      if (cosmosAddress) {
        const [dels, rwds] = await Promise.all([
          getDelegations(cosmosAddress),
          getRewards(cosmosAddress),
        ]);
        setDelegations(dels);
        setRewards(rwds);
      }
    } catch {}
    setLoadingExtra(false);
  }

  const totalRewards = rewards.reduce((acc, r) => {
    const raiReward = r.reward?.find(c => c.denom === 'arai');
    return acc + (raiReward ? parseFloat(raiReward.amount) / 1e18 : 0);
  }, 0);

  if (!evmAddress && !cosmosAddress) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="glass-card p-12">
          <div className="w-16 h-16 rounded-2xl bg-blue-900/30 border border-blue-500/20 flex items-center justify-center mx-auto mb-6">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5">
              <rect x="2" y="5" width="20" height="14" rx="2"/>
              <path d="M16 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>
              <path d="M22 10H16"/>
            </svg>
          </div>
          <h2 className="font-display font-bold text-2xl text-white mb-3">Connect Your Wallet</h2>
          <p className="text-slate-400 mb-8">Connect MetaMask or Keplr to view your dashboard</p>
          <div className="flex gap-3 justify-center">
            <button onClick={connectEVM} className="btn-primary">Connect MetaMask</button>
            <button onClick={connectCosmos} className="btn-secondary">Connect Keplr</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display font-bold text-3xl text-white">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Republic Testnet · Block {parseInt(chainInfo.height || 0).toLocaleString()}</p>
        </div>
        <button
          onClick={() => { refreshBalances(); fetchUserData(); fetchChainData(); }}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Addresses */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        {evmAddress && (
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="MM" className="w-5 h-5" />
              <span className="text-xs text-slate-500 font-display uppercase tracking-wider">EVM Address</span>
              <span className="badge-green ml-auto">Connected</span>
            </div>
            <p className="font-mono text-sm text-blue-300 break-all">{evmAddress}</p>
          </div>
        )}
        {cosmosAddress && (
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white">K</div>
              <span className="text-xs text-slate-500 font-display uppercase tracking-wider">Cosmos Address</span>
              <span className="badge-blue ml-auto">Connected</span>
            </div>
            <p className="font-mono text-sm text-blue-300 break-all">{cosmosAddress}</p>
          </div>
        )}
      </div>

      {/* Token Balances */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-semibold text-white text-lg">Token Balances</h2>
          <span className="badge-blue text-xs">EVM</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Object.entries(balances).map(([sym, bal]) => (
            <div key={sym} className="flex flex-col items-center p-4 rounded-xl bg-black/20 border border-blue-900/30 hover:border-blue-500/30 transition-colors">
              <TokenIcon symbol={sym} size={36} />
              <div className="font-mono text-lg font-semibold text-white mt-2">
                {loadingBalances ? <Skeleton className="w-16 h-5" /> : formatBalance(bal)}
              </div>
              <div className="text-slate-500 text-xs font-display mt-0.5">{sym}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <div className="stat-card">
          <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-1">Total Staked (EVM)</div>
          <div className="font-display font-bold text-2xl text-white">
            {loadingExtra ? <Skeleton className="w-24 h-7" /> : `${formatBalance(totalStaked)} RAI`}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-1">Pending Rewards</div>
          <div className="font-display font-bold text-2xl text-green-400">
            {loadingExtra ? <Skeleton className="w-24 h-7" /> : `${totalRewards.toFixed(4)} RAI`}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-1">LP Positions</div>
          <div className="font-display font-bold text-2xl text-white">
            {loadingExtra ? <Skeleton className="w-12 h-7" /> : lpPositions.length}
          </div>
        </div>
      </div>

      {/* LP Positions */}
      {lpPositions.length > 0 && (
        <div className="glass-card p-6 mb-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-semibold text-white text-lg">LP Positions</h2>
            <Link to="/liquidity" className="text-blue-400 text-sm hover:text-blue-300 transition-colors font-display">Manage →</Link>
          </div>
          <div className="space-y-3">
            {lpPositions.map(pos => (
              <div key={`${pos.token0}-${pos.token1}`} className="flex items-center justify-between p-4 rounded-xl bg-black/20 border border-blue-900/30">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    <TokenIcon symbol={pos.token0} size={28} />
                    <TokenIcon symbol={pos.token1} size={28} />
                  </div>
                  <div>
                    <div className="font-display font-semibold text-white text-sm">{pos.token0}/{pos.token1}</div>
                    <div className="text-slate-500 text-xs">{pos.fee} fee</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm text-white">{formatBalance(pos.lpBalance)}</div>
                  <div className="text-slate-500 text-xs">LP tokens</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: 'Swap Tokens', href: '/swap', desc: 'Trade tokens instantly' },
          { label: 'Add Liquidity', href: '/liquidity', desc: 'Earn from trading fees' },
          { label: 'Stake RAI', href: '/stake', desc: 'Earn ~12.5% APR' },
        ].map(action => (
          <Link key={action.href} to={action.href}>
            <div className="glass-card p-5 text-center group hover:border-blue-500/40 transition-all cursor-pointer">
              <div className="font-display font-semibold text-white mb-1 group-hover:text-blue-400 transition-colors">{action.label}</div>
              <div className="text-slate-500 text-sm">{action.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
