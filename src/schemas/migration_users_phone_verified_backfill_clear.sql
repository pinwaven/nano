-- One-time cleanup for a data-integrity gap in handlePutUser (worker/handlers/users.js):
-- the admin panel's Edit User save wrote users.phone directly without ever clearing
-- phone_verified_at, so any account whose phone was edited/blanked via that form kept a
-- stale "verified" timestamp stamped against a phone it never actually re-verified via OTP.
-- Every phone_verified read (login.js, the nano->GCN webview SSO handoff) now also requires
-- phone IS NOT NULL, but existing rows with phone_verified_at set and phone still NULL (the
-- specific inconsistent state this bug could produce) are cleared here so they don't linger
-- indefinitely as dead, never-corrected state.
UPDATE users
SET phone_verified_at = NULL
WHERE phone IS NULL AND phone_verified_at IS NOT NULL;
