/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        main: '#ffffff', // Pure White
        surface: '#f8fafc', // Slate 50 (Subtle depth)
        primary: '#0f766e', // Deep Teal (Sophisticated)
        'primary-dim': '#115e59', // Teal 800
        'primary-glow': '#14b8a6', // Teal 500 (Softer glow)
        accent: '#000000', // Jet Black
        muted: '#64748b', // Slate 500 (Elegant gray)
        outline: '#e2e8f0', // Slate 200
        glass: 'rgba(255, 255, 255, 0.7)', // White Crystal
        'glass-border': 'rgba(0, 0, 0, 0.04)', // Very subtle dark border
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Inter"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'luxury': '0 20px 40px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
        'sharp': '0 0 0 1px rgba(0,0,0,0.03), 0 1px 2px rgba(0,0,0,0.05)',
        glass: '0 8px 32px 0 rgba(255, 255, 255, 0.5)',
      },
      backgroundImage: {
        'gradient-luxury': 'linear-gradient(to bottom right, #ffffff, #f1f5f9)',
      }
    },
  },
  plugins: [],
}
