-- User delivery addresses for store/lab purchase fulfillment.

CREATE TABLE IF NOT EXISTS user_addresses (
    id            BIGSERIAL PRIMARY KEY,
    user_id       VARCHAR(100) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    contact_name  TEXT NOT NULL,
    phone         VARCHAR(40) NOT NULL,
    province      TEXT NOT NULL,
    city          TEXT NOT NULL,
    district      TEXT NOT NULL DEFAULT '',
    address_line1 TEXT NOT NULL,
    postal_code   VARCHAR(20),
    is_default    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_addresses_user_default
    ON user_addresses(user_id, is_default DESC, updated_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_addresses_updated_at ON user_addresses;
CREATE TRIGGER update_user_addresses_updated_at
    BEFORE UPDATE ON user_addresses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS address_id BIGINT REFERENCES user_addresses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS shipping_contact JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_address_id
    ON orders(address_id);
