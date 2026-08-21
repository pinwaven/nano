-- Box QR codes: physical Dots boxes get a public, unauthenticated QR-scannable ingredient page.
-- One box_batches row per admin-triggered manufacturing run (snapshots one user's committed
-- formulation); one boxes row per physical unit produced in that run.
--
-- recipe_snapshot is a FROZEN copy of the day-0 dot/ingredient breakdown at the moment the batch
-- was generated (mg amounts, timing, coating, bilingual names) — NOT a live join to
-- nutrition_schedules/dots at request time. A printed box is a physical artifact; if the dots
-- catalog is later edited (ingredient reformulation, renamed dot, etc.) an already-manufactured
-- box's QR page must keep showing what was actually put in that box, not today's catalog.
--
-- box_code is intentionally random, NOT sequential like kino_chips' {PREFIX}-0001 scheme — this
-- code is a public URL exposing one person's health/ingredient data. Sequential codes on a print
-- sheet would let scanning one box trivially enumerate/scrape every other box in the same run.
-- Generated via crypto.randomBytes + DB-uniqueness retry loop (mirrors generateUserId in
-- lib/auth.js), not a batch-prefix + counter.

CREATE TABLE IF NOT EXISTS box_batches (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES nutrition_plans(id) ON DELETE SET NULL, -- source plan, traceability only
    quantity INTEGER NOT NULL,
    recipe_snapshot JSONB NOT NULL,   -- frozen day-0 dot/ingredient breakdown, see handlers/boxes.js
    notes TEXT,
    status TEXT DEFAULT 'active',     -- 'active' | 'recalled'
    created_by TEXT,                  -- adminCtx.username of the ops person who generated it
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS boxes (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES box_batches(id) ON DELETE CASCADE,
    box_code TEXT UNIQUE NOT NULL,    -- e.g. WVB4F2A9C1E08D3B — this IS the QR payload's path segment
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_boxes_batch_id      ON boxes(batch_id);
CREATE INDEX IF NOT EXISTS idx_boxes_box_code      ON boxes(box_code);
CREATE INDEX IF NOT EXISTS idx_box_batches_user_id ON box_batches(user_id);
