-- Dot payload capacity raised 24 mg -> 36 mg (1.5x).
--
-- DOSE-NEUTRAL rescale: every ingredient's mg is multiplied by 1.5 and the dot's
-- target_dots_min/max are divided by 1.5, so the delivered mg/day at any point in a dot's
-- range is unchanged (within the rounding error noted per dot below). The benefit is
-- entirely in the capsule budget: the same dose now costs ~1/3 fewer dots.
--
--   sum of all target_dots_min:  220 -> 149   (daily budget is 2 x MAX_DOTS_PER_CAPSULE = 144)
--   sum of all target_dots_max:  605 -> 407
--
-- The case that motivated this: a user elevated on both metabolic and cellular dimensions
-- needed N15+N17+N11+N6 at their minimums = 148 dots/day, which did not fit in 144 and so
-- could not be formulated at all. That combination is now 99.
--
-- FIVE DOTS ARE DELIBERATELY UNCHANGED: N1, N8, N10, N13, N18 all have target_dots_min = 1.
-- There is no integer below 1, so their count cannot be divided; scaling their mg with the
-- count pinned at 1 would be a straight +50% dose increase, which is the opposite of
-- dose-neutral. For those five the extra 12 mg is simply unused headroom.
-- (N7 IS rescaled: its min is 0, which divides fine. Only min = 1 is the blocker.)
--
-- Worst-case rounding drift is -10% and appears at two edges only: N2's minimum and N3's
-- maximum, both of which have ranges too narrow to divide cleanly. Note N3's saffron ceiling
-- moves 30 -> 27 mg, just under the 28 mg standard extract dose -- flagged, not corrected here.
--
-- Idempotent: every UPDATE sets explicit literal values rather than multiplying in place,
-- so re-running this migration is a no-op.
--
-- NOTE: MAX_DOTS_PER_CAPSULE (72) in lib/dotsProductModel.js is a DOT COUNT, not a mass, and
-- is deliberately NOT changed here. Per-capsule mass does rise (72 x 24mg -> 72 x 36mg) even
-- though per-capsule dose does not, since fewer dots are now needed to reach the same dose.

BEGIN;

UPDATE dots SET
    ingredients = '[{"mg":0.015,"name":"Vitamin D3"},{"mg":0.03,"name":"Vitamin K2 (MK-7)"},{"mg":22.5,"name":"Zinc Bisglycinate"},{"mg":1.8,"name":"Copper Bisglycinate"}]'::jsonb,
    ingredients_zh = '[{"mg":0.015,"name":"维生素D3"},{"mg":0.03,"name":"维生素K2 (MK-7)"},{"mg":22.5,"name":"甘氨酸锌"},{"mg":1.8,"name":"甘氨酸铜"}]'::jsonb,
    target_dots_min = 3,
    target_dots_max = 7
WHERE key_name = 'DOT-N2';

UPDATE dots SET
    ingredients = '[{"mg":15,"name":"Magnesium Glycinate"},{"mg":12,"name":"Ashwagandha Extract"},{"mg":9,"name":"Saffron Extract"}]'::jsonb,
    ingredients_zh = '[{"mg":15,"name":"甘氨酸镁"},{"mg":12,"name":"睡茄提取物"},{"mg":9,"name":"藏红花提取物"}]'::jsonb,
    target_dots_min = 2,
    target_dots_max = 3
WHERE key_name = 'DOT-N3';

UPDATE dots SET
    ingredients = '[{"mg":24,"name":"Rhodiola Rosea Extract"},{"mg":12,"name":"L-Theanine"}]'::jsonb,
    ingredients_zh = '[{"mg":24,"name":"红景天提取物"},{"mg":12,"name":"L-茶氨酸"}]'::jsonb,
    target_dots_min = 9,
    target_dots_max = 28
WHERE key_name = 'DOT-N4';

UPDATE dots SET
    ingredients = '[{"mg":22.5,"name":"Coenzyme Q10"},{"mg":7.5,"name":"PQQ"}]'::jsonb,
    ingredients_zh = '[{"mg":22.5,"name":"辅酶Q10"},{"mg":7.5,"name":"吡咯喹啉醌"}]'::jsonb,
    target_dots_min = 5,
    target_dots_max = 13
WHERE key_name = 'DOT-N5';

UPDATE dots SET
    ingredients = '[{"mg":30,"name":"Urolithin A"},{"mg":0.075,"name":"Spermidine"}]'::jsonb,
    ingredients_zh = '[{"mg":30,"name":"尿石素A"},{"mg":0.075,"name":"亚精胺"}]'::jsonb,
    target_dots_min = 17,
    target_dots_max = 33
WHERE key_name = 'DOT-N6';

UPDATE dots SET
    ingredients = '[{"mg":30,"name":"Fisetin"},{"mg":1.5,"name":"Piperine"}]'::jsonb,
    ingredients_zh = '[{"mg":30,"name":"漆黄素"},{"mg":1.5,"name":"胡椒碱"}]'::jsonb,
    target_dots_min = 0,
    target_dots_max = 33
WHERE key_name = 'DOT-N7';

UPDATE dots SET
    ingredients = '[{"mg":27,"name":"NMN"},{"mg":6,"name":"TMG (Betaine)"}]'::jsonb,
    ingredients_zh = '[{"mg":27,"name":"β-烟酰胺单核苷酸"},{"mg":6,"name":"三甲基甘氨酸"}]'::jsonb,
    target_dots_min = 9,
    target_dots_max = 37
WHERE key_name = 'DOT-N9';

UPDATE dots SET
    ingredients = '[{"mg":31.5,"name":"Berberine"},{"mg":1.5,"name":"Glucoraphanin + Myrosinase"}]'::jsonb,
    ingredients_zh = '[{"mg":31.5,"name":"小檗碱"},{"mg":1.5,"name":"萝卜硫苷+黑芥子酶复合物"}]'::jsonb,
    target_dots_min = 17,
    target_dots_max = 47
WHERE key_name = 'DOT-N11';

UPDATE dots SET
    ingredients = '[{"mg":30,"name":"Citicoline"},{"mg":0.012,"name":"Huperzine A"}]'::jsonb,
    ingredients_zh = '[{"mg":30,"name":"胞磷胆碱"},{"mg":0.012,"name":"石杉碱甲"}]'::jsonb,
    target_dots_min = 8,
    target_dots_max = 17
WHERE key_name = 'DOT-N12';

UPDATE dots SET
    ingredients = '[{"mg":30,"name":"Cocoa Flavanols"}]'::jsonb,
    ingredients_zh = '[{"mg":30,"name":"可可黄烷醇"}]'::jsonb,
    target_dots_min = 7,
    target_dots_max = 17
WHERE key_name = 'DOT-N14';

UPDATE dots SET
    ingredients = '[{"mg":27,"name":"L-Carnosine"},{"mg":6,"name":"Benfotiamine"},{"mg":1.5,"name":"P5P (B6)"}]'::jsonb,
    ingredients_zh = '[{"mg":27,"name":"L-肌肽"},{"mg":6,"name":"苯磷硫胺"},{"mg":1.5,"name":"活性维生素B6"}]'::jsonb,
    target_dots_min = 37,
    target_dots_max = 67
WHERE key_name = 'DOT-N15';

UPDATE dots SET
    ingredients = '[{"mg":27,"name":"Pterostilbene"},{"mg":6,"name":"Quercetin"}]'::jsonb,
    ingredients_zh = '[{"mg":27,"name":"紫檀芪"},{"mg":6,"name":"槲皮素"}]'::jsonb,
    target_dots_min = 2,
    target_dots_max = 9
WHERE key_name = 'DOT-N16';

UPDATE dots SET
    ingredients = '[{"mg":28.5,"name":"Plant Sterol Esters"},{"mg":3,"name":"Tocotrienols"}]'::jsonb,
    ingredients_zh = '[{"mg":28.5,"name":"植物固醇酯"},{"mg":3,"name":"生育三烯醇"}]'::jsonb,
    target_dots_min = 28,
    target_dots_max = 87
WHERE key_name = 'DOT-N17';
COMMIT;
