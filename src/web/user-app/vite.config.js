import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  return {
    plugins: [react()],
    envDir: '../../../',
    base: command === 'build' ? '/app/' : '/',
    build: {
      outDir: '../../../src/functions/user-app/dist',
      emptyOutDir: true,
    },
    server: {
      port: 5178,
      open: true,
      proxy: {
        '/api': {
          target: 'https://nano.gcn.net',
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
