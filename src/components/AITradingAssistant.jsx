import { useState, useRef, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useAI } from '../contexts/AIContext.jsx';
import { useWallet } from '../App.jsx';
import { TokenIcon } from './TokenSelector.jsx';
import {
  getAmountOut,
  executeSwap,
  addLiquidity,
  removeLiquidity,
  isOracleSwapPair,
  getUserLPBalance,
  invalidatePoolCache,
} from '../blockchain/amm.js';
import {
  stake,
  unstake,
  redelegate,
  claimReward,
  claimAllRewards,
  withdrawValidatorCommission,
  getValidators,
  getAllUserDelegations,
  getValidatorInfoByDelegator,
} from '../blockchain/staking.js';
import { getWeb3Provider } from '../blockchain/evm.js';
import { CONTRACTS, TOKENS, POOL_PAIRS } from '../blockchain/tokens.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const WRAI_ABI = [
  'function deposit() external payable',
  'function withdraw(uint256 amount) external',
];

function isWrapPair(from, to) {
  return (from === 'RAI' && to === 'WRAI') || (from === 'WRAI' && to === 'RAI');
}

const SUGGESTED_PROMPTS = [
  'Swap 100 USDC to WETH',
  'Simulate 500 USDT to WETH',
  'Add liquidity 1 WRAI + 2000 USDC',
  'Stake 10 RAI to validator',
  'Claim all staking rewards',
  'Show WRAI-USDC pool stats',
];

const ACTION_META = {
  swap:             { label: 'Swap',             icon: '⇄', color: 'blue',   txLabel: 'Confirm Swap'          },
  simulate_swap:    { label: 'Simulate Swap',    icon: '◎', color: 'cyan',   txLabel: null                    },
  best_route:       { label: 'Best Route',       icon: '⬡', color: 'violet', txLabel: null                    },
  add_liquidity:    { label: 'Add Liquidity',    icon: '+', color: 'green',  txLabel: 'Confirm Add Liquidity'  },
  remove_liquidity: { label: 'Remove Liquidity', icon: '−', color: 'amber',  txLabel: 'Confirm Remove'        },
  pool_info:        { label: 'Pool Analytics',   icon: '⬡', color: 'indigo', txLabel: null                    },
  stake:            { label: 'Stake',            icon: '⬆', color: 'green',  txLabel: 'Confirm Stake'         },
  unstake:          { label: 'Unstake',          icon: '⬇', color: 'amber',  txLabel: 'Confirm Unstake'       },
  redelegate:       { label: 'Redelegate',       icon: '↷', color: 'violet', txLabel: 'Confirm Redelegate'    },
  claim_rewards:    { label: 'Claim Rewards',    icon: '◈', color: 'cyan',   txLabel: 'Claim Rewards'         },
  claim_commission: { label: 'Claim Commission', icon: '◈', color: 'indigo', txLabel: 'Claim Commission'      },
};

const COLORS = {
  blue:   { bg: 'rgba(37,99,235,0.12)',  border: 'rgba(59,130,246,0.35)',  text: '#60a5fa', badge: 'rgba(37,99,235,0.22)'  },
  cyan:   { bg: 'rgba(6,182,212,0.10)',  border: 'rgba(34,211,238,0.30)',  text: '#22d3ee', badge: 'rgba(6,182,212,0.18)'  },
  violet: { bg: 'rgba(124,58,237,0.10)', border: 'rgba(167,139,250,0.30)', text: '#a78bfa', badge: 'rgba(124,58,237,0.18)' },
  green:  { bg: 'rgba(16,185,129,0.10)', border: 'rgba(52,211,153,0.30)',  text: '#34d399', badge: 'rgba(16,185,129,0.18)' },
  amber:  { bg: 'rgba(245,158,11,0.10)', border: 'rgba(251,191,36,0.30)',  text: '#fbbf24', badge: 'rgba(245,158,11,0.18)' },
  indigo: { bg: 'rgba(79,70,229,0.10)',  border: 'rgba(129,140,248,0.30)', text: '#818cf8', badge: 'rgba(79,70,229,0.18)'  },
};

const ORACLE_PAIRS = new Set([
  'WETH-USDC','USDC-WETH','WETH-USDT','USDT-WETH',
  'WBTC-USDC','USDC-WBTC','WBTC-USDT','USDT-WBTC',
  'WETH-WBTC','WBTC-WETH','USDC-USDT','USDT-USDC',
]);

function inferRoute(tokenIn, tokenOut) {
  if (ORACLE_PAIRS.has(`${tokenIn}-${tokenOut}`)) return { path: [tokenIn, tokenOut], type: 'Oracle' };
  if (tokenIn === 'RAI' || tokenIn === 'WRAI' || tokenOut === 'RAI' || tokenOut === 'WRAI')
    return { path: [tokenIn, tokenOut], type: 'AMM' };
  return { path: [tokenIn, 'WRAI', tokenOut], type: 'AMM' };
}

// ─── Route Viz ────────────────────────────────────────────────────────────────

function RouteViz({ path, type }) {
  const clr = type === 'Oracle' ? COLORS.cyan : COLORS.blue;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {path.map((sym, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={clr.text} strokeWidth="2.5" style={{ opacity: 0.8 }}>
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: clr.badge, border: `1px solid ${clr.border}`, color: clr.text, fontWeight: 700, letterSpacing: '0.07em' }}>
                {type}
              </span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={clr.text} strokeWidth="2.5" style={{ opacity: 0.8 }}>
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <TokenIcon symbol={sym} size={16} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{sym}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatRow({ label, value, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(30,58,138,0.2)' }}>
      <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.7)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: valueColor || '#e2e8f0', fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

// ─── Action Card ──────────────────────────────────────────────────────────────

function ActionCard({ action, onExecute, executing, quote }) {
  if (!action) return null;
  const meta   = ACTION_META[action.action] || { label: action.action, icon: '⬡', color: 'blue', txLabel: null };
  const colors = COLORS[meta.color] || COLORS.blue;
  const canExecute = !!meta.txLabel;

  const tokenIn  = action.token_in  || action.tokenA;
  const tokenOut = action.token_out || action.tokenB;
  const tokens = (() => {
    switch (action.action) {
      case 'swap': case 'simulate_swap': case 'best_route':
        return [action.token_in, action.token_out].filter(Boolean).map(t => t.toUpperCase());
      case 'add_liquidity':
        return [action.tokenA, action.tokenB].filter(Boolean).map(t => t.toUpperCase());
      case 'remove_liquidity': case 'pool_info':
        return (action.pair || '').split('-').filter(Boolean).map(t => t.toUpperCase());
      default: return [];
    }
  })();

  const routeInfo = (action.action === 'best_route' || action.action === 'simulate_swap') && tokenIn && tokenOut
    ? inferRoute(tokenIn.toUpperCase(), tokenOut.toUpperCase())
    : null;

  const MOCK_POOL = {
    'WRAI-USDT': { tvl: '$284,320', vol24h: '$41,200', apr: '14.2%', depth: 'High', impact: '0.08%' },
    'WRAI-USDC': { tvl: '$312,880', vol24h: '$56,700', apr: '18.1%', depth: 'High', impact: '0.06%' },
    'WRAI-WETH': { tvl: '$98,540',  vol24h: '$22,100', apr: '22.3%', depth: 'Medium', impact: '0.22%' },
    'WRAI-WBTC': { tvl: '$71,200',  vol24h: '$18,900', apr: '26.5%', depth: 'Medium', impact: '0.28%' },
  };
  const poolKey  = tokens.length === 2 ? (Object.keys(MOCK_POOL).find(k => tokens.every(t => k.includes(t))) || null) : null;
  const poolData = action.action === 'pool_info' && poolKey ? MOCK_POOL[poolKey] : null;

  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 12, padding: '12px 14px', marginTop: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: colors.badge, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: colors.text, fontWeight: 700, flexShrink: 0 }}>
          {meta.icon}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: colors.text, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {meta.label}
        </span>
      </div>

      {/* Token pair */}
      {tokens.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          {tokens.map((sym, i) => (
            <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth="2.5" style={{ opacity: 0.7 }}>
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <TokenIcon symbol={sym} size={18} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{sym}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Swap summary */}
      {(action.action === 'swap') && (
        <div style={{ marginBottom: 10 }}>
          <StatRow label="You Pay"        value={`${action.amount} ${(action.token_in || '').toUpperCase()}`} />
          <StatRow label="You Receive"    value={quote ? `≈ ${parseFloat(quote).toFixed(6)} ${(action.token_out || '').toUpperCase()}` : 'Fetching quote...'} valueColor="#34d399" />
          <StatRow label="Swap Type"      value={ORACLE_PAIRS.has(`${(action.token_in||'').toUpperCase()}-${(action.token_out||'').toUpperCase()}`) ? 'Oracle (0.1% fee)' : 'AMM (0.3% fee)'} valueColor={colors.text} />
          <StatRow label="Slippage"       value="0.5%" />
        </div>
      )}

      {/* Simulate swap result */}
      {(action.action === 'simulate_swap') && (
        <div style={{ marginBottom: 10 }}>
          <StatRow label="Input Amount"      value={`${action.amount} ${(action.token_in || '').toUpperCase()}`} />
          <StatRow label="Estimated Output"  value={quote ? `≈ ${parseFloat(quote).toFixed(6)} ${(action.token_out || '').toUpperCase()}` : 'Calculating...'} valueColor="#22d3ee" />
          <StatRow label="Swap Type"         value={ORACLE_PAIRS.has(`${(action.token_in||'').toUpperCase()}-${(action.token_out||'').toUpperCase()}`) ? 'Oracle (0.1% fee)' : 'AMM (0.3% fee)'} valueColor={colors.text} />
          {quote && (
            <StatRow
              label="Rate"
              value={`1 ${(action.token_in||'').toUpperCase()} ≈ ${(parseFloat(quote) / parseFloat(action.amount)).toFixed(6)} ${(action.token_out||'').toUpperCase()}`}
              valueColor="rgba(148,163,184,0.8)"
            />
          )}
          <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(34,211,238,0.15)', fontSize: 10, color: 'rgba(34,211,238,0.65)', letterSpacing: '0.04em' }}>
            ◎ Simulation only — no transaction will be sent
          </div>
        </div>
      )}

      {/* Add liquidity summary */}
      {action.action === 'add_liquidity' && action.amountA && (
        <div style={{ marginBottom: 10 }}>
          <StatRow label={`${(action.tokenA||'').toUpperCase()} Amount`} value={String(action.amountA)} />
          <StatRow label={`${(action.tokenB||'').toUpperCase()} Amount`} value={action.amountB ? String(action.amountB) : 'Auto-calculated'} />
        </div>
      )}

      {/* Route viz */}
      {routeInfo && (
        <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize: 10, color: 'rgba(100,116,139,0.7)', marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {action.action === 'best_route' ? 'Optimal Route' : 'Routing Path'}
          </div>
          <RouteViz path={routeInfo.path} type={routeInfo.type} />
          {action.amount && (
            <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.6)', marginTop: 6 }}>
              Amount: <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{action.amount} {(action.token_in||'').toUpperCase()}</span>
            </div>
          )}
        </div>
      )}

      {/* Pool analytics */}
      {poolData && (
        <div style={{ marginBottom: 10 }}>
          <StatRow label="Total Liquidity (TVL)" value={poolData.tvl}    valueColor="#60a5fa" />
          <StatRow label="24h Volume"             value={poolData.vol24h} />
          <StatRow label="Fee APR"                value={poolData.apr}    valueColor="#34d399" />
          <StatRow label="Liquidity Depth"        value={poolData.depth}  valueColor={poolData.depth === 'High' ? '#34d399' : '#fbbf24'} />
          <StatRow label="Est. Price Impact (1K)" value={poolData.impact} valueColor="#34d399" />
        </div>
      )}

      {/* Staking — Stake */}
      {action.action === 'stake' && (
        <div style={{ marginBottom: 10 }}>
          <StatRow label="Amount"    value={`${action.amount} RAI`} />
          <StatRow label="Validator" value={action.validator || '—'} valueColor={colors.text} />
          <StatRow label="Network"   value="Republic Testnet (Cosmos)" valueColor="rgba(148,163,184,0.7)" />
          <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(52,211,153,0.18)', fontSize: 10, color: 'rgba(52,211,153,0.7)', letterSpacing: '0.04em' }}>
            🔑 Requires Keplr wallet
          </div>
        </div>
      )}

      {/* Staking — Unstake */}
      {action.action === 'unstake' && (
        <div style={{ marginBottom: 10 }}>
          <StatRow label="Amount"    value={`${action.amount} RAI`} />
          <StatRow label="Validator" value={action.validator || '—'} valueColor={colors.text} />
          <StatRow label="Unbonding" value="~21 days unbonding period" valueColor="#fbbf24" />
          <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(251,191,36,0.18)', fontSize: 10, color: 'rgba(251,191,36,0.7)', letterSpacing: '0.04em' }}>
            🔑 Requires Keplr wallet
          </div>
        </div>
      )}

      {/* Staking — Redelegate */}
      {action.action === 'redelegate' && (
        <div style={{ marginBottom: 10 }}>
          <StatRow label="Amount"         value={`${action.amount} RAI`} />
          <StatRow label="From Validator" value={action.src_validator || '—'} valueColor="#fca5a5" />
          <StatRow label="To Validator"   value={action.dst_validator || '—'} valueColor="#34d399" />
          <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(167,139,250,0.18)', fontSize: 10, color: 'rgba(167,139,250,0.7)', letterSpacing: '0.04em' }}>
            🔑 Requires Keplr wallet
          </div>
        </div>
      )}

      {/* Staking — Claim Rewards */}
      {action.action === 'claim_rewards' && (
        <div style={{ marginBottom: 10 }}>
          <StatRow label="From" value={action.validator === 'all' ? 'All Validators' : (action.validator || 'All Validators')} valueColor={colors.text} />
          <StatRow label="Token" value="RAI" />
          <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(34,211,238,0.18)', fontSize: 10, color: 'rgba(34,211,238,0.7)', letterSpacing: '0.04em' }}>
            🔑 Requires Keplr wallet
          </div>
        </div>
      )}

      {/* Staking — Claim Commission */}
      {action.action === 'claim_commission' && (
        <div style={{ marginBottom: 10 }}>
          <StatRow label="Type"  value="Validator Commission" valueColor={colors.text} />
          <StatRow label="Token" value="RAI" />
          <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(79,70,229,0.06)', border: '1px solid rgba(129,140,248,0.18)', fontSize: 10, color: 'rgba(129,140,248,0.7)', letterSpacing: '0.04em' }}>
            🔑 Requires Keplr wallet — validator operators only
          </div>
        </div>
      )}

      {/* Execute button (only for actionable types) */}
      {canExecute && (
        <button
          onClick={onExecute}
          disabled={executing}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 8,
            background: executing ? 'rgba(37,99,235,0.15)' : colors.badge,
            border: `1px solid ${colors.border}`,
            color: executing ? 'rgba(148,163,184,0.5)' : colors.text,
            fontSize: 12, fontWeight: 700, cursor: executing ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s', letterSpacing: '0.06em', textTransform: 'uppercase',
            fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}
          onMouseEnter={e => { if (!executing) { e.currentTarget.style.filter = 'brightness(1.3)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}}
          onMouseLeave={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.transform = ''; }}
        >
          {executing ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'aiSpin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10"/>
              </svg>
              Waiting for wallet...
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              {meta.txLabel}
            </>
          )}
        </button>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '10px 14px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(96,165,250,0.7)', animation: `aiDot 1.2s ${i * 0.2}s ease-in-out infinite` }} />
      ))}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function AITradingAssistant() {
  const { isOpen, setIsOpen } = useAI();
  const { evmAddress, connectEVM, cosmosAddress, connectKeplr, refreshBalances, addNotification, removeNotification } = useWallet();

  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);
  // Per-message execution state: { [msgId]: { executing, quote } }
  const [execState, setExecState]   = useState({});

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen, loading]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
      if (!hasGreeted) {
        setHasGreeted(true);
        setMessages([{
          id: Date.now(), role: 'assistant', ts: new Date(), action: null,
          text: "Hey! I'm your AI trading assistant. Tell me what to do and I'll execute it — just confirm in your wallet. Try: \"swap 100 USDC to WETH\" or \"add liquidity 100 WRAI + 100 USDT\".",
        }]);
      }
    }
  }, [isOpen, hasGreeted]);

  // When AI returns a swap / simulate_swap action, pre-fetch the quote
  async function fetchQuote(msgId, action) {
    if (action.action !== 'swap' && action.action !== 'simulate_swap') return;
    const { token_in, token_out, amount } = action;
    if (!token_in || !token_out || !amount) return;
    try {
      const out = await getAmountOut(String(amount), token_in.toUpperCase(), token_out.toUpperCase());
      setExecState(prev => ({ ...prev, [msgId]: { ...prev[msgId], quote: out } }));
    } catch {
      // quote failed silently — user still sees the card
    }
  }

  // ── Resolve validator moniker/partial name → valoper address ─────────────
  async function resolveValidator(input) {
    if (!input) throw new Error('Please specify a validator name or address.');
    const trimmed = input.trim();
    // If it already looks like a valoper address, use directly
    if (trimmed.startsWith('raivaloper')) return trimmed;
    // Otherwise fetch validator list and fuzzy-match by moniker
    const validators = await getValidators();
    const q = trimmed.toLowerCase();
    const match = validators.find(v =>
      v.moniker?.toLowerCase() === q ||
      v.moniker?.toLowerCase().includes(q) ||
      v.address?.toLowerCase() === q
    );
    if (!match) throw new Error(`Validator "${trimmed}" not found. Check the Stake page for available validators.`);
    return match.address;
  }

  const sendMessage = useCallback(async (text) => {
    const userText = (text || input).trim();
    if (!userText || loading) return;
    setInput('');

    const userMsg = { id: Date.now(), role: 'user', ts: new Date(), action: null, text: userText };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const history = [...messages, userMsg]
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.text }));

    try {
      const res  = await fetch('/api/trading-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI service error');

      const aiMsgId = Date.now() + 1;
      const aiMsg   = {
        id: aiMsgId, role: 'assistant', ts: new Date(),
        text:    data.reply  || 'Done.',
        action:  data.action || null,
        isError: false,
      };
      setMessages(prev => [...prev, aiMsg]);
      setExecState(prev => ({ ...prev, [aiMsgId]: { executing: false, quote: null } }));

      // Pre-fetch quote for swap / simulate_swap actions
      if (data.action?.action === 'swap' || data.action?.action === 'simulate_swap') {
        fetchQuote(aiMsgId, data.action);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'assistant', ts: new Date(), action: null,
        text: `⚠️ ${err.message || 'Could not reach AI. Check OPENAI_API_KEY.'}`,
        isError: true,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, messages, loading]);

  // ── Execute blockchain action directly ────────────────────────────────────
  async function handleExecute(msgId, action) {
    if (!action) return;

    const STAKING_ACTIONS = ['stake', 'unstake', 'redelegate', 'claim_rewards', 'claim_commission'];
    const isStaking = STAKING_ACTIONS.includes(action.action);

    // Wallet check
    if (isStaking) {
      if (!cosmosAddress) {
        addNotification('Connect your Keplr wallet first to use staking features.', 'warning');
        connectKeplr();
        return;
      }
    } else {
      if (!evmAddress) {
        addNotification('Connect your MetaMask wallet first.', 'warning');
        connectEVM();
        return;
      }
    }

    setExecState(prev => ({ ...prev, [msgId]: { ...prev[msgId], executing: true } }));
    const pendingId = addNotification('Transaction pending — confirm in your wallet...', 'pending', 0);

    try {
      switch (action.action) {

        case 'swap': {
          const fromSym = (action.token_in  || '').toUpperCase();
          const toSym   = (action.token_out || '').toUpperCase();
          const amount  = String(action.amount || 0);

          if (isWrapPair(fromSym, toSym)) {
            const p = await getWeb3Provider();
            const wrai = new ethers.Contract(CONTRACTS.WRAI, WRAI_ABI, await p.getSigner());
            if (fromSym === 'RAI') {
              await (await wrai.deposit({ value: ethers.parseEther(amount) })).wait();
            } else {
              await (await wrai.withdraw(ethers.parseEther(amount))).wait();
            }
          } else {
            // Get fresh quote for amountOutMin
            const quote = execState[msgId]?.quote || await getAmountOut(amount, fromSym, toSym);
            if (!quote || parseFloat(quote) === 0) {
              throw new Error('No liquidity available for this pair.');
            }
            await executeSwap({
              fromSymbol: fromSym, toSymbol: toSym,
              amountIn: amount, amountOutMin: quote,
              slippage: 0.5, userAddress: evmAddress,
            });
          }
          addNotification(`✓ Swapped ${amount} ${fromSym} → ${toSym}`, 'success');
          invalidatePoolCache();
          await refreshBalances();

          // Update message to show success
          setMessages(prev => prev.map(m =>
            m.id === msgId
              ? { ...m, text: m.text + `\n\n✓ Done! Swapped ${amount} ${fromSym} → ${toSym}.` }
              : m
          ));
          break;
        }

        case 'add_liquidity': {
          const symA    = (action.tokenA || '').toUpperCase();
          const symB    = (action.tokenB || '').toUpperCase();
          const amountA = String(action.amountA || 0);
          const amountB = String(action.amountB || action.amountA || 0);

          if (!action.amountA) throw new Error('Please specify amounts, e.g. "add liquidity 100 WRAI and 100 USDC".');

          await addLiquidity({
            token0Symbol: symA, token1Symbol: symB,
            amount0: amountA, amount1: amountB,
            slippage: 0.5, userAddress: evmAddress,
          });
          addNotification(`✓ Added ${amountA} ${symA} + ${amountB} ${symB} liquidity`, 'success');
          invalidatePoolCache();
          await refreshBalances();

          setMessages(prev => prev.map(m =>
            m.id === msgId
              ? { ...m, text: m.text + `\n\n✓ Done! Added liquidity to ${symA}/${symB} pool.` }
              : m
          ));
          break;
        }

        case 'remove_liquidity': {
          const parts = (action.pair || '').split('-').map(s => s.toUpperCase());
          const [symA, symB] = parts;

          if (!symA || !symB) throw new Error('Invalid pair. Try: "remove liquidity from WRAI-USDC".');

          // Get LP balance
          const lpBal = await getUserLPBalance(symA, symB, evmAddress);
          if (!lpBal || parseFloat(lpBal) === 0) throw new Error(`No LP balance found for ${symA}-${symB} pool.`);

          await removeLiquidity({
            token0Symbol: symA, token1Symbol: symB,
            lpAmount: lpBal, slippage: 0.5, userAddress: evmAddress,
          });
          addNotification(`✓ Removed all liquidity from ${symA}/${symB}`, 'success');
          invalidatePoolCache();
          await refreshBalances();

          setMessages(prev => prev.map(m =>
            m.id === msgId
              ? { ...m, text: m.text + `\n\n✓ Done! Removed ${parseFloat(lpBal).toFixed(6)} LP from ${symA}/${symB}.` }
              : m
          ));
          break;
        }

        // ── Staking actions (Keplr) ──────────────────────────────────────────

        case 'stake': {
          const valAddr = await resolveValidator(action.validator);
          const amount  = String(action.amount || 0);
          if (parseFloat(amount) <= 0) throw new Error('Please specify a valid stake amount.');
          await stake(valAddr, amount, 'keplr');
          const label = action.validator || valAddr;
          addNotification(`✅ Staked ${amount} RAI to ${label}`, 'success');
          await refreshBalances();
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, text: m.text + `\n\n✅ Done! Staked ${amount} RAI to ${label}.` } : m
          ));
          break;
        }

        case 'unstake': {
          const valAddr = await resolveValidator(action.validator);
          const amount  = String(action.amount || 0);
          if (parseFloat(amount) <= 0) throw new Error('Please specify a valid unstake amount.');
          await unstake(valAddr, amount, 'keplr');
          const label = action.validator || valAddr;
          addNotification(`⏳ Unstaking ${amount} RAI from ${label}`, 'success');
          await refreshBalances();
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, text: m.text + `\n\n⏳ Done! Unstaking ${amount} RAI from ${label} (~21 day unbonding).` } : m
          ));
          break;
        }

        case 'redelegate': {
          const srcAddr = await resolveValidator(action.src_validator);
          const dstAddr = await resolveValidator(action.dst_validator);
          const amount  = String(action.amount || 0);
          if (parseFloat(amount) <= 0) throw new Error('Please specify a valid redelegate amount.');
          await redelegate(srcAddr, dstAddr, amount, 'keplr');
          addNotification(`✅ Redelegated ${amount} RAI from ${action.src_validator || srcAddr} → ${action.dst_validator || dstAddr}`, 'success');
          await refreshBalances();
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, text: m.text + `\n\n✅ Done! Redelegated ${amount} RAI to ${action.dst_validator || dstAddr}.` } : m
          ));
          break;
        }

        case 'claim_rewards': {
          const isAll = !action.validator || action.validator === 'all';
          if (isAll) {
            const delegations = await getAllUserDelegations(cosmosAddress);
            const valAddrs    = Object.keys(delegations).filter(a => parseFloat(delegations[a].pendingReward) > 0);
            if (!valAddrs.length) throw new Error('No pending rewards found across your delegations.');
            await claimAllRewards(valAddrs);
            addNotification('✅ Claimed all staking rewards', 'success');
            setMessages(prev => prev.map(m =>
              m.id === msgId ? { ...m, text: m.text + `\n\n✅ Done! Claimed rewards from ${valAddrs.length} validator(s).` } : m
            ));
          } else {
            const valAddr = await resolveValidator(action.validator);
            await claimReward(valAddr, 'keplr');
            addNotification(`✅ Claimed rewards from ${action.validator}`, 'success');
            setMessages(prev => prev.map(m =>
              m.id === msgId ? { ...m, text: m.text + `\n\n✅ Done! Rewards claimed from ${action.validator || valAddr}.` } : m
            ));
          }
          await refreshBalances();
          break;
        }

        case 'claim_commission': {
          const valInfo = await getValidatorInfoByDelegator(cosmosAddress);
          if (!valInfo.isValidator) throw new Error('Your connected wallet is not a validator operator.');
          if (parseFloat(valInfo.pendingCommission) <= 0) throw new Error('No pending commission to claim.');
          await withdrawValidatorCommission(valInfo.operatorAddress);
          addNotification(`✅ Claimed ${valInfo.pendingCommission} RAI validator commission`, 'success');
          await refreshBalances();
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, text: m.text + `\n\n✅ Done! Claimed ${valInfo.pendingCommission} RAI commission from ${valInfo.moniker}.` } : m
          ));
          break;
        }
      }
    } catch (err) {
      const msg = err.reason || err.message || 'Transaction failed';
      const friendly = msg.includes('rejected') || msg.includes('denied')
        ? 'Transaction rejected in wallet.'
        : `Failed: ${msg}`;
      addNotification(friendly, 'error');
      // Append error to message thread
      setMessages(prev => [...prev, {
        id: Date.now(), role: 'assistant', ts: new Date(), action: null,
        text: `⚠️ ${friendly}`, isError: true,
      }]);
    } finally {
      setExecState(prev => ({ ...prev, [msgId]: { ...prev[msgId], executing: false } }));
      removeNotification(pendingId);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  const AIAvatar = () => (
    <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg,#1e3a8a,#2563eb)', border: '1px solid rgba(59,130,246,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(147,197,253,0.9)" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </div>
  );

  const UserAvatar = () => (
    <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'rgba(51,65,85,0.6)', border: '1px solid rgba(71,85,105,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(148,163,184,0.8)" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes aiDot { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }
        @keyframes aiSlideIn { from{transform:translateX(100%) scale(0.96);opacity:0} to{transform:translateX(0) scale(1);opacity:1} }
        @keyframes aiFabPulse { 0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0.45),0 4px 20px rgba(0,0,0,0.6)} 50%{box-shadow:0 0 0 9px rgba(59,130,246,0),0 4px 20px rgba(0,0,0,0.6)} }
        @keyframes aiMsgIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes aiSpin { to{transform:rotate(360deg)} }
        .ai-msg { animation: aiMsgIn 0.25s ease forwards; }
        .ai-scroll::-webkit-scrollbar { width: 4px; }
        .ai-scroll::-webkit-scrollbar-track { background: transparent; }
        .ai-scroll::-webkit-scrollbar-thumb { background: rgba(37,99,235,0.3); border-radius: 2px; }
        .ai-chip:hover { background: rgba(37,99,235,0.2) !important; border-color: rgba(59,130,246,0.4) !important; color: #93c5fd !important; }
        .ai-send:hover:not(:disabled) { filter: brightness(1.2); transform: translateY(-1px); }
        .ai-textarea { resize: none; overflow-y: auto; max-height: 100px; }
        .ai-textarea:focus { outline: none; }
      `}</style>

      {/* FAB */}
      <button
        onClick={() => setIsOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 9998,
          width: 56, height: 56, borderRadius: '50%',
          background: isOpen ? 'rgba(15,23,42,0.95)' : 'linear-gradient(135deg,#1d4ed8,#2563eb)',
          border: `1.5px solid ${isOpen ? 'rgba(59,130,246,0.35)' : 'rgba(147,197,253,0.3)'}`,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          animation: isOpen ? 'none' : 'aiFabPulse 2.5s ease-in-out infinite',
        }}
        title={isOpen ? 'Close' : 'AI Trading Assistant'}
      >
        {isOpen
          ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(148,163,184,0.9)" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        }
      </button>

      {/* Panel */}
      {isOpen && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 9999,
          width: 420, maxWidth: '100vw',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(4,9,22,0.98)',
          backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
          borderLeft: '1px solid rgba(37,99,235,0.22)',
          boxShadow: '-12px 0 60px rgba(0,0,0,0.7), inset 1px 0 0 rgba(59,130,246,0.08)',
          animation: 'aiSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards',
        }}>

          {/* Header */}
          <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid rgba(37,99,235,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', border: '1px solid rgba(147,197,253,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(37,99,235,0.5)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.015em' }}>AI Trading Assistant</div>
                <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.55)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: evmAddress ? '#34d399' : '#fbbf24', display: 'inline-block', boxShadow: `0 0 5px ${evmAddress ? '#34d399' : '#fbbf24'}` }} />
                  {evmAddress ? `${evmAddress.slice(0,6)}...${evmAddress.slice(-4)} · Ready` : 'Wallet not connected'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { setMessages([]); setHasGreeted(false); setExecState({}); }}
                style={{ padding: '5px 10px', borderRadius: 7, background: 'transparent', border: '1px solid rgba(51,65,85,0.6)', color: 'rgba(100,116,139,0.8)', fontSize: 11, cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(71,85,105,1)'; e.currentTarget.style.color = '#94a3b8'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(51,65,85,0.6)'; e.currentTarget.style.color = 'rgba(100,116,139,0.8)'; }}
              >Clear</button>
              <button
                onClick={() => setIsOpen(false)}
                style={{ width: 30, height: 30, borderRadius: 8, background: 'transparent', border: '1px solid rgba(51,65,85,0.5)', color: 'rgba(100,116,139,0.8)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'; e.currentTarget.style.color = '#f87171'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(51,65,85,0.5)'; e.currentTarget.style.color = 'rgba(100,116,139,0.8)'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          {/* Wallet warning */}
          {!evmAddress && (
            <div
              onClick={connectEVM}
              style={{ margin: '10px 14px 0', padding: '9px 13px', borderRadius: 9, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(251,191,36,0.25)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <p style={{ fontSize: 11, color: 'rgba(253,230,138,0.85)', lineHeight: 1.5, margin: 0 }}>
                <strong style={{ color: '#fbbf24' }}>Wallet not connected.</strong> Click here to connect MetaMask before executing trades.
              </p>
            </div>
          )}

          {/* Messages */}
          <div className="ai-scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && !loading && (
              <div style={{ textAlign: 'center', padding: '40px 20px', opacity: 0.5 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(59,130,246,0.5)" strokeWidth="1.5" style={{ margin: '0 auto 12px', display: 'block' }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p style={{ fontSize: 12, color: 'rgba(148,163,184,0.5)', lineHeight: 1.7 }}>Ask me to execute a trade on Republic DEX</p>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className="ai-msg" style={{ display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-start' }}>
                {msg.role === 'assistant' ? <AIAvatar /> : <UserAvatar />}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '90%', padding: '10px 13px',
                    borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                    background: msg.role === 'user' ? 'rgba(37,99,235,0.22)' : msg.isError ? 'rgba(239,68,68,0.1)' : 'rgba(12,20,40,0.85)',
                    border: `1px solid ${msg.role === 'user' ? 'rgba(59,130,246,0.32)' : msg.isError ? 'rgba(239,68,68,0.22)' : 'rgba(37,99,235,0.18)'}`,
                    fontSize: 13, lineHeight: 1.6, color: msg.isError ? '#fca5a5' : '#cbd5e1',
                    whiteSpace: 'pre-line',
                  }}>
                    {msg.text}
                  </div>

                  {msg.action && (
                    <div style={{ maxWidth: '100%', width: '100%' }}>
                      <ActionCard
                        action={msg.action}
                        executing={execState[msg.id]?.executing || false}
                        quote={execState[msg.id]?.quote || null}
                        onExecute={() => handleExecute(msg.id, msg.action)}
                      />
                    </div>
                  )}

                  <span style={{ fontSize: 10, color: 'rgba(100,116,139,0.5)', marginTop: 3, padding: '0 2px' }}>
                    {msg.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}

            {loading && (
              <div className="ai-msg" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AIAvatar />
                <div style={{ borderRadius: '4px 12px 12px 12px', background: 'rgba(12,20,40,0.85)', border: '1px solid rgba(37,99,235,0.18)' }}>
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestion chips */}
          <div style={{ padding: '10px 14px 6px', borderTop: '1px solid rgba(30,58,138,0.18)', flexShrink: 0 }}>
            <p style={{ fontSize: 10, color: 'rgba(100,116,139,0.6)', marginBottom: 7, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Try asking</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {SUGGESTED_PROMPTS.map(p => (
                <button key={p} className="ai-chip" onClick={() => sendMessage(p)} style={{ padding: '4px 9px', borderRadius: 6, background: 'rgba(12,20,40,0.7)', border: '1px solid rgba(30,58,138,0.45)', color: 'rgba(148,163,184,0.75)', fontSize: 11, cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit' }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <div style={{ padding: '10px 14px 18px', flexShrink: 0 }}>
            <div
              style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: 'rgba(12,20,40,0.85)', border: '1px solid rgba(37,99,235,0.28)', borderRadius: 12, padding: '10px 10px 10px 14px', transition: 'border-color 0.2s, box-shadow 0.2s' }}
              onFocusCapture={e => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.55)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.1)'; }}
              onBlurCapture={e => { e.currentTarget.style.borderColor = 'rgba(37,99,235,0.28)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <textarea
                ref={inputRef}
                className="ai-textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="swap 100 USDC to WETH · add liquidity 100 WRAI + 50 USDC..."
                rows={1}
                disabled={loading}
                style={{ flex: 1, background: 'transparent', border: 'none', color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5 }}
                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'; }}
              />
              <button
                className="ai-send"
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  background: input.trim() && !loading ? 'linear-gradient(135deg,#1d4ed8,#2563eb)' : 'rgba(22,36,63,0.8)',
                  border: `1px solid ${input.trim() && !loading ? 'rgba(147,197,253,0.3)' : 'rgba(37,55,90,0.6)'}`,
                  cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: input.trim() && !loading ? 1 : 0.45, transition: 'all 0.2s',
                }}
              >
                {loading
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(148,163,184,0.6)" strokeWidth="2" style={{ animation: 'aiSpin 1s linear infinite' }}><circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10"/></svg>
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                }
              </button>
            </div>
            <p style={{ fontSize: 10, color: 'rgba(71,85,105,0.7)', textAlign: 'center', marginTop: 7 }}>
              Enter ↵ to send &nbsp;·&nbsp; Shift+Enter for newline
            </p>
          </div>
        </div>
      )}
    </>
  );
}