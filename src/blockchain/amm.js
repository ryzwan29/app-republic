import { ethers } from 'ethers';
import { getProvider, getWeb3Provider } from './evm.js';
import { CONTRACTS, TOKENS, ROUTER_ABI, FACTORY_ABI, PAIR_ABI, ERC20_ABI, ORACLE_ABI, SWAP_FEE } from './tokens.js';

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

    const priceWithoutImpact = (parseFloat(reserveOut.toString()) / parseFloat(reserveIn.toString())) * parseFloat(amountIn);
    // First hop output selalu dalam decimals token path[1]
    const hop1Token = Object.values(TOKENS).find(t => (t.isNative ? CONTRACTS.WRAI : t.address).toLowerCase() === path[1].toLowerCase());
    const hop1Decimals = hop1Token ? hop1Token.decimals : 18;
    const priceWithImpact = parseFloat(ethers.formatUnits(amountOutOptimal, hop1Decimals));

    if (priceWithoutImpact === 0) return 0;
    const impact = ((priceWithoutImpact - priceWithImpact) / priceWithoutImpact) * 100;
    return Math.max(0, impact);
  } catch {
    return 0;
  }
}

export async function executeSwap({ fromSymbol, toSymbol, amountIn, amountOutMin, slippage = 0.5, userAddress }) {
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

  let tx;
  if (fromToken.isNative) {
    // RAI native → token
    tx = await router.swapExactETHForTokens(
      amountOutMinParsed, path, userAddress, deadline,
      { value: amountInParsed }
    );
  } else if (toToken.isNative) {
    // token → RAI native
    tx = await router.swapExactTokensForETH(
      amountInParsed, amountOutMinParsed, path, userAddress, deadline
    );
  } else {
    // token → token (includes multihop via WRAI)
    tx = await router.swapExactTokensForTokens(
      amountInParsed, amountOutMinParsed, path, userAddress, deadline
    );
  }

  return tx.wait();
}

export async function getPoolReserves(token0Symbol, token1Symbol) {
  try {
    const rpcProvider = getProvider();
    const factory = getFactoryContract(rpcProvider);

    const token0 = TOKENS[token0Symbol];
    const token1 = TOKENS[token1Symbol];
    const addr0 = token0.isNative ? CONTRACTS.WRAI : token0.address;
    const addr1 = token1.isNative ? CONTRACTS.WRAI : token1.address;

    console.log(`[getPoolReserves] ${token0Symbol}/${token1Symbol}`, { addr0, addr1, factory: CONTRACTS.FACTORY });

    const pairAddress = await factory.getPair(addr0, addr1);
    console.log(`[getPoolReserves] pairAddress:`, pairAddress);

    if (!pairAddress || pairAddress === ethers.ZeroAddress) {
      console.warn(`[getPoolReserves] Pair not found for ${token0Symbol}/${token1Symbol}`);
      return { reserve0: '0', reserve1: '0', totalSupply: '0', pairAddress: null };
    }

    const pair = getPairContract(pairAddress, rpcProvider);
    const [reserve0, reserve1] = await pair.getReserves();
    const totalSupply = await pair.totalSupply();
    const pToken0 = await pair.token0();

    console.log(`[getPoolReserves] reserves:`, {
      reserve0: reserve0.toString(),
      reserve1: reserve1.toString(),
      totalSupply: totalSupply.toString(),
      pToken0,
    });

    const [r0, r1] = pToken0.toLowerCase() === addr0.toLowerCase()
      ? [reserve0, reserve1]
      : [reserve1, reserve0];

    return {
      reserve0: ethers.formatUnits(r0, token0.decimals),
      reserve1: ethers.formatUnits(r1, token1.decimals),
      totalSupply: ethers.formatEther(totalSupply),
      pairAddress,
    };
  } catch (err) {
    console.error(`[getPoolReserves] ERROR for ${token0Symbol}/${token1Symbol}:`, err.message);
    return { reserve0: '0', reserve1: '0', totalSupply: '0', pairAddress: null };
  }
}

export async function getUserLPBalance(token0Symbol, token1Symbol, userAddress) {
  try {
    const rpcProvider = getProvider();
    const factory = getFactoryContract(rpcProvider);
    const path = buildPath(token0Symbol, token1Symbol);

    const pairAddress = await factory.getPair(path[0], path[1]);
    if (!pairAddress || pairAddress === ethers.ZeroAddress) return '0';

    const pair = getPairContract(pairAddress, rpcProvider);
    const balance = await pair.balanceOf(userAddress);
    return ethers.formatEther(balance);
  } catch {
    return '0';
  }
}

export async function addLiquidity({ token0Symbol, token1Symbol, amount0, amount1, slippage = 0.5, userAddress }) {
  const web3Provider = await getWeb3Provider();
  const signerInstance = await web3Provider.getSigner();
  const router = getRouterContract(signerInstance);

  const token0 = TOKENS[token0Symbol];
  const token1 = TOKENS[token1Symbol];

  const amount0Parsed = ethers.parseUnits(amount0.toString(), token0.decimals);
  const amount1Parsed = ethers.parseUnits(amount1.toString(), token1.decimals);
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
  const path = buildPath(token0Symbol, token1Symbol);

  const pairAddress = await factory.getPair(path[0], path[1]);
  const pair = getPairContract(pairAddress, signerInstance);

  const lpParsed = ethers.parseEther(lpAmount.toString());
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  const allowance = await pair.allowance(userAddress, CONTRACTS.ROUTER);
  if (allowance < lpParsed) {
    const approveTx = await pair.approve(CONTRACTS.ROUTER, ethers.MaxUint256);
    await approveTx.wait();
  }

  let tx;
  if (token0.isNative || token1.isNative) {
    const tokenSymbol = token0.isNative ? token1Symbol : token0Symbol;
    const tokenAddr = TOKENS[tokenSymbol].address;
    tx = await router.removeLiquidityETH(tokenAddr, lpParsed, 0n, 0n, userAddress, deadline);
  } else {
    tx = await router.removeLiquidity(
      token0.address, token1.address,
      lpParsed, 0n, 0n, userAddress, deadline
    );
  }

  return tx.wait();
}