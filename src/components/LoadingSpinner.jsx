export default function LoadingSpinner({ size = 24, text = '' }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="animate-spin"
        style={{ color: '#3b82f6' }}
      >
        <circle
          cx="12" cy="12" r="10"
          stroke="rgba(59,130,246,0.2)"
          strokeWidth="3"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {text && <span className="text-slate-400 font-display text-sm">{text}</span>}
    </div>
  );
}

export function LoadingOverlay({ text = 'Processing...' }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="glass-card p-8 flex flex-col items-center gap-4">
        <LoadingSpinner size={48} />
        <p className="text-white font-display text-lg">{text}</p>
        <p className="text-slate-400 text-sm">Please confirm in your wallet</p>
      </div>
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return (
    <div className={`shimmer rounded-lg ${className}`} />
  );
}
