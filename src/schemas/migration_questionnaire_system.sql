-- Questionnaire System Migration
-- Adds a general questionnaire engine where onboarding is one questionnaire type.
-- Channel admins and coaches can create and assign questionnaires to users.

-- Named form templates
CREATE TABLE IF NOT EXISTS questionnaires (
    id              SERIAL PRIMARY KEY,
    channel_id      INTEGER REFERENCES channels(id) ON DELETE CASCADE,  -- NULL = global
    name            TEXT NOT NULL,
    name_zh         TEXT,
    description     TEXT,
    description_zh  TEXT,
    type            TEXT NOT NULL DEFAULT 'custom'
                    CHECK (type IN ('onboarding', 'custom')),
    created_by      TEXT REFERENCES users(user_id) ON DELETE SET NULL,  -- NULL = system-created
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Questions within a questionnaire
CREATE TABLE IF NOT EXISTS questionnaire_questions (
    id                  SERIAL PRIMARY KEY,
    questionnaire_id    INTEGER NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
    key                 TEXT NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    input_type          TEXT NOT NULL
                        CHECK (input_type IN ('text', 'button_select', 'date_picker', 'slider_group', 'multi_select')),
    prompt_zh           TEXT NOT NULL,
    prompt_en           TEXT NOT NULL,
    -- Optional: also write answer to user profile fields (used by onboarding questions)
    save_target         TEXT CHECK (save_target IN ('user_field', 'bio_data_field', 'biomarker')),
    save_field          TEXT,               -- users column name or bio_data key
    save_biomarker_type TEXT,               -- e.g. 'body_composition'
    -- Completion check rule evaluated by miniapp (for backward compat with existing users)
    completion_check    JSONB NOT NULL DEFAULT '{}',
    config              JSONB NOT NULL DEFAULT '{}',   -- input-type-specific config
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- A questionnaire assigned to a specific user
CREATE TABLE IF NOT EXISTS questionnaire_assignments (
    id                  SERIAL PRIMARY KEY,
    questionnaire_id    INTEGER NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    assigned_by         TEXT REFERENCES users(user_id) ON DELETE SET NULL,  -- NULL = system (onboarding auto-assign)
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed')),
    assigned_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at          TIMESTAMP WITH TIME ZONE,
    completed_at        TIMESTAMP WITH TIME ZONE
);

-- Individual answers
CREATE TABLE IF NOT EXISTS questionnaire_responses (
    id              SERIAL PRIMARY KEY,
    assignment_id   INTEGER NOT NULL REFERENCES questionnaire_assignments(id) ON DELETE CASCADE,
    question_id     INTEGER NOT NULL REFERENCES questionnaire_questions(id) ON DELETE CASCADE,
    answer          JSONB NOT NULL,     -- string | number | array | object depending on input_type
    answered_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (assignment_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_assignments_user_status
    ON questionnaire_assignments (user_id, status);

CREATE INDEX IF NOT EXISTS idx_questionnaire_responses_assignment
    ON questionnaire_responses (assignment_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: global onboarding questionnaire (mirrors the current hard-coded steps)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO questionnaires (channel_id, name, name_zh, description, description_zh, type, is_active)
VALUES (
    NULL,
    'Onboarding',
    '入门问卷',
    'Basic profile questions shown to every new user before they start chatting.',
    '新用户开始聊天前需要填写的基本信息问卷。',
    'onboarding',
    true
);

-- Store the new questionnaire ID for use in question inserts
DO $$
DECLARE
    qid INTEGER;
BEGIN
    SELECT id INTO qid FROM questionnaires WHERE type = 'onboarding' AND channel_id IS NULL ORDER BY id DESC LIMIT 1;

    -- Question 1: Name (text input)
    INSERT INTO questionnaire_questions
        (questionnaire_id, key, sort_order, input_type, prompt_zh, prompt_en,
         save_target, save_field, completion_check, config)
    VALUES (
        qid, 'nickname', 0, 'text',
        '在开始之前，需要了解一些基本信息来个性化您的健康洞察。请问您的姓名是？',
        'Before we start, I need a couple of quick details to personalize your health insights. What should I call you?',
        'user_field', 'nickname',
        '{"type": "user_field", "field": "nickname"}',
        '{"placeholder_zh": "您的姓名", "placeholder_en": "Your name"}'
    );

    -- Question 2: Gender (button select)
    INSERT INTO questionnaire_questions
        (questionnaire_id, key, sort_order, input_type, prompt_zh, prompt_en,
         save_target, save_field, completion_check, config)
    VALUES (
        qid, 'gender', 1, 'button_select',
        '好的！请问您的性别是？',
        'Great! And what is your gender?',
        'user_field', 'gender',
        '{"type": "user_field", "field": "gender"}',
        '{"options": [{"value": "male", "label_zh": "男", "label_en": "Male"}, {"value": "female", "label_zh": "女", "label_en": "Female"}], "auto_submit": true}'
    );

    -- Question 3: Birthday (date picker)
    INSERT INTO questionnaire_questions
        (questionnaire_id, key, sort_order, input_type, prompt_zh, prompt_en,
         save_target, save_field, completion_check, config)
    VALUES (
        qid, 'birth_date', 2, 'date_picker',
        '还有一件事——请告诉我您的出生日期？',
        'One quick thing — could you share your date of birth?',
        'user_field', 'birth_date',
        '{"type": "user_field", "field": "birth_date"}',
        '{"min_date": "1920-01-01", "max_date": "2010-12-31"}'
    );

    -- Question 4: Body metrics (slider group — height + weight)
    INSERT INTO questionnaire_questions
        (questionnaire_id, key, sort_order, input_type, prompt_zh, prompt_en,
         save_target, save_biomarker_type, completion_check, config)
    VALUES (
        qid, 'body_composition', 3, 'slider_group',
        '还有一件事——请告诉我您的身高和体重？',
        'One more thing — could you share your height and weight?',
        'biomarker', 'body_composition',
        '{"type": "biomarker", "test_type": "body_composition", "data_path": "actual.weight"}',
        '{"sliders": [
            {"key": "height", "label_zh": "身高", "label_en": "Height", "min": 100, "max": 220, "step": 1, "unit": "cm", "default": 165},
            {"key": "weight", "label_zh": "体重", "label_en": "Weight", "min": 30, "max": 150, "step": 0.5, "unit": "kg", "default": 65}
        ]}'
    );

    -- Question 5: Health conditions (multi select)
    INSERT INTO questionnaire_questions
        (questionnaire_id, key, sort_order, input_type, prompt_zh, prompt_en,
         save_target, save_field, completion_check, config)
    VALUES (
        qid, 'health_conditions', 4, 'multi_select',
        '您是否曾被诊断/体检出以下方面的问题？（可多选）',
        'Have you ever been diagnosed with or identified any of the following? (Select all that apply)',
        'bio_data_field', 'health_conditions',
        '{"type": "bio_data_field", "field": "health_conditions"}',
        '{"options": [
            {"key": "blood_sugar_high",    "label_zh": "血糖高",       "label_en": "High Blood Sugar"},
            {"key": "blood_pressure_high", "label_zh": "血压高",       "label_en": "High Blood Pressure"},
            {"key": "blood_lipids_high",   "label_zh": "血脂高",       "label_en": "High Blood Lipids"},
            {"key": "cholesterol_high",    "label_zh": "胆固醇高",     "label_en": "High Cholesterol"},
            {"key": "heart_issues",        "label_zh": "心脏问题",     "label_en": "Heart Problems"},
            {"key": "gout_uric_acid",      "label_zh": "痛风或尿酸高", "label_en": "Gout / High Uric Acid"},
            {"key": "kidney_disease",      "label_zh": "肾病",         "label_en": "Kidney Disease"},
            {"key": "sleep_deficiency",    "label_zh": "睡眠不足",     "label_en": "Sleep Deficiency"},
            {"key": "other",               "label_zh": "其他",         "label_en": "Other"}
        ], "allow_other": true, "other_key": "health_conditions_other"}'
    );
END $$;
