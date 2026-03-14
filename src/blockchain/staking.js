import { ethers } from 'ethers';
import { SigningStargateClient, GasPrice } from '@cosmjs/stargate';
import { fromBech32, toBech32 } from '@cosmjs/encoding';
import { getProvider, getWeb3Provider } from './evm.js';
import { CONTRACTS, STAKING_ABI } from './tokens.js';
import { getValidators as getCosmosValidators, getStakingPool, getAnnualProvisions, getInflation } from './cosmos.js';
import { getActiveRPC, getActiveAPI, fetchWithFallback, withEVMFallback } from './rpcFallback.js';

// ─── Chain config ─────────────────────────────────────────────────────────────
const CHAIN_ID       = 'raitestnet_77701-1';
const DENOM          = 'arai';
const DENOM_EXP      = 18;
const BECH32_PREFIX  = 'rai';
const VALOPER_PREFIX = 'raivaloper';
const RPC_FALLBACK   = 'https://rpc.republicai.io';
const REST_FALLBACK  = 'https://rest.republicai.io';

// ─── Dynamic fee helper ───────────────────────────────────────────────────────
// gasMultiplier > 1 untuk batch tx (claim all, withdraw all, dll)
function makeFee(gasMultiplier = 1) {
  const gas    = Math.ceil(300_000 * gasMultiplier);
  // gas price: 20 Gwei = 20_000_000_000
  const feeAmt = Math.ceil(20_000_000_000 * gas).toString();
  return {
    amount: [{ denom: DENOM, amount: feeAmt }],
    gas: gas.toString(),
  };
}

// ─── Keplr chain config builder ──────────────────────────────────────────────
function buildKeplrChainConfig(rpc, rest) {
  return {
    chainId: CHAIN_ID,
    chainName: 'Republic Testnet',
    rpc,
    rest,
    // ✅ WAJIB: coinType 60 = Ethereum derivation path
    // Tanpa ini Keplr generate key secp256k1 biasa (Cosmos) bukan ethsecp256k1 (EVM)
    bip44: { coinType: 60 },
    bech32Config: {
      bech32PrefixAccAddr:  BECH32_PREFIX,
      bech32PrefixAccPub:   `${BECH32_PREFIX}pub`,
      bech32PrefixValAddr:  VALOPER_PREFIX,
      bech32PrefixValPub:   `${VALOPER_PREFIX}pub`,
      bech32PrefixConsAddr: `${BECH32_PREFIX}valcons`,
      bech32PrefixConsPub:  `${BECH32_PREFIX}valconspub`,
    },
    currencies:    [{ coinDenom: 'RAI', coinMinimalDenom: DENOM, coinDecimals: DENOM_EXP }],
    feeCurrencies: [{
      coinDenom: 'RAI', coinMinimalDenom: DENOM, coinDecimals: DENOM_EXP,
      // gasPriceStep dalam satuan awei (base denom), bukan RAI
      gasPriceStep: { low: 10_000_000_000, average: 20_000_000_000, high: 40_000_000_000 },
    }],
    stakeCurrency: { coinDenom: 'RAI', coinMinimalDenom: DENOM, coinDecimals: DENOM_EXP },
    // ✅ WAJIB: features ini trigger Keplr untuk pakai eth-key (ethsecp256k1)
    features: ['eth-address-gen', 'eth-key-sign'],
  };
}

// ─── Keplr CosmJS signing client ─────────────────────────────────────────────
//
// ROOT CAUSE error "unable to resolve type URL /ethermint.crypto.v1.ethsecp256k1.PubKey":
//
// getOfflineSigner()         → DIRECT/Protobuf signing
//   AuthInfo embed pubkey sebagai: google.protobuf.Any { typeUrl: "/ethermint.crypto...." }
//   CosmJS registry default tidak kenal typeUrl ini → ERROR ❌
//
// getOfflineSignerOnlyAmino() → AMINO/Legacy signing
//   Pubkey dikirim sebagai raw bytes, TIDAK di-wrap ke Any{}
//   typeUrl tidak pernah di-lookup → error hilang ✅
//
export async function getKeplrSigningClient() {
  const keplr = window.keplr;
  if (!keplr) throw new Error('Keplr wallet not found. Please install the Keplr extension.');

  // Resolve endpoint aktif saat runtime — fallback otomatis kalau provider utama down
  const [activeRpc, activeRest] = await Promise.all([
    getActiveRPC().catch(() => RPC_FALLBACK),
    getActiveAPI().catch(() => REST_FALLBACK),
  ]);

  try {
    await keplr.experimentalSuggestChain(buildKeplrChainConfig(activeRpc, activeRest));
  } catch { /* chain sudah ada di Keplr, lanjut */ }

  await keplr.enable(CHAIN_ID);

  // ✅ FIX 1: getOfflineSignerOnlyAmino — AMINO mode, bukan DIRECT
  const offlineSigner = keplr.getOfflineSignerOnlyAmino(CHAIN_ID);
  const accounts      = await offlineSigner.getAccounts();
  if (!accounts.length) throw new Error('No accounts found in Keplr.');

  // ✅ FIX 2: Safety net kalau Keplr return algo yang tidak expected
  const key = await keplr.getKey(CHAIN_ID);
  let signer = offlineSigner;
  if (accounts[0]?.algo !== 'ethsecp256k1') {
    signer = {
      getAccounts: async () => [{
        address:  accounts[0].address,
        algo:     'ethsecp256k1',
        pubkey:   key.pubKey,
      }],
      signAmino: (signerAddr, signDoc) =>
        keplr.signAmino(CHAIN_ID, signerAddr, signDoc),
    };
  }

  const client = await SigningStargateClient.connectWithSigner(
    activeRpc,
    signer,
    { gasPrice: GasPrice.fromString(`20000000000${DENOM}`) }
  );

  return { client, address: accounts[0].address };
}

// ─── EVM staking contract ─────────────────────────────────────────────────────
function getStakingContract(signerOrProvider) {
  return new ethers.Contract(CONTRACTS.STAKING, STAKING_ABI, signerOrProvider);
}

// ─── Validator cache ──────────────────────────────────────────────────────────
let _validatorCache   = null;
let _validatorCacheAt = 0;
let _validatorFetchPr = null;
const CACHE_TTL       = 60_000;

export async function prefetchValidators() {
  if (_validatorCache && Date.now() - _validatorCacheAt < CACHE_TTL) return;
  if (_validatorFetchPr) return _validatorFetchPr;
  _validatorFetchPr = _fetchAndCache();
  try { await _validatorFetchPr; } finally { _validatorFetchPr = null; }
}

async function _fetchAndCache() {
  const validators = await getCosmosValidators();
  const active     = validators.filter((v) => v.status === 'BOND_STATUS_BONDED' && !v.jailed);
  if (!active.length) { _validatorCache = []; return; }

  const rpcProvider = getProvider();
  const staking     = getStakingContract(rpcProvider);

  const enriched = await Promise.all(active.map(async (val) => {
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
  }));

  _validatorCache   = enriched.sort((a, b) => parseFloat(b.tokens) - parseFloat(a.tokens));
  _validatorCacheAt = Date.now();
}

export async function getValidators() {
  if (_validatorCache && Date.now() - _validatorCacheAt < CACHE_TTL) return _validatorCache;
  if (_validatorFetchPr) { await _validatorFetchPr; return _validatorCache || []; }
  await prefetchValidators();
  return _validatorCache || [];
}

// ─── getUserStakeInfo — single validator ──────────────────────────────────────
async function getUserStakeInfoCosmos(walletAddress, validatorAddress) {
  try {
    const [delData, rewData] = await Promise.all([
      fetchWithFallback(`/cosmos/staking/v1beta1/delegations/${walletAddress}`),
      fetchWithFallback(`/cosmos/distribution/v1beta1/delegators/${walletAddress}/rewards/${validatorAddress}`),
    ]);
    const delegation   = delData.delegation_responses?.find(
      (d) => d.delegation.validator_address === validatorAddress
    );
    const stakedAmount = delegation
      ? (parseFloat(delegation.balance.amount) / 10 ** DENOM_EXP).toString()
      : '0';
    const raiReward   = rewData.rewards?.find((r) => r.denom === DENOM);
    const pendingReward = raiReward
      ? (parseFloat(raiReward.amount) / 10 ** DENOM_EXP).toString()
      : '0';
    return { stakedAmount, pendingReward };
  } catch {
    return { stakedAmount: '0', pendingReward: '0' };
  }
}

async function getUserStakeInfoEVM(userAddress, validatorAddress) {
  const rpcProvider = getProvider();
  try {
    const staking = getStakingContract(rpcProvider);
    const [staked, reward] = await Promise.all([
      staking.getStakedAmount(userAddress, validatorAddress),
      staking.getPendingReward(userAddress, validatorAddress),
    ]);
    return {
      stakedAmount:  ethers.formatEther(staked),
      pendingReward: ethers.formatEther(reward),
    };
  } catch {
    return { stakedAmount: '0', pendingReward: '0' };
  }
}

export async function getUserStakeInfo(userAddress, validatorAddress, walletType = 'evm') {
  if (!userAddress) return { stakedAmount: '0', pendingReward: '0' };
  return walletType === 'keplr'
    ? getUserStakeInfoCosmos(userAddress, validatorAddress)
    : getUserStakeInfoEVM(userAddress, validatorAddress);
}

// ─── getAllUserDelegations — ambil SEMUA delegasi sekaligus (2 API call) ──────
// Lebih efisien dari getUserStakeInfo yang dipanggil per validator (N calls)
// Return: { [validatorAddress]: { stakedAmount: string, pendingReward: string } }
export async function getAllUserDelegations(cosmosAddress) {
  if (!cosmosAddress) return {};
  try {
    const [delData, rewData] = await Promise.all([
      fetchWithFallback(`/cosmos/staking/v1beta1/delegations/${cosmosAddress}`),
      fetchWithFallback(`/cosmos/distribution/v1beta1/delegators/${cosmosAddress}/rewards`),
    ]);

    const delegations   = delData.delegation_responses || [];
    const rewardsPerVal = rewData.rewards || [];

    const result = {};
    for (const del of delegations) {
      const valAddr   = del.delegation.validator_address;
      const staked    = (parseFloat(del.balance.amount) / 10 ** DENOM_EXP).toString();
      const valReward = rewardsPerVal.find((r) => r.validator_address === valAddr);
      const raiRew    = valReward?.reward?.find((r) => r.denom === DENOM);
      const pending   = raiRew
        ? (parseFloat(raiRew.amount) / 10 ** DENOM_EXP).toString()
        : '0';
      result[valAddr] = { stakedAmount: staked, pendingReward: pending };
    }
    return result;
  } catch {
    return {};
  }
}

// ─── Staking APR ─────────────────────────────────────────────────────────────
export async function getStakingAPR() {
  try {
    const [pool, annualProvisions] = await Promise.all([getStakingPool(), getAnnualProvisions()]);
    const bonded     = parseFloat(pool.bondedTokens);
    const provisions = parseFloat(annualProvisions);
    if (bonded > 0 && provisions > 0) return ((provisions / bonded) * 100).toFixed(2);

    const inflation     = await getInflation();
    const inflationRate = parseFloat(inflation);
    if (inflationRate > 0 && bonded > 0) {
      const supplyData  = await fetchWithFallback('/cosmos/bank/v1beta1/supply/by_denom?denom=arai');
      const totalSupply = parseFloat(supplyData.amount?.amount || '0');
      if (totalSupply > 0) return (inflationRate * (totalSupply / bonded) * 100).toFixed(2);
    }
  } catch {}
  return '0.00';
}

export async function getTotalUserStaked(userAddress) {
  const rpcProvider = getProvider();
  try {
    const staking    = getStakingContract(rpcProvider);
    const validators = await staking.getValidators();
    let total = 0n;
    for (const v of validators) {
      try { total += await staking.getStakedAmount(userAddress, v); } catch {}
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
    const amountInArai = (parseFloat(amount) * 10 ** DENOM_EXP).toFixed(0);
    const result = await client.delegateTokens(
      address, validatorAddress,
      { denom: DENOM, amount: amountInArai },
      makeFee()
    );
    if (result.code !== 0) throw new Error(result.rawLog || 'Delegate failed');
    return result;
  }
  const web3Provider = await getWeb3Provider();
  const signer       = await web3Provider.getSigner();
  const staking      = getStakingContract(signer);
  const tx           = await staking.stake(validatorAddress, ethers.parseEther(amount.toString()));
  return tx.wait();
}

// ─── Unstake ──────────────────────────────────────────────────────────────────
export async function unstake(validatorAddress, amount, walletType = 'evm') {
  if (walletType === 'keplr') {
    const { client, address } = await getKeplrSigningClient();
    const amountInArai = (parseFloat(amount) * 10 ** DENOM_EXP).toFixed(0);
    const result = await client.undelegateTokens(
      address, validatorAddress,
      { denom: DENOM, amount: amountInArai },
      makeFee()
    );
    if (result.code !== 0) throw new Error(result.rawLog || 'Undelegate failed');
    return result;
  }
  const web3Provider = await getWeb3Provider();
  const signer       = await web3Provider.getSigner();
  const staking      = getStakingContract(signer);
  const tx           = await staking.unstake(validatorAddress, ethers.parseEther(amount.toString()));
  return tx.wait();
}

// ─── Claim reward (single validator) ─────────────────────────────────────────
export async function claimReward(validatorAddress, walletType = 'evm') {
  if (walletType === 'keplr') {
    const { client, address } = await getKeplrSigningClient();
    const result = await client.withdrawRewards(address, validatorAddress, makeFee());
    if (result.code !== 0) throw new Error(result.rawLog || 'Withdraw rewards failed');
    return result;
  }
  const web3Provider = await getWeb3Provider();
  const signer       = await web3Provider.getSigner();
  const staking      = getStakingContract(signer);
  const tx           = await staking.claimReward(validatorAddress);
  return tx.wait();
}

// ─── Claim ALL rewards (semua validator sekaligus) ────────────────────────────
// validatorAddresses: string[] — daftar valoper address yang user delegasi
export async function claimAllRewards(validatorAddresses) {
  if (!validatorAddresses?.length) throw new Error('No delegations found to claim.');

  const { client, address } = await getKeplrSigningClient();

  const msgs = validatorAddresses.map((valAddr) => ({
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
    value: { delegatorAddress: address, validatorAddress: valAddr },
  }));

  // Scale gas untuk batch: base 300k + 100k per validator extra
  const gasMultiplier = Math.min(1 + (msgs.length - 1) * 0.35, 3);
  const result = await client.signAndBroadcast(address, msgs, makeFee(gasMultiplier));
  if (result.code !== 0) throw new Error(result.rawLog || 'Claim all rewards failed');
  return result;
}

// ─── Redelegate ───────────────────────────────────────────────────────────────
export async function redelegate(srcValidatorAddress, dstValidatorAddress, amount, walletType = 'evm') {
  if (walletType !== 'keplr') throw new Error('Redelegate hanya tersedia untuk Keplr wallet.');

  const { client, address } = await getKeplrSigningClient();
  const amountInArai = (parseFloat(amount) * 10 ** DENOM_EXP).toFixed(0);

  const msg = {
    typeUrl: '/cosmos.staking.v1beta1.MsgBeginRedelegate',
    value: {
      delegatorAddress:    address,
      validatorSrcAddress: srcValidatorAddress,
      validatorDstAddress: dstValidatorAddress,
      amount: { denom: DENOM, amount: amountInArai },
    },
  };

  const result = await client.signAndBroadcast(address, [msg], makeFee(1.2));
  if (result.code !== 0) throw new Error(result.rawLog || 'Redelegate failed');
  return result;
}

// ─── Cek apakah wallet adalah operator validator ──────────────────────────────
//
// CARA LAMA (lambat, N+1 API calls):
//   Fetch semua validator → loop → cek self-delegation satu per satu
//
// CARA BARU (cepat, 1-2 API calls):
//   Pada EVM-Cosmos coinType 60, bytes underlying dari rai1... dan raivaloper1...
//   adalah IDENTIK — hanya bech32 prefix yang berbeda.
//   Konversi langsung, query 1 endpoint, selesai. ✅
//
export async function getValidatorInfoByDelegator(cosmosAddress) {
  try {
    // Konversi rai1... → raivaloper1... (bytes sama, prefix beda)
    const { data }        = fromBech32(cosmosAddress);
    const operatorAddress = toBech32(VALOPER_PREFIX, data);

    // Query validator endpoint langsung — jika tidak ada, bukan validator
    const valData = await fetchWithFallback(
      `/cosmos/staking/v1beta1/validators/${operatorAddress}`
    ).catch(() => null);

    if (!valData?.validator) return { isValidator: false };

    const val = valData.validator;

    // Ambil pending commission sekaligus
    const commissionData = await fetchWithFallback(
      `/cosmos/distribution/v1beta1/validators/${operatorAddress}/commission`
    ).catch(() => null);

    const raiCommission = commissionData?.commission?.commission?.find((c) => c.denom === DENOM);
    const pendingCommission = raiCommission
      ? (parseFloat(raiCommission.amount) / 10 ** DENOM_EXP).toFixed(6)
      : '0';

    return {
      isValidator: true,
      operatorAddress,
      moniker:    val.description?.moniker || 'My Validator',
      commission: parseFloat(val.commission?.commission_rates?.rate || 0) * 100,
      status:     val.status,
      jailed:     val.jailed,
      tokens:     val.tokens,
      pendingCommission,
    };
  } catch {
    return { isValidator: false };
  }
}

// ─── Withdraw validator commission ────────────────────────────────────────────
export async function withdrawValidatorCommission(validatorOperatorAddress) {
  const { client, address } = await getKeplrSigningClient();
  const msg = {
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission',
    value: { validatorAddress: validatorOperatorAddress },
  };
  const result = await client.signAndBroadcast(address, [msg], makeFee());
  if (result.code !== 0) throw new Error(result.rawLog || 'Withdraw commission failed');
  return result;
}

// ─── Withdraw ALL rewards + commission dalam 1 tx ────────────────────────────
// operatorAddress: opsional — hanya diisi jika wallet adalah validator
export async function withdrawAllRewardsAndCommission(validatorAddresses, operatorAddress) {
  const { client, address } = await getKeplrSigningClient();

  const msgs = validatorAddresses.map((valAddr) => ({
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
    value: { delegatorAddress: address, validatorAddress: valAddr },
  }));

  if (operatorAddress) {
    msgs.push({
      typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission',
      value: { validatorAddress: operatorAddress },
    });
  }

  if (!msgs.length) throw new Error('Nothing to withdraw.');

  const gasMultiplier = Math.min(1 + (msgs.length - 1) * 0.35, 3.5);
  const result = await client.signAndBroadcast(address, msgs, makeFee(gasMultiplier));
  if (result.code !== 0) throw new Error(result.rawLog || 'Withdraw all failed');
  return result;
}

// ─── Get pending validator commission ─────────────────────────────────────────
export async function getValidatorCommission(operatorAddress) {
  try {
    const data = await fetchWithFallback(
      `/cosmos/distribution/v1beta1/validators/${operatorAddress}/commission`
    );
    const raiCommission = data?.commission?.commission?.find((c) => c.denom === DENOM);
    return raiCommission
      ? (parseFloat(raiCommission.amount) / 10 ** DENOM_EXP).toFixed(6)
      : '0';
  } catch {
    return '0';
  }
}
