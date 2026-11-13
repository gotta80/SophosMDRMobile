/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media', // segue automaticamente il tema di iOS
  theme: {
    extend: {
      fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Inter', 'system-ui', 'sans-serif'] },
      keyframes: {
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        slide: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
      },
      colors: {
        ios: { blue: '#0a84ff', bg: 'rgb(var(--bg-rgb) / <alpha-value>)' },
      },
    },
  },
  plugins: [],
};
