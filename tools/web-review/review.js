#!/usr/bin/env node
// Headless review of a web page: screenshots per viewport + every console error, uncaught
// exception and failed/4xx/5xx request. Built for the EC2 dev box, where there is no Chrome
// to open — the PNGs are read back by Claude (or scp'd to a laptop), the trace opened with
// `npx playwright show-trace`.
//
//   node review.js <url> [options]
//
//   --viewport mobile,desktop   named viewports (mobile|android|tablet|desktop), default mobile
//   --full                      full-page screenshots instead of the first screen
//   --out <dir>                 output dir, default <repo>/temp/web-review/<timestamp>
//   --user-token <u.token>      log in to the user-app (localStorage nano_session)
//   --admin-token <token>       log in to the admin panel (sessionStorage nano_admin_token)
//   --local k=v / --session k=v any other localStorage / sessionStorage entry (repeatable;
//                               value is stored verbatim — pass JSON already stringified)
//   --wait-for <selector>       wait for this before the first screenshot
//   --wait <ms>                 extra settle time after load, default 1500
//   --steps <file.json>         scripted actions, see README
//   --trace                     also write trace.zip
//   --selftest                  render a local page to check the browser + fonts work
const fs = require('fs');
const path = require('path');
const { launch, VIEWPORTS, collectIssues } = require('./browser');

function parseArgs(argv) {
  const a = { viewports: ['mobile'], local: {}, session: {}, wait: 1500 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    const kv = (obj) => { const s = next(); const j = s.indexOf('='); obj[s.slice(0, j)] = s.slice(j + 1); };
    if (k === '--viewport') a.viewports = next().split(',');
    else if (k === '--full') a.full = true;
    else if (k === '--out') a.out = next();
    else if (k === '--user-token') { const t = next(); a.local.nano_session = t; a.local.nano_session_at = String(Date.now()); }
    else if (k === '--admin-token') a.session.nano_admin_token = next();
    else if (k === '--local') kv(a.local);
    else if (k === '--session') kv(a.session);
    else if (k === '--wait-for') a.waitFor = next();
    else if (k === '--wait') a.wait = Number(next());
    else if (k === '--steps') a.steps = JSON.parse(fs.readFileSync(next(), 'utf8'));
    else if (k === '--trace') a.trace = true;
    else if (k === '--selftest') a.selftest = true;
    else if (k === '-h' || k === '--help') a.help = true;
    else if (!k.startsWith('--')) a.url = k;
    else throw new Error(`unknown option ${k}`);
  }
  return a;
}

// Steps: [{goto:url}, {click:sel}, {fill:[sel,text]}, {press:key}, {waitFor:sel}, {wait:ms},
//         {scroll:sel|'bottom'}, {shot:name}, {eval:'js expression'}]
// Selectors are Playwright's, so `text=登录` and `role=button[name="发送"]` work.
async function runStep(page, step, shoot, log) {
  if (step.goto) await page.goto(step.goto, { waitUntil: 'networkidle' });
  else if (step.click) await page.click(step.click);
  else if (step.fill) await page.fill(step.fill[0], step.fill[1]);
  else if (step.press) await page.keyboard.press(step.press);
  else if (step.waitFor) await page.waitForSelector(step.waitFor);
  else if (step.wait) await page.waitForTimeout(step.wait);
  else if (step.scroll === 'bottom') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  else if (step.scroll) await page.locator(step.scroll).scrollIntoViewIfNeeded();
  else if (step.shot) await shoot(step.shot);
  else if (step.eval) log.push({ eval: step.eval, result: await page.evaluate(step.eval) });
  else throw new Error(`unknown step ${JSON.stringify(step)}`);
}

async function reviewViewport(browser, a, vpName, outDir) {
  const vp = VIEWPORTS[vpName];
  if (!vp) throw new Error(`unknown viewport ${vpName} (${Object.keys(VIEWPORTS).join('|')})`);
  const context = await browser.newContext({ ...vp, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  // Storage has to exist before the app's first script reads it, so it is written by an init
  // script on every navigation rather than after page load.
  if (Object.keys(a.local).length || Object.keys(a.session).length) {
    await context.addInitScript(({ local, session }) => {
      try { for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v); } catch {}
      try { for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v); } catch {}
    }, { local: a.local, session: a.session });
  }
  if (a.trace) await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  const issues = collectIssues(page);
  const shots = [];
  const evals = [];
  let n = 0;
  const shoot = async (name) => {
    const file = path.join(outDir, `${vpName}-${String(++n).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: !!a.full });
    shots.push(file);
  };

  let error = null;
  try {
    const res = await page.goto(a.url, { waitUntil: 'networkidle', timeout: 45000 });
    if (a.waitFor) await page.waitForSelector(a.waitFor, { timeout: 20000 });
    await page.waitForTimeout(a.wait);
    await shoot('load');
    for (const step of a.steps || []) await runStep(page, step, shoot, evals);
    if (a.steps?.length && !a.steps.some(s => s.shot)) await shoot('end');
    var status = res?.status();
  } catch (e) {
    error = e.message.split('\n')[0];
    await shoot('error').catch(() => {});
  }
  const title = await page.title().catch(() => '');
  if (a.trace) await context.tracing.stop({ path: path.join(outDir, `${vpName}-trace.zip`) });
  await context.close();
  return { viewport: vpName, status, title, finalUrl: page.url(), error, shots, evals, issues };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || (!a.url && !a.selftest)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 22).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(a.help ? 0 : 1);
  }
  if (a.selftest) {
    a.url = 'data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="font-family:-apple-system,PingFang SC,sans-serif"><h1>Viva 健康报告 ✅ 🧬</h1>' +
      '<p>Latin, 中文，123</p><code>mono 等宽</code></body>');
  }
  const out = path.resolve(a.out || path.join(__dirname, '../../temp/web-review', new Date().toISOString().replace(/[:.]/g, '-')));
  fs.mkdirSync(out, { recursive: true });

  const browser = await launch();
  const results = [];
  try {
    for (const vp of a.viewports) results.push(await reviewViewport(browser, a, vp, out));
  } finally {
    await browser.close();
  }
  const report = { url: a.selftest ? '(selftest)' : a.url, at: new Date().toISOString(), results };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

  for (const r of results) {
    console.log(`\n[${r.viewport}] ${r.status ?? '-'} "${r.title}" ${r.finalUrl.startsWith('data:') ? '' : r.finalUrl}`);
    if (r.error) console.log(`  ERROR: ${r.error}`);
    for (const s of r.shots) console.log(`  shot: ${s}`);
    for (const e of r.evals) console.log(`  eval ${e.eval} => ${JSON.stringify(e.result)}`);
    if (!r.issues.length) console.log('  no console errors or failed requests');
    for (const i of r.issues.slice(0, 30)) console.log(`  ${i.kind}: ${i.text.slice(0, 300)}`);
    if (r.issues.length > 30) console.log(`  … ${r.issues.length - 30} more in report.json`);
  }
  console.log(`\nreport: ${path.join(out, 'report.json')}`);
  process.exit(results.some(r => r.error) ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
