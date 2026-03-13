import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Notification from './components/Notification.jsx';
import Home from './pages/Home.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Swap from './pages/Swap.jsx';
import Liquidity from './pages/Liquidity.jsx';
import Stake from './pages/Stake.jsx';
import Faucet from './pages/Faucet.jsx';
import AnalyzeContract from './pages/AnalyzeContract.jsx';
import {
  connectMetaMask,
  getCurrentAccount,
  setupAccountChangeListener,
  setupNetworkChangeListener,
  isConnected,
  getEVMBalances,
} from './blockchain/evm.js';
import { connectKeplr, getCosmosBalance } from './blockchain/cosmos.js';
import { NETWORK } from './blockchain/tokens.js';
import { prefetchValidators } from './blockchain/staking.js';

export const WalletContext = createContext(null);

export function useWallet() {
  return useContext(WalletContext);
}

function PageWrapper({ children }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="animate-slide-up">
      {children}
    </div>
  );
}

function AppContent() {
  const [evmAddress, setEvmAddress] = useState(null);
  const [cosmosAddress, setCosmosAddress] = useState(null);
  const [balances, setBalances] = useState({ RAI: '0', USDT: '0', USDC: '0', WRAI: '0' });
  const [walletType, setWalletType] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [isWrongNetwork, setIsWrongNetwork] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const addNotification = useCallback((message, type = 'info', duration = 5000) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => removeNotification(id), duration);
    }
    return id;
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const refreshBalances = useCallback(async (address, type) => {
    if (!address) return;
    setLoadingBalances(true);
    try {
      const wType = type || walletType;
      if (wType === 'keplr') {
        // Only fetch cosmos balance, don't overwrite EVM balances
        const raiBalance = await getCosmosBalance(address);
        setBalances(prev => ({ ...prev, RAI: raiBalance }));
      } else {
        // EVM: fetch all ERC20 + native balances
        const bal = await getEVMBalances(address);
        setBalances(prev => ({ ...prev, ...bal }));
      }
    } catch (err) {
      console.warn('Balance fetch error:', err.message);
    } finally {
      setLoadingBalances(false);
    }
  }, [walletType]);

  const connectEVM = useCallback(async () => {
    try {
      const address = await connectMetaMask();
      setEvmAddress(address);
      setWalletType(prev => prev || 'metamask');
      await refreshBalances(address, 'metamask');
      addNotification('MetaMask connected successfully!', 'success');
    } catch (err) {
      addNotification(err.message, 'error');
    }
  }, [addNotification, refreshBalances]);

  const connectCosmos = useCallback(async () => {
    try {
      const address = await connectKeplr();
      setCosmosAddress(address);
      if (!walletType) setWalletType('keplr');
      await refreshBalances(address, 'keplr');
      addNotification('Keplr connected successfully!', 'success');
    } catch (err) {
      addNotification(err.message, 'error');
    }
  }, [addNotification, walletType, refreshBalances]);

  const disconnect = useCallback(() => {
    setEvmAddress(null);
    setCosmosAddress(null);
    setWalletType(null);
    setBalances({ RAI: '0', USDT: '0', USDC: '0', WRAI: '0', WBTC: '0', WETH: '0' });
    setShowWalletModal(false);
    addNotification('Wallet disconnected.', 'info');
  }, [addNotification]);

  // Check existing connection on load
  useEffect(() => {
    // Prefetch validator data di background saat app pertama load
    prefetchValidators().catch(() => {});

    setupAccountChangeListener((newAddr) => {
      if (newAddr) {
        setEvmAddress(newAddr);
        refreshBalances(newAddr);
      } else {
        setEvmAddress(null);
        setBalances({ RAI: '0', USDT: '0', USDC: '0', WRAI: '0', WBTC: '0', WETH: '0' });
      }
    });

    setupNetworkChangeListener((chainId) => {
      const wrongNet = chainId !== NETWORK.chainId;
      setIsWrongNetwork(wrongNet);
      if (wrongNet) {
        addNotification('Please switch to Republic Testnet', 'warning');
      }
    });
  }, []);

  const walletValue = {
    evmAddress,
    cosmosAddress,
    walletType,
    balances,
    isWrongNetwork,
    loadingBalances,
    connectEVM,
    connectCosmos,
    disconnect,
    refreshBalances: () => refreshBalances(evmAddress || cosmosAddress),
    addNotification,
    removeNotification,
  };

  return (
    <WalletContext.Provider value={walletValue}>
      <div className="min-h-screen bg-rai-darker">
        {/* Background orbs */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="bg-orb w-[600px] h-[600px] bg-blue-600/8 -top-64 -left-32" />
          <div className="bg-orb w-[400px] h-[400px] bg-blue-800/6 top-1/2 -right-32" />
          <div className="bg-orb w-[300px] h-[300px] bg-cyan-600/5 bottom-20 left-1/3" />
        </div>

        <Navbar />

        <main className="relative z-10 pt-20">
          <PageWrapper>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/swap" element={<Swap />} />
              <Route path="/liquidity" element={<Liquidity />} />
              <Route path="/stake" element={<Stake />} />
              <Route path="/faucet" element={<Faucet />} />
              <Route path="/analyze" element={<AnalyzeContract />} />
            </Routes>
          </PageWrapper>
        </main>

        {/* Notifications */}
        <div className="fixed top-24 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
          {notifications.map(n => (
            <Notification
              key={n.id}
              message={n.message}
              type={n.type}
              onClose={() => removeNotification(n.id)}
            />
          ))}
        </div>
      </div>
    </WalletContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}