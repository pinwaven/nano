-- Health Plan System Migration
-- Tables: health_plan_templates, health_plans, health_plan_checkins, health_plan_milestones

-- ── Plan Templates ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_plan_templates (
    id              SERIAL PRIMARY KEY,
    channel_id      INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    key_name        TEXT NOT NULL UNIQUE,
    name_zh         TEXT NOT NULL,
    name_en         TEXT NOT NULL,
    desc_zh         TEXT,
    desc_en         TEXT,
    goal_zh         TEXT,
    goal_en         TEXT,
    duration_weeks  INTEGER NOT NULL DEFAULT 4,
    target_sub_ages TEXT[],
    recommended_dot_ids JSONB DEFAULT '[]'::jsonb,
    activity_guidance   JSONB DEFAULT '{}'::jsonb,
    milestones          JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_by      TEXT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hpt_channel ON health_plan_templates(channel_id);
CREATE INDEX IF NOT EXISTS idx_hpt_active  ON health_plan_templates(is_active, sort_order);

-- ── User Plan Enrollments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_plans (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    template_id     INTEGER REFERENCES health_plan_templates(id) ON DELETE SET NULL,
    coach_id        INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
    plan_type       TEXT NOT NULL DEFAULT 'primary'
                    CHECK (plan_type IN ('primary', 'secondary')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
    source          TEXT NOT NULL DEFAULT 'self'
                    CHECK (source IN ('self', 'coach', 'ai')),
    custom_name_zh  TEXT,
    custom_name_en  TEXT,
    custom_goal_zh  TEXT,
    custom_goal_en  TEXT,
    duration_weeks  INTEGER NOT NULL DEFAULT 4,
    baseline_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
    start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    target_end_date DATE,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DB-level enforcement: at most one active primary and one active secondary per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_hp_user_type_active
    ON health_plans (user_id, plan_type)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_hp_user_status ON health_plans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_hp_coach       ON health_plans(coach_id);
CREATE INDEX IF NOT EXISTS idx_hp_template    ON health_plans(template_id);

-- ── Daily Check-ins ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_plan_checkins (
    id              BIGSERIAL PRIMARY KEY,
    plan_id         BIGINT NOT NULL REFERENCES health_plans(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    checkin_date    DATE NOT NULL,
    dots_taken      BOOLEAN NOT NULL DEFAULT false,
    activities_done JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_hpc_plan_date ON health_plan_checkins(plan_id, checkin_date DESC);
CREATE INDEX IF NOT EXISTS idx_hpc_user_date ON health_plan_checkins(user_id, checkin_date DESC);

-- ── Milestone Snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_plan_milestones (
    id              BIGSERIAL PRIMARY KEY,
    plan_id         BIGINT NOT NULL REFERENCES health_plans(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    biomarker_id    INTEGER REFERENCES biomarkers(id) ON DELETE SET NULL,
    milestone_index INTEGER NOT NULL DEFAULT 0,
    label_zh        TEXT,
    label_en        TEXT,
    snapshot_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
    achieved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hpm_plan ON health_plan_milestones(plan_id, milestone_index);

-- ── updated_at Triggers ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_health_plans_updated_at ON health_plans;
CREATE TRIGGER update_health_plans_updated_at
    BEFORE UPDATE ON health_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_health_plan_templates_updated_at ON health_plan_templates;
CREATE TRIGGER update_health_plan_templates_updated_at
    BEFORE UPDATE ON health_plan_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Seed: 6 Global Templates ─────────────────────────────────────────────────
INSERT INTO health_plan_templates
    (key_name, name_zh, name_en, desc_zh, desc_en, goal_zh, goal_en,
     duration_weeks, target_sub_ages, recommended_dot_ids, milestones, sort_order)
VALUES
(
    'weight_loss', '代谢减重', 'Metabolic Weight Loss',
    '通过代谢优化与精准营养加速健康减重，结合每日打卡与定期 Kino 复测持续追踪体脂与代谢指标。',
    'Accelerate healthy weight loss through metabolic optimization and precision nutrition, with daily check-ins and periodic Kino scans to track body fat and metabolic markers.',
    '优化代谢年龄、减少体脂、改善微血管健康',
    'Optimize MetabolicAge, reduce body fat, improve MicroVascular health',
    8, '{MetabolicAge,MicroVascularAge}', '[7,8,10,11,13]',
    '[{"week":2,"label_zh":"第一次体重检查点","label_en":"First weight checkpoint"},{"week":4,"label_zh":"代谢年龄中期复测","label_en":"Mid-plan MetabolicAge scan"},{"week":8,"label_zh":"最终 Kino 复测","label_en":"Final Kino assessment"}]',
    1
),
(
    'anti_aging', '逆龄还原', 'Anti-Aging Protocol',
    '全面对抗细胞老化与慢性炎症，通过 NAD+ 支持、抗衰老复合物与抗压力营养组合降低细胞年龄与抗压年龄。',
    'Comprehensively counter cellular aging and chronic inflammation by supporting NAD+ metabolism, senolytic activity, and resilience nutrition to reduce CellularAge and ResilienceAge.',
    '降低细胞年龄与抗压年龄，提升整体生物年龄',
    'Reduce CellularAge and ResilienceAge, improve overall biological age',
    12, '{CellularAge,ResilienceAge}', '[1,2,3,4,5,6,9,16]',
    '[{"week":4,"label_zh":"首次生物标志物复查","label_en":"First biomarker follow-up"},{"week":8,"label_zh":"细胞年龄中期评估","label_en":"Mid-plan CellularAge assessment"},{"week":12,"label_zh":"最终 Kino 复测","label_en":"Final Kino assessment"}]',
    2
),
(
    'energy_boost', '能量提升', 'Energy & Vitality Boost',
    '提升日常活力与运动恢复能力，通过改善线粒体功能、微血管健康与代谢效率带来持久能量。',
    'Boost daily vitality and exercise recovery by improving mitochondrial function, microvascular health, and metabolic efficiency for sustained energy.',
    '改善微血管与代谢健康，提升线粒体能量产出',
    'Improve MicroVascular and metabolic health, enhance mitochondrial energy output',
    6, '{MicroVascularAge,MetabolicAge}', '[7,8,10,11,13,14]',
    '[{"week":3,"label_zh":"活力检查点","label_en":"Vitality checkpoint"},{"week":6,"label_zh":"最终复测","label_en":"Final Kino assessment"}]',
    3
),
(
    'sleep_improvement', '深度睡眠', 'Deep Sleep Improvement',
    '通过神经调节营养、抗压力原粒与肠道健康支持改善睡眠质量与深度睡眠时长，同时降低皮质醇水平。',
    'Improve sleep quality and deep sleep duration through neuroregulation nutrition, resilience dots, and gut health support while reducing cortisol levels.',
    '改善抗压年龄、延长深度睡眠、减少睡眠中断',
    'Improve ResilienceAge, extend deep sleep, reduce sleep disruptions',
    6, '{ResilienceAge}', '[9,12,15,16,17]',
    '[{"week":3,"label_zh":"睡眠质量检查","label_en":"Sleep quality checkpoint"},{"week":6,"label_zh":"抗压年龄复测","label_en":"ResilienceAge re-assessment"}]',
    4
),
(
    'immunity', '免疫防御', 'Immunity & Defense',
    '强化先天免疫系统、降低系统性炎症标志物 (hsCRP、IL-6)，通过谷胱甘肽、NAC 与肠道健康组合建立全面防御屏障。',
    'Strengthen the innate immune system and reduce systemic inflammation markers (hsCRP, IL-6) through glutathione, NAC, and gut health combinations for comprehensive defense.',
    '降低炎症标志物、改善抗压年龄与细胞年龄',
    'Reduce inflammatory markers, improve ResilienceAge and CellularAge',
    8, '{ResilienceAge,CellularAge}', '[4,9,15,16,17,18]',
    '[{"week":4,"label_zh":"炎症标志物复查","label_en":"Inflammation marker check"},{"week":8,"label_zh":"最终 Kino 复测","label_en":"Final Kino assessment"}]',
    5
),
(
    'metabolic_health', '代谢健康', 'Metabolic Health',
    '稳定血糖与糖化白蛋白 (GA) 水平，提升胰岛素敏感性，通过线粒体营养与 Ca-AKG 组合改善细胞能量代谢。',
    'Stabilize blood glucose and glycated albumin (GA) levels, improve insulin sensitivity through mitochondrial nutrition and Ca-AKG combinations for better cellular energy metabolism.',
    '改善代谢年龄与糖化指标，优化胰岛素敏感性',
    'Improve MetabolicAge and glycation markers, optimize insulin sensitivity',
    10, '{MetabolicAge}', '[5,7,11]',
    '[{"week":4,"label_zh":"血糖标志物检查","label_en":"Glucose marker checkpoint"},{"week":8,"label_zh":"中期代谢评估","label_en":"Mid metabolic assessment"},{"week":10,"label_zh":"最终复测","label_en":"Final Kino assessment"}]',
    6
)
ON CONFLICT (key_name) DO NOTHING;
