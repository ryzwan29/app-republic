import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../App.jsx';
import { getLatestBlock, getStakingPool } from '../blockchain/cosmos.js';
import { getValidators } from '../blockchain/staking.js';

const FEATURES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        <path d="m8 12 4-4 4 4"/>
        <path d="m16 12-4 4-4-4"/>
      </svg>
    ),
    title: 'Token Swap',
    desc: 'Trade RAI, USDT, USDC and WRAI with minimal slippage using our AMM.',
    href: '/swap',
    badge: '0.3% fee',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        <path d="M2 12h20"/>
      </svg>
    ),
    title: 'Liquidity Pools',
    desc: 'Provide liquidity to earn 0.2% of every trade in your active pools.',
    href: '/liquidity',
    badge: 'Earn fees',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    title: 'Staking',
    desc: 'Stake RAI to validators and earn ~12.5% APR rewards in RAI.',
    href: '/stake',
    badge: '~12.5% APR',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
    title: 'Testnet Faucet',
    desc: 'Claim free RAI, USDT, and USDC tokens to start testing the DEX.',
    href: '/faucet',
    badge: 'Free tokens',
  },
];

export default function Home() {
  const { connectEVM, evmAddress } = useWallet();
  const [chainData, setChainData] = useState({ height: '—', validators: 0, bonded: '0' });

  useEffect(() => {
    async function fetchChainData() {
      try {
        const [block, pool, validators] = await Promise.all([
          getLatestBlock(),
          getStakingPool(),
          getValidators(),
        ]);
        setChainData({
          height: parseInt(block.height).toLocaleString(),
          validators: validators.length,
          bonded: (parseFloat(pool.bondedTokens) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 }),
        });
      } catch {}
    }
    fetchChainData();
  }, []);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative pt-16 pb-24 px-4">
        <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
        
        <div className="max-w-4xl mx-auto text-center relative">
          {/* Chain status badge */}
          <div className="inline-flex items-center gap-2 badge-green mb-6 px-3 py-1.5 text-sm">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Republic Testnet · Block {chainData.height}
          </div>

          <h1 className="font-display font-extrabold text-5xl sm:text-6xl lg:text-7xl mb-6 leading-none tracking-tight">
            <span className="text-white">Trade on</span>
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-cyan-400 bg-clip-text text-transparent">
              Republic
            </span>
          </h1>

          <p className="text-slate-400 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            A decentralized exchange on Republic Testnet — swap tokens, provide liquidity, and stake RAI to validators with EVM + Cosmos support.
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            {!evmAddress ? (
              <button onClick={connectEVM} className="btn-primary px-8 py-3.5 text-base">
                Launch App
              </button>
            ) : (
              <Link to="/swap" className="btn-primary px-8 py-3.5 text-base">
                Start Trading
              </Link>
            )}
            <Link to="/faucet" className="btn-secondary px-8 py-3.5 text-base">
              Get Testnet Tokens
            </Link>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="max-w-5xl mx-auto px-4 mb-16">
        <div className="glass-card p-6 grid grid-cols-2 sm:grid-cols-4 gap-6 glow-border">
          {[
            { label: 'Network', value: 'Republic Testnet' },
            { label: 'Chain ID', value: '77701' },
            { label: 'Validators', value: chainData.validators || '—' },
            { label: 'Bonded RAI', value: chainData.bonded || '—' },
          ].map(stat => (
            <div key={stat.label} className="text-center">
              <div className="font-display font-bold text-white text-lg sm:text-2xl mb-1">{stat.value}</div>
              <div className="text-slate-500 text-xs font-display uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section className="max-w-5xl mx-auto px-4 pb-24">
        <h2 className="font-display font-bold text-2xl text-center text-white mb-10">
          Everything you need to test
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {FEATURES.map(f => (
            <Link key={f.title} to={f.href}>
              <div className="glass-card p-6 h-full group cursor-pointer hover:border-blue-500/40 transition-all duration-300">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600/20 to-blue-800/20 border border-blue-500/20 flex items-center justify-center text-blue-400 flex-shrink-0 group-hover:border-blue-500/40 group-hover:shadow-glow-sm transition-all">
                    {f.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <h3 className="font-display font-semibold text-white">{f.title}</h3>
                      <span className="badge-blue text-xs">{f.badge}</span>
                    </div>
                    <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Network info */}
      <section className="max-w-5xl mx-auto px-4 pb-24">
        <div className="glass-card p-8 glow-border">
          <h3 className="font-display font-bold text-xl text-white mb-6 text-center">Network Configuration</h3>
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-3">EVM Layer</div>
              <div className="space-y-2">
                {[
                  ['Chain ID', '77701'],
                  ['Currency', 'RAI'],
                  ['RPC', 'testnet-evm-republic.provewithryd.xyz'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between items-center">
                    <span className="text-slate-500 text-sm">{k}</span>
                    <span className="font-mono text-xs text-blue-300 bg-blue-900/20 px-2 py-0.5 rounded">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-3">Cosmos Layer</div>
              <div className="space-y-2">
                {[
                  ['Chain ID', 'raitestnet_77701-1'],
                  ['Prefix', 'rai'],
                  ['REST', 'testnet-api-republic.provewithryd.xyz'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between items-center">
                    <span className="text-slate-500 text-sm">{k}</span>
                    <span className="font-mono text-xs text-blue-300 bg-blue-900/20 px-2 py-0.5 rounded">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-blue-900/30 py-8 text-center">
        <p className="text-slate-600 text-sm font-display">
          Republic DEX · Testnet Environment · Not for production use
        </p>
      </footer>
    </div>
  );
}