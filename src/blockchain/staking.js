import { ethers } from 'ethers';
import { SigningStargateClient, GasPrice } from '@cosmjs/stargate';
import { getProvider, getWeb3Provider } from './evm.js';
import { CONTRACTS, STAKING_ABI } from './tokens.js';
import { getValidators as getCosmosValidators, getStakingPool } from './cosmos.js';

// ─── Chain config — sesuaikan dengan chain kalian ────────────────────────────
const CHAIN_ID = 'raitestnet_77701-1';
const DENOM = 'arai';
const RPC_ENDPOINT = 'https://rpc.republicai.io';
const REST_ENDPOINT = 'https://rest.republicai.io'; // sesuaikan

const KEPLR_CHAIN_CONFIG = {
  chainId: CHAIN_ID,
  chainName: 'Republic Testnet',
  rpc: RPC_ENDPOINT,
  rest: REST_ENDPOINT,
  bip44: { coinType: 60 }, // ✅ EVM-Cosmos wajib 60, bukan 118
  bech32Config: {
    bech32PrefixAccAddr: 'rai',
    bech32PrefixAccPub: 'raipub',
    bech32PrefixValAddr: 'raivaloper',
    bech32PrefixValPub: 'raivaloperpub',
    bech32PrefixConsAddr: 'raivalcons',
    bech32PrefixConsPub: 'raivalconspub',
  },
  currencies: [{ coinDenom: 'RAI', coinMinimalDenom: DENOM, coinDecimals: 18 }],
  feeCurrencies: [{
    coinDenom: 'RAI',
    coinMinimalDenom: DENOM,
    coinDecimals: 18,
    gasPriceStep: { low: 10000000000, average: 20000000000, high: 40000000000 },
  }],
  stakeCurrency: { coinDenom: 'RAI', coinMinimalDenom: DENOM, coinDecimals: 18 },
};

const COSMOS_FEE = {
  amount: [{ denom: DENOM, amount: '200000000000000000' }],
  gas: '300000',
};

function getStakingContract(signerOrProvider) {
  return new ethers.Contract(CONTRACTS.STAKING, STAKING_ABI, signerOrProvider);
}

// ─── Keplr CosmJS signer helper ──────────────────────────────────────────────
async function getKeplrSigningClient() {
  const keplr = window.keplr;
  if (!keplr) throw new Error('Keplr wallet not found. Please install Keplr extension.');

  // Suggest chain supaya Keplr kenal chain ini dengan coinType 60
  try { await keplr.experimentalSuggestChain(KEPLR_CHAIN_CONFIG); } catch {}

  await keplr.enable(CHAIN_ID);

  // ✅ getOfflineSignerOnlyAmino — wajib untuk EVM-Cosmos
  // Kalau pakai getOfflineSigner biasa → error "unable to resolve type ethsecp256k1.PubKey"
  const offlineSigner = keplr.getOfflineSignerOnlyAmino(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  if (!accounts.length) throw new Error('No accounts found in Keplr');

  const client = await SigningStargateClient.connectWithSigner(
    RPC_ENDPOINT,
    offlineSigner,
    { gasPrice: GasPrice.fromString(`20000000000${DENOM}`) }
  );

  return { client, address: accounts[0].address };
}

// ─── Validator list ───────────────────────────────────────────────────────────

// ─── Validator cache ──────────────────────────────────────────────────────────
let _validatorCache = null;
let _validatorCacheTime = 0;
let _validatorFetchPromise = null;
const CACHE_TTL = 60_000; // 1 menit

export async function prefetchValidators() {
  // Kalau udah ada cache fresh, skip
  if (_validatorCache && Date.now() - _validatorCacheTime < CACHE_TTL) return;
  // Kalau lagi fetch, tunggu yang udah jalan
  if (_validatorFetchPromise) return _validatorFetchPromise;
  _validatorFetchPromise = _fetchAndCacheValidators();
  try { await _validatorFetchPromise; } finally { _validatorFetchPromise = null; }
}

async function _fetchAndCacheValidators() {
  const validators = await getCosmosValidators();
  if (!validators.length) { _validatorCache = []; return; }

  const activeValidators = validators.filter(
    (v) => v.status === 'BOND_STATUS_BONDED' && v.jailed === false
  );
  if (!activeValidators.length) { _validatorCache = []; return; }

  const rpcProvider = getProvider();
  const staking = getStakingContract(rpcProvider);

  const enriched = await Promise.all(
    activeValidators.map(async (val) => {
      let totalStaked = '0';
      try {
        const staked = await staking.getTotalStaked(val.address);
        totalStaked = ethers.formatEther(staked);
      } catch {}
      return {
        ...val,
        totalStaked,
        votingPower: (parseFloat(val.tokens) / 1e18).toFixed(2),
      };
    })
  );

  _validatorCache = enriched.sort((a, b) => parseFloat(b.tokens) - parseFloat(a.tokens));
  _validatorCacheTime = Date.now();
}

export async function getValidators() {
  // Pakai cache kalau tersedia dan masih fresh
  if (_validatorCache && Date.now() - _validatorCacheTime < CACHE_TTL) {
    return _validatorCache;
  }
  // Kalau lagi prefetch, tunggu
  if (_validatorFetchPromise) {
    await _validatorFetchPromise;
    return _validatorCache || [];
  }
  // Fetch fresh
  await prefetchValidators();
  return _validatorCache || [];
}

export async function getUserStakeInfo(userAddress, validatorAddress) {
  const rpcProvider = getProvider();
  try {
    const staking = getStakingContract(rpcProvider);
    const [stakedAmount, pendingReward] = await Promise.all([
      staking.getStakedAmount(userAddress, validatorAddress),
      staking.getPendingReward(userAddress, validatorAddress),
    ]);
    return {
      stakedAmount: ethers.formatEther(stakedAmount),
      pendingReward: ethers.formatEther(pendingReward),
    };
  } catch {
    return { stakedAmount: '0', pendingReward: '0' };
  }
}

export async function getStakingAPR() {
  try {
    const rpcProvider = getProvider();
    const staking = getStakingContract(rpcProvider);
    const apr = await staking.getAPR();
    return (Number(apr) / 100).toFixed(2);
  } catch {
    try {
      const pool = await getStakingPool();
      const bonded = parseFloat(pool.bondedTokens) / 1e18;
      if (bonded > 0) return '12.50';
    } catch {}
    return '12.50';
  }
}

export async function getTotalUserStaked(userAddress) {
  const rpcProvider = getProvider();
  try {
    const staking = getStakingContract(rpcProvider);
    const validators = await staking.getValidators();
    let total = 0n;
    for (const v of validators) {
      try {
        const amount = await staking.getStakedAmount(userAddress, v);
        total += amount;
      } catch {}
    }
    return ethers.formatEther(total);
  } catch {
    return '0';
  }
}

// ─── Stake ────────────────────────────────────────────────────────────────────
// walletType: 'keplr' | 'evm'
export async function stake(validatorAddress, amount, walletType = 'evm') {
  if (walletType === 'keplr') {
    const { client, address } = await getKeplrSigningClient();
    const amountInArai = (parseFloat(amount) * 1e18).toFixed(0);
    const result = await client.delegateTokens(
      address,
      validatorAddress,
      { denom: DENOM, amount: amountInArai },
      COSMOS_FEE
    );
    if (result.code !== 0) throw new Error(result.rawLog || 'Delegate failed');
    return result;
  }

  // EVM path via smart contract
  const web3Provider = await getWeb3Provider();
  const signerInstance = await web3Provider.getSigner();
  const staking = getStakingContract(signerInstance);
  const amountParsed = ethers.parseEther(amount.toString());
  const tx = await staking.stake(validatorAddress, amountParsed);
  return tx.wait();
}

// ─── Unstake ──────────────────────────────────────────────────────────────────
export async function unstake(validatorAddress, amount, walletType = 'evm') {
  if (walletType === 'keplr') {
    const { client, address } = await getKeplrSigningClient();
    const amountInArai = (parseFloat(amount) * 1e18).toFixed(0);
    const result = await client.undelegateTokens(
      address,
      validatorAddress,
      { denom: DENOM, amount: amountInArai },
      COSMOS_FEE
    );
    if (result.code !== 0) throw new Error(result.rawLog || 'Undelegate failed');
    return result;
  }

  const web3Provider = await getWeb3Provider();
  const signerInstance = await web3Provider.getSigner();
  const staking = getStakingContract(signerInstance);
  const amountParsed = ethers.parseEther(amount.toString());
  const tx = await staking.unstake(validatorAddress, amountParsed);
  return tx.wait();
}

// ─── Claim reward ─────────────────────────────────────────────────────────────
export async function claimReward(validatorAddress, walletType = 'evm') {
  if (walletType === 'keplr') {
    const { client, address } = await getKeplrSigningClient();
    const result = await client.withdrawRewards(address, validatorAddress, COSMOS_FEE);
    if (result.code !== 0) throw new Error(result.rawLog || 'Withdraw rewards failed');
    return result;
  }

  const web3Provider = await getWeb3Provider();
  const signerInstance = await web3Provider.getSigner();
  const staking = getStakingContract(signerInstance);
  const tx = await staking.claimReward(validatorAddress);
  return tx.wait();
}