-- One row per food per panel. CLAUDE.md §40.
--
-- PER-ROW, NOT A JSONB BLOB. The report's whole premise is re-testing: "停止摄食1个月后，复查
-- 相应食物抗体浓度，如果浓度降低到1级以下…". That is a two-panel comparison query, and it wants
-- rows. It is also what makes 「我能吃X吗」 one indexed lookup instead of a blob parse.
--
-- value IS NULL when below_detection. The panel prints "<0.1" for 13 of this report's 120
-- foods — a left-censored value, not a number. Storing 0.1 would assert a measurement the lab
-- explicitly declined to make, and storing the string would put a non-numeric into a NUMERIC.
--
-- user_id is denormalised off the panel so the per-user lookup needs no join.

CREATE TABLE IF NOT EXISTS food_sensitivity_results (
    id              BIGSERIAL PRIMARY KEY,
    panel_id        BIGINT NOT NULL REFERENCES food_sensitivity_panels(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    food_key        TEXT NOT NULL REFERENCES food_catalog(food_key),
    value           NUMERIC,
    below_detection BOOLEAN NOT NULL DEFAULT FALSE,
    class           SMALLINT NOT NULL CHECK (class BETWEEN 0 AND 3),
    UNIQUE (panel_id, food_key)
);

CREATE INDEX IF NOT EXISTS idx_fs_results_user_food ON food_sensitivity_results (user_id, food_key);
CREATE INDEX IF NOT EXISTS idx_fs_results_positive  ON food_sensitivity_results (user_id, class)
    WHERE class >= 1;
