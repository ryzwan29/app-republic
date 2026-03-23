import { COSMOS_CONFIG } from './tokens.js';
import { fetchWithFallback, getActiveRPC } from './rpcFallback.js';

// fetchREST sekarang pakai fetchWithFallback — otomatis coba provider lain kalau gagal
async function fetchREST(path) {
  return fetchWithFallback(path);
}

export async function connectKeplr() {
  if (!window.keplr) throw new Error('Keplr wallet is not installed. Please install Keplr to continue.');

  // Ambil RPC aktif untuk suggest chain ke Keplr
  const activeRpc = await getActiveRPC().catch(() => COSMOS_CONFIG.rpc);

  try {
    await window.keplr.experimentalSuggestChain({
      chainId: COSMOS_CONFIG.chainId,
      chainName: COSMOS_CONFIG.chainName,
      rpc: activeRpc,
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
      // gasPriceStep dalam satuan awei (base denom, 18 desimal) — bukan RAI
      // 10 Gwei = 10_000_000_000 awei; 20 Gwei = 20_000_000_000; 40 Gwei = 40_000_000_000
      feeCurrencies: [{ coinDenom: 'RAI', coinMinimalDenom: 'arai', coinDecimals: 18, gasPriceStep: { low: 10_000_000_000, average: 20_000_000_000, high: 40_000_000_000 } }],
      stakeCurrency: { coinDenom: 'RAI', coinMinimalDenom: 'arai', coinDecimals: 18 },
      // ✅ Wajib untuk EVM-Cosmos chain
      features: ['eth-address-gen', 'eth-key-sign'],
    });

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

export async function getAnnualProvisions() {
  try {
    const data = await fetchREST('/cosmos/mint/v1beta1/annual_provisions');
    return data.annual_provisions || '0';
  } catch {
    return '0';
  }
}

export async function getInflation() {
  try {
    const data = await fetchREST('/cosmos/mint/v1beta1/inflation');
    return data.inflation || '0';
  } catch {
    return '0';
  }
}
// ─── Governance ───────────────────────────────────────────────────────────────

// Normalize proposal dari v1 atau v1beta1 ke shape yang sama
function normalizeProposal(p, version) {
  if (version === 'v1') {
    const content = p.messages?.[0] ?? {};
    return {
      id:           p.id,
      title:        p.title || content['@type'] || `Proposal #${p.id}`,
      summary:      p.summary || p.metadata || '',
      type:         content['@type']?.split('.').pop() || 'Governance',
      status:       p.status,
      submitTime:   p.submit_time,
      depositEnd:   p.deposit_end_time,
      votingStart:  p.voting_start_time,
      votingEnd:    p.voting_end_time,
      finalTime:    p.voting_end_time,
      messages:     p.messages || [],   // raw message objects
      tally: {
        yes:         p.final_tally_result?.yes_count         || p.final_tally_result?.yes         || '0',
        no:          p.final_tally_result?.no_count          || p.final_tally_result?.no          || '0',
        abstain:     p.final_tally_result?.abstain_count     || p.final_tally_result?.abstain     || '0',
        no_with_veto:p.final_tally_result?.no_with_veto_count|| p.final_tally_result?.no_with_veto|| '0',
      },
    };
  }
  // v1beta1
  const content = p.content || {};
  return {
    id:           p.proposal_id,
    title:        content.title || `Proposal #${p.proposal_id}`,
    summary:      content.description || '',
    type:         content['@type']?.split('.').pop() || 'Governance',
    status:       p.status,
    submitTime:   p.submit_time,
    depositEnd:   p.deposit_end_time,
    votingStart:  p.voting_start_time,
    votingEnd:    p.voting_end_time,
    finalTime:    p.voting_end_time,
    messages:     [content],            // wrap in array for uniform access
    tally: {
      yes:          p.final_tally_result?.yes          || '0',
      no:           p.final_tally_result?.no           || '0',
      abstain:      p.final_tally_result?.abstain      || '0',
      no_with_veto: p.final_tally_result?.no_with_veto || '0',
    },
  };
}

export async function getProposals() {
  // Try v1 first, fall back to v1beta1
  try {
    const data = await fetchREST('/cosmos/gov/v1/proposals?pagination.limit=50&pagination.reverse=true');
    const proposals = data.proposals || [];
    return proposals.map(p => normalizeProposal(p, 'v1'));
  } catch {
    try {
      const data = await fetchREST('/cosmos/gov/v1beta1/proposals?pagination.limit=50&pagination.reverse=true');
      const proposals = data.proposals || [];
      return proposals.map(p => normalizeProposal(p, 'v1beta1'));
    } catch {
      return [];
    }
  }
}

export async function getProposalTally(proposalId) {
  try {
    const data = await fetchREST(`/cosmos/gov/v1/proposals/${proposalId}/tally`);
    const t = data.tally || {};
    return {
      yes:          t.yes_count          || t.yes          || '0',
      no:           t.no_count           || t.no           || '0',
      abstain:      t.abstain_count      || t.abstain      || '0',
      no_with_veto: t.no_with_veto_count || t.no_with_veto || '0',
    };
  } catch {
    try {
      const data = await fetchREST(`/cosmos/gov/v1beta1/proposals/${proposalId}/tally`);
      const t = data.tally || {};
      return { yes: t.yes||'0', no: t.no||'0', abstain: t.abstain||'0', no_with_veto: t.no_with_veto||'0' };
    } catch {
      return { yes:'0', no:'0', abstain:'0', no_with_veto:'0' };
    }
  }
}

export async function getProposalVotes(proposalId) {
  try {
    const data = await fetchREST(`/cosmos/gov/v1/proposals/${proposalId}/votes?pagination.limit=100`);
    return (data.votes || []).map(v => ({
      voter:   v.voter,
      options: v.options || [{ option: v.option, weight: '1' }],
    }));
  } catch {
    try {
      const data = await fetchREST(`/cosmos/gov/v1beta1/proposals/${proposalId}/votes?pagination.limit=100`);
      return (data.votes || []).map(v => ({
        voter:   v.voter,
        options: v.options || [{ option: v.option, weight: '1' }],
      }));
    } catch {
      return [];
    }
  }
}

export async function getProposalDetail(proposalId) {
  try {
    const data = await fetchREST(`/cosmos/gov/v1/proposals/${proposalId}`);
    return normalizeProposal(data.proposal, 'v1');
  } catch {
    try {
      const data = await fetchREST(`/cosmos/gov/v1beta1/proposals/${proposalId}`);
      return normalizeProposal(data.proposal, 'v1beta1');
    } catch {
      return null;
    }
  }
}