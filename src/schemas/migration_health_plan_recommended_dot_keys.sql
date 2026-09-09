-- @requires: migration_health_plans.sql
--
-- A focus list names a dot by key_name, never by dots.id.
--
-- The @requires is load-bearing on a FRESH database, not just documentation. Plain ASCII sort
-- puts this file BEFORE migration_health_plans.sql ('_' 0x5F < 's' 0x73 after the shared
-- "migration_health_plan" prefix), so without it the conversion below would run first and no-op,
-- and the seed would then insert the very integer ids this migration exists to remove.
--
-- WHAT WENT WRONG
--
-- health_plan_templates.recommended_dot_ids held numeric dots.id values authored against the
-- pre-2026-07-25 formulary. migration_dots_new_lineup.sql replaced every dot but REUSED the ids,
-- so all six seeded lists silently began resolving to different dots. Nothing errored, nothing
-- was filtered out, and _resolveCandidateDotKeys' byId lookup succeeded on every entry -- it just
-- returned the wrong keys.
--
-- The result was not inert. A focus applies at three points in handlers/dots.js:
--
--   _rankDotsBySeverity   +0.15 on a 0-1 severity scale, which decides which dots survive
--                         _capDistinctDots' weekly tier cap (6/8/10 -- CLAUDE.md 28c)
--   _fallbackCountForDot  listed -> 75% of the dot's own range
--   _padCandidatesFor     which dots fill the 28f upgrade rungs
--
-- Under a 6-dot tier that combination effectively chooses the six dots. Before this migration
-- 焕能减重 (weight loss) pulled toward 明眸 (macular) and 肌光焕采 (skin); 深度睡眠 (sleep)
-- excluded 静心夜, the only sleep dot in the formulary, and had zero defensible entries.
--
-- Live scope when this was written: 7 of 24 'proposed' nutrition_plans on prod belonged to users
-- with an active focus and were steered by the stale lists.
--
-- WHY key_name AND NOT id
--
-- key_name is the stable identity used everywhere else in this codebase -- CLAUDE.md 11's
-- sub-age routing, dots.sub_age_target, the :::formula card, and _resolveCandidateDotKeys' own
-- OUTPUT, which was already a key set. An id is a row number; it survives a lineup change while
-- meaning something entirely different. Storing keys makes the next lineup change fail loudly
-- (an unmatched key is dropped and countable) instead of silently repointing.
--
-- The COLUMN KEEPS ITS NAME. Renaming it touches 14 call sites across three apps for no
-- behavioural gain; the format is what mattered.
--
-- DOT-N7 IS DELIBERATELY ON NO LIST
--
-- dosing_protocol='pulse'. It is filtered out of _rankDotsBySeverity AND _padCandidatesFor, and
-- _planExpansionContext lifts it out of the everyday recipe entirely (it is dosed alone on 2 of
-- 28 days in every plan regardless, and _countDistinctDots does not count it toward a tier).
-- Listing it can only waste ranking weight. It was in weight_loss and metabolic_health before.
--
-- DOT-N8 明眸 AND DOT-N12 敏锐心智 BECOME UNREACHABLE, KNOWINGLY
--
-- Both have sub_age_target = NULL, so _rankDotsBySeverity scores them exactly 0 forever and a
-- focus list is their only route into a formula. None of these six plans is on-goal for macular
-- or cognitive support, so neither is listed. If either should be obtainable it needs a plan
-- that names it, or a sub_age_target -- not a silent slot in an unrelated list, which is exactly
-- how they got here.
--
-- Idempotent: re-running rewrites the same values. Templates are addressed BY key_name, never by
-- id, for the same reason this migration exists at all.

BEGIN;

-- 1. The six seeded templates, re-mapped to the current lineup.
--
--    Selection: dots whose sub_age_target is one of the plan's own target_sub_ages, preferring
--    those whose actives the plan's desc_zh already promises. A deliberate off-dimension entry
--    is allowed where the dot is unambiguously on-goal (noted per plan). 5-6 entries each: a
--    longer list degenerates into "everything on-dimension at 75%" and stops being a signal.

-- Metabolic + MicroVascular. N11 berberine (insulin sensitivity), N15 glycation, N17 lipids
-- (the goal's 减少体脂 half), N14 cocoa flavanols + N16 pterostilbene/quercetin (vascular).
UPDATE health_plan_templates
   SET recommended_dot_ids = '["DOT-N11","DOT-N15","DOT-N17","DOT-N14","DOT-N16"]'::jsonb,
       updated_at = NOW()
 WHERE key_name = 'weight_loss';

-- Cellular + Resilience. N9 NMN is the desc's «NAD+ 支持», N6 urolithin A + spermidine its
-- «抗衰老复合物», N4 rhodiola + theanine its «抗压力营养»; N18 and N5 fill out Resilience.
UPDATE health_plan_templates
   SET recommended_dot_ids = '["DOT-N9","DOT-N6","DOT-N18","DOT-N5","DOT-N4"]'::jsonb,
       updated_at = NOW()
 WHERE key_name = 'anti_aging';

-- MicroVascular + Metabolic. N5 CoQ10+PQQ and N6 urolithin A are the desc's «线粒体功能»;
-- N1 supplies the B12/folate/B6 energy-metabolism cofactors; N14 the delivery half.
-- N4 持续精力 is off-dimension (Resilience) and listed anyway: it is literally "Steady Energy",
-- which is the case a focus list exists for. N11 is dropped from the list but still surfaces on
-- its own whenever MetabolicAge is elevated.
UPDATE health_plan_templates
   SET recommended_dot_ids = '["DOT-N5","DOT-N6","DOT-N9","DOT-N1","DOT-N14","DOT-N4"]'::jsonb,
       updated_at = NOW()
 WHERE key_name = 'energy_boost';

-- Resilience. N3 静心夜 (magnesium glycinate + ashwagandha + saffron) is THE sleep dot and was
-- absent before this. N13 is the desc's «肠道健康支持» verbatim; N5 迷走张力 is the
-- parasympathetic mechanism the plan names; N4 rhodiola serves its «降低皮质醇» (Morning-locked,
-- so it addresses daytime cortisol rather than sleep onset).
UPDATE health_plan_templates
   SET recommended_dot_ids = '["DOT-N3","DOT-N13","DOT-N5","DOT-N18","DOT-N4"]'::jsonb,
       updated_at = NOW()
 WHERE key_name = 'sleep_improvement';

-- Resilience + Cellular. N18 selenomethionine is the glutathione-peroxidase cofactor and the
-- nearest current analogue to the desc's 谷胱甘肽 (see step 3). N1 carries the NAC the desc names
-- outright and N16 the quercetin; both are off-dimension (MicroVascular) and listed for their
-- actives. N6 spermidine for autophagy/immune rejuvenation.
UPDATE health_plan_templates
   SET recommended_dot_ids = '["DOT-N18","DOT-N13","DOT-N1","DOT-N16","DOT-N6"]'::jsonb,
       updated_at = NOW()
 WHERE key_name = 'immunity';

-- Metabolic. N15 carnosine + benfotiamine is directly the desc's «糖化白蛋白 (GA)»; N11 its
-- «胰岛素敏感性»; N6 and N5 its «线粒体营养» (see step 3 re: Ca-AKG).
UPDATE health_plan_templates
   SET recommended_dot_ids = '["DOT-N11","DOT-N15","DOT-N17","DOT-N6","DOT-N5"]'::jsonb,
       updated_at = NOW()
 WHERE key_name = 'metabolic_health';

-- 2. Any OTHER template (admin-authored since the seed) still holding integers: translate in
--    place so nothing is left in the legacy format.
--
--    An id matching no dot is KEPT AS-IS rather than dropped -- a silently shortened focus list
--    is the failure mode this whole migration exists to prevent, and an untranslatable entry is
--    something a human should look at. _resolveCandidateDotKeys ignores it either way.
UPDATE health_plan_templates t
   SET recommended_dot_ids = translated.arr,
       updated_at = NOW()
  FROM (
    SELECT t2.id,
           jsonb_agg(COALESCE(to_jsonb(d.key_name), elem) ORDER BY ord) AS arr
      FROM health_plan_templates t2
      CROSS JOIN LATERAL jsonb_array_elements(t2.recommended_dot_ids) WITH ORDINALITY AS e(elem, ord)
      LEFT JOIN dots d ON jsonb_typeof(elem) = 'number' AND d.id = (elem #>> '{}')::int
     WHERE jsonb_typeof(t2.recommended_dot_ids) = 'array'
       AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(t2.recommended_dot_ids) x
              WHERE jsonb_typeof(x) = 'number'
           )
     GROUP BY t2.id
  ) AS translated
 WHERE t.id = translated.id;

-- 3. Copy drift found in the same pass: two descriptions promise actives that left the formulary
--    with the old lineup. 谷胱甘肽 and Ca-AKG were DOT16 and DOT05 respectively; no current dot
--    contains either. Same drift class as the ids above -- a promise the product can no longer
--    keep. Guarded so a re-run is a no-op.
UPDATE health_plan_templates
   SET desc_zh = replace(desc_zh, '谷胱甘肽、NAC 与肠道健康组合', '麦角硫因与硒、NAC 与肠道健康组合'),
       updated_at = NOW()
 WHERE key_name = 'immunity' AND desc_zh LIKE '%谷胱甘肽%';

UPDATE health_plan_templates
   SET desc_zh = replace(desc_zh, '线粒体营养与 Ca-AKG 组合', '线粒体营养与尿石素A、亚精胺组合'),
       updated_at = NOW()
 WHERE key_name = 'metabolic_health' AND desc_zh LIKE '%Ca-AKG%';

COMMIT;
