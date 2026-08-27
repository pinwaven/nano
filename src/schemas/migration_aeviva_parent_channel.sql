-- @requires: migration_multi_tier_channels.sql

BEGIN;

-- Free up key_name 'aeviva' for the new parent
UPDATE channels SET key_name = 'aeviva-china' WHERE key_name = 'aeviva';

-- Create the new global parent channel
INSERT INTO channels (key_name, name, can_manage_subchannels)
VALUES ('aeviva', 'Aeviva', true);

-- Reparent Aeviva China under the new Aeviva global channel
UPDATE channels
SET parent_channel_id = (SELECT id FROM channels WHERE key_name = 'aeviva')
WHERE key_name = 'aeviva-china';

COMMIT;
