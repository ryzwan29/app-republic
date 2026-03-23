import { useState, useEffect, useCallback, useRef } from 'react';
import { getLatestBlock, getStakingPool, getValidators, getInflation, getTotalSupply, getRecentBlocks, get24hChartData, getDailyTxData } from '../blockchain/cosmos.js';
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

// ── Tooltip hook ───────────────────────────────────────────────────────────────
function useChartTooltip() {
  const [tooltip, setTooltip] = useState(null); // {x, y, content}
  const show = (x, y, content) => setTooltip({ x, y, content });
  const hide = () => setTooltip(null);
  return { tooltip, show, hide };
}

function ChartTooltip({ tooltip }) {
  if (!tooltip) return null;
  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
    >
      <div className="glass-card px-3 py-2.5 border border-blue-500/30 shadow-xl min-w-[140px]">
        {tooltip.content}
      </div>
    </div>
  );
}

// ── Block production chart ─────────────────────────────────────────────────────
function BlockChart({ data, onHover, onLeave }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
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
  const leftTicks  = [0, Math.ceil(maxB / 2), maxB];
  const rightTicks = [0, +(maxT / 2).toFixed(1), maxT];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 130 }}
      preserveAspectRatio="xMidYMid meet"
      onMouseLeave={() => { setHoveredIdx(null); onLeave(); }}>
      <defs>
        <linearGradient id="barG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.15"/>
        </linearGradient>
        <linearGradient id="barGHov" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.4"/>
        </linearGradient>
        <linearGradient id="lineAreaG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0"/>
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {[0, 0.5, 1].map((p, i) => (
        <line key={i} x1={PL} y1={PT + iH * (1 - p)} x2={W - PR} y2={PT + iH * (1 - p)}
          stroke="rgba(37,99,235,0.1)" strokeWidth="1"/>
      ))}

      {/* Bars + invisible full-height hit area */}
      {data.map((d, i) => {
        const bH  = (d.blocks / maxB) * iH;
        const x   = PL + i * bw + 1;
        const bww = Math.max(bw - 2, 1);
        const isHov = hoveredIdx === i;
        return (
          <g key={i}
            className="cursor-pointer"
            onMouseMove={e => { setHoveredIdx(i); onHover(e.clientX, e.clientY, d); }}
            onMouseEnter={() => setHoveredIdx(i)}
          >
            {/* Highlight column background on hover */}
            {isHov && (
              <rect x={x} y={PT} width={bww} height={iH}
                fill="rgba(59,130,246,0.06)" rx="2"/>
            )}
            {/* Actual bar */}
            <rect x={x} y={PT + iH - bH} width={bww} height={bH}
              fill={isHov ? 'url(#barGHov)' : 'url(#barG)'}
              rx="2"/>
            {/* Full-height invisible hit area — ensures hover works even on short bars */}
            <rect x={x} y={PT} width={bww} height={iH}
              fill="transparent"/>
          </g>
        );
      })}

      {/* Line area + line */}
      <polygon points={areaPts} fill="url(#lineAreaG)"/>
      <polyline points={linePts} fill="none" stroke="#06b6d4"
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>

      {/* Line dots */}
      {data.filter((_, i) => i % 4 === 0).map((d, i) => {
        const oi = i * 4, x = PL + oi * bw + bw / 2;
        const y  = PT + iH - (d.avgTime / maxT) * iH;
        return <circle key={i} cx={x} cy={y} r="2.5" fill="#06b6d4"
          stroke="rgba(8,14,30,0.8)" strokeWidth="1" style={{ pointerEvents: 'none' }}/>;
      })}

      {/* Y-axis labels */}
      {leftTicks.map((v, i) => {
        const y = PT + iH - (i / (leftTicks.length - 1)) * iH + 3;
        return <text key={i} x={PL - 4} y={y} textAnchor="end" fontSize="8"
          fill="rgba(148,163,184,0.6)" fontFamily="JetBrains Mono,monospace">{v}</text>;
      })}
      {rightTicks.map((v, i) => {
        const y = PT + iH - (i / (rightTicks.length - 1)) * iH + 3;
        return <text key={i} x={W - PR + 4} y={y} textAnchor="start" fontSize="8"
          fill="rgba(6,182,212,0.7)" fontFamily="JetBrains Mono,monospace">{v}s</text>;
      })}

      {/* X-axis labels */}
      {data.filter((_, i) => i % 6 === 0).map((d, i) => {
        const oi = i * 6, x = PL + oi * bw + bw / 2;
        return <text key={i} x={x} y={H - 3} textAnchor="middle" fontSize="8"
          fill="rgba(100,116,139,0.7)" fontFamily="JetBrains Mono,monospace">
          {pad2(d.h + 1)}:00</text>;
      })}
    </svg>
  );
}

// ── TX Daily chart (1 bar = 1 hari) ──────────────────────────────────────────
function TxChart({ data, onHover, onLeave }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const W = 480, H = 130, PL = 32, PR = 10, PT = 8, PB = 22;
  const iW = W - PL - PR, iH = H - PT - PB;
  const maxT = Math.max(...data.map(d => d.txOk + d.txFail), 1);
  const bw   = iW / data.length;
  const leftTicks = [0, Math.ceil(maxT / 2), maxT];

  function fmtNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 130 }}
      preserveAspectRatio="xMidYMid meet"
      onMouseLeave={() => { setHoveredIdx(null); onLeave(); }}>

      {/* Grid */}
      {[0, 0.5, 1].map((p, i) => (
        <line key={i} x1={PL} y1={PT + iH * (1 - p)} x2={W - PR} y2={PT + iH * (1 - p)}
          stroke="rgba(37,99,235,0.1)" strokeWidth="1"/>
      ))}

      {/* Bars */}
      {data.map((d, i) => {
        const x    = PL + i * bw + 1;
        const bww  = Math.max(bw - 3, 2);
        const baseY = PT + iH;
        const tot   = d.txOk + d.txFail;
        const totH  = (tot / maxT) * iH;
        const failH = (d.txFail / maxT) * iH;
        const isHov = hoveredIdx === i;
        return (
          <g key={i} className="cursor-pointer"
            onMouseMove={e => { setHoveredIdx(i); onHover(e.clientX, e.clientY, d); }}
            onMouseEnter={() => setHoveredIdx(i)}>
            {/* Hover highlight */}
            {isHov && (
              <rect x={x} y={PT} width={bww} height={iH}
                fill="rgba(16,185,129,0.07)" rx="2"/>
            )}
            {/* Success bar */}
            <rect x={x} y={baseY - totH} width={bww} height={Math.max(totH - failH, 0)}
              fill="#10b981" opacity={isHov ? 0.95 : 0.75} rx="2"/>
            {/* Fail bar */}
            {d.txFail > 0 && (
              <rect x={x} y={baseY - failH} width={bww} height={failH}
                fill="#ef4444" opacity={isHov ? 0.95 : 0.75}/>
            )}
            {/* Invisible full-height hit area */}
            <rect x={x} y={PT} width={bww} height={iH} fill="transparent"/>
          </g>
        );
      })}

      {/* Y-axis ticks */}
      {leftTicks.map((v, i) => {
        const y = PT + iH - (i / (leftTicks.length - 1)) * iH + 3;
        return <text key={i} x={PL - 4} y={y} textAnchor="end" fontSize="8"
          fill="rgba(148,163,184,0.6)" fontFamily="JetBrains Mono,monospace">{fmtNum(v)}</text>;
      })}

      {/* X-axis: date labels for each bar */}
      {data.map((d, i) => {
        const step = data.length <= 10 ? 1 : data.length <= 16 ? 2 : 3;
        if (i % step !== 0) return null;
        return (
          <text key={i} x={PL + i * bw + bw / 2} y={H - 4} textAnchor="middle" fontSize="7.5"
            fill={hoveredIdx === i ? 'rgba(16,185,129,0.8)' : 'rgba(100,116,139,0.7)'}
            fontFamily="JetBrains Mono,monospace">
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

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

function Skel({ className = '' }) {
  return <div className={`rounded-lg bg-blue-900/20 animate-pulse ${className}`}/>;
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────────
export default function NetworkStatus() {
  const [block,       setBlock]       = useState({ height: 0, time: '' });
  const [pool,        setPool]        = useState({ bondedTokens: '0', notBondedTokens: '0' });
  const [vals,        setVals]        = useState([]);
  const [infl,        setInfl]        = useState('0');
  const [totalSupply, setTotalSupply] = useState(0);
  const [avgBlockTime, setAvgBlockTime] = useState(null);
  const [chartData,     setChartData]     = useState(() => genData(42)); // fallback block data
  const [txDailyData,   setTxDailyData]   = useState(null);  // daily tx bars
  const [chartReal,     setChartReal]     = useState(false);
  const [txChartReal,   setTxChartReal]   = useState(false);
  const [totalTx24h,    setTotalTx24h]    = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const seedRef = useRef(42);

  // Tooltip states
  const blockTooltip = useChartTooltip();
  const txTooltip    = useChartTooltip();

  // Fast refresh: stats + block chart (every 6s)
  const refresh = useCallback(async () => {
    try {
      const [b, p, v, inf, supply, chartResult] = await Promise.all([
        getLatestBlock(), getStakingPool(), getValidators(),
        getInflation(), getTotalSupply(), get24hChartData(),
      ]);
      setBlock(b); setPool(p); setVals(v); setInfl(inf);
      if (supply > 0) setTotalSupply(supply);

      if (chartResult) {
        setChartData(chartResult.buckets);
        setChartReal(true);
        setTotalTx24h(chartResult.totalTx24h);
        setAvgBlockTime(chartResult.avgBlockTimeSec);
      } else {
        const ns = Math.floor((parseInt(b.height) || 0) / 50);
        if (ns !== seedRef.current) { seedRef.current = ns; setChartData(genData(ns)); }
        setChartReal(false);
      }
      setLastRefresh(new Date());
    } catch {}
    setLoading(false);
  }, []);

  // Slow fetch: daily TX chart — only once on mount (heavy, ~20 requests)
  const fetchDailyTx = useCallback(async () => {
    try {
      const dailyTx = await getDailyTxData(14);
      if (dailyTx) {
        setTxDailyData(dailyTx.buckets);
        setTxChartReal(true);
        setTotalTx24h(prev => prev !== null ? prev : dailyTx.totalTx);
      } else {
        setTxChartReal(false);
      }
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    fetchDailyTx(); // one-time on mount
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [refresh, fetchDailyTx]);

  // derived
  const height    = parseInt(block.height) || 0;
  const bonded    = parseFloat(pool.bondedTokens) / 1e18;
  const unbonded  = parseFloat(pool.notBondedTokens) / 1e18;
  const supply    = totalSupply > 0 ? totalSupply : bonded + unbonded;
  const bondPct   = supply > 0 ? (bonded / supply) * 100 : 0;
  const inflPct   = parseFloat(infl) * 100;
  const activeV   = vals.filter(v => !v.jailed);
  const jailedV   = vals.filter(v => v.jailed);
  const top10     = [...vals].sort((a, b) => parseFloat(b.tokens) - parseFloat(a.tokens)).slice(0, 10);
  const top10tot  = top10.reduce((s, v) => s + parseFloat(v.tokens), 0) || 1;
  // TX total: gunakan real kalau ada, fallback ke sum simulasi
  const totalTx   = totalTx24h !== null
    ? totalTx24h
    : (txDailyData || chartData).reduce((s, d) => s + d.txOk + d.txFail, 0);
  // Avg block time: real dari chain, fallback simulasi
  const avgBlock  = avgBlockTime
    ? avgBlockTime.toFixed(1) + 's'
    : (chartData.reduce((a, b) => a + b.avgTime, 0) / chartData.length).toFixed(1) + 's';

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">

      {/* Tooltips — rendered at root level */}
      <ChartTooltip tooltip={blockTooltip.tooltip} />
      <ChartTooltip tooltip={txTooltip.tooltip} />

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

      {/* ── Row 1 stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        {[
          {
            label: 'Latest Block', accent: 'text-white', live: true,
            value: loading ? <Skel className="w-24 h-7"/> : height.toLocaleString(),
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
          },
          {
            label: 'Avg Block Time', accent: 'text-white',
            value: loading ? <Skel className="w-16 h-7"/> : avgBlock,
            sub: avgBlockTime ? 'from last 20 blocks · real' : 'simulated',
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
          },
          {
            label: 'Validators', accent: 'text-yellow-400',
            value: loading ? <Skel className="w-12 h-7"/> : vals.length || '—',
            sub: !loading && vals.length > 0 ? `${activeV.length} active${jailedV.length > 0 ? ` · ${jailedV.length} jailed` : ''}` : null,
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
          },
          {
            label: 'Tx (14d)', accent: 'text-green-400',
            value: loading ? <Skel className="w-16 h-7"/> : totalTx.toLocaleString(),
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
            <div className={`font-display font-bold text-2xl leading-tight ${c.accent}`}>{c.value}</div>
            {c.sub && <div className="text-xs text-slate-500 mt-1">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Row 2 stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'Total Supply', accent: 'text-white',
            value: loading ? <Skel className="w-20 h-7"/> : (supply > 0 ? fmt(supply) : '—'),
            sub: totalSupply > 0 ? 'RAI · from bank module' : 'RAI · from staking pool',
          },
          {
            label: 'Bonded', accent: 'text-blue-400',
            value: loading ? <Skel className="w-20 h-7"/> : (bonded > 0 ? fmt(bonded) : '—'),
            sub: `${bondPct.toFixed(1)}% of supply`,
          },
          {
            label: 'Not Bonded', accent: 'text-slate-300',
            value: loading ? <Skel className="w-20 h-7"/> : (unbonded > 0 ? fmt(unbonded) : '—'),
            sub: 'RAI unstaked',
          },
          {
            label: 'Inflation', accent: 'text-purple-400',
            value: loading ? <Skel className="w-16 h-7"/> : (inflPct > 0 ? `${inflPct.toFixed(2)}%` : '—'),
            sub: 'Annual rate',
          },
        ].map((c, i) => (
          <div key={i} className="stat-card">
            <div className="text-xs text-slate-500 font-display uppercase tracking-wider mb-3">{c.label}</div>
            <div className={`font-display font-bold text-2xl leading-tight ${c.accent}`}>{c.value}</div>
            {c.sub && <div className="text-xs text-slate-500 mt-1">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Charts ── */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">

        {/* Block production */}
        <div className="glass-card p-5" data-chart>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display font-semibold text-white">Block Production</h2>
              {chartReal
                ? <span className="badge-green text-xs">Real</span>
                : <span className="text-[10px] text-slate-600 font-mono">simulated</span>
              }
            </div>
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
          <BlockChart
            data={chartData}
            onHover={(x, y, d) => blockTooltip.show(x, y,
              <div className="space-y-1">
                <div className="text-xs text-slate-400 font-display font-semibold border-b border-blue-900/30 pb-1 mb-1">
                  {pad2(d.h + 1)}:00 – {pad2(d.h + 2)}:00
                </div>
                <div className="flex justify-between gap-4 text-xs">
                  <span className="text-slate-500">Blocks</span>
                  <span className="font-mono font-bold text-blue-400">{d.blocks}</span>
                </div>
                <div className="flex justify-between gap-4 text-xs">
                  <span className="text-slate-500">Avg time</span>
                  <span className="font-mono font-bold text-cyan-400">{d.avgTime}s</span>
                </div>
              </div>
            )}
            onLeave={blockTooltip.hide}
          />
        </div>

        {/* TX volume */}
        <div className="glass-card p-5" data-chart>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display font-semibold text-white">Transaction Volume</h2>
              {txChartReal
                ? <span className="badge-green text-xs">Real</span>
                : <span className="text-[10px] text-slate-600 font-mono">simulated</span>
              }
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-500 font-mono">1 bar = 1 day</span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm inline-block bg-green-500 opacity-75"/>
                <span className="text-slate-500">tx</span>
              </span>
            </div>
          </div>
          <TxChart
            data={txDailyData || chartData}
            onHover={(x, y, d) => txTooltip.show(x, y,
              <div className="space-y-1">
                <div className="text-xs text-slate-400 font-display font-semibold border-b border-blue-900/30 pb-1 mb-1">
                  {d.label || `${pad2((d.h||0) + 1)}:00`}
                </div>
                <div className="flex justify-between gap-4 text-xs">
                  <span className="text-slate-500">Transactions</span>
                  <span className="font-mono font-bold text-green-400">{(d.txOk + d.txFail).toLocaleString()}</span>
                </div>
                {d.blocksInDay && (
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-slate-500">Blocks</span>
                    <span className="font-mono font-bold text-blue-400">{d.blocksInDay.toLocaleString()}</span>
                  </div>
                )}
                {d.txFail > 0 && (
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-slate-500">Failed</span>
                    <span className="font-mono font-bold text-red-400">{d.txFail}</span>
                  </div>
                )}
              </div>
            )}
            onLeave={txTooltip.hide}
          />
        </div>
      </div>

      {/* ── Health + Voting power ── */}
      <div className="grid md:grid-cols-[auto_1fr] gap-4">
        <div className="glass-card p-6 flex flex-col gap-4">
          <h2 className="font-display font-semibold text-white text-sm">Network Health</h2>
          <div className="grid grid-cols-2 gap-5 place-items-center">
            <RingGauge pct={bondPct} color="#3b82f6" label="Bonded" value={`${bondPct.toFixed(0)}%`}/>
            <RingGauge pct={Math.min(inflPct * 5, 100)} color="#a78bfa" label="Inflation" value={inflPct > 0 ? `${inflPct.toFixed(1)}%` : '—'}/>
            <RingGauge pct={vals.length > 0 ? (activeV.length / vals.length) * 100 : 0}
              color="#10b981" label="Active val" value={activeV.length || '—'}/>
            <RingGauge pct={Math.min((totalTx / 1000) * 100, 100)} color="#f59e0b" label="Tx load" value={fmt(totalTx)}/>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white">Voting Power</h2>
            <span className="badge-blue">Top 10</span>
          </div>
          {loading && vals.length === 0 ? (
            <div className="space-y-2">{[1,2,3,4,5].map(i => <Skel key={i} className="h-8 w-full"/>)}</div>
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