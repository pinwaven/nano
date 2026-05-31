-- Channel-scoped partner tier customization
-- Mirrors can_customize_rewards: parent or superadmin grants this to a sub-channel,
-- allowing it to define its own partner tier display config instead of inheriting from parent.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS can_customize_partner_tiers BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS partner_tiers_config        JSONB;
