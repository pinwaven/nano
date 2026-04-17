-- Migration: add phone and email columns to users table
-- Safe to run repeatedly (IF NOT EXISTS guards).

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- Optional: Create indexes if searching by phone or email is expected to be common
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
