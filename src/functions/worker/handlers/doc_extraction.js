'use strict';

/**
 * Job queue for the external document-extraction agent (Curia's Viva agent).
 *
 * A user uploads a 体检报告 PDF or photographs a discharge summary and it lands in
 * health_documents — where, until this shipped, nothing but Viva AG ever read it. For anyone
 * without the paid add-on it was an inert archive, and even the row's own doc_type/doc_date/
 * institution columns stayed empty because no client has ever sent them. This turns a document
 * into twin data.
 *
 * The design invariants, all mirrored from handlers/viva_ag.js — read that file before changing
 * anything structural here:
 *
 *   - NO EventBridge, NO cron. The slow work happens entirely inside the external agent, so nano
 *     never holds a request open and CLAUDE.md 22's CloudEvent machinery has no pressure to
 *     relieve. Lease expiry is swept LAZILY at the top of the claim handler.
 *   - No openid, nickname or phone in any /doc-extract/* response, and there is no "fetch a
 *     document for an arbitrary openid" path, so a leaked API token can drain the queue but
 *     cannot enumerate users.
 *
 *     ONE KNOWN EXCEPTION, found by live testing on dev 2026-09-09 and shared with viva-ag:
 *     the presigned document URL's own path is 'health-documents/<user_id>/<hex>.<ext>', so the
 *     internal user_id IS visible to the agent. It is not an openid, a phone or a name, but it
 *     does defeat cross-job unlinkability — an agent can tell that two documents belong to the
 *     same person. presignDocuments() is shared, so /viva-ag/twin-bundle and
 *     /viva-ag/document-url carry it identically and twinBundle.js's pseudonymity note is
 *     overstated in the same way. Fixing it means minting opaque keys for new uploads, which
 *     also means replacing the prefix-confinement check in handlers/health_documents.js that
 *     currently relies on the user_id being IN the key. Not attempted here.
 *   - result_token is a FENCING token, rotated on every claim. It is simultaneously the
 *     submission credential and the idempotency key: a worker whose lease expired and was
 *     re-claimed holds a dead token, so two workers can never both write a result.
 *   - Routine failures return { success: false, reason: 'snake_case' } at HTTP 200. Callers
 *     branch on `reason`, never on a status code.
 *
 * And one that is this queue's own: it is scoped to a DOCUMENT, not a user. viva_ag_jobs caps one
 * in-flight job per user because an AG run is expensive and slow; ten uploaded reports should
 * produce ten concurrent extractions. What must not happen twice at once is the same document,
 * because both runs would race to write the same health_events rows — hence
 * uniq_doc_extraction_active on document_id.
 */

const crypto = require('crypto');
const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { presignDocuments, DEFAULT_DOC_URL_TTL_SECONDS, clampInt } = require('../lib/twinBundle');
const { validateExtraction, MAX_SUMMARY_LENGTH } = require('../lib/docExtraction');
const { handlePostHealthReport } = require('./health-plans');
const { updateHealthTwin } = require('../lib/healthTwinUpdater');
const { deliverTerminalMessage } = require('./chat');
const { formatToShanghai, calculateAge } = require('../lib/time-utils');

const CONTRACT_VERSION = 1;

const DEFAULT_LEASE_SECONDS = 600;
const MIN_LEASE_SECONDS = 60;
const MAX_LEASE_SECONDS = 3600;

// Every row this feature writes carries this in health_events.source and health_reports.source.
// Load-bearing, not cosmetic: health_events dedupes on (user_id, source, external_id), so a
// distinct source both keeps extracted observations from colliding with hand-entered ones for the
// same marker and day, and makes everything this feature created selectable in one predicate when
// the user corrects it.
const EXTRACTION_SOURCE = 'document_extraction';

const NOTIFY_RESULT = 'doc_extraction_result';

// Chat attribution. Deliberately NOT 'viva_ag': that label means the paid deep-analysis agent,
// and telling a user without the add-on that Viva AG read their document would be false. The
// persona stays 'viva' for the same reason viva_ag_jobs' does — chat history is persona-scoped,
// so a bubble saved under a persona the chat tab never queries flashes once and vanishes on
// reload (CLAUDE.md 25's second bug).
const CHAT_SOURCE = null;

const MAX_RESULT_BYTES = 256 * 1024;

const REASONS = {
    MISSING_PARAMS: 'missing_params',
    JOB_NOT_FOUND: 'job_not_found',
    INVALID_TOKEN: 'invalid_token',
    JOB_NOT_CLAIMABLE: 'job_not_claimable',
    JOB_ALREADY_COMPLETED: 'job_already_completed',
    LEASE_EXPIRED: 'lease_expired',
    DOCUMENT_NOT_FOUND: 'document_not_found',
    RESULT_TOO_LARGE: 'result_too_large',
    NOTHING_EXTRACTED: 'nothing_extracted',
    INTERNAL_ERROR: 'internal_error',
};

function _fail(reason, error) {
    return { success: false, reason, error: error || reason };
}

function _logError(msg, err, extra = {}) {
    console.error(JSON.stringify({ level: 'ERROR', msg, error: err.message, ...extra }));
}

// ---------------------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------------------

// Lazy lease sweep — the reason this queue needs no scheduler. Two statements rather than one:
// a job with attempts left goes back on the queue, one out of attempts fails terminally. Unlike
// the AG sweep there is no third statement, because nothing here parks awaiting user input.
//
// A terminal extraction failure delivers NO chat message. The user asked for an upload, not for
// an analysis, and telling them "we couldn't read your document" for a scan nano was never asked
// to read would be noise on a surface they did not opt into. The failure is visible on the
// document row, where they can retry it.
async function _sweepExpiredLeases() {
    try {
        await pool.query(
            `UPDATE doc_extraction_jobs
                SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
                    claim_expires_at = NULL, result_token = NULL, updated_at = NOW()
              WHERE status IN ('claimed','processing')
                AND claim_expires_at < NOW()
                AND attempts < max_attempts`
        );
        await pool.query(
            `UPDATE doc_extraction_jobs
                SET status = 'failed', error_reason = 'lease_expired_max_attempts',
                    completed_at = NOW(), updated_at = NOW()
              WHERE status IN ('claimed','processing')
                AND claim_expires_at < NOW()
                AND attempts >= max_attempts`
        );
    } catch (err) {
        // A failed sweep must never block a claim — the next tick retries it.
        _logError('doc_extraction lease sweep failed', err);
    }
}

// Token check BEFORE the status check, matching _loadClaimedJob in viva_ag.js: a worker whose
// lease expired should learn its token is dead, not that the job it thinks it owns is in some
// other state.
async function _loadClaimedJob(jobUid, token, { allowCompleted = false } = {}) {
    if (!jobUid || !token) return { error: _fail(REASONS.MISSING_PARAMS) };
    const { rows: [job] } = await pool.query(
        'SELECT * FROM doc_extraction_jobs WHERE job_uid = $1', [String(jobUid)]);
    if (!job) return { error: _fail(REASONS.JOB_NOT_FOUND) };
    if (!job.result_token || job.result_token !== token) return { error: _fail(REASONS.INVALID_TOKEN), job };
    if (allowCompleted && job.status === 'completed') return { job, alreadyCompleted: true };
    if (!['claimed', 'processing'].includes(job.status)) {
        return {
            error: _fail(['completed', 'failed', 'cancelled', 'rejected'].includes(job.status)
                ? REASONS.JOB_ALREADY_COMPLETED : REASONS.JOB_NOT_CLAIMABLE),
            job,
        };
    }
    if (job.claim_expires_at && new Date(job.claim_expires_at) < new Date()) {
        return { error: _fail(REASONS.LEASE_EXPIRED), job };
    }
    return { job };
}

// The extraction vocabulary, generated from the live table.
//
// This is the single most important thing the agent is handed. handlePostHealthReport SILENTLY
// DROPS any observation whose key_name does not resolve here (no log, no counter), and the
// pre-existing vision prompt hardcodes a 25-key literal list that has to be kept in step with
// this table by hand. Generating it means the agent is always aiming at what nano can actually
// store, and anything outside it belongs in `unmapped` rather than being invented into a key.
async function fetchCatalog() {
    const { rows } = await pool.query(
        // loinc_code is selected for the VALIDATOR, not for the agent: validateExtraction rebuilds
        // each observation from the catalog row rather than echoing the payload, so a field
        // missing here silently becomes null on every stored observation. Caught live on dev —
        // the unit test's fixture carried loinc_code and the real query did not.
        `SELECT key_name, loinc_code, display_name, display_name_zh, unit, category, nano_dimension,
                is_kino_core, ref_low, ref_high
           FROM biomarker_catalog
          WHERE is_active = TRUE
          ORDER BY is_kino_core DESC, key_name`
    );
    return rows.map(r => ({
        key_name: r.key_name,
        loinc_code: r.loinc_code,
        display_name: r.display_name,
        display_name_zh: r.display_name_zh,
        unit: r.unit,
        category: r.category,
        ref_low: r.ref_low == null ? null : Number(r.ref_low),
        ref_high: r.ref_high == null ? null : Number(r.ref_high),
    }));
}

// ---------------------------------------------------------------------------------------
// Enqueue and correction — called from handlers/health_documents.js
// ---------------------------------------------------------------------------------------

/**
 * Queue an extraction for one document. Returns the job_uid, or null if one is already in flight
 * (uniq_doc_extraction_active, PG 23505) — a duplicate is a no-op, never an error.
 *
 * The caller must not let a failure here fail the upload: the document is safely stored either
 * way, and the user can re-run extraction by hand.
 */
async function enqueueDocExtraction(documentId, userId, { language = 'zh', personaType = 'viva' } = {}) {
    const jobUid = crypto.randomUUID();
    try {
        const { rows: [row] } = await pool.query(
            `INSERT INTO doc_extraction_jobs (job_uid, document_id, user_id, persona_type, language)
             VALUES ($1, $2, $3, $4, $5) RETURNING job_uid`,
            [jobUid, documentId, userId, personaType, language || 'zh']
        );
        console.log(JSON.stringify({ level: 'INFO', msg: 'doc_extraction job queued', job_uid: row.job_uid, document_id: documentId }));
        return row.job_uid;
    } catch (err) {
        if (err.code === '23505') return null;   // already in flight for this document
        throw err;
    }
}

/**
 * Remove everything a previous extraction of this document wrote.
 *
 * Mandatory before a re-run, not merely tidy: health_events dedupes on
 * (user_id, source, external_id) with ON CONFLICT DO NOTHING, so a corrected value for the same
 * marker and date would otherwise be a silent no-op and the user's correction would appear to do
 * nothing at all.
 *
 * health_events children are deleted EXPLICITLY. The report FK is ON DELETE SET NULL, so deleting
 * the parent alone would leave them orphaned — still feeding health_twin.latest_lab_data, with
 * nothing left to trace them back to.
 */
async function clearExtraction(documentId, userId) {
    const { rows: reports } = await pool.query(
        `SELECT id FROM health_reports WHERE source_document_id = $1 AND user_id = $2`,
        [documentId, userId]
    );
    const reportIds = reports.map(r => Number(r.id));
    if (reportIds.length > 0) {
        await pool.query('DELETE FROM health_events WHERE report_id = ANY($1::bigint[])', [reportIds]);
        await pool.query('DELETE FROM health_reports WHERE id = ANY($1::bigint[])', [reportIds]);
    }
    // Hard delete rather than status='inactive': these are not the user's own words, and a fact
    // they have explicitly called wrong is not worth keeping around to be re-read.
    const { rowCount: factsRemoved } = await pool.query(
        'DELETE FROM user_memory_facts WHERE source_document_id = $1 AND user_id = $2',
        [documentId, userId]
    );
    await pool.query(
        `UPDATE health_documents SET summary = NULL, summary_generated_at = NULL WHERE id = $1 AND user_id = $2`,
        [documentId, userId]
    );
    // The lab panel came out of health_events, so the twin has to be recomputed without it.
    await updateHealthTwin(userId, pool);
    return { reports_removed: reportIds.length, facts_removed: factsRemoved };
}

// ---------------------------------------------------------------------------------------
// External agent endpoints
// ---------------------------------------------------------------------------------------

async function handleGetDocExtractPing() {
    try {
        const { rows: [q] } = await pool.query(
            `SELECT COUNT(*)::int AS depth FROM doc_extraction_jobs WHERE status = 'queued'`);
        return {
            success: true,
            env: process.env.EVENT_SOURCE_SUFFIX ? 'dev' : 'prod',
            contract_version: CONTRACT_VERSION,
            queue_depth: q.depth,
            server_time: formatToShanghai(new Date()),
        };
    } catch (err) {
        _logError('handleGetDocExtractPing failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// The same catalog every claim carries, standalone — so an implementer can build and tune their
// extraction prompt before a single job exists.
async function handleGetDocExtractCatalog() {
    try {
        return { success: true, contract_version: CONTRACT_VERSION, catalog: await fetchCatalog() };
    } catch (err) {
        _logError('handleGetDocExtractCatalog failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

/**
 * Dry-run a candidate result payload against the REAL validator — the same pure function the
 * result path calls — with no job, no claim and no write.
 *
 * This exists so "did we get the contract right?" is a loop the external implementer can run
 * themselves instead of a live-fire question. Because validateExtraction does no I/O, this is a
 * thin wrapper rather than a second implementation that could drift from the enforced rules.
 */
async function handlePostDocExtractValidate(body) {
    try {
        const validated = validateExtraction(body || {}, await fetchCatalog());
        return {
            success: true,
            contract_version: CONTRACT_VERSION,
            would_accept: validated.observations.length > 0 || validated.findings.length > 0
                || !!validated.summary || !!validated.document.doc_date,
            ...validated,
        };
    } catch (err) {
        _logError('handlePostDocExtractValidate failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// Atomically claims the head of the queue.
//
// FOR UPDATE SKIP LOCKED is the correctness core: two pollers hitting this simultaneously get two
// DIFFERENT jobs (or one job and null), never the same row twice. Do not rewrite this as a SELECT
// followed by an UPDATE.
async function handlePostDocExtractClaim(body) {
    try {
        await _sweepExpiredLeases();

        const workerId = String(body?.worker_id || '').trim().slice(0, 120) || 'unknown';
        const leaseSeconds = clampInt(body?.lease_seconds, DEFAULT_LEASE_SECONDS, MIN_LEASE_SECONDS, MAX_LEASE_SECONDS);
        // Minted in Node rather than SQL: gen_random_bytes() needs pgcrypto, and this cluster is
        // shared with GCN (CLAUDE.md 32) — not somewhere to add an extension for convenience.
        const resultToken = crypto.randomBytes(24).toString('hex');

        const { rows: [job] } = await pool.query(
            `UPDATE doc_extraction_jobs
                SET status = 'claimed', claimed_by = $1, claimed_at = NOW(), heartbeat_at = NOW(),
                    claim_expires_at = NOW() + ($2 || ' seconds')::interval,
                    attempts = attempts + 1, result_token = $3,
                    started_at = COALESCE(started_at, NOW()), updated_at = NOW()
              WHERE id = (
                    SELECT id FROM doc_extraction_jobs
                     WHERE status = 'queued'
                     ORDER BY created_at ASC
                     FOR UPDATE SKIP LOCKED
                     LIMIT 1
              )
            RETURNING id, job_uid, document_id, user_id, attempts, max_attempts,
                      claim_expires_at, created_at`,
            [workerId, String(leaseSeconds), resultToken]
        );
        if (!job) return { success: true, job: null };

        const { rows: [doc] } = await pool.query(
            `SELECT id, oss_key, filename, content_type, size_bytes, etag, doc_type,
                    doc_date::text AS doc_date, institution, note, created_at
               FROM health_documents WHERE id = $1 AND status = 'active'`,
            [job.document_id]
        );
        if (!doc) {
            // Soft-deleted between enqueue and claim. Close the job rather than handing the agent
            // a job it can never satisfy.
            await pool.query(
                `UPDATE doc_extraction_jobs SET status = 'cancelled', error_reason = 'document_deleted',
                        completed_at = NOW(), result_token = NULL, updated_at = NOW() WHERE id = $1`,
                [job.id]
            );
            return { success: true, job: null };
        }

        // Enough to read an age- or sex-dependent reference range off a report, and nothing more.
        // No openid, nickname or phone. (The user_id is still inferable from the presigned
        // document URL's path — see the exception in this module's header.)
        const { rows: [user] } = await pool.query(
            'SELECT birth_date, gender, language FROM users WHERE user_id = $1', [job.user_id]);

        const [document] = presignDocuments([doc], DEFAULT_DOC_URL_TTL_SECONDS);

        console.log(JSON.stringify({ level: 'INFO', msg: 'doc_extraction job claimed', job_uid: job.job_uid, worker_id: workerId, attempt: job.attempts }));
        return {
            success: true,
            job: {
                job_uid: job.job_uid,
                attempt: job.attempts,
                max_attempts: job.max_attempts,
                queued_at: formatToShanghai(job.created_at),
                lease_expires_at: formatToShanghai(job.claim_expires_at),
                result_token: resultToken,
                document,
                subject: {
                    ref: job.job_uid,
                    age: user?.birth_date ? calculateAge(user.birth_date) : null,
                    gender: user?.gender || null,
                    language: user?.language || 'zh',
                },
                catalog: await fetchCatalog(),
            },
        };
    } catch (err) {
        _logError('handlePostDocExtractClaim failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

async function handlePostDocExtractHeartbeat(body) {
    try {
        const { error, job } = await _loadClaimedJob(body?.job_uid, body?.result_token);
        if (error) return error;

        const extend = clampInt(body?.extend_seconds, DEFAULT_LEASE_SECONDS, MIN_LEASE_SECONDS, MAX_LEASE_SECONDS);
        const note = body?.progress_note ? String(body.progress_note).trim().slice(0, 500) : null;
        const { rows: [updated] } = await pool.query(
            `UPDATE doc_extraction_jobs
                SET status = 'processing', heartbeat_at = NOW(),
                    claim_expires_at = NOW() + ($2 || ' seconds')::interval,
                    progress_note = COALESCE($3, progress_note), updated_at = NOW()
              WHERE id = $1
            RETURNING claim_expires_at`,
            [job.id, String(extend), note]
        );
        return { success: true, lease_expires_at: formatToShanghai(updated.claim_expires_at) };
    } catch (err) {
        _logError('handlePostDocExtractHeartbeat failed', err, { job_uid: body?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// ---------------------------------------------------------------------------------------
// Result — where the twin actually gets filled
// ---------------------------------------------------------------------------------------

function _resultMessage(language, { docLabel, accepted, findings, unmapped, hasDate }) {
    const isZh = (language || 'zh') !== 'en';
    if (isZh) {
        const parts = [`已读取你上传的${docLabel}。`];
        if (accepted > 0) parts.push(`其中 ${accepted} 项指标已记入你的数字孪生「医疗记录」。`);
        else if (!hasDate) parts.push('没有找到可识别的报告日期，所以这次只保存了文档信息，没有记录指标。');
        else parts.push('这份文档里没有可以记录的化验指标。');
        if (findings > 0) parts.push(`另外记录了 ${findings} 条个人健康信息（如过敏史）。`);
        if (unmapped > 0) parts.push(`还有 ${unmapped} 项暂时不在我们的指标库里，没有记录。`);
        parts.push('如果读取有误，可以在健康文档里重新解析或删除。');
        return parts.join('');
    }
    const parts = [`I've read the ${docLabel} you uploaded.`];
    if (accepted > 0) parts.push(` ${accepted} marker${accepted === 1 ? '' : 's'} were added to your digital twin's Medical Records.`);
    else if (!hasDate) parts.push(" I couldn't find a readable report date, so I saved the document details but recorded no markers.");
    else parts.push(' There were no lab markers in it to record.');
    if (findings > 0) parts.push(` I also noted ${findings} personal health detail${findings === 1 ? '' : 's'} (such as an allergy).`);
    if (unmapped > 0) parts.push(` ${unmapped} item${unmapped === 1 ? ' is' : 's are'} not in our marker library yet and were not recorded.`);
    parts.push(' If anything looks wrong, you can re-run or remove it from Health Records.');
    return parts.join('');
}

const DOC_LABEL = {
    zh: { lab_report: '检验报告', hospital_record: '就医记录', imaging: '影像报告', discharge_summary: '出院小结', prescription: '处方', other: '健康文档' },
    en: { lab_report: 'lab report', hospital_record: 'hospital record', imaging: 'imaging report', discharge_summary: 'discharge summary', prescription: 'prescription', other: 'health record' },
};

/**
 * POST /doc-extract/jobs/result — the agent's submission, validated and written.
 *
 * Order matters: document metadata first (it is useful even when nothing else parses), then the
 * lab panel, then findings, then ONE twin refresh at the end.
 */
async function handlePostDocExtractResult(body) {
    try {
        const { error, job, alreadyCompleted } = await _loadClaimedJob(
            body?.job_uid, body?.result_token, { allowCompleted: true });
        if (error) return error;
        // A replayed submission must not deliver a second chat bubble or write a second report.
        if (alreadyCompleted) {
            return { success: true, already_completed: true, job_uid: job.job_uid };
        }

        if (Buffer.byteLength(JSON.stringify(body || {}), 'utf8') > MAX_RESULT_BYTES) {
            return _fail(REASONS.RESULT_TOO_LARGE, `result exceeds ${MAX_RESULT_BYTES} bytes`);
        }

        const { rows: [doc] } = await pool.query(
            `SELECT id, oss_key, doc_type FROM health_documents WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [job.document_id, job.user_id]
        );
        if (!doc) return _fail(REASONS.DOCUMENT_NOT_FOUND);

        const validated = validateExtraction(body, await fetchCatalog());
        const { document, summary, observations, findings, unmapped, rejected, counts } = validated;

        // ── Tier 1: the document row. Four columns nothing has ever written, so this alone is
        //    what makes the list show 检验报告 / 出院小结 badges and real dates.
        await pool.query(
            `UPDATE health_documents
                SET doc_type = $2,
                    doc_date = COALESCE($3::date, doc_date),
                    institution = COALESCE($4, institution),
                    note = COALESCE($5, note),
                    summary = $6,
                    summary_generated_at = CASE WHEN $6::text IS NULL THEN NULL ELSE NOW() END
              WHERE id = $1`,
            [doc.id, document.doc_type, document.doc_date, document.institution, document.note, summary]
        );

        // ── Tier 2: the lab panel, through the pipeline that already exists.
        const reportDate = document.doc_date || (observations[0] && observations[0].data_date) || null;
        let reportId = null;
        // What the validator ACCEPTED and what was actually PERSISTED are different numbers.
        // health_events dedupes on (user_id, source, external_id), so a marker already recorded for
        // the same day and source is a silent no-op — re-reading the same report, or two documents
        // covering one panel, writes fewer rows than it accepts. The user is told what was
        // recorded, not what was parsed, or a re-upload claims to have added values it did not.
        let written = 0;
        if (observations.length > 0 && reportDate) {
            const reportRes = await handlePostHealthReport({
                user_id: job.user_id,
                report_date: reportDate,
                source: EXTRACTION_SOURCE,
                institution: document.institution,
                report_type: document.doc_type === 'lab_report' ? 'lab_panel' : document.doc_type,
                observations,
                oss_key: doc.oss_key,
                source_document_id: doc.id,
                // compute_bioage stays FALSE, deliberately. updateHealthTwin reads BioAge only
                // from test_type='kino_chip', so a lab_import row could never reach the displayed
                // BioAge anyway — but it would create a biomarkers row stamped NOW() rather than
                // the report date, with the absent Kino markers FABRICATED by BiomarkerEstimator
                // (which range-checks only hsCRP; the other five are accepted on presence alone).
                // Manufacturing a BioAge out of an OCR'd document is not what filling the twin
                // should mean, and CLAUDE.md 28b already holds the line that a lab panel does not
                // qualify for formulation.
                compute_bioage: false,
            }, {});
            if (reportRes?.success) { reportId = reportRes.report_id; written = reportRes.observations_written ?? observations.length; }
            else _logError('doc_extraction report write failed', new Error(reportRes?.error || 'unknown'), { job_uid: job.job_uid });
        }

        // ── Tier 3: findings → user_memory_facts. Never users.bio_data: those writes are a
        //    shallow `||` merge, so health_conditions would be replaced wholesale by OCR output.
        for (const f of findings) {
            try {
                await pool.query(
                    `INSERT INTO user_memory_facts (user_id, category, fact_zh, source, source_document_id)
                     VALUES ($1, $2, $3, 'document_extracted', $4)
                     ON CONFLICT (user_id, category, fact_zh) WHERE status = 'active'
                     DO UPDATE SET last_mentioned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
                    [job.user_id, f.category, f.text, doc.id]
                );
            } catch (factErr) {
                _logError('doc_extraction fact write failed', factErr, { job_uid: job.job_uid, category: f.category });
            }
        }

        // The panel reaches health_twin.latest_lab_data through health_events, and
        // handlePostHealthReport only refreshes the twin via its compute_bioage branch — which is
        // off. So this call is what actually lands the extraction in the twin. AWAITED: FC 3.0
        // freezes the execution context on return, so a fire-and-forget promise here would often
        // never run. updateHealthTwin swallows its own errors and never throws.
        await updateHealthTwin(job.user_id, pool);

        await pool.query(
            `UPDATE doc_extraction_jobs
                SET status = 'completed', completed_at = NOW(), result = $2, rejected = $3,
                    health_report_id = $4, result_token = NULL, updated_at = NOW()
              WHERE id = $1`,
            [job.id, JSON.stringify({ document, summary, observations, findings, unmapped,
                counts: { ...counts, observations_written: written } }),
                JSON.stringify(rejected), reportId]
        );

        // Delivery failure must never make the agent think its work was rejected and retry the
        // whole extraction — the writes above are already committed.
        try {
            const lang = (job.language || 'zh') === 'en' ? 'en' : 'zh';
            const text = _resultMessage(job.language, {
                docLabel: DOC_LABEL[lang][document.doc_type] || DOC_LABEL[lang].other,
                accepted: written,
                findings: findings.length,
                unmapped: unmapped.length,
                hasDate: !!reportDate,
            });
            const ids = await deliverTerminalMessage(job.user_id, job.persona_type || 'viva', NOTIFY_RESULT, text, CHAT_SOURCE);
            await pool.query(
                `UPDATE doc_extraction_jobs SET notification_id = $2, chat_message_id = $3, delivered_at = NOW() WHERE id = $1`,
                [job.id, ids.notification_id, ids.chat_message_id]
            );
        } catch (deliverErr) {
            _logError('doc_extraction delivery failed', deliverErr, { job_uid: job.job_uid });
        }

        console.log(JSON.stringify({ level: 'INFO', msg: 'doc_extraction completed', job_uid: job.job_uid, ...counts, report_id: reportId }));
        return {
            success: true,
            job_uid: job.job_uid,
            report_id: reportId == null ? null : Number(reportId),
            accepted: { ...counts, observations_written: written },
            rejected,
        };
    } catch (err) {
        _logError('handlePostDocExtractResult failed', err, { job_uid: body?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

async function handlePostDocExtractFail(body) {
    try {
        const { error, job } = await _loadClaimedJob(body?.job_uid, body?.result_token);
        if (error) return error;

        const reason = String(body?.reason || 'agent_reported_failure').trim().slice(0, 200);
        const retryable = body?.retryable !== false && job.attempts < job.max_attempts;
        await pool.query(
            `UPDATE doc_extraction_jobs
                SET status = $2, error_reason = $3, result_token = NULL,
                    claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
                    completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END,
                    updated_at = NOW()
              WHERE id = $1`,
            [job.id, retryable ? 'queued' : 'failed', reason]
        );
        return { success: true, requeued: retryable };
    } catch (err) {
        _logError('handlePostDocExtractFail failed', err, { job_uid: body?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

module.exports = {
    handleGetDocExtractPing,
    handleGetDocExtractCatalog,
    handlePostDocExtractValidate,
    handlePostDocExtractClaim,
    handlePostDocExtractHeartbeat,
    handlePostDocExtractResult,
    handlePostDocExtractFail,
    // For handlers/health_documents.js
    enqueueDocExtraction,
    clearExtraction,
    fetchCatalog,
    // For tests and docs
    REASONS,
    EXTRACTION_SOURCE,
    NOTIFY_RESULT,
    CONTRACT_VERSION,
    DEFAULT_LEASE_SECONDS,
    MIN_LEASE_SECONDS,
    MAX_LEASE_SECONDS,
};
