-- lab_orders: local order records for third-party lab integrations.

CREATE TABLE IF NOT EXISTS lab_orders (
    id BIGSERIAL PRIMARY KEY,
    lab_name TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    api_key TEXT,
    api_secret TEXT,
    external_order_id TEXT,
    lab_request JSONB NOT NULL DEFAULT '{}'::jsonb,
    lab_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    lab_last_result JSONB,
    lab_final_result JSONB,
    status TEXT NOT NULL DEFAULT '待处理',
    last_polled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_orders_user_created
    ON lab_orders(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lab_orders_lab_external
    ON lab_orders(lab_name, external_order_id);

CREATE INDEX IF NOT EXISTS idx_lab_orders_status
    ON lab_orders(status);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_lab_orders_updated_at ON lab_orders;
CREATE TRIGGER update_lab_orders_updated_at
    BEFORE UPDATE ON lab_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
