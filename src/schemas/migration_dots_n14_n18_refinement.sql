-- Migration: Sync dots table with updates in ../dots/dots-new.md (post 2026-07-25 lineup migration)
--
-- Full diff against dots-new.md confirmed only two dots changed since migration_dots_new_lineup.sql
-- was applied (verified live against dev DB, all other 16 dots already match the current doc):
--
-- 1. DOT-N14: fully reformulated from "Immune Resilience" (Beta-Glucan) to "Vascular Flow"
--    (Cocoa Flavanols) -- dots-new.md notes this replaces the Beta-Glucan version because its
--    only trackable metric required tracking illness across a whole cold/flu season with no fast
--    biomarker. sub_age_target reassigned Resilience Age -> Micro-Vascular Age: this is a product
--    judgment call (Cocoa Flavanols' evidence is BP/flow-mediated dilation/vascular, matching the
--    same dimension already used for DOT-N1/DOT-N2/DOT-N16), not something dots-new.md states
--    directly -- consistent with the "best-effort product judgment call" precedent set in
--    migration_dots_new_lineup.sql for dots with no explicit BioAge-dimension mapping in the source doc.
--
-- 2. DOT-N18: L-Ergothioneine reduced from 20mg/dot to 10mg/dot. dots-new.md's own text explains
--    the correction: at 20mg/dot, the 2-3 dot target/max range delivered 40-60mg/day, which
--    exceeded this dot's own cited 5-25mg human trial range and ~25-30mg tested-safety ceiling.
--    At 10mg/dot, 1-3 dots delivers 10-30mg, correctly landing inside range. Target/max dot counts
--    (1-2 target, 3 max) and L-Selenomethionine (0.16mg) are unchanged.

-- DOT-N14: Beta-Glucan/Immune Resilience -> Cocoa Flavanols/Vascular Flow
UPDATE dots SET
  name = 'Vascular Flow',
  name_zh = '脉络畅流',
  sub_age_target = 'Micro-Vascular Age',
  sub_age_target_zh = '微血管年龄',
  ingredients_summary = 'Cocoa Flavanols / 可可黄烷醇',
  description = 'Standardized cocoa flavanols shown in the COSMOS trial to reduce cardiovascular mortality risk, with blood pressure and flow-mediated dilation as faster-moving surrogates.',
  target_dots_min = 10,
  target_dots_max = 25,
  ingredients = '[{"mg":20,"name":"Cocoa Flavanols"}]',
  ingredients_zh = '[{"mg":20,"name":"可可黄烷醇"}]'
WHERE key_name = 'DOT-N14';

-- DOT-N18: L-Ergothioneine dose correction, 20mg/dot -> 10mg/dot
UPDATE dots SET
  ingredients = '[{"mg":10,"name":"L-Ergothioneine"},{"mg":0.16,"name":"L-Selenomethionine"}]',
  ingredients_zh = '[{"mg":10,"name":"麦角硫因"},{"mg":0.16,"name":"硒代蛋氨酸"}]'
WHERE key_name = 'DOT-N18';

-- Verify
SELECT key_name, name, name_zh, sub_age_target, target_dots_min, target_dots_max, ingredients FROM dots WHERE key_name IN ('DOT-N14', 'DOT-N18') ORDER BY key_name;
