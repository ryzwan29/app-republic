// ─── RPC Fallback Manager ─────────────────────────────────────────────────────
// Otomatis pindah ke provider berikutnya kalau yang aktif down.
// Urutan prioritas: Official → NodeStake → RydOne

// Diurutkan berdasarkan latency test: NodeStake paling cepet untuk semua endpoint.
// Official EVM kena CORS dari browser tapi tetap disertakan sebagai fallback terakhir.
const PROVIDERS = [
  {
    name: 'NodeStake',
    evm: 'https://evmrpc-t.republicai.nodestake.org',
    rpc: 'https://rpc-t.republicai.nodestake.org',
    api: 'https://api-t.republicai.nodestake.org',
  },
  {
    name: 'Official',
    evm: 'https://evm-rpc.republicai.io',
    rpc: 'https://rpc.republicai.io',
    api: 'https://rest.republicai.io',
  },
  {
    name: 'RydOne',
    evm: 'https://testnet-evm-republic.provewithryd.xyz',
    rpc: 'https://testnet-rpc-republic.provewithryd.xyz',
    api: 'https://testnet-api-republic.provewithryd.xyz',
  },
];

// Timeout per request (ms)
const TIMEOUT_MS = 5000;

// Cache index provider yang terakhir sukses per type
const _activeIndex = { evm: 0, rpc: 0, api: 0 };

// ─── Timeout wrapper ──────────────────────────────────────────────────────────
function withTimeout(promise, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), ms)
    ),
  ]);
}

// ─── Health check cepat untuk EVM endpoint ───────────────────────────────────
async function pingEVM(url) {
  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    })
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.result) throw new Error('No result');
}

// ─── Health check cepat untuk REST/RPC endpoint ───────────────────────────────
async function pingREST(url) {
  const res = await withTimeout(
    fetch(`${url}/cosmos/base/tendermint/v1beta1/blocks/latest`)
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ─── Cari provider yang hidup, mulai dari index terakhir yang berhasil ────────
async function findActiveProvider(type) {
  const pingFn = type === 'evm' ? pingEVM : pingREST;
  const startIndex = _activeIndex[type];

  // Coba dari index terakhir yang sukses dulu
  for (let offset = 0; offset < PROVIDERS.length; offset++) {
    const i = (startIndex + offset) % PROVIDERS.length;
    const provider = PROVIDERS[i];
    try {
      await pingFn(provider[type]);
      if (_activeIndex[type] !== i) {
        console.info(`[RPC Fallback] Switched ${type} → ${provider.name} (${provider[type]})`);
      }
      _activeIndex[type] = i;
      return provider[type];
    } catch (err) {
      console.warn(`[RPC Fallback] ${provider.name} ${type} down: ${err.message}`);
    }
  }

  // Semua provider down — kembalikan yang terakhir aktif sebagai last resort
  console.error('[RPC Fallback] All providers down, using last active as fallback');
  return PROVIDERS[startIndex][type];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Dapat EVM RPC URL yang aktif */
export async function getActiveEVM() {
  return findActiveProvider('evm');
}

/** Dapat Cosmos RPC URL yang aktif */
export async function getActiveRPC() {
  return findActiveProvider('rpc');
}

/** Dapat Cosmos REST/API URL yang aktif */
export async function getActiveAPI() {
  return findActiveProvider('api');
}

/**
 * Fetch ke Cosmos REST dengan fallback otomatis.
 * Drop-in replacement untuk fetch biasa ke REST endpoint.
 */
export async function fetchWithFallback(path, options = {}) {
  const startIndex = _activeIndex.api;

  for (let offset = 0; offset < PROVIDERS.length; offset++) {
    const i = (startIndex + offset) % PROVIDERS.length;
    const baseUrl = PROVIDERS[i].api;
    try {
      const res = await withTimeout(fetch(`${baseUrl}${path}`, options));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (_activeIndex.api !== i) {
        console.info(`[RPC Fallback] REST switched → ${PROVIDERS[i].name}`);
        _activeIndex.api = i;
      }
      return res.json();
    } catch (err) {
      console.warn(`[RPC Fallback] ${PROVIDERS[i].name} REST failed: ${err.message}`);
    }
  }

  throw new Error('All REST providers failed for: ' + path);
}

/**
 * Jalankan fungsi dengan ethers provider, fallback otomatis ke provider lain.
 * @param {(url: string) => Promise<T>} fn  — fungsi yang nerima EVM RPC URL
 */
export async function withEVMFallback(fn) {
  const startIndex = _activeIndex.evm;

  for (let offset = 0; offset < PROVIDERS.length; offset++) {
    const i = (startIndex + offset) % PROVIDERS.length;
    const url = PROVIDERS[i].evm;
    try {
      const result = await withTimeout(fn(url), 10000);
      if (_activeIndex.evm !== i) {
        console.info(`[RPC Fallback] EVM switched → ${PROVIDERS[i].name}`);
        _activeIndex.evm = i;
      }
      return result;
    } catch (err) {
      console.warn(`[RPC Fallback] ${PROVIDERS[i].name} EVM failed: ${err.message}`);
    }
  }

  throw new Error('All EVM providers failed');
}

/** Kembalikan semua provider dan status index aktif saat ini (untuk debug) */
export function getProviderStatus() {
  return PROVIDERS.map((p, i) => ({
    name: p.name,
    activeEVM: i === _activeIndex.evm,
    activeRPC: i === _activeIndex.rpc,
    activeAPI: i === _activeIndex.api,
  }));
}
// ─── Transaction fetchers ─────────────────────────────────────────────────────

/** Fetch EVM transaction + receipt via JSON-RPC with fallback */
export async function fetchEVMTx(hash) {
  for (let offset = 0; offset < PROVIDERS.length; offset++) {
    const i = (_activeIndex.evm + offset) % PROVIDERS.length;
    const url = PROVIDERS[i].evm;
    try {
      const call = (method, params) =>
        withTimeout(fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }).then(r => r.json()));

      const [txRes, rcptRes, blockRes] = await Promise.all([
        call('eth_getTransactionByHash',      [hash]),
        call('eth_getTransactionReceipt',     [hash]),
        call('eth_getTransactionByHash',      [hash]).then(r =>
          r.result?.blockHash
            ? call('eth_getBlockByHash', [r.result.blockHash, false])
            : Promise.resolve({ result: null })
        ),
      ]);

      const tx   = txRes.result;
      const rcpt = rcptRes.result;
      if (!tx) throw new Error('Transaction not found');

      _activeIndex.evm = i;
      return {
        hash:              tx.hash,
        from:              tx.from,
        to:                tx.to,
        value:             tx.value,
        valueETH:          tx.value ? (parseInt(tx.value, 16) / 1e18).toFixed(6) : '0',
        input:             tx.input,
        gasPrice:          tx.gasPrice,
        maxFeePerGas:      tx.maxFeePerGas,
        nonce:             parseInt(tx.nonce, 16),
        blockNumber:       tx.blockNumber ? parseInt(tx.blockNumber, 16) : null,
        blockHash:         tx.blockHash,
        transactionIndex:  tx.transactionIndex ? parseInt(tx.transactionIndex, 16) : null,
        // Receipt fields
        status:            rcpt ? (rcpt.status === '0x1' ? 'success' : 'failed') : 'pending',
        gasUsed:           rcpt ? parseInt(rcpt.gasUsed, 16) : null,
        gasLimit:          tx.gas ? parseInt(tx.gas, 16) : null,
        effectiveGasPrice: rcpt?.effectiveGasPrice,
        feeRAI:            rcpt?.effectiveGasPrice
          ? ((parseInt(rcpt.gasUsed, 16) * parseInt(rcpt.effectiveGasPrice, 16)) / 1e18).toFixed(8)
          : null,
        contractCreated:   rcpt?.contractAddress || null,
        logs:              rcpt?.logs?.slice(0, 10) ?? [],
        blockTime:         blockRes.result?.timestamp
          ? new Date(parseInt(blockRes.result.timestamp, 16) * 1000).toISOString()
          : null,
      };
    } catch (err) {
      console.warn(`[fetchEVMTx] ${PROVIDERS[i].name} failed: ${err.message}`);
    }
  }
  throw new Error('Transaction not found on any EVM provider');
}

/** Fetch Cosmos transaction via REST with fallback */
export async function fetchCosmosTx(hash) {
  // hash can be uppercase or lowercase hex
  const upperHash = hash.toUpperCase();
  for (let offset = 0; offset < PROVIDERS.length; offset++) {
    const i = (_activeIndex.api + offset) % PROVIDERS.length;
    const base = PROVIDERS[i].api;
    try {
      const res = await withTimeout(
        fetch(`${base}/cosmos/tx/v1beta1/txs/${upperHash}`)
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tx   = data.tx;
      const txr  = data.tx_response;
      if (!txr) throw new Error('tx_response missing');

      _activeIndex.api = i;

      // Flatten messages
      const messages = tx?.body?.messages ?? [];

      // Fee
      const feeAmount = tx?.auth_info?.fee?.amount ?? [];
      const feeStr = feeAmount.map(c => {
        const amt = parseFloat(c.amount);
        if (c.denom === 'arai') return `${(amt / 1e18).toFixed(8)} RAI`;
        return `${amt} ${c.denom}`;
      }).join(', ') || null;

      return {
        hash:        txr.txhash,
        height:      parseInt(txr.height),
        timestamp:   txr.timestamp,
        status:      txr.code === 0 ? 'success' : 'failed',
        code:        txr.code,
        rawLog:      txr.raw_log,
        gasWanted:   parseInt(txr.gas_wanted),
        gasUsed:     parseInt(txr.gas_used),
        fee:         feeStr,
        memo:        tx?.body?.memo || null,
        messages,
        events:      txr.events?.slice(0, 20) ?? [],
        logs:        txr.logs ?? [],
      };
    } catch (err) {
      console.warn(`[fetchCosmosTx] ${PROVIDERS[i].name} failed: ${err.message}`);
    }
  }
  throw new Error('Transaction not found on any Cosmos provider');
}