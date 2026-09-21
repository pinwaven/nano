-- 超重 is not 肥胖. The catalog listed 超重 as an alias of condition:obesity, so a
-- report saying 「BMI 25.5（超重）」 gave a person with a BMI of 23.9 today an active
-- memory fact of obesity — a different category by the Chinese standard (超重
-- 24–28, 肥胖 ≥28) and one that formulation reads. Seen on prod 2026-09-21 on the
-- first grouped 21-page extraction. Overweight gets its own key; obesity keeps
-- only its own names.
-- @requires: migration_tag_catalog.sql
INSERT INTO tag_catalog (tag_key, category, name_zh, name_en, aliases, values, memory_category, sort_order)
VALUES ('condition:overweight', 'condition', '超重', 'Overweight', '{体重超标}', NULL, 'condition', 177)
ON CONFLICT (tag_key) DO NOTHING;
UPDATE tag_catalog SET aliases = array_remove(aliases, '超重') WHERE tag_key = 'condition:obesity';
