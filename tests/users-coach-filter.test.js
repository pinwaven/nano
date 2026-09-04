// Coach filters on GET /users (handlers/users.js, handleGetUsers).
//
// Why they exist: a /users row carries coach_id (a coaches.id) and coach_name, but callers hold
// different halves of a coach's identity. One that already has a row has the coaches.id; one that
// only knows WHO the coach is — a WeChat bridge, say — has the coach's own users.user_id and had no
// way to map it: GET /coaches is not a route (the path is POST-only, and a GET returns
// "Unknown GET route", which reads like an empty coach list), and /users did not expose
// coach_user_id. The fallback was to page the entire channel and join on coach_name, which is not
// unique — 749 rows fetched to find 7.
//
// The invariant that actually matters here is the channel one: a coach filter must NARROW an
// admin's channel scope, never replace it. Everything else is convenience.
//
// Runs fully offline: lib/db is stubbed through require.cache, so there is no Postgres. Run it:
//
//     node tests/users-coach-filter.test.js

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

const { handleGetUsers } = require(path.join(WORKER, 'handlers', 'users.js'));

// The paginated row query — the only one that carries `where`. The four stat aggregates are
// deliberately channel-level and must never see a coach condition.
const mainQuery = () => {
    const q = queries.find(x => /COUNT\(\*\) OVER\(\) AS _total/.test(x.sql));
    assert.ok(q, 'expected the paginated users query');
    return q;
};
const statQueries = () => queries.filter(x => !/COUNT\(\*\) OVER\(\) AS _total/.test(x.sql));

const run = async (name, fn) => {
    queries.length = 0;
    await fn();
    console.log(`  ok  ${name}`);
};

(async () => {
    await run('filter_coach_id binds the coaches.id', async () => {
        await handleGetUsers(null, { filter_coach_id: '8' });
        const q = mainQuery();
        assert.match(q.sql, /u\.coach_id = \$\d+/);
        assert.ok(q.params.includes(8), 'bound as a number, not the raw string');
    });

    await run('filter_coach_user_id resolves through the existing coaches join', async () => {
        // p is already joined for coach_name, so this needs no subquery and no new join — and
        // matching on p.user_id excludes unassigned rows for free.
        await handleGetUsers(null, { filter_coach_user_id: '37c8774e' });
        const q = mainQuery();
        assert.match(q.sql, /p\.user_id = \$\d+/);
        assert.match(q.sql, /LEFT JOIN coaches p ON u\.coach_id = p\.id/,
            'the condition depends on that join being present');
        assert.ok(q.params.includes('37c8774e'));
    });

    await run('coach_user_id is selected so a caller can map a coach without a scan', async () => {
        await handleGetUsers(null, {});
        assert.match(mainQuery().sql, /p\.user_id as coach_user_id/);
    });

    await run('a channel admin keeps their channel scope while filtering by coach', async () => {
        // The one that matters. If the coach condition ever REPLACED the channel one, an admin
        // could read another channel's roster by passing its coach id.
        await handleGetUsers(2, { filter_coach_id: '8' });
        const q = mainQuery();
        assert.match(q.sql, /u\.channel_id = \$\d+/, 'channel scope survives');
        assert.match(q.sql, /u\.coach_id = \$\d+/, 'and the coach narrows it');
        assert.ok(q.params.includes(2) && q.params.includes(8));
    });

    await run('composes with search', async () => {
        // search binds first, so the coach filter lands on a later placeholder — assert both
        // survive rather than pinning the numbers.
        await handleGetUsers(null, { q: 'pin', filter_coach_id: '8' });
        const q = mainQuery();
        assert.match(q.sql, /ILIKE/);
        assert.match(q.sql, /u\.coach_id = \$\d+/);
        assert.ok(q.params.includes('%pin%') && q.params.includes(8));
    });

    await run('junk and absent values change nothing', async () => {
        for (const query of [{}, { filter_coach_id: 'abc' }, { filter_coach_user_id: '   ' }]) {
            queries.length = 0;
            await handleGetUsers(null, query);
            const q = mainQuery();
            assert.doesNotMatch(q.sql, /u\.coach_id = \$/, JSON.stringify(query));
            assert.doesNotMatch(q.sql, /p\.user_id = \$/, JSON.stringify(query));
        }
    });

    await run('the dashboard stats stay channel-level', async () => {
        // Coach-scoping these would silently change what the admin panel's headline numbers mean.
        await handleGetUsers(2, { filter_coach_id: '8' });
        const stats = statQueries();
        assert.ok(stats.length > 0, 'expected the stat aggregates to run');
        for (const s of stats) {
            assert.doesNotMatch(s.sql, /coach_id = \$/, 'a stat query must not see the coach filter');
            assert.ok(!s.params.includes(8), 'nor bind it');
        }
    });

    console.log('\nall users-coach-filter checks passed');
})().catch(err => { console.error(err); process.exit(1); });
