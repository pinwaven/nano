-- Store items catalog
CREATE TABLE IF NOT EXISTS store_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_name    VARCHAR(100) NOT NULL UNIQUE,
    name_zh     TEXT NOT NULL,
    name_en     TEXT NOT NULL,
    desc_zh     TEXT NOT NULL,
    desc_en     TEXT NOT NULL,
    unit_zh     VARCHAR(50) NOT NULL,
    unit_en     VARCHAR(50) NOT NULL,
    price_cny   NUMERIC(10,2) NOT NULL,
    price_usd   NUMERIC(10,2) NOT NULL,
    tag         VARCHAR(50),
    sort_order  INT NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed products
INSERT INTO store_items (key_name, name_zh, name_en, desc_zh, desc_en, unit_zh, unit_en, price_cny, price_usd, tag, sort_order)
VALUES
    ('kino-chip-1',
     'Kino 生物标志物检测芯片',
     'Kino Biomarker Test Chip',
     '单次检测 · 6项关键生物标志物 · 含生物年龄报告',
     'Single test · 6 key biomarkers · Includes Bio Age report',
     '1 片', '1 chip',
     298.00, 39.99,
     'bestseller', 1),

    ('kino-chip-3',
     'Kino 检测芯片 三件套',
     'Kino Test Chip 3-Pack',
     '三次检测套装 · 追踪长期健康趋势',
     'Three tests · Track your health trends over time',
     '3 片', '3 chips',
     798.00, 99.99,
     'value', 2),

    ('dots-monthly',
     'Waven Dots 月供套装',
     'Waven Dots Monthly Supply',
     '个性化营养方案 · 30天供应量',
     'Personalized nutrition plan · 30-day supply',
     '1 盒', '1 box',
     388.00, 49.99,
     NULL, 3)
ON CONFLICT (key_name) DO NOTHING;

-- Orders placed by users
CREATE TABLE IF NOT EXISTS orders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     VARCHAR(100) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    item_id     UUID NOT NULL REFERENCES store_items(id),
    item_key    VARCHAR(100) NOT NULL,
    quantity    INT NOT NULL DEFAULT 1,
    price_cny   NUMERIC(10,2) NOT NULL,
    price_usd   NUMERIC(10,2) NOT NULL,
    status      VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);
