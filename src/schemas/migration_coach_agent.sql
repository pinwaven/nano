-- Coach Agent: presence and coaching-cooldown tracking on users
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_active_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_coached_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_active ON users (last_active_at DESC);
