// Channel scoping on /coach-users and /coach-list's user_count (handlers/coaches.js).
//
// users.coach_id is NOT channel-scoped — a coach can hold clients in several channels at once. Prod
// on 2026-09-04: coaches.id 8 has 20 assigned users, 7 in channel 2 and 13 in channel 1. That is the
// fact both bugs here grew out of, and it is why neither is obvious from reading either query alone.
//
//   /coach-users/<id>  was `WHERE u.coach_id = $1` and nothing else, with adminCtx never passed. A
//                      channel-2 admin sees coach 8 in their own /coach-list (that list is keyed on
//                      the COACH's channel, not the clients') and could then read all 20 — 13 of
//                      them outside their channel.
//
//   /coach-list        counts assigned clients with no channel condition at all, so the same admin
//                      is told "20" above a list that now correctly returns 7. Scoping one without
//                      the other just moves the inconsistency somewhere more confusing.
//
// A superadmin bearer (adminCtx.channelId === null) must keep seeing everything: that is the coach
// miniapp and the WeChat bridge, and a coach whose clients span channels must not lose half of them.
//
// Runs fully offline: lib/db is stubbed through require.cache. Run it:
//
//     node tests/coach-channel-scope.test.js

const assert = require('assert');
const path = require('path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

const queries = [];
const pool = {
    query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
    },
};
stub('lib/db', { pool });

const { handleGetCoachUsers, handleGetCoachList } = require(path.join(WORKER, 'handlers', 'coaches.js'));

const last = () => queries[queries.length - 1];
const run = async (name, fn) => { queries.length = 0; await fn(); console.log(`  ok  ${name}`); };

(async () => {
    await run('a channel admin only sees that coach\'s clients in their own channel', async () => {
        await handleGetCoachUsers('8', {}, 2);
        const q = last();
        assert.match(q.sql, /u\.coach_id = \$1/);
        assert.match(q.sql, /u\.channel_id = \$\d+/, 'the roster must be channel-scoped');
        assert.deepStrictEqual(q.params, ['8', 2]);
    });

    await run('a superadmin bearer still gets the whole cross-channel roster', async () => {
        // The coach miniapp and the bridge both land here — a coach must not lose half their clients.
        await handleGetCoachUsers('8', {}, null);
        const q = last();
        assert.doesNotMatch(q.sql, /u\.channel_id = \$/);
        assert.deepStrictEqual(q.params, ['8']);
    });

    await run('channel scope composes with the stage and tag filters', async () => {
        await handleGetCoachUsers('8', { stage: 'at_risk', tag_id: '3' }, 2);
        const q = last();
        assert.match(q.sql, /u\.channel_id = \$\d+/);
        assert.match(q.sql, /stage.*= \$\d+/);
        assert.ok(q.params.includes(2) && q.params.includes('at_risk') && q.params.includes('3'));
    });

    await run('coach-list counts only the clients the caller may see', async () => {
        await handleGetCoachList(2);
        const q = last();
        assert.match(q.sql, /LEFT JOIN users assigned ON p\.id = assigned\.coach_id AND assigned\.channel_id = \$\d+/,
            'the count must be scoped, or it disagrees with the now-scoped roster');
        // One placeholder serves both scopes; binding the channel twice would be a latent numbering bug.
        assert.deepStrictEqual(q.params, [2]);
    });

    await run('the count filter is in the JOIN, never the WHERE', async () => {
        // A LEFT JOIN: moving it to the WHERE would drop every coach with no clients in this
        // channel off the list entirely, instead of listing them with a count of 0.
        const q = (await handleGetCoachList(2), last());
        const joinLine = q.sql.split('\n').find(l => /LEFT JOIN users assigned/.test(l));
        assert.match(joinLine, /assigned\.channel_id/);
        const whereLine = q.sql.split('\n').find(l => /WHERE u\.channel_id/.test(l));
        assert.ok(whereLine && !/assigned\.channel_id/.test(whereLine), 'must not be in the WHERE');
    });

    await run('an unscoped coach-list is unchanged', async () => {
        await handleGetCoachList(null);
        const q = last();
        assert.doesNotMatch(q.sql, /assigned\.channel_id/);
        assert.doesNotMatch(q.sql, /WHERE u\.channel_id/);
        assert.deepStrictEqual(q.params, []);
    });

    console.log('\nall coach channel-scope checks passed');
})().catch(err => { console.error(err); process.exit(1); });
