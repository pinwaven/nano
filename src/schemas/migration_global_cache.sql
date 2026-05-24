-- global_cache: shared cache/config storage for FC instances.

CREATE TABLE IF NOT EXISTS global_cache (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expired_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_global_cache_expired_at
    ON global_cache(expired_at);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_global_cache_updated_at ON global_cache;
CREATE TRIGGER update_global_cache_updated_at
    BEFORE UPDATE ON global_cache
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
