-- @requires: migration_health_documents.sql
--
-- Job queue for the external document-extraction agent (Curia's Viva agent).
--
-- Sibling of viva_ag_jobs, deliberately NOT a job_type column on it. The two queues differ on
-- every axis that matters: Viva AG is a paid add-on capped at ONE in-flight job per user and
-- runs for minutes to hours; extraction is available to every user (CLAUDE.md 38 — documents
-- are twin data, not an AG feature), is scoped to a single DOCUMENT so ten uploads extract
-- concurrently, and finishes in seconds. Sharing one table would mean splitting the per-user
-- cap and the daily limit by type, and would let a cheap extraction backlog starve an expensive
-- paid AG run.
--
-- The @requires is load-bearing on a FRESH database, not documentation: plain ASCII sort puts
-- this file BEFORE migration_health_documents.sql ('d' < 'h' after the shared "migration_"
-- prefix), so the FK below would fail with `relation "health_documents" does not exist`.
--
-- Same no-EventBridge / no-cron reasoning as viva_ag_jobs: the slow work happens entirely inside
-- the external agent, so nano never holds a request open and CLAUDE.md 22's CloudEvent
-- machinery has no pressure to relieve here. Lease expiry is swept LAZILY at the top of the
-- claim handler and of the user's document list.
--
-- Lifecycle:
--   queued --claim--> claimed --document fetch/heartbeat--> processing
--     ^                  |                                      |
--     +------------------+---- lease expiry & attempts < max ----+
--                        lease expiry & attempts >= max --> failed
--   processing --POST /jobs/result--> completed  (writes the twin, then a chat message)
--   processing --POST /jobs/fail (non-retryable)--> failed
--   any --user taps 解析有误--> rejected
CREATE TABLE IF NOT EXISTS doc_extraction_jobs (
    id               BIGSERIAL PRIMARY KEY,
    -- The ONLY identifier the external agent ever sees. No /doc-extract/* response returns a
    -- user_id, openid or nickname, and there is no "fetch a document for an arbitrary openid"
    -- path, so a leaked API token can drain the queue but cannot enumerate users.
    job_uid          TEXT NOT NULL UNIQUE,

    -- The job's subject. Extraction is per-document; viva_ag_jobs is per-user with a
    -- document_ids[] snapshot, which is the opposite shape and does not apply here.
    document_id      BIGINT NOT NULL REFERENCES health_documents(id) ON DELETE CASCADE,
    -- Kept alongside for scoping and for delivering the result; never returned to the agent.
    user_id          TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    persona_type     TEXT NOT NULL DEFAULT 'viva',
    language         TEXT NOT NULL DEFAULT 'zh',   -- snapshot, so failure text localises without a re-read

    status           TEXT NOT NULL DEFAULT 'queued',
        -- 'queued'|'claimed'|'processing'|'completed'|'failed'|'cancelled'|'rejected'
        -- No CHECK constraint, matching viva_ag_jobs: this comment is the value set.
        -- 'rejected' is what the user's own 解析有误 correction sets. It is terminal AND
        -- distinct from 'failed': a failure may legitimately be retried, but a result the user
        -- has explicitly thrown away must not be silently recreated by a re-upload or a sweep.
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 3,

    claimed_by       TEXT,                    -- external worker_id, for log correlation only
    claimed_at       TIMESTAMPTZ,
    claim_expires_at TIMESTAMPTZ,
    heartbeat_at     TIMESTAMPTZ,
    progress_note    TEXT,
    -- Fencing token, ROTATED ON EVERY CLAIM — simultaneously the submission credential and the
    -- idempotency key, so a worker whose lease expired and was re-claimed holds a dead token
    -- and two workers can never both write a result. Carried in the X-Doc-Extract-Job-Token
    -- header (GET) or the body (POST), never a query string: query strings land in FC/SLS
    -- access logs and this token gates a medical record.
    result_token     TEXT,

    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    -- The agent's validated submission, as accepted. Stored so a later correction can see
    -- exactly what was written, and so 'rejected[]' stays auditable after delivery.
    result           JSONB,
    -- Everything the validator refused, with a reason code each. A silent drop is what made the
    -- pre-existing report path unauditable (handlePostHealthReport drops an unknown key_name
    -- with no log and no counter); making the gap countable is the point.
    rejected         JSONB,
    error_reason     TEXT,

    -- What was actually written, so 解析有误 can remove exactly this extraction and nothing else.
    health_report_id BIGINT,

    notification_id  BIGINT,
    chat_message_id  BIGINT,
    delivered_at     TIMESTAMPTZ,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Claim path: the only hot query. FIFO — there is no priority fan-out here, because every
-- extraction costs about the same.
CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_claim
    ON doc_extraction_jobs (created_at ASC) WHERE status = 'queued';

-- Lazy lease-expiry sweep.
CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_lease
    ON doc_extraction_jobs (claim_expires_at) WHERE status IN ('claimed','processing');

-- The user's own document list joins through this.
CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_document
    ON doc_extraction_jobs (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_user
    ON doc_extraction_jobs (user_id, created_at DESC);

-- Backpressure, per DOCUMENT rather than per user (contrast uniq_viva_ag_jobs_active). A user
-- uploading ten reports should get ten extractions; the same document being extracted twice at
-- once is the actual bug, since both runs would race to write the same health_events rows.
-- Enforced at the DB so a double-tap on 重新解析 cannot slip past the handler's own pre-check.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_doc_extraction_active
    ON doc_extraction_jobs (document_id) WHERE status IN ('queued','claimed','processing');
