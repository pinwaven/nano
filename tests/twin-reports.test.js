// The 综合报告 card on the 数字孪生 subtab: completed Viva AG artifacts listed by /api/twin-reports
// and opened by index through /api/twin-reports/file. Two things here are invisible at runtime
// and worth pinning: the card is OWNERSHIP-gated (not AG-entitlement-gated — a delivered report
// stays openable after the add-on lapses), and the oss_key never reaches the client.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const WORKER = path.join(ROOT, 'src', 'functions', 'worker');
const MINI = path.join(ROOT, 'src', 'mini', 'nano-miniapp');

// ---- offline DB / OSS stubs, installed through require.cache before the handler loads ----
const queries = [];
let rowsByQuery = () => ({ rows: [] });
require.cache[require.resolve(path.join(WORKER, 'lib', 'db.js'))] = {
    id: 'db', filename: 'db', loaded: true,
    exports: { pool: { query: async (sql, params) => { queries.push({ sql, params }); return rowsByQuery(sql, params); } } },
};
require.cache[require.resolve(path.join(WORKER, 'lib', 'oss.js'))] = {
    id: 'oss', filename: 'oss', loaded: true,
    exports: { generatePresignedGetUrl: (key, ttl, _b, _c, opts) => `signed://${key}?ttl=${ttl}&fn=${encodeURIComponent(opts?.filename || '')}` },
};
// viva_ag.js pulls in half the worker; stub just the one export twin_reports uses.
require.cache[require.resolve(path.join(WORKER, 'handlers', 'viva_ag.js'))] = {
    id: 'viva_ag', filename: 'viva_ag', loaded: true,
    exports: {
        publicResultFiles: (row) => (row.result_files || []).map((f, index) => ({ index, filename: f.filename, ext: f.ext, size_bytes: f.size_bytes ?? null })),
    },
};

const { handleGetTwinReports, handleGetTwinReportFile } = require(path.join(WORKER, 'handlers', 'twin_reports.js'));

const JOB = {
    job_uid: 'j-1', command: 'x', command_key: 'full_analysis', result_summary: 's', result_oss_key: 'viva-ag-results/j-1/a.pdf',
    result_files: [{ ext: 'md', oss_key: 'viva-ag-results/j-1/a.md', filename: 'a.md', size_bytes: 10 }, { ext: 'pdf', oss_key: 'viva-ag-results/j-1/a.pdf', filename: 'a.pdf', size_bytes: 20 }],
    completed_at: new Date('2026-09-15T16:46:24Z'), created_at: new Date('2026-09-15T14:00:00Z'),
};

function withDb(fn) { rowsByQuery = fn; queries.length = 0; }

test('list: unknown openid is a 404, not an empty list', async () => {
    withDb(() => ({ rows: [] }));
    const r = await handleGetTwinReports({ openid: 'nobody' });
    assert.equal(r.success, false); assert.equal(r.statusCode, 404);
});

test('list: a coach who does not own the client is refused before any job is read', async () => {
    withDb((sql) => {
        if (/FROM users WHERE user_id = \$1 OR external_id/.test(sql)) return { rows: [{ user_id: 'u1', language: 'zh' }] };
        if (/coach_id = \$2/.test(sql)) return { rows: [] };
        throw new Error('viva_ag_jobs must not be queried after a denied coach check');
    });
    const r = await handleGetTwinReports({ openid: 'u1', coach_id: '9' });
    assert.equal(r.statusCode, 403);
    assert.ok(!queries.some(q => /viva_ag_jobs/.test(q.sql)));
});

test('list: only completed jobs with a file, primary index prefers the PDF, no oss_key leaks', async () => {
    withDb((sql) => {
        if (/FROM users/.test(sql)) return { rows: [{ user_id: 'u1', language: 'zh' }] };
        assert.match(sql, /status = 'completed'/);
        assert.match(sql, /result_files/);
        return { rows: [JOB] };
    });
    const r = await handleGetTwinReports({ openid: 'u1' });
    assert.equal(r.success, true);
    assert.equal(r.reports.length, 1);
    assert.equal(r.latest.title, '全维度健康分析报告');
    assert.equal(r.latest.primary_index, 1, 'the PDF is index 1 here and must be the primary tap');
    assert.equal(r.latest.completed_date, '2026-09-16', 'the card date is the Shanghai calendar day, not UTC');
    assert.ok(!JSON.stringify(r).includes('oss_key'), 'oss_key must never leave the server');
});

test('list: an English user gets the English title; an unknown preset falls back to the command', async () => {
    withDb((sql) => /FROM users/.test(sql) ? { rows: [{ user_id: 'u1', language: 'en' }] } : { rows: [{ ...JOB, command_key: null, command: 'Sleep deep-dive' }] });
    const r = await handleGetTwinReports({ openid: 'u1' });
    assert.equal(r.latest.title, 'Sleep deep-dive');
    withDb((sql) => /FROM users/.test(sql) ? { rows: [{ user_id: 'u1', language: 'en' }] } : { rows: [JOB] });
    assert.equal((await handleGetTwinReports({ openid: 'u1' })).latest.title, 'Comprehensive Health Analysis');
});

test('file: index is clamped, the URL is signed for 300s with the real filename, never the raw key', async () => {
    withDb((sql) => /FROM users/.test(sql) ? { rows: [{ user_id: 'u1', language: 'zh' }] } : { rows: [JOB] });
    const r = await handleGetTwinReportFile({ openid: 'u1', job_uid: 'j-1', index: '99' });
    assert.equal(r.success, true);
    assert.equal(r.index, 1); assert.equal(r.file_type, 'pdf'); assert.equal(r.filename, 'a.pdf');
    assert.match(r.url, /^signed:\/\/viva-ag-results\/j-1\/a\.pdf\?ttl=300/);
    assert.ok(!('oss_key' in r));
});

test('file: another user\'s job_uid is not found (the query is scoped by user_id)', async () => {
    withDb((sql, params) => {
        if (/FROM users/.test(sql)) return { rows: [{ user_id: 'u2', language: 'zh' }] };
        assert.match(sql, /user_id = \$2/); assert.equal(params[1], 'u2');
        return { rows: [] };
    });
    const r = await handleGetTwinReportFile({ openid: 'u2', job_uid: 'j-1' });
    assert.equal(r.statusCode, 404);
});

// ---- the card itself ----
const uhJs = fs.readFileSync(path.join(MINI, 'components', 'user-health', 'user-health.js'), 'utf8');
const uhWxml = fs.readFileSync(path.join(MINI, 'components', 'user-health', 'user-health.wxml'), 'utf8');
const indexJs = fs.readFileSync(path.join(WORKER, 'index.js'), 'utf8');

function loadT(src) {
    const i = src.indexOf('const T = {');
    const j = src.indexOf('\n}\n', i) + 3;
    const ctx = vm.createContext({});
    vm.runInContext(src.slice(i, j) + '\nglobalThis.T = T;', ctx);
    return ctx.T;
}

test('the card sits between the hero and the first twin layer, and every t.* key it uses exists in both languages', () => {
    const card = uhWxml.indexOf('twinReportLatest');
    const daily = uhWxml.indexOf('{{t.layerDaily}}');
    const hero = uhWxml.indexOf('class="health-hero"');
    assert.ok(hero > 0 && card > hero && card < daily, 'the 综合报告 card must render after the hero and before 日常监测');
    const T = loadT(uhJs);
    const keys = [...uhWxml.slice(card - 400, daily).matchAll(/\{\{t\.(\w+)\}\}/g)].map(m => m[1]);
    assert.ok(keys.includes('reportsTitle'));
    for (const k of new Set(keys)) {
        assert.ok(k in T.zh, `T.zh.${k} missing`); assert.ok(k in T.en, `T.en.${k} missing`);
    }
});

test('the card passes coach-id through and the routes are registered', () => {
    assert.match(uhJs, /api\/twin-reports\?openid=[^`]*coach/);
    assert.match(uhJs, /api\/twin-reports\/file\?openid=[^`]*coach/);
    assert.match(indexJs, /path === '\/twin-reports'/);
    assert.match(indexJs, /path === '\/twin-reports\/file'/);
    // The AG entitlement must not gate this surface.
    const handler = fs.readFileSync(path.join(WORKER, 'handlers', 'twin_reports.js'), 'utf8');
    assert.ok(!/requireVivaAgAccess/.test(handler));
});
