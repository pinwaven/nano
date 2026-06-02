-- lab_products: catalog of products/tests offered by lab providers.

CREATE TABLE IF NOT EXISTS lab_products (
    id              BIGSERIAL PRIMARY KEY,
    lab_name        TEXT NOT NULL,
    sku             TEXT NOT NULL,
    upc             TEXT,
    name_zh         TEXT NOT NULL,
    name_en         TEXT NOT NULL,
    desc_zh         TEXT,
    desc_en         TEXT,
    unit_zh         TEXT NOT NULL,
    unit_en         TEXT NOT NULL,
    extra_data_zh   JSONB NOT NULL DEFAULT '{}'::jsonb,
    extra_data_en   JSONB NOT NULL DEFAULT '{}'::jsonb,
    price_cny       INT NOT NULL, -- CNY fen
    price_usd       INT,          -- USD cents
    sort_idx        INT NOT NULL DEFAULT 0,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'lab_products'
          AND column_name = 'price_cny'
          AND data_type = 'numeric'
    ) THEN
        ALTER TABLE lab_products
            ALTER COLUMN price_cny TYPE INT USING ROUND(price_cny * 100)::INT;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'lab_products'
          AND column_name = 'price_usd'
          AND data_type = 'numeric'
    ) THEN
        ALTER TABLE lab_products
            ALTER COLUMN price_usd TYPE INT USING ROUND(price_usd * 100)::INT;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_products_lab_sku
    ON lab_products(lab_name, sku);

CREATE INDEX IF NOT EXISTS idx_lab_products_active_sort
    ON lab_products(active, sort_idx);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_lab_products_updated_at ON lab_products;
CREATE TRIGGER update_lab_products_updated_at
    BEFORE UPDATE ON lab_products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Seed QCS / 量康 lab product pricing from /tmp/AEVIVA检测价格体系.docx.
-- The source document only provides CNY market prices; price_usd is intentionally NULL.

INSERT INTO lab_products (
    lab_name,
    sku,
    upc,
    name_zh,
    name_en,
    desc_zh,
    desc_en,
    unit_zh,
    unit_en,
    extra_data_zh,
    extra_data_en,
    price_cny,
    price_usd,
    sort_idx,
    active
)
VALUES
    ('qcs', '3120', NULL, '慢性食物敏（20种IgG）', 'Chronic Food Sensitivity Panel (20 IgG Items)', '营养与代谢检测', 'Nutrition and Metabolism Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 60000, NULL, 1, TRUE),
    ('qcs', '3160', NULL, '慢性食物敏（50种IgG）', 'Chronic Food Sensitivity Panel (50 IgG Items)', '营养与代谢检测', 'Nutrition and Metabolism Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 150000, NULL, 2, TRUE),
    ('qcs', '3130', NULL, '慢性食物敏（120种IgG）', 'Chronic Food Sensitivity Panel (120 IgG Items)', '营养与代谢检测', 'Nutrition and Metabolism Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 380000, NULL, 3, TRUE),
    ('qcs', '3112', NULL, '急性食物过敏（39种IgE+总IgE ）', 'Acute Food Allergy Panel (39 IgE Items + Total IgE)', '营养与代谢检测', 'Nutrition and Metabolism Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 120000, NULL, 4, TRUE),
    ('qcs', '6001', NULL, '医疗版肠道菌群基因测序（需填写肠道问卷）', 'Medical Gut Microbiome Gene Sequencing (Gut Questionnaire Required)', '营养与代谢检测', 'Nutrition and Metabolism Testing', '1项', '1 test', '{"sample":"粪便"}'::jsonb, '{"sample":"Stool"}'::jsonb, 198000, NULL, 5, TRUE),
    ('qcs', '3038', NULL, '营养与重毒性元素分析（39项+6项比值）', 'Nutritional and Toxic Element Analysis (39 Items + 6 Ratios)', '营养与代谢检测', 'Nutrition and Metabolism Testing', '1项', '1 test', '{"sample":"头发"}'::jsonb, '{"sample":"Hair"}'::jsonb, 120000, NULL, 6, TRUE),
    ('qcs', '3014', NULL, '全套新陈代谢分析（有机酸75项）', 'Comprehensive Metabolism Analysis (75 Organic Acids)', '营养与代谢检测', 'Nutrition and Metabolism Testing', '1项', '1 test', '{"sample":"尿液"}'::jsonb, '{"sample":"Urine"}'::jsonb, 380000, NULL, 7, TRUE),
    ('qcs', '3050', NULL, '雌激素代谢分析', 'Estrogen Metabolism Analysis', '内分泌检测', 'Endocrine Testing', '1项', '1 test', '{"sample":"尿液"}'::jsonb, '{"sample":"Urine"}'::jsonb, 150000, NULL, 8, TRUE),
    ('qcs', '3013', NULL, '环境荷尔蒙', 'Environmental Hormone Assessment', '内分泌检测', 'Endocrine Testing', '1项', '1 test', '{"sample":"尿液"}'::jsonb, '{"sample":"Urine"}'::jsonb, 230000, NULL, 9, TRUE),
    ('qcs', '3040', NULL, '抗压力荷尔蒙评估', 'Stress Hormone Assessment', '内分泌检测', 'Endocrine Testing', '1项', '1 test', '{"sample":"唾液棉棒×5"}'::jsonb, '{"sample":"Saliva swabs x5"}'::jsonb, 250000, NULL, 10, TRUE),
    ('qcs', '1012', NULL, 'NAD+检测', 'NAD+ Test', '长寿管理检测', 'Longevity Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 85000, NULL, 11, TRUE),
    ('qcs', '2046', NULL, '甲基化年龄检测', 'Methylation Age Test', '长寿管理检测', 'Longevity Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 120000, NULL, 12, TRUE),
    ('qcs', '2047', NULL, '端粒长度检测', 'Telomere Length Test', '长寿管理检测', 'Longevity Management Testing', '1项', '1 test', '{"sample":"唾液"}'::jsonb, '{"sample":"Saliva"}'::jsonb, 198000, NULL, 13, TRUE),
    ('qcs', '1011', NULL, '免疫年龄评估', 'Immune Age Assessment', '长寿管理检测', 'Longevity Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 198000, NULL, 14, TRUE),
    ('qcs', '1010', NULL, '肝脏健康评估', 'Liver Health Assessment', '长寿管理检测', 'Longevity Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 198000, NULL, 15, TRUE),
    ('qcs', '1009', NULL, '卵巢年龄评估（AMH）', 'Ovarian Age Assessment (AMH)', '长寿管理检测', 'Longevity Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 30000, NULL, 16, TRUE),
    ('qcs', '1001', NULL, '糖化血红蛋白', 'Hemoglobin A1c', '慢病管理检测', 'Chronic Disease Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 20000, NULL, 17, TRUE),
    ('qcs', '1002', NULL, '同型半胱氨酸', 'Homocysteine', '慢病管理检测', 'Chronic Disease Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 20000, NULL, 18, TRUE),
    ('qcs', '1003', NULL, '25羟基维生素D', '25-Hydroxy Vitamin D', '慢病管理检测', 'Chronic Disease Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 30000, NULL, 19, TRUE),
    ('qcs', '1005', NULL, '慢病风险二项（同型半胱氨酸+尿酸）', 'Chronic Disease Risk Duo (Homocysteine + Uric Acid)', '慢病管理检测', 'Chronic Disease Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 22500, NULL, 20, TRUE),
    ('qcs', '1008', NULL, '慢病风险四项（糖化血红蛋白+维生素D+同型半胱氨酸+尿酸）', 'Chronic Disease Risk Quartet (HbA1c + Vitamin D + Homocysteine + Uric Acid)', '慢病管理检测', 'Chronic Disease Management Testing', '1项', '1 test', '{"sample":"干血卡片"}'::jsonb, '{"sample":"Dried blood spot card"}'::jsonb, 65000, NULL, 21, TRUE),
    ('qcs', '2017', NULL, '个人全基因组测序', 'Personal Whole Genome Sequencing', '基因检测', 'Genetic Testing', '1项', '1 test', '{"sample":"唾液"}'::jsonb, '{"sample":"Saliva"}'::jsonb, 2800000, NULL, 22, TRUE),
    ('qcs', '2018', NULL, '个人基因组全外显子测序', 'Personal Whole Exome Sequencing', '基因检测', 'Genetic Testing', '1项', '1 test', '{"sample":"唾液"}'::jsonb, '{"sample":"Saliva"}'::jsonb, 1600000, NULL, 23, TRUE),
    ('qcs', '1168', NULL, '精准基因检测（70万位点）1980项', 'Precision Genetic Test (700,000 Sites, 1,980 Items)', '基因检测', 'Genetic Testing', '1项', '1 test', '{"sample":"唾液"}'::jsonb, '{"sample":"Saliva"}'::jsonb, 598000, NULL, 24, TRUE),
    ('qcs', '2032', NULL, '个人健康体检基因检测（62个位点女75项）', 'Personal Health Check Genetic Test (62 Sites, 75 Female Items)', '基因检测', 'Genetic Testing', '1项', '1 test', '{"sample":"唾液/口腔拭子"}'::jsonb, '{"sample":"Saliva/oral swab"}'::jsonb, 120000, NULL, 25, TRUE),
    ('qcs', '2033', NULL, '个人健康体检基因检测（57个位点男73项）', 'Personal Health Check Genetic Test (57 Sites, 73 Male Items)', '基因检测', 'Genetic Testing', '1项', '1 test', '{"sample":"唾液/口腔拭子"}'::jsonb, '{"sample":"Saliva/oral swab"}'::jsonb, 120000, NULL, 26, TRUE),
    ('qcs', '2040', NULL, '血脂代谢基因（APOE）', 'Lipid Metabolism Gene Test (APOE)', '基因检测', 'Genetic Testing', '1项', '1 test', '{"sample":"干血卡片/口腔拭子"}'::jsonb, '{"sample":"Dried blood spot card/oral swab"}'::jsonb, 40000, NULL, 27, TRUE),
    ('qcs', '2001', NULL, 'MTHFR基因（叶酸代谢）', 'MTHFR Gene Test (Folate Metabolism)', '基因检测', 'Genetic Testing', '1项', '1 test', '{"sample":"干血卡片/口腔拭子"}'::jsonb, '{"sample":"Dried blood spot card/oral swab"}'::jsonb, 40000, NULL, 28, TRUE),
    ('qcs', '2024', NULL, '酒精代谢基因（乙醇、乙 醛脱氢酶突变基因）', 'Alcohol Metabolism Gene Test (Alcohol and Aldehyde Dehydrogenase Variants)', '基因检测', 'Genetic Testing', '1项', '1 test', '{"sample":"干血卡片/口腔拭子"}'::jsonb, '{"sample":"Dried blood spot card/oral swab"}'::jsonb, 55000, NULL, 29, TRUE),
    ('qcs', '6006', NULL, '口腔菌群基因测序', 'Oral Microbiome Gene Sequencing', '基因检测', 'Genetic Testing', '1项', '1 test', '{"sample":"口腔菌群拭子"}'::jsonb, '{"sample":"Oral microbiome swab"}'::jsonb, 168000, NULL, 30, TRUE)
ON CONFLICT (lab_name, sku) DO UPDATE SET
    upc = EXCLUDED.upc,
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    desc_zh = EXCLUDED.desc_zh,
    desc_en = EXCLUDED.desc_en,
    unit_zh = EXCLUDED.unit_zh,
    unit_en = EXCLUDED.unit_en,
    extra_data_zh = EXCLUDED.extra_data_zh,
    extra_data_en = EXCLUDED.extra_data_en,
    price_cny = EXCLUDED.price_cny,
    price_usd = EXCLUDED.price_usd,
    sort_idx = EXCLUDED.sort_idx,
    active = EXCLUDED.active;
