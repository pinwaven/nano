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
//
// Extended 2026-09-09 — an ordinary referrer now passes down THEIR OWN coach, so a coached user's
// friend joins the same coach rather than landing coachless in a coached channel. The precedence is
// asserted here because it is the part that is easy to get backwards: a referrer who is themselves
// both a coach AND coached by someone else must collect the signup for themselves, never hand it
// upward. A referrer with no coach at all still assigns nobody — fabricating one would be the worse
// bug, and that case is still covered below.
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

// A coach sharing their own personal referral code.
const COACH_REFERRER = { user_id: 'a54232c7', channel_id: 2, referral_code: '294364', coaches_id: 44 };
// An ordinary user who has a coach — the case this file's second half is about.
const PLAIN_REFERRER = { user_id: 'plainref', channel_id: 2, referral_code: '111111', users_coach_id: 30 };
// A coach who is ALSO somebody else's client. Their own identity must win.
const COACHED_COACH = { user_id: 'bothref', channel_id: 2, referral_code: '222222', coaches_id: 44, users_coach_id: 30 };
// An ordinary user with nobody coaching them either — still assigns nobody.
const ORPHAN_REFERRER = { user_id: 'orphanref', channel_id: 2, referral_code: '333333' };

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
        // The `ref=<user_id>` deep-link path resolves the referrer by id rather than by code.
        if (/SELECT user_id, channel_id FROM users WHERE user_id = \$1/.test(sql)) {
            return { rows: params[0] === scenario.referrer.user_id ? [{ user_id: scenario.referrer.user_id, channel_id: scenario.referrer.channel_id }] : [] };
        }
        // The lookup under test. One query resolves both halves in SQL (COALESCE of the referrer's
        // own active coaches row, else their users.coach_id), so the stub reproduces that precedence
        // rather than the two round trips an earlier version made.
        if (/FROM users u\s+JOIN coaches c ON c\.id = COALESCE/.test(sql)) {
            const r = [COACH_REFERRER, PLAIN_REFERRER, COACHED_COACH, ORPHAN_REFERRER]
                .find(x => x.user_id === params[0]);
            const id = r ? (r.coaches_id || r.users_coach_id || null) : null;
            return { rows: id ? [{ id }] : [] };
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

    await run('new signup with an ordinary user\'s referral code inherits that user\'s coach', async () => {
        scenario = { existing: null, referrer: PLAIN_REFERRER };
        const res = await handleWxLogin({ code: 'js_code', invite_code: PLAIN_REFERRER.referral_code });
        assert.strictEqual(res.success, true);
        assert.strictEqual(insertedCoachId(), PLAIN_REFERRER.users_coach_id,
            'the invitee should land with the same coach already serving the inviter');
    });

    await run('a referrer who is both a coach and coached keeps the signup for themselves', async () => {
        scenario = { existing: null, referrer: COACHED_COACH };
        await handleWxLogin({ code: 'js_code', invite_code: COACHED_COACH.referral_code });
        assert.strictEqual(insertedCoachId(), COACHED_COACH.coaches_id,
            'own coach identity must win over the coach the referrer is assigned to');
    });

    await run('a referrer with no coach of their own still assigns nobody', async () => {
        scenario = { existing: null, referrer: ORPHAN_REFERRER };
        const res = await handleWxLogin({ code: 'js_code', invite_code: ORPHAN_REFERRER.referral_code });
        assert.strictEqual(res.success, true);
        assert.strictEqual(insertedCoachId(), null,
            'nothing may be fabricated when the chain has no coach in it');
    });

    await run('existing coachless user inherits the coach of an ordinary referrer', async () => {
        scenario = {
            existing: { user_id: 'olduser3', roles: ['user'], coach_id: null, channel_id: null, referred_by_user_id: null, merged_into_user_id: null },
            referrer: PLAIN_REFERRER,
        };
        await handleWxLogin({ code: 'js_code', invite_code: PLAIN_REFERRER.referral_code });
        assert.strictEqual(updatedCoachId(), PLAIN_REFERRER.users_coach_id,
            'the back-assignment path must inherit through an ordinary referrer too');
    });

    // pages/login/login.js also accepts a `ref=<user_id>` deep link and persists it to wx storage.
    // It is the same invitation act as a shared code, so it must inherit the same coach — but only
    // when nothing more explicit is present, since a stored ref can be weeks stale.
    await run('a ref= deep link inherits the referrer\'s coach too', async () => {
        scenario = { existing: null, referrer: PLAIN_REFERRER };
        const res = await handleWxLogin({ code: 'js_code', ref: PLAIN_REFERRER.user_id });
        assert.strictEqual(res.success, true);
        assert.strictEqual(insertedCoachId(), PLAIN_REFERRER.users_coach_id,
            'a ref deep link must not behave differently from a shared referral code');
    });

    await run('a coach invitation code still beats a stale stored ref', async () => {
        scenario = { existing: null, referrer: PLAIN_REFERRER };
        await handleWxLogin({ code: 'js_code', ref: PLAIN_REFERRER.user_id, coach_id: '7' });
        assert.strictEqual(insertedCoachId(), 7, 'an explicit coach_id must win over a ref');
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
