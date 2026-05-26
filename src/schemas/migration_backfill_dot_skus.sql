-- Backfill SKUs for all Dot cartridges and bundle sets that exist in store_items
-- but have no sku_id. Also seeds warehouse stock and links store_items.sku_id.

-- 1. Insert missing SKUs
INSERT INTO skus (sku_code, name_zh, name_en, item_type, unit_zh, unit_en)
VALUES
  ('DOT01-CARTRIDGE', 'DOT01 · 细胞原力',               'DOT01 · Cellular Fuel',               'physical', '800 粒装', '800 dots'),
  ('DOT02-CARTRIDGE', 'DOT02 · 细胞守护',               'DOT02 · Cellular Guard',              'physical', '800 粒装', '800 dots'),
  ('DOT03-CARTRIDGE', 'DOT03 · 细胞催化',               'DOT03 · Cellular Catalyst',           'physical', '800 粒装', '800 dots'),
  ('DOT04-CARTRIDGE', 'DOT04 · 细胞净化',               'DOT04 · Cellular Cleanup',            'physical', '800 粒装', '800 dots'),
  ('DOT05-CARTRIDGE', 'DOT05 · 代谢韧性',               'DOT05 · Metabolic Resilience',        'physical', '800 粒装', '800 dots'),
  ('DOT06-CARTRIDGE', 'DOT06 · 紧致焕颜',               'DOT06 · Dermal Radiance',             'physical', '800 粒装', '800 dots'),
  ('DOT07-CARTRIDGE', 'DOT07 · 代谢动力',               'DOT07 · Metabolic Power',             'physical', '800 粒装', '800 dots'),
  ('DOT08-CARTRIDGE', 'DOT08 · 血管唤醒',               'DOT08 · Vascular Awakening',          'physical', '800 粒装', '800 dots'),
  ('DOT09-CARTRIDGE', 'DOT09 · 抗压支持',               'DOT09 · Resilience Support',          'physical', '800 粒装', '800 dots'),
  ('DOT10-CARTRIDGE', 'DOT10 · 晨间引擎',               'DOT10 · Morning Ignition',            'physical', '800 粒装', '800 dots'),
  ('DOT11-CARTRIDGE', 'DOT11 · 巅峰体能',               'DOT11 · Athletic Peak',               'physical', '800 粒装', '800 dots'),
  ('DOT12-CARTRIDGE', 'DOT12 · 深度睡眠与恢复',          'DOT12 · Deep Sleep and Recovery',     'physical', '800 粒装', '800 dots'),
  ('DOT13-CARTRIDGE', 'DOT13 · 微血管通流',              'DOT13 · Vascular Flow',               'physical', '800 粒装', '800 dots'),
  ('DOT14-CARTRIDGE', 'DOT14 · 微血管保护',              'DOT14 · Vascular Protection',         'physical', '800 粒装', '800 dots'),
  ('DOT15-CARTRIDGE', 'DOT15 · 禅意抗压共振',            'DOT15 · Zen and Stress Resonance',   'physical', '800 粒装', '800 dots'),
  ('DOT16-CARTRIDGE', 'DOT16 · 抗压防御',               'DOT16 · Resilience Defense',          'physical', '800 粒装', '800 dots'),
  ('DOT17-CARTRIDGE', 'DOT17 · 肠道屏障与微生态',        'DOT17 · Gut and Microbiome',          'physical', '800 粒装', '800 dots'),
  ('DOT18-CARTRIDGE', 'DOT18 · 免疫与胃部防御',          'DOT18 · Immunity and Gastric',        'physical', '800 粒装', '800 dots'),
  ('SET-CELLULAR-AGE',      '生物减龄套装 · 6 支',   'BioAge Reducing · 6 Cartridges',          'physical', '6 × 800 粒', '6 × 800 dots'),
  ('SET-COMPLETE-18',       '完整全套 · 18 支全收',  'Complete Collection · All 18 Cartridges',  'physical', '18 × 800 粒', '18 × 800 dots'),
  ('SET-METABOLIC-VASCULAR', '能量焕发套装 · 6 支',  'Energy Boost · 6 Cartridges',             'physical', '6 × 800 粒', '6 × 800 dots'),
  ('SET-RESILIENCE-AGE',    '系统调优套装 · 6 支',   'System Optimization · 6 Cartridges',      'physical', '6 × 800 粒', '6 × 800 dots')
ON CONFLICT (sku_code) DO NOTHING;

-- 2. Seed warehouse stock for each new SKU (10,000 units default)
INSERT INTO inventory_stock (sku_id, location_type, warehouse_name, quantity)
SELECT id, 'warehouse', 'shanghai-central', 10000
FROM skus
WHERE sku_code IN (
  'DOT01-CARTRIDGE','DOT02-CARTRIDGE','DOT03-CARTRIDGE','DOT04-CARTRIDGE',
  'DOT05-CARTRIDGE','DOT06-CARTRIDGE','DOT07-CARTRIDGE','DOT08-CARTRIDGE',
  'DOT09-CARTRIDGE','DOT10-CARTRIDGE','DOT11-CARTRIDGE','DOT12-CARTRIDGE',
  'DOT13-CARTRIDGE','DOT14-CARTRIDGE','DOT15-CARTRIDGE','DOT16-CARTRIDGE',
  'DOT17-CARTRIDGE','DOT18-CARTRIDGE',
  'SET-CELLULAR-AGE','SET-COMPLETE-18','SET-METABOLIC-VASCULAR','SET-RESILIENCE-AGE'
)
ON CONFLICT (sku_id, warehouse_name) WHERE location_type = 'warehouse' DO NOTHING;

-- 3. Link store_items to their new SKUs by matching key_name to sku_code pattern
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT01-CARTRIDGE')
  WHERE key_name = 'DOT01-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT02-CARTRIDGE')
  WHERE key_name = 'DOT02-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT03-CARTRIDGE')
  WHERE key_name = 'DOT03-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT04-CARTRIDGE')
  WHERE key_name = 'DOT04-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT05-CARTRIDGE')
  WHERE key_name = 'DOT05-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT06-CARTRIDGE')
  WHERE key_name = 'DOT06-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT07-CARTRIDGE')
  WHERE key_name = 'DOT07-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT08-CARTRIDGE')
  WHERE key_name = 'DOT08-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT09-CARTRIDGE')
  WHERE key_name = 'DOT09-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT10-CARTRIDGE')
  WHERE key_name = 'DOT10-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT11-CARTRIDGE')
  WHERE key_name = 'DOT11-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT12-CARTRIDGE')
  WHERE key_name = 'DOT12-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT13-CARTRIDGE')
  WHERE key_name = 'DOT13-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT14-CARTRIDGE')
  WHERE key_name = 'DOT14-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT15-CARTRIDGE')
  WHERE key_name = 'DOT15-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT16-CARTRIDGE')
  WHERE key_name = 'DOT16-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT17-CARTRIDGE')
  WHERE key_name = 'DOT17-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'DOT18-CARTRIDGE')
  WHERE key_name = 'DOT18-cartridge' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'SET-CELLULAR-AGE')
  WHERE key_name = 'set-cellular-age' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'SET-COMPLETE-18')
  WHERE key_name = 'set-complete-18' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'SET-METABOLIC-VASCULAR')
  WHERE key_name = 'set-metabolic-vascular' AND sku_id IS NULL;
UPDATE store_items SET sku_id = (SELECT id FROM skus WHERE sku_code = 'SET-RESILIENCE-AGE')
  WHERE key_name = 'set-resilience-age' AND sku_id IS NULL;

-- 4. Now all store_items should have sku_id — add NOT NULL constraint
ALTER TABLE store_items ALTER COLUMN sku_id SET NOT NULL;
