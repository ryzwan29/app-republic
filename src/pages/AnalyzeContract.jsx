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

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AnalyzeContract() {
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
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-blue-400 text-xs font-display font-medium tracking-wide uppercase">Bytecode · ethers.js · AI</span>
        </div>
        <h1 className="font-display font-bold text-3xl text-white mb-2">Contract Analyzer</h1>
        <p className="text-slate-400 text-base max-w-md mx-auto">
          Paste any EVM contract address. We read its bytecode directly from the RPC,
          detect its functions, and generate an AI security summary — no explorer needed.
        </p>
      </div>

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
    </div>
  );
}