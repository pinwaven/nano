const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const queries = [];
let deleteResult = { rows: [{ user_id: 'winner-1' }], rowCount: 1 };
const pool = {
    query: async (sql, params) => {
        queries.push({ sql, params });
        if (/^DELETE FROM users/.test(sql)) return deleteResult;
        return { rows: [], rowCount: 0 };
    },
};

const dbPath = require.resolve(path.join(WORKER, 'lib', 'db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
const { handleDeleteUser } = require(path.join(WORKER, 'handlers', 'users.js'));

(async () => {
    let result = await handleDeleteUser('winner-1');
    assert.deepStrictEqual(result, { success: true });
    assert.match(queries[0].sql, /RETURNING user_id/);
    assert.deepStrictEqual(queries[0].params, ['winner-1']);

    deleteResult = { rows: [], rowCount: 0 };
    result = await handleDeleteUser('missing');
    assert.strictEqual(result.statusCode, 404);
    assert.strictEqual(result.error, 'user_not_found');

    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'schemas', 'migration_user_delete_merged_accounts.sql'),
        'utf8'
    );
    assert.match(migration, /users_merged_into_user_id_fkey[\s\S]*ON DELETE CASCADE/);
    const auditMigration = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'schemas', 'migration_user_delete_preserve_merge_audit.sql'),
        'utf8'
    );
    assert.match(auditMigration, /winner_user_id_snapshot[\s\S]*SET NOT NULL/);
    assert.match(auditMigration, /loser_user_id_snapshot[\s\S]*SET NOT NULL/);
    assert.match(auditMigration, /CREATE TRIGGER trg_snapshot_user_merge_ids[\s\S]*BEFORE INSERT/);
    assert.match(auditMigration, /user_merges_winner_user_id_fkey[\s\S]*ON DELETE SET NULL/);
    assert.match(auditMigration, /user_merges_loser_user_id_fkey[\s\S]*ON DELETE SET NULL/);

    console.log('admin user delete checks passed');
})().catch(err => { console.error(err); process.exit(1); });
