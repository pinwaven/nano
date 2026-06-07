-- Waven Nano SQL Migration: SKU and Order Fulfillment System
-- Targets Aliyun PolarDB Serverless (PostgreSQL 14 compatible)

-- 1. Standard SKUs Registry
CREATE TABLE IF NOT EXISTS skus (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_code    VARCHAR(100) UNIQUE NOT NULL,      -- e.g. WD-DOT01, KINO-CHIP-V2
    name_zh     TEXT NOT NULL,
    name_en     TEXT NOT NULL,
    desc_zh     TEXT,
    desc_en     TEXT,
    item_type   VARCHAR(50) NOT NULL DEFAULT 'physical', -- 'physical' | 'virtual'
    unit_zh     VARCHAR(50) NOT NULL DEFAULT '个',
    unit_en     VARCHAR(50) NOT NULL DEFAULT 'pcs',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed basic SKUs representing our active core inventory
INSERT INTO skus (sku_code, name_zh, name_en, desc_zh, desc_en, item_type, unit_zh, unit_en)
VALUES
    ('KINO-CHIP-V2', 'Kino 生物标志物检测芯片', 'Kino Biomarker Test Chip', '单次检测 · 6项关键生物标志物 · 含生理年龄报告', 'Single test · 6 key biomarkers · Includes Bio Age report', 'physical', '片', 'chip'),
    ('WD-DOT-MONTHLY', 'Waven Dots 月供精密营养舱', 'Waven Dots Monthly Supply', '个性化营养方案 · 30天供应量', 'Personalized nutrition plan · 30-day supply', 'physical', '盒', 'box')
ON CONFLICT (sku_code) DO NOTHING;

-- 2. Multi-Location Stock Tracking
CREATE TABLE IF NOT EXISTS inventory_stock (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_id              UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
    location_type       VARCHAR(50) NOT NULL, -- 'channel' | 'warehouse'
    channel_id          INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    warehouse_name      VARCHAR(100),         -- 'shanghai-central', etc.
    quantity            INTEGER,              -- NULL = unlimited
    low_stock_threshold INTEGER DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint indices for Location + SKU
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_channel ON inventory_stock (sku_id, channel_id) WHERE location_type = 'channel';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_warehouse ON inventory_stock (sku_id, warehouse_name) WHERE location_type = 'warehouse';

-- Seed default stock for global central warehouse so checkout of main store items is immediately available
INSERT INTO inventory_stock (sku_id, location_type, warehouse_name, quantity)
SELECT id, 'warehouse', 'shanghai-central', 10000 FROM skus
ON CONFLICT (sku_id, warehouse_name) WHERE location_type = 'warehouse' DO NOTHING;

-- 3. Link Catalog listings to SKU registry (for centralized inventory checks)
ALTER TABLE store_items ADD COLUMN IF NOT EXISTS sku_id UUID REFERENCES skus(id) ON DELETE SET NULL;
ALTER TABLE channel_inventory_items ADD COLUMN IF NOT EXISTS sku_id UUID REFERENCES skus(id) ON DELETE SET NULL;

-- Backfill existing default listings
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'KINO-CHIP-V2' LIMIT 1) WHERE key_name = 'kino-chip-1';
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'KINO-CHIP-V2' LIMIT 1) WHERE key_name = 'kino-chip-3';
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'WD-DOT-MONTHLY' LIMIT 1) WHERE key_name = 'dots-monthly';

-- 4. Extend orders table with shipping, payment, SKU, and tracking columns
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_carrier TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sku_id UUID REFERENCES skus(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'wechat_pay';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'paid'; -- 'unpaid', 'paid', 'refunded', 'cancelled'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilled_assets JSONB; -- e.g., ["KNC12345678-0001"] or ["SIM-DOT01-x"]
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
