// Regression coverage for the coach-referral signup path.
//
// Prod incident 2026-08-29 (channel 2, aeviva-china): a coach ran an event and shared her PERSONAL
// referral code (users.referral_code, what pages/referral shares as `invite=`) instead of her coach
// invitation code (invitations.code). Both arrive as `invite_code` on /wx-login, but only the
// invitation branch resolved a coach — the referral fallback set referred_by_user_id and inherited
// the channel while leaving users.coach_id NULL. All 36 signups that day were therefore invisible in
// her coach client list, which filters strictly on `WHERE u.coach_id = $1` (handlers/coaches.js).
//
// The fix: when a referral code belongs to a user who is an active coach, that coach is assigned.
// An ordinary (non-coach) referrer must still assign nobody — that is asserted here too, because
// fabricating a coach for every user-to-user referral would be the worse bug.
//
// Runs fully offline: lib/db, lib/auth and lib/personaOverride are stubbed through require.cache,
// and global fetch is replaced, so there is no Postgres, no WeChat call and no LLM call.

const assert = require('assert');
const path = require('path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

const COACH_REFERRER = { user_id: 'a54232c7', channel_id: 2, referral_code: '294364', coaches_id: 44 };
const PLAIN_REFERRER = { user_id: 'plainref', channel_id: 2, referral_code: '111111' };

let scenario;
const queries = [];

const pool = {
    query: async (sql, params) => {
        queries.push({ sql, params });
        // Existing-account lookup by openid.
        if (/WHERE u\.external_id = \$1 OR u\.user_id = \$1/.test(sql)) return { rows: scenario.existing ? [scenario.existing] : [] };
        // The shared code is never a coach invitation in any of these scenarios.
        if (/FROM invitations/.test(sql)) return { rows: [] };
        // ...so it falls through to the referral-code lookup.
        if (/FROM users WHERE referral_code = \$1/.test(sql)) return { rows: [{ user_id: scenario.referrer.user_id, channel_id: scenario.referrer.channel_id }] };
        // The new lookup under test: is that referrer an active coach?
        if (/FROM coaches WHERE user_id = \$1 AND status = 'active'/.test(sql)) {
            return { rows: params[0] === COACH_REFERRER.user_id ? [{ id: COACH_REFERRER.coaches_id }] : [] };
        }
        if (/INSERT INTO users/.test(sql)) return { rows: [{ user_id: 'newuser1', roles: ['user'] }] };
        if (/FROM channels WHERE id = \$1/.test(sql)) return { rows: [{ name: 'Aeviva', key_name: 'aeviva-china', logo_url: null, sub_age_display_names: null }] };
        return { rows: [] };
    },
};

stub('lib/db', { pool });
stub('lib/auth', {
    generateUserId: () => 'newuser1',
    generateReferralCode: async () => '999999',
    getWxAccessToken: async () => 'tok',
});
stub('lib/personaOverride', { grantSignupTrial: async () => {} });
stub('handlers/partners', { syncPartnerPhoneFromUser: async () => {} });

process.env.WX_APPID = 'appid';
process.env.WX_SECRET = 'secret';
global.fetch = async () => ({ json: async () => ({ openid: 'openid-new', unionid: null }) });

const { handleWxLogin } = require(path.join(WORKER, 'handlers', 'login.js'));

// The INSERT's column order is fixed by the handler; coach_id is the 3rd bound param.
const insertedCoachId = () => {
    const ins = queries.find(q => /INSERT INTO users/.test(q.sql));
    assert.ok(ins, 'expected a users INSERT');
    return ins.params[2];
};
const updatedCoachId = () => {
    const up = queries.find(q => /UPDATE users SET coach_id = \$1/.test(q.sql));
    return up ? up.params[0] : null;
};

const run = async (name, fn) => {
    queries.length = 0;
    await fn();
    console.log(`  ok  ${name}`);
};

(async () => {
    await run('new signup with a coach\'s referral code is assigned to that coach', async () => {
        scenario = { existing: null, referrer: COACH_REFERRER };
        const res = await handleWxLogin({ code: 'js_code', invite_code: COACH_REFERRER.referral_code });
        assert.strictEqual(res.success, true);
        assert.strictEqual(insertedCoachId(), COACH_REFERRER.coaches_id,
            'coach_id must be the referrer\'s coaches.id, not null');
    });

    await run('new signup with an ordinary user\'s referral code gets no coach', async () => {
        scenario = { existing: null, referrer: PLAIN_REFERRER };
        const res = await handleWxLogin({ code: 'js_code', invite_code: PLAIN_REFERRER.referral_code });
        assert.strictEqual(res.success, true);
        assert.strictEqual(insertedCoachId(), null,
            'a non-coach referrer must not produce a coach assignment');
    });

    await run('an explicit coach_id still wins over the referrer', async () => {
        scenario = { existing: null, referrer: COACH_REFERRER };
        await handleWxLogin({ code: 'js_code', invite_code: COACH_REFERRER.referral_code, coach_id: '7' });
        assert.strictEqual(insertedCoachId(), 7, 'explicit coach_id must not be overwritten');
    });

    await run('existing coachless user supplying a coach referral code is back-assigned', async () => {
        scenario = {
            existing: { user_id: 'olduser1', roles: ['user'], coach_id: null, channel_id: null, referred_by_user_id: null, merged_into_user_id: null },
            referrer: COACH_REFERRER,
        };
        await handleWxLogin({ code: 'js_code', invite_code: COACH_REFERRER.referral_code });
        assert.strictEqual(updatedCoachId(), COACH_REFERRER.coaches_id,
            'an existing user with no coach should pick one up from the referrer');
    });

    await run('existing user who already has a coach keeps it', async () => {
        scenario = {
            existing: { user_id: 'olduser2', roles: ['user'], coach_id: 12, channel_id: null, referred_by_user_id: null, merged_into_user_id: null },
            referrer: COACH_REFERRER,
        };
        await handleWxLogin({ code: 'js_code', invite_code: COACH_REFERRER.referral_code });
        assert.strictEqual(updatedCoachId(), null, 'an existing coach assignment must never be reassigned');
    });

    console.log('\nall coach-referral assignment tests passed');
})().catch(err => { console.error(err); process.exit(1); });
