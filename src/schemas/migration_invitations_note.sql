-- Add an optional free-text note/label to invitation codes so coaches can
-- record what each code is for (e.g. "WeChat group A", "Spring promo").
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS note TEXT DEFAULT NULL;
