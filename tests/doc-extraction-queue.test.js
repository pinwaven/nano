// The queue's correctness properties, and the boundary the whole feature depends on: an OCR'd
// document must never move the user's displayed biological age.
//
// Runs fully offline — lib/db and the modules the handler writes through are stubbed via
// require.cache, the same way tests/kino-scan-refreshes-twin.test.js does it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

let queries = [];
let rows = {};       // regex source -> rows to return
const pool = {
    query: async (sql, params) => {
        queries.push({ sql, params });
        for (const [pattern, value] of Object.entries(rows)) {
            if (new RegExp(pattern).test(sql)) {
                return { rows: typeof value === 'function' ? value(params) : value, rowCount: (typeof value === 'function' ? value(params) : value).length };
            }
        }
        return { rows: [], rowCount: 0 };
    },
};
stub('lib/db', { pool });

let reportCalls = [];
let reportWritten = 1;
stub('handlers/health-plans', {
    // Returns report_id as a STRING, which is what node-postgres actually does with a BIGINT —
    // the contract documents a number, and a strict client threw on it after the write had already
    // happened. observations_written is deliberately lower than what was submitted, so the
    // dedupe-drop case is the one under test.
    handlePostHealthReport: async (body) => {
        reportCalls.push(body);
        return { success: true, report_id: '8823', observations_written: reportWritten };
    },
});
let twinRefreshes = [];
stub('lib/healthTwinUpdater', { updateHealthTwin: async (uid) => { twinRefreshes.push(uid); } });
let delivered = [];
stub('handlers/chat', {
    deliverTerminalMessage: async (uid, persona, type, text, source) => {
        delivered.push({ uid, persona, type, text, source });
        return { notification_id: 1, chat_message_id: 2 };
    },
});

const dx = require(path.join(WORKER, 'handlers', 'doc_extraction.js'));
const SOURCE = fs.readFileSync(path.join(WORKER, 'handlers', 'doc_extraction.js'), 'utf8');
// Comments stripped, because this file explains at length WHY it never writes a kino_chip row and
// a naive substring match would be satisfied by that explanation rather than by the code.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CATALOG = [
    { key_name: 'hsCRP', loinc_code: '71426-1', unit: 'mg/L', ref_low: null, ref_high: 1.0 },
    { key_name: 'ALT', loinc_code: '1742-6', unit: 'U/L', ref_low: null, ref_high: 40 },
];
const CLAIMED_JOB = {
    id: 7, job_uid: 'job-1', document_id: 412, user_id: 'u-1', status: 'claimed',
    result_token: 'good-token', persona_type: 'viva', language: 'zh',
    attempts: 1, max_attempts: 3, claim_expires_at: new Date(Date.now() + 60000),
};

function reset(overrides = {}) {
    queries = []; reportCalls = []; twinRefreshes = []; delivered = []; reportWritten = 1;
    rows = {
        'FROM doc_extraction_jobs WHERE job_uid': [CLAIMED_JOB],
        'FROM biomarker_catalog': CATALOG,
        'FROM health_documents WHERE id': [{ id: 412, oss_key: 'health-documents/u-1/abc.pdf', doc_type: 'other' }],
        ...overrides,
    };
}

const RESULT = {
    job_uid: 'job-1', result_token: 'good-token',
    document: { doc_type: 'lab_report', doc_date: '2026-08-12', institution: '上海市第一人民医院' },
    summary: '年度体检。',
    observations: [{ key_name: 'hsCRP', value: 1.2, unit: 'mg/L', confidence: 0.95 }],
    findings: [{ category: 'allergy', text: '青霉素过敏', confidence: 0.94 }],
};

test('the claim is one atomic statement with FOR UPDATE SKIP LOCKED', () => {
    // Two pollers must get two DIFFERENT jobs, never the same row twice. Rewriting this as a
    // SELECT followed by an UPDATE loses that, silently.
    const claim = SOURCE.slice(SOURCE.indexOf('async function handlePostDocExtractClaim'));
    const stmt = claim.slice(claim.indexOf('UPDATE doc_extraction_jobs'), claim.indexOf('RETURNING id, job_uid'));
    assert.match(stmt, /FOR UPDATE SKIP LOCKED/);
    assert.match(stmt, /LIMIT 1/);
    assert.ok(!/SELECT[\s\S]*;[\s\S]*UPDATE/.test(stmt), 'the claim was split into two statements');
});

test('the queue is scoped per document, not per user', () => {
    // viva_ag_jobs caps one job per USER because an AG run is expensive; ten uploaded reports
    // should extract concurrently. What must not run twice is the same document.
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'schemas', 'migration_doc_extraction_jobs.sql'), 'utf8');
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uniq_doc_extraction_active\s+ON doc_extraction_jobs \(document_id\)/);
    assert.match(migration, /WHERE status IN \('queued','claimed','processing'\)/);
});

test('a stale result_token is refused, and the token check precedes the status check', async () => {
    reset();
    const r = await dx.handlePostDocExtractResult({ ...RESULT, result_token: 'stale' });
    assert.equal(r.success, false);
    assert.equal(r.reason, dx.REASONS.INVALID_TOKEN);
    assert.equal(reportCalls.length, 0, 'a stale token still wrote a report');

    // A worker whose lease moved on should learn its token is dead, not that the job is in some
    // other state — so the token check must come first even for a terminal job.
    reset({ 'FROM doc_extraction_jobs WHERE job_uid': [{ ...CLAIMED_JOB, status: 'completed' }] });
    const terminal = await dx.handlePostDocExtractResult({ ...RESULT, result_token: 'stale' });
    assert.equal(terminal.reason, dx.REASONS.INVALID_TOKEN);
});

test('an expired lease is refused even with the right token', async () => {
    reset({ 'FROM doc_extraction_jobs WHERE job_uid': [{ ...CLAIMED_JOB, claim_expires_at: new Date(Date.now() - 1000) }] });
    const r = await dx.handlePostDocExtractResult(RESULT);
    assert.equal(r.reason, dx.REASONS.LEASE_EXPIRED);
    assert.equal(reportCalls.length, 0);
});

test('a replayed submission writes nothing and delivers no second bubble', async () => {
    reset({ 'FROM doc_extraction_jobs WHERE job_uid': [{ ...CLAIMED_JOB, status: 'completed' }] });
    const r = await dx.handlePostDocExtractResult(RESULT);
    assert.equal(r.success, true);
    assert.equal(r.already_completed, true);
    assert.equal(reportCalls.length, 0);
    assert.equal(delivered.length, 0);
});

test('a result writes the document metadata, the panel and the findings, then refreshes the twin', async () => {
    reset();
    const r = await dx.handlePostDocExtractResult(RESULT);
    assert.equal(r.success, true);

    // Tier 1 — the four columns nothing has ever written.
    const docUpdate = queries.find(q => /UPDATE health_documents/.test(q.sql));
    assert.ok(docUpdate, 'the document row was never updated');
    assert.ok(docUpdate.params.includes('lab_report') && docUpdate.params.includes('2026-08-12'));

    // Tier 2 — through the pipeline that already exists.
    assert.equal(reportCalls.length, 1);
    assert.equal(reportCalls[0].source, dx.EXTRACTION_SOURCE);
    assert.equal(reportCalls[0].source_document_id, 412);
    assert.equal(reportCalls[0].observations.length, 1);

    // Tier 3 — user_memory_facts, never users.bio_data (whose writes are a shallow || merge that
    // would replace the user's own onboarding checklist wholesale).
    const factWrite = queries.find(q => /INSERT INTO user_memory_facts/.test(q.sql));
    assert.ok(factWrite, 'the finding was never written');
    assert.match(factWrite.sql, /'document_extracted'/);
    assert.ok(!queries.some(q => /UPDATE users SET bio_data/.test(q.sql)), 'extraction wrote bio_data');

    assert.deepEqual(twinRefreshes, ['u-1'], 'the twin was not refreshed exactly once');
});

test('an OCR read never moves the displayed BioAge', async () => {
    reset();
    await dx.handlePostDocExtractResult(RESULT);
    // compute_bioage would create a biomarkers(lab_import) row stamped NOW() with the absent Kino
    // markers FABRICATED by BiomarkerEstimator (which range-checks only hsCRP). CLAUDE.md 28b
    // already holds the line that a lab panel does not qualify for formulation.
    assert.equal(reportCalls[0].compute_bioage, false);
    assert.ok(!queries.some(q => /INSERT INTO biomarkers/.test(q.sql)), 'extraction inserted a biomarkers row');
    assert.ok(!CODE.includes('kino_chip'), 'the extraction handler writes a kino_chip row');
});

test('the twin is still refreshed when there is no panel to write', async () => {
    // handlePostHealthReport only refreshes the twin via its compute_bioage branch, which is off,
    // so this handler owns the refresh outright.
    reset();
    await dx.handlePostDocExtractResult({ ...RESULT, observations: [] });
    assert.equal(reportCalls.length, 0);
    assert.deepEqual(twinRefreshes, ['u-1']);
});

test('with no readable date, metadata is kept but no report is written', async () => {
    reset();
    const r = await dx.handlePostDocExtractResult({
        ...RESULT,
        document: { doc_type: 'discharge_summary' },
        observations: [{ key_name: 'hsCRP', value: 1.2, unit: 'mg/L', confidence: 0.95 }],
    });
    assert.equal(r.success, true);
    assert.equal(r.report_id, null);
    assert.equal(reportCalls.length, 0, 'a report was written with no date to put on it');
    assert.ok(queries.some(q => /UPDATE health_documents/.test(q.sql)), 'the metadata was dropped too');
});

test('the result bubble is attributed to Viva, not to Viva AG', async () => {
    reset();
    await dx.handlePostDocExtractResult(RESULT);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].persona, 'viva');
    // Telling a user without the paid add-on that Viva AG read their document would be false.
    assert.notEqual(delivered[0].source, 'viva_ag');
    assert.equal(delivered[0].type, dx.NOTIFY_RESULT);
    assert.match(delivered[0].text, /检验报告/);
});

test('the result message localises off the job language snapshot', async () => {
    reset({ 'FROM doc_extraction_jobs WHERE job_uid': [{ ...CLAIMED_JOB, language: 'en' }] });
    await dx.handlePostDocExtractResult(RESULT);
    assert.match(delivered[0].text, /lab report/);
    assert.ok(!/检验报告/.test(delivered[0].text));
});

test('a delivery failure never fails the job — the writes are already committed', async () => {
    reset();
    const chatPath = require.resolve(path.join(WORKER, 'handlers', 'chat.js'));
    const original = require.cache[chatPath].exports.deliverTerminalMessage;
    require.cache[chatPath].exports.deliverTerminalMessage = async () => { throw new Error('notifications down'); };
    const r = await dx.handlePostDocExtractResult(RESULT);
    require.cache[chatPath].exports.deliverTerminalMessage = original;
    assert.equal(r.success, true, 'a failed bubble made the agent think its work was rejected');
    assert.equal(reportCalls.length, 1);
});

test('clearExtraction deletes the observations before their parent report', async () => {
    reset({ 'FROM health_reports WHERE source_document_id': [{ id: 8823 }] });
    await dx.clearExtraction(412, 'u-1');
    const eventsAt = queries.findIndex(q => /DELETE FROM health_events/.test(q.sql));
    const reportsAt = queries.findIndex(q => /DELETE FROM health_reports/.test(q.sql));
    // health_events.report_id is ON DELETE SET NULL, so deleting the parent first orphans every
    // observation — still feeding health_twin.latest_lab_data, with nothing to trace it back to.
    assert.ok(eventsAt > -1 && reportsAt > -1, 'the delete pair is missing');
    assert.ok(eventsAt < reportsAt, 'the report was deleted before its children');
    assert.ok(queries.some(q => /DELETE FROM user_memory_facts/.test(q.sql)));
    assert.deepEqual(twinRefreshes, ['u-1'], 'the twin still reflects the removed panel');
});

test('a duplicate enqueue for the same document is a no-op, not an error', async () => {
    reset();
    const conflict = Object.assign(new Error('dup'), { code: '23505' });
    const original = pool.query;
    pool.query = async () => { throw conflict; };
    const uid = await dx.enqueueDocExtraction(412, 'u-1');
    pool.query = original;
    assert.equal(uid, null);
});

test('an empty queue is a success with a null job, not a failure', async () => {
    reset({ 'UPDATE doc_extraction_jobs\\s+SET status = .claimed': [] });
    const r = await dx.handlePostDocExtractClaim({ worker_id: 'w1' });
    assert.equal(r.success, true);
    assert.equal(r.job, null);
});

test('the sweep requeues a retryable lease and fails an exhausted one, separately', () => {
    const sweep = SOURCE.slice(SOURCE.indexOf('async function _sweepExpiredLeases'),
        SOURCE.indexOf('async function _loadClaimedJob'));
    assert.match(sweep, /attempts < max_attempts/);
    assert.match(sweep, /attempts >= max_attempts/);
    assert.match(sweep, /status = 'queued'/);
    assert.match(sweep, /status = 'failed'/);
    // A failed sweep must never block a claim.
    assert.match(sweep, /catch[\s\S]*_logError/);
});

test('report_id is a number, not the string node-postgres hands back', async () => {
    // The contract's §7 example shows a number. prod returned "8823". A client with a strict schema
    // threw AFTER the POST had written to a real person's record, so the values were persisted and
    // the caller kept no trace of it.
    reset();
    const r = await dx.handlePostDocExtractResult(RESULT);
    assert.strictEqual(typeof r.report_id, 'number', 'report_id leaked as a string again');
    assert.strictEqual(r.report_id, 8823);
});

test('the user is told what was WRITTEN, not what validated', async () => {
    // health_events dedupes on (user_id, source, external_id), so re-reading a report already
    // extracted validates cleanly and writes nothing. Reporting the accepted count would tell the
    // user we recorded values we did not.
    reset();
    reportWritten = 0;
    await dx.handlePostDocExtractResult(RESULT);
    assert.equal(delivered.length, 1);
    assert.ok(!/1 项指标/.test(delivered[0].text),
        'claimed a marker was recorded when the write was deduped away');
    assert.match(delivered[0].text, /没有可以记录的化验指标|没有找到/,
        'a zero-write result should not read as a successful recording');
});

test('accepted and written are both reported, and can differ', async () => {
    reset();
    reportWritten = 0;
    const r = await dx.handlePostDocExtractResult(RESULT);
    assert.equal(r.accepted.observations_accepted, 1, 'the validator accepted one');
    assert.equal(r.accepted.observations_written, 0, 'but none were persisted');
});
