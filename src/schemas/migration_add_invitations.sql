-- Invitation system: tracks invite codes used to onboard new users
-- Supports future commission system via invitation_uses join

CREATE TABLE IF NOT EXISTS invitations (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  created_by    TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  channel_id    INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  type          TEXT NOT NULL DEFAULT 'coach',  -- 'coach' | 'channel'
  max_uses      INTEGER DEFAULT NULL,           -- NULL = unlimited
  use_count     INTEGER NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ DEFAULT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_invitations_code     ON invitations(code) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_invitations_channel  ON invitations(channel_id);
CREATE INDEX IF NOT EXISTS idx_invitations_creator  ON invitations(created_by);

-- One row per redemption — enables per-invite commission queries
CREATE TABLE IF NOT EXISTS invitation_uses (
  id             BIGSERIAL PRIMARY KEY,
  invitation_id  BIGINT NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  used_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_uses_unique     ON invitation_uses(invitation_id, user_id);
CREATE INDEX        IF NOT EXISTS idx_invitation_uses_invitation ON invitation_uses(invitation_id);

-- Fast lookup of which invite brought each user
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_invitation_id BIGINT REFERENCES invitations(id) ON DELETE SET NULL;
