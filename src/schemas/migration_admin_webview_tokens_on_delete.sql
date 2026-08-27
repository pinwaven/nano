-- Deleting an admin account failed silently when admin_webview_tokens rows
-- referenced it (the GCN admin-embed handoff mints one per embed open; they are
-- single-use with a 60s expiry, so they are dead weight the moment the account
-- goes). Re-create the FK with ON DELETE CASCADE so account deletion sweeps
-- them. CASCADE, not SET NULL: a NULL admin_account_id is the shape of a
-- superadmin-minted token (see migration_admin_webview_tokens.sql), and orphan
-- channel tokens must not drift into looking like that.
ALTER TABLE admin_webview_tokens
    DROP CONSTRAINT IF EXISTS admin_webview_tokens_admin_account_id_fkey;

ALTER TABLE admin_webview_tokens
    ADD CONSTRAINT admin_webview_tokens_admin_account_id_fkey
    FOREIGN KEY (admin_account_id) REFERENCES admin_accounts(id) ON DELETE CASCADE;
