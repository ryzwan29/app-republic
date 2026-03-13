import { COSMOS_CONFIG } from './tokens.js';

const REST = 'https://rest.republicai.io';
const RPC = 'https://rest.republicai.io';

async function fetchREST(path) {
  const res = await fetch(`${REST}${path}`);
  if (!res.ok) throw new Error(`REST error: ${res.status}`);
  return res.json();
}

export async function connectKeplr() {
  if (!window.keplr) throw new Error('Keplr wallet is not installed. Please install Keplr to continue.');

  try {
    // Suggest chain if not added
    await window.keplr.experimentalSuggestChain({
      chainId: COSMOS_CONFIG.chainId,
      chainName: COSMOS_CONFIG.chainName,
      rpc: COSMOS_CONFIG.rpc,
      rest: COSMOS_CONFIG.rest,
      bip44: { coinType: 60 },
      bech32Config: {
        bech32PrefixAccAddr: COSMOS_CONFIG.bech32Prefix,
        bech32PrefixAccPub: `${COSMOS_CONFIG.bech32Prefix}pub`,
        bech32PrefixValAddr: `${COSMOS_CONFIG.bech32Prefix}valoper`,
        bech32PrefixValPub: `${COSMOS_CONFIG.bech32Prefix}valoperpub`,
        bech32PrefixConsAddr: `${COSMOS_CONFIG.bech32Prefix}valcons`,
        bech32PrefixConsPub: `${COSMOS_CONFIG.bech32Prefix}valconspub`,
      },
      currencies: COSMOS_CONFIG.currencies,
      feeCurrencies: [{ coinDenom: 'RAI', coinMinimalDenom: 'arai', coinDecimals: 18, gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 } }],
      stakeCurrency: { coinDenom: 'RAI', coinMinimalDenom: 'arai', coinDecimals: 18 },
    });

    // Force Keplr to show account picker every time
    await window.keplr.disable(COSMOS_CONFIG.chainId);
    await window.keplr.enable(COSMOS_CONFIG.chainId);
    const offlineSigner = window.keplr.getOfflineSigner(COSMOS_CONFIG.chainId);
    const accounts = await offlineSigner.getAccounts();
    return accounts[0]?.address || null;
  } catch (err) {
    if (err.message?.includes('rejected')) throw new Error('Keplr connection rejected by user.');
    throw err;
  }
}

export async function getValidators() {
  try {
    const data = await fetchREST('/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=200');
    return (data.validators || []).map(v => ({
      address: v.operator_address,
      moniker: v.description?.moniker || 'Unknown',
      identity: v.description?.identity || '',
      website: v.description?.website || '',
      commission: parseFloat(v.commission?.commission_rates?.rate || 0) * 100,
      tokens: v.tokens,
      status: v.status,
      jailed: v.jailed,
    }));
  } catch {
    return [];
  }
}

export async function getCosmosBalance(address) {
  try {
    const data = await fetchREST(`/cosmos/bank/v1beta1/balances/${address}`);
    const raiBalance = data.balances?.find(b => b.denom === 'arai');
    if (raiBalance) {
      return (parseFloat(raiBalance.amount) / 1e18).toFixed(6);
    }
    return '0';
  } catch {
    return '0';
  }
}

export async function getChainInfo() {
  try {
    const data = await fetchREST('/cosmos/base/tendermint/v1beta1/node_info');
    return {
      network: data.default_node_info?.network || COSMOS_CONFIG.chainId,
      version: data.application_version?.version || 'unknown',
    };
  } catch {
    return { network: COSMOS_CONFIG.chainId, version: 'unknown' };
  }
}

export async function getLatestBlock() {
  try {
    const data = await fetchREST('/cosmos/base/tendermint/v1beta1/blocks/latest');
    return {
      height: data.block?.header?.height || '0',
      time: data.block?.header?.time || '',
    };
  } catch {
    return { height: '0', time: '' };
  }
}

export async function getStakingPool() {
  try {
    const data = await fetchREST('/cosmos/staking/v1beta1/pool');
    return {
      bondedTokens: data.pool?.bonded_tokens || '0',
      notBondedTokens: data.pool?.not_bonded_tokens || '0',
    };
  } catch {
    return { bondedTokens: '0', notBondedTokens: '0' };
  }
}

export async function getDelegations(address) {
  try {
    const data = await fetchREST(`/cosmos/staking/v1beta1/delegations/${address}`);
    return data.delegation_responses || [];
  } catch {
    return [];
  }
}

export async function getRewards(address) {
  try {
    const data = await fetchREST(`/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
    return data.rewards || [];
  } catch {
    return [];
  }
}
