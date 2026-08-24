'use strict';

/**
 * Viva AG (Advanced Generation) — job queue for the external advanced-analysis agent.
 *
 * Two audiences share this file:
 *
 *   USER-FACING (app bearer + ?openid=, entitlement-checked): enqueue, list, detail, cancel.
 *   EXTERNAL AGENT (VIVA_AG_API_TOKEN + a per-job fencing token): claim, twin-bundle,
 *       document-url, heartbeat, result-upload-url, result, fail.
 *
 * Design notes that are easy to undo by accident:
 *
 *   - No EventBridge. The long work happens entirely inside the external agent's own process,
 *     so nano never has a request to keep alive. CLAUDE.md 22's CloudEvent machinery exists
 *     only because FC cancels invocations on client disconnect; that pressure doesn't exist
 *     here, and publishing an event would add shared dev/prod bus leak risk for nothing.
 *   - No cron. Lease expiry is swept lazily at the top of the claim handler and the user's job
 *     list. If the agent stops polling AND no user opens the AG subtab, an expired lease sits
 *     until someone touches the queue — accepted for v1.
 *   - No user_id/openid is EVER returned by an external-facing response. job_uid is the only
 *     handle the agent gets, so a leaked API token cannot enumerate users.
 *   - result_token is a FENCING token, rotated on every claim. It is simultaneously the
 *     submission credential and the idempotency key: a worker whose lease expired and was
 *     re-claimed holds a stale token and is rejected, so two workers can never both write a
 *     result. Nothing else is needed to make submission idempotent.
 *   - Routine failures return {success:false, reason:'snake_case'} at HTTP 200, per the GCN
 *     convention (CLAUDE.md 31). Callers branch on `reason`, never on a status code.
 */

const crypto = require('crypto');
const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { requireVivaAgAccess } = require('../lib/vivaAgAccess');
const { buildTwinBundle, presignDocuments, fetchHealthDocuments, BUNDLE_VERSION, DEFAULT_DOC_URL_TTL_SECONDS, clampInt } = require('../lib/twinBundle');
const { deliverTerminalMessage } = require('./chat');
const { formatToShanghai } = require('../lib/time-utils');

// ---------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------

const VALID_COMMAND_KEYS = new Set(['full_analysis', 'document_review', 'risk_screen']);
const MAX_COMMAND_LENGTH = 2000;
const MAX_SUMMARY_LENGTH = 4000;
const MAX_RESULT_BYTES = 512 * 1024;

// One in-flight job per user is enforced by uniq_viva_ag_jobs_active; this caps total volume on
// top of that, since each external run is expensive.
//
// Read from env so each environment can set its own — a hardcoded bound made the feature
// untestable after three runs (hit live on dev 2026-08-23). Same reasoning as
// CHAT_DELIVER_DEADLINE_MS in handlers/chat.js. Currently: dev 50, prod 10, code default 3.
const MAX_JOBS_PER_DAY = parseInt(process.env.VIVA_AG_MAX_JOBS_PER_DAY || '3', 10);

const DEFAULT_LEASE_SECONDS = 3600;
const MIN_LEASE_SECONDS = 60;
const MAX_LEASE_SECONDS = 6 * 3600;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

// Result-artifact types the agent may upload. Deliberately narrow: the miniapp is the only
// consumer, and it can only present two shapes — a document wx.openDocument can open, or text
// it can render itself. Accepting a .zip nano could never show the user would be a worse
// contract than rejecting it at upload time with unsupported_file_type.
const RESULT_CONTENT_TYPES = {
    pdf: 'application/pdf',
    md: 'text/markdown; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
};

// A job may carry several artifacts (typically a rendered PDF plus its .md source). Bounded so a
// misbehaving agent can't attach a hundred files to one job's detail sheet.
const MAX_RESULT_FILES = 5;

// Ordering used when picking which file fills the legacy single-file result_oss_key column, and
// the order files are shown in. A PDF is what a user wants to open first.
const RESULT_EXT_RANK = { pdf: 0, md: 1, txt: 2 };

const NOTIFY_RESULT = 'viva_ag_result';
const NOTIFY_FAILED = 'viva_ag_failed';

// Written to chat_messages.source so the chat can attribute these to Viva AG rather than Viva.
// persona_type stays 'viva' — see migration_chat_messages_source.sql for why it has to.
const CHAT_SOURCE = 'viva_ag';

const REASONS = {
    MISSING_PARAMS: 'missing_params',
    JOB_NOT_FOUND: 'job_not_found',
    INVALID_TOKEN: 'invalid_token',
    LEASE_EXPIRED: 'lease_expired',
    JOB_NOT_CLAIMABLE: 'job_not_claimable',
    JOB_ALREADY_COMPLETED: 'job_already_completed',
    JOB_ALREADY_ACTIVE: 'job_already_active',
    DAILY_LIMIT_REACHED: 'daily_limit_reached',
    DOCUMENT_NOT_FOUND: 'document_not_found',
    RESULT_TOO_LARGE: 'result_too_large',
    INVALID_RESULT_KEY: 'invalid_result_key',
    UNSUPPORTED_FILE_TYPE: 'unsupported_file_type',
    RESULT_FILE_MISSING: 'result_file_missing',
    TOO_MANY_RESULT_FILES: 'too_many_result_files',
    INTERNAL_ERROR: 'internal_error',
};

function _fail(reason, error) {
    return { success: false, reason, error: error || reason };
}

function _resultKeyPrefix(jobUid) {
    return `viva-ag-results/${jobUid}/`;
}

function _logError(msg, err, extra = {}) {
    console.error(JSON.stringify({ level: 'ERROR', msg, error: err.message, ...extra }));
}

// ---------------------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------------------

// Lazy lease sweep — the reason this queue needs no scheduler. Runs at the top of claim (and
// the user's job list, so a user watching their own stuck job also unsticks it).
//
// Two separate statements on purpose: a job with attempts left goes back on the queue, one out
// of attempts terminally fails AND owes its user a chat message, so it has to be RETURNINGed.
async function _sweepExpiredLeases() {
    try {
        await pool.query(
            `UPDATE viva_ag_jobs
                SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
                    claim_expires_at = NULL, result_token = NULL, updated_at = NOW()
              WHERE status IN ('claimed','processing')
                AND claim_expires_at < NOW()
                AND attempts < max_attempts`
        );
        const { rows: dead } = await pool.query(
            `UPDATE viva_ag_jobs
                SET status = 'failed', error_reason = 'lease_expired_max_attempts',
                    completed_at = NOW(), updated_at = NOW()
              WHERE status IN ('claimed','processing')
                AND claim_expires_at < NOW()
                AND attempts >= max_attempts
            RETURNING id, job_uid, user_id, persona_type, language`
        );
        for (const job of dead) {
            await _deliverFailure(job, 'lease_expired_max_attempts');
        }
    } catch (err) {
        // A failed sweep must never block a claim — the next tick retries it.
        _logError('viva_ag lease sweep failed', err);
    }
}

function _failureMessage(language, reason) {
    const isZh = (language || 'zh') !== 'en';
    if (isZh) {
        return reason === 'lease_expired_max_attempts'
            ? '抱歉，这次深度分析没能完成（处理超时）。您可以重新发起一次。'
            : '抱歉，这次深度分析没能完成。您可以重新发起一次。';
    }
    return reason === 'lease_expired_max_attempts'
        ? "Sorry — this deep analysis didn't finish in time. You can start a new one."
        : "Sorry — this deep analysis didn't complete. You can start a new one.";
}

async function _deliverFailure(job, reason) {
    try {
        const text = _failureMessage(job.language, reason);
        const ids = await deliverTerminalMessage(job.user_id, job.persona_type || 'viva', NOTIFY_FAILED, text, CHAT_SOURCE);
        await pool.query(
            `UPDATE viva_ag_jobs SET notification_id = $2, chat_message_id = $3, delivered_at = NOW() WHERE id = $1`,
            [job.id, ids.notification_id, ids.chat_message_id]
        );
    } catch (err) {
        _logError('viva_ag failure delivery failed', err, { job_uid: job.job_uid });
    }
}

// The external agent's summary text becomes a chat bubble the user reads as Viva speaking, and
// when rich_format is on the miniapp renderer interprets ::: display-card fences
// (prompts/chat/outputFormat.js). An external system writing raw ::: into a bubble is therefore
// a render-injection surface, so the fences are stripped rather than trusted.
function _sanitizeSummary(raw) {
    let text = String(raw || '').trim();
    text = text.replace(/^:::.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > MAX_SUMMARY_LENGTH) text = text.slice(0, MAX_SUMMARY_LENGTH).trim();
    return text;
}

// The client references result artifacts by INDEX, never by oss_key — the key is the only thing
// standing between a signed URL and someone else's medical report, so it never leaves the server.
// Legacy rows (written before result_files existed) still surface their single file here.
function _publicResultFiles(row) {
    const files = Array.isArray(row.result_files) ? row.result_files : null;
    if (files && files.length) {
        return files.map((f, index) => ({
            index,
            filename: f.filename || `report.${f.ext || 'bin'}`,
            ext: f.ext || null,
            size_bytes: f.size_bytes ?? null,
        }));
    }
    if (row.result_oss_key) {
        const ext = row.result_oss_key.split('.').pop().toLowerCase();
        return [{ index: 0, filename: `report.${ext}`, ext, size_bytes: null }];
    }
    return [];
}

function _publicJob(row) {
    const resultFiles = _publicResultFiles(row);
    return {
        job_uid: row.job_uid,
        command: row.command,
        command_key: row.command_key,
        status: row.status,
        progress_note: row.progress_note,
        attempts: row.attempts,
        created_at: formatToShanghai(row.created_at),
        started_at: row.started_at ? formatToShanghai(row.started_at) : null,
        completed_at: row.completed_at ? formatToShanghai(row.completed_at) : null,
        result_summary: row.result_summary || null,
        has_result_file: resultFiles.length > 0,
        result_files: resultFiles,
        error_reason: row.error_reason || null,
        document_count: Array.isArray(row.document_ids) ? row.document_ids.length : 0,
    };
}

// Loads a job by its external handle and validates the caller's fencing token. Used by every
// external endpoint that operates on a claimed job.
async function _loadClaimedJob(jobUid, token, { allowCompleted = false } = {}) {
    if (!jobUid || !token) return { error: _fail(REASONS.MISSING_PARAMS, 'job_uid and result_token are required') };
    const { rows: [job] } = await pool.query('SELECT * FROM viva_ag_jobs WHERE job_uid = $1', [jobUid]);
    if (!job) return { error: _fail(REASONS.JOB_NOT_FOUND) };
    // Token check BEFORE the status check: a stale-lease worker should learn its token is dead,
    // not that the job it thinks it owns is in some other state.
    if (!job.result_token || job.result_token !== token) return { error: _fail(REASONS.INVALID_TOKEN), job };
    if (allowCompleted && job.status === 'completed') return { job, alreadyCompleted: true };
    if (!['claimed', 'processing'].includes(job.status)) {
        return { error: _fail(TERMINAL_STATUSES.has(job.status) ? REASONS.JOB_ALREADY_COMPLETED : REASONS.JOB_NOT_CLAIMABLE), job };
    }
    if (job.claim_expires_at && new Date(job.claim_expires_at) < new Date()) {
        return { error: _fail(REASONS.LEASE_EXPIRED), job };
    }
    return { job };
}

// ---------------------------------------------------------------------------------------
// User-facing endpoints (app bearer + ?openid=)
// ---------------------------------------------------------------------------------------

async function handlePostVivaAgJob(body) {
    try {
        const gate = await requireVivaAgAccess(body?.openid);
        if (!gate.ok) return gate.error;
        const user = gate.user;

        const command = String(body?.command || '').trim();
        const commandKey = VALID_COMMAND_KEYS.has(body?.command_key) ? body.command_key : null;
        if (!command && !commandKey) return _fail(REASONS.MISSING_PARAMS, 'command or command_key is required');
        if (command.length > MAX_COMMAND_LENGTH) {
            return _fail(REASONS.MISSING_PARAMS, `command must be under ${MAX_COMMAND_LENGTH} characters`);
        }

        const { rows: [{ count }] } = await pool.query(
            `SELECT COUNT(*) FROM viva_ag_jobs WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
            [user.user_id]
        );
        if (parseInt(count, 10) >= MAX_JOBS_PER_DAY) {
            return { ..._fail(REASONS.DAILY_LIMIT_REACHED, `At most ${MAX_JOBS_PER_DAY} analyses per day`), limit: MAX_JOBS_PER_DAY };
        }

        // Snapshot which documents this job covers, so later uploads/deletes can't change what
        // the agent was asked to analyze halfway through.
        const docs = await fetchHealthDocuments(pool, user.user_id, null);
        const documentIds = docs.map(d => Number(d.id));

        const jobUid = crypto.randomUUID();
        try {
            const { rows: [job] } = await pool.query(
                `INSERT INTO viva_ag_jobs
                    (job_uid, user_id, channel_id, persona_type, language, command_key, command, params, document_ids)
                 VALUES ($1,$2,$3,'viva',$4,$5,$6,$7,$8)
                 RETURNING *`,
                [jobUid, user.user_id, user.channel_id, user.language || 'zh', commandKey,
                 command || commandKey, body?.params || {}, documentIds]
            );
            return { success: true, job: _publicJob(job) };
        } catch (err) {
            // uniq_viva_ag_jobs_active — the user already has something in flight. A routine
            // condition (double-tap, or they forgot), not a 500.
            if (err.code === '23505') return _fail(REASONS.JOB_ALREADY_ACTIVE, 'An analysis is already running');
            throw err;
        }
    } catch (err) {
        _logError('handlePostVivaAgJob failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

async function handleGetVivaAgJobs(query) {
    try {
        const gate = await requireVivaAgAccess(query?.openid);
        if (!gate.ok) return gate.error;
        // Sweeping here too means a user staring at their own stuck job unsticks it, without a
        // cron and without the external agent having to poll.
        await _sweepExpiredLeases();
        const limit = clampInt(query?.limit, 20, 1, 50);
        const { rows } = await pool.query(
            `SELECT * FROM viva_ag_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
            [gate.user.user_id, limit]
        );
        const { rows: [{ count: todayCount }] } = await pool.query(
            `SELECT COUNT(*) FROM viva_ag_jobs WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
            [gate.user.user_id]
        );
        const usedToday = parseInt(todayCount, 10);
        return {
            success: true,
            jobs: rows.map(_publicJob),
            viva_ag_expires_at: gate.user.viva_ag_expires_at,
            has_active: rows.some(r => !TERMINAL_STATUSES.has(r.status)),
            // Lets the panel disable submit and say why BEFORE the user writes a request that
            // would just be rejected.
            daily_limit: MAX_JOBS_PER_DAY,
            daily_used: usedToday,
            daily_limit_reached: usedToday >= MAX_JOBS_PER_DAY,
        };
    } catch (err) {
        _logError('handleGetVivaAgJobs failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

async function handleGetVivaAgJobDetail(query) {
    try {
        const gate = await requireVivaAgAccess(query?.openid);
        if (!gate.ok) return gate.error;
        const { rows: [job] } = await pool.query(
            `SELECT * FROM viva_ag_jobs WHERE job_uid = $1 AND user_id = $2`,
            [query?.job_uid, gate.user.user_id]
        );
        if (!job) return _fail(REASONS.JOB_NOT_FOUND);
        return { success: true, job: { ..._publicJob(job), result: job.result || null } };
    } catch (err) {
        _logError('handleGetVivaAgJobDetail failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

async function handlePostVivaAgJobCancel(body) {
    try {
        const gate = await requireVivaAgAccess(body?.openid);
        if (!gate.ok) return gate.error;
        // Only a job that hasn't been picked up yet. Once an external worker holds the lease,
        // cancelling here would leave it working on something nobody will accept — let it
        // finish or let the lease expire.
        const { rowCount } = await pool.query(
            `UPDATE viva_ag_jobs SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
              WHERE job_uid = $1 AND user_id = $2 AND status = 'queued'`,
            [body?.job_uid, gate.user.user_id]
        );
        if (rowCount === 0) return _fail(REASONS.JOB_NOT_CLAIMABLE, 'Only a queued job can be cancelled');
        return { success: true };
    } catch (err) {
        _logError('handlePostVivaAgJobCancel failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// Short-lived signed URL for the long-form artifact the agent uploaded, for the AG subtab's
// download button.
async function handleGetVivaAgResultUrl(query) {
    try {
        const gate = await requireVivaAgAccess(query?.openid);
        if (!gate.ok) return gate.error;
        const { rows: [job] } = await pool.query(
            `SELECT job_uid, result_oss_key, result_files FROM viva_ag_jobs WHERE job_uid = $1 AND user_id = $2`,
            [query?.job_uid, gate.user.user_id]
        );
        if (!job) return _fail(REASONS.JOB_NOT_FOUND);

        // Files are addressed by index (see _publicResultFiles). Index 0 with no explicit
        // parameter is exactly the old single-file behaviour, so the previous caller shape works
        // unchanged against both new and legacy rows.
        const files = Array.isArray(job.result_files) && job.result_files.length
            ? job.result_files
            : (job.result_oss_key ? [{ oss_key: job.result_oss_key }] : []);
        if (!files.length) return _fail(REASONS.DOCUMENT_NOT_FOUND, 'This analysis has no attached file');
        const index = clampInt(query?.index, 0, 0, files.length - 1);
        const file = files[index];
        const ext = (file.ext || file.oss_key.split('.').pop() || 'bin').toLowerCase();
        const filename = file.filename || `viva-ag-${job.job_uid.slice(0, 8)}.${ext}`;
        return {
            success: true,
            url: ossLib.generatePresignedGetUrl(file.oss_key, 300, null, null, { filename }),
            expires_in: 300,
            file_type: ext,
            filename,
            size_bytes: file.size_bytes ?? null,
            index,
        };
    } catch (err) {
        _logError('handleGetVivaAgResultUrl failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// ---------------------------------------------------------------------------------------
// External agent endpoints (VIVA_AG_API_TOKEN + per-job fencing token)
//
// None of these are entitlement-checked: they are job-scoped, and a job can only be created by
// an entitled user in the first place. None of them return a user_id, openid, nickname or
// phone — job_uid is the only handle, so a leaked token cannot enumerate users.
// ---------------------------------------------------------------------------------------

async function handleGetVivaAgPing() {
    try {
        const { rows: [{ count }] } = await pool.query(
            `SELECT COUNT(*) FROM viva_ag_jobs WHERE status = 'queued'`
        );
        return {
            success: true,
            service: 'viva-ag',
            // EVENT_SOURCE_SUFFIX is '.dev' on dev and unset on prod — the one env marker the
            // worker already carries. Lets an operator confirm which environment their token
            // reached before running anything against real users.
            env: process.env.EVENT_SOURCE_SUFFIX ? 'dev' : 'prod',
            bundle_version: BUNDLE_VERSION,
            queue_depth: parseInt(count, 10),
            server_time: formatToShanghai(new Date()),
        };
    } catch (err) {
        _logError('handleGetVivaAgPing failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// Atomically claims the head of the queue.
//
// FOR UPDATE SKIP LOCKED is the correctness core: two pollers hitting this simultaneously get
// two DIFFERENT jobs (or one job and null), never the same row twice. Do not rewrite this as a
// SELECT followed by an UPDATE.
async function handlePostVivaAgClaim(body) {
    try {
        await _sweepExpiredLeases();

        const workerId = String(body?.worker_id || '').trim().slice(0, 120) || 'unknown';
        const leaseSeconds = clampInt(body?.lease_seconds, DEFAULT_LEASE_SECONDS, MIN_LEASE_SECONDS, MAX_LEASE_SECONDS);
        // Minted in Node rather than SQL: gen_random_bytes() needs pgcrypto, and this cluster is
        // shared with GCN (CLAUDE.md 32) — not somewhere to add an extension for convenience.
        const resultToken = crypto.randomBytes(24).toString('hex');

        const { rows: [job] } = await pool.query(
            `UPDATE viva_ag_jobs
                SET status = 'claimed', claimed_by = $1, claimed_at = NOW(), heartbeat_at = NOW(),
                    claim_expires_at = NOW() + ($2 || ' seconds')::interval,
                    attempts = attempts + 1, result_token = $3, updated_at = NOW()
              WHERE id = (
                    SELECT id FROM viva_ag_jobs
                     WHERE status = 'queued'
                     ORDER BY priority DESC, created_at ASC
                     FOR UPDATE SKIP LOCKED
                     LIMIT 1
              )
            RETURNING job_uid, command, command_key, params, attempts, max_attempts,
                      claim_expires_at, created_at, document_ids`,
            [workerId, String(leaseSeconds), resultToken]
        );
        if (!job) return { success: true, job: null };

        console.log(JSON.stringify({ level: 'INFO', msg: 'viva_ag job claimed', job_uid: job.job_uid, worker_id: workerId, attempt: job.attempts }));
        return {
            success: true,
            job: {
                job_uid: job.job_uid,
                command: job.command,
                command_key: job.command_key,
                params: job.params || {},
                attempt: job.attempts,
                max_attempts: job.max_attempts,
                queued_at: formatToShanghai(job.created_at),
                lease_expires_at: formatToShanghai(job.claim_expires_at),
                result_token: resultToken,
                document_count: Array.isArray(job.document_ids) ? job.document_ids.length : 0,
                twin_bundle_url: `/api/viva-ag/twin-bundle?job_uid=${encodeURIComponent(job.job_uid)}`,
            },
        };
    } catch (err) {
        _logError('handlePostVivaAgClaim failed', err);
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// The full digital twin for one job's subject. First call flips the job to 'processing'.
async function handleGetVivaAgTwinBundle(query, jobToken) {
    try {
        const { error, job } = await _loadClaimedJob(query?.job_uid, jobToken);
        if (error) return error;

        await pool.query(
            `UPDATE viva_ag_jobs SET status = 'processing', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
              WHERE id = $1`,
            [job.id]
        );

        const { rows: [user] } = await pool.query(
            `SELECT user_id, nickname, gender, birth_date, language, bio_data FROM users WHERE user_id = $1`,
            [job.user_id]
        );
        if (!user) return _fail(REASONS.JOB_NOT_FOUND, 'Job subject no longer exists');

        const bundle = await buildTwinBundle(pool, {
            user,
            ref: job.job_uid,
            documentIds: job.document_ids,
            urlTtlSeconds: DEFAULT_DOC_URL_TTL_SECONDS,
        });

        return {
            success: true,
            ...bundle,
            job: { job_uid: job.job_uid, command: job.command, command_key: job.command_key, params: job.params || {} },
        };
    } catch (err) {
        _logError('handleGetVivaAgTwinBundle failed', err, { job_uid: query?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// Re-mints a document URL. Exists so a job that runs for hours — or has to resume a large,
// partially-downloaded PDF — never dies on an expired signature.
async function handleGetVivaAgDocumentUrl(query, jobToken) {
    try {
        const { error, job } = await _loadClaimedJob(query?.job_uid, jobToken);
        if (error) return error;

        const documentId = parseInt(query?.document_id, 10);
        if (!documentId) return _fail(REASONS.MISSING_PARAMS, 'document_id is required');
        // Scoped to the job's own subject AND its document snapshot: a job cannot reach a
        // document that was uploaded after it was enqueued, or one belonging to anyone else.
        if (Array.isArray(job.document_ids) && job.document_ids.length > 0
            && !job.document_ids.map(Number).includes(documentId)) {
            return _fail(REASONS.DOCUMENT_NOT_FOUND);
        }
        const { rows: [doc] } = await pool.query(
            `SELECT *, doc_date::text AS doc_date FROM health_documents
              WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [documentId, job.user_id]
        );
        if (!doc) return _fail(REASONS.DOCUMENT_NOT_FOUND);

        const [entry] = presignDocuments([doc], DEFAULT_DOC_URL_TTL_SECONDS);
        return { success: true, ...entry };
    } catch (err) {
        _logError('handleGetVivaAgDocumentUrl failed', err, { job_uid: query?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// ---------------------------------------------------------------------------------------
// Paginated resource endpoints
//
// The twin bundle is a digest; these serve the bulk history it deliberately does not inline.
// The bundle's `inventory` block tells the worker what exists and over what period, so it can
// decide what to pull instead of probing — and "fetch everything" is just paging to the end.
//
// Keyset pagination on (timestamp, id), not OFFSET: rows are append-only and a worker paging a
// long history while new data arrives would silently skip or repeat rows under OFFSET. The
// cursor is opaque so the scheme can change without breaking a client that stored one.
// ---------------------------------------------------------------------------------------

const PAGE_DEFAULT = 200;
const PAGE_MAX = 1000;

// Chat is opt-in per job AND windowed by default. The twin bundle is deliberately pseudonymous
// (no name, phone or user_id anywhere), and transcripts routinely contain names, family details
// and locations — so pulling one is a deliberate act by the worker rather than something every
// job receives by default. `days` can be widened, up to the whole history.
const CHAT_DEFAULT_DAYS = 90;

// The cursor carries a SNAPSHOT id as well as the position, which is what makes a full drain
// consistent.
//
// These tables are append-only but not append-in-order: a ring sync writes a batch of events
// stamped with the times the measurements were TAKEN, which can be hours old. Paging on
// recorded_at alone, a row inserted mid-drain and backdated to a point the cursor has already
// passed is skipped forever — observed live, a 3523-row drain returning 3522 while the ring was
// syncing. Pinning `id <= snapshot` (ids are monotonic, timestamps are not) excludes everything
// written after the drain began, so the worker reads one coherent snapshot and picks up newer
// rows on its next drain instead of silently losing them.
// The position timestamp is carried as Postgres's OWN text rendering and never round-tripped
// through a JS Date.
//
// timestamptz holds microseconds; JS Date holds milliseconds. Encoding a cursor from the Date
// the pg driver hands back silently truncates, so the next page asks for rows strictly older
// than a value slightly EARLIER than the row we actually stopped at — and any row sharing that
// millisecond but carrying nonzero microseconds is excluded forever. Observed live: a 3523-row
// drain returned 3522, losing exactly one row (recorded_at ...18.054021, truncated to ...18.054)
// that happened to sit on a page boundary. Invisible unless a sub-millisecond row lands there,
// which is why it survived earlier full-drain tests.
//
// Every query therefore selects its sort key a second time as `cursor_ts` text, and the
// comparison casts back with $n::timestamptz. Do not "simplify" this to a Date.
function _encodeCursor(snapshot, cursorTs, id) {
    return Buffer.from(`${snapshot}|${cursorTs}|${id}`).toString('base64url');
}

function _decodeCursor(cursor) {
    if (!cursor) return null;
    try {
        const [snapshot, ts, id] = Buffer.from(String(cursor), 'base64url').toString('utf8').split('|');
        if (!ts || !id || !snapshot) return null;
        // Kept as text; Postgres parses it with full precision via ::timestamptz.
        return { snapshot, ts, id };
    } catch (err) {
        return null;
    }
}

// Highest existing id for this user in `table` — the snapshot ceiling for a fresh drain.
//
// `table` and `extraWhere` are fixed literals chosen by this module, never request data; any
// caller-supplied value goes through `extraParams` so nothing is ever concatenated into SQL.
async function _snapshotId(table, userId, extraWhere = '', extraParams = []) {
    const { rows: [r] } = await pool.query(
        `SELECT COALESCE(MAX(id), 0)::text AS max_id FROM ${table} WHERE user_id = $1 ${extraWhere}`,
        [userId, ...extraParams]
    );
    return r.max_id;
}

// Shared tail: every resource endpoint returns the same envelope so a worker can write one
// paging loop and reuse it for all four.
function _page(rows, limit, snapshot, mapper) {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
        success: true,
        count: page.length,
        has_more: hasMore,
        next_cursor: hasMore && last ? _encodeCursor(snapshot, last.cursor_ts, last.id) : null,
        // Echoed so a worker can log which snapshot a drain corresponds to, and tell whether a
        // later drain would see anything new.
        snapshot_id: String(snapshot),
        items: page.map(mapper),
    };
}

// Validates the job token, then runs `run(job, pool)`. Every resource endpoint is job-scoped in
// exactly the same way the twin bundle is — there is no path to another user's data.
async function _resource(query, jobToken, label, run) {
    try {
        const { error, job } = await _loadClaimedJob(query?.job_uid, jobToken);
        if (error) return error;
        return await run(job);
    } catch (err) {
        _logError(`handleGetVivaAg${label} failed`, err, { job_uid: query?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// Raw wearable/ingested event log — the per-night sleep, per-day activity and vitals series the
// bundle only carries as rolling averages in health_twin. `vitals` outnumbers every other
// category by ~50x, so filtering by category matters; inventory.health_events.by_category tells
// the worker the split up front.
async function handleGetVivaAgHealthEvents(query, jobToken) {
    return _resource(query, jobToken, 'HealthEvents', async (job) => {
        const limit = clampInt(query?.limit, PAGE_DEFAULT, 1, PAGE_MAX);
        const cur = _decodeCursor(query?.cursor);
        const snapshot = cur ? cur.snapshot : await _snapshotId('health_events', job.user_id);
        const params = [job.user_id, snapshot];
        const where = ['user_id = $1', 'id <= $2::bigint'];
        if (query?.category) { params.push(String(query.category)); where.push(`category = $${params.length}`); }
        if (query?.from)     { params.push(String(query.from));     where.push(`recorded_at >= $${params.length}`); }
        if (query?.to)       { params.push(String(query.to));       where.push(`recorded_at <= $${params.length}`); }
        if (cur) { params.push(cur.ts, cur.id); where.push(`(recorded_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`); }
        params.push(limit + 1);
        const { rows } = await pool.query(
            `SELECT id, source, category, data_date::text AS data_date, recorded_at,
                    recorded_at::text AS cursor_ts, data, wearable_name, report_id
             FROM health_events WHERE ${where.join(' AND ')}
             ORDER BY recorded_at DESC, id DESC LIMIT $${params.length}`, params);
        return _page(rows, limit, snapshot, r => ({
            event_id: Number(r.id), source: r.source, category: r.category,
            data_date: r.data_date, recorded_at: formatToShanghai(r.recorded_at),
            wearable_name: r.wearable_name, report_id: r.report_id ? Number(r.report_id) : null,
            data: r.data,
        }));
    });
}

// Lab results from both places they live: parsed health_reports rows (with their observations)
// and health_events(category='lab_result'). The bundle carries only the most recent 30 reports.
async function handleGetVivaAgLabResults(query, jobToken) {
    return _resource(query, jobToken, 'LabResults', async (job) => {
        const limit = clampInt(query?.limit, PAGE_DEFAULT, 1, PAGE_MAX);
        const cur = _decodeCursor(query?.cursor);
        const snapshot = cur ? cur.snapshot : await _snapshotId('health_reports', job.user_id);
        const params = [job.user_id, snapshot];
        const where = ['user_id = $1', 'id <= $2::bigint'];
        if (cur) { params.push(cur.ts, cur.id); where.push(`(COALESCE(report_date::timestamptz, created_at), id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`); }
        params.push(limit + 1);
        const { rows } = await pool.query(
            `SELECT id, report_date::text AS report_date, source, institution, report_type, status,
                    raw_data, created_at,
                    COALESCE(report_date::timestamptz, created_at) AS sort_at,
                    COALESCE(report_date::timestamptz, created_at)::text AS cursor_ts
             FROM health_reports WHERE ${where.join(' AND ')}
             ORDER BY sort_at DESC, id DESC LIMIT $${params.length}`, params);
        const page = _page(rows, limit, snapshot, r => ({
            report_id: Number(r.id), report_date: r.report_date, source: r.source,
            institution: r.institution, report_type: r.report_type, status: r.status,
            // image_url is a 10-year signed link to an OSS object and has no business leaving
            // with a data page; observations are the substance.
            observations: r.raw_data?.observations || [],
            created_at: formatToShanghai(r.created_at),
        }));
        // Only on the first page — this is a convenience join, not a second paginated stream.
        if (!cur) {
            const { rows: ev } = await pool.query(
                `SELECT id, recorded_at, data_date::text AS data_date, source, data
                 FROM health_events WHERE user_id=$1 AND category='lab_result'
                 ORDER BY recorded_at DESC LIMIT 500`, [job.user_id]);
            page.lab_events = ev.map(r => ({
                event_id: Number(r.id), recorded_at: formatToShanghai(r.recorded_at),
                data_date: r.data_date, source: r.source, data: r.data,
            }));
            page.lab_events_note = 'health_events(category=lab_result), most recent 500. Use /viva-ag/health-events?category=lab_result to page the full set.';
        }
        return page;
    });
}

// Full Kino (or body-composition) series. The bundle caps history at 30 tests.
async function handleGetVivaAgBiomarkerHistory(query, jobToken) {
    return _resource(query, jobToken, 'BiomarkerHistory', async (job) => {
        const limit = clampInt(query?.limit, PAGE_DEFAULT, 1, PAGE_MAX);
        const cur = _decodeCursor(query?.cursor);
        const testType = query?.test_type === 'body_composition' ? 'body_composition' : 'kino_chip';
        const snapshot = cur ? cur.snapshot
            : await _snapshotId('biomarkers', job.user_id, 'AND test_type = $2', [testType]);
        const params = [job.user_id, testType, snapshot];
        const where = ['user_id = $1', 'test_type = $2', 'id <= $3::bigint'];
        // kino_chip rows without a validated block are pre-estimator and would misreport a
        // "test" with no values; body_composition has no validated block by design.
        if (testType === 'kino_chip') where.push(`(data->'validated') IS NOT NULL`);
        if (cur) { params.push(cur.ts, cur.id); where.push(`(tested_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`); }
        params.push(limit + 1);
        const { rows } = await pool.query(
            `SELECT id, tested_at, tested_at::text AS cursor_ts, data, test_type
             FROM biomarkers WHERE ${where.join(' AND ')}
             ORDER BY tested_at DESC, id DESC LIMIT $${params.length}`, params);
        return _page(rows, limit, snapshot, r => ({
            biomarker_id: Number(r.id), tested_at: formatToShanghai(r.tested_at), test_type: r.test_type,
            // data.validated only, never data.actual (CLAUDE.md 17) — actual is the raw
            // unvalidated reader output and contradicts the BioAge that was computed.
            validated: r.data?.validated || null,
            bioage_profile: r.data?.bioage_profile || null,
        }));
    });
}

// Opt-in, windowed by default. See CHAT_DEFAULT_DAYS above for why this is not in the bundle.
async function handleGetVivaAgChatHistory(query, jobToken) {
    return _resource(query, jobToken, 'ChatHistory', async (job) => {
        const limit = clampInt(query?.limit, PAGE_DEFAULT, 1, PAGE_MAX);
        const cur = _decodeCursor(query?.cursor);
        // days=0 (or 'all') means the entire history — a deliberate widening, not the default.
        const rawDays = query?.days;
        const allTime = rawDays === 'all' || rawDays === '0';
        const days = allTime ? null : clampInt(rawDays, CHAT_DEFAULT_DAYS, 1, 3650);
        const snapshot = cur ? cur.snapshot : await _snapshotId('chat_messages', job.user_id);
        const params = [job.user_id, snapshot];
        // 'action' rows are UI affordances (buttons), not anything either party said.
        const where = ['user_id = $1', 'id <= $2::bigint', `role IN ('user','ai','assistant','coach')`];
        if (!allTime) { params.push(String(days)); where.push(`created_at >= NOW() - ($${params.length} || ' days')::interval`); }
        if (cur) { params.push(cur.ts, cur.id); where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`); }
        params.push(limit + 1);
        const { rows } = await pool.query(
            `SELECT id, role, content, image_url, persona_type, created_at,
                    created_at::text AS cursor_ts
             FROM chat_messages WHERE ${where.join(' AND ')}
             ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params);
        const page = _page(rows, limit, snapshot, r => ({
            message_id: Number(r.id),
            role: r.role === 'assistant' ? 'ai' : r.role,
            persona_type: r.persona_type,
            content: r.content,
            has_image: !!r.image_url,
            created_at: formatToShanghai(r.created_at),
        }));
        page.window_days = allTime ? null : days;
        return page;
    });
}

async function handlePostVivaAgHeartbeat(body) {
    try {
        const { error, job } = await _loadClaimedJob(body?.job_uid, body?.result_token);
        if (error) return error;

        const extend = clampInt(body?.extend_seconds, DEFAULT_LEASE_SECONDS, MIN_LEASE_SECONDS, MAX_LEASE_SECONDS);
        const note = body?.progress_note ? String(body.progress_note).trim().slice(0, 500) : null;
        const { rows: [updated] } = await pool.query(
            `UPDATE viva_ag_jobs
                SET status = 'processing', heartbeat_at = NOW(),
                    claim_expires_at = NOW() + ($2 || ' seconds')::interval,
                    progress_note = COALESCE($3, progress_note), updated_at = NOW()
              WHERE id = $1
            RETURNING claim_expires_at`,
            [job.id, String(extend), note]
        );
        // Deliberately NOT a chat_status notification: that type drives the chat tab's transient
        // caption, which is bound to the client's own wait timer. A job running for hours would
        // leave a stuck caption. Progress belongs in the AG subtab's job list.
        return { success: true, lease_expires_at: formatToShanghai(updated.claim_expires_at) };
    } catch (err) {
        _logError('handlePostVivaAgHeartbeat failed', err, { job_uid: body?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// Presigned PUT for a long-form artifact (a generated PDF/markdown report). Without this the
// result_oss_key field would be unreachable — the agent has no other way to put a file anywhere.
// The key is minted here, under this job's own prefix, and never accepted from the caller.
async function handlePostVivaAgResultUploadUrl(body) {
    try {
        const { error, job } = await _loadClaimedJob(body?.job_uid, body?.result_token);
        if (error) return error;

        const filename = String(body?.filename || 'report.pdf').trim();
        const ext = (filename.includes('.') ? filename.split('.').pop() : 'pdf')
            .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
        // Rejected here rather than at submission, so the agent finds out before spending a
        // multi-megabyte upload on a file the miniapp has no way to show.
        const contentType = RESULT_CONTENT_TYPES[ext];
        if (!contentType) {
            return _fail(REASONS.UNSUPPORTED_FILE_TYPE,
                `unsupported result file type '${ext || filename}'; allowed: ${Object.keys(RESULT_CONTENT_TYPES).join(', ')}`);
        }
        const key = `${_resultKeyPrefix(job.job_uid)}${crypto.randomBytes(8).toString('hex')}.${ext}`;
        return {
            success: true,
            oss_key: key,
            put_url: ossLib.generatePresignedPutUrl(key, 3600, null, contentType),
            // Mandatory — this exact Content-Type is part of the signature, and OSS returns
            // SignatureDoesNotMatch on any other value. It is also the ONLY chance to set the
            // stored type: this bucket refuses a response-content-type override at download time.
            put_content_type: contentType,
            expires_in: 3600,
        };
    } catch (err) {
        _logError('handlePostVivaAgResultUploadUrl failed', err, { job_uid: body?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

// Normalises whatever the agent submitted as artifacts into the stored result_files array.
//
// Accepts `result_files` (an array of oss_key strings, or {oss_key, filename} objects) and the
// original single `result_oss_key`, so an agent written against either shape works. Every key is
// verified three ways before it is stored: confined to THIS job's prefix (a job must not be able
// to attach another job's report), a type the miniapp can actually present, and actually present
// in OSS — a key that was minted but never PUT would otherwise become a download button that
// fails in the user's hands.
async function _resolveResultFiles(job, body) {
    if (body?.result_files != null && !Array.isArray(body.result_files)) {
        // Silently ignoring a malformed value would complete the job with no files attached and
        // no hint why, which is a much worse failure than refusing it.
        return { error: _fail(REASONS.MISSING_PARAMS, 'result_files must be an array') };
    }
    const raw = [];
    if (Array.isArray(body?.result_files)) raw.push(...body.result_files);
    if (body?.result_oss_key) raw.push(body.result_oss_key);

    const seen = new Set();
    const candidates = [];
    for (const item of raw) {
        const entry = typeof item === 'string' ? { oss_key: item } : (item || {});
        const key = String(entry.oss_key || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        candidates.push({ key, filename: entry.filename || entry.title || null });
    }
    if (!candidates.length) return { files: [] };
    if (candidates.length > MAX_RESULT_FILES) {
        return { error: _fail(REASONS.TOO_MANY_RESULT_FILES, `at most ${MAX_RESULT_FILES} result files per job`) };
    }

    const prefix = _resultKeyPrefix(job.job_uid);
    const files = [];
    for (const { key, filename } of candidates) {
        if (!key.startsWith(prefix)) {
            return { error: _fail(REASONS.INVALID_RESULT_KEY, `result file '${key}' was not minted for this job`) };
        }
        const ext = key.split('.').pop().toLowerCase();
        if (!RESULT_CONTENT_TYPES[ext]) {
            return { error: _fail(REASONS.UNSUPPORTED_FILE_TYPE, `unsupported result file type '${ext}'`) };
        }
        const meta = await ossLib.headObject(key);
        if (!meta) {
            return { error: _fail(REASONS.RESULT_FILE_MISSING, `result file '${key}' was never uploaded`) };
        }
        files.push({
            oss_key: key,
            filename: _safeResultFilename(filename, ext),
            ext,
            content_type: meta.content_type || RESULT_CONTENT_TYPES[ext],
            size_bytes: meta.size_bytes ?? null,
            etag: meta.etag || null,
        });
    }
    // PDF first: it is what a user opens, and it is what fills the legacy single-file column.
    files.sort((a, b) => (RESULT_EXT_RANK[a.ext] ?? 9) - (RESULT_EXT_RANK[b.ext] ?? 9));
    return { files };
}

// The agent names its own files and the name reaches the user twice — as the label in the AG
// subtab and as the Content-Disposition of the signed download — so path separators, quotes and
// control characters are stripped rather than trusted.
function _safeResultFilename(raw, ext) {
    let name = String(raw || '').replace(/[\r\n\t\x00-\x1f]/g, '').replace(/[\\/"]/g, '_').trim();
    if (!name) name = `report.${ext}`;
    if (name.length > 120) name = name.slice(0, 120);
    if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name}.${ext}`;
    return name;
}

async function handlePostVivaAgResult(body) {
    try {
        const { error, job, alreadyCompleted } = await _loadClaimedJob(body?.job_uid, body?.result_token, { allowCompleted: true });
        if (error) return error;

        // Idempotent replay. The token rotates on every claim, so reaching here with a matching
        // token on a completed job means this is the SAME worker resubmitting (a retried HTTP
        // request, say) — acknowledge without delivering a second bubble. A stale-lease worker
        // would have been rejected as invalid_token above, which is what makes the fencing token
        // sufficient on its own as an idempotency key.
        if (alreadyCompleted) {
            return { success: true, already_completed: true, job_uid: job.job_uid, notification_id: job.notification_id };
        }

        const summary = _sanitizeSummary(body?.summary);
        if (!summary) return _fail(REASONS.MISSING_PARAMS, 'summary is required');

        const result = body?.result ?? null;
        if (result !== null) {
            const serialized = JSON.stringify(result);
            if (serialized.length > MAX_RESULT_BYTES) {
                return _fail(REASONS.RESULT_TOO_LARGE, `result must serialize to under ${MAX_RESULT_BYTES} bytes; use result_oss_key for long-form output`);
            }
        }

        const { error: fileError, files } = await _resolveResultFiles(job, body);
        if (fileError) return fileError;
        // result_oss_key stays populated with the head of the list purely for backwards
        // compatibility — result_files is the source of truth from here on.
        const resultOssKey = files.length ? files[0].oss_key : null;

        await pool.query(
            `UPDATE viva_ag_jobs
                SET status = 'completed', result = $2, result_summary = $3, result_oss_key = $4,
                    result_files = $5, completed_at = NOW(), progress_note = NULL, updated_at = NOW()
              WHERE id = $1`,
            [job.id, result, summary, resultOssKey, files.length ? JSON.stringify(files) : null]
        );

        // Two-channel delivery (CLAUDE.md 22): the notifications row is the 3s fast path, the
        // chat_messages row is the durable backstop, because the notification read is
        // destructive and a poll the client never receives consumes the only copy.
        let ids = { notification_id: null, chat_message_id: null };
        try {
            ids = await deliverTerminalMessage(job.user_id, job.persona_type || 'viva', NOTIFY_RESULT, summary, CHAT_SOURCE);
            await pool.query(
                `UPDATE viva_ag_jobs SET notification_id = $2, chat_message_id = $3, delivered_at = NOW() WHERE id = $1`,
                [job.id, ids.notification_id, ids.chat_message_id]
            );
        } catch (err) {
            // The result is already committed — a delivery failure must not make the agent think
            // its work was rejected and retry the whole analysis. The AG subtab still shows it.
            _logError('viva_ag result delivery failed', err, { job_uid: job.job_uid });
        }

        console.log(JSON.stringify({ level: 'INFO', msg: 'viva_ag job completed', job_uid: job.job_uid, worker_id: job.claimed_by, files: files.length }));
        return {
            success: true, job_uid: job.job_uid,
            delivered: !!ids.notification_id, notification_id: ids.notification_id,
            result_files: files.map(f => ({ filename: f.filename, ext: f.ext, size_bytes: f.size_bytes })),
        };
    } catch (err) {
        _logError('handlePostVivaAgResult failed', err, { job_uid: body?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

async function handlePostVivaAgFail(body) {
    try {
        const { error, job } = await _loadClaimedJob(body?.job_uid, body?.result_token);
        if (error) return error;

        const reason = String(body?.reason || 'agent_reported_failure').trim().slice(0, 300);
        const retryable = body?.retryable === true;

        if (retryable && job.attempts < job.max_attempts) {
            await pool.query(
                `UPDATE viva_ag_jobs
                    SET status = 'queued', claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
                        result_token = NULL, error_reason = $2, progress_note = NULL, updated_at = NOW()
                  WHERE id = $1`,
                [job.id, reason]
            );
            return { success: true, requeued: true, attempts: job.attempts, max_attempts: job.max_attempts };
        }

        await pool.query(
            `UPDATE viva_ag_jobs SET status = 'failed', error_reason = $2, completed_at = NOW(),
                    progress_note = NULL, updated_at = NOW()
              WHERE id = $1`,
            [job.id, reason]
        );
        await _deliverFailure(job, reason);
        console.log(JSON.stringify({ level: 'WARN', msg: 'viva_ag job failed', job_uid: job.job_uid, reason }));
        return { success: true, requeued: false };
    } catch (err) {
        _logError('handlePostVivaAgFail failed', err, { job_uid: body?.job_uid });
        return _fail(REASONS.INTERNAL_ERROR, err.message);
    }
}

module.exports = {
    // User-facing (app bearer + ?openid=)
    handlePostVivaAgJob,
    handleGetVivaAgJobs,
    handleGetVivaAgJobDetail,
    handlePostVivaAgJobCancel,
    handleGetVivaAgResultUrl,
    // External agent (VIVA_AG_API_TOKEN + per-job fencing token)
    handleGetVivaAgPing,
    handlePostVivaAgClaim,
    handleGetVivaAgTwinBundle,
    handleGetVivaAgDocumentUrl,
    handleGetVivaAgHealthEvents,
    handleGetVivaAgLabResults,
    handleGetVivaAgBiomarkerHistory,
    handleGetVivaAgChatHistory,
    handlePostVivaAgHeartbeat,
    handlePostVivaAgResultUploadUrl,
    handlePostVivaAgResult,
    handlePostVivaAgFail,
    // Exported for tests / the docs endpoint
    VALID_COMMAND_KEYS,
    MAX_JOBS_PER_DAY,
    REASONS,
};
