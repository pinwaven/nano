-- Lets a user attach more than one verified phone number and log in with any of
-- them. users.phone stays as a denormalized "primary phone" cache (still read
-- directly by gcnClient.js's phone normalization, partners.phone, and other call
-- sites) rather than being removed — this table becomes the source of truth for
-- phone -> user_id login lookup. Named to sort after migration_users_phone_verified.sql
-- (backfill below reads phone_verified_at) per scripts/migrate.js's plain-ASCII
-- ordering — see that migration for why locale-aware sorting isn't used here.
CREATE TABLE IF NOT EXISTS user_phones (
    id          SERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    phone       TEXT NOT NULL,
    verified_at TIMESTAMPTZ,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A phone belongs to exactly one user — same invariant idx_users_phone_unique
-- enforced on the old single-column field.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_phones_phone_unique ON user_phones (phone);
CREATE INDEX IF NOT EXISTS idx_user_phones_user_id ON user_phones (user_id);

-- Exactly one primary phone per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_phones_one_primary ON user_phones (user_id) WHERE is_primary;

-- Backfill: every existing phone (verified or not) becomes that user's primary row.
INSERT INTO user_phones (user_id, phone, verified_at, is_primary)
SELECT user_id, phone, phone_verified_at, true
FROM users
WHERE phone IS NOT NULL AND phone <> ''
ON CONFLICT (phone) DO NOTHING;
