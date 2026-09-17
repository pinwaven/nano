// Email OTP — lib/email-otp.js (code lifecycle) and handlers/email-otp.js (login / sign-up / bind).
//
// Runs fully offline: lib/db is replaced by a small in-memory Postgres stand-in that dispatches
// on the SQL text and keeps real state for email_otp_codes / users / user_emails / channels, so
// the rate limit, the attempt cap, consume-on-success and the sign-up transaction are exercised
// as the handlers actually drive them rather than through canned rows. lib/email (DirectMail)
// records what it would have sent.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

// ── in-memory DB ────────────────────────────────────────────────────────────
const CHANNELS = [
    { id: 1, key_name: 'waven', parent_channel_id: null, name: 'Waven' },
    { id: 2, key_name: 'aeviva-china', parent_channel_id: 3, name: 'Aeviva China' },
    { id: 3, key_name: 'aeviva', parent_channel_id: null, name: 'Aeviva' },
    { id: 4, key_name: 'waven-china', parent_channel_id: 1, name: 'Waven China' },
    { id: 5, key_name: 'waven-china-zj', parent_channel_id: 4, name: 'Waven China ZJ' },
];
let now = Date.now();
const db = { codes: [], users: [], emails: [], audit: [], merges: [], trials: [] };
let nextId = 1;

const rootKey = id => {
    let c = CHANNELS.find(x => x.id === id);
    while (c && c.parent_channel_id != null) c = CHANNELS.find(x => x.id === c.parent_channel_id);
    return c ? c.key_name : null;
};
const userSelectRow = u => {
    const c = CHANNELS.find(x => x.id === u.channel_id);
    return {
        ...u,
        phone_verified: !!(u.phone_verified_at && u.phone),
        email_verified: !!(u.email_verified_at && u.email),
        bio_age: null, coach_name: null,
        channel_name: c ? c.name : null, channel_key: c ? c.key_name : null,
        channel_logo_url: null, channel_sub_age_names: null, channel_locale: 'zh',
    };
};

async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return { rows: [] };

    // ── email_otp_codes ──
    if (/FROM email_otp_codes WHERE email = \$1 AND created_at > NOW\(\) - INTERVAL '1 hour'/.test(s)) {
        const rows = db.codes.filter(r => r.email === params[0] && r.created_at > now - 3600e3);
        const recent = rows.filter(r => r.created_at > now - 60e3).length;
        const last_at = rows.length ? new Date(Math.max(...rows.map(r => r.created_at))) : null;
        return { rows: [{ recent, hourly: rows.length, last_at }] };
    }
    if (/UPDATE email_otp_codes SET consumed = TRUE WHERE email = \$1 AND consumed = FALSE/.test(s)) {
        db.codes.forEach(r => { if (r.email === params[0] && !r.consumed) r.consumed = true; });
        return { rows: [] };
    }
    if (/INSERT INTO email_otp_codes/.test(s)) {
        db.codes.push({ id: nextId++, email: params[0], code_hash: params[1], purpose: params[2], attempts: 0, consumed: false, created_at: now, expires_at: now + 300e3 });
        return { rows: [] };
    }
    if (/SELECT id, code_hash, attempts FROM email_otp_codes/.test(s)) {
        const rows = db.codes.filter(r => r.email === params[0] && !r.consumed && r.expires_at > now).sort((a, b) => b.created_at - a.created_at);
        return { rows: rows.slice(0, 1).map(r => ({ id: r.id, code_hash: r.code_hash, attempts: r.attempts })) };
    }
    if (/UPDATE email_otp_codes SET attempts = \$2::int, consumed = \(\$2::int >= \$3::int\) WHERE id = \$1/.test(s)) {
        const r = db.codes.find(x => x.id === params[0]); r.attempts = params[1]; r.consumed = params[1] >= params[2];
        return { rows: [] };
    }
    if (/UPDATE email_otp_codes SET consumed = TRUE WHERE id = \$1/.test(s)) {
        db.codes.find(x => x.id === params[0]).consumed = true; return { rows: [] };
    }

    // ── channels ──
    if (/WITH RECURSIVE up AS/.test(s)) {
        const k = rootKey(params[0]); return { rows: k ? [{ key_name: k }] : [] };
    }
    if (/SELECT id FROM channels WHERE key_name = \$1/.test(s)) {
        const c = CHANNELS.find(x => x.key_name === params[0]); return { rows: c ? [{ id: c.id }] : [] };
    }

    // ── users / user_emails ──
    if (/JOIN user_emails ue ON ue.user_id = u.user_id WHERE ue.email = \$1/.test(s)) {
        const e = db.emails.find(x => x.email === params[0]);
        const u = e && db.users.find(x => x.user_id === e.user_id);
        return { rows: u ? [userSelectRow(u)] : [] };
    }
    if (/FROM users u .*WHERE u.user_id = \$1 LIMIT 1/.test(s)) {
        const u = db.users.find(x => x.user_id === params[0]); return { rows: u ? [userSelectRow(u)] : [] };
    }
    if (/^INSERT INTO users \(user_id, email, email_verified_at, external_app, language, channel_id, referral_code, created_at\)/.test(s)) {
        if (db.users.some(u => u.email === params[1])) { const e = new Error('dup'); e.code = '23505'; throw e; }
        db.users.push({ user_id: params[0], email: params[1], email_verified_at: new Date(now), external_app: 'email', language: params[2], channel_id: params[3], referral_code: params[4], created_at: new Date(now), roles: ['user'], phone: null, nickname: null });
        return { rows: [] };
    }
    if (/^INSERT INTO user_emails \(user_id, email, verified_at, is_primary\) VALUES \(\$1, \$2, NOW\(\), true\)/.test(s)) {
        db.emails.push({ user_id: params[0], email: params[1], verified_at: new Date(now), is_primary: true }); return { rows: [] };
    }
    if (/SELECT user_id, channel_id, created_at, merged_into_user_id FROM users WHERE user_id = \$1/.test(s)) {
        const u = db.users.find(x => x.user_id === params[0]);
        return { rows: u ? [{ user_id: u.user_id, channel_id: u.channel_id, created_at: u.created_at, merged_into_user_id: null }] : [] };
    }
    if (/SELECT user_id FROM user_emails WHERE email = \$1 AND user_id != \$2/.test(s)) {
        const e = db.emails.find(x => x.email === params[0] && x.user_id !== params[1]);
        return { rows: e ? [{ user_id: e.user_id }] : [] };
    }
    if (/SELECT 1 FROM user_emails WHERE user_id = \$1 AND is_primary AND email != \$2/.test(s)) {
        return { rows: db.emails.filter(x => x.user_id === params[0] && x.is_primary && x.email !== params[1]).map(() => ({ '?column?': 1 })) };
    }
    if (/INSERT INTO user_emails \(user_id, email, verified_at, is_primary\) VALUES \(\$1, \$2, NOW\(\), \$3\) ON CONFLICT/.test(s)) {
        const existing = db.emails.find(x => x.email === params[1]);
        if (existing) {
            if (existing.user_id !== params[0]) return { rows: [] };
            existing.verified_at = new Date(now); existing.is_primary = params[2];
            return { rows: [{ user_id: existing.user_id, is_primary: existing.is_primary }] };
        }
        db.emails.push({ user_id: params[0], email: params[1], verified_at: new Date(now), is_primary: params[2] });
        return { rows: [{ user_id: params[0], is_primary: params[2] }] };
    }
    if (/UPDATE users SET email = \$1, email_verified_at = NOW\(\) WHERE user_id = \$2/.test(s)) {
        const u = db.users.find(x => x.user_id === params[1]); u.email = params[0]; u.email_verified_at = new Date(now); return { rows: [] };
    }
    if (/INSERT INTO super_otp_audit_log/.test(s)) { db.audit.push({ target: params[0], user_id: params[1], sql: s }); return { rows: [] }; }
    throw new Error(`unhandled SQL in test double: ${s.slice(0, 120)}`);
}
const pool = { query, connect: async () => ({ query, release: () => {} }) };

// ── stubs ──
const sent = [];
stub('lib/db', { pool });
stub('lib/email', { sendEmailOtp: async (email, code, lang) => { sent.push({ email, code, lang }); return null; }, sendMail: async () => null, isConfigured: () => false });
stub('lib/auth', { generateUserId: () => `u${nextId++}`, generateReferralCode: async () => '000001', generatePhoneOtpCode: () => String(100000 + crypto.randomInt(900000)), getWxAccessToken: async () => 'tok' });
stub('lib/personaOverride', { grantSignupTrial: async (_pool, user_id, channelId) => { db.trials.push({ user_id, channelId }); } });
stub('handlers/user-merge', { mergeUsers: async (w, l, m) => { db.merges.push({ winner: w, loser: l, matched_on: m }); }, resolveMergedUser: async (_c, r) => r });
stub('handlers/partners', { syncPartnerPhoneFromUser: async () => {} });
stub('handlers/login', { resolveCoachSession: async () => null });
stub('lib/sms', { sendOTP: async () => {}, verifyOTP: async () => true });
stub('lib/phone', { normalizeCnPhone: p => p });

const { handleEmailOtpSend, handleEmailOtpVerify, handleEmailOtpBind, emailLoginAllowed } = require(path.join(WORKER, 'handlers', 'email-otp.js'));
const { normalizeEmail, VERIFY_MAX_ATTEMPTS } = require(path.join(WORKER, 'lib', 'email-otp.js'));

const reset = () => { db.codes = []; db.users = []; db.emails = []; db.audit = []; db.merges = []; db.trials = []; sent.length = 0; now = Date.now(); };
const lastCode = () => sent[sent.length - 1].code;
const seedUser = (user_id, channel_id, email, extra = {}) => {
    db.users.push({ user_id, channel_id, email: email || null, email_verified_at: email ? new Date(now) : null, phone: null, roles: ['user'], created_at: new Date(now - 1e6), nickname: 'x', ...extra });
    if (email) db.emails.push({ user_id, email, verified_at: new Date(now), is_primary: true });
};

// ── send ────────────────────────────────────────────────────────────────────
test('send: normalizes the address, issues one code, and refuses a second inside 60s', async () => {
    reset();
    const r1 = await handleEmailOtpSend({ email: '  Foo@Example.COM ' });
    assert.deepStrictEqual(r1, { success: true, expires_in: 300 });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].email, 'foo@example.com');
    const r2 = await handleEmailOtpSend({ email: 'foo@example.com' });
    assert.strictEqual(r2.success, false);
    assert.strictEqual(r2.error, 'rate_limited');
    assert.ok(r2.retry_after > 0 && r2.retry_after <= 60);
    assert.strictEqual(sent.length, 1, 'nothing sent on the throttled attempt');
});

test('send: at most 5 codes per address per hour', async () => {
    reset();
    for (let i = 0; i < 5; i++) {
        now += 61e3;
        assert.strictEqual((await handleEmailOtpSend({ email: 'a@b.co' })).success, true, `send #${i + 1}`);
    }
    now += 61e3;
    const r = await handleEmailOtpSend({ email: 'a@b.co' });
    assert.strictEqual(r.error, 'rate_limited');
    assert.strictEqual(sent.length, 5);
});

test('send: rejects a malformed address without touching the sender', async () => {
    reset();
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', null]) {
        const r = await handleEmailOtpSend({ email: bad });
        assert.strictEqual(r.error, 'invalid_email', String(bad));
    }
    assert.strictEqual(sent.length, 0);
});

test('send: never reveals whether the address is registered', async () => {
    reset();
    seedUser('known', 1, 'known@x.io');
    const a = await handleEmailOtpSend({ email: 'known@x.io' });
    const b = await handleEmailOtpSend({ email: 'stranger@x.io' });
    assert.deepStrictEqual(a, b);
});

// ── verify: the code itself ─────────────────────────────────────────────────
test('verify: five wrong guesses consume the code; the right one no longer works', async () => {
    reset();
    await handleEmailOtpSend({ email: 'v@x.io' });
    const real = lastCode();
    const wrong = real === '000000' ? '000001' : '000000';
    let r;
    for (let i = 1; i <= VERIFY_MAX_ATTEMPTS; i++) {
        r = await handleEmailOtpVerify({ email: 'v@x.io', code: wrong });
        assert.strictEqual(r.success, false);
        assert.strictEqual(r.error, i < VERIFY_MAX_ATTEMPTS ? 'invalid_code' : 'too_many_attempts', `attempt ${i}`);
    }
    r = await handleEmailOtpVerify({ email: 'v@x.io', code: real });
    assert.strictEqual(r.error, 'invalid_code', 'the burned code must not log anyone in');
    assert.strictEqual(db.users.length, 0);
});

test('verify: a used code cannot be replayed; a resend invalidates the previous code', async () => {
    reset();
    await handleEmailOtpSend({ email: 'r@x.io' });
    const first = lastCode();
    now += 61e3;
    await handleEmailOtpSend({ email: 'r@x.io' });
    const second = lastCode();
    assert.strictEqual((await handleEmailOtpVerify({ email: 'r@x.io', code: first })).error, 'invalid_code', 'superseded code');
    assert.strictEqual((await handleEmailOtpVerify({ email: 'r@x.io', code: second })).success, true);
    assert.strictEqual((await handleEmailOtpVerify({ email: 'r@x.io', code: second })).error, 'invalid_code', 'replay');
});

// ── verify: who gets in ─────────────────────────────────────────────────────
test('verify: an unknown address creates a waven user with a verified primary email', async () => {
    reset();
    await handleEmailOtpSend({ email: 'New@x.io', language: 'en' });
    const r = await handleEmailOtpVerify({ email: 'new@x.io', code: lastCode(), language: 'en' });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    const u = db.users[0];
    assert.strictEqual(u.email, 'new@x.io');
    assert.strictEqual(u.external_app, 'email');
    assert.strictEqual(u.language, 'en');
    assert.strictEqual(u.channel_id, 1, 'root waven channel, like the WeChat default');
    assert.deepStrictEqual(db.emails, [{ user_id: u.user_id, email: 'new@x.io', verified_at: db.emails[0].verified_at, is_primary: true }]);
    assert.deepStrictEqual(db.trials, [{ user_id: u.user_id, channelId: 1 }]);
    assert.strictEqual(r.user.email_verified, true);
    assert.strictEqual(r.channel.key_name, 'waven');
    assert.strictEqual(r.channel.root_key_name, 'waven');
    assert.strictEqual(r.coach, null);
});

test('verify: an existing waven-tree user logs in; an aeviva-tree user is refused', async () => {
    reset();
    seedUser('zj', 5, 'zj@x.io');      // waven-china-zj → root waven
    seedUser('ac', 2, 'ac@x.io');      // aeviva-china   → root aeviva
    seedUser('none', null, 'none@x.io');

    for (const [email, ok, who] of [['zj@x.io', true, 'zj'], ['none@x.io', true, 'none'], ['ac@x.io', false, 'ac']]) {
        now += 61e3;
        await handleEmailOtpSend({ email });
        const r = await handleEmailOtpVerify({ email, code: lastCode() });
        if (ok) {
            assert.strictEqual(r.success, true, email);
            assert.strictEqual(r.user.user_id, who);
        } else {
            assert.deepStrictEqual(r, { success: false, error: 'channel_not_supported' });
        }
    }
    assert.strictEqual(db.users.length, 3, 'no sign-up on a refused login');
});

test('the allow-rule is about the channel ROOT', () => {
    assert.strictEqual(emailLoginAllowed(null), true);
    assert.strictEqual(emailLoginAllowed('waven'), true);
    assert.strictEqual(emailLoginAllowed('aeviva'), false);
    assert.strictEqual(emailLoginAllowed('waven-china'), false, 'a leaf key is never passed here; only roots');
});

// ── super OTP ───────────────────────────────────────────────────────────────
test('super OTP: honoured on login with an email-typed audit row, never on bind', async () => {
    reset();
    process.env.SUPER_OTP_ENABLED = 'true';
    // handlers read the flag at module load; re-require to pick it up.
    delete require.cache[require.resolve(path.join(WORKER, 'handlers', 'email-otp.js'))];
    delete require.cache[require.resolve(path.join(WORKER, 'handlers', 'phone-otp.js'))];
    const h = require(path.join(WORKER, 'handlers', 'email-otp.js'));
    seedUser('su', 1, 'su@x.io');
    const r = await h.handleEmailOtpVerify({ email: 'su@x.io', code: '761111' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(db.audit.length, 1);
    assert.match(db.audit[0].sql, /identifier_type, resolved_user_id\) VALUES \(\$1, 'email', \$2\)/);
    assert.strictEqual(db.audit[0].target, 'su@x.io');

    seedUser('other', 1, null);
    const b = await h.handleEmailOtpBind({ user_id: 'other', email: 'brand-new@x.io', code: '761111' });
    assert.strictEqual(b.error, 'invalid_code', 'bind must never accept the backdoor code');
    delete process.env.SUPER_OTP_ENABLED;
});

// ── bind ────────────────────────────────────────────────────────────────────
test('bind: first email becomes primary and stamps users.email / email_verified_at', async () => {
    reset();
    seedUser('wx', 4, null);   // WeChat user on waven-china, no email yet
    await handleEmailOtpSend({ email: 'me@x.io', purpose: 'bind' });
    const r = await handleEmailOtpBind({ user_id: 'wx', email: 'ME@x.io', code: lastCode() });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual(db.emails[0].is_primary, true);
    assert.strictEqual(db.users[0].email, 'me@x.io');
    assert.ok(db.users[0].email_verified_at);
    assert.strictEqual(r.user.email_verified, true);
});

test('bind: an address owned by an older account merges the two, earlier-created wins', async () => {
    reset();
    seedUser('old', 1, 'shared@x.io', { created_at: new Date(now - 5e6) });
    seedUser('new', 1, null, { created_at: new Date(now - 1e3) });
    await handleEmailOtpSend({ email: 'shared@x.io' });
    const r = await handleEmailOtpBind({ user_id: 'new', email: 'shared@x.io', code: lastCode() });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual(r.merged, true);
    assert.deepStrictEqual(db.merges, [{ winner: 'old', loser: 'new', matched_on: 'email_otp' }]);
    assert.strictEqual(r.user.user_id, 'old');
});

test('bind: refused when either side is an aeviva account, and nothing is merged', async () => {
    reset();
    seedUser('av', 2, 'av@x.io');
    seedUser('wv', 1, null);
    await handleEmailOtpSend({ email: 'av@x.io' });
    const r = await handleEmailOtpBind({ user_id: 'wv', email: 'av@x.io', code: lastCode() });
    assert.deepStrictEqual(r, { success: false, error: 'channel_not_supported' });
    assert.strictEqual(db.merges.length, 0);

    now += 61e3;
    await handleEmailOtpSend({ email: 'fresh@x.io' });
    const r2 = await handleEmailOtpBind({ user_id: 'av', email: 'fresh@x.io', code: lastCode() });
    assert.deepStrictEqual(r2, { success: false, error: 'channel_not_supported' });
});

test('normalizeEmail', () => {
    assert.strictEqual(normalizeEmail('  A.B@C.Io '), 'a.b@c.io');
    assert.strictEqual(normalizeEmail(undefined), '');
});
