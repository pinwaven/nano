import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import commonjs from 'vite-plugin-commonjs';
import path from 'path';

// The user-app is a twin of the WeChat Mini Program. Its pure logic modules (the `:::` card
// grammar in markdown.js, biomarker sparklines, avatar mood, signal smoothing) are imported
// straight from src/mini/nano-miniapp/utils via the `@mini` alias so both clients render the
// same thing from one source. Those files are CommonJS (`module.exports`) with no `wx.*`
// calls; vite-plugin-commonjs rewrites them for both the dev server and the build. Never
// import config.js / wearable/sync.js / tool-actions.js / pinch.js through it — they call wx.
const MINI_UTILS = path.resolve(__dirname, '../../mini/nano-miniapp/utils');

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../../../'), '');
  // Dev proxies /api to the DEV backend by default — same split as the miniapp's `develop`
  // envVersion. NANO_API_TARGET is the admin-panel's (bare worker, path rewritten) and is
  // not reusable here.
  const target = env.NANO_USER_APP_API_TARGET || 'https://nano-dev.gcn.net';
  return {
    plugins: [
      react(),
      commonjs({ filter: id => id.includes('/mini/nano-miniapp/utils/') }),
    ],
    envDir: '../../../',
    base: command === 'build' ? '/app/' : '/',
    define: {
      __API_IS_DEV__: JSON.stringify(command !== 'build' && /-dev\./.test(target)),
    },
    resolve: {
      alias: { '@mini': MINI_UTILS },
    },
    build: {
      outDir: '../../../src/functions/user-app/dist',
      emptyOutDir: true,
    },
    server: {
      port: 5178,
      open: true,
      fs: { allow: [path.resolve(__dirname, '../../../')] },
      proxy: {
        '/api': { target, changeOrigin: true, secure: true },
      },
    },
  };
});
