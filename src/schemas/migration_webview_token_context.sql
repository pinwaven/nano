-- Lets the miniapp attach an optional intent/reference payload (e.g. "open the store to buy
-- this specific committed dot formulation") to a minted webview token, carried through the
-- existing wvt -> exchange-webview-token -> GCN SSO handoff without a new endpoint.
ALTER TABLE webview_tokens ADD COLUMN IF NOT EXISTS context JSONB;
