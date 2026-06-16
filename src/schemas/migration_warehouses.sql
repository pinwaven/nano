-- Warehouse registry: named physical locations with addresses.
-- warehouse_name in inventory_stock matches warehouses.name.
CREATE TABLE IF NOT EXISTS warehouses (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    address     TEXT,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the existing hard-coded warehouse so stock entries stay linked.
INSERT INTO warehouses (name, address)
VALUES ('shanghai-central', NULL)
ON CONFLICT (name) DO NOTHING;
