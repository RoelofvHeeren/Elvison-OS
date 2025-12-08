/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        main: '#ffffff', // Pure White
        surface: '#f5f5f5', // Light gray for subtle depth
        primary: '#000000', // Jet Black (was teal)
        'primary-dim': '#1a1a1a', // Dark gray
        'primary-glow': '#333333', // Medium dark gray
        accent: '#000000', // Jet Black
        muted: '#666666', // Medium gray
        outline: '#e0e0e0', // Light gray border
        glass: 'rgba(255, 255, 255, 0.95)', // White Crystal
        'glass-border': 'rgba(0, 0, 0, 0.1)', // Subtle dark border
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Inter"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'luxury': '0 20px 40px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
        'sharp': '0 0 0 1px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.1)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.1)',
        '3d': '0 10px 20px -5px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.08)',
        'lifted': '0 20px 40px -10px rgba(0, 0, 0, 0.25), 0 10px 20px -5px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.08)',
      },
      backgroundImage: {
        'gradient-luxury': 'linear-gradient(135deg, #ffffff 0%, #f5f5f5 100%)',
        'gradient-dark': 'linear-gradient(135deg, #1a1a1a 0%, #000000 100%)',
      }
    },
  },
  plugins: [],
}
