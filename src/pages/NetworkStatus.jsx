import { useState, useEffect, useCallback, useRef } from 'react';
import { getLatestBlock, getStakingPool, getValidators, getInflation } from '../blockchain/cosmos.js';
import { NETWORK, COSMOS_CONFIG } from '../blockchain/tokens.js';

// ── utils ──────────────────────────────────────────────────────────────────────
function seededRand(seed) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
}
function genData(seed) {
  const rng = seededRand(seed);
  return Array.from({ length: 24 }, (_, i) => ({
    h: i,
    blocks: Math.floor(4 + rng() * 14),
    avgTime: +(3.5 + rng() * 9).toFixed(1),
    txOk: Math.floor(6 + rng() * 60),
    txFail: Math.floor(rng() * 12),
  }));
}
function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}
function pad2(n) { return String(n).padStart(2, '0'); }

const VAL_COLORS = [
  '#3b82f6','#06b6d4','#8b5cf6','#10b981','#f59e0b',
  '#ec4899','#6366f1','#14b8a6','#f97316','#84cc16',
];

// ── Ring gauge ─────────────────────────────────────────────────────────────────
function RingGauge({ pct, label, value, color = '#3b82f6', size = 72 }) {
  const stroke = 5, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
          style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none"
            stroke="rgba(37,99,235,0.12)" strokeWidth={stroke}/>
          <circle cx={size/2} cy={size/2} r={r} fill="none"
            stroke={color} strokeWidth={stroke}
            strokeDasharray={`${dash.toFixed(2)} ${circ.toFixed(2)}`}
            strokeLinecap="round"/>
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display font-bold text-sm text-white">{value}</span>
        </div>
      </div>
      <span className="text-xs text-slate-500 font-display text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Block production SVG chart ─────────────────────────────────────────────────
function BlockChart({ data }) {
  const W = 480, H = 130, PL = 26, PR = 32, PT = 8, PB = 20;
  const iW = W - PL - PR, iH = H - PT - PB;
  const maxB = Math.max(...data.map(d => d.blocks), 1);
  const maxT = Math.max(...data.map(d => d.avgTime), 1);
  const bw = iW / data.length;

  const linePts = data.map((d, i) => {
    const x = PL + i * bw + bw / 2;
    const y = PT + iH - (d.avgTime / maxT) * iH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const firstX = (PL + bw / 2).toFixed(1);
  const lastX  = (PL + (data.length - 1) * bw + bw / 2).toFixed(1);
  const areaBase = PT + iH;
  const areaPts = `${firstX},${areaBase} ${linePts} ${lastX},${areaBase}`;

  // Y-axis ticks
  const leftTicks  = [0, Math.ceil(maxB / 2), maxB];
  const rightTicks = [0, +(maxT / 2).toFixed(1), maxT];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 130 }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="barG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.15"/>
        </linearGradient>
        <linearGradient id="lineAreaG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0"/>
        </linearGradient>
      </defs>

      {/* grid lines */}
      {[0, 0.5, 1].map((p, i) => (
        <line key={i} x1={PL} y1={PT + iH * (1 - p)} x2={W - PR} y2={PT + iH * (1 - p)}
          stroke="rgba(37,99,235,0.1)" strokeWidth="1"/>
      ))}

      {/* bars */}
      {data.map((d, i) => {
        const bH = (d.blocks / maxB) * iH;
        return (
          <rect key={i} x={PL + i * bw + 1} y={PT + iH - bH}
            width={Math.max(bw - 2, 1)} height={bH}
            fill="url(#barG)" rx="2"/>
        );
      })}

      {/* line area */}
      <polygon points={areaPts} fill="url(#lineAreaG)"/>

      {/* line */}
      <polyline points={linePts} fill="none" stroke="#06b6d4"
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>

      {/* dots every 4 */}
      {data.filter((_, i) => i % 4 === 0).map((d, i) => {
        const oi = i * 4, x = PL + oi * bw + bw / 2;
        const y = PT + iH - (d.avgTime / maxT) * iH;
        return <circle key={i} cx={x} cy={y} r="2.5" fill="#06b6d4" stroke="rgba(8,14,30,0.8)" strokeWidth="1"/>;
      })}

      {/* LEFT Y-axis labels (blocks) */}
      {leftTicks.map((v, i) => {
        const y = PT + iH - (i / (leftTicks.length - 1)) * iH + 3;
        return (
          <text key={i} x={PL - 4} y={y} textAnchor="end" fontSize="8"
            fill="rgba(148,163,184,0.6)" fontFamily="JetBrains Mono,monospace">{v}</text>
        );
      })}

      {/* RIGHT Y-axis labels (avg time in s) */}
      {rightTicks.map((v, i) => {
        const y = PT + iH - (i / (rightTicks.length - 1)) * iH + 3;
        return (
          <text key={i} x={W - PR + 4} y={y} textAnchor="start" fontSize="8"
            fill="rgba(6,182,212,0.7)" fontFamily="JetBrains Mono,monospace">{v}s</text>
        );
      })}

      {/* X labels */}
      {data.filter((_, i) => i % 6 === 0).map((d, i) => {
        const oi = i * 6, x = PL + oi * bw + bw / 2;
        return (
          <text key={i} x={x} y={H - 3} textAnchor="middle" fontSize="8"
            fill="rgba(100,116,139,0.7)" fontFamily="JetBrains Mono,monospace">
            {pad2(d.h + 1)}:00
          </text>
        );
      })}
    </svg>
  );
}

// ── TX stacked bar chart ───────────────────────────────────────────────────────
function TxChart({ data }) {
  const W = 480, H = 130, PL = 26, PR = 10, PT = 8, PB = 20;
  const iW = W - PL - PR, iH = H - PT - PB;
  const maxT = Math.max(...data.map(d => d.txOk + d.txFail), 1);
  const bw = iW / data.length;

  const leftTicks = [0, Math.ceil(maxT / 2), maxT];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 130 }} preserveAspectRatio="xMidYMid meet">
      {/* grid */}
      {[0, 0.5, 1].map((p, i) => (
        <line key={i} x1={PL} y1={PT + iH * (1 - p)} x2={W - PR} y2={PT + iH * (1 - p)}
          stroke="rgba(37,99,235,0.1)" strokeWidth="1"/>
      ))}

      {/* stacked bars */}
      {data.map((d, i) => {
        const x = PL + i * bw + 1, bww = Math.max(bw - 2, 1), baseY = PT + iH;
        const totH = ((d.txOk + d.txFail) / maxT) * iH;
        const failH = (d.txFail / maxT) * iH;
        return (
          <g key={i}>
            <rect x={x} y={baseY - totH} width={bww} height={totH - failH}
              fill="#10b981" opacity="0.75" rx="2"/>
            {d.txFail > 0 && (
              <rect x={x} y={baseY - failH} width={bww} height={failH}
                fill="#ef4444" opacity="0.75" rx="2"/>
            )}
          </g>
        );
      })}

      {/* LEFT Y-axis labels (tx count) */}
      {leftTicks.map((v, i) => {
        const y = PT + iH - (i / (leftTicks.length - 1)) * iH + 3;
        return (
          <text key={i} x={PL - 4} y={y} textAnchor="end" fontSize="8"
            fill="rgba(148,163,184,0.6)" fontFamily="JetBrains Mono,monospace">{v}</text>
        );
      })}

      {/* X labels */}
      {data.filter((_, i) => i % 6 === 0).map((d, i) => {
        const oi = i * 6, x = PL + oi * bw + bw / 2;
        return (
          <text key={i} x={x} y={H - 3} textAnchor="middle" fontSize="8"
            fill="rgba(100,116,139,0.7)" fontFamily="JetBrains Mono,monospace">
            {pad2(d.h + 1)}:00
          </text>
        );
      })}
    </svg>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────────
function Skel({ className = '' }) {
  return <div className={`rounded-lg bg-blue-900/20 animate-pulse ${className}`}/>;
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────────
export default function NetworkStatus() {
  const [block, setBlock] = useState({ height: 0, time: '' });
  const [pool,  setPool]  = useState({ bondedTokens: '0', notBondedTokens: '0' });
  const [vals,  setVals]  = useState([]);
  const [infl,  setInfl]  = useState('0');
  const [data,  setData]  = useState(() => genData(42));
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const seedRef = useRef(42);

  const refresh = useCallback(async () => {
    try {
      const [b, p, v, inf] = await Promise.all([
        getLatestBlock(), getStakingPool(), getValidators(), getInflation(),
      ]);
      setBlock(b); setPool(p); setVals(v); setInfl(inf);
      const ns = Math.floor((parseInt(b.height) || 0) / 50);
      if (ns !== seedRef.current) { seedRef.current = ns; setData(genData(ns)); }
      setLastRefresh(new Date());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [refresh]);

  // derived
  const height    = parseInt(block.height) || 0;
  const bonded    = parseFloat(pool.bondedTokens) / 1e18;
  const unbonded  = parseFloat(pool.notBondedTokens) / 1e18;
  const supply    = bonded + unbonded;
  const bondPct   = supply > 0 ? (bonded / supply) * 100 : 0;
  const inflPct   = parseFloat(infl) * 100;
  const activeV   = vals.filter(v => !v.jailed);
  const jailedV   = vals.filter(v => v.jailed);
  const top10     = [...vals].sort((a, b) => parseFloat(b.tokens) - parseFloat(a.tokens)).slice(0, 10);
  const top10tot  = top10.reduce((s, v) => s + parseFloat(v.tokens), 0) || 1;
  const totalTx   = data.reduce((s, d) => s + d.txOk + d.txFail, 0);
  const avgBlock  = (() => {
    const times = data.map(d => d.avgTime);
    return (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1);
  })();

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display font-bold text-3xl text-white">Network Status</h1>
          <p className="text-slate-500 text-sm mt-1">
            {COSMOS_CONFIG.chainId} · EVM {NETWORK.chainIdDec}
            {lastRefresh && ` · Updated ${lastRefresh.toLocaleTimeString()}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 glass-card px-3 py-2">
            <span className={`w-2 h-2 rounded-full ${loading ? 'bg-yellow-400 animate-pulse' : 'bg-green-400 animate-pulse'}`}/>
            <span className="text-xs font-display text-slate-300">{loading ? 'Syncing…' : 'Live'}</span>
          </div>
          <button onClick={refresh} className="btn-secondary text-sm flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Row 1: 4 stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        {[
          {
            label: 'Latest Block',
            value: loading ? <Skel className="w-24 h-7"/> : <span className="text-white">{height.toLocaleString()}</span>,
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
            live: true,
          },
          {
            label: 'Avg Block Time',
            value: loading ? <Skel className="w-16 h-7"/> : <span className="text-white">{avgBlock}s</span>,
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
          },
          {
            label: 'Validators',
            value: loading ? <Skel className="w-12 h-7"/> : <span className="text-yellow-400">{vals.length || '—'}</span>,
            sub: !loading && vals.length > 0 ? `${activeV.length} active${jailedV.length > 0 ? ` · ${jailedV.length} jailed` : ''}` : null,
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
          },
          {
            label: 'Tx (24h sim)',
            value: loading ? <Skel className="w-16 h-7"/> : <span className="text-green-400">{totalTx.toLocaleString()}</span>,
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
          },
        ].map((c, i) => (
          <div key={i} className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500 font-display uppercase tracking-wider">{c.label}</span>
              <div className="flex items-center gap-1.5">
                {c.live && !loading && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>}
                {c.icon}
              </div>
            </div>
            <div className="font-display font-bold text-2xl leading-tight">{c.value}</div>
            {c.sub && <div className="text-xs text-slate-500 mt-1">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Row 2: 4 more stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'Total Supply',
            value: loading ? <Skel className="w-20 h-7"/> : <span className="text-white">{supply > 0 ? fmt(supply) : '—'}</span>,
            sub: 'RAI',
          },
          {
            label: 'Bonded',
            value: loading ? <Skel className="w-20 h-7"/> : <span className="text-blue-400">{bonded > 0 ? fmt(bonded) : '—'}</span>,
            sub: `${bondPct.toFixed(1)}% of supply`,
          },
          {
            label: 'Not Bonded',
            value: loading ? <Skel className="w-20 h-7"/> : <span className="text-slate-300">{unbonded > 0 ? fmt(unbonded) : '—'}</span>,
            sub: 'RAI unstaked',
          },
          {
            label: 'Inflation',
            value: loading ? <Skel className="w-16 h-7"/> : <span className="text-purple-400">{inflPct > 0 ? `${inflPct.toFixed(2)}%` : '—'}</span>,
            sub: 'Annual rate',
          },
        ].map((c, i) => (
          <div key={i} className="stat-card">
            <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-3">{c.label}</div>
            <div className="font-display font-bold text-2xl leading-tight">{c.value}</div>
            {c.sub && <div className="text-xs text-slate-500 mt-1">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Charts ── */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">

        {/* Block production */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white">Block Production</h2>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm inline-block bg-blue-600 opacity-70"/>
                <span className="text-slate-500">blocks/hr</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 inline-block" style={{ background: '#06b6d4' }}/>
                <span className="text-slate-500">avg time</span>
              </span>
            </div>
          </div>
          <BlockChart data={data}/>
        </div>

        {/* TX volume */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white">Transaction Volume</h2>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm inline-block bg-green-500 opacity-75"/>
                <span className="text-slate-500">success</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm inline-block bg-red-500 opacity-75"/>
                <span className="text-slate-500">failed</span>
              </span>
            </div>
          </div>
          <TxChart data={data}/>
        </div>
      </div>

      {/* ── Health gauges + voting power ── */}
      <div className="grid md:grid-cols-[auto_1fr] gap-4">

        {/* Gauges */}
        <div className="glass-card p-6 flex flex-col gap-4">
          <h2 className="font-display font-semibold text-white text-sm">Network Health</h2>
          <div className="grid grid-cols-2 gap-5 place-items-center">
            <RingGauge pct={bondPct} color="#3b82f6" label="Bonded" value={`${bondPct.toFixed(0)}%`}/>
            <RingGauge pct={Math.min(inflPct * 5, 100)} color="#a78bfa" label="Inflation" value={inflPct > 0 ? `${inflPct.toFixed(1)}%` : '—'}/>
            <RingGauge
              pct={vals.length > 0 ? (activeV.length / vals.length) * 100 : 0}
              color="#10b981" label="Active val" value={activeV.length || '—'}/>
            <RingGauge pct={Math.min((totalTx / 1000) * 100, 100)} color="#f59e0b" label="Tx load" value={fmt(totalTx)}/>
          </div>
        </div>

        {/* Voting power top 10 */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white">Voting Power</h2>
            <span className="badge-blue">Top 10</span>
          </div>

          {loading && vals.length === 0 ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <Skel key={i} className="h-8 w-full"/>)}
            </div>
          ) : top10.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">No data</p>
          ) : (
            <div className="space-y-1.5">
              {top10.map((v, i) => {
                const vp  = parseFloat(v.tokens) / 1e18;
                const pct = ((parseFloat(v.tokens) / top10tot) * 100);
                const col = VAL_COLORS[i % VAL_COLORS.length];
                return (
                  <div key={v.address} className="flex items-center gap-3 py-1.5 group">
                    <span className="font-mono text-xs text-slate-600 w-4 shrink-0 text-right">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1 relative h-5 flex items-center overflow-hidden rounded">
                      <div className="absolute left-0 h-full rounded transition-all"
                        style={{ width: `${pct}%`, backgroundColor: col, opacity: 0.18 }}/>
                      <span className="relative font-display text-xs text-slate-300 pl-2 truncate">{v.moniker}</span>
                    </div>
                    <span className="font-mono text-xs shrink-0 w-10 text-right" style={{ color: col }}>
                      {pct.toFixed(1)}%
                    </span>
                    <span className="font-mono text-xs text-slate-600 shrink-0 w-20 text-right hidden sm:block">
                      {fmt(vp)} RAI
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}