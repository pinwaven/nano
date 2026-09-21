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
const { deriveFoodGuideline } = require('../lib/foodSensitivity');
const { writeDocumentTags, clearDocumentTags, syncMemoryFactsFromTags } = require('../lib/documentTags');
const { handlePostHealthReport } = require('./health-plans');
const { updateHealthTwin } = require('../lib/healthTwinUpdater');
const { deliverTerminalMessage } = require('./chat');
const { formatToShanghai, calculateAge } = require('../lib/time-utils');

// 2 (2026-09-15): catalog[].aliases; document.doc_date may be user-set and is the fallback date;
// unmapped.{ref_text,flag,section}; the `structured` block; three more doc types; a report row
// (and health_report_items) for every dated document whether or not a marker was catalogued.
// Purely additive — a v1 worker keeps working.
// 3 (2026-09-16): `structured.version: 2` keeps tables as tables; a `source` cell reference on
// every item; `unmapped[].suggested_key` (stored, never promoted); a third catalog
// (`tag_catalog`) and `tags` — facts with a key, a status and an anchor — which replace
// `findings` as the path into user_memory_facts. `findings` is still accepted and stored as
// descriptors, which nothing acts on. A v2 worker keeps working; its findings just stop
// reaching product filtering and formulation.
// 4 (2026-09-21): page groups. Photos of one report uploaded together are grouped at claim time;
// the head job's claim carries `group.pages[]` (every page, presigned, in upload order) and one
// result submitted to the head closes every page. A single upload has no `group`. Additive: a v3
// worker sees the head's own `document` exactly as before and reads page 1 alone, which is what it
// did anyway. The members are then closed with the head's reading.
const CONTRACT_VERSION = 4;
// Photos uploaded within this many seconds of the previous one, by the same user, are pages of
// one report. Three minutes covered 21 pages on the case that motivated this; ten is generous
// without reaching a report uploaded the next morning.
const DOC_GROUP_WINDOW_SECONDS = 600;

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
        // Pages whose head just died of exhaustion die with it (see handlePostDocExtractFail).
        await pool.query(
            `UPDATE doc_extraction_jobs m
                SET status = 'failed', error_reason = 'group_head_failed', completed_at = NOW(), updated_at = NOW()
              WHERE m.status = 'grouped'
                AND EXISTS (SELECT 1 FROM doc_extraction_jobs h
                             WHERE h.group_uid = m.group_uid AND h.group_role = 'head' AND h.status = 'failed')`
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
                is_kino_core, ref_low, ref_high, aliases
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
        // Alternate printed spellings (migration_biomarker_catalog_aliases.sql). For the agent's
        // matcher; the validator never reads them — key_name stays the only identifier.
        aliases: Array.isArray(r.aliases) ? r.aliases : [],
    }));
}

// The food vocabulary, handed to the agent alongside the biomarker catalog for exactly the same
// reason: a food_key that resolves to nothing is dropped and counted, so the agent has to be
// aiming at what nano can actually store. `aliases` ships because the source is OCR of a printed
// grid and one lab spells one food two ways — 卵类粘蛋白 in the results table, 卵类黏蛋白 in its
// own appendix.
//
// dot_conflict_keys is deliberately NOT sent: it governs what a restriction does to a dots
// formula on nano's side and is none of the agent's business.
async function fetchFoodCatalog() {
    const { rows } = await pool.query(
        `SELECT food_key, name_zh, name_en, category, aliases, common_sources_zh, substitutes_zh
           FROM food_catalog
          WHERE is_active = TRUE
          ORDER BY category, food_key`
    );
    return rows.map(r => ({
        food_key: r.food_key,
        name_zh: r.name_zh,
        name_en: r.name_en,
        category: r.category,
        aliases: r.aliases || [],
        common_sources_zh: r.common_sources_zh || [],
        substitutes_zh: r.substitutes_zh || [],
    }));
}

// The tag vocabulary (contract 3). memory_category is NOT sent: which user_memory_facts
// category a fact is mirrored into is nano's decision about what acts on it, not the agent's.
async function fetchTagCatalog() {
    const { rows } = await pool.query(
        `SELECT tag_key, category, name_zh, name_en, aliases, values
           FROM tag_catalog
          WHERE is_active = TRUE
          ORDER BY category, sort_order, tag_key`
    );
    return rows.map(r => ({
        tag_key: r.tag_key,
        category: r.category,
        name_zh: r.name_zh,
        name_en: r.name_en,
        aliases: Array.isArray(r.aliases) ? r.aliases : [],
        values: Array.isArray(r.values) && r.values.length > 0 ? r.values : null,
    }));
}

// The validator reads tag_catalog rows with memory_category absent — it never needs it — so
// the same rows serve both the claim response and validation.
async function fetchAllCatalogs() {
    const [catalog, foodCatalog, tagCatalog] = await Promise.all([fetchCatalog(), fetchFoodCatalog(), fetchTagCatalog()]);
    return { catalog, foodCatalog, tagCatalog };
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
    // The document's tags go with it, and the user's managed facts are re-derived from whatever
    // other documents still say — a shellfish allergy two documents stated survives clearing one.
    let tagsRemoved = 0;
    try {
        tagsRemoved = await clearDocumentTags(pool, documentId, userId);
        await syncMemoryFactsFromTags(pool, userId);
    } catch (tagErr) {
        _logError('clearExtraction tags failed', tagErr, { document_id: documentId });
    }
    // A food-sensitivity panel lives in its own tables, so it has to be dropped explicitly.
    // food_sensitivity_results cascades off the panel. This is mandatory, not tidy: a re-run
    // inserts a fresh panel, and leaving the old one would leave the user reading two
    // contradictory answers to "can I eat this" with no way to tell which is current.
    const { rowCount: panelsRemoved } = await pool.query(
        'DELETE FROM food_sensitivity_panels WHERE source_document_id = $1 AND user_id = $2',
        [documentId, userId]
    );
    // health_report_items cascade off the report rows deleted above. extracted_json is the
    // agent's reading too, so it goes with the rest; doc_type/doc_date/institution stay — a
    // user-corrected date must survive a re-run, and an agent-read one is still the best guess
    // the next run can start from.
    await pool.query(
        `UPDATE health_documents
            SET summary = NULL, summary_generated_at = NULL, extracted_json = NULL, extracted_json_at = NULL
          WHERE id = $1 AND user_id = $2`,
        [documentId, userId]
    );
    // The lab panel came out of health_events, so the twin has to be recomputed without it.
    await updateHealthTwin(userId, pool);
    return { reports_removed: reportIds.length, facts_removed: factsRemoved, panels_removed: panelsRemoved, tags_removed: tagsRemoved };
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
        const { catalog, foodCatalog, tagCatalog } = await fetchAllCatalogs();
        return { success: true, contract_version: CONTRACT_VERSION, catalog, food_catalog: foodCatalog, tag_catalog: tagCatalog };
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
        const { catalog, foodCatalog, tagCatalog } = await fetchAllCatalogs();
        const validated = validateExtraction(body || {}, catalog, foodCatalog, { tagCatalogRows: tagCatalog });
        return {
            success: true,
            contract_version: CONTRACT_VERSION,
            would_accept: validated.observations.length > 0 || validated.findings.length > 0
                || validated.tags.length > 0 || validated.unmapped.length > 0 || !!validated.structured
                || (validated.food_sensitivity?.items.length || 0) > 0
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
// Turn runs of queued photo uploads by one user into groups. Runs at claim time, like the sweep,
// inside one transaction with the candidate rows locked, so two pollers cannot both group the
// same run. Only images: a PDF is already a whole document. Only jobs never grouped and never
// attempted: a head that failed retryably is back in the queue with its group intact.
async function _groupQueuedJobs() {
    // Grouping is a convenience for the reader; a claim must never fail because of it.
    let client;
    try { client = await pool.connect(); }
    catch (err) { _logError('_groupQueuedJobs could not take a connection', err); return; }
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT j.id, j.user_id, j.created_at
               FROM doc_extraction_jobs j
               JOIN health_documents d ON d.id = j.document_id
              WHERE j.status = 'queued' AND j.group_uid IS NULL AND j.attempts = 0
                AND d.status = 'active' AND d.content_type LIKE 'image/%'
              ORDER BY j.user_id, j.created_at
              FOR UPDATE OF j SKIP LOCKED`
        );
        const runs = [];
        let run = [];
        for (const r of rows) {
            const prev = run[run.length - 1];
            if (prev && prev.user_id === r.user_id
                && (new Date(r.created_at) - new Date(prev.created_at)) / 1000 <= DOC_GROUP_WINDOW_SECONDS) {
                run.push(r);
            } else {
                if (run.length >= 2) runs.push(run);
                run = [r];
            }
        }
        if (run.length >= 2) runs.push(run);
        for (const pages of runs) {
            const groupUid = crypto.randomUUID();
            const [head, ...members] = pages;
            await client.query(
                `UPDATE doc_extraction_jobs SET group_uid = $2, group_role = 'head', updated_at = NOW() WHERE id = $1`,
                [head.id, groupUid]);
            await client.query(
                `UPDATE doc_extraction_jobs SET group_uid = $2, group_role = 'member', status = 'grouped', updated_at = NOW()
                  WHERE id = ANY($1)`,
                [members.map(m => m.id), groupUid]);
            console.log(JSON.stringify({ level: 'INFO', msg: 'doc_extraction pages grouped', group_uid: groupUid, pages: pages.length }));
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        _logError('_groupQueuedJobs failed', err);
    } finally {
        if (typeof client.release === 'function') client.release();
    }
}

// Every page of a group, head first, in upload order — the documents the agent reads as one.
async function _groupPages(groupUid) {
    const { rows } = await pool.query(
        `SELECT d.id, d.oss_key, d.filename, d.content_type, d.size_bytes, d.etag, d.doc_type,
                d.doc_date::text AS doc_date, d.institution, d.note, d.created_at, j.group_role, j.id AS job_id
           FROM doc_extraction_jobs j JOIN health_documents d ON d.id = j.document_id
          WHERE j.group_uid = $1 AND d.status = 'active'
          ORDER BY (j.group_role = 'head') DESC, j.created_at ASC`,
        [groupUid]);
    return rows;
}

// FOR UPDATE SKIP LOCKED is the correctness core: two pollers hitting this simultaneously get two
// DIFFERENT jobs (or one job and null), never the same row twice. Do not rewrite this as a SELECT
// followed by an UPDATE.
async function handlePostDocExtractClaim(body) {
    try {
        await _sweepExpiredLeases();
        await _groupQueuedJobs();

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
                     ORDER BY priority DESC, created_at ASC
                     FOR UPDATE SKIP LOCKED
                     LIMIT 1
              )
            RETURNING id, job_uid, document_id, user_id, attempts, max_attempts,
                      claim_expires_at, created_at, group_uid`,
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

        // includeReading:false — the agent is about to READ this document; handing it its own
        // previous summary would anchor a re-run on the reading the user is trying to correct.
        const [document] = presignDocuments([doc], DEFAULT_DOC_URL_TTL_SECONDS, { includeReading: false });

        // Contract 4: the whole report when this job is the head of a page group. Page 1 is the
        // head's own document, repeated here so a reader can take `group.pages` as the document.
        let group = null;
        if (job.group_uid) {
            const pages = await _groupPages(job.group_uid);
            const presigned = presignDocuments(pages, DEFAULT_DOC_URL_TTL_SECONDS, { includeReading: false });
            group = {
                group_uid: job.group_uid,
                page_count: presigned.length,
                pages: presigned.map((p, i) => ({ page: i + 1, ...p })),
            };
        }

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
                ...(group ? { group } : {}),
                subject: {
                    ref: job.job_uid,
                    age: user?.birth_date ? calculateAge(user.birth_date) : null,
                    gender: user?.gender || null,
                    language: user?.language || 'zh',
                },
                catalog: await fetchCatalog(),
                // Shipped on every claim, not only for panels we already know are food ones: the
                // agent cannot tell what kind of report it holds until it has read the page.
                food_catalog: await fetchFoodCatalog(),
                // Contract 3: the vocabulary a `tags[].tag_key` must come from.
                tag_catalog: await fetchTagCatalog(),
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

function _resultMessage(language, { docLabel, accepted, findings, unmapped, hasDate,
                                   foodItems = 0, foodRestrictions = [], itemsWritten = 0,
                                   acceptedObservations = 0, structured = false }) {
    const isZh = (language || 'zh') !== 'en';
    // Names the restricted foods rather than counting them: three names are shorter than the
    // sentence describing them, and the whole point of the panel is which foods.
    const foodNames = isZh
        ? foodRestrictions.map(r => r.name_zh).join('、')
        : foodRestrictions.map(r => r.name_en || r.name_zh).join(', ');
    if (isZh) {
        const parts = [`已读取你上传的${docLabel}。`];
        if (foodItems > 0) {
            parts.push(`其中 ${foodItems} 项食物 IgG 结果已记入你的数字孪生「医疗记录」。`);
            if (foodRestrictions.length > 0) {
                parts.push(`有 ${foodRestrictions.length} 项达到慢性食物过敏分级：${foodNames}，已加入你的饮食禁忌，之后的饮食建议和原粒配方都会避开它们。`);
            } else {
                parts.push('没有一项达到慢性食物过敏分级。');
            }
        }
        // Three tiers of "what got kept": catalogued markers (twin panel), the rest of the
        // printed rows (kept by name, in the report), and the structured block. Only when a
        // date could not be resolved is anything actually lost, and that says so — and says
        // what fixes it, because setting the date and re-running is now something the user can do.
        // itemsWritten counts mapped AND unmapped rows; the mapped ones are the validator's
        // accepted count (a deduped event still has its item row), so the remainder is what was
        // kept by name only.
        const unmappedKept = Math.max(0, itemsWritten - acceptedObservations);
        if (accepted > 0) parts.push(`其中 ${accepted} 项指标已记入你的数字孪生「医疗记录」。`);
        else if (foodItems > 0) { /* the panel is the content; saying "no lab markers" would read as a failure */ }
        else if (!hasDate) parts.push('没有找到可识别的报告日期，所以这次只保存了文档信息，没有记录指标。你可以在健康文档里为这份文档设置报告日期后重新解析。');
        else if (unmappedKept > 0) { /* said below */ }
        else if (structured) parts.push('这份文档的内容已按原文结构保存在「医疗记录」里。');
        else parts.push('这份文档里没有可以记录的化验指标。');
        if (unmappedKept > 0) parts.push(`另有 ${unmappedKept} 项暂不在我们的指标库里，已按报告原文保存在这份报告下。`);
        else if (unmapped > 0 && !hasDate) parts.push(`还有 ${unmapped} 项暂不在我们的指标库里，同样需要报告日期才能保存。`);
        if (findings > 0) parts.push(`另外记录了 ${findings} 条个人健康信息（如过敏史、诊断、用药）。`);
        parts.push('如果读取有误，可以在健康文档里重新解析或删除。');
        return parts.join('');
    }
    const parts = [`I've read the ${docLabel} you uploaded.`];
    if (foodItems > 0) {
        parts.push(` ${foodItems} food IgG results were added to your digital twin's Medical Records.`);
        if (foodRestrictions.length > 0) {
            parts.push(` ${foodRestrictions.length} reached a chronic food-sensitivity class: ${foodNames}. They are now in your dietary restrictions, and both food advice and your dots formula will avoid them.`);
        } else {
            parts.push(' None of them reached a chronic food-sensitivity class.');
        }
    }
    const unmappedKept = Math.max(0, itemsWritten - acceptedObservations);
    if (accepted > 0) parts.push(` ${accepted} marker${accepted === 1 ? '' : 's'} were added to your digital twin's Medical Records.`);
    else if (foodItems > 0) { /* the panel is the content here */ }
    else if (!hasDate) parts.push(" I couldn't find a readable report date, so I saved the document details but recorded no markers. You can set the report date in Health Records and re-run.");
    else if (unmappedKept > 0) { /* said below */ }
    else if (structured) parts.push(' Its contents were saved as read into your Medical Records.');
    else parts.push(' There were no lab markers in it to record.');
    if (unmappedKept > 0) parts.push(` ${unmappedKept} more item${unmappedKept === 1 ? ' is' : 's are'} not in our marker library yet and ${unmappedKept === 1 ? 'was' : 'were'} kept as printed under this report.`);
    else if (unmapped > 0 && !hasDate) parts.push(` ${unmapped} item${unmapped === 1 ? '' : 's'} outside our marker library also need${unmapped === 1 ? 's' : ''} a report date to be kept.`);
    if (findings > 0) parts.push(` I also noted ${findings} personal health detail${findings === 1 ? '' : 's'} (such as an allergy).`);
    parts.push(' If anything looks wrong, you can re-run or remove it from Health Records.');
    return parts.join('');
}

const DOC_LABEL = {
    zh: { lab_report: '检验报告', hospital_record: '就医记录', imaging: '影像报告', discharge_summary: '出院小结', prescription: '处方',
          genetic: '基因检测报告', microbiome: '肠道菌群检测报告', functional_test: '功能医学检测报告', other: '健康文档' },
    en: { lab_report: 'lab report', hospital_record: 'hospital record', imaging: 'imaging report', discharge_summary: 'discharge summary', prescription: 'prescription',
          genetic: 'genetic test report', microbiome: 'microbiome test report', functional_test: 'functional test report', other: 'health record' },
};

// health_reports.report_type for an extracted document. lab_report keeps the historical
// 'lab_panel' value the report list has always keyed its badge on; the rest are their own type.
const REPORT_TYPE_BY_DOC_TYPE = { lab_report: 'lab_panel', functional_test: 'functional' };

// One health_report_items row per printed analyte, mapped and unmapped alike, in page order.
// Multi-row VALUES in a single statement: a 74-item panel must not cost 74 round trips.
async function _writeReportItems(reportId, userId, documentId, observations, unmapped, reportDate) {
    const rows = [];
    for (const o of observations) {
        rows.push([o.key_name, o.label || o.key_name, o.value, null, o.unit, o.ref_text || null,
            o.flag || null, o.section || null, o.data_date || reportDate, o.source || null, null, null]);
    }
    for (const u of unmapped) {
        const num = u.value == null ? null : Number(u.value);
        const isNum = u.value != null && /^-?\d+(\.\d+)?$/.test(String(u.value).trim()) && Number.isFinite(num);
        rows.push([null, u.label, isNum ? num : null, isNum ? null : (u.value == null ? null : String(u.value)),
            u.unit || null, u.ref_text || null, u.flag || null, u.section || null, reportDate,
            u.source || null, u.suggested_key || null, u.suggested_confidence == null ? null : u.suggested_confidence]);
    }
    if (rows.length === 0) return 0;
    const params = [reportId, userId, documentId];
    const tuples = rows.map((r, i) => {
        const base = params.length;
        params.push(...r, i);
        return `($1, $2, $3, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::date, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`;
    });
    // One statement, all-or-nothing: it either inserted every row or threw.
    await pool.query(
        `INSERT INTO health_report_items
            (report_id, user_id, source_document_id, key_name, label, value_num, value_text, unit,
             ref_text, flag, section, data_date, source_ref, suggested_key, suggested_confidence, sort_order)
         VALUES ${tuples.join(', ')}`,
        params
    );
    return rows.length;
}

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
            `SELECT id, oss_key, doc_type, doc_date::text AS doc_date, institution, user_edited_at
               FROM health_documents WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [job.document_id, job.user_id]
        );
        if (!doc) return _fail(REASONS.DOCUMENT_NOT_FOUND);

        const { catalog, foodCatalog, tagCatalog } = await fetchAllCatalogs();
        // The row's own date is the fallback for a page with none printed — it is either what
        // the user told us (PATCH) or what an earlier run read. Never today.
        const validated = validateExtraction(body, catalog, foodCatalog,
            { fallbackDocDate: doc.doc_date, tagCatalogRows: tagCatalog });
        const { document, summary, observations, findings, tags, unmapped, structured, rejected, warnings, counts } = validated;

        // ── Tier 1: the document row. Four columns nothing has ever written, so this alone is
        //    what makes the list show 检验报告 / 出院小结 badges and real dates.
        //
        //    A user-edited row keeps its type, date and institution: the agent's reading fills a
        //    blank, it does not out-vote the person who set the date so this run could succeed.
        //    summary and extracted_json are the agent's own and are always replaced.
        const userEdited = doc.user_edited_at != null;
        await pool.query(
            `UPDATE health_documents
                SET doc_type = CASE WHEN $7 THEN doc_type ELSE $2 END,
                    doc_date = CASE WHEN $7 THEN doc_date ELSE COALESCE($3::date, doc_date) END,
                    institution = CASE WHEN $7 THEN institution ELSE COALESCE($4, institution) END,
                    note = COALESCE($5, note),
                    summary = $6,
                    summary_generated_at = CASE WHEN $6::text IS NULL THEN NULL ELSE NOW() END,
                    extracted_json = $8::jsonb,
                    extracted_json_at = CASE WHEN $8::jsonb IS NULL THEN NULL ELSE NOW() END
              WHERE id = $1`,
            [doc.id, document.doc_type, document.doc_date, document.institution, document.note, summary,
             userEdited, structured ? JSON.stringify(structured) : null]
        );
        const effectiveDocType = userEdited ? (doc.doc_type || document.doc_type) : document.doc_type;

        // ── Tier 2: the report — the record of what this document said — through the pipeline
        //    that already exists. Written whenever a date resolved and ANYTHING was read: a
        //    catalogued marker, or a printed row outside the catalog. Before this a NAD+ report
        //    (no catalogued key) left no report at all, and its numbers lived only in the job
        //    JSON that nothing reads.
        const reportDate = document.doc_date || (observations[0] && observations[0].data_date) || doc.doc_date || null;
        let reportId = null;
        let itemsWritten = 0;
        // What the validator ACCEPTED and what was actually PERSISTED are different numbers.
        // health_events dedupes on (user_id, source, external_id), so a marker already recorded for
        // the same day and source is a silent no-op — re-reading the same report, or two documents
        // covering one panel, writes fewer rows than it accepts. The user is told what was
        // recorded, not what was parsed, or a re-upload claims to have added values it did not.
        let written = 0;
        if (reportDate && (observations.length > 0 || unmapped.length > 0)) {
            const reportRes = await handlePostHealthReport({
                user_id: job.user_id,
                report_date: reportDate,
                source: EXTRACTION_SOURCE,
                institution: userEdited ? (doc.institution || document.institution) : document.institution,
                report_type: REPORT_TYPE_BY_DOC_TYPE[effectiveDocType] || effectiveDocType,
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
            if (reportRes?.success) {
                reportId = reportRes.report_id;
                written = reportRes.observations_written ?? observations.length;
                // The printed rows, verbatim, mapped and unmapped alike. A failure here must not
                // roll back the report: the twin feed is already committed and is worth keeping.
                try {
                    itemsWritten = await _writeReportItems(reportId, job.user_id, doc.id, observations, unmapped, reportDate);
                } catch (itemErr) {
                    _logError('doc_extraction items write failed', itemErr, { job_uid: job.job_uid, report_id: reportId });
                }
            }
            else _logError('doc_extraction report write failed', new Error(reportRes?.error || 'unknown'), { job_uid: job.job_uid });
        }

        // ── Tier 3: tags → health_document_tags, then the user's managed memory facts are
        //    re-derived (lib/documentTags.js). Under contract 2 `findings` went straight into
        //    user_memory_facts and two live runs wrote six false allergies that way; now only a
        //    FACT — a key in tag_catalog, status current, catalog row with a memory_category —
        //    reaches a prompt or a filter. A finding is a descriptor: stored, shown, inert.
        //    Never users.bio_data: those writes are a shallow `||` merge.
        let tagsWritten = 0;
        let factsWritten = 0;
        try {
            tagsWritten = await writeDocumentTags(pool, { userId: job.user_id, documentId: doc.id, tags });
            factsWritten = tags.filter(t => t.kind === 'fact').length;
            await syncMemoryFactsFromTags(pool, job.user_id);
        } catch (tagErr) {
            _logError('doc_extraction tags write failed', tagErr, { job_uid: job.job_uid });
        }

        // ── Tier 4: a chronic food-sensitivity (IgG) panel and the guideline derived from it
        //    (CLAUDE.md §40). Its own tables, never health_events(lab_result) — 120 food titres
        //    dated after the user's 体检 would replace their clinical panel in
        //    health_twin.latest_lab_data, which keeps only the single most recent lab date.
        //
        //    THE GUIDELINE IS DERIVED HERE, NOT SUBMITTED. What a class means is printed in the
        //    report (停止摄食1个月 / 2个月 / 3-6个月), so lib/foodSensitivity.js transcribes it.
        //    An external agent may narrate a panel; it may not decide what the user is told to
        //    stop eating.
        let foodPanelId = null;
        let foodRestrictions = [];
        if (validated.food_sensitivity && validated.food_sensitivity.panel
            && validated.food_sensitivity.items.length > 0) {
            try {
                const fs = validated.food_sensitivity;
                const { rows: panelRows } = await pool.query(
                    `INSERT INTO food_sensitivity_panels
                        (user_id, source_document_id, panel_key, unit, sampled_at, report_date,
                         institution, sample_no, class_bands)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                    [job.user_id, doc.id, fs.panel.panel_key, fs.panel.unit, fs.panel.sampled_at,
                     fs.panel.report_date, fs.panel.institution || document.institution,
                     fs.panel.sample_no, JSON.stringify(fs.panel.class_bands)]
                );
                foodPanelId = Number(panelRows[0].id);

                for (const it of fs.items) {
                    await pool.query(
                        `INSERT INTO food_sensitivity_results
                            (panel_id, user_id, food_key, value, below_detection, class)
                         VALUES ($1,$2,$3,$4,$5,$6)
                         ON CONFLICT (panel_id, food_key) DO NOTHING`,
                        [foodPanelId, job.user_id, it.food_key, it.value, it.below_detection, it.class]
                    );
                }

                const guideline = deriveFoodGuideline(fs, foodCatalog);
                foodRestrictions = guideline.restrictions;

                // Restrictions carry food_key, which is what keeps them OUT of
                // formulationQuality's prose matcher — see migration_user_memory_facts_food.sql.
                // Same per-fact try/catch as tier 3: one bad row must not abort the batch.
                for (const f of guideline.facts) {
                    try {
                        await pool.query(
                            `INSERT INTO user_memory_facts
                                (user_id, category, fact_zh, source, source_document_id,
                                 severity, valid_until, food_key)
                             VALUES ($1,$2,$3,'document_extracted',$4,$5,$6,$7)
                             ON CONFLICT (user_id, category, fact_zh) WHERE status = 'active'
                             DO UPDATE SET last_mentioned_at = CURRENT_TIMESTAMP,
                                           updated_at = CURRENT_TIMESTAMP,
                                           severity = EXCLUDED.severity,
                                           valid_until = EXCLUDED.valid_until,
                                           food_key = EXCLUDED.food_key,
                                           source_document_id = EXCLUDED.source_document_id`,
                            [job.user_id, f.category, f.fact_zh, doc.id, f.severity, f.valid_until, f.food_key]
                        );
                    } catch (factErr) {
                        _logError('doc_extraction food fact write failed', factErr,
                            { job_uid: job.job_uid, food_key: f.food_key });
                    }
                }
            } catch (panelErr) {
                // The observations, findings and summary are already committed and are worth
                // keeping. A failed panel is reported, not rolled back over the rest.
                _logError('doc_extraction food panel write failed', panelErr, { job_uid: job.job_uid });
                foodPanelId = null;
            }

            // A free deep review of the panel, on a scoped Viva AG grant (§40). Awaited so it
            // actually runs — FC 3.0 freezes the context on return — but its result is ignored:
            // the restrictions are already written, so a review that cannot be queued (the user
            // is not on Viva, has something else in flight, or is at their daily cap) costs an
            // explanation and never the guideline. Required at call time to keep the AG module
            // off this path's warm-container load.
            if (foodPanelId) {
                try {
                    const { enqueueFoodSensitivityReview } = require('./viva_ag');
                    const queued = await enqueueFoodSensitivityReview(job.user_id, { language: job.language });
                    console.log(JSON.stringify({ level: 'INFO', msg: 'food_sensitivity_review_enqueue',
                        job_uid: job.job_uid, ...queued }));
                } catch (reviewErr) {
                    _logError('food sensitivity review enqueue failed', reviewErr, { job_uid: job.job_uid });
                }
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
            [job.id, JSON.stringify({ document, summary, observations, findings, tags, unmapped,
                structured, warnings,
                food_sensitivity: validated.food_sensitivity,
                food_restrictions: foodRestrictions,
                counts: { ...counts, observations_written: written, items_written: itemsWritten,
                          tags_written: tagsWritten, facts_written: factsWritten, food_panel_id: foodPanelId } }),
                JSON.stringify(rejected), reportId]
        );

        // Contract 4: the pages read with this one. Each member document takes the head's type,
        // date and institution (unless the person set them), a summary that says which page of
        // what it is, and a structured pointer at the head; each member job closes as completed
        // with the head's job_uid in its result. One report row, under the head; one message.
        let pagesClosed = 0;
        if (job.group_uid) {
            const pages = await _groupPages(job.group_uid);
            const total = pages.length;
            for (let i = 0; i < pages.length; i++) {
                const p = pages[i];
                if (p.group_role === 'head') continue;
                await pool.query(
                    `UPDATE health_documents
                        SET doc_type = CASE WHEN user_edited_at IS NOT NULL THEN doc_type ELSE $2 END,
                            doc_date = CASE WHEN user_edited_at IS NOT NULL THEN doc_date ELSE COALESCE($3::date, doc_date) END,
                            institution = CASE WHEN user_edited_at IS NOT NULL THEN institution ELSE COALESCE($4, institution) END,
                            summary = $5, summary_generated_at = NOW(),
                            extracted_json = $6::jsonb, extracted_json_at = NOW()
                      WHERE id = $1`,
                    [p.id, effectiveDocType, reportDate, document.institution,
                     `第 ${i + 1} 页，共 ${total} 页 · 已与第 1 页合并解析`,
                     JSON.stringify({ version: 2, grouped_into: doc.id, page: i + 1, of: total })]
                );
                await pool.query(
                    `UPDATE doc_extraction_jobs
                        SET status = 'completed', completed_at = NOW(), result = $2, health_report_id = $3,
                            result_token = NULL, updated_at = NOW()
                      WHERE id = $1 AND status = 'grouped'`,
                    [p.job_id, JSON.stringify({ grouped_into: job.job_uid, page: i + 1, of: total }), reportId]
                );
                pagesClosed += 1;
            }
        }

        // Delivery failure must never make the agent think its work was rejected and retry the
        // whole extraction — the writes above are already committed.
        try {
            const lang = (job.language || 'zh') === 'en' ? 'en' : 'zh';
            const text = _resultMessage(job.language, {
                docLabel: DOC_LABEL[lang][effectiveDocType] || DOC_LABEL[lang].other,
                accepted: written,
                findings: factsWritten,
                unmapped: unmapped.length,
                hasDate: !!reportDate,
                foodItems: validated.food_sensitivity?.items.length || 0,
                foodRestrictions,
                itemsWritten,
                acceptedObservations: observations.length,
                structured: !!structured,
            });
            const ids = await deliverTerminalMessage(job.user_id, job.persona_type || 'viva', NOTIFY_RESULT, text, CHAT_SOURCE);
            await pool.query(
                `UPDATE doc_extraction_jobs SET notification_id = $2, chat_message_id = $3, delivered_at = NOW() WHERE id = $1`,
                [job.id, ids.notification_id, ids.chat_message_id]
            );
        } catch (deliverErr) {
            _logError('doc_extraction delivery failed', deliverErr, { job_uid: job.job_uid });
        }

        console.log(JSON.stringify({ level: 'INFO', msg: 'doc_extraction completed', job_uid: job.job_uid, ...counts, report_id: reportId, pages_closed: pagesClosed }));
        return {
            success: true,
            job_uid: job.job_uid,
            report_id: reportId == null ? null : Number(reportId),
            accepted: { ...counts, observations_written: written, items_written: itemsWritten,
                        tags_written: tagsWritten, facts_written: factsWritten,
                        food_panel_id: foodPanelId, food_restrictions: foodRestrictions.length },
            rejected,
            warnings,
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
        // A head that dies terminally takes its pages with it: a grouped member is not
        // claimable on its own and would otherwise sit in 'grouped' forever. A retryable
        // failure leaves the group intact for the next attempt.
        if (!retryable && job.group_uid) {
            await pool.query(
                `UPDATE doc_extraction_jobs
                    SET status = 'failed', error_reason = 'group_head_failed', completed_at = NOW(), updated_at = NOW()
                  WHERE group_uid = $1 AND status = 'grouped'`,
                [job.group_uid]);
        }
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
    fetchTagCatalog,
    // For tests and docs
    REASONS,
    EXTRACTION_SOURCE,
    NOTIFY_RESULT,
    CONTRACT_VERSION,
    DEFAULT_LEASE_SECONDS,
    MIN_LEASE_SECONDS,
    MAX_LEASE_SECONDS,
};
