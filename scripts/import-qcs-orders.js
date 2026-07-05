'use strict';

/**
 * Import QCS (量康) orders into Nano.
 *
 * Fetches all QCS orders, looks up each order's detail, matches the patient
 * phone to a Nano user, and stores matched orders into lab_orders only.
 * The test report PDF is downloaded from QCS, archived to OSS, and its
 * object key stored on the row (report_pdf_key). Orders with no matching
 * user are skipped.
 *
 * Orchestration (`runImport`) takes injected deps so it can be unit-tested
 * without touching QCS, OSS, or the database. The CLI entrypoint wires the
 * real adapter + DB implementations.
 */

// node scripts/import-qcs-orders.js --base-url https://api.quantumhealth.cn/third-party/ --ak clientid --as secret

/**
 * @param {object} deps
 * @param {object} deps.config            - QCS provider config { api_base_url, api_key, api_secret, cache }
 * @param {string} deps.labName           - provider name (e.g. 'qcs')
 * @param {Function} deps.listOrders      - ({config}) => Promise<order[]>
 * @param {Function} deps.fetchOrder      - (id, config) => Promise<orderDetail>
 * @param {Function} deps.phoneFromOrder  - (detail) => string
 * @param {Function} deps.matchUser       - (labName, phone) => Promise<userId|null>
 * @param {Function} deps.findLabOrder    - (labName, externalOrderId) => Promise<row|null>
 * @param {Function} deps.insertLabOrder  - (order) => Promise<row>
 * @param {Function} deps.storeReportPdf  - (order, detail) => Promise<ossKey|null>
 * @param {Function} deps.updateLabOrder  - (existingRow, detail) => Promise<row|null>
 *        Refreshes a row whose status drifted; resolves null when unchanged.
 * @param {Function} deps.setLabOrderPdfKey - (rowId, ossKey) => Promise<void>
 * @param {Function} [deps.log]
 * @param {Function} [deps.onProgress]    - ({index, total, orderId, outcome}) => void
 *        Fired exactly once per order. outcome is one of 'inserted',
 *        'updated', 'duplicate', 'no-user', 'dry-run', 'error'.
 * @returns {Promise<object>} summary counters
 */
async function runImport(deps) {
    const { config, labName, listOrders, fetchOrder, phoneFromOrder, matchUser, findLabOrder, insertLabOrder, updateLabOrder, isOrderComplete, storeReportPdf, setLabOrderPdfKey } = deps;

    const log = deps.log || (() => {});
    const onProgress = deps.onProgress || (() => {});
    const summary = { total: 0, matched: 0, ordersInserted: 0, ordersUpdated: 0, skippedNoUser: 0, skippedDuplicate: 0, pdfUploaded: 0, pdfErrors: 0, errors: 0 };

    const orders = await listOrders({ config });
    for (const [i, order] of orders.entries()) {
        summary.total += 1;
        // Assigned at each exit point below and reported from `finally`, so
        // every order emits exactly one event however the iteration ends.
        // 'error' is the default: if nothing reassigns it, we threw.
        let outcome = 'error';
        try {
            const detail = await fetchOrder(order.id, config);
            const phone = phoneFromOrder(detail);
            const userId = await matchUser(labName, phone);
            if (!userId) {
                summary.skippedNoUser += 1;
                outcome = 'no-user';
                continue;
            }
            summary.matched += 1;
            if (deps.dryRun) {
                outcome = 'dry-run';
                continue;
            }

            const existing = await findLabOrder(labName, order.id);
            let pdfRowId;
            if (existing) {
                summary.skippedDuplicate += 1;
                // The lab advances an order's progress after we first stored it,
                // so refresh the row whenever its status drifted. updateLabOrder
                // owns the drift comparison (it returns null when the stored
                // status already matched) so the rule sits next to the SQL that
                // applies it. The payload rides along with the status: updating
                // status alone would leave a row marked 已完成 with a stale
                // lab_last_result and a NULL lab_final_result.
                const refreshed = await updateLabOrder(existing, detail);
                if (refreshed) summary.ordersUpdated += 1;
                outcome = refreshed ? 'updated' : 'duplicate';
                // Beyond the status refresh, existing rows only need a PDF backfill.
                if (existing.report_pdf_key) continue;
                pdfRowId = existing.id;
            } else {
                const row = await insertLabOrder({
                    lab_name: labName,
                    user_id: userId,
                    external_order_id: order.id,
                    lab_response: detail,
                });
                summary.ordersInserted += 1;
                outcome = 'inserted';
                pdfRowId = row.id;
            }

            if (!isOrderComplete(detail)) continue;

            // PDF archival must never fail the order import itself; failed
            // PDFs are retried by the backfill path on the next run.
            try {
                const key = await storeReportPdf(order, detail);
                if (key) {
                    await setLabOrderPdfKey(pdfRowId, key);
                    summary.pdfUploaded += 1;
                }
            } catch (err) {
                summary.pdfErrors += 1;
                log(JSON.stringify({ level: 'ERROR', msg: 'QCS report PDF archival failed', orderId: order.id, error: err.message }));
            }
        } catch (err) {
            summary.errors += 1;
            log(JSON.stringify({ level: 'ERROR', msg: 'QCS order import failed', orderId: order.id, error: err.message }));
        } finally {
            onProgress({ index: i + 1, total: orders.length, orderId: order.id, outcome });
        }
    }
    return summary;
}

/**
 * Build the storeReportPdf dependency for runImport. Kept as a factory over
 * injected I/O (httpGet, putBuffer, randomHex) so the report pipeline is
 * unit-testable without QCS, HTTP, or OSS.
 *
 * @param {object} deps
 * @param {object} deps.qcs        - QCS adapter (completedGoods, fetchReportUrl)
 * @param {Function} deps.httpGet  - (url) => Promise<Buffer>
 * @param {Function} deps.putBuffer - (key, buffer, options) => Promise<key>
 * @param {Function} deps.randomHex - () => unguessable hex suffix for the OSS key
 * @param {string} deps.labName
 * @param {object} deps.config    - QCS provider config
 * @param {Function} deps.warn    - (msgObject) => void
 * @returns {Function} (order, detail) => Promise<ossKey|null>
 */
function makeStoreReportPdf(deps) {
    return async function storeReportPdf(order, detail) {
        const goods = deps.qcs.completedGoods(detail);
        if (goods.length === 0) return null;
        if (goods.length > 1) {
            // report_pdf_key is a single column; multi-good orders keep only
            // the first good's report.
            deps.warn({ msg: 'multiple completed goods; storing first report only', orderId: order.id, goodIds: goods.map((g) => g.id) });
        }

        const good = goods[0];
        const report = await deps.qcs.fetchReportUrl({ orderId: order.id, goodId: good.id, config: deps.config });
        if (!report || !report.url) return null;

        const buffer = await deps.httpGet(report.url);
        // Stored private: these are patient lab reports (PHI), and the bucket
        // has Block Public Access enabled, so a public-read ACL is rejected.
        // Serve them with oss.generatePresignedGetUrl at request time.
        // Random suffix avoids collisions on re-import of the same good.
        const key = `lab-reports/${deps.labName}/${order.id}/${good.id}-${deps.randomHex()}.pdf`;
        await deps.putBuffer(key, buffer, { contentType: 'application/pdf' });
        return key;
    };
}

/**
 * Assemble the runImport dependency object from real (or test-injected)
 * infrastructure: QCS adapter, DB client, OSS client, HTTP download.
 * Every entry is exercised through runImport's DI seam, so this builder is
 * where the SQL and adapter glue is pinned by tests.
 */
function buildImportDeps({ opts, config, qcs, db, oss, httpGet, randomHex, matchUser, insertLabOrder, updateLabOrder, log }) {
    return {
        config,
        labName: opts.labName,
        dryRun: opts.dryRun,
        log,
        listOrders: ({ config: cfg }) => qcs.listOrders({ config: cfg, params: opts.progress ? { progress: opts.progress } : {} }),
        fetchOrder: (id, cfg) => qcs.fetchOrder(id, cfg),
        phoneFromOrder: (detail) => qcs.phoneFromOrder(detail),
        matchUser: (labName, phone) => matchUser(labName, phone),
        storeReportPdf: makeStoreReportPdf({
            qcs,
            config,
            labName: opts.labName,
            httpGet,
            putBuffer: (key, buffer, options) => oss.putBuffer(key, buffer, options),
            randomHex,
            warn: (data) => log(JSON.stringify({ level: 'WARN', ...data })),
        }),
        async findLabOrder(labName, externalOrderId) {
            const res = await db.query(
                'SELECT id, report_pdf_key, external_order_id, status FROM lab_orders WHERE lab_name = $1 AND external_order_id = $2 LIMIT 1',
                [labName, externalOrderId]
            );
            const row = res.rows[0];
            if (!row) return null;
            return row;
        },
        insertLabOrder: (order) => insertLabOrder({
            ...order,
            api_key: opts.ak,
            api_secret: opts.as,
            lab_request: { source: 'import-qcs-orders' },
            lab_last_result: order.lab_response,
            lab_final_result: qcs.qcsProgressToLabStatus(order.lab_response?.progress) === '已完成' ? order.lab_response : null,
            status: qcs.qcsProgressToLabStatus(order.lab_response?.progress),
        }),
        isOrderComplete: (detail) => qcs.qcsProgressToLabStatus(detail?.progress || detail?.data?.progress) === '已完成',
        async setLabOrderPdfKey(rowId, key) {
            await db.query('UPDATE lab_orders SET report_pdf_key = $2 WHERE id = $1', [rowId, key]);
        },
        // Gate the write on an actual status drift so a re-run over thousands
        // of unchanged orders does not rewrite every row (and bump updated_at)
        // for nothing. Returns null when the stored status already matched.
        async updateLabOrder(row, detail) {
            const nextStatus = qcs.qcsProgressToLabStatus(detail?.progress || detail?.data?.progress);
            if (row.status === nextStatus) return null;
            return updateLabOrder({ id: row.id, externalOrderId: row.external_order_id }, detail);
        },
        orderStatus: (detail) => qcs.qcsProgressToLabStatus(detail?.progress || detail?.data?.progress),
    };
}

/**
 * OSS credential vars required for report PDF upload that are absent from the
 * given env. Empty array means uploads can proceed.
 */
function missingOssEnv(env) {
    return ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET'].filter((name) => !env[name]);
}

/**
 * Parse CLI args + env into import options. Credentials prefer flags, then env
 * (QCS_AK / QCS_AS) to keep secrets out of shell history. Target env defaults
 * to 'dev' per the project's dev-first rule.
 */
function parseArgs(argv, env = process.env) {
    const flag = (name) => {
        const i = argv.indexOf(name);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    return {
        ak: flag('--ak') || env.QCS_AK || '',
        as: flag('--as') || env.QCS_AS || '',
        env: flag('--env') || 'dev',
        baseUrl: flag('--base-url') || '',
        progress: flag('--progress') || '',
        labName: flag('--lab') || 'qcs',
        dryRun: argv.includes('--dry-run'),
    };
}

/**
 * CLI entrypoint. Wires the real QCS adapter + lab DB helpers into runImport.
 *
 * DATABASE_URL is set from the chosen env BEFORE requiring the lab modules,
 * because src/functions/lab/lib/db.js builds a Pool from DATABASE_URL at module
 * load and is shared (singleton) by insertLabOrder / ingestObservations.
 */
async function main() {
    require('dotenv').config();
    const opts = parseArgs(process.argv.slice(2));

    if (!opts.ak || !opts.as) {
        console.error('ERROR: QCS AK/AS required. Pass --ak/--as or set QCS_AK/QCS_AS.');
        process.exit(1);
    }
    const dbUrl = opts.env === 'prod' ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error(`ERROR: ${opts.env === 'prod' ? 'DATABASE_URL_PROD' : 'DATABASE_URL'} is not set in .env`);
        process.exit(1);
    }
    // Must precede the lab module requires below.
    process.env.DATABASE_URL = dbUrl;

    const missing = opts.dryRun ? [] : missingOssEnv(process.env);
    if (missing.length > 0) {
        console.error(`ERROR: ${missing.join(' / ')} must be set for report PDF upload.`);
        process.exit(1);
    }

    const crypto = require('crypto');
    const axios = require('axios');
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    const db = require('../src/functions/lab/lib/db');
    const globalCache = require('../src/functions/lab/lib/globalCache');
    const { matchUser } = require('../src/functions/lab/lib/userMatcher');
    const oss = require('../src/functions/worker/lib/oss');
    const { insertLabOrder, updateLabOrder } = require('../src/functions/lab').__private;

    let baseUrl = opts.baseUrl;
    if (!baseUrl) {
        const providerRes = await db.query(
            'SELECT api_base_url FROM lab_providers WHERE lab_name = $1 AND is_active = TRUE LIMIT 1',
            [opts.labName]
        );
        baseUrl = providerRes.rows[0]?.api_base_url;
    }
    if (!baseUrl) {
        console.error('ERROR: no api_base_url — pass --base-url or seed lab_providers for ' + opts.labName);
        process.exit(1);
    }

    const config = { api_base_url: baseUrl, api_key: opts.ak, api_secret: opts.as, cache: globalCache };

    console.log(`[import-qcs-orders] env=${opts.env} lab=${opts.labName} base=${baseUrl} dryRun=${opts.dryRun}`);

    // Progress rendering is a CLI concern, so it is layered on here rather
    // than baked into buildImportDeps. A QCS page sweep can run to thousands
    // of orders; without this the script is silent until the final summary.
    const startedAt = Date.now();
    const onProgress = ({ index, total, orderId, outcome }) => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        const pct = total > 0 ? Math.floor((index / total) * 100) : 100;
        console.log(`[import-qcs-orders] ${index}/${total} (${pct}%) ${elapsed}s ${orderId} ${outcome}`);
    };

    const summary = await runImport({ ...buildImportDeps({
        opts,
        config,
        qcs,
        db,
        oss,
        httpGet: async (url) => {
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
            return Buffer.from(res.data);
        },
        randomHex: () => crypto.randomBytes(8).toString('hex'),
        matchUser,
        insertLabOrder,
        updateLabOrder,
        log: (m) => console.error(m),
    }), onProgress });

    console.log('[import-qcs-orders] done: ' + JSON.stringify(summary));
    return summary;
}

module.exports = { runImport, parseArgs, missingOssEnv, makeStoreReportPdf, buildImportDeps };

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'import-qcs-orders crashed', error: err.message, stack: err.stack }));
            process.exit(1);
        });
}
