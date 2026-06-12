/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tide: {
          50: '#eefaf8',
          100: '#d6f1ee',
          200: '#b0e3df',
          300: '#7ecfca',
          400: '#4ab3af',
          500: '#2c9794',
          600: '#1f7a79',
          700: '#1d6262',
          800: '#1b4f4f',
          900: '#1a4242',
          950: '#0a2626',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Segoe UI"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"PingFang SC"',
          'monospace',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(26, 66, 66, 0.06), 0 4px 16px -4px rgba(26, 66, 66, 0.08)',
        lift: '0 2px 4px rgba(26, 66, 66, 0.08), 0 12px 28px -8px rgba(26, 66, 66, 0.16)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease both',
        'toast-in': 'toast-in 0.25s ease both',
      },
    },
  },
  plugins: [],
};
