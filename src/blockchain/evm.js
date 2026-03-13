import { ethers } from 'ethers';
import { NETWORK, ERC20_ABI, CONTRACTS, TOKENS } from './tokens.js';
import { withEVMFallback, getActiveEVM } from './rpcFallback.js';

let provider = null;
let _providerUrl = null;

// ─── Provider dengan fallback otomatis ───────────────────────────────────────
// Kalau getProvider() dipanggil pertama kali, atau provider lama down,
// withEVMFallback akan coba tiap URL sampai ketemu yang hidup.
export function getProvider() {
  if (!provider) {
    // Inisialisasi dengan RydOne sebagai default sementara,
    // lalu async resolve ke provider terbaik di background
    const defaultUrl = 'https://evm-rpc.republicai.io';
    provider = new ethers.JsonRpcProvider(defaultUrl);
    _providerUrl = defaultUrl;

    // Resolve ke provider terbaik di background tanpa blocking
    getActiveEVM().then(url => {
      if (url !== _providerUrl) {
        provider = new ethers.JsonRpcProvider(url);
        _providerUrl = url;
      }
    }).catch(() => {});
  }
  return provider;
}

/** Buat provider fresh dengan fallback, untuk operasi yang butuh provider baru */
export async function getProviderWithFallback() {
  const url = await getActiveEVM();
  if (url !== _providerUrl) {
    provider = new ethers.JsonRpcProvider(url);
    _providerUrl = url;
  }
  return provider;
}

export async function getWeb3Provider() {
  if (!window.ethereum) throw new Error('MetaMask not installed');
  const web3Provider = new ethers.BrowserProvider(window.ethereum);
  return web3Provider;
}

export async function getSigner() {
  const web3Provider = await getWeb3Provider();
  return web3Provider.getSigner();
}

export async function connectMetaMask() {
  if (!window.ethereum) throw new Error('MetaMask is not installed. Please install MetaMask to continue.');

  try {
    await window.ethereum.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
    });

    await window.ethereum.request({ method: 'eth_requestAccounts' });

    const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainIdHex !== NETWORK.chainId) {
      await switchToRepublicNetwork();
    }

    const web3Provider = new ethers.BrowserProvider(window.ethereum);
    const signerInstance = await web3Provider.getSigner();
    const address = await signerInstance.getAddress();
    return address;
  } catch (err) {
    if (err.code === 4001) throw new Error('Connection rejected by user.');
    throw err;
  }
}

export async function switchToRepublicNetwork() {
  // Sertakan semua EVM RPC URLs agar MetaMask punya backup sendiri
  const allRpcUrls = [
    'https://evm-rpc.republicai.io',
    'https://evmrpc-t.republicai.nodestake.org',
    'https://testnet-evm-republic.provewithryd.xyz',
  ];

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: NETWORK.chainId }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: NETWORK.chainId,
          chainName: NETWORK.chainName,
          nativeCurrency: NETWORK.nativeCurrency,
          rpcUrls: allRpcUrls,
          blockExplorerUrls: NETWORK.blockExplorerUrls,
        }],
      });
    } else {
      throw switchError;
    }
  }
}

export async function getEVMBalances(address) {
  // Gunakan withEVMFallback agar balance fetch tidak gagal kalau satu provider down
  return withEVMFallback(async (url) => {
    const rpcProvider = new ethers.JsonRpcProvider(url);
    const erc20Tokens = ['USDT', 'USDC', 'WRAI', 'WBTC', 'WETH'];

    const [raiRaw, ...erc20Raws] = await Promise.all([
      rpcProvider.getBalance(address).catch(() => null),
      ...erc20Tokens.map(symbol => {
        const token = TOKENS[symbol];
        const contract = new ethers.Contract(token.address, ERC20_ABI, rpcProvider);
        return contract.balanceOf(address).catch(() => null);
      }),
    ]);

    const balances = {};
    balances.RAI = raiRaw ? ethers.formatEther(raiRaw) : '0';
    erc20Tokens.forEach((symbol, i) => {
      const raw = erc20Raws[i];
      balances[symbol] = raw ? ethers.formatUnits(raw, TOKENS[symbol].decimals) : '0';
    });
    return balances;
  });
}

export async function getTokenBalance(address, tokenSymbol) {
  const rpcProvider = getProvider();
  const token = TOKENS[tokenSymbol];

  try {
    if (token.isNative) {
      const balance = await rpcProvider.getBalance(address);
      return ethers.formatEther(balance);
    } else {
      const contract = new ethers.Contract(token.address, ERC20_ABI, rpcProvider);
      const balance = await contract.balanceOf(address);
      return ethers.formatUnits(balance, token.decimals);
    }
  } catch {
    return '0';
  }
}

export async function approveToken(tokenAddress, spenderAddress, amount, decimals = 18) {
  const web3Provider = await getWeb3Provider();
  const signerInstance = await web3Provider.getSigner();
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signerInstance);
  const tx = await contract.approve(spenderAddress, ethers.parseUnits(amount.toString(), decimals));
  return tx.wait();
}

export async function checkAllowance(tokenAddress, ownerAddress, spenderAddress) {
  const rpcProvider = getProvider();
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, rpcProvider);
  return contract.allowance(ownerAddress, spenderAddress);
}

export async function isConnected() {
  if (!window.ethereum) return false;
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accounts.length) return false;
    const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    return chainIdHex === NETWORK.chainId;
  } catch {
    return false;
  }
}

export async function getCurrentAccount() {
  if (!window.ethereum) return null;
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    return accounts[0] || null;
  } catch {
    return null;
  }
}

export function formatAddress(address, chars = 6) {
  if (!address) return '';
  return `${address.slice(0, chars)}...${address.slice(-4)}`;
}

export function formatBalance(balance, decimals = 4) {
  const num = parseFloat(balance);
  if (isNaN(num)) return '0.0000';
  if (num === 0) return '0.0000';
  if (num < 0.0001) return '<0.0001';
  return num.toFixed(decimals);
}

export function setupAccountChangeListener(callback) {
  if (!window.ethereum) return;
  window.ethereum.on('accountsChanged', (accounts) => {
    callback(accounts[0] || null);
  });
}

export function setupNetworkChangeListener(callback) {
  if (!window.ethereum) return;
  window.ethereum.on('chainChanged', (chainId) => {
    callback(chainId);
  });
}