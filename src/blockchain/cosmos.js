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

export async function getTotalSupply() {
  try {
    const data = await fetchREST('/cosmos/bank/v1beta1/supply?pagination.limit=100');
    const coins = data.supply || data.result || [];
    const arai  = coins.find(c => c.denom === 'arai');
    return arai ? (parseFloat(arai.amount) / 1e18) : 0;
  } catch { return 0; }
}

export async function getRecentBlocks(count = 10) {
  // Ambil beberapa block terakhir untuk hitung avg block time real
  try {
    const latest = await fetchREST('/cosmos/base/tendermint/v1beta1/blocks/latest');
    const latestH = parseInt(latest.block?.header?.height || 0);
    if (!latestH) return null;

    const oldH = Math.max(1, latestH - count);
    const old  = await fetchREST(`/cosmos/base/tendermint/v1beta1/blocks/${oldH}`);

    const t1 = new Date(latest.block?.header?.time).getTime();
    const t0 = new Date(old.block?.header?.time).getTime();
    const diff = (t1 - t0) / 1000; // seconds
    const blocks = latestH - oldH;
    return blocks > 0 ? (diff / blocks) : null;
  } catch { return null; }
}

// ─── 24h Chart Data (real on-chain) ──────────────────────────────────────────
// Strategi: fetch latest block → hitung height 24 jam lalu dari avg block time
// → sample 24 titik merata → per titik ambil block data (height, time, tx_count)
// → group ke 24 bucket jam → hitung blocks/jam & tx/jam
export async function get24hChartData() {
  try {
    // 1. Dapat latest block + avg block time
    const latestData = await fetchREST('/cosmos/base/tendermint/v1beta1/blocks/latest');
    const latestH    = parseInt(latestData.block?.header?.height || 0);
    const latestTime = new Date(latestData.block?.header?.time).getTime();
    if (!latestH) return null;

    // 2. Estimasi block time dari 20 block terakhir
    const oldH     = Math.max(1, latestH - 20);
    const oldData  = await fetchREST(`/cosmos/base/tendermint/v1beta1/blocks/${oldH}`);
    const oldTime  = new Date(oldData.block?.header?.time).getTime();
    const avgBlockMs = (latestTime - oldTime) / 20; // ms per block
    if (avgBlockMs <= 0) return null;

    // 3. Hitung height ~24 jam lalu
    const msIn24h     = 24 * 60 * 60 * 1000;
    const blocks24h   = Math.floor(msIn24h / avgBlockMs);
    const startH      = Math.max(1, latestH - blocks24h);
    const startTime24 = latestTime - msIn24h;

    // 4. Sample 25 titik merata antara startH dan latestH
    const SAMPLES = 25;
    const step    = Math.max(1, Math.floor((latestH - startH) / SAMPLES));
    const heights = Array.from({ length: SAMPLES }, (_, i) => startH + i * step);
    heights.push(latestH);

    // 5. Fetch semua block sample secara parallel (batched)
    const BATCH = 6;
    const blockResults = [];
    for (let i = 0; i < heights.length; i += BATCH) {
      const batch = heights.slice(i, i + BATCH);
      const fetched = await Promise.all(
        batch.map(h =>
          fetchREST(`/cosmos/base/tendermint/v1beta1/blocks/${h}`)
            .catch(() => null)
        )
      );
      blockResults.push(...fetched);
    }

    // 6. Parse sample points
    const points = blockResults
      .filter(Boolean)
      .map(d => ({
        height: parseInt(d.block?.header?.height || 0),
        time:   new Date(d.block?.header?.time).getTime(),
        txCount: (d.block?.data?.txs || []).length,
      }))
      .filter(p => p.height > 0 && p.time >= startTime24)
      .sort((a, b) => a.height - b.height);

    if (points.length < 2) return null;

    // 7. Group ke 24 bucket jam
    const hourMs  = 60 * 60 * 1000;
    const buckets = Array.from({ length: 24 }, (_, i) => ({
      h:        i,
      label:    `${String(i + 1).padStart(2, '0')}:00`,
      blocks:   0,
      txOk:     0,
      txFail:   0, // tx fail ga bisa dibedain dari block data tanpa receipt
      avgTime:  0,
      _times:   [],
    }));

    for (let i = 1; i < points.length; i++) {
      const p    = points[i];
      const prev = points[i - 1];
      const relMs = p.time - startTime24;
      const bucket = Math.min(23, Math.floor(relMs / hourMs));
      if (bucket < 0) continue;

      const blockDiff   = p.height - prev.height;
      const timeDiffSec = (p.time - prev.time) / 1000;
      const blockTimeSec = blockDiff > 0 ? timeDiffSec / blockDiff : 0;

      buckets[bucket].blocks += blockDiff;
      buckets[bucket].txOk  += p.txCount;
      if (blockTimeSec > 0) buckets[bucket]._times.push(blockTimeSec);
    }

    // 8. Finalize avgTime per bucket
    buckets.forEach(b => {
      b.avgTime = b._times.length > 0
        ? parseFloat((b._times.reduce((a, c) => a + c, 0) / b._times.length).toFixed(1))
        : 0;
      delete b._times;
      // Pastikan blocks minimal 1 kalau ada data
      if (b.blocks === 0 && b.txOk === 0) b.blocks = 0;
    });

    const totalTx24h = buckets.reduce((s, b) => s + b.txOk, 0);
    return { buckets, totalTx24h, avgBlockTimeSec: avgBlockMs / 1000 };
  } catch (e) {
    console.warn('[get24hChartData]', e.message);
    return null;
  }
}

// ─── Daily TX Chart (7 hari terakhir, 1 bar = 1 hari) ────────────────────────
export async function getDailyTxData(days = 14) {
  try {
    // 1. Dapat latest block
    const latestData = await fetchREST('/cosmos/base/tendermint/v1beta1/blocks/latest');
    const latestH    = parseInt(latestData.block?.header?.height || 0);
    const latestTime = new Date(latestData.block?.header?.time).getTime();
    if (!latestH) return null;

    // 2. Avg block time dari 20 block
    const refH    = Math.max(1, latestH - 20);
    const refData = await fetchREST(`/cosmos/base/tendermint/v1beta1/blocks/${refH}`);
    const refTime = new Date(refData.block?.header?.time).getTime();
    const avgBlockMs = (latestTime - refTime) / (latestH - refH);
    if (avgBlockMs <= 0) return null;

    const blocksPerDay = Math.floor(86400000 / avgBlockMs);

    // 3. Untuk setiap hari, sample ~8 titik merata sepanjang hari itu
    //    lalu hitung total tx dari sample tersebut (ekstrapolasi)
    const SAMPLES_PER_DAY = 8;
    const dayMs = 86400000;

    const buckets = [];
    for (let d = days - 1; d >= 0; d--) {
      const dayStart = latestTime - (d + 1) * dayMs;
      const dayEnd   = latestTime - d * dayMs;

      // Estimasi height range untuk hari ini
      const hStart = Math.max(1, latestH - Math.floor((latestTime - dayStart) / avgBlockMs));
      const hEnd   = Math.max(1, latestH - Math.floor((latestTime - dayEnd)   / avgBlockMs));
      const hRange = Math.max(1, hEnd - hStart);

      // Sample titik2 di dalam range hari itu
      const sampleHeights = Array.from({ length: SAMPLES_PER_DAY }, (_, i) =>
        Math.min(latestH, Math.round(hStart + (i / (SAMPLES_PER_DAY - 1)) * hRange))
      );

      // Fetch sample blocks
      const samples = await Promise.all(
        sampleHeights.map(h =>
          fetchREST(`/cosmos/base/tendermint/v1beta1/blocks/${h}`)
            .then(b => ({ txCount: (b.block?.data?.txs || []).length, height: parseInt(b.block?.header?.height || h) }))
            .catch(() => ({ txCount: 0, height: h }))
        )
      );

      // Rata-rata tx per block dari sample → extrapolasi ke seluruh hari
      const avgTxPerBlock = samples.reduce((s, p) => s + p.txCount, 0) / samples.length;
      const estimatedTx   = Math.round(avgTxPerBlock * hRange);

      // Label tanggal
      const date = new Date(dayStart);
      const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const iso   = date.toISOString().slice(0, 10);

      buckets.push({
        label,
        iso,
        dayIndex: days - 1 - d,
        txOk:    estimatedTx,
        txFail:  0,
        hStart,
        hEnd,
        blocksInDay: hRange,
      });
    }

    const totalTx = buckets.reduce((s, b) => s + b.txOk, 0);
    return { buckets, totalTx };
  } catch (e) {
    console.warn('[getDailyTxData]', e.message);
    return null;
  }
}