'use strict';
const crypto = require('crypto');
const { normalizeOrder } = require('./lab-order-normalize');
const { publishLabOrderImport } = require('./lab-order-events');
const { updateHealthTwin } = require('./healthTwinUpdater');
const { pool } = require('./db');

// Hash exactly the source fields we consume, in PostgreSQL, for queue/sweep/worker parity.
const REVISION = `md5(concat_ws('|', l.user_id, l.status, l.lab_final_result::text, l.report_pdf_key))`;
const ORDER_SELECT = `SELECT l.id,l.user_id,l.lab_name,l.external_order_id,l.lab_final_result,l.report_pdf_key,
    ${REVISION} AS revision, u.language FROM lab_orders l JOIN users u ON u.user_id=l.user_id`;
const validId = id => /^[1-9]\d*$/.test(String(id || ''));
function createImporter({ db = pool, publish = publishLabOrderImport, refresh = updateHealthTwin } = {}) {
    async function transaction(fn) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally { client.release(); }
    }
    async function lock(client, id) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lab-order:${id}`]);
    }
    async function queue(id) {
        if (!validId(id)) return { statusCode: 400, success: false, error: 'Invalid order id' };
        try {
            const result = await transaction(async client => {
                await lock(client, id);
                const { rows: [order] } = await client.query(`${ORDER_SELECT} WHERE l.id=$1`, [id]);
                if (!order) return { statusCode: 404, success: false, error: 'Order not found' };
                if (order.lab_name !== 'qcs') return { statusCode: 422, success: false, error: 'Unsupported lab' };
                const { rows: [state] } = await client.query('SELECT * FROM lab_order_imports WHERE order_id=$1', [id]);
                if (state?.revision === order.revision && ['imported','waiting'].includes(state.status)) {
                    return { success: true, order_id: String(id), status: state.status, counts: state.counts };
                }
                await client.query(`INSERT INTO lab_order_imports(order_id,revision,status) VALUES($1,$2,'queued')
                    ON CONFLICT(order_id) DO UPDATE SET revision=$2,status='queued',error=NULL,updated_at=NOW()`, [id,order.revision]);
                return { statusCode: 202, success: true, order_id: String(id), status: 'queued' };
            });
            // DB state survives publish failure. The timer can recover without the writer retrying.
            if (result.status === 'queued') await publish(id);
            return result;
        } catch (err) {
            console.log(JSON.stringify({ level: 'ERROR', msg: 'Lab order enqueue failed', data: { order_id: String(id), error: err.message } }));
            return { statusCode: 503, success: false, error: 'Lab import queue unavailable; retry is safe' };
        }
    }
    async function status(id) {
        if (!validId(id)) return { statusCode: 400, success: false, error: 'Invalid order id' };
        try {
            const { rows: [row] } = await db.query(`SELECT l.id AS order_id,i.revision,i.status,i.attempts,i.counts,i.error,i.updated_at
                FROM lab_orders l LEFT JOIN lab_order_imports i ON i.order_id=l.id WHERE l.id=$1`, [id]);
            return row ? { success: true, import: row } : { statusCode: 404, success: false, error: 'Order not found' };
        } catch (err) { return { statusCode: 503, success: false, error: 'Import status unavailable' }; }
    }
    async function reconcile(limit = 25) {
        try {
            const { rows } = await db.query(`SELECT l.id FROM lab_orders l JOIN users u ON u.user_id=l.user_id LEFT JOIN lab_order_imports i ON i.order_id=l.id
                WHERE l.lab_name='qcs' AND l.lab_final_result IS NOT NULL
                AND (i.order_id IS NULL OR i.revision <> ${REVISION}
                    OR (i.status IN ('queued','processing','failed') AND i.updated_at < NOW()-INTERVAL '10 minutes'))
                ORDER BY i.updated_at ASC NULLS FIRST,l.id LIMIT $1`, [Math.min(Math.max(Number(limit) || 25,1),100)]);
            const results = [];
            for (const row of rows) results.push(await queue(row.id));
            return { success: true, scanned: rows.length, queued: results.filter(r => r.status === 'queued').length,
                failed: results.filter(r => !r.success).length };
        } catch (err) {
            console.log(JSON.stringify({ level: 'ERROR', msg: 'Lab order reconciliation failed', data: { error: err.message } }));
            throw err;
        }
    }
    async function run(id) {
        if (!validId(id)) throw new Error('Invalid order id');
        try {
            return await transaction(async client => {
                await lock(client, id);
                // Read the latest DB row, never event-authored values or a stale queued snapshot.
                const { rows: [order] } = await client.query(`${ORDER_SELECT} WHERE l.id=$1 FOR UPDATE OF l`, [id]);
                if (!order) return { skipped: true };
                if (order.lab_name !== 'qcs') throw new Error('Unsupported lab');
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lab-import-user:${order.user_id}`]);
                const ownerCheck = await client.query('SELECT 1 FROM health_reports WHERE lab_order_id=$1 AND user_id<>$2 LIMIT 1', [id,order.user_id]);
                if (ownerCheck.rows.length) throw new Error('Imported order reassigned to another user');
                const { rows: [state] } = await client.query('SELECT * FROM lab_order_imports WHERE order_id=$1', [id]);
                if (state?.revision === order.revision && ['imported','waiting'].includes(state.status)) return { skipped: true, status: state.status };
                await client.query(`INSERT INTO lab_order_imports(order_id,revision,status,attempts) VALUES($1,$2,'processing',1)
                    ON CONFLICT(order_id) DO UPDATE SET revision=$2,status='processing',attempts=lab_order_imports.attempts+1,updated_at=NOW()`, [id,order.revision]);
                const { rows: catalog } = await client.query('SELECT * FROM biomarker_catalog WHERE is_active=TRUE');
                const goods = normalizeOrder(order,catalog);
                const counts = { reports: 0, items: 0, observations: 0, documents: 0, extractions_queued: 0, missing_dates: 0, unmapped: 0 };
                const warnings = [];
                let docId = null;
                const key = order.report_pdf_key;
                const prefix = `lab-reports/qcs/${order.external_order_id}/`;
                const pdfGood = key?.startsWith(prefix) ? goods.find(g => key.slice(prefix.length).startsWith(`${g.id}-`)) : null;
                if (key) {
                    if (!key.startsWith(prefix) || !key.endsWith('.pdf')) throw new Error('Invalid QCS PDF key');
                    const { rows: [doc] } = await client.query(`INSERT INTO health_documents
                        (user_id,oss_key,filename,content_type,doc_type,doc_date,institution,note,uploaded_by)
                        VALUES($1,$2,$3,'application/pdf','lab_report',$4,'量康',$5,'admin')
                        ON CONFLICT(oss_key) DO UPDATE SET
                        doc_date=CASE WHEN health_documents.user_edited_at IS NULL THEN EXCLUDED.doc_date ELSE health_documents.doc_date END,
                        filename=CASE WHEN health_documents.user_edited_at IS NULL THEN EXCLUDED.filename ELSE health_documents.filename END
                        WHERE health_documents.user_id=EXCLUDED.user_id RETURNING id,status`,
                        [order.user_id,key,`${pdfGood?.name || '量康检验报告'}-${order.external_order_id}.pdf`,pdfGood?.date || null,
                            `量康订单 ${order.external_order_id}；该文件仅代表其中的检测报告。`]);
                    if (!doc) throw new Error('QCS PDF belongs to another user');
                    docId = doc.id;
                    counts.documents = doc.status === 'active' ? 1 : 0;
                    // The food-panel writer lives in extraction; unknown/PDF-only goods use it too.
                    const needsExtraction = !pdfGood || !pdfGood.rows.length || /IgG/i.test(pdfGood.name) || !pdfGood.date;
                    if (doc.status === 'active' && needsExtraction) {
                        const queued = await client.query(`INSERT INTO doc_extraction_jobs(job_uid,document_id,user_id,language)
                            SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM doc_extraction_jobs WHERE document_id=$2)
                            ON CONFLICT DO NOTHING RETURNING job_uid`, [crypto.randomUUID(),doc.id,order.user_id,order.language || 'zh']);
                        counts.extractions_queued += queued.rowCount;
                    }
                }
                // Removed/cancelled goods must not leave old measurements feeding the twin.
                const old = await client.query('SELECT id,lab_goods_id FROM health_reports WHERE lab_order_id=$1', [id]);
                for (const r of old.rows) {
                    if (!goods.some(g => g.id === r.lab_goods_id && g.date && g.rows.length)) {
                        await client.query('DELETE FROM health_events WHERE report_id=$1', [r.id]);
                        await client.query('DELETE FROM health_reports WHERE id=$1', [r.id]);
                    }
                }
                for (const good of goods) {
                    if (!good.date) { counts.missing_dates++; warnings.push(`goods ${good.id}: missing test/report date`); continue; }
                    if (!good.rows.length) { warnings.push(`goods ${good.id}: PDF extraction needed; ${pdfGood?.id === good.id ? 'PDF registered' : 'no matching PDF saved'}`); continue; }
                    const { rows: [report] } = await client.query(`INSERT INTO health_reports
                        (user_id,report_date,source,institution,report_type,status,oss_key,raw_data,lab_order_id,lab_goods_id)
                        VALUES($1,$2,'qcs','量康','lab_panel','parsed',$3,$4,$5,$6)
                        ON CONFLICT(lab_order_id,lab_goods_id) WHERE lab_order_id IS NOT NULL DO UPDATE SET
                        report_date=EXCLUDED.report_date,oss_key=EXCLUDED.oss_key,raw_data=EXCLUDED.raw_data,status='parsed' RETURNING id`,
                        [order.user_id,good.date,pdfGood?.id === good.id ? key : null,JSON.stringify({ goods_id: good.id, test_name: good.name,
                            order_id: String(id), external_order_id: order.external_order_id, revision: order.revision, rows: good.rows }),id,good.id]);
                    await client.query('DELETE FROM health_events WHERE report_id=$1', [report.id]);
                    await client.query('DELETE FROM health_report_items WHERE report_id=$1', [report.id]);
                    let sort = 0;
                    for (const row of good.rows) {
                        const o = row.observation;
                        await client.query(`INSERT INTO health_report_items
                            (report_id,user_id,key_name,label,value_num,value_text,unit,section,data_date,sort_order)
                            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                            [report.id,order.user_id,o?.key_name || null,row.label,o?.value ?? row.value_num,row.value_text,
                                o?.unit || row.unit,row.section,row.date || good.date,sort++]);
                        counts.items++;
                        if (!o) { counts.unmapped++; continue; }
                        const metadata = catalog.find(c => c.key_name === o.key_name);
                        const data = { key_name: o.key_name, value: o.value, unit: o.unit, loinc_code: metadata.loinc_code,
                            nano_dimension: metadata.nano_dimension,is_kino_core: metadata.is_kino_core,
                            lab_order_id: String(id),lab_goods_id: good.id,revision: order.revision };
                        await client.query(`INSERT INTO health_events(user_id,source,category,data_date,recorded_at,data,report_id,external_id)
                            VALUES($1,'qcs','lab_result',$2,NOW(),$3,$4,$5)
                            ON CONFLICT(user_id,source,external_id) WHERE external_id IS NOT NULL DO UPDATE SET
                            data=EXCLUDED.data,data_date=EXCLUDED.data_date,report_id=EXCLUDED.report_id,recorded_at=NOW()`,
                            [order.user_id,o.data_date,JSON.stringify(data),report.id,`${id}:${good.id}:${row.external_id}`]);
                        counts.observations++;
                    }
                    counts.reports++;
                }
                await refresh(order.user_id,client,{ throwOnError: true });
                const finalStatus = !goods.length || counts.missing_dates || warnings.length ? 'waiting' : 'imported';
                await client.query(`UPDATE lab_order_imports SET status=$2,counts=$3,error=$4,updated_at=NOW() WHERE order_id=$1`,
                    [id,finalStatus,JSON.stringify(counts),warnings.length ? warnings.join('; ').slice(0,2000) : null]);
                console.log(JSON.stringify({ level: 'INFO', msg: 'Lab order imported', data: { order_id: String(id), status: finalStatus, counts } }));
                return { success: true, status: finalStatus, counts, document_id: docId };
            });
        } catch (err) {
            try {
                await db.query(`INSERT INTO lab_order_imports(order_id,revision,status,attempts,error)
                    SELECT l.id,${REVISION},'failed',1,$2 FROM lab_orders l WHERE l.id=$1
                    ON CONFLICT(order_id) DO UPDATE SET status='failed',attempts=lab_order_imports.attempts+1,error=$2,updated_at=NOW()`,
                    [id,String(err.message).slice(0,2000)]);
            } catch (stateErr) { console.log(JSON.stringify({ level: 'ERROR', msg: 'Lab import failure status unavailable', data: { order_id: String(id) } })); }
            throw err;
        }
    }
    return { queue, status, reconcile, run };
}
module.exports = { createImporter, REVISION, validId };
