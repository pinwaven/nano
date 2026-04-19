'use strict';

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'text/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
};

const DIST = path.join(__dirname, 'dist');

exports.handler = async (req) => {
  let rawPath = '';
  try {
    const event = Buffer.isBuffer(req) ? JSON.parse(req.toString()) : req;
    rawPath = event.rawPath || '/';
  } catch {
    rawPath = '/';
  }

  // Strip the /app prefix — FC receives the full path
  let filePath = rawPath.replace(/^\/app/, '') || '/';
  if (filePath === '/' || filePath === '') filePath = '/index.html';

  const safe = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  let abs = path.join(DIST, safe);

  // SPA fallback: non-asset paths serve index.html
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    abs = path.join(DIST, 'index.html');
  }

  try {
    const content = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const isImmutable = safe.startsWith('/assets/');
    return {
      statusCode: 200,
      headers: {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        'content-disposition': 'inline',
      },
      body: content.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.log(JSON.stringify({ level: 'ERROR', msg: 'File not found', data: { abs, err: err.message } }));
    return {
      statusCode: 404,
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('Not Found').toString('base64'),
      isBase64Encoded: true,
    };
  }
};
