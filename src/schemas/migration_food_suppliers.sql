-- Grocery catalogs the AI may point a user at when it gives diet advice. CLAUDE.md §44.
--
-- SUPPLIER-GENERIC ON PURPOSE. The first catalog is 盒马 (scraped from the app, temp/hema/), but a
-- second supermarket is a second `food_suppliers` row plus rows in `supplier_products` — not a
-- second table, a second tool or a second chat card. Everything downstream (the
-- get_grocery_products tool, the recommend_grocery action tail, the :::grocery card) is keyed on
-- (supplier_key, product_id) and reads the supplier's display copy from `food_suppliers`.
--
-- WHY NOT store_items / GCN. These are not things we sell: no price we control, no stock, no
-- checkout. The user opens the supplier's own app and orders there. So the catalog is a plain
-- reference table — no order path, no sku, and the price is a snapshot (`scraped_at`) the card
-- labels as such, never a quote.
--
-- IDENTITY. product_id is the supplier's stable handle (for 盒马 the scraper's md5 of the
-- normalised name). A recommend_grocery entry that resolves to no active row is DROPPED, never
-- guessed onto a neighbour — the same rule as §11's key_name.
--
-- is_food is the diet-relevance gate: flowers, plants and alcohol are in the scrape and out of
-- every recommendation. Set by the import script from category/name; a human may override it.

CREATE TABLE IF NOT EXISTS food_suppliers (
    supplier_key  TEXT PRIMARY KEY,                -- 'hema'
    name_zh       TEXT NOT NULL,                   -- 盒马
    name_en       TEXT,
    app_name_zh   TEXT NOT NULL,                   -- 盒马 App — what the card tells the user to open
    store_note    TEXT,                            -- which store the prices were read from
    tap_hint_zh   TEXT,                            -- toast after copying a product name
    tap_hint_en   TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    config        JSONB NOT NULL DEFAULT '{}',     -- future: mini-program appId/path for deep links
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_products (
    supplier_key  TEXT NOT NULL REFERENCES food_suppliers(supplier_key) ON DELETE CASCADE,
    product_id    TEXT NOT NULL,
    name          TEXT NOT NULL,
    price         NUMERIC(10,2),
    unit          TEXT,
    price_raw     TEXT[] NOT NULL DEFAULT '{}',
    tags          TEXT[] NOT NULL DEFAULT '{}',    -- normalised: rank suffixes stripped, delivery chips dropped
    categories    JSONB  NOT NULL DEFAULT '[]',    -- [["蔬菜豆制品","叶菜/花菜"], …] — full membership, a product can sit in several
    category      TEXT,                            -- first top-level category, for filtering
    image_url     TEXT,                            -- OSS, long-lived
    is_food       BOOLEAN NOT NULL DEFAULT TRUE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    scraped_at    TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (supplier_key, product_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_food
    ON supplier_products (supplier_key, is_food, is_active);

INSERT INTO food_suppliers (supplier_key, name_zh, name_en, app_name_zh, store_note, tap_hint_zh, tap_hint_en)
VALUES ('hema', '盒马', 'Hema', '盒马 App', '上海徐汇 · 裕德路店（2026-09-17 抓取）',
        '已复制商品名，打开盒马 App 搜索即可下单', 'Name copied — search for it in the Hema app to order')
ON CONFLICT (supplier_key) DO NOTHING;
