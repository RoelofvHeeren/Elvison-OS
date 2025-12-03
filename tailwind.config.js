/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#0f766e',
        primaryDark: '#0b5f56',
        mint: '#C1F5EF', // requested blue-green accent
        mist: '#F2F2F2', // silver
        panel: '#f9fbfc',
        ink: '#0f172a',
        muted: '#6b7280',
        outline: '#dce7e1',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Inter"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        brand: '0 18px 40px rgba(15, 118, 110, 0.18)',
        soft: '0 12px 30px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
}
