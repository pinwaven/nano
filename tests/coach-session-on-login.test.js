// Every login path must return the caller's own `coach` object, not just user + channel.
//
// Prod 2026-08-30: a coach's client list was empty in the production miniapp even though her 37
// clients were correctly assigned and `GET /api/coach-users/44` returned all of them. Cause: she
// signed in with phone + OTP, and handlePhoneOtpVerify returned only { user, channel }. The client
// does `const coach = data.coach || null` (pages/login/login.js `_finishLogin`), so globalData.coach
// became null; pages/coach/coach.js then sets `_coachId = null` and `_loadAll` short-circuits to an
// empty list WITHOUT calling the API at all. The panel was reachable the whole time because its
// permission check reads user.roles, which that response did carry — so it looked like "no clients"
// rather than "no session", which is what made it hard to see.
//
// Runs fully offline: db/sms/merge/trial/partners are stubbed through require.cache.

const assert = require('assert');
const path = require('path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

const COACH_ROW = {
    user_id: 'a54232c7', nickname: '黄毅', roles: ['user', 'coach'], coach_id: 18, channel_id: 2,
    channel_name: 'Aeviva', channel_key: 'aeviva-china', channel_logo_url: null,
    channel_sub_age_names: null, channel_locale: 'zh',
};
const PLAIN_ROW = { ...COACH_ROW, user_id: 'plainuser', nickname: '普通用户', roles: ['user'] };

let userRow = COACH_ROW;

const pool = {
    query: async (sql, params) => {
        if (/JOIN user_phones up/.test(sql)) return { rows: userRow ? [userRow] : [] };
        // The coach-identity lookup under test.
        if (/FROM coaches c JOIN users u2/.test(sql)) {
            return { rows: params[0] === COACH_ROW.user_id ? [{ id: 44, channel_id: 2, user_id: COACH_ROW.user_id }] : [] };
        }
        return { rows: [] };
    },
};

stub('lib/db', { pool });
stub('lib/sms', { sendOTP: async () => {}, verifyOTP: async () => true });
stub('lib/phone', { normalizeCnPhone: p => (p && /^1\d{10}$/.test(p) ? `+86${p}` : p) });
stub('lib/auth', { generateUserId: () => 'newid', generateReferralCode: async () => '000001', getWxAccessToken: async () => 'tok' });
stub('lib/personaOverride', { grantSignupTrial: async () => {} });
stub('handlers/user-merge', { mergeUsers: async () => {}, resolveMergedUser: async (r) => r });
stub('handlers/partners', { syncPartnerPhoneFromUser: async () => {} });

const { handlePhoneOtpVerify } = require(path.join(WORKER, 'handlers', 'phone-otp.js'));

const run = async (name, fn) => { await fn(); console.log(`  ok  ${name}`); };

(async () => {
    await run('phone-OTP login returns the coach object for a coach', async () => {
        userRow = COACH_ROW;
        const res = await handlePhoneOtpVerify({ phone: '13818058348', code: '123456' });
        assert.strictEqual(res.success, true);
        assert.ok(res.coach, 'response must carry a coach object — the client stores it as globalData.coach');
        assert.strictEqual(res.coach.id, 44, 'coach.id is what pages/coach/coach.js uses as _coachId');
        assert.strictEqual(res.coach.channel_id, 2);
    });

    await run('phone-OTP login returns coach: null for a non-coach', async () => {
        userRow = PLAIN_ROW;
        const res = await handlePhoneOtpVerify({ phone: '13800000000', code: '123456' });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.coach, null, 'an ordinary user must not be handed a coach session');
    });

    await run('the response still carries user and channel unchanged', async () => {
        userRow = COACH_ROW;
        const res = await handlePhoneOtpVerify({ phone: '13818058348', code: '123456' });
        assert.strictEqual(res.user.user_id, 'a54232c7');
        assert.ok(res.user.roles.includes('coach'), 'roles drive the panel permission check');
        assert.strictEqual(res.channel.key_name, 'aeviva-china');
        assert.ok(!('channel_name' in res.user), 'channel fields must stay stripped out of user');
    });

    console.log('\nall coach-session login tests passed');
})().catch(err => { console.error(err); process.exit(1); });
