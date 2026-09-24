const test = require('node:test');
const assert = require('node:assert/strict');

const db = require.resolve('../src/functions/worker/lib/db');
require.cache[db] = {
    id: db,
    filename: db,
    loaded: true,
    exports: { pool: {} },
};

const { reconcileAccessContextValues, ensurePrimaryPhone } = require('../src/functions/worker/handlers/user-merge');

test('merge preserves all roles and promotes the survivor into a descendant channel', () => {
    const result = reconcileAccessContextValues(
        { roles: ['user'], channel_id: 2 },
        { roles: ['user', 'coach', 'admin'], channel_id: 7 },
        [7, 2, 1]
    );
    assert.deepEqual(result, { roles: ['user', 'coach', 'admin'], channelId: 7 });
});

test('merge fills an unassigned channel but does not switch between sibling channels', () => {
    assert.equal(reconcileAccessContextValues(
        { roles: ['user'], channel_id: null },
        { roles: ['user'], channel_id: 7 },
        [7, 2, 1]
    ).channelId, 7);
    assert.equal(reconcileAccessContextValues(
        { roles: ['user'], channel_id: 8 },
        { roles: ['user'], channel_id: 7 },
        [7, 2, 1]
    ).channelId, 8);
});

test('merge promotes the only transferred phone and synchronizes the user cache', async () => {
    const calls = [];
    const client = { query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM user_phones')) {
            return { rows: [{ id: 1837, phone: '+8615881449902', verified_at: '2026-09-23', is_primary: false }] };
        }
        return { rows: [] };
    } };

    assert.equal(await ensurePrimaryPhone(client, '32d34a0d'), '+8615881449902');
    assert.match(calls[1].sql, /is_primary = \(id = \$2\)/);
    assert.deepEqual(calls[1].params, ['32d34a0d', 1837]);
    assert.deepEqual(calls[2].params, ['+8615881449902', '2026-09-23', '32d34a0d']);
});

test('merge implementation clears the inactive phone cache before primary promotion', () => {
    const source = require('fs').readFileSync(
        require.resolve('../src/functions/worker/handlers/user-merge'),
        'utf8'
    );
    const clearAt = source.indexOf("UPDATE users SET phone = NULL, phone_verified_at = NULL");
    const promoteAt = source.indexOf('await ensurePrimaryPhone(client, winnerId)');
    assert.ok(clearAt >= 0 && promoteAt > clearAt);
});
