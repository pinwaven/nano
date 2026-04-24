-- Cartridge tracking: one row per physical NFC-tagged cartridge per user
CREATE TABLE IF NOT EXISTS user_cartridges (
    id                SERIAL PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    dot_id            INTEGER NOT NULL REFERENCES dots(id),
    nfc_tag_id        TEXT NOT NULL UNIQUE,
    total_dots        INTEGER NOT NULL DEFAULT 800,
    remaining_dots    INTEGER NOT NULL DEFAULT 800,
    status            TEXT NOT NULL DEFAULT 'active', -- 'active' | 'empty' | 'removed'
    inserted_at       TIMESTAMPTZ DEFAULT NOW(),
    last_dispensed_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_cartridges_user ON user_cartridges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_cartridges_nfc  ON user_cartridges(nfc_tag_id);

-- Track when a schedule slot was actually dispensed and what was deducted per cartridge
ALTER TABLE nutrition_schedules
    ADD COLUMN IF NOT EXISTS dispensed_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispense_log  JSONB;
-- dispense_log shape: { "DOT01": { deducted: 5, cartridge_id: 42, remaining_after: 320 }, ... }
