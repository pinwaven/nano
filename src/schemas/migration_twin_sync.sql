-- Twin sync: what the `twin` function (src/functions/twin) needs to keep an external replica of
-- a user's digital twin in step, beyond what migration_viva_ag_subjects.sql gave the mirror.
--
-- Three mechanisms, all maintained by triggers so that no write path in the worker, lab, kino or
-- admin functions has to remember them:
--
--   1. twin_touch — one row per user, bumped by ANY insert, update or delete on a table the twin
--      bundle reads. It is the change signal the bundle listing was missing: the old signal was
--      GREATEST over created_at columns, which could not see an in-place update of a table with
--      created_at only, a hard delete, or four tables it did not list at all (food sensitivity,
--      questionnaire answers, plan check-ins and milestones).
--
--   2. twin_seq — a global sequence stamped on every inserted or updated row of the four bulk
--      tables the twin function pages (health_events, health_reports, biomarkers, chat_messages).
--      Paging "rows with twin_seq > my cursor" is an incremental read that also catches rows
--      updated in place, which an id cursor cannot. twin_seq_at is when the stamp was taken: a
--      reader only takes rows stamped more than a settle interval ago, because a sequence value is
--      drawn before its transaction commits and a lower value can become visible after a higher
--      one. With every write transaction shorter than the interval, nothing is skipped.
--
--   3. twin_tombstones — a row per deleted row of those four tables, numbered from the same
--      sequence, so a reader learns about deletes in the same stream as upserts.
--
-- And one policy switch: twin_sync_policy.mint_all_users. With it on, every new user gets a
-- subject_ref at signup (viva_ag_subjects, minted_by 'signup'). It is OFF here on purpose: turning
-- it on, and backfilling existing users, is scripts/twin-all-users.js --apply, a per-environment
-- act with a name attached — widening the mirror from "subjects who invoked the agent" to every
-- user is a consent decision, not something `migrate:prod` should do as a side effect.
--
-- Every trigger function here swallows its own errors (RAISE WARNING) except the sequence stamp,
-- which cannot fail: a bookkeeping table for an external replica must never be the reason a ring
-- sync, a chat message or a signup is refused.
--
-- DEPLOY ORDER: apply this BEFORE deploying a worker that carries the new lib/twinMirror.js — its
-- CHANGED_AT_SQL reads twin_touch, and the claim path calls it.
--
-- PROD NOTE: the twin_seq backfill UPDATEs every row of health_events and chat_messages inside the
-- migration's transaction. Fine on dev (~26k rows each); measure prod's row counts first.
-- @requires: migration_viva_ag_subjects_minted_by.sql

-- ---------------------------------------------------------------------------------------------
-- 1. twin_touch
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS twin_touch (
    user_id    TEXT PRIMARY KEY,
    touched_at TIMESTAMPTZ NOT NULL
);

-- Statement-level, over a transition table named twin_changed. The DISTINCT is in a subquery on
-- purpose: DISTINCT over (user_id, clock_timestamp()) does not dedupe, and ON CONFLICT DO UPDATE
-- refuses to touch one row twice in a statement — that would abort the caller's write. ORDER BY
-- takes the row locks in one order, so two multi-user statements cannot deadlock on this table.
CREATE OR REPLACE FUNCTION twin_touch_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        INSERT INTO twin_touch (user_id, touched_at)
        SELECT d.user_id, clock_timestamp()
          FROM (SELECT DISTINCT user_id FROM twin_changed WHERE user_id IS NOT NULL) d
         ORDER BY d.user_id
        ON CONFLICT (user_id) DO UPDATE SET touched_at = EXCLUDED.touched_at;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'twin_touch_rows on %: %', TG_TABLE_NAME, SQLERRM;
    END;
    RETURN NULL;
END $$;

-- questionnaire_responses carries no user_id; its user is the assignment's.
CREATE OR REPLACE FUNCTION twin_touch_responses() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        INSERT INTO twin_touch (user_id, touched_at)
        SELECT d.user_id, clock_timestamp()
          FROM (SELECT DISTINCT a.user_id
                  FROM twin_changed c JOIN questionnaire_assignments a ON a.id = c.assignment_id
                 WHERE a.user_id IS NOT NULL) d
         ORDER BY d.user_id
        ON CONFLICT (user_id) DO UPDATE SET touched_at = EXCLUDED.touched_at;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'twin_touch_responses: %', SQLERRM;
    END;
    RETURN NULL;
END $$;

-- A trigger with a transition table may name one event only, hence three per table.
DO $$
DECLARE
    t TEXT;
    fn TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'biomarkers', 'health_events', 'health_reports', 'health_report_items', 'health_documents',
        'health_document_tags', 'health_twin', 'user_memory_facts', 'questionnaire_assignments',
        'questionnaire_responses', 'health_plans', 'health_plan_checkins', 'health_plan_milestones',
        'nutrition_schedules', 'user_cartridges', 'reminders', 'food_sensitivity_panels',
        'food_sensitivity_results', 'chat_messages'
    ] LOOP
        fn := CASE WHEN t = 'questionnaire_responses' THEN 'twin_touch_responses' ELSE 'twin_touch_rows' END;
        EXECUTE format('DROP TRIGGER IF EXISTS twin_touch_ins ON %I', t);
        EXECUTE format('DROP TRIGGER IF EXISTS twin_touch_upd ON %I', t);
        EXECUTE format('DROP TRIGGER IF EXISTS twin_touch_del ON %I', t);
        EXECUTE format('CREATE TRIGGER twin_touch_ins AFTER INSERT ON %I REFERENCING NEW TABLE AS twin_changed FOR EACH STATEMENT EXECUTE FUNCTION %I()', t, fn);
        EXECUTE format('CREATE TRIGGER twin_touch_upd AFTER UPDATE ON %I REFERENCING NEW TABLE AS twin_changed FOR EACH STATEMENT EXECUTE FUNCTION %I()', t, fn);
        EXECUTE format('CREATE TRIGGER twin_touch_del AFTER DELETE ON %I REFERENCING OLD TABLE AS twin_changed FOR EACH STATEMENT EXECUTE FUNCTION %I()', t, fn);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 2. twin_seq on the four paged tables
-- ---------------------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS twin_seq;

CREATE OR REPLACE FUNCTION twin_seq_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.twin_seq := nextval('twin_seq');
    NEW.twin_seq_at := clock_timestamp();
    RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 3. twin_tombstones
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS twin_tombstones (
    seq        BIGINT PRIMARY KEY DEFAULT nextval('twin_seq'),
    at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    user_id    TEXT NOT NULL,
    tbl        TEXT NOT NULL,
    row_id     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS twin_tombstones_user_tbl_seq ON twin_tombstones (user_id, tbl, seq);

CREATE OR REPLACE FUNCTION twin_tombstone_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        INSERT INTO twin_tombstones (user_id, tbl, row_id)
        SELECT user_id, TG_TABLE_NAME, id FROM twin_gone WHERE user_id IS NOT NULL ORDER BY id;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'twin_tombstone_rows on %: %', TG_TABLE_NAME, SQLERRM;
    END;
    RETURN NULL;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['health_events', 'health_reports', 'biomarkers', 'chat_messages'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS twin_seq BIGINT', t);
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS twin_seq_at TIMESTAMPTZ', t);
        -- Backfill before the stamp trigger exists, in id order, and dated a day back so the
        -- existing rows are settled at once.
        EXECUTE format(
            'UPDATE %1$I SET twin_seq = s.seq, twin_seq_at = NOW() - INTERVAL ''1 day''
               FROM (SELECT o.id, nextval(''twin_seq'') AS seq
                       FROM (SELECT id FROM %1$I WHERE twin_seq IS NULL ORDER BY id) o) s
              WHERE %1$I.id = s.id', t);
        EXECUTE format('DROP TRIGGER IF EXISTS twin_seq_stamp ON %I', t);
        EXECUTE format('CREATE TRIGGER twin_seq_stamp BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION twin_seq_stamp()', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (user_id, twin_seq)', t || '_user_twin_seq', t);
        EXECUTE format('DROP TRIGGER IF EXISTS twin_tombstone ON %I', t);
        EXECUTE format('CREATE TRIGGER twin_tombstone AFTER DELETE ON %I REFERENCING OLD TABLE AS twin_gone FOR EACH STATEMENT EXECUTE FUNCTION twin_tombstone_rows()', t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Subject minting policy
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS twin_sync_policy (
    id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    mint_all_users BOOLEAN NOT NULL DEFAULT FALSE,
    decided_by     TEXT,
    decided_at     TIMESTAMPTZ,
    note           TEXT
);
INSERT INTO twin_sync_policy (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- gen_random_uuid() is core since PG13 and draws from a strong source; 24 hex of it keeps the
-- 'vs_' + 24 shape mintSubjectRef() produces.
CREATE OR REPLACE FUNCTION twin_mint_on_signup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        IF (SELECT mint_all_users FROM twin_sync_policy WHERE id) THEN
            INSERT INTO viva_ag_subjects (user_id, subject_ref, minted_by)
            VALUES (NEW.user_id, 'vs_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), 'signup')
            ON CONFLICT (user_id) DO NOTHING;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'twin_mint_on_signup: %', SQLERRM;
    END;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS twin_mint_on_signup ON users;
CREATE TRIGGER twin_mint_on_signup AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION twin_mint_on_signup();

-- ---------------------------------------------------------------------------------------------
-- 5. Contributions: what an external twin holder (Curia) writes back
-- ---------------------------------------------------------------------------------------------
-- The twin is kept in two places and changes in both: nano records what the user does and
-- uploads; Curia adds what its agents produce — a report, values read out of a document, a
-- physician agent's finding. Each write-back is one contribution, named by an id the sender mints
-- (so a retried POST is a no-op, not a duplicate) and carrying its origin — which agent, whether
-- a platform agent or a physician's, whether its output was gated — because nano shows it to a
-- user and the user is owed who said it. Nano stays the record: a contribution lands in nano's
-- own tables (`target` says where) and nano decides what it accepts.
CREATE TABLE IF NOT EXISTS twin_contributions (
    contribution_uid UUID PRIMARY KEY,
    user_id          TEXT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('report', 'observations', 'finding')),
    origin           JSONB NOT NULL,
    status           TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'superseded', 'withdrawn')),
    target           JSONB,
    superseded_by    UUID,
    status_reason    TEXT,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS twin_contributions_user ON twin_contributions (user_id, received_at DESC);
