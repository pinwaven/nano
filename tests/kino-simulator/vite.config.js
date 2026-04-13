import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env file from the project root (../../.env)
  const env = loadEnv(mode, path.resolve(__dirname, '../../'), '');
  
  // Default to local dev, but allow override via NANO_API_TARGET
  const target = env.NANO_API_TARGET || 'http://localhost:3000';

  console.log(`[Kino Simulator] Proxying /api to: ${target}`);

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          secure: target.startsWith('https')
        }
      }
    }
  };
});
