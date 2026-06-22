/**
 * Tailwind config for the design-sync v1 stylesheet. Mirrors console/tailwind.config.js
 * theme.extend (kept in sync by hand) and scans BOTH the real console source and the v1
 * wrappers, so the compiled CSS contains exactly the utilities the bundled screens use
 * plus the .btn/.input component layer from console/src/index.css.
 *
 * Run from .design-sync/v1/:
 *   ../../console/node_modules/.bin/tailwindcss -c tailwind.design.mjs \
 *     -i ../../console/src/index.css -o dist/_ds_bundle.css --minify
 */
export default {
  content: [
    '../../console/index.html',
    '../../console/src/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        tide: {
          50: '#e6f4f2',
          100: '#cfe9e5',
          200: '#bfe5df',
          300: '#8fd3ca',
          400: '#3dafa4',
          500: '#14958a',
          600: '#0f7c72',
          700: '#0b6358',
          800: '#0b5a53',
          900: '#08433d',
          950: '#06302c',
        },
        ink: {
          50: '#fafafa',
          100: '#f4f5f6',
          200: '#e7e9eb',
          300: '#d7dadd',
          400: '#9aa1a9',
          500: '#8a929b',
          600: '#6b7480',
          700: '#3a424b',
          800: '#1b2127',
          900: '#11161b',
        },
      },
      fontFamily: {
        sans: ['"Hanken Grotesk"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { chip: '7px', field: '9px', panel: '12px', card: '14px' },
      boxShadow: {
        card: '0 1px 2px rgba(17, 22, 27, 0.04)',
        lift: '0 2px 8px rgba(17, 22, 27, 0.06), 0 14px 30px -12px rgba(17, 22, 27, 0.14)',
        login: '0 12px 30px -16px rgba(17, 22, 27, 0.2)',
        frame: '0 24px 60px -28px rgba(17, 22, 27, 0.28), 0 2px 8px rgba(17, 22, 27, 0.05)',
        modal: '0 20px 50px -18px rgba(0, 0, 0, 0.5)',
        toast: '0 10px 30px -8px rgba(0, 0, 0, 0.4)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-dot': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
      },
      animation: {
        'fade-up': 'fade-up 0.3s ease both',
        'toast-in': 'toast-in 0.25s ease both',
        'pulse-dot': 'pulse-dot 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
