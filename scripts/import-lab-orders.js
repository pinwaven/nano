'use strict';
// Dry run is read-only. --apply imports inline; --queue requires FC's STS credentials.
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { normalizeOrder } = require('../src/functions/worker/lib/lab-order-normalize');
const args = process.argv.slice(2);
const target = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'dev';
const orderId = args.includes('--order') ? args[args.indexOf('--order') + 1] : null;
const apply = args.includes('--apply');
const queue = args.includes('--queue');
async function main() {
    if (!['dev','prod'].includes(target) || (apply && queue)) throw new Error('Use --env dev|prod and at most one of --apply/--queue');
    const url = process.env[target === 'prod' ? 'DATABASE_URL_PROD' : 'DATABASE_URL'];
    if (!url) throw new Error('Database URL missing');
    const db = new Pool({ connectionString: url, ssl: false });
    try {
        const { rows } = await db.query(`SELECT id,user_id,lab_name,external_order_id,lab_final_result,report_pdf_key
            FROM lab_orders WHERE lab_name='qcs' AND ($1::bigint IS NULL OR id=$1) ORDER BY id`, [orderId]);
        if (apply || queue) {
            const importer = require('../src/functions/worker/lib/lab-order-import').createImporter({ db });
            for (const row of rows) {
                const result = apply ? await importer.run(row.id) : await importer.queue(row.id);
                console.log(JSON.stringify({ order_id: row.id, ...result }));
                if (result.success === false) process.exitCode = 1;
            }
        } else {
            const { rows: catalog } = await db.query('SELECT * FROM biomarker_catalog WHERE is_active=TRUE');
            for (const row of rows) {
                const goods = normalizeOrder(row,catalog);
                console.log(JSON.stringify({ order_id: row.id, user_id: row.user_id, has_pdf: !!row.report_pdf_key,
                    tests: goods.map(g => ({ id: g.id,name: g.name,date: g.date,items: g.rows.length,
                        mapped: g.rows.filter(r => r.observation).length,rejected: g.rows.flatMap(r => r.rejected) })) }));
            }
        }
    } finally { await db.end(); }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
