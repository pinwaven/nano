-- Records which pregenerated avatar gallery character (e.g. 'avatar-07') a
-- user picked. avatar_url keeps storing the currently resolved image URL
-- (the character's relaxed variant) exactly as before — this column just
-- lets the client re-resolve the character across the other 3 mood variants
-- (engaged/relaxed/restored/stressed) using live wearable data, without any
-- server round-trip. NULL for users who never picked a gallery avatar
-- (legacy uploaded-photo avatars keep working via avatar_url alone).
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_character TEXT;
