'use strict';

/**
 * Import QCS (量康) orders into Nano.
 *
 * Fetches all QCS orders, looks up each order's detail, matches the patient
 * phone to a Nano user, and stores matched orders into lab_orders +
 * health_reports/health_events. Orders with no matching user are skipped.
 *
 * Orchestration (`runImport`) takes injected deps so it can be unit-tested
 * without touching QCS or the database. The CLI entrypoint wires the real
 * adapter + DB implementations.
 */

/**
 * @param {object} deps
 * @param {object} deps.config            - QCS provider config { api_base_url, api_key, api_secret, cache }
 * @param {string} deps.labName           - provider name (e.g. 'qcs')
 * @param {Function} deps.listOrders      - ({config}) => Promise<order[]>
 * @param {Function} deps.fetchOrder      - (id, config) => Promise<orderDetail>
 * @param {Function} deps.phoneFromOrder  - (detail) => string
 * @param {Function} deps.matchUser       - (labName, phone) => Promise<userId|null>
 * @param {Function} deps.insertLabOrder  - (order) => Promise<row>
 * @param {Function} deps.ingestOrderResults - (userId, labName, detail) => Promise<reportId|null>
 * @param {Function} [deps.log]
 * @returns {Promise<object>} summary counters
 */
async function runImport(deps) {
    const { config, labName, listOrders, fetchOrder, phoneFromOrder, matchUser, findLabOrder, insertLabOrder, ingestOrderResults } = deps;

    const log = deps.log || (() => {});
    const summary = { total: 0, matched: 0, ordersInserted: 0, reportsInserted: 0, skippedNoUser: 0, skippedDuplicate: 0, errors: 0 };

    const orders = await listOrders({ config });
    for (const order of orders) {
        summary.total += 1;
        try {
            const detail = await fetchOrder(order.id, config);
            const phone = phoneFromOrder(detail);
            const userId = await matchUser(labName, phone);
            if (!userId) {
                summary.skippedNoUser += 1;
                continue;
            }
            summary.matched += 1;
            if (deps.dryRun) continue;

            const existing = await findLabOrder(labName, order.id);
            if (existing) {
                summary.skippedDuplicate += 1;
                continue;
            }

            await insertLabOrder({
                lab_name: labName,
                user_id: userId,
                external_order_id: order.id,
                lab_response: detail,
            });
            summary.ordersInserted += 1;

            const reportId = await ingestOrderResults(userId, labName, detail);
            if (reportId) summary.reportsInserted += 1;
        } catch (err) {
            summary.errors += 1;
            log(JSON.stringify({ level: 'ERROR', msg: 'QCS order import failed', orderId: order.id, error: err.message }));
        }
    }
    return summary;
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

    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    const db = require('../src/functions/lab/lib/db');
    const globalCache = require('../src/functions/lab/lib/globalCache');
    const { matchUser } = require('../src/functions/lab/lib/userMatcher');
    const { normalizeObservations } = require('../src/functions/lab/lib/labNormalizer');
    const { insertLabOrder, ingestObservations } = require('../src/functions/lab').__private;

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

    const summary = await runImport({
        config,
        labName: opts.labName,
        dryRun: opts.dryRun,
        log: (m) => console.error(m),
        listOrders: ({ config: cfg }) => qcs.listOrders({ config: cfg, params: opts.progress ? { progress: opts.progress } : {} }),
        fetchOrder: (id, cfg) => qcs.fetchOrder(id, cfg),
        phoneFromOrder: (detail) => qcs.phoneFromOrder(detail),
        matchUser: (labName, phone) => matchUser(labName, phone),
        async findLabOrder(labName, externalOrderId) {
            const res = await db.query(
                'SELECT 1 FROM lab_orders WHERE lab_name = $1 AND external_order_id = $2 LIMIT 1',
                [labName, externalOrderId]
            );
            return res.rows[0] || null;
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
        async ingestOrderResults(userId, labName, detail) {
            const observations = await normalizeObservations(qcs.parseResponse(detail));
            if (observations.length === 0) return null;
            return ingestObservations(userId, labName, observations);
        },
    });

    console.log('[import-qcs-orders] done: ' + JSON.stringify(summary));
    return summary;
}

module.exports = { runImport, parseArgs };

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'import-qcs-orders crashed', error: err.message, stack: err.stack }));
            process.exit(1);
        });
}
