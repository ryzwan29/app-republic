import { ethers } from 'ethers';
import { SigningStargateClient, GasPrice, defaultRegistryTypes } from '@cosmjs/stargate';
import { fromBech32, toBech32, fromBase64, toBase64 } from '@cosmjs/encoding';
import { makeAuthInfoBytes, Registry, TxRaw, TxBody } from '@cosmjs/proto-signing';
import { getProvider, getWeb3Provider } from './evm.js';
import { CONTRACTS, STAKING_ABI } from './tokens.js';
import { getValidators as getCosmosValidators, getStakingPool, getAnnualProvisions, getInflation } from './cosmos.js';
import { getActiveRPC, getActiveAPI, fetchWithFallback, withEVMFallback } from './rpcFallback.js';

// Registry singleton — dibuat sekali, dipakai semua fungsi
const _registry = new Registry(defaultRegistryTypes);

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
  const gas = Math.ceil(300_000 * gasMultiplier);
  // ✅ FIX: Gunakan BigInt untuk hindari floating point imprecision
  // 20_000_000_000 * 300_000 = 6_000_000_000_000_000 (15 digit, butuh presisi penuh)
  const GAS_PRICE = 20_000_000_000n; // 20 Gwei dalam arai
  const feeAmt = (GAS_PRICE * BigInt(gas)).toString();
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

// ─── Keplr signing client — proven approach untuk EVM-Cosmos chain ──────────────
//
// Approach ini diambil dari implementasi yang sudah terbukti bekerja:
//   - getOfflineSigner() → signDirect (bukan AMINO) — ini yang benar untuk chain ini
//   - fixedSigner: override algo ke "ethsecp256k1" dan pubKey dari keplr.getKey()
//   - SigningStargateClient.connectWithSigner() lalu signAndBroadcast()
//   - Fetch sequence FRESH dari REST sebelum sign untuk hindari sequence mismatch
//
export async function getKeplrSigningClient() {
  const keplr = window.keplr;
  if (!keplr) throw new Error('Keplr wallet not found. Please install the Keplr extension.');

  const [activeRpc, activeRest] = await Promise.all([
    getActiveRPC().catch(() => RPC_FALLBACK),
    getActiveAPI().catch(() => REST_FALLBACK),
  ]);

  try {
    await keplr.experimentalSuggestChain(buildKeplrChainConfig(activeRpc, activeRest));
  } catch {}

  await keplr.enable(CHAIN_ID);

  const key           = await keplr.getKey(CHAIN_ID);
  const offlineSigner = keplr.getOfflineSigner(CHAIN_ID);

  // Fetch sequence FRESH dari chain sebelum membuat client
  // Ini fix sequence mismatch — Keplr cache bisa stale setelah tx sebelumnya
  let freshSequence      = null;
  let freshAccountNumber = null;
  try {
    const acctRes = await fetch(`${activeRest}/cosmos/auth/v1beta1/accounts/${key.bech32Address}`);
    if (acctRes.ok) {
      const acctData    = await acctRes.json();
      const baseAccount = acctData.account?.base_account ?? acctData.account;
      freshSequence      = parseInt(baseAccount?.sequence       ?? '0', 10);
      freshAccountNumber = parseInt(baseAccount?.account_number ?? '0', 10);
    }
  } catch (e) {
    console.warn('[Keplr] Could not fetch on-chain sequence:', e.message);
  }

  // fixedSigner: override algo ke ethsecp256k1 + inject sequence fresh ke signDoc
  const fixedSigner = {
    getAccounts: async () => [{
      address: key.bech32Address,
      algo:    'ethsecp256k1',
      pubkey:  key.pubKey,
    }],
    signDirect: async (signerAddress, signDoc) => {
      // Patch sequence di AuthInfo jika kita punya nilai fresh dari chain
      if (freshSequence !== null) {
        try {
          // AuthInfo bytes berisi sequence — kita patch via decoded protobuf
          const { AuthInfo } = await import('@cosmjs/proto-signing');
          const authInfo = AuthInfo.decode(signDoc.authInfoBytes);
          if (authInfo.signerInfos?.[0]) {
            authInfo.signerInfos[0].sequence = BigInt(freshSequence);
            signDoc = {
              ...signDoc,
              authInfoBytes: AuthInfo.encode(authInfo).finish(),
            };
          }
        } catch (e) {
          console.warn('[Keplr] Could not patch sequence in AuthInfo:', e.message);
        }
      }
      return offlineSigner.signDirect(signerAddress, signDoc);
    },
  };

  const client = await SigningStargateClient.connectWithSigner(activeRpc, fixedSigner, {
    gasPrice: GasPrice.fromString(`20000000000${DENOM}`),
  });

  return { client, address: key.bech32Address };
}

// ─── keplrSignAndBroadcast — wrapper convenience ──────────────────────────────
export async function keplrSignAndBroadcast(msgs, memo = '') {
  const { client, address } = await getKeplrSigningClient();
  // Resolve __SELF__ placeholder
  const resolvedMsgs = msgs.map(({ typeUrl, value }) => ({
    typeUrl,
    value: Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, v === '__SELF__' ? address : v])
    ),
  }));
  const gasLimit  = Math.ceil(300_000 * Math.min(1 + (resolvedMsgs.length - 1) * 0.35, 3.5));
  const feeAmount = (20_000_000_000n * BigInt(gasLimit)).toString();
  const fee = { amount: [{ denom: DENOM, amount: feeAmount }], gas: gasLimit.toString() };
  let result;
  try {
    result = await client.signAndBroadcast(address, resolvedMsgs, fee, memo);
  } finally {
    try { client.disconnect(); } catch {}
  }
  if (result.code !== 0) throw new Error(result.rawLog || 'Transaction failed');
  return { transactionHash: result.transactionHash, code: 0 };
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
    const amountInArai = ethers.parseEther(amount.toString()).toString();
    return keplrSignAndBroadcast([{
      typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
      value:   { delegatorAddress: '__SELF__', validatorAddress, amount: { denom: DENOM, amount: amountInArai } },
    }], `Delegate to validator`);
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
    const amountInArai = ethers.parseEther(amount.toString()).toString();
    return keplrSignAndBroadcast([{
      typeUrl: '/cosmos.staking.v1beta1.MsgUndelegate',
      value:   { delegatorAddress: '__SELF__', validatorAddress, amount: { denom: DENOM, amount: amountInArai } },
    }], `Undelegate from validator`);
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
    return keplrSignAndBroadcast([{
      typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
      value:   { delegatorAddress: '__SELF__', validatorAddress },
    }], 'Withdraw rewards');
  }
  const web3Provider = await getWeb3Provider();
  const signer       = await web3Provider.getSigner();
  const staking      = getStakingContract(signer);
  const tx           = await staking.claimReward(validatorAddress);
  return tx.wait();
}

// ─── Claim ALL rewards (semua validator sekaligus) ────────────────────────────
export async function claimAllRewards(validatorAddresses) {
  if (!validatorAddresses?.length) throw new Error('No delegations found to claim.');
  const msgs = validatorAddresses.map((valAddr) => ({
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
    value:   { delegatorAddress: '__SELF__', validatorAddress: valAddr },
  }));
  return keplrSignAndBroadcast(msgs, 'Withdraw all rewards');
}

// ─── Redelegate ───────────────────────────────────────────────────────────────
export async function redelegate(srcValidatorAddress, dstValidatorAddress, amount, walletType = 'evm') {
  if (walletType !== 'keplr') throw new Error('Redelegate hanya tersedia untuk Keplr wallet.');
  const amountInArai = ethers.parseEther(amount.toString()).toString();
  return keplrSignAndBroadcast([{
    typeUrl: '/cosmos.staking.v1beta1.MsgBeginRedelegate',
    value:   { delegatorAddress: '__SELF__', validatorSrcAddress: srcValidatorAddress, validatorDstAddress: dstValidatorAddress, amount: { denom: DENOM, amount: amountInArai } },
  }], 'Redelegate');
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
    // FIX: Guard nilai '0.000000000000000000' dari API — parseFloat bukan string
    const rawCommission = raiCommission ? parseFloat(raiCommission.amount) / 10 ** DENOM_EXP : 0;
    const pendingCommission = rawCommission > 0 ? rawCommission.toFixed(6) : '0';

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
  return keplrSignAndBroadcast([{
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission',
    value:   { validatorAddress: validatorOperatorAddress },
  }], 'Withdraw commission');
}

// ─── Withdraw ALL rewards + commission dalam 1 tx ────────────────────────────
export async function withdrawAllRewardsAndCommission(validatorAddresses, operatorAddress) {
  const msgs = (validatorAddresses || []).map((valAddr) => ({
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
    value:   { delegatorAddress: '__SELF__', validatorAddress: valAddr },
  }));
  if (operatorAddress) {
    msgs.push({
      typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission',
      value:   { validatorAddress: operatorAddress },
    });
  }
  if (!msgs.length) throw new Error('Nothing to withdraw.');
  return keplrSignAndBroadcast(msgs, 'Withdraw all rewards and commission');
}

// ─── Get pending validator commission ─────────────────────────────────────────
export async function getValidatorCommission(operatorAddress) {
  try {
    const data = await fetchWithFallback(
      `/cosmos/distribution/v1beta1/validators/${operatorAddress}/commission`
    );
    const raiCommission = data?.commission?.commission?.find((c) => c.denom === DENOM);
    if (!raiCommission) return '0';
    // ✅ FIX: Gunakan parseFloat, bukan string comparison
    // API bisa return "0.000000000000000000" yang !== "0" padahal nilainya nol
    const parsed = parseFloat(raiCommission.amount) / 10 ** DENOM_EXP;
    return parsed > 0 ? parsed.toFixed(6) : '0';
  } catch {
    return '0';
  }
}

// ─── Get active redelegations for a delegator ────────────────────────────────
// Returns list of active redelegations with completion_time for each entry.
// Used to show countdown timers in the UI before user can redelegate again.
//
// Cosmos API: GET /cosmos/staking/v1beta1/delegators/{delegatorAddr}/redelegations
// Response shape:
//   { redelegation_responses: [{ redelegation: { validator_dst_address }, entries: [{ redelegation_entry: { completion_time } }] }] }
//
// Returns: { [validatorDstAddress]: Date } — earliest completion time per destination validator
export async function getActiveRedelegations(cosmosAddress) {
  if (!cosmosAddress) return {};
  try {
    const data = await fetchWithFallback(
      `/cosmos/staking/v1beta1/delegators/${cosmosAddress}/redelegations`
    );

    // Log raw response so we can debug the actual shape
    console.log('[getActiveRedelegations] raw response:', JSON.stringify(data));

    const responses = data?.redelegation_responses ?? [];
    const result = {};

    for (const r of responses) {
      // Support two known response shapes:
      // Shape A (standard): r.redelegation.validator_dst_address + r.entries[].redelegation_entry.completion_time
      // Shape B (some chains): r.validator_dst_address + r.entries[].completion_time
      const dst = r.redelegation?.validator_dst_address ?? r.validator_dst_address;
      if (!dst) continue;

      const entries = r.entries ?? r.redelegation?.entries ?? [];
      for (const entry of entries) {
        // Try all known locations for completion_time
        const completionTime =
          entry.redelegation_entry?.completion_time ??
          entry.completion_time ??
          entry.redelegation_entry?.completionTime ??
          entry.completionTime;

        if (!completionTime) continue;
        const completionDate = new Date(completionTime);
        if (isNaN(completionDate.getTime())) continue; // skip invalid dates
        if (!result[dst] || completionDate > result[dst]) {
          result[dst] = completionDate;
        }
      }
    }

    console.log('[getActiveRedelegations] parsed result:', result);
    return result;
  } catch (err) {
    console.error('[getActiveRedelegations] error:', err);
    return {};
  }
}