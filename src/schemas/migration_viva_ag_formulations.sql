-- A 28-day Dots formula produced by the external Viva AG agent, parsed and validated by nano
-- (lib/agFormulation.js) and tracked from that point through expert review to the plan it
-- eventually becomes.
--
-- This is the row that turns an AG artifact into a real product. Until 2026-08-25 a
-- dots_formulation result was stored verbatim and read by nobody — CLAUDE.md §35 called it "an
-- artifact, not a prescription". It now drives a physical order, so the formula is parsed into a
-- canonical form here and every downstream consumer (GCN's expert queue, the processing centre,
-- nutrition_schedules) reads THIS, never the uploaded .md.
--
-- `capsules` is the canonical 56-entry array: [{day:1..28, slot:'AM'|'PM', dots:{KEY:count}}],
-- ordered day 1 AM … day 28 PM by canonicalizeCapsules(). `totals` is derived, never trusted from
-- the agent's own Totals table — it is what that table is checked against.
--
-- The gcn_* columns are plain TEXT with no FK: GCN is a different database on the same cluster
-- (CLAUDE.md §32), so referential integrity across the boundary is not available and is not
-- pretended at. A 'valid' row with a NULL gcn_order_id is the query that finds formulas whose
-- fire-and-forget notify to GCN failed.

CREATE TABLE IF NOT EXISTS viva_ag_formulations (
    id                  BIGSERIAL PRIMARY KEY,
    job_id              BIGINT NOT NULL REFERENCES viva_ag_jobs(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,

    -- 'valid'     — parsed and passed every §8 rule; handed to GCN's review queue
    -- 'invalid'   — failed validation; validation_errors says how, user asked to re-run
    -- 'approved'  — a nutrition expert approved it (possibly with adjusted_capsules)
    -- 'rejected'  — a nutrition expert rejected it
    -- 'committed' — the user scanned their box and it became an active nutrition_plan
    status              TEXT NOT NULL DEFAULT 'valid'
        CHECK (status IN ('valid', 'invalid', 'approved', 'rejected', 'committed')),

    capsules            JSONB NOT NULL,
    totals              JSONB NOT NULL,
    total_dots          INTEGER,
    rationale           TEXT,
    source_format       TEXT,            -- 'json' | 'markdown' — which representation was parsed
    validation_errors   JSONB,

    gcn_order_id        TEXT,
    gcn_order_item_id   TEXT,
    notified_gcn_at     TIMESTAMPTZ,

    -- NULL on an approved row means "approved unchanged" — the same convention GCN's own
    -- formulation_reviews.adjusted_recipe uses (migration_0076).
    adjusted_capsules   JSONB,
    review_notes        TEXT,
    reviewer_ref        TEXT,            -- GCN partner_id of the reviewer, for audit only
    approved_at         TIMESTAMPTZ,

    nutrition_plan_id   INTEGER REFERENCES nutrition_plans(id) ON DELETE SET NULL,
    committed_at        TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One formulation per job. A job is claimed under a fencing token that rotates on every claim
-- (CLAUDE.md §35), so a duplicate result submission is already impossible — this makes a
-- duplicate INSERT impossible too, which is what lets the result handler use ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_viva_ag_formulations_job
    ON viva_ag_formulations (job_id);
CREATE INDEX IF NOT EXISTS idx_viva_ag_formulations_user
    ON viva_ag_formulations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_viva_ag_formulations_status
    ON viva_ag_formulations (status, created_at);
-- Finds formulas that validated but never reached GCN (notify is fire-and-forget by design).
CREATE INDEX IF NOT EXISTS idx_viva_ag_formulations_unnotified
    ON viva_ag_formulations (created_at) WHERE status = 'valid' AND gcn_order_id IS NULL;
