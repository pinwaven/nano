-- @requires: migration_chat_messages.sql

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image_url TEXT;
