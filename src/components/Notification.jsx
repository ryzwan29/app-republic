import { useEffect, useState } from 'react';

const ICONS = {
  success: (
    <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center flex-shrink-0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    </div>
  ),
  error: (
    <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center flex-shrink-0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </div>
  ),
  warning: (
    <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5">
        <path d="M12 9v4M12 17h.01"/>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      </svg>
    </div>
  ),
  info: (
    <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4M12 8h.01"/>
      </svg>
    </div>
  ),
  pending: (
    <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin">
        <circle cx="12" cy="12" r="9" stroke="rgba(59,130,246,0.2)" strokeWidth="2.5"/>
        <path d="M12 3a9 9 0 0 1 9 9" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    </div>
  ),
};

const BORDER = {
  success: 'border-green-500/25',
  error: 'border-red-500/25',
  warning: 'border-amber-500/25',
  info: 'border-blue-500/25',
  pending: 'border-blue-500/25',
};

export default function Notification({ message, type = 'info', onClose }) {
  const [visible, setVisible] = useState(true);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-xl glass-card border ${BORDER[type]} ${
        visible ? 'notification-enter' : 'notification-exit'
      }`}
      style={{ maxWidth: '360px' }}
    >
      {ICONS[type]}
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-body leading-relaxed break-words">{message}</p>
      </div>
      <button
        onClick={handleClose}
        className="text-slate-500 hover:text-white transition-colors flex-shrink-0 mt-0.5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  );
}
