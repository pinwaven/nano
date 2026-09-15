-- Email as a login identity, mirroring user_phones (migration_users_phone_verified_multi.sql):
-- a user may attach more than one verified email and log in with any of them. users.email
-- stays as a denormalized "primary email" cache (it already existed as a free-text column
-- written by the admin panel) and users.email_verified_at is its phone_verified_at twin.
--
-- Deliberately NO backfill from users.email, unlike the phone migration: those values were
-- typed in by staff and never verified by their owner, so turning them into login identities
-- would let whoever controls a mistyped or shared address OTP-login into that account. A
-- legitimate address is attached via the admin panel's Add Email (unverified) or by the
-- user proving it with a code. For the same reason users.email gets no unique index —
-- uniqueness lives on user_emails.email, the only column a login ever matches on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_emails (
    id          SERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    email       TEXT NOT NULL,   -- lowercased + trimmed by the app; never citext (no CREATE EXTENSION)
    verified_at TIMESTAMPTZ,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- An email belongs to exactly one user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_emails_email_unique ON user_emails (email);
CREATE INDEX IF NOT EXISTS idx_user_emails_user_id ON user_emails (user_id);

-- Exactly one primary email per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_emails_one_primary ON user_emails (user_id) WHERE is_primary;
