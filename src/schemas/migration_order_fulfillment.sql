-- Order fulfillment fields used by admin shipment workflows.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS tracking_number TEXT,
    ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_status_created
    ON orders(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_tracking_number
    ON orders(tracking_number)
    WHERE tracking_number IS NOT NULL;
