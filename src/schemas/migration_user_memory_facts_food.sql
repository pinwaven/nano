-- Food-sensitivity restrictions on user_memory_facts. CLAUDE.md §40.
--
-- All three columns are NULLABLE and default NULL, so every fact that exists today keeps
-- behaving exactly as it does today. Nothing here changes an existing read path.
--
-- valid_until — a chronic food-sensitivity restriction is TEMPORARY, and the report says so:
--   class 1 → stop ≥1 month, then reintroduce a small portion every 4 days
--   class 2 → stop ≥2 months, then recheck
--   class 3 → stop 3-6 months, then recheck
-- A fact with no valid_until is open-ended, which is what a user-stated allergy is.
--
-- severity — the printed IgG class (1-3). A 50.9 U/mL class-1 result and a 300 U/mL class-3
-- result are not the same instruction, and fact_zh alone cannot carry that.
--
-- food_key — THE LOAD-BEARING ONE. lib/formulationQuality.js's _collides is bidirectional
-- substring containment over dot names and ingredient names, and allergy_conflict is the one
-- quality finding the caller acts on: handlers/chat.js DELETES the colliding dot from both
-- recipes. A bare dietary_restriction "玉米" substring-matches the ingredient 玉米黄质 and
-- would silently remove DOT-N8 明眸. A fact carrying a food_key is therefore matched against
-- food_catalog.dot_conflict_keys instead of against prose; a fact without one is untouched.
-- Do not "fix" that hazard by widening the prose match.

ALTER TABLE user_memory_facts
    ADD COLUMN IF NOT EXISTS valid_until DATE,
    ADD COLUMN IF NOT EXISTS severity    SMALLINT,
    ADD COLUMN IF NOT EXISTS food_key    TEXT REFERENCES food_catalog(food_key);

CREATE INDEX IF NOT EXISTS idx_user_memory_facts_food
    ON user_memory_facts (user_id, food_key) WHERE food_key IS NOT NULL;
