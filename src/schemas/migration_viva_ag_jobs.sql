-- Job queue for the external Viva AG (Advanced Generation) agent.
--
-- Unlike every other long-running flow in this codebase, the slow work happens OUTSIDE nano:
-- the external agent PULLS jobs from here (POST /viva-ag/jobs/claim), fetches a twin bundle,
-- and POSTs a result back. So there is deliberately no EventBridge involvement — nano-side
-- work is one INSERT to enqueue and two INSERTs to deliver, never anywhere near FC's 300s
-- ceiling, which is the only reason CLAUDE.md 22's CloudEvent machinery exists.
--
-- Lifecycle:
--   queued --claim--> claimed --bundle fetch/heartbeat--> processing
--     ^                  |                                    |
--     +------------------+--- lease expiry & attempts < max ---+
--                        lease expiry & attempts >= max --> failed (+ chat message)
--   processing --POST /jobs/result--> completed (+ chat message)
--   processing --POST /jobs/fail (non-retryable)--> failed (+ chat message)
--   queued --user cancels--> cancelled
--
-- Lease expiry is swept LAZILY at the top of the claim handler (and the user-facing job list),
-- not by a cron. Residual limitation: if the external agent stops polling entirely and no user
-- opens the AG subtab, an expired lease stays 'claimed' until someone touches the queue.
CREATE TABLE IF NOT EXISTS viva_ag_jobs (
    id               BIGSERIAL PRIMARY KEY,
    -- External-facing opaque handle, minted in Node with crypto.randomUUID(). The ONLY
    -- identifier the external agent ever sees: no user_id/openid is returned by any
    -- /viva-ag/* response, so a leaked API token cannot enumerate users.
    job_uid          TEXT NOT NULL UNIQUE,
    user_id          TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    channel_id       INTEGER REFERENCES channels(id),
    -- Persona the reply is saved under. Always 'viva', never 'viva_ag': chat_messages history
    -- is persona-scoped, so a bubble saved under a persona the chat tab never queries would
    -- flash once via the notification poll and vanish on reload (CLAUDE.md 25's second bug).
    persona_type     TEXT NOT NULL DEFAULT 'viva',
    language         TEXT NOT NULL DEFAULT 'zh',   -- snapshot, so failure text localises without a re-read

    command_key      TEXT,                    -- preset: 'full_analysis'|'document_review'|'risk_screen'
    command          TEXT NOT NULL,           -- the user's free-text instruction
    params           JSONB NOT NULL DEFAULT '{}'::jsonb,
    document_ids     BIGINT[],                -- snapshot of in-scope docs; NULL = all active at fetch time

    status           TEXT NOT NULL DEFAULT 'queued',
        -- 'queued'|'claimed'|'processing'|'completed'|'failed'|'cancelled'
    priority         INTEGER NOT NULL DEFAULT 0,
    attempts         INTEGER NOT NULL DEFAULT 0,
    -- Per-row rather than a constant: attempts increments on every claim, so a legitimate
    -- 3-hour run that crashes at hour 3 burns one. An expensive job can be given more.
    max_attempts     INTEGER NOT NULL DEFAULT 3,

    claimed_by       TEXT,                    -- external worker_id, for log correlation only
    claimed_at       TIMESTAMPTZ,
    claim_expires_at TIMESTAMPTZ,             -- lease deadline; the lazy sweep requeues past this
    heartbeat_at     TIMESTAMPTZ,
    progress_note    TEXT,                    -- last heartbeat's note, shown in the AG subtab
    -- Fencing token, ROTATED ON EVERY CLAIM. Doubles as the result-submission credential and
    -- the idempotency key: a worker whose lease expired and was re-claimed by someone else
    -- holds a stale token and is rejected, so two workers can never both write a result.
    -- Transported in the X-Viva-Ag-Job-Token header (GET) or the body (POST), never in a query
    -- string — query strings land in FC/SLS access logs and this token gates a medical record.
    result_token     TEXT,

    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    result           JSONB,                   -- structured findings; 512 KB cap enforced in the handler
    result_summary   TEXT,                    -- the chat-bubble text (sanitized on ingest)
    -- Optional long-form artifact the agent uploaded via POST /viva-ag/result-upload-url.
    -- Always under 'viva-ag-results/<job_uid>/'; the submit handler rejects anything else.
    result_oss_key   TEXT,
    error_reason     TEXT,

    -- Correlation to what was actually delivered on both channels (CLAUDE.md 22). Plain
    -- BIGINTs, not FKs: notifications rows are read destructively and there is no
    -- delete-cascade contract worth inheriting; a dangling id is fine for correlation.
    notification_id  BIGINT,
    chat_message_id  BIGINT,
    delivered_at     TIMESTAMPTZ,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Claim path: the only hot query. Partial index keeps it to the queued head.
CREATE INDEX IF NOT EXISTS idx_viva_ag_jobs_claim
    ON viva_ag_jobs (priority DESC, created_at ASC) WHERE status = 'queued';

-- Lazy lease-expiry sweep.
CREATE INDEX IF NOT EXISTS idx_viva_ag_jobs_lease
    ON viva_ag_jobs (claim_expires_at) WHERE status IN ('claimed','processing');

-- User-facing job list.
CREATE INDEX IF NOT EXISTS idx_viva_ag_jobs_user
    ON viva_ag_jobs (user_id, created_at DESC);

-- Backpressure: one in-flight AG job per user. The external agent is expensive and slow, so
-- letting a user queue five is a cost bug, not a feature. Enforced at the DB so a double-tap
-- race cannot slip past the handler's own pre-check.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_viva_ag_jobs_active
    ON viva_ag_jobs (user_id) WHERE status IN ('queued','claimed','processing');
