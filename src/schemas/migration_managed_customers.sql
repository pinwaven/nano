-- Managed customers: login-less accounts a coach creates and operates on behalf of a B2B
-- channel's own customers (first client: SuperiorMed). The customer never opens the app; their
-- coach runs Kino scans, formulates Dots and talks to Viva about them. The channel pays.
--
-- account_type 'managed' is what every consumer-facing path keys on to stay out of the way
-- (check-ins, program nudges, account merges, logins). Releasing a customer (channel admin) flips
-- it to 'regular' and stamps managed_released_*; the row, its data and its coach link stay.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'regular';
DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT users_account_type_check CHECK (account_type IN ('regular', 'managed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The customer's identifier in the channel's own records (their CRM / clinic id), so a coach
-- can match nano's account to theirs without a name or phone. Unique per channel when set.
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_channel_external_ref
    ON users (channel_id, external_ref) WHERE external_ref IS NOT NULL;

-- The phone the coach typed in. NOT users.phone / user_phones: those are login identities, and a
-- managed customer must not be able to sign in by OTP (nor collide with a real signup of the same
-- number). Released, it moves into user_phones unverified, so the customer's first OTP proves it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_phone TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_created_by_coach_id INTEGER REFERENCES coaches(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_released_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_released_by TEXT;

CREATE INDEX IF NOT EXISTS idx_users_managed ON users (channel_id) WHERE account_type = 'managed';

-- Channel switch: coaches in a channel whose effective config has managed_customers = true may
-- create managed customers. Set for SuperiorMed only; inherits to its sub-channels.
UPDATE channels SET config = COALESCE(config, '{}'::jsonb) || '{"managed_customers": true}'::jsonb
 WHERE key_name = 'superiormed' AND NOT (COALESCE(config, '{}'::jsonb) ? 'managed_customers');
