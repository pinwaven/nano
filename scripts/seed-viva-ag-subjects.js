/**
 * Mint viva_ag_subjects handles for a population ahead of their first AG job.
 *
 *   node scripts/seed-viva-ag-subjects.js --env dev  --premier            # print, change nothing
 *   node scripts/seed-viva-ag-subjects.js --env prod --premier --apply
 *
 * --premier: every ACTIVE premier-tier partner on GCN (partner_type in
 * silver_store / gold_store / platinum_store / diamond_store — the four tiers
 * GCN's CLAUDE.md defines the term by), resolved to a nano user through
 * gcn.users.nano_user_id first and the verified phone second. Rows are minted
 * with minted_by = 'premier-partner'; a subject who already has a handle (from a
 * claim) keeps it. Idempotent. Prints counts only — never a user id or a phone.
 *
 * Reads GCN's database the way the MCP function does (GCN_DB_PASS in .env, same
 * cluster, database gcn_db / gcn_db_dev). Read-only there.
 */
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const args = process.argv.slice(2);
const env = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'dev';
const apply = args.includes('--apply');
const premier = args.includes('--premier');
if (!premier) { console.error('nothing to seed: pass --premier'); process.exit(1); }

const nanoUrl = env === 'prod' ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
if (!nanoUrl) { console.error(`no DATABASE_URL${env === 'prod' ? '_PROD' : ''}`); process.exit(1); }
const u = new URL(nanoUrl);
const gcn = new Pool({
    host: u.hostname, port: Number(u.port || 5432), database: env === 'prod' ? 'gcn_db' : 'gcn_db_dev',
    user: process.env.GCN_DB_USER || 'gcn_admin', password: process.env.GCN_DB_PASS,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 2, idleTimeoutMillis: 10000,
});
const nano = new Pool({ connectionString: nanoUrl, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 2, idleTimeoutMillis: 10000 });

const PREMIER = ['silver_store', 'gold_store', 'platinum_store', 'diamond_store'];

(async () => {
    if (!process.env.GCN_DB_PASS) throw new Error('GCN_DB_PASS missing from .env');
    const { rows: partners } = await gcn.query(
        `SELECT u.nano_user_id, u.phone
           FROM partners p JOIN users u ON u.user_id = p.user_id
          WHERE p.partner_type = ANY($1) AND p.status = 'active'`, [PREMIER]);
    const byId = partners.map(r => r.nano_user_id).filter(Boolean);
    const phones = partners.map(r => r.phone).filter(Boolean);

    const { rows: resolved } = await nano.query(
        `SELECT DISTINCT x.user_id FROM (
             SELECT user_id FROM users WHERE user_id = ANY($1)
             UNION SELECT user_id FROM users WHERE phone = ANY($2)
             UNION SELECT user_id FROM user_phones WHERE phone = ANY($2)
         ) x JOIN users u ON u.user_id = x.user_id`, [byId, phones]);
    const { rows: [{ n: already }] } = await nano.query(
        `SELECT COUNT(*)::int AS n FROM viva_ag_subjects WHERE user_id = ANY($1)`, [resolved.map(r => r.user_id)]);

    console.log(`[seed] ${env}: ${partners.length} active premier partners on GCN → ${resolved.length} nano users, ${already} already subjects, ${resolved.length - already} to mint`);
    if (!apply) { console.log('[seed] dry run; pass --apply to write'); return; }

    let minted = 0;
    for (const r of resolved) {
        const res = await nano.query(
            `INSERT INTO viva_ag_subjects (user_id, subject_ref, minted_by) VALUES ($1, $2, 'premier-partner')
             ON CONFLICT (user_id) DO NOTHING`, [r.user_id, 'vs_' + crypto.randomBytes(12).toString('hex')]);
        minted += res.rowCount;
    }
    const { rows: counts } = await nano.query(`SELECT minted_by, COUNT(*)::int AS n FROM viva_ag_subjects GROUP BY 1 ORDER BY 1`);
    console.log(`[seed] minted ${minted}; subjects now: ${counts.map(c => `${c.minted_by}=${c.n}`).join(', ')}`);
})().catch(e => { console.error(e.message); process.exit(1); }).finally(() => { gcn.end(); nano.end(); });
