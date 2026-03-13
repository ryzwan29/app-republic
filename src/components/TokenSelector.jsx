// TokenSelector.jsx
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TOKEN_LIST } from '../blockchain/tokens.js';

export function TokenSelector({ selected, onSelect, exclude = [] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef(null);
  const available = TOKEN_LIST.filter(t => !exclude.includes(t.symbol));

  function updatePos() {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const dropdownHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const goUp = spaceBelow < 200 && rect.top > 200;
    setPos({
      left: rect.left,
      width: Math.max(rect.width, 208),
      top: goUp ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
    });
  }

  function handleToggle() {
    if (!open) updatePos();
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    function handleClose(e) {
      if (buttonRef.current && buttonRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClose);
    return () => document.removeEventListener('mousedown', handleClose);
  }, [open]);

  const dropdown = open && createPortal(
    <div
      className="glass-card p-2 animate-fade-in"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: '280px',
        overflowY: 'auto',
        zIndex: 9999,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {available.map(t => (
        <button
          key={t.symbol}
          onClick={() => { onSelect(t.symbol); setOpen(false); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all duration-150 text-left ${
            t.symbol === selected
              ? 'bg-blue-900/30 border border-blue-500/30'
              : 'hover:bg-blue-900/20'
          }`}
        >
          <TokenIcon symbol={t.symbol} size={24} />
          <div>
            <div className="text-white font-display font-semibold text-sm">{t.symbol}</div>
            <div className="text-slate-500 text-xs">{t.name}</div>
          </div>
          {t.symbol === selected && (
            <svg className="w-4 h-4 text-blue-400 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          )}
        </button>
      ))}
    </div>,
    document.body
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="token-badge min-w-[110px]"
      >
        <TokenIcon symbol={selected} size={20} />
        <span className="text-white font-display font-semibold">{selected || 'Select'}</span>
        <svg className={`w-3 h-3 text-slate-400 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      {dropdown}
    </div>
  );
}

export function TokenIcon({ symbol, size = 28 }) {
  const [imgError, setImgError] = useState(false);

  const colors = {
    RAI:  'from-blue-500 to-blue-700',
    USDT: 'from-emerald-500 to-emerald-700',
    USDC: 'from-blue-400 to-blue-600',
    WRAI: 'from-cyan-500 to-blue-600',
    WBTC: 'from-orange-400 to-orange-600',
    WETH: 'from-violet-500 to-violet-700',
  };

  const letters = {
    RAI:  'R',
    USDT: 'T',
    USDC: 'U',
    WRAI: 'W',
    WBTC: 'B',
    WETH: 'E',
  };

  if (!imgError) {
    return (
      <img
        src={`/tokens/${symbol}.png`}
        alt={symbol}
        width={size}
        height={size}
        className="rounded-full flex-shrink-0"
        style={{ width: size, height: size }}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-gradient-to-br ${colors[symbol] || 'from-slate-600 to-slate-800'} flex items-center justify-center font-display font-bold text-white flex-shrink-0`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {letters[symbol] || symbol?.[0] || '?'}
    </div>
  );
}