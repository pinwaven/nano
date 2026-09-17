#!/usr/bin/env node
// Stage 2 of 2 — turn build.py's guide.html into cover/body PDFs. See README.md.
//
// Chrome's `--print-to-pdf` CLI flag can't set a header/footer template, so this drives
// the same headless Chrome over CDP instead, which can. Two passes: the cover prints with
// no footer, the body prints with one, and merge.py joins them.
const WebSocket = require('../wechat-automator/node_modules/ws');  // already vendored there
const { spawn } = require('child_process');
const fs = require('fs'), http = require('http'), path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT || 9333);
const HTML = `file://${path.join(__dirname, 'guide.html')}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = p => new Promise((res, rej) =>
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } });
  }).on('error', rej));

(async () => {
  if (!fs.existsSync(path.join(__dirname, 'guide.html'))) throw new Error('run build.py first');
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + path.join(__dirname, '.cdp-profile'),
    'about:blank'], { stdio: 'ignore' });

  let ver;
  for (let i = 0; i < 40 && !ver; i++) { try { ver = await getJSON('/json/version') } catch { await sleep(400) } }
  if (!ver) throw new Error('Chrome devtools endpoint never came up');

  const target = (await getJSON('/json/list')).find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl,
                           { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));

  let id = 0; const pending = new Map();
  ws.on('message', m => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  const loaded = new Promise(r => {
    const h = m => { if (JSON.parse(m).method === 'Page.loadEventFired') { ws.off('message', h); r() } };
    ws.on('message', h);
  });
  await send('Page.navigate', { url: HTML });
  await loaded;
  await sleep(2500);   // let the screenshots decode before printing

  // Chrome renders header/footer in an isolated context that does NOT inherit the page's
  // fonts — name a real one explicitly or it silently falls back to a serif.
  const FOOT = `<div style="width:100%;font-size:7.5pt;font-family:Helvetica,Arial,sans-serif;
      color:#8b95a8;padding:0 15mm;display:flex;justify-content:space-between;
      -webkit-print-color-adjust:exact;">
      <span>Waven Nano &middot; End User Guide</span><span class="pageNumber"></span></div>`;

  const paper = {
    paperWidth: 8.27, paperHeight: 11.69,                    // A4
    marginTop: 0.63, marginBottom: 0.63, marginLeft: 0.59, marginRight: 0.59,
    printBackground: true, preferCSSPageSize: false,
  };
  const cover = await send('Page.printToPDF', { ...paper, pageRanges: '1', displayHeaderFooter: false });
  const body  = await send('Page.printToPDF', { ...paper, pageRanges: '2-', displayHeaderFooter: true,
                                                headerTemplate: '<span></span>', footerTemplate: FOOT });
  fs.writeFileSync(path.join(__dirname, '_cover.pdf'), Buffer.from(cover.data, 'base64'));
  fs.writeFileSync(path.join(__dirname, '_body.pdf'),  Buffer.from(body.data,  'base64'));
  console.log('rendered _cover.pdf + _body.pdf');
  ws.close(); chrome.kill();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
