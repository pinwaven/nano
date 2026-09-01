-- Self-service invite links (see handleGcnPartnerApply/handlePostPartnerInviteCode,
-- handlers/partners.js): each partner can generate a shareable code that lets a new
-- applicant apply pre-linked to them as upline, without an admin manually creating the
-- record. Nullable/lazy — most partners never generate one.
-- @requires: migration_partners.sql
ALTER TABLE partners ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;
