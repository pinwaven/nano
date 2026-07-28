-- Migration: Replace dots lineup with the new formulation set from dots/dots-new.md
-- Renames key_name DOT01..DOT18 -> DOT-N1..DOT-N18 (positional/numeric correspondence),
-- refreshes name/ingredients/description/timing/coating, adds target_dots_min/max columns.
--
-- sub_age_target mapping is a best-effort product judgment call (approved 2026-07-25):
-- several new dots (eye health, cognition) have no natural BioAge dimension and are left NULL.
-- color/color_zh/color_hex/group_name/group_name_zh are intentionally left untouched --
-- dots-new.md defines no replacement branding/grouping data.

ALTER TABLE dots ADD COLUMN IF NOT EXISTS target_dots_min INTEGER;
ALTER TABLE dots ADD COLUMN IF NOT EXISTS target_dots_max INTEGER;

-- DOT-N1 Methyl Balance
UPDATE dots SET
  key_name = 'DOT-N1',
  name = 'Methyl Balance',
  name_zh = '甲基平衡',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Micro-Vascular Age',
  sub_age_target_zh = '微血管年龄',
  ingredients_summary = 'Cyanocobalamin (B12) / 氰钴胺, 5-MTHF / 5-甲基四氢叶酸, P5P (B6) / 活性维生素B6, NAC / N-乙酰半胱氨酸',
  description = 'Lowers homocysteine via B12, active folate, and B6, with NAC supporting a second clearance pathway.',
  target_dots_min = 1,
  target_dots_max = 2,
  ingredients = '[{"mg":1,"name":"Cyanocobalamin (B12)"},{"mg":1,"name":"5-MTHF"},{"mg":5,"name":"P5P (B6)"},{"mg":12,"name":"NAC"}]',
  ingredients_zh = '[{"mg":1,"name":"氰钴胺"},{"mg":1,"name":"5-甲基四氢叶酸"},{"mg":5,"name":"活性维生素B6"},{"mg":12,"name":"N-乙酰半胱氨酸"}]'
WHERE key_name = 'DOT01';

-- DOT-N2 Bone-Vascular Sync
UPDATE dots SET
  key_name = 'DOT-N2',
  name = 'Bone-Vascular Sync',
  name_zh = '骨脉同步',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Micro-Vascular Age',
  sub_age_target_zh = '微血管年龄',
  ingredients_summary = 'Vitamin D3 / 维生素D3, Vitamin K2 (MK-7) / 维生素K2, Zinc Bisglycinate / 甘氨酸锌, Copper Bisglycinate / 甘氨酸铜',
  description = 'D3 and K2 work together to build bone density while directing calcium away from arteries.',
  target_dots_min = 5,
  target_dots_max = 10,
  ingredients = '[{"mg":0.01,"name":"Vitamin D3"},{"mg":0.02,"name":"Vitamin K2 (MK-7)"},{"mg":15,"name":"Zinc Bisglycinate"},{"mg":1.2,"name":"Copper Bisglycinate"}]',
  ingredients_zh = '[{"mg":0.01,"name":"维生素D3"},{"mg":0.02,"name":"维生素K2 (MK-7)"},{"mg":15,"name":"甘氨酸锌"},{"mg":1.2,"name":"甘氨酸铜"}]'
WHERE key_name = 'DOT02';

-- DOT-N3 Quiet Mind
UPDATE dots SET
  key_name = 'DOT-N3',
  name = 'Quiet Mind',
  name_zh = '静心夜',
  is_isolate = false,
  timing = 'Evening',
  coating = 'gastric',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  ingredients_summary = 'Magnesium Glycinate / 甘氨酸镁, Ashwagandha Extract / 睡茄提取物, Saffron Extract / 藏红花提取物',
  description = 'Three complementary pathways -- magnesium, ashwagandha, and saffron -- for deeper, more restorative sleep.',
  target_dots_min = 3,
  target_dots_max = 5,
  ingredients = '[{"mg":10,"name":"Magnesium Glycinate"},{"mg":8,"name":"Ashwagandha Extract"},{"mg":6,"name":"Saffron Extract"}]',
  ingredients_zh = '[{"mg":10,"name":"甘氨酸镁"},{"mg":8,"name":"睡茄提取物"},{"mg":6,"name":"藏红花提取物"}]'
WHERE key_name = 'DOT03';

-- DOT-N4 Steady Energy
UPDATE dots SET
  key_name = 'DOT-N4',
  name = 'Steady Energy',
  name_zh = '持续精力',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  ingredients_summary = 'Rhodiola Rosea Extract / 红景天提取物, L-Theanine / L-茶氨酸',
  description = 'A caffeine-free companion that builds fatigue resistance over weeks and smooths out your regular coffee or tea.',
  target_dots_min = 13,
  target_dots_max = 42,
  ingredients = '[{"mg":16,"name":"Rhodiola Rosea Extract"},{"mg":8,"name":"L-Theanine"}]',
  ingredients_zh = '[{"mg":16,"name":"红景天提取物"},{"mg":8,"name":"L-茶氨酸"}]'
WHERE key_name = 'DOT04';

-- DOT-N5 Vagal Tone
UPDATE dots SET
  key_name = 'DOT-N5',
  name = 'Vagal Tone',
  name_zh = '迷走张力',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  ingredients_summary = 'Coenzyme Q10 / 辅酶Q10, PQQ / 吡咯喹啉醌',
  description = 'CoQ10 maintains existing mitochondria while PQQ signals the creation of new ones, supporting heart-rate variability.',
  target_dots_min = 7,
  target_dots_max = 20,
  ingredients = '[{"mg":15,"name":"Coenzyme Q10"},{"mg":5,"name":"PQQ"}]',
  ingredients_zh = '[{"mg":15,"name":"辅酶Q10"},{"mg":5,"name":"吡咯喹啉醌"}]'
WHERE key_name = 'DOT05';

-- DOT-N6 Mito Renew
UPDATE dots SET
  key_name = 'DOT-N6',
  name = 'Mito Renew',
  name_zh = '线粒体焕新',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  ingredients_summary = 'Urolithin A / 尿石素A, Spermidine / 亚精胺',
  description = 'Triggers mitophagy to clear damaged mitochondria and supports broader cellular autophagy.',
  target_dots_min = 25,
  target_dots_max = 50,
  ingredients = '[{"mg":20,"name":"Urolithin A"},{"mg":0.05,"name":"Spermidine"}]',
  ingredients_zh = '[{"mg":20,"name":"尿石素A"},{"mg":0.05,"name":"亚精胺"}]'
WHERE key_name = 'DOT06';

-- DOT-N7 Senescence Clear
UPDATE dots SET
  key_name = 'DOT-N7',
  name = 'Senescence Clear',
  name_zh = '衰老清除',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  ingredients_summary = 'Fisetin / 漆黄素, Piperine / 胡椒碱',
  description = 'A senolytic pulse protocol -- 2 consecutive days per month only, not a daily dose -- that clears senescent cells.',
  target_dots_min = 0,
  target_dots_max = 50,
  ingredients = '[{"mg":20,"name":"Fisetin"},{"mg":1,"name":"Piperine"}]',
  ingredients_zh = '[{"mg":20,"name":"漆黄素"},{"mg":1,"name":"胡椒碱"}]'
WHERE key_name = 'DOT07';

-- DOT-N8 Macular Guard (no BioAge dimension fit)
UPDATE dots SET
  key_name = 'DOT-N8',
  name = 'Macular Guard',
  name_zh = '明眸',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = NULL,
  sub_age_target_zh = NULL,
  ingredients_summary = 'Lutein / 叶黄素, Zeaxanthin / 玉米黄质',
  description = 'The AREDS2-matched 5:1 lutein-to-zeaxanthin ratio for long-term eye health, in a single daily dot.',
  target_dots_min = 1,
  target_dots_max = 1,
  ingredients = '[{"mg":10,"name":"Lutein"},{"mg":2,"name":"Zeaxanthin"}]',
  ingredients_zh = '[{"mg":10,"name":"叶黄素"},{"mg":2,"name":"玉米黄质"}]'
WHERE key_name = 'DOT08';

-- DOT-N9 NAD Renew
UPDATE dots SET
  key_name = 'DOT-N9',
  name = 'NAD Renew',
  name_zh = 'NAD焕新',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  ingredients_summary = 'NMN / β-烟酰胺单核苷酸, TMG (Betaine) / 三甲基甘氨酸',
  description = 'A direct NAD+ precursor paired with a methyl-donor buffer to support sirtuin activity and DNA repair.',
  target_dots_min = 14,
  target_dots_max = 56,
  ingredients = '[{"mg":18,"name":"NMN"},{"mg":4,"name":"TMG (Betaine)"}]',
  ingredients_zh = '[{"mg":18,"name":"β-烟酰胺单核苷酸"},{"mg":4,"name":"三甲基甘氨酸"}]'
WHERE key_name = 'DOT09';

-- DOT-N10 Radiant Skin
UPDATE dots SET
  key_name = 'DOT-N10',
  name = 'Radiant Skin',
  name_zh = '肌光焕采',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  ingredients_summary = 'Astaxanthin / 虾青素, Rice-Derived Ceramides / 神经酰胺',
  description = 'Astaxanthin''s antioxidant protection paired with ceramides that rebuild the skin''s moisture barrier.',
  target_dots_min = 1,
  target_dots_max = 1,
  ingredients = '[{"mg":8,"name":"Astaxanthin"},{"mg":2,"name":"Rice-Derived Ceramides"}]',
  ingredients_zh = '[{"mg":8,"name":"虾青素"},{"mg":2,"name":"神经酰胺"}]'
WHERE key_name = 'DOT10';

-- DOT-N11 Metabolic Renew
UPDATE dots SET
  key_name = 'DOT-N11',
  name = 'Metabolic Renew',
  name_zh = '代谢焕新',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Metabolic Age',
  sub_age_target_zh = '代谢年龄',
  ingredients_summary = 'Berberine / 小檗碱, Glucoraphanin + Myrosinase / 萝卜硫苷+黑芥子酶复合物',
  description = 'Berberine activates AMPK for glucose and lipid control, paired with a broccoli-sprout Nrf2 activator.',
  target_dots_min = 25,
  target_dots_max = 70,
  ingredients = '[{"mg":21,"name":"Berberine"},{"mg":1,"name":"Glucoraphanin + Myrosinase"}]',
  ingredients_zh = '[{"mg":21,"name":"小檗碱"},{"mg":1,"name":"萝卜硫苷+黑芥子酶复合物"}]'
WHERE key_name = 'DOT11';

-- DOT-N12 Sharp Mind (no BioAge dimension fit)
UPDATE dots SET
  key_name = 'DOT-N12',
  name = 'Sharp Mind',
  name_zh = '敏锐心智',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = NULL,
  sub_age_target_zh = NULL,
  ingredients_summary = 'Citicoline / 胞磷胆碱, Huperzine A / 石杉碱甲',
  description = 'Citicoline builds the acetylcholine memory and learning depend on; huperzine A slows its breakdown.',
  target_dots_min = 12,
  target_dots_max = 25,
  ingredients = '[{"mg":20,"name":"Citicoline"},{"mg":0.008,"name":"Huperzine A"}]',
  ingredients_zh = '[{"mg":20,"name":"胞磷胆碱"},{"mg":0.008,"name":"石杉碱甲"}]'
WHERE key_name = 'DOT12';

-- DOT-N13 Gut Renew
UPDATE dots SET
  key_name = 'DOT-N13',
  name = 'Gut Renew',
  name_zh = '肠道焕新',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  ingredients_summary = 'Bacillus coagulans / 凝结芽孢杆菌, Bacillus subtilis / 枯草芽孢杆菌',
  description = 'Heat- and acid-tolerant spore-forming probiotics that support gut barrier integrity and reduce GI symptoms.',
  target_dots_min = 1,
  target_dots_max = 2,
  ingredients = '[{"mg":15,"name":"Bacillus coagulans"},{"mg":6,"name":"Bacillus subtilis"}]',
  ingredients_zh = '[{"mg":15,"name":"凝结芽孢杆菌"},{"mg":6,"name":"枯草芽孢杆菌"}]'
WHERE key_name = 'DOT13';

-- DOT-N14 Immune Resilience
UPDATE dots SET
  key_name = 'DOT-N14',
  name = 'Immune Resilience',
  name_zh = '免疫韧性',
  is_isolate = true,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  ingredients_summary = 'Beta-Glucan / β-葡聚糖',
  description = 'Yeast-derived beta-glucan shown to reduce the frequency and severity of upper respiratory infections.',
  target_dots_min = 12,
  target_dots_max = 25,
  ingredients = '[{"mg":20,"name":"Beta-Glucan"}]',
  ingredients_zh = '[{"mg":20,"name":"β-葡聚糖"}]'
WHERE key_name = 'DOT14';

-- DOT-N15 Glycation Guard
UPDATE dots SET
  key_name = 'DOT-N15',
  name = 'Glycation Guard',
  name_zh = '抗糖化防护',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Metabolic Age',
  sub_age_target_zh = '代谢年龄',
  ingredients_summary = 'L-Carnosine / L-肌肽, Benfotiamine / 苯磷硫胺, P5P (B6) / 活性维生素B6',
  description = 'Targets glycation and AGE formation -- the sugar-driven damage to collagen and proteins -- at a high-dot dose.',
  target_dots_min = 56,
  target_dots_max = 100,
  ingredients = '[{"mg":18,"name":"L-Carnosine"},{"mg":4,"name":"Benfotiamine"},{"mg":1,"name":"P5P (B6)"}]',
  ingredients_zh = '[{"mg":18,"name":"L-肌肽"},{"mg":4,"name":"苯磷硫胺"},{"mg":1,"name":"活性维生素B6"}]'
WHERE key_name = 'DOT15';

-- DOT-N16 Cardio Signal
UPDATE dots SET
  key_name = 'DOT-N16',
  name = 'Cardio Signal',
  name_zh = '心血管信号',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Micro-Vascular Age',
  sub_age_target_zh = '微血管年龄',
  ingredients_summary = 'Pterostilbene / 紫檀芪, Quercetin / 槲皮素',
  description = 'A bioavailable resveratrol analog studied for blood pressure support, with quercetin as a complementary polyphenol.',
  target_dots_min = 3,
  target_dots_max = 13,
  ingredients = '[{"mg":18,"name":"Pterostilbene"},{"mg":4,"name":"Quercetin"}]',
  ingredients_zh = '[{"mg":18,"name":"紫檀芪"},{"mg":4,"name":"槲皮素"}]'
WHERE key_name = 'DOT16';

-- DOT-N17 Cholesterol Balance
UPDATE dots SET
  key_name = 'DOT-N17',
  name = 'Cholesterol Balance',
  name_zh = '血脂平衡',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Metabolic Age',
  sub_age_target_zh = '代谢年龄',
  ingredients_summary = 'Plant Sterol Esters / 植物固醇酯, Tocotrienols / 生育三烯醇',
  description = 'FDA-recognized plant sterol esters that competitively block cholesterol absorption and lower LDL.',
  target_dots_min = 42,
  target_dots_max = 130,
  ingredients = '[{"mg":19,"name":"Plant Sterol Esters"},{"mg":2,"name":"Tocotrienols"}]',
  ingredients_zh = '[{"mg":19,"name":"植物固醇酯"},{"mg":2,"name":"生育三烯醇"}]'
WHERE key_name = 'DOT17';

-- DOT-N18 Antioxidant Shield
UPDATE dots SET
  key_name = 'DOT-N18',
  name = 'Antioxidant Shield',
  name_zh = '抗氧化盾',
  is_isolate = false,
  timing = 'Morning',
  coating = 'gastric',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  ingredients_summary = 'L-Ergothioneine / 麦角硫因, L-Selenomethionine / 硒代蛋氨酸',
  description = 'A dedicated-transporter antioxidant paired with selenium, the cofactor for the body''s own glutathione peroxidase defense.',
  target_dots_min = 1,
  target_dots_max = 3,
  ingredients = '[{"mg":20,"name":"L-Ergothioneine"},{"mg":0.16,"name":"L-Selenomethionine"}]',
  ingredients_zh = '[{"mg":20,"name":"麦角硫因"},{"mg":0.16,"name":"硒代蛋氨酸"}]'
WHERE key_name = 'DOT18';

-- Verify
SELECT key_name, name, name_zh, sub_age_target, timing, target_dots_min, target_dots_max FROM dots ORDER BY id;
