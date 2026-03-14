import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
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
  setupAccountChangeListener,
  setupNetworkChangeListener,
  getEVMBalances,
} from './blockchain/evm.js';
import { connectKeplr, getCosmosBalance } from './blockchain/cosmos.js';
import { NETWORK } from './blockchain/tokens.js';
import { prefetchValidators } from './blockchain/staking.js';

export const WalletContext = createContext(null);
export function useWallet() { return useContext(WalletContext); }

function PageWrapper({ children }) {
  const location = useLocation();
  return <div key={location.pathname} className="animate-slide-up">{children}</div>;
}

function AppContent() {
  const [evmAddress,    setEvmAddress]    = useState(null);
  const [cosmosAddress, setCosmosAddress] = useState(null);
  const [balances,    setBalances]    = useState({ RAI: '0', USDT: '0', USDC: '0', WRAI: '0', WBTC: '0', WETH: '0' });
  const [cosmosRAI,   setCosmosRAI]   = useState('0'); // RAI dari Keplr — hanya dipakai di Stake page
  const [notifications,   setNotifications]  = useState([]);
  const [isWrongNetwork,  setIsWrongNetwork]  = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const addNotification = useCallback((message, type = 'info', duration = 5000) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, message, type }]);
    if (duration > 0) setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), duration);
    return id;
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // fetchEVMBalances: selalu terima address eksplisit — tidak bergantung state/closure
  const fetchEVMBalances = useCallback(async (address) => {
    if (!address) return;
    try {
      const bal = await getEVMBalances(address);
      setBalances(prev => ({ ...prev, ...bal }));
    } catch (err) {
      console.error('[fetchEVMBalances] Failed:', err.message);
      addNotification('Failed to fetch token balances. Check your network connection.', 'error');
    }
  }, [addNotification]);

  // fetchCosmosBalances: simpan ke cosmosRAI (untuk Stake page).
  // Kalau tidak ada evmAddress, juga isi balances.RAI supaya Dashboard/Swap bisa baca.
  // Kalau evmAddress ada, balances.RAI tetap dari EVM — tidak ditimpa.
  const fetchCosmosBalances = useCallback(async (address) => {
    if (!address) return;
    try {
      const rai = await getCosmosBalance(address);
      setCosmosRAI(rai);
      // Hanya update balances.RAI kalau MetaMask belum connect
      setEvmAddress(currentEvm => {
        if (!currentEvm) setBalances(prev => ({ ...prev, RAI: rai }));
        return currentEvm;
      });
    } catch (err) {
      console.warn('Cosmos balance error:', err.message);
    }
  }, []);

  // refreshBalances: dipanggil tanpa argumen dari Swap/Liquidity setelah transaksi.
  // Pakai parameter agar tidak kena stale closure — caller bisa pass address,
  // atau kita gunakan nilai dari state langsung via setter pattern.
  const refreshBalances = useCallback(async (evmAddr, cosmosAddr) => {
    setLoadingBalances(true);
    try {
      // Kalau dipanggil tanpa argumen (dari Swap/Liquidity), kita tidak punya
      // akses ke state terbaru via closure — jadi pakai functional setState trick:
      // baca address dari state saat ini via setter dummy, lalu fetch.
      await new Promise(resolve => {
        setEvmAddress(currentEvm => {
          setCosmosAddress(currentCosmos => {
            const evm    = evmAddr    ?? currentEvm;
            const cosmos = cosmosAddr ?? currentCosmos;
            Promise.all([
              evm    ? fetchEVMBalances(evm)       : Promise.resolve(),
              cosmos ? fetchCosmosBalances(cosmos) : Promise.resolve(),
            ]).then(resolve);
            return currentCosmos; // tidak mengubah state
          });
          return currentEvm; // tidak mengubah state
        });
      });
    } finally {
      setLoadingBalances(false);
    }
  }, [fetchEVMBalances, fetchCosmosBalances]);

  const connectEVM = useCallback(async () => {
    try {
      const address = await connectMetaMask();
      setEvmAddress(address);
      await fetchEVMBalances(address);
      addNotification('MetaMask connected successfully!', 'success');
    } catch (err) {
      addNotification(err.message, 'error');
    }
  }, [addNotification, fetchEVMBalances]);

  const connectCosmos = useCallback(async () => {
    try {
      const address = await connectKeplr();
      setCosmosAddress(address);
      await fetchCosmosBalances(address);
      addNotification('Keplr connected successfully!', 'success');
    } catch (err) {
      addNotification(err.message, 'error');
    }
  }, [addNotification, fetchCosmosBalances]);

  const disconnect = useCallback(() => {
    setEvmAddress(null);
    setCosmosAddress(null);
    setBalances({ RAI: '0', USDT: '0', USDC: '0', WRAI: '0', WBTC: '0', WETH: '0' });
    setCosmosRAI('0');
    addNotification('Wallet disconnected.', 'info');
  }, [addNotification]);

  useEffect(() => {
    prefetchValidators().catch(() => {});

    setupAccountChangeListener((newAddr) => {
      if (newAddr) {
        setEvmAddress(newAddr);
        fetchEVMBalances(newAddr);
      } else {
        setEvmAddress(null);
        setBalances(prev => ({ ...prev, RAI: '0', USDT: '0', USDC: '0', WRAI: '0', WBTC: '0', WETH: '0' }));
      }
    });

    setupNetworkChangeListener((chainId) => {
      const wrongNet = chainId !== NETWORK.chainId;
      setIsWrongNetwork(wrongNet);
      if (wrongNet) addNotification('Please switch to Republic Testnet', 'warning');
    });
  }, []);

  const walletValue = {
    evmAddress,
    cosmosAddress,
    // walletType: untuk backward compat. Keplr prioritas di Stake page.
    walletType: cosmosAddress ? 'keplr' : evmAddress ? 'evm' : null,
    balances,       // RAI di sini selalu dari EVM — untuk Swap/Liquidity/Dashboard
    cosmosRAI,      // RAI dari Keplr — khusus Stake page
    isWrongNetwork,
    loadingBalances,
    connectEVM,
    connectCosmos,
    connectKeplr: connectCosmos,
    disconnect,
    refreshBalances,
    addNotification,
    removeNotification,
  };

  return (
    <WalletContext.Provider value={walletValue}>
      <div className="min-h-screen flex flex-col" style={{backgroundColor:'#030509', backgroundImage:'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize:'80px 80px'}}>
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="bg-orb w-[600px] h-[600px] bg-blue-600/8 -top-64 -left-32" />
          <div className="bg-orb w-[400px] h-[400px] bg-blue-800/6 top-1/2 -right-32" />
          <div className="bg-orb w-[300px] h-[300px] bg-cyan-600/5 bottom-20 left-1/3" />
        </div>
        <Navbar />
        <main className="relative z-10 pt-20 flex-1">
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
        <Footer />
        <div className="fixed top-24 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
          {notifications.map(n => (
            <Notification key={n.id} message={n.message} type={n.type} onClose={() => removeNotification(n.id)} />
          ))}
        </div>
      </div>
    </WalletContext.Provider>
  );
}

export default function App() {
  return <BrowserRouter><AppContent /></BrowserRouter>;
}