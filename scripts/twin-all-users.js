/**
 * Widen the twin sync from "subjects who invoked the agent" to every user, in one environment.
 *
 *   node scripts/twin-all-users.js --env dev                                 # print, change nothing
 *   node scripts/twin-all-users.js --env dev --apply --by "<name>" --note "<why>"
 *
 * --apply does two things in one transaction: mints a subject_ref for every user who has none
 * (minted_by 'all-users'), and turns on twin_sync_policy.mint_all_users so every later signup is
 * minted by trigger (minted_by 'signup'). Both are needed — a backfill alone misses tomorrow's
 * users, and the trigger alone misses everyone already here.
 *
 * It is a script and not a migration because it is a decision: every user's twin becomes readable
 * by the external holder of TWIN_API_TOKEN. Who decided and why are recorded on the policy row.
 * Prints counts only — never a user id.
 */
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const args = process.argv.slice(2);
const arg = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const env = arg('--env') || 'dev';
const apply = args.includes('--apply');
const by = arg('--by');
const note = arg('--note');
const url = env === 'prod' ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
if (!url) { console.error(`no DATABASE_URL${env === 'prod' ? '_PROD' : ''}`); process.exit(1); }
if (apply && (!by || !note)) { console.error('--apply needs --by "<name>" and --note "<why>"'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 1 });

(async () => {
    const { rows: [c] } = await pool.query(
        `SELECT (SELECT COUNT(*)::int FROM users) AS users,
                (SELECT COUNT(*)::int FROM users u WHERE NOT EXISTS (SELECT 1 FROM viva_ag_subjects s WHERE s.user_id = u.user_id)) AS missing,
                (SELECT mint_all_users FROM twin_sync_policy WHERE id) AS policy`);
    console.log(`[twin-all-users] ${env}: ${c.users} users, ${c.missing} without a subject_ref, mint_all_users=${c.policy}`);
    if (!apply) { console.log('[twin-all-users] dry run; pass --apply --by --note to write'); return; }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: ids } = await client.query(
            `SELECT u.user_id FROM users u WHERE NOT EXISTS (SELECT 1 FROM viva_ag_subjects s WHERE s.user_id = u.user_id)`);
        let minted = 0;
        for (const r of ids) {
            minted += (await client.query(
                `INSERT INTO viva_ag_subjects (user_id, subject_ref, minted_by) VALUES ($1, $2, 'all-users') ON CONFLICT (user_id) DO NOTHING`,
                [r.user_id, 'vs_' + crypto.randomBytes(12).toString('hex')])).rowCount;
        }
        await client.query(
            `UPDATE twin_sync_policy SET mint_all_users = TRUE, decided_by = $1, decided_at = NOW(), note = $2 WHERE id`, [by, note]);
        await client.query('COMMIT');
        const { rows: counts } = await pool.query(`SELECT minted_by, COUNT(*)::int AS n FROM viva_ag_subjects GROUP BY 1 ORDER BY 1`);
        console.log(`[twin-all-users] minted ${minted}; policy on; subjects now: ${counts.map(x => `${x.minted_by}=${x.n}`).join(', ')}`);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
})().catch(e => { console.error(e.message); process.exit(1); }).finally(() => pool.end());
