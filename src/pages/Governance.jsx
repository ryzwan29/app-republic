import { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '../App.jsx';
import { getProposals, getProposalTally, getProposalVotes, getProposalDetail, getStakingPool } from '../blockchain/cosmos.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const DENOM_EXP = 1e18;

function parseStatus(raw = '') {
  const s = raw.toUpperCase();
  if (s.includes('VOTING'))   return 'active';
  if (s.includes('PASSED'))   return 'passed';
  if (s.includes('REJECTED')) return 'rejected';
  if (s.includes('FAILED'))   return 'rejected';
  if (s.includes('DEPOSIT'))  return 'deposit';
  return 'unknown';
}

function parseOption(opt = '') {
  const s = opt.toUpperCase();
  if (s.includes('NO_WITH_VETO') || s.includes('VETO')) return 'veto';
  if (s.includes('YES') && !s.includes('VETO')) return 'yes';
  if (s.includes('NO'))      return 'no';
  if (s.includes('ABSTAIN')) return 'abstain';
  return 'abstain';
}

function araiToRAI(str) { return parseFloat(str || '0') / DENOM_EXP; }

function fmtRAI(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (n === 0)  return '—';
  return n.toFixed(2);
}

function fmtType(raw = '') {
  return raw.replace(/^Msg/, '').replace(/([A-Z])/g, ' $1').trim() || 'Governance';
}

function fmtDateFull(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function timeAgo(str) {
  if (!str) return '';
  const diff = Date.now() - new Date(str).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 30) return `${Math.floor(d / 30)} month${Math.floor(d / 30) > 1 ? 's' : ''} ago`;
  if (d > 0)  return `${d} day${d > 1 ? 's' : ''} ago`;
  if (h > 0)  return `${h} hour${h > 1 ? 's' : ''} ago`;
  return `${m} minute${m !== 1 ? 's' : ''} ago`;
}

function duration(startStr, endStr) {
  if (!startStr || !endStr) return '—';
  const diff = new Date(endStr) - new Date(startStr);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${d}d ${h}h ${m}m ${s}s`;
}

function timeLeft(endStr) {
  if (!endStr) return '—';
  const diff = new Date(endStr) - Date.now();
  if (diff <= 0) return 'Ended';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  if (d > 0) return `${d}d ${h}h left`;
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m left`;
}

function truncAddr(addr = '') {
  if (addr.length <= 20) return addr;
  return addr.slice(0, 14) + '…' + addr.slice(-6);
}

// Recursively render raw message object fields
function MsgFields({ obj, depth = 0 }) {
  if (!obj || typeof obj !== 'object') return null;
  const skip = new Set(['@type']);
  return (
    <div className={depth > 0 ? 'ml-4 border-l border-blue-900/30 pl-3 mt-1' : ''}>
      {Object.entries(obj).filter(([k]) => !skip.has(k)).map(([k, v]) => {
        const isObj = v && typeof v === 'object' && !Array.isArray(v);
        const isArr = Array.isArray(v);
        return (
          <div key={k} className="mb-1.5">
            <span className="text-xs text-slate-500 font-mono">{k}</span>
            {isObj ? (
              <MsgFields obj={v} depth={depth + 1} />
            ) : isArr ? (
              <div className="ml-4 border-l border-blue-900/30 pl-3">
                {v.map((item, i) => (
                  <div key={i}>
                    {typeof item === 'object'
                      ? <MsgFields obj={item} depth={depth + 1} />
                      : <span className="block text-xs text-white font-mono break-all">{String(item)}</span>
                    }
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-white font-mono break-all mt-0.5">{String(v)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Design tokens ─────────────────────────────────────────────────────────────
const STATUS_CFG = {
  active:   { label: 'Voting',   dot: 'bg-blue-400',  text: 'text-blue-400',  border: 'border-blue-500/30',  bg: 'bg-blue-900/20',  pulse: true  },
  passed:   { label: 'Passed',   dot: 'bg-green-400', text: 'text-green-400', border: 'border-green-500/25', bg: 'bg-green-900/15', pulse: false },
  rejected: { label: 'Rejected', dot: 'bg-red-400',   text: 'text-red-400',   border: 'border-red-500/25',   bg: 'bg-red-900/10',   pulse: false },
  deposit:  { label: 'Deposit',  dot: 'bg-yellow-400',text: 'text-yellow-400',border: 'border-yellow-500/25',bg: 'bg-yellow-900/10',pulse: true  },
  unknown:  { label: 'Unknown',  dot: 'bg-slate-500', text: 'text-slate-400', border: 'border-slate-500/25', bg: 'bg-slate-800/20', pulse: false },
};

const VOTE_OPTS = [
  { key: 'yes',     label: 'Yes',         bar: 'bg-green-500',  text: 'text-green-400',  btn: 'bg-green-900/30 border-green-500/40 text-green-400 hover:bg-green-900/50' },
  { key: 'no',      label: 'No',          bar: 'bg-red-500',    text: 'text-red-400',    btn: 'bg-red-900/30 border-red-500/40 text-red-400 hover:bg-red-900/50' },
  { key: 'veto',    label: 'No With Veto',bar: 'bg-orange-500', text: 'text-orange-400', btn: 'bg-orange-900/30 border-orange-500/40 text-orange-400 hover:bg-orange-900/50' },
  { key: 'abstain', label: 'Abstain',     bar: 'bg-slate-500',  text: 'text-slate-400',  btn: 'bg-slate-800/50 border-slate-600/40 text-slate-400 hover:bg-slate-700/50' },
];

// ─── Tally section ────────────────────────────────────────────────────────────
function TallySection({ tally, bondedSupply }) {
  const yes     = araiToRAI(tally.yes);
  const no      = araiToRAI(tally.no);
  const abstain = araiToRAI(tally.abstain);
  const veto    = araiToRAI(tally.no_with_veto);
  const total   = yes + no + abstain + veto;
  const turnout = bondedSupply > 0 ? (total / bondedSupply) * 100 : 0;

  const rows = [
    { key: 'yes',     label: 'Yes',         val: yes,     opt: VOTE_OPTS[0] },
    { key: 'no',      label: 'No',          val: no,      opt: VOTE_OPTS[1] },
    { key: 'veto',    label: 'No With Veto',val: veto,    opt: VOTE_OPTS[2] },
    { key: 'abstain', label: 'Abstain',     val: abstain, opt: VOTE_OPTS[3] },
  ];

  return (
    <div className="rounded-xl bg-black/20 border border-blue-900/20 overflow-hidden">
      {/* Turnout header */}
      <div className="px-4 py-3 border-b border-blue-900/20 flex items-center justify-between">
        <span className="text-xs text-slate-500 font-display uppercase tracking-wider">Tally</span>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-slate-500">Turnout</span>
          <span className="font-mono font-bold text-white">
            {bondedSupply > 0 ? `${turnout.toFixed(2)}%` : `${fmtRAI(total)} RAI`}
          </span>
        </div>
      </div>

      {/* Vote rows */}
      <div className="divide-y divide-blue-900/10">
        {rows.map(({ key, label, val, opt }) => {
          const pct = total > 0 ? (val / total) * 100 : 0;
          return (
            <div key={key} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`w-24 text-xs font-display ${opt.text}`}>{label}</span>
              <div className="flex-1 h-1.5 bg-black/30 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${opt.bar}`} style={{ width: `${pct}%` }} />
              </div>
              <span className={`font-mono text-sm font-semibold w-14 text-right ${val > 0 ? opt.text : 'text-slate-700'}`}>
                {val > 0 ? `${pct.toFixed(2)}%` : '—'}
              </span>
              <span className="font-mono text-xs text-slate-600 w-24 text-right hidden sm:block">
                {val > 0 ? fmtRAI(val) + ' RAI' : ''}
              </span>
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="px-4 py-2 border-t border-blue-900/20 flex justify-between text-xs">
        <span className="text-slate-500">Total votes</span>
        <span className="font-mono text-slate-300">{fmtRAI(total)} RAI</span>
      </div>
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────
function Timeline({ proposal, status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.unknown;
  const steps = [
    {
      label: 'Submitted at',
      time:  proposal.submitTime,
      done:  true,
      color: 'bg-blue-500',
    },
    {
      label: 'Deposited at',
      time:  proposal.depositEnd,
      done:  true,
      color: 'bg-blue-500',
    },
    {
      label: 'Voting start',
      time:  proposal.votingStart,
      done:  !!proposal.votingStart,
      color: 'bg-blue-500',
      extra: proposal.votingStart && proposal.votingEnd
        ? `Duration: ${duration(proposal.votingStart, proposal.votingEnd)}`
        : null,
    },
    {
      label: status === 'active' ? 'Voting ends' : 'Voting ended',
      time:  proposal.votingEnd,
      done:  parseStatus(proposal.status) !== 'active',
      color: status === 'passed' ? 'bg-green-500' : status === 'rejected' ? 'bg-red-500' : 'bg-slate-600',
      isLast: true,
    },
  ];

  return (
    <div className="rounded-xl bg-black/20 border border-blue-900/20 p-4">
      <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-4">Timeline</div>
      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={i} className="flex gap-3">
            {/* Dot + line */}
            <div className="flex flex-col items-center">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${step.done ? step.color : 'bg-slate-700'}`} />
              {i < steps.length - 1 && (
                <div className={`w-px flex-1 mt-1 ${step.done ? 'bg-blue-900/40' : 'bg-slate-800'}`} style={{ minHeight: 20 }} />
              )}
            </div>
            {/* Content */}
            <div className="flex-1 pb-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-slate-400 font-display">{step.label}</span>
                {step.time && (
                  <span className="font-mono text-xs text-slate-300">{fmtDateFull(step.time)}</span>
                )}
              </div>
              {step.time && (
                <div className="text-xs text-slate-600 mt-0.5">{timeAgo(step.time)}</div>
              )}
              {step.extra && (
                <div className="text-xs text-blue-400 font-mono mt-0.5">{step.extra}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Current status */}
      <div className={`mt-4 pt-3 border-t border-blue-900/20 flex items-center gap-2`}>
        <span className="text-xs text-slate-500">Current Status:</span>
        <span className={`text-xs font-display font-semibold ${cfg.text}`}>{cfg.label}</span>
        {status === 'active' && proposal.votingEnd && (
          <span className="text-xs text-blue-400 font-mono ml-auto">{timeLeft(proposal.votingEnd)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Proposal card (list view) ─────────────────────────────────────────────────
function ProposalCard({ proposal, onOpen }) {
  const status  = parseStatus(proposal.status);
  const cfg     = STATUS_CFG[status] || STATUS_CFG.unknown;
  const yes     = araiToRAI(proposal.tally.yes);
  const no      = araiToRAI(proposal.tally.no);
  const abstain = araiToRAI(proposal.tally.abstain);
  const veto    = araiToRAI(proposal.tally.no_with_veto);
  const total   = yes + no + abstain + veto;
  const yesPct  = total > 0 ? ((yes / total) * 100).toFixed(0) : 0;

  return (
    <div
      className={`glass-card p-5 border ${cfg.border} cursor-pointer group hover:border-opacity-60 transition-all`}
      onClick={() => onOpen(proposal)}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-xs text-slate-500 font-mono">#{proposal.id}</span>
            <span className="text-xs px-2 py-0.5 rounded-full border border-blue-500/20 bg-blue-900/20 text-blue-400 font-display">
              {fmtType(proposal.type)}
            </span>
          </div>
          <h3 className="font-display font-semibold text-white text-sm leading-snug group-hover:text-blue-300 transition-colors">
            {proposal.title}
          </h3>
        </div>
        <div className={`flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full border text-xs font-display ${cfg.text} ${cfg.border} ${cfg.bg}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`}/>
          {cfg.label}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-3">
        <span><span className="text-slate-500">Submitted </span><span className="text-slate-300">{fmtDateFull(proposal.submitTime)}</span></span>
        {status === 'active'
          ? <span className="text-blue-400 font-mono">{timeLeft(proposal.votingEnd)}</span>
          : <span><span className="text-slate-500">Ended </span><span className="text-slate-300">{timeAgo(proposal.votingEnd)}</span></span>
        }
      </div>

      {total > 0 && (
        <>
          <div className="h-1.5 bg-black/30 rounded-full overflow-hidden flex mb-1">
            {VOTE_OPTS.map(opt => {
              const v   = { yes, no, abstain, veto }[opt.key];
              const pct = (v / total) * 100;
              return pct > 0 ? (
                <div key={opt.key} className={`h-full ${opt.bar}`} style={{ width: `${pct}%` }}/>
              ) : null;
            })}
          </div>
          <div className="flex justify-between text-xs text-slate-600">
            <span className="text-green-500">{yesPct}% Yes</span>
            <span>{fmtRAI(total)} RAI · Click to view detail</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Detail Modal ──────────────────────────────────────────────────────────────
function ProposalModal({ proposal, onClose, walletAddress, myVote, onVote, bondedSupply }) {
  const [tab,     setTab]     = useState('overview');
  const [votes,   setVotes]   = useState([]);
  const [tally,   setTally]   = useState(proposal.tally);
  const [detail,  setDetail]  = useState(proposal);
  const [loading, setLoading] = useState(false);

  const status = parseStatus(proposal.status);
  const cfg    = STATUS_CFG[status] || STATUS_CFG.unknown;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [liveT, liveV, liveD] = await Promise.all([
          getProposalTally(proposal.id),
          getProposalVotes(proposal.id),
          getProposalDetail(proposal.id),
        ]);
        setTally(liveT);
        setVotes(liveV);
        if (liveD) setDetail(liveD);
      } catch {}
      setLoading(false);
    }
    load();
  }, [proposal.id]);

  // All raw message objects (skip @type key for display, show it as header)
  const messages = detail.messages || [];

  const TABS = [
    { key: 'overview',  label: 'Overview' },
    { key: 'messages',  label: `Messages (${messages.length})` },
    { key: 'tally',     label: 'Tally' },
    { key: 'timeline',  label: 'Timeline' },
    { key: 'votes',     label: `Voters${votes.length > 0 ? ` (${votes.length})` : ''}` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col animate-slide-up">

        {/* ── Modal header ── */}
        <div className="p-5 border-b border-blue-900/30 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-xs text-slate-500 font-mono">#{detail.id}</span>
              <span className="text-xs px-2 py-0.5 rounded-full border border-blue-500/20 bg-blue-900/20 text-blue-400 font-display">
                {fmtType(detail.type)}
              </span>
              <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-display ${cfg.text} ${cfg.border} ${cfg.bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`}/>
                {cfg.label}
              </div>
              {loading && <span className="text-xs text-slate-600 animate-pulse">Loading…</span>}
            </div>
            <h2 className="font-display font-bold text-white text-base leading-snug">{detail.title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-xl leading-none shrink-0 mt-0.5">✕</button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-blue-900/30 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-xs font-display font-semibold whitespace-nowrap transition-colors border-b-2 ${
                tab === t.key ? 'text-white border-blue-500' : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* OVERVIEW */}
          {tab === 'overview' && (
            <>
              {detail.summary ? (
                <div className="p-4 rounded-xl bg-black/20 border border-blue-900/20">
                  <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-2">Description</div>
                  <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{detail.summary}</p>
                </div>
              ) : (
                <div className="text-slate-600 text-sm italic">No description provided on-chain.</div>
              )}

              {/* Quick tally preview */}
              <TallySection tally={tally} bondedSupply={bondedSupply} />

              {/* Vote buttons */}
              {status === 'active' && (
                <div className="rounded-xl bg-black/20 border border-blue-900/20 p-4">
                  <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-3">Cast Your Vote</div>
                  {walletAddress ? (
                    <>
                      {myVote && (
                        <div className="mb-3 p-2.5 rounded-lg bg-blue-900/20 border border-blue-500/30 text-xs text-blue-300 font-display">
                          ✓ You voted: <span className="font-bold capitalize">{myVote}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {VOTE_OPTS.map(opt => (
                          <button key={opt.key} onClick={() => onVote(proposal.id, opt.key)}
                            className={`py-2.5 rounded-xl border text-xs font-display font-semibold transition-all ${opt.btn} ${myVote === opt.key ? 'ring-2 ring-current ring-offset-1 ring-offset-black/50' : ''}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-slate-500 text-sm py-2">Connect Keplr wallet to vote</div>
                  )}
                </div>
              )}
            </>
          )}

          {/* MESSAGES */}
          {tab === 'messages' && (
            <div className="space-y-3">
              {messages.length === 0 ? (
                <div className="text-slate-600 text-sm italic">No message data available.</div>
              ) : messages.map((msg, i) => {
                const msgType = msg['@type'] || 'Unknown';
                const { ['@type']: _t, ...rest } = msg;
                return (
                  <div key={i} className="rounded-xl bg-black/20 border border-blue-900/20 overflow-hidden">
                    {/* type header */}
                    <div className="px-4 py-2.5 border-b border-blue-900/20 bg-blue-900/10">
                      <div className="text-xs text-slate-500 font-mono mb-0.5">@type</div>
                      <div className="font-mono text-xs text-blue-300 break-all">{msgType}</div>
                    </div>
                    {/* fields */}
                    <div className="px-4 py-3 space-y-2">
                      <MsgFields obj={rest} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TALLY */}
          {tab === 'tally' && (
            <TallySection tally={tally} bondedSupply={bondedSupply} />
          )}

          {/* TIMELINE */}
          {tab === 'timeline' && (
            <Timeline proposal={detail} status={status} />
          )}

          {/* VOTERS */}
          {tab === 'votes' && (
            <div>
              {loading ? (
                <div className="space-y-2">
                  {[1,2,3,4].map(i => <div key={i} className="h-11 rounded-xl bg-blue-900/20 animate-pulse"/>)}
                </div>
              ) : votes.length === 0 ? (
                <div className="text-center text-slate-500 py-10">
                  <div className="text-4xl mb-3">🗳</div>
                  <div className="font-display">No votes recorded on-chain</div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {votes.map((v, i) => {
                    const mainOpt = v.options?.[0];
                    const optKey  = parseOption(mainOpt?.option || '');
                    const opt     = VOTE_OPTS.find(o => o.key === optKey) || VOTE_OPTS[3];
                    const weight  = mainOpt?.weight ? `${(parseFloat(mainOpt.weight) * 100).toFixed(0)}%` : null;
                    return (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-blue-900/20 hover:border-blue-500/30 transition-colors">
                        <span className="font-mono text-xs text-slate-600 w-5 text-right shrink-0">{i + 1}</span>
                        <span className="flex-1 font-mono text-xs text-slate-300 truncate">{truncAddr(v.voter)}</span>
                        {weight && weight !== '100%' && (
                          <span className="font-mono text-xs text-slate-600 shrink-0">{weight}</span>
                        )}
                        <span className={`text-xs font-display font-semibold capitalize shrink-0 ${opt.text}`}>{optKey}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Governance() {
  const { evmAddress, cosmosAddress } = useWallet();
  const walletAddress = cosmosAddress || evmAddress;

  const [proposals,    setProposals]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [selected,     setSelected]     = useState(null);
  const [filter,       setFilter]       = useState('all');
  const [myVotes,      setMyVotes]      = useState({});
  const [bondedSupply, setBondedSupply] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [data, pool] = await Promise.all([getProposals(), getStakingPool()]);
      setProposals(data);
      setBondedSupply(parseFloat(pool.bondedTokens) / DENOM_EXP);
      if (data.length === 0) setError('No proposals found on-chain yet.');
    } catch {
      setError('Failed to load proposals. Check your connection.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const castVote = (id, choice) => {
    setMyVotes(p => ({ ...p, [id]: choice }));
    setSelected(p => p?.id === id ? { ...p } : p);
  };

  const filtered = useMemo(() =>
    filter === 'all' ? proposals : proposals.filter(p => parseStatus(p.status) === filter),
    [proposals, filter]
  );

  const counts = useMemo(() => ({
    active:   proposals.filter(p => parseStatus(p.status) === 'active').length,
    passed:   proposals.filter(p => parseStatus(p.status) === 'passed').length,
    rejected: proposals.filter(p => parseStatus(p.status) === 'rejected').length,
    deposit:  proposals.filter(p => parseStatus(p.status) === 'deposit').length,
  }), [proposals]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display font-bold text-3xl text-white">Governance</h1>
          <p className="text-slate-500 text-sm mt-1">On-chain proposals · Republic Testnet</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Voting',   count: counts.active,   color: 'text-blue-400'   },
          { label: 'Passed',   count: counts.passed,   color: 'text-green-400'  },
          { label: 'Rejected', count: counts.rejected, color: 'text-red-400'    },
          { label: 'Deposit',  count: counts.deposit,  color: 'text-yellow-400' },
        ].map(x => (
          <div key={x.label} className="glass-card p-4 text-center">
            <div className={`font-display font-bold text-2xl ${x.color}`}>
              {loading ? <div className="w-8 h-7 rounded bg-blue-900/30 animate-pulse mx-auto"/> : x.count}
            </div>
            <div className="text-xs text-slate-500 mt-1">{x.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1 mb-6 p-1 glass-card w-fit rounded-xl">
        {[
          { key: 'all',      label: `All (${proposals.length})` },
          { key: 'active',   label: `Voting (${counts.active})` },
          { key: 'passed',   label: `Passed (${counts.passed})` },
          { key: 'rejected', label: `Rejected (${counts.rejected})` },
          ...(counts.deposit > 0 ? [{ key: 'deposit', label: `Deposit (${counts.deposit})` }] : []),
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-display font-semibold transition-all ${
              filter === f.key ? 'bg-blue-600/80 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {!walletAddress && (
        <div className="mb-4 p-3 rounded-xl bg-blue-900/20 border border-blue-500/30 text-sm text-blue-300 font-display text-center">
          Connect Keplr wallet to vote on active proposals
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="glass-card p-5 space-y-3">
              <div className="flex gap-2"><div className="w-12 h-3 rounded bg-blue-900/30 animate-pulse"/><div className="w-20 h-3 rounded bg-blue-900/30 animate-pulse"/></div>
              <div className="w-2/3 h-4 rounded bg-blue-900/20 animate-pulse"/>
              <div className="w-full h-1.5 rounded bg-blue-900/20 animate-pulse"/>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="glass-card p-12 text-center">
          <div className="text-4xl mb-4">🗳</div>
          <div className="font-display text-white text-lg mb-2">No Proposals Found</div>
          <div className="text-slate-500 text-sm mb-6">{error}</div>
          <button onClick={load} className="btn-secondary">Try Again</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center text-slate-500 font-display">No proposals in this category</div>
      ) : (
        <div className="space-y-4">
          {filtered.map(p => (
            <ProposalCard key={p.id} proposal={p} onOpen={setSelected}/>
          ))}
        </div>
      )}

      {selected && (
        <ProposalModal
          proposal={selected}
          onClose={() => setSelected(null)}
          walletAddress={walletAddress}
          myVote={myVotes[selected.id]}
          onVote={castVote}
          bondedSupply={bondedSupply}
        />
      )}
    </div>
  );
}