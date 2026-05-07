-- Channel admin access for web admin panel
-- Adds channel scoping to admin_accounts so channel admins can log in to
-- the web panel and see only their channel's data.
-- channels.config JSONB already exists and will hold {"admin_tabs": [...]}

ALTER TABLE admin_accounts
  ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_admin_accounts_channel_id ON admin_accounts(channel_id);

-- NULL channel_id means superadmin (full access). Existing accounts are unaffected.
