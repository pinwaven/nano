// Launch headless Chromium with the locally unpacked libraries and fonts from setup.sh, so a
// script needs no LD_LIBRARY_PATH / FONTCONFIG_FILE in its own shell. Use this instead of
// calling chromium.launch() directly — without it the browser either fails to start (missing
// .so files) or renders every page blank (no fonts).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, devices } = require('playwright');

const PREFIX = process.env.WEB_REVIEW_LIBS || path.join(os.homedir(), '.local/chromium-libs');

function browserEnv() {
  const env = { ...process.env };
  const libDir = path.join(PREFIX, 'root/usr/lib/x86_64-linux-gnu');
  const fontsConf = path.join(PREFIX, 'fonts.conf');
  if (fs.existsSync(libDir)) {
    env.LD_LIBRARY_PATH = [libDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
  if (fs.existsSync(fontsConf)) env.FONTCONFIG_FILE = fontsConf;
  return env;
}

async function launch(opts = {}) {
  return chromium.launch({ ...opts, env: { ...browserEnv(), ...(opts.env || {}) } });
}

// Named viewports. `mobile` is the user-app's target (it is a twin of the miniapp);
// `desktop` suits the admin panel.
const VIEWPORTS = {
  mobile: devices['iPhone 13'],
  android: devices['Pixel 7'],
  tablet: devices['iPad Mini'],
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

// Record everything that usually explains a broken page: console errors/warnings, uncaught
// exceptions, failed requests and HTTP >= 400 responses.
function collectIssues(page) {
  const issues = [];
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') {
      issues.push({ kind: `console.${m.type()}`, text: m.text(), at: m.location()?.url || '' });
    }
  });
  page.on('pageerror', e => issues.push({ kind: 'pageerror', text: e.message }));
  page.on('requestfailed', r => {
    issues.push({ kind: 'requestfailed', text: `${r.method()} ${r.url()} — ${r.failure()?.errorText}` });
  });
  page.on('response', r => {
    if (r.status() >= 400) issues.push({ kind: 'http', text: `${r.status()} ${r.request().method()} ${r.url()}` });
  });
  return issues;
}

module.exports = { launch, browserEnv, VIEWPORTS, collectIssues, devices };
