/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        main: '#020617', // Deepest background
        surface: '#0f172a', // Secondary background
        primary: '#14b8a6', // Teal 500 (Vibrant)
        'primary-dim': '#0f766e', // Teal 700 (Muted)
        'primary-glow': '#2dd4bf', // Teal 400 (Glow source)
        accent: '#ccfbf1', // Teal 50 (Text accent)
        muted: '#94a3b8', // Slate 400
        outline: '#1e293b', // Slate 800
        glass: 'rgba(15, 23, 42, 0.7)',
        'glass-border': 'rgba(255, 255, 255, 0.08)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Inter"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        'glow-sm': '0 0 10px rgba(20, 184, 166, 0.3)',
        'glow-md': '0 0 20px rgba(20, 184, 166, 0.4)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      backgroundImage: {
        'mesh': 'radial-gradient(circle at 50% 10%, rgba(20, 184, 166, 0.15), transparent 40%), radial-gradient(circle at 0% 0%, rgba(15, 23, 42, 1), transparent 100%)',
      }
    },
  },
  plugins: [],
}
