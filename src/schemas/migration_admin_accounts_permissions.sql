ALTER TABLE admin_accounts
  ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT '{}';
