// Routing invariants for the email-OTP endpoints (worker/index.js), pinned as source text the
// same way the phone ones are relied on: the six self-service /email-otp/* routes are reachable
// with no bearer (the login form has none yet), while the admin add — which attaches an
// arbitrary address to an arbitrary account with no proof — must sit OUTSIDE that exempt prefix
// and behind requireAdminTab('users'). A refactor that moves it under /email-otp/ would open an
// unauthenticated account-takeover primitive without any test noticing otherwise.
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const src = fs.readFileSync(path.join(WORKER, 'index.js'), 'utf8');
const lines = src.split('\n');

test('the bearer exemption covers /email-otp/ exactly as it covers /phone-otp/', () => {
    const gate = lines.find(l => l.includes('const expectedBearer') === false && l.includes("!path.startsWith('/phone-otp/')"));
    assert.ok(gate, 'bearer gate line not found');
    assert.ok(gate.includes("!path.startsWith('/email-otp/')"), gate);
});

test('every self-service email route is mounted under the exempt prefix', () => {
    for (const p of ['/email-otp/send', '/email-otp/verify', '/email-otp/bind', '/email-otp/set-primary', '/email-otp/remove', '/email-otp/list']) {
        assert.ok(src.includes(`path === '${p}'`), `route ${p} missing`);
    }
});

test('the admin add is outside the exempt prefix and gated by requireAdminTab(users)', () => {
    const line = lines.find(l => l.includes("path === '/admin-email-add'"));
    assert.ok(line, '/admin-email-add route missing');
    assert.ok(!line.includes('/email-otp/'), 'must not live under the bearer-exempt prefix');
    const idx = lines.indexOf(line);
    const handlerLine = lines.slice(idx, idx + 3).join('\n');
    assert.match(handlerLine, /requireAdminTab\(adminCtx, 'users'\) \|\| await handleEmailOtpAdminAdd\(/);
    assert.ok(!src.includes("path === '/email-otp/admin-add'"), 'no admin add under /email-otp/');
});

test('handleEmailOtpAdminAdd is only ever reached through /admin-email-add', () => {
    const uses = lines.filter(l => l.includes('handleEmailOtpAdminAdd(') );
    assert.strictEqual(uses.length, 1, uses.join('\n'));
    assert.ok(uses[0].includes('requireAdminTab'));
});
