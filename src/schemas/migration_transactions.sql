-- Transaction line items linked to order summaries.

ALTER TABLE orders
    ALTER COLUMN item_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'store',
    ADD COLUMN IF NOT EXISTS total_amount_cny INT,
    ADD COLUMN IF NOT EXISTS total_amount_usd INT,
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS transactions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id            VARCHAR(100) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    source             TEXT NOT NULL,
    lab_name           TEXT,
    item_type          TEXT NOT NULL DEFAULT 'lab_product',
    item_ref           TEXT,
    sku                TEXT NOT NULL,
    name_zh            TEXT NOT NULL,
    name_en            TEXT NOT NULL,
    unit_zh            TEXT,
    unit_en            TEXT,
    quantity           INT NOT NULL DEFAULT 1,
    unit_amount_cny    INT NOT NULL,
    total_amount_cny   INT NOT NULL,
    unit_amount_usd    INT,
    total_amount_usd   INT,
    status             TEXT NOT NULL DEFAULT 'pending',
    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_order_id
    ON transactions(order_id);

CREATE INDEX IF NOT EXISTS idx_transactions_user_status
    ON transactions(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_source
    ON transactions(source, lab_name, sku);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
