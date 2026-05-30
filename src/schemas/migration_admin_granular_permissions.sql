-- Migration: Flexible role and permission system for admin panel
-- Introduces three-tier hierarchy:
--   Superadmin > Channel Admin (hardcoded full rights) > Channel Staff (role-based)

CREATE TABLE IF NOT EXISTS admin_channel_roles (
    id          SERIAL PRIMARY KEY,
    channel_id  INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    label       TEXT NOT NULL,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (channel_id, name)
);

CREATE INDEX IF NOT EXISTS idx_acr_channel ON admin_channel_roles(channel_id);

-- Global roles (channel_id IS NULL) — visible to all channels as read-only references.
-- 'channel_admin' is the canonical role for root channel admins: full access to all channel features.
INSERT INTO admin_channel_roles (channel_id, name, label, permissions) VALUES
  (NULL, 'channel_admin', 'Channel Admin', ARRAY['users:read','users:write','users:delete','coaches:read','coaches:write','coaches:delete','store:read','store:write','store:delete','orders:read','orders:write','invites:read','invites:write','invites:delete','inventory:read','inventory:write','rewards:read','rewards:write','rewards:delete','partners:read','partners:write','partners:delete','academy:read','academy:write','questionnaires:read','health-plans:read','reports:read','tickets:read','admin-accounts:read','admin-accounts:write']),
  (NULL, 'full_access',   'Full Access',   ARRAY['users:read','users:write','users:delete','coaches:read','coaches:write','coaches:delete','store:read','store:write','store:delete','orders:read','orders:write','invites:read','invites:write','invites:delete','inventory:read','inventory:write','rewards:read','rewards:write','rewards:delete','partners:read','partners:write','partners:delete','academy:read','academy:write','questionnaires:read','health-plans:read','reports:read','tickets:read','admin-accounts:read','admin-accounts:write']),
  (NULL, 'coach_manager', 'Coach Manager', ARRAY['users:read','coaches:read','coaches:write','coaches:delete','reports:read']),
  (NULL, 'store_manager', 'Store Manager', ARRAY['store:read','store:write','store:delete','orders:read','orders:write','inventory:read','inventory:write']),
  (NULL, 'store_viewer',  'Store Viewer',  ARRAY['store:read','inventory:read','orders:read']),
  (NULL, 'user_viewer',   'User Viewer',   ARRAY['users:read','coaches:read','reports:read'])
ON CONFLICT (channel_id, name) DO NOTHING;

-- Extend admin_accounts with new columns.
-- is_channel_admin: root channel admin gets hardcoded full rights (no role needed).
-- role_id: staff accounts are assigned a channel-defined role.
-- permissions_override: additive per-account extras on top of the assigned role.
-- The existing permissions TEXT[] column is kept as a legacy fallback.
ALTER TABLE admin_accounts
    ADD COLUMN IF NOT EXISTS is_channel_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES admin_channel_roles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS permissions_override TEXT[] DEFAULT '{}';
