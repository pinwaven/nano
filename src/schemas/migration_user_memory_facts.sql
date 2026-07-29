-- Personal memory facts stated by a user in Viva conversation — dietary restrictions,
-- allergies, lifestyle preferences, goals. Distinct from users.bio_data (fixed onboarding
-- checklist) and knowledge_entries (persona-scoped curated science KB, not user-specific).
-- Purely user-scoped, not persona-scoped — a stated allergy is true regardless of which
-- persona the user talks to. See CLAUDE.md for the full design writeup.

CREATE TABLE IF NOT EXISTS user_memory_facts (
    id                 SERIAL PRIMARY KEY,
    user_id            TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    category           TEXT NOT NULL CHECK (category IN ('dietary_restriction', 'allergy', 'preference', 'goal', 'other')),
    fact_zh            TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    source             TEXT NOT NULL DEFAULT 'chat_extracted' CHECK (source IN ('chat_extracted', 'admin_added')),
    first_mentioned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_mentioned_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_memory_facts_user ON user_memory_facts (user_id, status);

-- Enables ON CONFLICT upsert: a repeated exact restatement of the same fact just bumps
-- last_mentioned_at instead of inserting a duplicate row. Partial (status='active' only) so
-- a fact can be re-added after being deactivated without hitting a stale unique violation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memory_facts_dedup
    ON user_memory_facts (user_id, category, fact_zh) WHERE status = 'active';
