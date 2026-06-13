-- Controls whether a channel's store items are visible to its direct sub-channels.
-- Defaults to TRUE (sharing on).

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS can_share_store_items BOOLEAN NOT NULL DEFAULT TRUE;
