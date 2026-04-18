import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../../'), '');
  const target = env.NANO_API_TARGET || 'http://localhost:3000';

  return {
    plugins: [react()],
    base: '/admin/sim/coach/',
    build: {
      outDir: '../../src/functions/admin-panel/sim/coach',
      emptyOutDir: true,
    },
    server: {
      port: 5175,
      proxy: {
        '/api': {
          target: target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    }
  };
});
