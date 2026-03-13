import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWallet } from '../App.jsx';
import WalletConnect from './WalletConnect.jsx';

const NAV_LINKS = [
  { path: '/', label: 'Home' },
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/swap', label: 'Swap' },
  { path: '/liquidity', label: 'Liquidity' },
  { path: '/stake', label: 'Stake' },
  { path: '/faucet', label: 'Faucet' },
  { path: '/analyze', label: 'Analyze' },
];

export default function Navbar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isWrongNetwork } = useWallet();

  return (
    <>
      {/* Wrong network banner */}
      {isWrongNetwork && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500/10 border-b border-amber-500/30 text-center py-2">
          <span className="text-amber-400 text-sm font-display font-medium">
            ⚠ Wrong network detected. Please switch to Republic Testnet (Chain ID: 77701)
          </span>
        </div>
      )}

      <nav className={`fixed left-0 right-0 z-40 ${isWrongNetwork ? 'top-8' : 'top-0'}`}>
        <div className="mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mt-3 glass-card px-5 py-3 flex items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3 group">
              <img src="/images/rai-logo.png" alt="Republic" className="w-8 h-8 rounded-lg" />
              <div>
                <span className="font-display font-bold text-white text-lg leading-none">Republic</span>
                <div className="badge-blue text-xs ml-1.5 inline-block">Testnet DEX</div>
              </div>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map(link => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`nav-link ${location.pathname === link.path ? 'active' : ''}`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Wallet + mobile toggle */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:block">
                <WalletConnect />
              </div>
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="md:hidden text-slate-400 hover:text-white p-2"
              >
                {mobileOpen ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 6h16M4 12h16M4 18h16"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Mobile menu */}
          {mobileOpen && (
            <div className="md:hidden mt-2 glass-card p-4 flex flex-col gap-2 animate-slide-up">
              {NAV_LINKS.map(link => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setMobileOpen(false)}
                  className={`nav-link block ${location.pathname === link.path ? 'active' : ''}`}
                >
                  {link.label}
                </Link>
              ))}
              <div className="mt-2 pt-2 border-t border-blue-900/40">
                <WalletConnect />
              </div>
            </div>
          )}
        </div>
      </nav>
    </>
  );
}