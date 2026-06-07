-- Coach Groups: business entity groupings (clinics, studios, stores) within a channel.
-- Groups are purely organizational — they group coaches (and transitively their users)
-- within a single channel. They are NOT sub-channels.

CREATE TABLE IF NOT EXISTS coach_groups (
    id          SERIAL PRIMARY KEY,
    channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    type        TEXT,       -- free-text: 'clinic', 'studio', 'nutrition', etc.
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, name)
);

CREATE INDEX IF NOT EXISTS idx_coach_groups_channel ON coach_groups(channel_id);

-- Coaches optionally belong to a group; ungrouped coaches are NULL.
-- ON DELETE SET NULL: deleting a group ungroups its coaches (no data loss).
ALTER TABLE coaches
    ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES coach_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coaches_group_id ON coaches(group_id);
