-- Add roles system to users and link coaches to WeChat identity

ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT '{user}';
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_roles    ON users USING GIN(roles);
CREATE INDEX IF NOT EXISTS idx_coaches_user_id ON coaches(user_id);

-- Seed superadmins: echo and Pin
UPDATE users SET roles = '{user,superadmin}' WHERE user_id IN ('795fbe18', '37c8774e');
