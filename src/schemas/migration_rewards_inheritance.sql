-- Channel-scoped rewards inheritance
-- Mirrors can_manage_subchannels: parent or superadmin grants this to a sub-channel,
-- allowing it to define its own commission_config instead of inheriting from parent.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS can_customize_rewards BOOLEAN NOT NULL DEFAULT FALSE;
