import { useState, useEffect } from 'react';

export default function Footer() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const socials = [
    {
      label: 'Twitter / X',
      href: 'https://x.com/Ryddd29',
      icon: (<svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>),
    },
    {
      label: 'Telegram',
      href: 'https://t.me/Ryddd29',
      icon: (<svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>),
    },
    {
      label: 'GitHub',
      href: 'https://github.com/ryzwan29',
      icon: (<svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>),
    },
  ];

  return (
    <footer className="relative z-10 border-t border-blue-900/30">
      <div className="max-w-6xl mx-auto px-6 py-5">

        {/* Main row — 3 equal columns */}
        <div className="flex items-center">
          <div className="flex-1 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <img src="/tokens/RAI.png" alt="Republic" className="w-6 h-6" />
              <span className="font-display font-bold text-white text-base tracking-tight">Republic</span>
            </div>
            <p className="text-slate-500 text-xs">Decentralized exchange on Republic Testnet</p>
          </div>

          <div className="flex-1 flex justify-center">
            <span className="text-slate-500 text-xs font-mono flex items-center gap-1">
              Made with <span className="text-red-400 mx-0.5">❤️</span> by
              <a href="https://provewithryd.xyz" target="_blank" rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 transition-colors font-semibold ml-1">
                @RydOne
              </a>
            </span>
          </div>

          <div className="flex-1 flex justify-end gap-1.5">
            {socials.map(s => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white transition-all duration-200"
                style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)' }}
                onMouseEnter={e => { e.currentTarget.style.background='rgba(37,99,235,0.2)'; e.currentTarget.style.borderColor='rgba(37,99,235,0.5)'; e.currentTarget.style.boxShadow='0 0 10px rgba(37,99,235,0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background='rgba(37,99,235,0.08)'; e.currentTarget.style.borderColor='rgba(37,99,235,0.2)'; e.currentTarget.style.boxShadow='none'; }}>
                {s.icon}
              </a>
            ))}
          </div>
        </div>

        {/* Bottom bar — 3 equal columns */}
        <div className="mt-4 pt-4 border-t border-blue-900/20 flex items-center">
          <p className="flex-1 text-slate-600 text-xs font-mono">
            © {new Date().getFullYear()} Republic. All rights reserved.
          </p>

          <div className="flex-1 flex justify-center items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${online ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
            </span>
            <span className="text-xs font-mono" style={{ color: online ? '#34d399' : '#f87171' }}>
              {online ? 'All systems operational' : 'Connection issues'}
            </span>
          </div>

          <p className="flex-1 text-right text-slate-600 text-xs font-mono">
            Built on{' '}
            <a href="https://republicai.io/" target="_blank" rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-400 transition-colors">
              Republic Testnet
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}