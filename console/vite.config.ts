import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/auth': { target: backend, changeOrigin: true },
      '/p': { target: backend, changeOrigin: true },
      '/_pagepin': { target: backend, changeOrigin: true },
      '/skill.md': { target: backend, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
