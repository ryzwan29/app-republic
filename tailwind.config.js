/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'rai-blue': '#2563eb',
        'rai-blue-light': '#3b82f6',
        'rai-blue-dark': '#1d4ed8',
        'rai-cyan': '#06b6d4',
        'rai-dark': '#050810',
        'rai-darker': '#030509',
        'rai-card': 'rgba(8, 14, 30, 0.85)',
        'rai-border': 'rgba(37, 99, 235, 0.25)',
      },
      fontFamily: {
        'display': ['"Syne"', 'sans-serif'],
        'body': ['"DM Sans"', 'sans-serif'],
        'mono': ['"JetBrains Mono"', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow': 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(37,99,235,0.35) 0%, transparent 70%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'float': 'float 6s ease-in-out infinite',
        'slide-up': 'slideUp 0.4s ease-out',
        'fade-in': 'fadeIn 0.3s ease-out',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(37,99,235,0.3), 0 0 20px rgba(37,99,235,0.1)' },
          '100%': { boxShadow: '0 0 10px rgba(37,99,235,0.6), 0 0 40px rgba(37,99,235,0.2)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: 0 },
          '100%': { transform: 'translateY(0)', opacity: 1 },
        },
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      },
      boxShadow: {
        'glow-blue': '0 0 20px rgba(37,99,235,0.4), 0 0 60px rgba(37,99,235,0.1)',
        'glow-sm': '0 0 10px rgba(37,99,235,0.3)',
        'card': '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
      },
    },
  },
  plugins: [],
}
