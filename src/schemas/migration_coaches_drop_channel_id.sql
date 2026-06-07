-- Remove the redundant channel_id column from coaches.
-- A coach's channel is always determined by their linked users.channel_id.
-- All queries now derive channel via JOIN coaches -> users -> channels.
ALTER TABLE coaches DROP COLUMN IF EXISTS channel_id;
DROP INDEX IF EXISTS idx_coaches_channel_id;
