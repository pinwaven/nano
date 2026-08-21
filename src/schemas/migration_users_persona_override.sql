-- Generalizes the Viva-only users.viva_subscription_expires_at gate into a per-user,
-- per-persona override with a duration. This is now the single source of truth for
-- "which persona does this user get right now, and does an active Viva grant exist" —
-- see resolveEffectivePersona()/hasActiveVivaAccess() in worker/lib/persona.js.
-- viva_subscription_expires_at is kept as a mirrored, read-only legacy column — still
-- written by grantPersonaOverride whenever persona_type='viva', for any not-yet-migrated
-- reader.
ALTER TABLE users ADD COLUMN IF NOT EXISTS persona_override_type TEXT;          -- 'nano' | 'viva' | NULL
ALTER TABLE users ADD COLUMN IF NOT EXISTS persona_override_expires_at TIMESTAMPTZ;

-- Backfill: every user with a currently-set legacy Viva expiry becomes an equivalent
-- generalized override, so no existing Viva subscriber loses access the moment this
-- migration deploys. Idempotent — only touches rows not already backfilled.
UPDATE users
SET persona_override_type = 'viva', persona_override_expires_at = viva_subscription_expires_at
WHERE viva_subscription_expires_at IS NOT NULL AND persona_override_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_persona_override
    ON users (persona_override_expires_at) WHERE persona_override_type IS NOT NULL;
