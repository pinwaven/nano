-- Autonomous channel flag.
-- When set, the channel operates as a fully independent unit (e.g. country-level partner).
-- All capability flags (can_customize_store, can_manage_warehouses, can_manage_subchannels,
-- can_customize_rewards, can_customize_partner_tiers, can_customize_partner_system) are
-- implicitly true and the admin JWT receives CHANNEL_ADMIN_FULL_PERMS regardless of what
-- is individually configured. Only superadmins can toggle this flag.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS autonomous BOOLEAN NOT NULL DEFAULT FALSE;
