// Web-admin email OTP login. Runs offline with DB, mail/OTP and token signing stubbed.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const handlerPath = path.join(WORKER, 'handlers', 'admin-accounts.js');

function loadHandler({ account = null, adminUser = null, verified = true, smsVerified = true } = {}) {
    const calls = { issued: [], verified: [], smsIssued: [], smsVerified: [] };
    const stub = (rel, exports) => {
        const full = require.resolve(path.join(WORKER, rel));
        require.cache[full] = { id: full, filename: full, loaded: true, exports };
    };
    delete require.cache[require.resolve(handlerPath)];
    stub('lib/db', {
        pool: {
            query: async (sql) => {
                if (sql.includes('FROM admin_accounts')) return { rows: account ? [account] : [] };
                if (sql.includes('FROM users u') && sql.includes('JOIN user_phones')) return { rows: adminUser ? [adminUser] : [] };
                if (sql.includes('FROM channels')) return { rows: [] };
                return { rows: [] };
            },
        },
    });
    stub('lib/auth', {
        signSuperadminToken: ({ sub, username }) => `sa.${sub}.${username}`,
        signChannelAdminToken: () => 'ch.token',
        CHANNEL_ADMIN_FULL_PERMS: [],
        expandPermissions: value => value || [],
        requirePermission: () => null,
        verifySubchannelOwnership: async () => true,
    });
    stub('lib/email-otp', {
        TTL_MINUTES: 5,
        normalizeEmail: value => String(value || '').trim().toLowerCase(),
        isValidEmail: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        issueEmailOtp: async (...args) => { calls.issued.push(args); return { ok: true }; },
        verifyEmailOtp: async (...args) => { calls.verified.push(args); return verified ? { ok: true } : { ok: false, error: 'invalid_code' }; },
    });
    stub('handlers/phone-otp', {
        handlePhoneOtpSend: async (...args) => { calls.smsIssued.push(args); return { success: true, expires_in: 300 }; },
    });
    stub('lib/sms', {
        verifyOTP: async (...args) => { calls.smsVerified.push(args); return smsVerified; },
    });
    stub('lib/phone', {
        normalizeCnPhone: value => /^1\d{10}$/.test(value) ? `+86${value}` : value,
    });
    return { ...require(handlerPath), calls };
}

test('admin OTP send is purpose-scoped and does not disclose an unknown email', async () => {
    const known = loadHandler({ account: { id: 7, username: 'root', email: 'admin@example.com', channel_id: null } });
    const sent = await known.handleAdminLogin({ mode: 'otp', action: 'send', email: 'ADMIN@example.com' });
    assert.equal(sent.success, true);
    assert.deepEqual(known.calls.issued[0].slice(0, 2), ['admin@example.com', 'admin_login']);

    const unknown = loadHandler();
    const hidden = await unknown.handleAdminLogin({ mode: 'otp', action: 'send', email: 'nobody@example.com' });
    assert.equal(hidden.success, true);
    assert.equal(unknown.calls.issued.length, 0);
});

test('admin OTP verification accepts only an admin_login code and returns the normal session', async () => {
    const account = { id: 9, username: 'root', email: 'admin@example.com', channel_id: null };
    const ok = loadHandler({ account });
    const result = await ok.handleAdminLogin({ mode: 'otp', email: account.email, code: '123456' });
    assert.equal(result.token, 'sa.9.root');
    assert.equal(result.username, 'root');
    assert.deepEqual(ok.calls.verified[0], [account.email, '123456', 'admin_login']);

    const bad = loadHandler({ account, verified: false });
    const denied = await bad.handleAdminLogin({ mode: 'otp', email: account.email, code: '000000' });
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.token, undefined);
});

test('admin SMS OTP uses the shared rate-limited sender and issues the normal session', async () => {
    const adminUser = { user_id: 'u12', nickname: 'Mobile Admin', roles: ['user', 'superadmin'], channel_id: 3 };
    const admin = loadHandler({ adminUser });
    const sent = await admin.handleAdminLogin({ mode: 'sms_otp', action: 'send', phone: '13800000000' }, '1.2.3.4');
    assert.equal(sent.success, true);
    assert.deepEqual(admin.calls.smsIssued[0], [{ phone: '13800000000' }, '1.2.3.4']);

    const result = await admin.handleAdminLogin({ mode: 'sms_otp', phone: '13800000000', code: '654321' });
    assert.equal(result.token, 'sa.u12.Mobile Admin');
    assert.deepEqual(admin.calls.smsVerified[0], ['13800000000', '654321']);
});

test('admin SMS OTP never sends to an unregistered number and rejects the super OTP unless PNVS verifies it', async () => {
    const unknown = loadHandler();
    const hidden = await unknown.handleAdminLogin({ mode: 'sms_otp', action: 'send', phone: '13900000000' }, '5.6.7.8');
    assert.equal(hidden.success, true);
    assert.equal(unknown.calls.smsIssued.length, 0);

    const adminUser = { user_id: 'u13', nickname: 'Mobile Admin', roles: ['user', 'admin'], channel_id: 4 };
    const denied = loadHandler({ adminUser, smsVerified: false });
    const result = await denied.handleAdminLogin({ mode: 'sms_otp', phone: '13900000000', code: '761111' });
    assert.equal(result.statusCode, 401);
    assert.equal(result.token, undefined);
});

test('a regular Mini Program user cannot enter the web admin panel with a valid SMS code', async () => {
    const regularUser = { user_id: 'u14', nickname: 'Regular', roles: ['user'], channel_id: 4 };
    const regular = loadHandler({ adminUser: regularUser });
    const send = await regular.handleAdminLogin({ mode: 'sms_otp', action: 'send', phone: '13700000000' }, '1.1.1.1');
    assert.equal(send.success, true);
    assert.equal(regular.calls.smsIssued.length, 0);

    const result = await regular.handleAdminLogin({ mode: 'sms_otp', phone: '13700000000', code: '123456' });
    assert.equal(result.statusCode, 403);
    assert.equal(result.error, 'admin_role_required');
});
