-- Channel-scoped partner types and commission rules
-- Enables channels granted permission to define their own partner tier system
-- independent of the global default types and commission rates.

-- ── Step 1: Drop FK on partners.tier first (it depends on partner_types.key unique) ──
-- Without this, dropping the UNIQUE constraint on partner_types.key will fail.
-- @requires: migration_partners.sql
ALTER TABLE partners DROP CONSTRAINT IF EXISTS fk_partners_tier;

-- ── Step 2: Add channel_id to partner_types ──────────────────────────────────
ALTER TABLE partner_types ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE;

-- The old UNIQUE(key) constraint was globally unique; drop it.
ALTER TABLE partner_types DROP CONSTRAINT IF EXISTS partner_types_key_key;

-- New constraint: unique per (channel, key).  NULL channel_id (global types) uses
-- sentinel value 0 so COALESCE makes them comparable with channel-specific rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_types_channel_key
    ON partner_types(COALESCE(channel_id, 0), key);

-- ── Step 2: Add channel_id to partner_commission_rules ────────────────────────
ALTER TABLE partner_commission_rules
    ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE;

-- Rebuild the uniqueness index to include channel_id scope.
DROP INDEX IF EXISTS idx_commission_rules_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_rules_unique ON partner_commission_rules
    (COALESCE(channel_id, 0),
     event_type,
     COALESCE(upline_level, -1),
     COALESCE(earner_type, ''),
     COALESCE(subject_type, ''));

-- ── Step 4: Add permission flag ───────────────────────────────────────────────
ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS can_customize_partner_system BOOLEAN NOT NULL DEFAULT FALSE;
