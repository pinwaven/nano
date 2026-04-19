-- Migration: make external_id nullable
-- external_id was originally wechat_openid (NOT NULL). Admin-created users
-- may not have an external app identity, so the column must allow NULL.
-- PostgreSQL treats each NULL as distinct, so the UNIQUE constraint is preserved.

ALTER TABLE users ALTER COLUMN external_id DROP NOT NULL;

-- Replace the plain UNIQUE constraint with a partial unique index so that
-- NULL values are excluded and only non-null external_ids must be unique.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_external_id_unique;
DROP INDEX IF EXISTS idx_users_external_id;

CREATE UNIQUE INDEX idx_users_external_id ON users(external_id) WHERE external_id IS NOT NULL;
