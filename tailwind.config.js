/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        main: '#000000', // Pure Black
        surface: '#09090b', // Zinc 950
        primary: '#06b6d4', // Cyan 500 (Arc Reactor)
        'primary-dim': '#0e7490', // Cyan 700
        'primary-glow': '#22d3ee', // Cyan 400
        accent: '#cffafe', // Cyan 50
        muted: '#94a3b8', // Slate 400
        outline: '#1e293b', // Slate 800
        glass: 'rgba(9, 9, 11, 0.7)', // Darker glass
        'glass-border': 'rgba(34, 211, 238, 0.3)', // Cyan tint border
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Inter"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'], // Added for data
      },
      boxShadow: {
        'neon': '0 0 5px theme("colors.primary"), 0 0 20px theme("colors.primary-glow")',
        'hud': 'inset 0 0 0 1px rgba(34, 211, 238, 0.1), 0 0 15px rgba(6, 182, 212, 0.15)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
      },
      backgroundImage: {
        'grid': 'linear-gradient(rgba(34, 211, 238, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 211, 238, 0.05) 1px, transparent 1px)',
        'radial-glow': 'radial-gradient(circle at 50% 0%, rgba(6, 182, 212, 0.15), transparent 70%)',
      }
    },
  },
  plugins: [],
}
