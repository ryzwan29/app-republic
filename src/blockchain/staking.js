import { ethers } from 'ethers';
import { SigningStargateClient, GasPrice } from '@cosmjs/stargate';
import { getProvider, getWeb3Provider } from './evm.js';
import { CONTRACTS, STAKING_ABI } from './tokens.js';
import { getValidators as getCosmosValidators, getStakingPool, getAnnualProvisions, getInflation } from './cosmos.js';
import { getActiveRPC, fetchWithFallback, withEVMFallback } from './rpcFallback.js';

// ─── Chain config ─────────────────────────────────────────────────────────────
const CHAIN_ID = 'raitestnet_77701-1';
const DENOM = 'arai';
const DENOM_EXPONENT = 18;
// Endpoint aktif di-resolve saat runtime via rpcFallback.js
const RPC_ENDPOINT_DEFAULT = 'https://rpc.republicai.io';

const KEPLR_CHAIN_CONFIG = {
  chainId: CHAIN_ID,
  chainName: 'Republic Testnet',
  rpc: RPC_ENDPOINT_DEFAULT,
  rest: 'https://rest.republicai.io',
  bip44: { coinType: 60 }, // ✅ EVM-Cosmos wajib 60
  bech32Config: {
    bech32PrefixAccAddr: 'rai',
    bech32PrefixAccPub: 'raipub',
    bech32PrefixValAddr: 'raivaloper',
    bech32PrefixValPub: 'raivaloperpub',
    bech32PrefixConsAddr: 'raivalcons',
    bech32PrefixConsPub: 'raivalconspub',
  },
  currencies: [{ coinDenom: 'RAI', coinMinimalDenom: DENOM, coinDecimals: DENOM_EXPONENT }],
  feeCurrencies: [{
    coinDenom: 'RAI',
    coinMinimalDenom: DENOM,
    coinDecimals: DENOM_EXPONENT,
    gasPriceStep: { low: 10000000000, average: 20000000000, high: 40000000000 },
  }],
  stakeCurrency: { coinDenom: 'RAI', coinMinimalDenom: DENOM, coinDecimals: DENOM_EXPONENT },
  // ✅ FIX 1: Wajib untuk EVM-Cosmos — tanpa ini Keplr tidak pakai eth key
  features: ['eth-address-gen', 'eth-key-sign'],
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

  // Resolve RPC aktif saat runtime — fallback kalau provider utama down
  const activeRpc = await getActiveRPC().catch(() => RPC_ENDPOINT_DEFAULT);

  try { await keplr.experimentalSuggestChain({ ...KEPLR_CHAIN_CONFIG, rpc: activeRpc }); } catch {}
  await keplr.enable(CHAIN_ID);

  // ✅ FIX 2: getOfflineSignerOnlyAmino — WAJIB untuk EVM-Cosmos chain
  // getOfflineSigner biasa → Direct/Protobuf sign → embed pubkey typeURL di SignDoc
  // → error "unable to resolve /ethermint.crypto.v1.ethsecp256k1.PubKey"
  // Amino sign tidak embed typeURL → error hilang sepenuhnya
  const offlineSigner = keplr.getOfflineSignerOnlyAmino(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  if (!accounts.length) throw new Error('No accounts found in Keplr');

  // ✅ FIX 3: Custom signer wrapper — safety net kalau Keplr return algo unexpected
  // Hardcode algo ke ethsecp256k1 dan bypass CosmJS dengan signAmino langsung ke Keplr
  const key = await keplr.getKey(CHAIN_ID);
  let signer = offlineSigner;
  if (accounts[0]?.algo !== 'ethsecp256k1') {
    signer = {
      getAccounts: async () => [{
        address: accounts[0].address,
        algo: 'ethsecp256k1',
        pubkey: key.pubKey,
      }],
      signAmino: async (signerAddress, signDoc) => {
        return keplr.signAmino(CHAIN_ID, signerAddress, signDoc);
      },
    };
  }

  const client = await SigningStargateClient.connectWithSigner(
    activeRpc,
    signer,
    { gasPrice: GasPrice.fromString(`20000000000${DENOM}`) }
  );

  return { client, address: accounts[0].address };
}

// ─── Validator cache ──────────────────────────────────────────────────────────
let _validatorCache = null;
let _validatorCacheTime = 0;
let _validatorFetchPromise = null;
const CACHE_TTL = 60_000;

export async function prefetchValidators() {
  if (_validatorCache && Date.now() - _validatorCacheTime < CACHE_TTL) return;
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
  if (_validatorCache && Date.now() - _validatorCacheTime < CACHE_TTL) {
    return _validatorCache;
  }
  if (_validatorFetchPromise) {
    await _validatorFetchPromise;
    return _validatorCache || [];
  }
  await prefetchValidators();
  return _validatorCache || [];
}

// ─── getUserStakeInfo — dual path: Cosmos REST (Keplr) atau EVM contract ──────
// ✅ FIX 4: Keplr pakai bech32 address (rai1...) — EVM contract butuh hex (0x...)
// Cross-query antara keduanya selalu return 0 karena format address beda

async function getUserStakeInfoCosmos(walletAddress, validatorAddress) {
  try {
    const [delData, rewData] = await Promise.all([
      fetchWithFallback(`/cosmos/staking/v1beta1/delegations/${walletAddress}`),
      fetchWithFallback(`/cosmos/distribution/v1beta1/delegators/${walletAddress}/rewards/${validatorAddress}`),
    ]);

    const delegation = delData.delegation_responses?.find(
      (d) => d.delegation.validator_address === validatorAddress
    );
    const stakedArai = delegation?.balance?.amount || '0';
    const stakedAmount = (parseFloat(stakedArai) / 10 ** DENOM_EXPONENT).toString();

    const raiReward = rewData.rewards?.find((r) => r.denom === DENOM);
    const rewardArai = raiReward?.amount || '0';
    const pendingReward = (parseFloat(rewardArai) / 10 ** DENOM_EXPONENT).toString();

    return { stakedAmount, pendingReward };
  } catch {
    return { stakedAmount: '0', pendingReward: '0' };
  }
}

async function getUserStakeInfoEVM(userAddress, validatorAddress) {
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

// walletType: 'keplr' | 'evm' | null
export async function getUserStakeInfo(userAddress, validatorAddress, walletType = 'evm') {
  if (!userAddress) return { stakedAmount: '0', pendingReward: '0' };
  if (walletType === 'keplr') {
    return getUserStakeInfoCosmos(userAddress, validatorAddress);
  }
  return getUserStakeInfoEVM(userAddress, validatorAddress);
}

export async function getStakingAPR() {
  try {
    // Ambil annual_provisions + bonded_tokens dari Cosmos REST
    // APR = annual_provisions / bonded_tokens * 100
    // Ini APR gross sebelum dikurangi commission validator
    const [pool, annualProvisions] = await Promise.all([
      getStakingPool(),
      getAnnualProvisions(),
    ]);

    const bonded = parseFloat(pool.bondedTokens);
    const provisions = parseFloat(annualProvisions);

    if (bonded > 0 && provisions > 0) {
      const apr = (provisions / bonded) * 100;
      return apr.toFixed(2);
    }

    // Fallback: hitung dari inflation rate kalau annual_provisions kosong
    const inflation = await getInflation();
    const inflationRate = parseFloat(inflation);
    if (inflationRate > 0 && bonded > 0) {
      // Perlu total supply untuk hitung dari inflation
      // APR ≈ inflation_rate * (total_supply / bonded_tokens) * 100
      const supplyData = await fetchWithFallback('/cosmos/bank/v1beta1/supply/by_denom?denom=arai');
      const totalSupply = parseFloat(supplyData.amount?.amount || '0');
      if (totalSupply > 0) {
        const apr = inflationRate * (totalSupply / bonded) * 100;
        return apr.toFixed(2);
      }
    }
  } catch {}

  return '0.00';
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
export async function stake(validatorAddress, amount, walletType = 'evm') {
  if (walletType === 'keplr') {
    const { client, address } = await getKeplrSigningClient();
    const amountInArai = (parseFloat(amount) * 10 ** DENOM_EXPONENT).toFixed(0);
    const result = await client.delegateTokens(
      address,
      validatorAddress,
      { denom: DENOM, amount: amountInArai },
      COSMOS_FEE
    );
    if (result.code !== 0) throw new Error(result.rawLog || 'Delegate failed');
    return result;
  }

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
    const amountInArai = (parseFloat(amount) * 10 ** DENOM_EXPONENT).toFixed(0);
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