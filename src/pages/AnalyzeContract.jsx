import { fetchEVMTx, fetchCosmosTx } from '../blockchain/rpcFallback.js';
import { useState, useRef } from 'react';
import { ethers } from 'ethers';
import { probeContract, RISK_PATTERNS } from '../blockchain/contractProber.js';

// ── SVG Icons ────────────────────────────────────────────────────────────────
const IconSearch = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
  </svg>
);
const IconCpu = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
    <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/>
  </svg>
);
const IconBrain = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.04-4.55A3 3 0 0 1 5 10c0-.33.05-.65.14-.95A2.5 2.5 0 0 1 9.5 2z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.04-4.55A3 3 0 0 0 19 10c0-.33-.05-.65-.14-.95A2.5 2.5 0 0 0 14.5 2z"/>
  </svg>
);
const IconShield = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const IconInfo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
  </svg>
);
const IconWarn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconCopy = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const IconChevronDown = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortAddr(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '\u2026' + addr.slice(-4);
}

function CopyButton({ value }) {
  const [done, setDone] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
  }
  return (
    <button onClick={copy} className="p-1 text-slate-500 hover:text-blue-400 transition-colors" title="Copy">
      {done ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

function SectionCard({ icon, title, accent = 'blue', children }) {
  const iconCls = { blue:'text-blue-400 bg-blue-500/10', cyan:'text-cyan-400 bg-cyan-500/10', purple:'text-purple-400 bg-purple-500/10', amber:'text-amber-400 bg-amber-500/10', green:'text-green-400 bg-green-500/10' }[accent] ?? 'text-blue-400 bg-blue-500/10';
  const borderCls = { blue:'border-blue-500/20', cyan:'border-cyan-500/20', purple:'border-purple-500/20', amber:'border-amber-500/20', green:'border-green-500/20' }[accent] ?? 'border-blue-500/20';
  return (
    <div className={`glass-card p-6 border ${borderCls}`}>
      <div className="flex items-center gap-3 mb-5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconCls}`}>{icon}</div>
        <h3 className="font-display font-semibold text-white text-base">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function MutBadge({ value }) {
  const cls = { view:'text-cyan-400 bg-cyan-500/10 border-cyan-500/25', pure:'text-teal-400 bg-teal-500/10 border-teal-500/25', payable:'text-amber-400 bg-amber-500/10 border-amber-500/25', nonpayable:'text-slate-400 bg-slate-500/10 border-slate-500/25' }[value] ?? 'text-slate-400 bg-slate-500/10 border-slate-500/25';
  return <span className={`text-[10px] font-mono border rounded px-1.5 py-0.5 ${cls}`}>{value}</span>;
}

function RiskBadge({ level }) {
  const cls = { high:'text-red-400 bg-red-500/10 border-red-500/25', medium:'text-amber-400 bg-amber-500/10 border-amber-500/25', low:'text-blue-400 bg-blue-500/10 border-blue-500/25' }[level] ?? 'text-slate-400 bg-slate-500/10 border-slate-500/25';
  return <span className={`text-[10px] font-mono uppercase border rounded px-1.5 py-0.5 font-semibold ${cls}`}>{level}</span>;
}

function TypePill({ value }) {
  const emojis = { 'ERC-20 Token':'🪙','ERC-721 NFT':'🖼','ERC-1155 Multi-Token':'🎴','DEX / AMM':'🔄','Staking':'🏦','Lending':'💳','Governance':'🗳','Multisig':'🔐','Proxy':'🔀','Utility':'🔧','Unknown':'❓' };
  return (
    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500/10 border border-blue-500/25">
      <span className="text-lg">{emojis[value] ?? '📄'}</span>
      <span className="font-display font-semibold text-blue-300 text-sm">{value}</span>
    </div>
  );
}

const STEPS = ['Fetching bytecode via RPC…','Scanning function selectors…','Reading on-chain metadata…','Sending to AI for analysis…'];

function StepIndicator({ step }) {
  return (
    <div className="glass-card p-5 mb-4 space-y-2">
      {STEPS.map((label, i) => {
        const done = i < step, active = i === step;
        return (
          <div key={i} className={`flex items-center gap-3 text-sm transition-all duration-300 ${active ? 'text-white' : done ? 'text-slate-500' : 'text-slate-700'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-500/20 border border-green-500/30 text-green-400' : active ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400' : 'border border-slate-700 text-slate-700'}`}>
              {done ? <IconCheck /> : active ? (
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : <span className="text-[10px]">{i + 1}</span>}
            </div>
            <span className={active ? 'font-medium' : ''}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════
// TX EXPLAINER
// ═══════════════════════════════════════════════════════════

const IconHash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
    <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
  </svg>
);
const IconTx = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
    <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
  </svg>
);

function detectTxLayer(hash) {
  const h = hash.trim();
  // EVM: 0x + 64 hex chars = 66 total
  if (/^0x[0-9a-fA-F]{64}$/.test(h)) return 'evm';
  // Cosmos: 64 uppercase hex chars (no 0x)
  if (/^[0-9a-fA-F]{64}$/.test(h)) return 'cosmos';
  return null;
}

function TxFieldRow({ label, value, mono = false, accent }) {
  const valCls = accent
    ? { success: 'text-green-400', failed: 'text-red-400', pending: 'text-yellow-400' }[accent] || 'text-white'
    : mono ? 'text-blue-300 font-mono text-xs break-all' : 'text-white font-display text-sm';
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1 py-2.5 border-b border-blue-900/20">
      <span className="text-slate-500 text-xs font-display uppercase tracking-wider shrink-0 min-w-[120px]">{label}</span>
      <span className={valCls}>{value}</span>
    </div>
  );
}

function MsgCard({ msg, index }) {
  const type = msg['@type'] || msg.type || 'Unknown';
  const shortType = type.split('.').pop();
  const { ['@type']: _t, type: _ty, ...rest } = msg;

  function renderVal(v, depth = 0) {
    if (v === null || v === undefined) return <span className="text-slate-600">—</span>;
    if (typeof v === 'boolean') return <span className={v ? 'text-green-400' : 'text-red-400'}>{String(v)}</span>;
    if (typeof v !== 'object') return <span className="text-slate-200 font-mono text-xs break-all">{String(v)}</span>;
    if (Array.isArray(v)) {
      if (v.length === 0) return <span className="text-slate-600">[]</span>;
      return (
        <div className="ml-3 border-l border-blue-900/30 pl-2 space-y-0.5">
          {v.map((item, i) => <div key={i}>{renderVal(item, depth + 1)}</div>)}
        </div>
      );
    }
    if (depth >= 3) return <span className="text-slate-500 font-mono text-xs">{'{...}'}</span>;
    return (
      <div className="ml-3 border-l border-blue-900/30 pl-2 space-y-0.5">
        {Object.entries(v).map(([k, val]) => (
          <div key={k} className="flex flex-wrap gap-1.5 text-xs">
            <span className="text-slate-500 font-mono">{k}:</span>
            {renderVal(val, depth + 1)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-black/20 border border-blue-900/20 overflow-hidden">
      <div className="px-4 py-2.5 bg-blue-900/15 border-b border-blue-900/20 flex items-center gap-2">
        <span className="text-xs text-slate-500 font-mono">msg[{index}]</span>
        <span className="badge-blue">{shortType}</span>
        <span className="text-xs text-slate-600 font-mono truncate">{type}</span>
      </div>
      <div className="px-4 py-3 space-y-1.5">
        {Object.entries(rest).map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-1.5 text-xs">
            <span className="text-slate-400 font-mono w-24 shrink-0">{k}</span>
            {renderVal(v)}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventLog({ events }) {
  const [open, setOpen] = useState(false);
  if (!events?.length) return null;
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-2">
        <IconChevronDown />
        <span>{open ? 'Hide' : 'Show'} {events.length} events</span>
      </button>
      {open && (
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {events.map((ev, i) => (
            <div key={i} className="text-xs font-mono p-2 rounded-lg bg-black/20 border border-blue-900/20">
              <div className="text-blue-400 mb-1">{ev.type}</div>
              {ev.attributes?.map((a, j) => (
                <div key={j} className="flex gap-2 text-slate-500">
                  <span className="text-slate-400">{a.key}:</span>
                  <span className="text-slate-300 break-all">{a.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TX_STEPS = [
  'Detecting transaction layer…',
  'Fetching transaction data…',
  'Reading receipt & logs…',
  'Sending to AI for explanation…',
];

function TxStepIndicator({ step }) {
  return (
    <div className="glass-card p-5 mb-4 space-y-2">
      {TX_STEPS.map((label, i) => {
        const done = i < step, active = i === step;
        return (
          <div key={i} className={`flex items-center gap-3 text-sm transition-all duration-300 ${active ? 'text-white' : done ? 'text-slate-500' : 'text-slate-700'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-500/20 border border-green-500/30 text-green-400' : active ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400' : 'border border-slate-700 text-slate-700'}`}>
              {done ? <IconCheck /> : active ? (
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : <span className="text-[10px]">{i + 1}</span>}
            </div>
            <span className={active ? 'font-medium' : ''}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function TxExplainer() {
  const [hash,       setHash]       = useState('');
  const [inputError, setInputError] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [step,       setStep]       = useState(0);
  const [layer,      setLayer]      = useState(null);   // 'evm' | 'cosmos'
  const [txData,     setTxData]     = useState(null);
  const [aiResult,   setAiResult]   = useState(null);
  const [apiError,   setApiError]   = useState('');
  const inputRef = useRef(null);

  function validate(v) {
    const h = v.trim();
    if (!h) return 'Enter a transaction hash.';
    if (detectTxLayer(h) === null) return 'Invalid hash. EVM hashes start with 0x (66 chars). Cosmos hashes are 64 hex chars.';
    return '';
  }

  async function handleExplain() {
    const err = validate(hash);
    if (err) { setInputError(err); inputRef.current?.focus(); return; }
    setInputError(''); setTxData(null); setAiResult(null); setApiError('');
    setLoading(true); setStep(0);

    const detectedLayer = detectTxLayer(hash.trim());
    setLayer(detectedLayer);

    try {
      setStep(1);
      let raw;
      if (detectedLayer === 'evm') {
        raw = await fetchEVMTx(hash.trim());
      } else {
        raw = await fetchCosmosTx(hash.trim());
      }
      setStep(2);
      setTxData(raw);

      setStep(3);
      const res = await fetch('/api/explain-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: hash.trim(), txData: raw, layer: detectedLayer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI explanation failed');
      setAiResult(data);
    } catch (err) {
      setApiError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const statusColor = { success: 'text-green-400', failed: 'text-red-400', pending: 'text-yellow-400' };
  const statusIcon  = { success: '✓', failed: '✗', pending: '⏳' };

  return (
    <div>
      {/* Input */}
      <div className="glass-card p-6 mb-6">
        <label className="block text-sm font-display text-slate-400 mb-2 font-medium">Transaction Hash</label>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"><IconHash /></div>
            <input
              ref={inputRef}
              type="text"
              value={hash}
              onChange={e => { setHash(e.target.value); setInputError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleExplain()}
              placeholder="0x… or 64-char Cosmos hash"
              spellCheck={false}
              disabled={loading}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-blue-950/30 border border-blue-900/40 text-white font-mono text-sm placeholder-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-50 transition-all"
            />
          </div>
          <button
            onClick={handleExplain}
            disabled={loading}
            className="btn-primary px-5 min-w-[120px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg><span>Working…</span></>
            ) : (
              <><IconSearch /><span>Explain</span></>
            )}
          </button>
        </div>
        {inputError && (
          <div className="mt-3 flex items-center gap-2 text-red-400 text-sm animate-fade-in">
            <IconWarn /><span>{inputError}</span>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
          <span>EVM: <span className="font-mono text-slate-500">0x + 64 hex chars</span></span>
          <span>·</span>
          <span>Cosmos: <span className="font-mono text-slate-500">64 hex chars (no 0x)</span></span>
        </div>
      </div>

      {/* Step indicator */}
      {loading && <TxStepIndicator step={step} />}

      {/* Error */}
      {apiError && !loading && (
        <div className="glass-card p-5 border border-red-500/20 flex gap-3 items-start animate-fade-in">
          <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 flex-shrink-0 mt-0.5"><IconWarn /></div>
          <div>
            <div className="text-red-400 font-display font-semibold text-sm mb-0.5">Fetch Failed</div>
            <div className="text-slate-400 text-sm">{apiError}</div>
          </div>
        </div>
      )}

      {/* Results */}
      {txData && !loading && !apiError && (
        <div className="space-y-4 animate-slide-up">

          {/* AI Summary card */}
          {aiResult && (
            <SectionCard icon={<IconBrain />} title="AI Explanation" accent="purple">
              {/* Status badge */}
              <div className="flex items-center gap-3 mb-4">
                <span className={`font-mono font-bold text-lg ${statusColor[aiResult.status] || 'text-white'}`}>
                  {statusIcon[aiResult.status]} {(aiResult.status || 'unknown').toUpperCase()}
                </span>
                {layer && (
                  <span className={`badge-${layer === 'evm' ? 'blue' : 'green'}`}>
                    {layer === 'evm' ? 'EVM Layer' : 'Cosmos Layer'}
                  </span>
                )}
                {aiResult.technical?.type && (
                  <span className="text-xs px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-900/20 text-purple-400 font-display">
                    {aiResult.technical.type}
                  </span>
                )}
              </div>

              {/* Summary */}
              <p className="text-white text-base font-display font-medium leading-relaxed mb-4">
                {aiResult.summary}
              </p>

              {/* Actions list */}
              {aiResult.actions?.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-2">What happened</div>
                  <ul className="space-y-1.5">
                    {aiResult.actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                        <span className="text-blue-400 mt-0.5 shrink-0">›</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Technical details */}
              {(aiResult.technical?.method || aiResult.technical?.gasUsed || aiResult.technical?.details || aiResult.fee) && (
                <div className="grid sm:grid-cols-2 gap-2 mt-4">
                  {aiResult.technical?.method && (
                    <div className="p-2.5 rounded-lg bg-black/20 border border-blue-900/20">
                      <div className="text-xs text-slate-500 mb-1">Method called</div>
                      <div className="font-mono text-xs text-blue-300">{aiResult.technical.method}</div>
                    </div>
                  )}
                  {aiResult.technical?.gasUsed && (
                    <div className="p-2.5 rounded-lg bg-black/20 border border-blue-900/20">
                      <div className="text-xs text-slate-500 mb-1">Gas</div>
                      <div className="font-mono text-xs text-slate-300">{aiResult.technical.gasUsed}</div>
                    </div>
                  )}
                  {aiResult.fee && (
                    <div className="p-2.5 rounded-lg bg-black/20 border border-blue-900/20">
                      <div className="text-xs text-slate-500 mb-1">Fee paid</div>
                      <div className="font-mono text-xs text-slate-300">{aiResult.fee}</div>
                    </div>
                  )}
                  {aiResult.technical?.details && (
                    <div className="p-2.5 rounded-lg bg-black/20 border border-blue-900/20 sm:col-span-2">
                      <div className="text-xs text-slate-500 mb-1">Notes</div>
                      <div className="text-xs text-slate-400">{aiResult.technical.details}</div>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          )}

          {/* Raw TX data */}
          {layer === 'evm' ? (
            <SectionCard icon={<IconCpu />} title="Transaction Details" accent="blue">
              <TxFieldRow label="Hash"       value={txData.hash}       mono />
              <TxFieldRow label="Status"     value={`${statusIcon[txData.status] || ''} ${(txData.status || '—').toUpperCase()}`} accent={txData.status} />
              <TxFieldRow label="From"       value={txData.from}       mono />
              <TxFieldRow label="To"         value={txData.to || '(Contract Deploy)'} mono />
              {txData.valueETH !== '0.000000' && (
                <TxFieldRow label="Value"    value={`${txData.valueETH} RAI`} />
              )}
              <TxFieldRow label="Block"      value={txData.blockNumber?.toLocaleString() || 'Pending'} />
              {txData.blockTime && (
                <TxFieldRow label="Timestamp" value={new Date(txData.blockTime).toLocaleString()} />
              )}
              <TxFieldRow label="Nonce"      value={txData.nonce} />
              {txData.gasUsed && (
                <TxFieldRow label="Gas Used"  value={`${txData.gasUsed.toLocaleString()} / ${txData.gasLimit?.toLocaleString()}`} />
              )}
              {txData.feeRAI && (
                <TxFieldRow label="Fee"       value={`${txData.feeRAI} RAI`} />
              )}
              {txData.contractCreated && (
                <TxFieldRow label="Contract"  value={txData.contractCreated} mono />
              )}
              {txData.input && txData.input !== '0x' && (
                <div className="pt-2.5">
                  <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-1.5">Input Data</div>
                  <div className="text-xs font-mono text-slate-600 break-all bg-black/20 rounded-lg p-2.5 max-h-24 overflow-y-auto">
                    {txData.input}
                  </div>
                </div>
              )}
              {txData.logs?.length > 0 && (
                <div className="pt-2.5">
                  <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-2">
                    Logs ({txData.logs.length})
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {txData.logs.map((log, i) => (
                      <div key={i} className="text-xs font-mono p-2 rounded-lg bg-black/20 border border-blue-900/20">
                        <div className="text-blue-400 mb-0.5">{log.address}</div>
                        <div className="text-slate-600">topics: {log.topics?.length}</div>
                        {log.data && log.data !== '0x' && (
                          <div className="text-slate-700 truncate">data: {log.data.slice(0, 60)}…</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>
          ) : (
            <SectionCard icon={<IconTx />} title="Transaction Details" accent="cyan">
              <TxFieldRow label="Hash"      value={txData.hash}  mono />
              <TxFieldRow label="Status"    value={`${statusIcon[txData.status] || ''} ${(txData.status || '—').toUpperCase()}`} accent={txData.status} />
              <TxFieldRow label="Height"    value={txData.height?.toLocaleString()} />
              <TxFieldRow label="Timestamp" value={txData.timestamp ? new Date(txData.timestamp).toLocaleString() : '—'} />
              {txData.memo && <TxFieldRow label="Memo" value={txData.memo} />}
              <TxFieldRow label="Gas Used"  value={`${txData.gasUsed?.toLocaleString()} / ${txData.gasWanted?.toLocaleString()}`} />
              {txData.fee && <TxFieldRow label="Fee" value={txData.fee} />}
              {txData.code !== 0 && txData.rawLog && (
                <div className="pt-2.5">
                  <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-1.5">Error Log</div>
                  <div className="text-xs text-red-400 bg-red-900/10 border border-red-500/20 rounded-lg p-2.5">{txData.rawLog}</div>
                </div>
              )}

              {/* Messages */}
              {txData.messages?.length > 0 && (
                <div className="pt-3">
                  <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-3">
                    Messages ({txData.messages.length})
                  </div>
                  <div className="space-y-3">
                    {txData.messages.map((msg, i) => <MsgCard key={i} msg={msg} index={i} />)}
                  </div>
                </div>
              )}

              {/* Events */}
              {txData.events?.length > 0 && (
                <div className="pt-3">
                  <EventLog events={txData.events} />
                </div>
              )}
            </SectionCard>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !txData && !apiError && (
        <div className="glass-card p-10 text-center border border-blue-900/20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-500/8 border border-blue-500/20 flex items-center justify-center text-blue-500/60">
            <IconTx />
          </div>
          <p className="text-slate-400 font-display font-medium mb-1">No transaction explained yet</p>
          <p className="text-slate-600 text-sm mb-8">Paste a tx hash above and click <span className="text-blue-400">Explain</span>.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
            {[
              { icon:'🔗', label:'EVM Transactions',    desc:'Swaps, liquidity, token transfers, contract deploys — any 0x hash from the EVM layer.' },
              { icon:'🌌', label:'Cosmos Transactions',  desc:'Staking, governance, IBC, delegation — any 64-char hash from the Cosmos layer.' },
              { icon:'🧠', label:'AI Plain Language',    desc:'AI reads the raw data and explains what happened in simple, human-friendly terms.' },
            ].map(({ icon, label, desc }) => (
              <div key={label} className="p-4 rounded-xl bg-blue-900/10 border border-blue-900/20 text-center">
                <div className="text-2xl mb-2">{icon}</div>
                <div className="text-blue-400 font-display font-semibold text-sm mb-1">{label}</div>
                <div className="text-slate-500 text-xs leading-snug">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AnalyzeContract() {
  const [activeTab, setActiveTab] = useState('contract'); // 'contract' | 'tx'
  const [address, setAddress]         = useState('');
  const [inputError, setInputError]   = useState('');
  const [loading, setLoading]         = useState(false);
  const [step, setStep]               = useState(0);
  const [probeResult, setProbeResult] = useState(null);
  const [aiResult, setAiResult]       = useState(null);
  const [apiError, setApiError]       = useState('');
  const [showAllFns, setShowAllFns]   = useState(false);
  const inputRef = useRef(null);

  function validate(val) {
    const t = val.trim();
    if (!t) return 'Please enter a contract address.';
    try { ethers.getAddress(t); return ''; }
    catch { return 'Invalid address — must be a 42-character hex string starting with 0x.'; }
  }

  const tick = () => new Promise(r => setTimeout(r, 300));

  async function handleAnalyze() {
    const err = validate(address);
    if (err) { setInputError(err); inputRef.current?.focus(); return; }
    setInputError(''); setProbeResult(null); setAiResult(null); setApiError('');
    setShowAllFns(false); setLoading(true); setStep(0);
    try {
      setStep(0); await tick();
      setStep(1); await tick();
      const probe = await probeContract(address.trim());
      setStep(2); await tick();
      setProbeResult(probe);
      setStep(3); await tick();

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ functions: probe.functions.map(f => f.signature), unknownSelectors: probe.unknownSelectors, meta: probe.meta, bytecodeSize: probe.bytecodeSize }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI analysis failed');
      setAiResult(data);
    } catch (err) {
      setApiError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const localRisks = probeResult
    ? RISK_PATTERNS.filter(rp => probeResult.functions.some(fn => rp.pattern.test(fn.name)))
    : [];

  const mergedRisks = (() => {
    if (!aiResult) return localRisks.map(r => ({ label: r.label, level: r.level, description: r.desc }));
    const aiLabels = new Set((aiResult.risks || []).map(r => r.label));
    const extras = localRisks.filter(r => !aiLabels.has(r.label)).map(r => ({ label: r.label, level: r.level, description: r.desc }));
    return [...(aiResult.risks || []), ...extras];
  })();

  const visibleFns = probeResult ? (showAllFns ? probeResult.functions : probeResult.functions.slice(0, 8)) : [];
  const hasResults = probeResult || apiError;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="font-display font-bold text-3xl text-white">Analyzer</h1>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-blue-400 text-xs font-display font-medium tracking-wide uppercase">AI-Powered</span>
          </div>
        </div>
        <p className="text-slate-500 text-sm">Analyze contracts and decode transactions on Republic Testnet.</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 glass-card w-fit rounded-xl mb-6">
        <button
          onClick={() => setActiveTab('contract')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-display font-semibold transition-all ${activeTab === 'contract' ? 'bg-blue-600/80 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <IconCpu />
          Contract Analyzer
        </button>
        <button
          onClick={() => setActiveTab('tx')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-display font-semibold transition-all ${activeTab === 'tx' ? 'bg-blue-600/80 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <IconTx />
          Tx Explainer
        </button>
      </div>

      {activeTab === 'tx' ? <TxExplainer /> : (<div>

      {/* Input */}
      <div className="glass-card p-6 mb-6">
        <label className="block text-sm font-display text-slate-400 mb-2 font-medium">Contract Address</label>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"><IconSearch /></div>
            <input
              ref={inputRef}
              type="text"
              value={address}
              onChange={e => { setAddress(e.target.value); setInputError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
              placeholder="0x…"
              spellCheck={false}
              disabled={loading}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-blue-950/30 border border-blue-900/40 text-white font-mono text-sm placeholder-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-50 transition-all"
            />
          </div>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="btn-primary px-5 min-w-[120px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
          >
            {loading ? (
              <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg><span>Working…</span></>
            ) : (
              <><IconSearch /><span>Analyze</span></>
            )}
          </button>
        </div>
        {inputError && (
          <div className="mt-3 flex items-center gap-2 text-red-400 text-sm animate-fade-in">
            <IconWarn /><span>{inputError}</span>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-600">
          Queries the Republic Testnet RPC directly using ethers.js — no Etherscan key required.
        </p>
      </div>

      {/* Step indicator */}
      {loading && <StepIndicator step={step} />}

      {/* Error */}
      {apiError && !loading && (
        <div className="glass-card p-5 border border-red-500/20 flex gap-3 items-start animate-fade-in">
          <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 flex-shrink-0 mt-0.5"><IconWarn /></div>
          <div>
            <div className="text-red-400 font-display font-semibold text-sm mb-0.5">Analysis Failed</div>
            <div className="text-slate-400 text-sm">{apiError}</div>
          </div>
        </div>
      )}

      {/* Results */}
      {hasResults && !loading && !apiError && (
        <div className="space-y-4 animate-slide-up">

          {/* 1. Overview */}
          {probeResult && (
            <SectionCard icon={<IconCpu />} title="Contract Overview" accent="blue">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5 border-b border-blue-900/20">
                  <span className="text-slate-500 text-sm font-display">Address</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-blue-300 bg-blue-900/20 px-2.5 py-1 rounded-lg">{probeResult.address}</span>
                    <CopyButton value={probeResult.address} />
                  </div>
                </div>
                {(probeResult.meta?.name || probeResult.meta?.symbol) && (
                  <div className="flex items-center justify-between py-2.5 border-b border-blue-900/20">
                    <span className="text-slate-500 text-sm font-display">Token</span>
                    <span className="text-white font-display font-semibold">
                      {probeResult.meta.name}
                      {probeResult.meta.symbol && <span className="text-blue-400 ml-1.5">({probeResult.meta.symbol})</span>}
                    </span>
                  </div>
                )}
                {probeResult.meta?.decimals != null && (
                  <div className="flex items-center justify-between py-2.5 border-b border-blue-900/20">
                    <span className="text-slate-500 text-sm font-display">Decimals</span>
                    <span className="font-mono text-sm text-slate-300">{probeResult.meta.decimals}</span>
                  </div>
                )}
                {probeResult.meta?.totalSupplyFormatted && (
                  <div className="flex items-center justify-between py-2.5 border-b border-blue-900/20">
                    <span className="text-slate-500 text-sm font-display">Total Supply</span>
                    <span className="font-mono text-sm text-slate-300">
                      {Number(probeResult.meta.totalSupplyFormatted).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      {probeResult.meta.symbol ? ' ' + probeResult.meta.symbol : ''}
                    </span>
                  </div>
                )}
                {probeResult.meta?.owner && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5 border-b border-blue-900/20">
                    <span className="text-slate-500 text-sm font-display">Owner</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-blue-300 bg-blue-900/20 px-2.5 py-1 rounded-lg">{shortAddr(probeResult.meta.owner)}</span>
                      <CopyButton value={probeResult.meta.owner} />
                    </div>
                  </div>
                )}
                {probeResult.meta?.paused != null && (
                  <div className="flex items-center justify-between py-2.5 border-b border-blue-900/20">
                    <span className="text-slate-500 text-sm font-display">Paused</span>
                    <span className={`font-display font-semibold text-sm ${probeResult.meta.paused ? 'text-red-400' : 'text-green-400'}`}>
                      {probeResult.meta.paused ? '\u23f8 Yes' : '\u2713 No'}
                    </span>
                  </div>
                )}
                {probeResult.meta?.implementation && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5 border-b border-blue-900/20">
                    <span className="text-slate-500 text-sm font-display">Implementation</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-purple-300 bg-purple-900/20 px-2.5 py-1 rounded-lg">{shortAddr(probeResult.meta.implementation)}</span>
                      <CopyButton value={probeResult.meta.implementation} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-500 text-sm font-display">Bytecode Size</span>
                  <span className="font-mono text-sm text-slate-400">
                    {probeResult.bytecodeSize.toLocaleString()} bytes
                    <span className="text-slate-600 ml-1.5">({probeResult.unknownSelectors.length} unknown selector{probeResult.unknownSelectors.length !== 1 ? 's' : ''})</span>
                  </span>
                </div>
              </div>
            </SectionCard>
          )}

          {/* 2. AI summary */}
          {aiResult && (
            <SectionCard icon={<IconBrain />} title="AI Analysis" accent="purple">
              <div className="mb-5">
                <div className="text-xs font-display uppercase tracking-wider text-slate-500 mb-2">Contract Type</div>
                <TypePill value={aiResult.contractType} />
              </div>
              <div>
                <div className="text-xs font-display uppercase tracking-wider text-slate-500 mb-2">Summary</div>
                <p className="text-slate-300 text-sm leading-relaxed">{aiResult.summary}</p>
              </div>
              <p className="mt-5 text-slate-600 text-xs italic">
                AI analysis is informational only. Always verify contracts independently before interacting with them.
              </p>
            </SectionCard>
          )}

          {/* 3. Risks */}
          {mergedRisks.length > 0 ? (
            <SectionCard icon={<IconShield />} title={'Risk Signals (' + mergedRisks.length + ')'} accent="amber">
              <div className="space-y-3">
                {mergedRisks.map((r, i) => (
                  <div key={i} className={'flex items-start gap-3 p-3.5 rounded-xl border ' + (r.level === 'high' ? 'bg-red-500/4 border-red-500/15' : r.level === 'medium' ? 'bg-amber-500/4 border-amber-500/15' : 'bg-blue-500/4 border-blue-500/15')}>
                    <div className={'flex-shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ' + (r.level === 'high' ? 'bg-red-500/15 text-red-400' : r.level === 'medium' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400')}>
                      <IconWarn />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-display font-semibold text-white text-sm">{r.label}</span>
                        <RiskBadge level={r.level} />
                      </div>
                      <p className="text-slate-400 text-xs leading-snug">{r.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : aiResult && (
            <SectionCard icon={<IconShield />} title="Risk Signals" accent="green">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-green-500/5 border border-green-500/20">
                <div className="w-6 h-6 rounded-full bg-green-500/15 flex items-center justify-center text-green-400 flex-shrink-0"><IconCheck /></div>
                <span className="text-green-300 text-sm">No high-risk function patterns detected.</span>
              </div>
            </SectionCard>
          )}

          {/* 4. Functions */}
          {probeResult && probeResult.functions.length > 0 && (
            <SectionCard icon={<IconCpu />} title={'Detected Functions (' + probeResult.functions.length + ' matched)'} accent="cyan">
              <div className="space-y-2">
                {visibleFns.map((fn, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-blue-950/30 border border-blue-900/20 hover:border-blue-700/30 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-blue-300 text-sm font-medium truncate">{fn.name}</span>
                      {fn.params && <span className="font-mono text-slate-600 text-xs truncate hidden sm:block">({fn.params})</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="font-mono text-[10px] text-slate-600">{fn.selector}</span>
                      <MutBadge value={fn.stateMutability} />
                    </div>
                  </div>
                ))}
              </div>
              {probeResult.functions.length > 8 && (
                <button onClick={() => setShowAllFns(v => !v)} className="mt-3 w-full py-2 flex items-center justify-center gap-1.5 rounded-xl border border-blue-900/30 bg-blue-900/10 text-slate-400 hover:text-white hover:border-blue-500/40 text-sm font-display transition-all duration-200">
                  <span>{showAllFns ? 'Show fewer functions' : 'Show ' + (probeResult.functions.length - 8) + ' more functions'}</span>
                  <span className={'transition-transform duration-200 ' + (showAllFns ? 'rotate-180' : '')}><IconChevronDown /></span>
                </button>
              )}
              {probeResult.unknownSelectors.length > 0 && (
                <div className="mt-4 pt-4 border-t border-blue-900/20">
                  <div className="text-xs font-display uppercase tracking-wider text-slate-600 mb-2">
                    {probeResult.unknownSelectors.length} Unrecognised Selector{probeResult.unknownSelectors.length !== 1 ? 's' : ''}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {probeResult.unknownSelectors.slice(0, 12).map(s => (
                      <span key={s} className="font-mono text-[10px] text-slate-600 bg-slate-800/40 border border-slate-700/30 rounded px-2 py-0.5">{s}</span>
                    ))}
                    {probeResult.unknownSelectors.length > 12 && <span className="text-slate-600 text-xs self-center">+{probeResult.unknownSelectors.length - 12} more</span>}
                  </div>
                  <p className="text-slate-600 text-xs mt-2">These selectors appear in the bytecode but don't match our local signature database — they may be custom or less common functions.</p>
                </div>
              )}
            </SectionCard>
          )}

          {/* No functions */}
          {probeResult && probeResult.functions.length === 0 && (
            <div className="glass-card p-5 border border-amber-500/20 flex gap-3 items-start">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 flex-shrink-0"><IconInfo /></div>
              <div>
                <div className="text-amber-400 font-display font-semibold text-sm mb-0.5">No Known Functions Detected</div>
                <div className="text-slate-400 text-sm">
                  The bytecode contains {probeResult.unknownSelectors.length} unrecognised selectors.
                  This may be a minimal proxy, a non-standard contract, or a custom implementation not in our database.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !hasResults && (
        <div className="glass-card p-10 text-center border border-blue-900/20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-500/8 border border-blue-500/20 flex items-center justify-center text-blue-500/60">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <p className="text-slate-400 font-display font-medium mb-1">No contract analysed yet</p>
          <p className="text-slate-600 text-sm mb-8">Enter an address above and click <span className="text-blue-400">Analyze</span>.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
            {[
              { icon:'🔍', label:'Bytecode Scan', desc:'Reads raw bytecode from the RPC and extracts all PUSH4 function selectors — no explorer API.' },
              { icon:'🧠', label:'AI Classification', desc:'Sends detected functions to Claude to classify contract type and surface security risks.' },
              { icon:'🛡', label:'Risk Detection', desc:'Flags dangerous patterns: mint, pause, upgrade, blacklist, flashLoan, and more.' },
            ].map(({ icon, label, desc }) => (
              <div key={label} className="p-4 rounded-xl bg-blue-900/10 border border-blue-900/20 text-center">
                <div className="text-2xl mb-2">{icon}</div>
                <div className="text-blue-400 font-display font-semibold text-sm mb-1">{label}</div>
                <div className="text-slate-500 text-xs leading-snug">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>)}
    </div>
  );
}