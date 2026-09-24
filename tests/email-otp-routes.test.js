// Routing invariants for the email-OTP endpoints (worker/index.js), pinned as source text: only
// send/verify are reachable with no bearer (the login form has none yet), while the admin add —
// which attaches an arbitrary address to an arbitrary account with no proof — sits behind
// requireAdminTab('users'). A refactor that made either public would open an unauthenticated
// account-takeover primitive without any test noticing otherwise.
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const src = fs.readFileSync(path.join(WORKER, 'index.js'), 'utf8');
const lines = src.split('\n');

// The gate exempts an exact set of paths, not prefixes: only the login steps (send/verify) are
// reachable with no credential. bind / set-primary / remove / list take a user_id from the
// request, so leaving them public was an account-takeover primitive (TODO.md "Security").
const publicSet = (() => {
    const m = src.match(/const PUBLIC_PATHS = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(m, 'PUBLIC_PATHS not found');
    // Entries are 'METHOD /path'; these checks are about the path.
    return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1].split(' ').pop()));
})();

test('only send and verify are bearer-exempt, for phone and email alike', () => {
    for (const kind of ['phone-otp', 'email-otp']) {
        assert.ok(publicSet.has(`/${kind}/send`), kind);
        assert.ok(publicSet.has(`/${kind}/verify`), kind);
        for (const p of ['bind', 'set-primary', 'remove', 'list', 'accept-unverified']) {
            assert.ok(!publicSet.has(`/${kind}/${p}`), `/${kind}/${p} must need a credential`);
        }
    }
    assert.ok(!src.includes("path.startsWith('/email-otp/')"), 'no prefix exemption');
    assert.ok(!src.includes("path.startsWith('/phone-otp/')"), 'no prefix exemption');
});

test('every self-service email route is still mounted', () => {
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
