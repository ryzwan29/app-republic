// Token Configuration for Republic Testnet
export const NETWORK = {
  chainId: '0x12F85', // 77701 in hex
  chainIdDec: 77701,
  chainName: 'Republic Testnet',
  nativeCurrency: { name: 'RAI', symbol: 'RAI', decimals: 18 },
  rpcUrls: ['https://evm-rpc.republicai.io'],
  blockExplorerUrls: [],
};

export const COSMOS_CONFIG = {
  chainId: 'raitestnet_77701-1',
  chainName: 'Republic Testnet',
  rpc: 'https://rpc.republicai.io',
  rest: 'https://rest.republicai.io',
  bech32Prefix: 'rai',
  currencies: [{ coinDenom: 'RAI', coinMinimalDenom: 'arai', coinDecimals: 18 }],
};

// ERC-20 ABI (minimal)
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];

// AMM Router ABI (Uniswap V2-style)
export const ROUTER_ABI = [
  'function factory() external pure returns (address)',
  'function WETH() external pure returns (address)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB)',
  'function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external returns (uint amountToken, uint amountETH)',
];

// Factory ABI
export const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairs(uint) external view returns (address pair)',
  'function allPairsLength() external view returns (uint)',
];

// Pair contract — expose lpToken() untuk get LP token address
export const PAIR_CORE_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function lpToken() external view returns (address)',
];

// LP Token contract (terpisah dari Pair)
export const LP_TOKEN_ABI = [
  'function totalSupply() external view returns (uint256)',
  'function balanceOf(address) external view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

// LP Pair ABI (kept for backward compat, use PAIR_CORE_ABI + LP_TOKEN_ABI for new code)
export const PAIR_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function lpToken() external view returns (address)',
  'function totalSupply() external view returns (uint256)',
  'function balanceOf(address) external view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// Oracle ABI — tries common on-chain price oracle patterns
export const ORACLE_ABI = [
  // Style 1: single token address → uint256 price (8 decimals USD)
  'function getPrice(address token) external view returns (uint256)',
  // Style 2: asset address → uint256
  'function getAssetPrice(address asset) external view returns (uint256)',
  // Style 3: token symbol string → uint256
  'function getPriceUSD(address token) external view returns (uint256)',
  // Style 4: returns (price, decimals)
  'function getTokenPrice(address token) external view returns (uint256 price, uint8 decimals)',
  // Style 5: Chainlink aggregator style
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];

// Staking ABI
export const STAKING_ABI = [
  'function stake(address validator, uint256 amount) external',
  'function unstake(address validator, uint256 amount) external',
  'function claimReward(address validator) external',
  'function getStakedAmount(address delegator, address validator) external view returns (uint256)',
  'function getPendingReward(address delegator, address validator) external view returns (uint256)',
  'function getTotalStaked(address validator) external view returns (uint256)',
  'function getValidators() external view returns (address[] memory)',
  'function getAPR() external view returns (uint256)',
  'event Staked(address indexed delegator, address indexed validator, uint256 amount)',
  'event Unstaked(address indexed delegator, address indexed validator, uint256 amount)',
  'event RewardClaimed(address indexed delegator, address indexed validator, uint256 amount)',
];

// Faucet ABI
export const FAUCET_ABI = [
  'function claim() external',
  'function cooldownRemaining(address user) external view returns (uint256)',
  'function lifetimeRemaining(address user) external view returns (uint256 usdcLeft, uint256 usdtLeft, uint256 wbtcLeft, uint256 wethLeft)',
  'function totalClaims() external view returns (uint256)',
  'function lastClaim(address) external view returns (uint256)',
  'function paused() external view returns (bool)',
];

// Contract addresses (placeholder - to be updated with deployed addresses)
// export const CONTRACTS = {
//   USDT: '0x25DbA0f51E19dBc5BF9bFb6061334D3A5F1a9BD3',
//   USDC: '0x6fbB6b92c2445228a8b21692D347578FC57180ba',
//   WRAI: '0x0000000000000000000000000000000000000003',
//   ROUTER: '0x0000000000000000000000000000000000000004',
//   FACTORY: '0x0000000000000000000000000000000000000005',
//   STAKING: '0x0000000000000000000000000000000000000006',
//   FAUCET: '0x0000000000000000000000000000000000000007',
// };

export const CONTRACTS = {
  USDT: '0x25DbA0f51E19dBc5BF9bFb6061334D3A5F1a9BD3',
  USDC: '0x6fbB6b92c2445228a8b21692D347578FC57180ba',
  WRAI: '0x88c41A441027D81Ee8b3FB6d7A4ab87c47f942a3',
  WBTC: '0x23602761bc37714498B77cCfef6e094DEd019040',
  WETH: '0x35D22dD321ee683D42d44E7F3269B236d061F472',
  ORACLE: '0x95DFe7aefbff1d3eD34cB501d0ad23E1FaeF02c6',
  ROUTER: '0x14e18810F996433a155e9D4A08f608551c93E4Af',
  FACTORY: '0x9f417E482079Ad217aD2E96fB55c2CDf4Fb3f852',
  STAKING: '0x0000000000000000000000000000000000000006',
  FAUCET: '0xdB7e012f6E3e6eD357D10bf39b9ca75C6fE8dFA1',
};


export const TOKENS = {
  RAI: {
    symbol: 'RAI',
    name: 'RAI',
    decimals: 18,
    address: 'native',
    logo: '/tokens/RAI.png',
    color: '#2563eb',
    isNative: true,
  },
  USDT: {
    symbol: 'USDT',
    name: 'USD Tether',
    decimals: 6,
    address: CONTRACTS.USDT,
    logo: '/tokens/USDT.png',
    color: '#26a17b',
    isNative: false,
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    address: CONTRACTS.USDC,
    logo: '/tokens/USDC.png',
    color: '#2775ca',
    isNative: false,
  },
  WRAI: {
    symbol: 'WRAI',
    name: 'Wrapped RAI',
    decimals: 18,
    address: CONTRACTS.WRAI,
    logo: '/tokens/WRAI.png',
    color: '#3b82f6',
    isNative: false,
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    decimals: 8,
    address: CONTRACTS.WBTC,
    logo: '/tokens/WBTC.png',
    color: '#f7931a',
    isNative: false,
  },
  WETH: {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    address: CONTRACTS.WETH,
    logo: '/tokens/WETH.png',
    color: '#627eea',
    isNative: false,
  },
};

export const TOKEN_LIST = Object.values(TOKENS);

// Semua kombinasi swap didukung via WRAI routing
export const SWAP_PAIRS = [
  { from: 'RAI',  to: 'USDT' }, { from: 'RAI',  to: 'USDC' },
  { from: 'RAI',  to: 'WBTC' }, { from: 'RAI',  to: 'WETH' },
  { from: 'USDT', to: 'RAI'  }, { from: 'USDT', to: 'USDC' },
  { from: 'USDT', to: 'WBTC' }, { from: 'USDT', to: 'WETH' },
  { from: 'USDC', to: 'RAI'  }, { from: 'USDC', to: 'USDT' },
  { from: 'USDC', to: 'WBTC' }, { from: 'USDC', to: 'WETH' },
  { from: 'WBTC', to: 'RAI'  }, { from: 'WBTC', to: 'USDT' },
  { from: 'WBTC', to: 'USDC' }, { from: 'WBTC', to: 'WETH' },
  { from: 'WETH', to: 'RAI'  }, { from: 'WETH', to: 'USDT' },
  { from: 'WETH', to: 'USDC' }, { from: 'WETH', to: 'WBTC' },
  { from: 'WRAI', to: 'USDT' }, { from: 'WRAI', to: 'USDC' },
  { from: 'WRAI', to: 'WBTC' }, { from: 'WRAI', to: 'WETH' },
];

export const POOL_PAIRS = [
  { token0: 'WRAI', token1: 'USDT', fee: '0.3%' },
  { token0: 'WRAI', token1: 'USDC', fee: '0.3%' },
  { token0: 'WRAI', token1: 'WBTC', fee: '0.3%' },
  { token0: 'WRAI', token1: 'WETH', fee: '0.3%' },
];

export const SWAP_FEE = 0.003; // 0.3%
export const LP_FEE = 0.002;   // 0.2% to LPs
export const DEV_FEE = 0.001;  // 0.1% to treasury