-- SKU variant system: parent-child relationships for products with size/color/etc. variants.
-- A "parent" SKU (is_parent = TRUE) groups multiple child/variant SKUs under one product concept.
-- Children store their distinguishing attributes in the attributes JSONB column.
-- Stock tracking lives only at the leaf (child / standalone) level — parent SKUs hold no stock.
ALTER TABLE skus ADD COLUMN IF NOT EXISTS parent_sku_id UUID REFERENCES skus(id) ON DELETE SET NULL;
ALTER TABLE skus ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}';
ALTER TABLE skus ADD COLUMN IF NOT EXISTS is_parent BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_skus_parent ON skus(parent_sku_id) WHERE parent_sku_id IS NOT NULL;
