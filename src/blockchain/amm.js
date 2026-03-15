import { ethers } from 'ethers';
import { getProvider, getWeb3Provider } from './evm.js';
import { CONTRACTS, TOKENS, ROUTER_ABI, FACTORY_ABI, PAIR_ABI, PAIR_CORE_ABI, LP_TOKEN_ABI, ERC20_ABI, ORACLE_ABI, ORACLE_SWAP_ABI, SWAP_FEE, POOL_CONTRACTS, isOracleSwapPair } from './tokens.js';

// ─── In-memory caches ──────────────────────────────────────────────────────────
// lpToken dan token0 per pair — nilainya static, tidak pernah berubah
const _lpTokenCache  = {};   // pairAddress → lpTokenAddress
const _token0Cache   = {};   // pairAddress → token0Address

// Pool reserves cache — TTL 30 detik supaya pindah halaman tidak fetch ulang
const _poolCache     = {};   // key → { data, ts }
const POOL_CACHE_TTL = 30_000;

export function invalidatePoolCache() {
  Object.keys(_poolCache).forEach(k => delete _poolCache[k]);
}

// ─── Oracle ────────────────────────────────────────────────────────────────────

/**
 * Fetch USD price of a token from the on-chain oracle.
 * Tries multiple function signatures in order; returns null if none work.
 * Price is always returned as a plain JS number (USD, floating point).
 */
export async function getOraclePrice(tokenSymbol) {
  try {
    const provider = getProvider();
    const oracle = new ethers.Contract(CONTRACTS.ORACLE, ORACLE_ABI, provider);
    const token = TOKENS[tokenSymbol];
    if (!token) return null;
    const tokenAddress = token.isNative ? CONTRACTS.WRAI : token.address;

    // Try getPrice(address) → uint256 with 8 decimals
    for (const fn of ['getPrice', 'getAssetPrice', 'getPriceUSD']) {
      try {
        const raw = await oracle[fn](tokenAddress);
        const price = parseFloat(ethers.formatUnits(raw, 8));
        if (price > 0) return price;
      } catch { /* try next */ }
    }

    // Try getTokenPrice(address) → (uint256 price, uint8 decimals)
    try {
      const [raw, dec] = await oracle.getTokenPrice(tokenAddress);
      const price = parseFloat(ethers.formatUnits(raw, dec));
      if (price > 0) return price;
    } catch { /* skip */ }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch oracle prices for all known tokens in parallel.
 * Returns { symbol: usdPrice } — null values mean oracle unavailable for that token.
 */
export async function getAllOraclePrices() {
  const symbols = Object.keys(TOKENS);
  const results = await Promise.all(symbols.map(s => getOraclePrice(s).catch(() => null)));
  const map = {};
  symbols.forEach((s, i) => { map[s] = results[i]; });
  return map;
}

/**
 * Compute price impact vs oracle reference price.
 * Returns a number (%) or null if oracle prices aren't available.
 *
 * priceImpact = (oracleRate - executionRate) / oracleRate * 100
 * A positive % means you're getting less than the oracle rate (slippage + fee).
 */
export async function getOraclePriceImpact(fromSymbol, toSymbol, amountIn, amountOut) {
  try {
    const [fromUSD, toUSD] = await Promise.all([
      getOraclePrice(fromSymbol),
      getOraclePrice(toSymbol),
    ]);
    if (!fromUSD || !toUSD || !parseFloat(amountIn) || !parseFloat(amountOut)) return null;

    // How many toTokens you'd expect at oracle fair price
    const oracleRate = fromUSD / toUSD; // toToken per 1 fromToken at fair price
    const executionRate = parseFloat(amountOut) / parseFloat(amountIn);

    const impact = ((oracleRate - executionRate) / oracleRate) * 100;
    return Math.max(0, impact);
  } catch {
    return null;
  }
}

function getRouterContract(signerOrProvider) {
  return new ethers.Contract(CONTRACTS.ROUTER, ROUTER_ABI, signerOrProvider);
}

function getFactoryContract(signerOrProvider) {
  return new ethers.Contract(CONTRACTS.FACTORY, FACTORY_ABI, signerOrProvider);
}

function getPairContract(pairAddress, signerOrProvider) {
  return new ethers.Contract(pairAddress, PAIR_ABI, signerOrProvider);
}

function getOracleSwapContract(signerOrProvider) {
  return new ethers.Contract(CONTRACTS.ORACLE_SWAP, ORACLE_SWAP_ABI, signerOrProvider);
}

// ─── OracleSwap helpers ───────────────────────────────────────────────────────

/**
 * Ambil quote dari OracleSwap contract.
 * Harga selalu = oracle price, tidak ada slippage dari pool size.
 * Returns string amount, atau throws dengan pesan error yang jelas.
 */
export async function getAmountOutOracleSwap(amountIn, fromSymbol, toSymbol) {
  if (!amountIn || parseFloat(amountIn) === 0) return '0';
  try {
    const provider   = getProvider();
    const oracleSwap = getOracleSwapContract(provider);
    const fromToken  = TOKENS[fromSymbol];
    const toToken    = TOKENS[toSymbol];
    const amountInParsed = ethers.parseUnits(amountIn.toString(), fromToken.decimals);

    // Cek canSwap dulu — dapat reason kalau gagal
    try {
      const [possible, reason] = await oracleSwap.canSwap(
        fromToken.address, toToken.address, amountInParsed
      );
      if (!possible) {
        console.warn(`[OracleSwap] canSwap=false: ${reason}`);
        // Lempar error dengan reason yang bisa ditangkap Swap.jsx
        throw new Error(`OracleSwap: ${reason}`);
      }
    } catch (canSwapErr) {
      // kalau canSwap itu sendiri revert (contract belum deploy / pair belum enable)
      if (canSwapErr.message.startsWith('OracleSwap:')) throw canSwapErr;
      console.warn('[OracleSwap] canSwap call failed:', canSwapErr.message);
      throw new Error('OracleSwap: Contract not ready — check pair is enabled and reserves are deposited');
    }

    const [amountOut] = await oracleSwap.getQuote(fromToken.address, toToken.address, amountInParsed);
    return ethers.formatUnits(amountOut, toToken.decimals);
  } catch (err) {
    // Re-throw error dengan prefix OracleSwap agar Swap.jsx bisa distinguish
    if (err.message.startsWith('OracleSwap:')) throw err;
    console.warn('[getAmountOutOracleSwap] error:', err.message);
    throw new Error('OracleSwap: Failed to get quote');
  }
}

/**
 * Cek reserve OracleSwap untuk token tertentu.
 */
export async function getOracleSwapReserves(symbols) {
  try {
    const provider  = getProvider();
    const oracleSwap = getOracleSwapContract(provider);
    const addresses = symbols.map(s => TOKENS[s]?.address).filter(Boolean);
    const balances  = await oracleSwap.getReserves(addresses);
    const result    = {};
    symbols.forEach((s, i) => {
      result[s] = ethers.formatUnits(balances[i], TOKENS[s]?.decimals || 18);
    });
    return result;
  } catch {
    return {};
  }
}

/**
 * Execute swap via OracleSwap contract.
 * Approve → swap(tokenIn, tokenOut, amountIn, amountOutMin, to)
 */
export async function executeOracleSwap({ fromSymbol, toSymbol, amountIn, amountOutMin, slippage = 0.5, userAddress }) {
  const web3Provider   = await getWeb3Provider();
  const signer         = await web3Provider.getSigner();
  const oracleSwap     = getOracleSwapContract(signer);

  const fromToken = TOKENS[fromSymbol];
  const toToken   = TOKENS[toSymbol];

  const amountInParsed = ethers.parseUnits(amountIn.toString(), fromToken.decimals);
  const amountOutMinParsed = ethers.parseUnits(
    (parseFloat(amountOutMin) * (1 - slippage / 100)).toFixed(toToken.decimals),
    toToken.decimals
  );

  // Approve OracleSwap kalau belum
  const tokenContract = new ethers.Contract(fromToken.address, ERC20_ABI, signer);
  const allowance = await tokenContract.allowance(userAddress, CONTRACTS.ORACLE_SWAP);
  if (allowance < amountInParsed) {
    const approveTx = await tokenContract.approve(CONTRACTS.ORACLE_SWAP, ethers.MaxUint256);
    await approveTx.wait();
  }

  const tx = await oracleSwap.swap(
    fromToken.address,
    toToken.address,
    amountInParsed,
    amountOutMinParsed,
    userAddress
  );
  return tx.wait();
}

// ─── Export helper buat Swap.jsx ──────────────────────────────────────────────
export { isOracleSwapPair };

function tokenAddr(symbol) {
  const t = TOKENS[symbol];
  if (!t) return null;
  return t.isNative ? CONTRACTS.WRAI : t.address;
}

// Pairs yang punya direct pool
const WRAI = CONTRACTS.WRAI.toLowerCase();
function isDirectPair(addrA, addrB) {
  const a = addrA.toLowerCase();
  const b = addrB.toLowerCase();
  return a === WRAI || b === WRAI;
}

export function buildPath(fromSymbol, toSymbol) {
  const fromAddr = tokenAddr(fromSymbol);
  const toAddr   = tokenAddr(toSymbol);

  if (!fromAddr || !toAddr) return [];

  // Same token
  if (fromAddr.toLowerCase() === toAddr.toLowerCase()) return [fromAddr, toAddr];

  // Direct pool tersedia (salah satu adalah WRAI)
  if (isDirectPair(fromAddr, toAddr)) {
    return [fromAddr, toAddr];
  }

  // Semua pair lain route lewat WRAI
  return [fromAddr, CONTRACTS.WRAI, toAddr];
}

export function getRouteSymbols(fromSymbol, toSymbol) {
  const path = buildPath(fromSymbol, toSymbol);
  const addrToSymbol = {};
  Object.entries(TOKENS).forEach(([sym, t]) => {
    const addr = (t.isNative ? CONTRACTS.WRAI : t.address).toLowerCase();
    addrToSymbol[addr] = sym;
  });
  addrToSymbol[CONTRACTS.WRAI.toLowerCase()] = 'WRAI';
  return path.map(addr => addrToSymbol[addr.toLowerCase()] || addr.slice(0, 6));
}

export async function getAmountOut(amountIn, fromSymbol, toSymbol) {
  if (!amountIn || parseFloat(amountIn) === 0) return '0';

  // OracleSwap pairs → harga langsung dari oracle, tidak pakai AMM
  if (isOracleSwapPair(fromSymbol, toSymbol)) {
    return getAmountOutOracleSwap(amountIn, fromSymbol, toSymbol);
    // Note: getAmountOutOracleSwap throws dengan pesan jelas kalau gagal
    // Caller (Swap.jsx) harus catch dan tampilkan error
  }

  try {
    const rpcProvider = getProvider();
    const router = getRouterContract(rpcProvider);
    const path = buildPath(fromSymbol, toSymbol);

    const fromToken = TOKENS[fromSymbol];
    const toToken   = TOKENS[toSymbol];

    const amountInParsed = ethers.parseUnits(amountIn.toString(), fromToken.decimals);
    const amounts = await router.getAmountsOut(amountInParsed, path);

    return ethers.formatUnits(amounts[amounts.length - 1], toToken.decimals);
  } catch (err) {
    console.warn('getAmountOut error:', err.message);
    return '0';
  }
}

export async function getPriceImpact(amountIn, fromSymbol, toSymbol) {
  try {
    const rpcProvider = getProvider();
    const factory = getFactoryContract(rpcProvider);
    const path = buildPath(fromSymbol, toSymbol);

    // Gunakan first hop untuk estimasi impact
    const pairAddress = await factory.getPair(path[0], path[1]);
    if (pairAddress === ethers.ZeroAddress) return 0;

    const pair = getPairContract(pairAddress, rpcProvider);
    const [reserve0, reserve1] = await pair.getReserves();
    const token0 = await pair.token0();

    const fromToken = TOKENS[fromSymbol];
    const amountInWei = ethers.parseUnits(amountIn.toString(), fromToken.decimals);

    const [reserveIn, reserveOut] = path[0].toLowerCase() === token0.toLowerCase()
      ? [reserve0, reserve1]
      : [reserve1, reserve0];

    const amountInWithFee = amountInWei * 997n;
    const numerator   = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;
    const amountOutOptimal = numerator / denominator;

    // First hop output selalu dalam decimals token path[1]
    const hop1Token = Object.values(TOKENS).find(t => (t.isNative ? CONTRACTS.WRAI : t.address).toLowerCase() === path[1].toLowerCase());
    const hop1Decimals = hop1Token ? hop1Token.decimals : 18;

    // Normalize reserves ke decimal units dulu sebelum dibagi
    // (reserveIn/reserveOut masih raw BigInt — beda decimals antar token bikin kalkulasi meleset)
    const reserveInFloat  = parseFloat(ethers.formatUnits(reserveIn,  fromToken.decimals));
    const reserveOutFloat = parseFloat(ethers.formatUnits(reserveOut, hop1Decimals));

    const priceWithoutImpact = (reserveOutFloat / reserveInFloat) * parseFloat(amountIn);
    const priceWithImpact = parseFloat(ethers.formatUnits(amountOutOptimal, hop1Decimals));

    if (priceWithoutImpact === 0) return 0;
    const impact = ((priceWithoutImpact - priceWithImpact) / priceWithoutImpact) * 100;
    return Math.max(0, impact);
  } catch {
    return 0;
  }
}

export async function executeSwap({ fromSymbol, toSymbol, amountIn, amountOutMin, slippage = 0.5, userAddress }) {
  // OracleSwap pairs → pakai contract OracleSwap, bukan Router AMM
  if (isOracleSwapPair(fromSymbol, toSymbol)) {
    return executeOracleSwap({ fromSymbol, toSymbol, amountIn, amountOutMin, slippage, userAddress });
  }

  const web3Provider = await getWeb3Provider();
  const signerInstance = await web3Provider.getSigner();
  const router = getRouterContract(signerInstance);

  const fromToken = TOKENS[fromSymbol];
  const toToken   = TOKENS[toSymbol];
  const path = buildPath(fromSymbol, toSymbol);

  const amountInParsed = ethers.parseUnits(amountIn.toString(), fromToken.decimals);
  const amountOutMinParsed = ethers.parseUnits(
    (parseFloat(amountOutMin) * (1 - slippage / 100)).toFixed(toToken.decimals),
    toToken.decimals
  );
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  // Approve ERC20 input jika perlu
  if (!fromToken.isNative) {
    const tokenContract = new ethers.Contract(fromToken.address, ERC20_ABI, signerInstance);
    const allowance = await tokenContract.allowance(userAddress, CONTRACTS.ROUTER);
    if (allowance < amountInParsed) {
      const approveTx = await tokenContract.approve(CONTRACTS.ROUTER, ethers.MaxUint256);
      await approveTx.wait();
    }
  }

  // Router kita tidak punya swapExactETHForTokens — RAI native harus wrap dulu
  if (fromToken.isNative || toToken.isNative) {
    throw new Error('Swap RAI native tidak didukung langsung. Wrap RAI → WRAI dulu.');
  }

  const tx = await router.swapExactTokensForTokens(
    amountInParsed, amountOutMinParsed, path, userAddress, deadline
  );
  return tx.wait();
}

export async function getPoolReserves(token0Symbol, token1Symbol, { forceRefresh = false } = {}) {
  const cacheKey = `${token0Symbol}-${token1Symbol}`;

  // Kembalikan cache kalau masih fresh (< 30 detik) dan tidak diminta paksa refresh
  if (!forceRefresh && _poolCache[cacheKey]) {
    const { data, ts } = _poolCache[cacheKey];
    if (Date.now() - ts < POOL_CACHE_TTL) return data;
  }

  try {
    const rpcProvider = getProvider();

    const token0 = TOKENS[token0Symbol];
    const token1 = TOKENS[token1Symbol];
    const addr0 = token0.isNative ? CONTRACTS.WRAI : token0.address;

    // Ambil pair address dari POOL_CONTRACTS (hardcode, skip getPair() call)
    const otherSymbol = token0Symbol === 'WRAI' ? token1Symbol : token0Symbol;
    const pairAddress = POOL_CONTRACTS[otherSymbol];
    if (!pairAddress || pairAddress === '') {
      console.warn(`[getPoolReserves] POOL_CONTRACTS.${otherSymbol} belum diisi`);
      return { reserve0: '0', reserve1: '0', totalSupply: '0', pairAddress: null, lpTokenAddress: null };
    }

    const pairContract = new ethers.Contract(pairAddress, PAIR_CORE_ABI, rpcProvider);

    // ── Ambil lpToken & token0 dari cache kalau sudah pernah di-fetch ──────────
    let lpTokenAddress = _lpTokenCache[pairAddress];
    let pToken0        = _token0Cache[pairAddress];

    if (!lpTokenAddress || !pToken0) {
      // Belum ada di cache — fetch paralel sekaligus
      [lpTokenAddress, pToken0] = await Promise.all([
        pairContract.lpToken(),
        pairContract.token0(),
      ]);
      _lpTokenCache[pairAddress] = lpTokenAddress;
      _token0Cache[pairAddress]  = pToken0;
    }

    // Fetch reserves + totalSupply paralel
    const lpTokenContract = new ethers.Contract(lpTokenAddress, LP_TOKEN_ABI, rpcProvider);
    const [[reserve0, reserve1], totalSupply] = await Promise.all([
      pairContract.getReserves(),
      lpTokenContract.totalSupply(),
    ]);

    // Sesuaikan urutan reserve dengan urutan token0/token1 yang diminta
    const [r0, r1] = pToken0.toLowerCase() === addr0.toLowerCase()
      ? [reserve0, reserve1]
      : [reserve1, reserve0];

    const data = {
      reserve0: ethers.formatUnits(r0, token0.decimals),
      reserve1: ethers.formatUnits(r1, token1.decimals),
      totalSupply: ethers.formatEther(totalSupply),
      pairAddress,
      lpTokenAddress,
    };

    _poolCache[cacheKey] = { data, ts: Date.now() };
    return data;
  } catch (err) {
    console.error(`[getPoolReserves] ERROR for ${token0Symbol}/${token1Symbol}:`, err.message);
    return { reserve0: '0', reserve1: '0', totalSupply: '0', pairAddress: null, lpTokenAddress: null };
  }
}

export async function getUserLPBalance(token0Symbol, token1Symbol, userAddress) {
  try {
    const rpcProvider = getProvider();

    const otherSymbol = token0Symbol === 'WRAI' ? token1Symbol : token0Symbol;
    const pairAddress = POOL_CONTRACTS[otherSymbol];
    if (!pairAddress || pairAddress === '') return '0';

    // Pakai cache lpToken kalau sudah ada — skip 1 RPC call
    let lpTokenAddress = _lpTokenCache[pairAddress];
    if (!lpTokenAddress) {
      const pairContract = new ethers.Contract(pairAddress, PAIR_CORE_ABI, rpcProvider);
      lpTokenAddress = await pairContract.lpToken();
      _lpTokenCache[pairAddress] = lpTokenAddress;
    }

    const lpTokenContract = new ethers.Contract(lpTokenAddress, LP_TOKEN_ABI, rpcProvider);
    const balance = await lpTokenContract.balanceOf(userAddress);
    return ethers.formatEther(balance);
  } catch {
    return '0';
  }
}

/**
 * Hitung estimasi APR dari event Swap dalam 24 jam terakhir.
 * 
 * Formula: APR = (Volume24h × fee% × 365 / TVL) × 100
 * 
 * Event Swap: (address sender, uint256 in0, uint256 in1, uint256 out0, uint256 out1, address to)
 * Volume per swap = nilai token yang masuk ke pool (in0 atau in1, whichever > 0)
 */
export async function getPoolAPR(token0Symbol, token1Symbol, tvlUSD, tokenPrices) {
  try {
    if (!tvlUSD || tvlUSD <= 0) return null;

    const otherSymbol = token0Symbol === 'WRAI' ? token1Symbol : token0Symbol;
    const pairAddress = POOL_CONTRACTS[otherSymbol];
    if (!pairAddress || pairAddress === '') return null;

    const rpcProvider = getProvider();

    // Republic Testnet RPC limit: max 10,000 blocks per getLogs query
    const MAX_CHUNK = 9000;
    const BLOCKS_PER_DAY = 43200;

    let latestBlock;
    try {
      latestBlock = await rpcProvider.getBlockNumber();
    } catch {
      return null; // RPC down — return null bersih, jangan throw
    }

    const fromBlock = Math.max(0, latestBlock - BLOCKS_PER_DAY);

    const swapInterface = new ethers.Interface([
      'event Swap(address indexed sender, uint256 in0, uint256 in1, uint256 out0, uint256 out1, address indexed to)',
    ]);
    const topicHash = swapInterface.getEvent('Swap').topicHash;

    // Pecah range jadi chunks max 9000 blocks
    const chunks = [];
    for (let start = fromBlock; start <= latestBlock; start += MAX_CHUNK) {
      chunks.push({ from: start, to: Math.min(start + MAX_CHUNK - 1, latestBlock) });
    }

    // Query semua chunks, gabung hasilnya — skip chunk yang gagal
    const allLogs = [];
    for (const chunk of chunks) {
      try {
        const logs = await rpcProvider.getLogs({
          address: pairAddress,
          topics: [topicHash],
          fromBlock: chunk.from,
          toBlock: chunk.to,
        });
        allLogs.push(...logs);
      } catch {
        // chunk gagal (CORS/timeout) — skip saja, jangan throw
      }
    }

    if (allLogs.length === 0) {
      console.log(`[getPoolAPR] ${token0Symbol}/${token1Symbol}: 0 swap logs dalam ${chunks.length} chunks`);
      return 0;
    }

    console.log(`[getPoolAPR] ${token0Symbol}/${token1Symbol}: ${allLogs.length} swap logs ditemukan`);

    const token0 = TOKENS[token0Symbol];
    const token1 = TOKENS[token1Symbol];
    const p0 = tokenPrices[token0Symbol] || 0;
    const p1 = tokenPrices[token1Symbol] || 0;

    // Cek urutan token0/token1 di contract
    const pairContract = new ethers.Contract(pairAddress, PAIR_CORE_ABI, rpcProvider);
    const contractToken0 = (await pairContract.token0()).toLowerCase();
    const addr0 = (token0.isNative ? CONTRACTS.WRAI : token0.address).toLowerCase();
    const token0IsFirst = contractToken0 === addr0;

    // Hitung total volume USD dari semua swap
    let volumeUSD = 0;
    for (const log of allLogs) {
      try {
        const parsed = swapInterface.parseLog(log);
        const { in0, in1 } = parsed.args;
        const [inA, inB] = token0IsFirst ? [in0, in1] : [in1, in0];
        if (inA > 0n && p0 > 0) {
          volumeUSD += parseFloat(ethers.formatUnits(inA, token0.decimals)) * p0;
        } else if (inB > 0n && p1 > 0) {
          volumeUSD += parseFloat(ethers.formatUnits(inB, token1.decimals)) * p1;
        }
      } catch { /* skip malformed log */ }
    }

    console.log(`[getPoolAPR] ${token0Symbol}/${token1Symbol}: volumeUSD=${volumeUSD.toFixed(2)}, tvlUSD=${tvlUSD.toFixed(2)}`);
    if (volumeUSD <= 0) return 0;

    const FEE = 0.003;
    const apr = (volumeUSD * FEE * 365 / tvlUSD) * 100;
    return apr;
  } catch (err) {
    console.warn('[getPoolAPR] error:', err.message);
    return null; // selalu return null, jangan throw ke caller
  }
}

export async function addLiquidity({ token0Symbol, token1Symbol, amount0, amount1, slippage = 0.5, userAddress }) {
  const web3Provider = await getWeb3Provider();
  const signerInstance = await web3Provider.getSigner();
  const router = getRouterContract(signerInstance);

  const token0 = TOKENS[token0Symbol];
  const token1 = TOKENS[token1Symbol];

  // Truncate ke max decimals token — cegah "too many decimals" error dari ethers
  function truncateDecimals(val, dec) {
    const s = val.toString();
    const dot = s.indexOf('.');
    if (dot === -1 || s.length - dot - 1 <= dec) return s;
    return s.slice(0, dot + dec + 1);
  }
  const amount0Parsed = ethers.parseUnits(truncateDecimals(amount0, token0.decimals), token0.decimals);
  const amount1Parsed = ethers.parseUnits(truncateDecimals(amount1, token1.decimals), token1.decimals);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  for (const [symbol, amount] of [[token0Symbol, amount0Parsed], [token1Symbol, amount1Parsed]]) {
    const token = TOKENS[symbol];
    if (!token.isNative) {
      const contract = new ethers.Contract(token.address, ERC20_ABI, signerInstance);
      const allowance = await contract.allowance(userAddress, CONTRACTS.ROUTER);
      if (allowance < amount) {
        const tx = await contract.approve(CONTRACTS.ROUTER, ethers.MaxUint256);
        await tx.wait();
      }
    }
  }

  let tx;
  if (token0.isNative) {
    tx = await router.addLiquidityETH(
      token1.address, amount1Parsed, 0n, 0n, userAddress, deadline,
      { value: amount0Parsed }
    );
  } else if (token1.isNative) {
    tx = await router.addLiquidityETH(
      token0.address, amount0Parsed, 0n, 0n, userAddress, deadline,
      { value: amount1Parsed }
    );
  } else {
    tx = await router.addLiquidity(
      token0.address, token1.address,
      amount0Parsed, amount1Parsed,
      0n, 0n,
      userAddress, deadline
    );
  }

  return tx.wait();
}

export async function removeLiquidity({ token0Symbol, token1Symbol, lpAmount, slippage = 0.5, userAddress }) {
  const web3Provider = await getWeb3Provider();
  const signerInstance = await web3Provider.getSigner();
  const router = getRouterContract(signerInstance);
  const factory = getFactoryContract(signerInstance);

  const token0 = TOKENS[token0Symbol];
  const token1 = TOKENS[token1Symbol];

  const addr0 = token0.isNative ? CONTRACTS.WRAI : token0.address;
  const addr1 = token1.isNative ? CONTRACTS.WRAI : token1.address;

  const pairAddress = await factory.getPair(addr0, addr1);

  // Ambil LP Token address dari Pair contract
  const pairContract = new ethers.Contract(pairAddress, PAIR_CORE_ABI, signerInstance);
  const lpTokenAddress = await pairContract.lpToken();
  const lpTokenContract = new ethers.Contract(lpTokenAddress, LP_TOKEN_ABI, signerInstance);

  const lpParsed = ethers.parseEther(lpAmount.toString());
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  // Approve LP Token contract ke Router
  const allowance = await lpTokenContract.allowance(userAddress, CONTRACTS.ROUTER);
  if (allowance < lpParsed) {
    const approveTx = await lpTokenContract.approve(CONTRACTS.ROUTER, ethers.MaxUint256);
    await approveTx.wait();
  }

  let tx;
  if (token0.isNative || token1.isNative) {
    const tokenSymbol = token0.isNative ? token1Symbol : token0Symbol;
    const tokenAddress = TOKENS[tokenSymbol].address;
    tx = await router.removeLiquidityETH(tokenAddress, lpParsed, 0n, 0n, userAddress, deadline);
  } else {
    tx = await router.removeLiquidity(
      token0.address, token1.address,
      lpParsed, 0n, 0n, userAddress, deadline
    );
  }

  return tx.wait();
}