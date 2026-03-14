import { useState } from 'react';
import { useWallet } from '../App.jsx';
import { formatAddress } from '../blockchain/evm.js';

export default function WalletConnect({ compact = false }) {
  const { evmAddress, cosmosAddress, connectEVM, connectCosmos, disconnect, balances } = useWallet();
  const [showDropdown,    setShowDropdown]    = useState(false);
  const [showConnectMenu, setShowConnectMenu] = useState(false);

  const isAnyConnected = evmAddress || cosmosAddress;

  // ── Belum connect sama sekali → tampilkan menu pilih wallet ──────────────────
  if (!isAnyConnected) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowConnectMenu(!showConnectMenu)}
          className="btn-primary text-sm px-4 py-2 flex items-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
          Connect Wallet
        </button>

        {showConnectMenu && (
          <div className="absolute right-0 top-full mt-2 w-56 glass-card p-3 z-50 animate-fade-in">
            <p className="text-xs text-slate-500 font-display mb-2 px-1">Choose wallet</p>
            <button
              onClick={() => { connectEVM(); setShowConnectMenu(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-blue-900/20 transition-colors text-left"
            >
              <img src="/images/metamask.png" alt="MetaMask" className="w-6 h-6" />
              <div>
                <div className="text-white font-display text-sm font-medium">MetaMask</div>
                <div className="text-slate-500 text-xs">EVM · Swap, Liquidity, Faucet</div>
              </div>
            </button>
            <button
              onClick={() => { connectCosmos(); setShowConnectMenu(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-blue-900/20 transition-colors text-left mt-1"
            >
              <img src="/images/keplr.png" alt="Keplr" className="w-6 h-6" />
              <div>
                <div className="text-white font-display text-sm font-medium">Keplr</div>
                <div className="text-slate-500 text-xs">Cosmos · Stake, Validator</div>
              </div>
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Sudah connect (salah satu atau keduanya) ──────────────────────────────────
  // Icon: tampilkan keduanya kalau dua-duanya connect
  const displayAddr = evmAddress || cosmosAddress;

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-blue-500/30 bg-blue-900/15 hover:bg-blue-900/25 hover:border-blue-500/50 transition-all duration-200"
      >
        {/* Icon wallet — tampilkan dua ikon kalau keduanya connect */}
        {evmAddress && cosmosAddress ? (
          <div className="flex items-center -space-x-1">
            <img src="/images/metamask.png" alt="MM" className="w-5 h-5 rounded-full ring-1 ring-[#0d1117]" />
            <img src="/images/keplr.png" alt="Keplr" className="w-5 h-5 rounded-full ring-1 ring-[#0d1117]" />
          </div>
        ) : evmAddress ? (
          <img src="/images/metamask.png" alt="MM" className="w-5 h-5" />
        ) : (
          <img src="/images/keplr.png" alt="Keplr" className="w-5 h-5" />
        )}

        <span className="font-mono text-sm text-blue-300">{formatAddress(displayAddr)}</span>
        <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
        <svg className={`w-3 h-3 text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-80 glass-card p-4 z-50 animate-fade-in">

          {/* ── EVM Address ── */}
          {evmAddress ? (
            <div className="mb-3 pb-3 border-b border-blue-900/40">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <img src="/images/metamask.png" alt="MM" className="w-4 h-4" />
                  <span className="text-xs text-slate-400 font-display">MetaMask</span>
                </div>
                <span className="badge-green text-xs">Connected</span>
              </div>
              <span className="font-mono text-xs text-blue-300 break-all">{evmAddress}</span>
            </div>
          ) : (
            <div className="mb-3 pb-3 border-b border-blue-900/40">
              <button
                onClick={() => { connectEVM(); setShowDropdown(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-900/20 border border-orange-500/20 hover:bg-orange-900/30 transition-colors"
              >
                <img src="/images/metamask.png" alt="MM" className="w-5 h-5" />
                <span className="text-sm text-orange-300 font-display font-medium">Connect MetaMask</span>
                <span className="text-xs text-slate-500 ml-auto">Swap · LP · Faucet</span>
              </button>
            </div>
          )}

          {/* ── Cosmos Address ── */}
          {cosmosAddress ? (
            <div className="mb-3 pb-3 border-b border-blue-900/40">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <img src="/images/keplr.png" alt="Keplr" className="w-4 h-4" />
                  <span className="text-xs text-slate-400 font-display">Keplr</span>
                </div>
                <span className="badge-blue text-xs">Connected</span>
              </div>
              <span className="font-mono text-xs text-blue-300 break-all">{cosmosAddress}</span>
            </div>
          ) : (
            <div className="mb-3 pb-3 border-b border-blue-900/40">
              <button
                onClick={() => { connectCosmos(); setShowDropdown(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/20 hover:bg-purple-900/30 transition-colors"
              >
                <img src="/images/keplr.png" alt="Keplr" className="w-5 h-5" />
                <span className="text-sm text-purple-300 font-display font-medium">Connect Keplr</span>
                <span className="text-xs text-slate-500 ml-auto">Stake · Validator</span>
              </button>
            </div>
          )}

          {/* ── Token Balances ── */}
          <div className="space-y-1 mb-3">
            {Object.entries(balances)
              .filter(([, bal]) => parseFloat(bal) > 0)
              .map(([sym, bal]) => (
                <div key={sym} className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-display">{sym}</span>
                  <span className="font-mono text-xs text-white">{parseFloat(bal).toFixed(4)}</span>
                </div>
              ))
            }
            {Object.values(balances).every(b => parseFloat(b) === 0) && (
              <p className="text-xs text-slate-600 text-center py-1">No balances</p>
            )}
          </div>

          {/* ── Disconnect ── */}
          <button
            onClick={() => { disconnect(); setShowDropdown(false); }}
            className="w-full btn-danger text-xs py-2"
          >
            Disconnect All
          </button>
        </div>
      )}
    </div>
  );
}