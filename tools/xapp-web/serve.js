// Serve the xapp web build with /api proxied to a backend — the same split as the web
// user-app's vite proxy (the xapp's web BASE is same-origin, see utils/config.uts).
//
//   node tools/xapp-web/serve.js [--port 5180] [--target https://nano-dev.gcn.net]
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('--port', 5180));
const TARGET = new URL(arg('--target', 'https://nano-dev.gcn.net'));
const DIST = path.resolve(__dirname, '../../src/xapp/unpackage/dist/build/web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const lib = TARGET.protocol === 'https:' ? https : http;
    const up = lib.request({ host: TARGET.hostname, port: TARGET.port || undefined, path: req.url, method: req.method,
      headers: { ...req.headers, host: TARGET.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
    return;
  }
  let file = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html'); // SPA fallback
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`xapp web on http://localhost:${PORT}/  (/api → ${TARGET.origin})`));
