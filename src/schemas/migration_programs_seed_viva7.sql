-- Seed: the first 打卡 program — 7天生命能力打卡 (viva_7day_v1), Day 1 authored in full.
--
-- Day 1 is the user-specified template: three items (十年生命能力 / Day 1 行动记录 / 最大提醒)
-- rendered into seven questions, and the unified "Day 1完成 …" recap. Days 2–7 are placeholder
-- rows for the admin panel (Content ▸ Programs) to fill in; lesson_id is left NULL everywhere
-- until an Academy lesson is linked there. The program ships as 'draft' with no channel bound —
-- flipping it to 'active' and binding a channel is what starts auto-enrollment.
--
-- Idempotent: the whole block is skipped when the program key already exists.
--
-- @requires: migration_programs.sql

DO $$
DECLARE
    v_program_id       INTEGER;
    v_questionnaire_id INTEGER;
    v_day              INTEGER;
    -- Before/after scores share one shape; declared once so the three slider questions can't drift.
    -- The outer label_* is the short name the recap comment uses for the dimension; the sliders
    -- inside are the 行动前 / 行动后 pair.
    v_pair_sliders     TEXT := '"sliders":[{"key":"before","label_zh":"行动前","label_en":"Before","min":1,"max":10,"step":1,"default":5,"unit":"分"},{"key":"after","label_zh":"行动后","label_en":"After","min":1,"max":10,"step":1,"default":5,"unit":"分"}]';
BEGIN
    IF EXISTS (SELECT 1 FROM programs WHERE key_name = 'viva_7day_v1') THEN
        RETURN;
    END IF;

    INSERT INTO programs (key_name, title_zh, title_en, description_zh, description_en, duration_days, status)
    VALUES (
        'viva_7day_v1',
        '7天生命能力打卡',
        '7-Day Vitality Check-in',
        '每天一节课程 + 一次打卡，用七天建立你的十年生命能力。',
        'One lesson and one check-in a day — seven days to map your ten-year vitality.',
        7, 'draft'
    )
    RETURNING id INTO v_program_id;

    INSERT INTO questionnaires (channel_id, name, name_zh, description, description_zh, type, is_active)
    VALUES (
        NULL,
        'Program Day 1 Check-in',
        'Day 1 打卡',
        'Day 1 of the 7-day vitality program: ten-year ability, the post-meal walk record, biggest reminder.',
        '7天生命能力打卡 Day 1：十年生命能力、饭后步行行动记录、最大提醒。',
        'program_day', true
    )
    RETURNING id INTO v_questionnaire_id;

    -- save_target stays NULL on every row: a 打卡 answer is a response record, never a write into
    -- users.* / bio_data / biomarkers (the same boundary lib/agQuestionnaire.js documents).
    INSERT INTO questionnaire_questions
        (questionnaire_id, key, sort_order, input_type, prompt_zh, prompt_en, config)
    VALUES
        (v_questionnaire_id, 'ten_year_ability', 0, 'text',
         '第一项 · 我的十年生命能力：十年以后，我最希望自己仍然能够________。',
         'Item 1 · My ten-year ability: ten years from now, I most want to still be able to ________.',
         '{"placeholder_zh":"例如：自己爬上山顶","placeholder_en":"e.g. hike to the summit on my own"}'),
        (v_questionnaire_id, 'meal_time', 1, 'time_picker',
         '第二项 · 我的Day 1行动记录：饭后走10分钟。先记录一下——你今天的用餐时间是？',
         'Item 2 · My Day 1 action: a 10-minute walk after a meal. First — what time did you eat?',
         '{"default":"12:30"}'),
        (v_questionnaire_id, 'walk_time', 2, 'time_picker',
         '饭后步行的开始时间是？',
         'What time did the walk start?',
         '{"default":"13:00"}'),
        (v_questionnaire_id, 'fullness', 3, 'slider_group',
         '步行前后，你的饱胀感分别是几分？（1 = 很轻松，10 = 非常胀）',
         'Fullness before and after the walk? (1 = light, 10 = very full)',
         ('{"label_zh":"饱胀感","label_en":"Fullness",' || v_pair_sliders || '}')::jsonb),
        (v_questionnaire_id, 'energy', 4, 'slider_group',
         '步行前后，你的精力状态分别是几分？（1 = 很疲惫，10 = 精力充沛）',
         'Energy before and after the walk? (1 = drained, 10 = energised)',
         ('{"label_zh":"精力状态","label_en":"Energy",' || v_pair_sliders || '}')::jsonb),
        (v_questionnaire_id, 'comfort', 5, 'slider_group',
         '步行前后，你的身体舒适度分别是几分？（1 = 很不舒服，10 = 非常舒适）',
         'Body comfort before and after the walk? (1 = uncomfortable, 10 = very comfortable)',
         ('{"label_zh":"身体舒适度","label_en":"Body comfort",' || v_pair_sliders || '}')::jsonb),
        (v_questionnaire_id, 'biggest_reminder', 6, 'text',
         '第三项 · 我的最大提醒：今天的身体观察或 VIVA NEXUS™ 对话，让我意识到________。',
         'Item 3 · My biggest reminder: today''s body observation or VIVA NEXUS™ conversation made me realise ________.',
         '{"placeholder_zh":"用一句话写下来","placeholder_en":"One sentence"}');

    INSERT INTO program_days
        (program_id, day_index, title_zh, title_en, intro_md_zh, intro_md_en, questionnaire_id,
         summary_template_zh, summary_template_en)
    VALUES (
        v_program_id, 1,
        'Day 1 · 我的十年生命能力',
        'Day 1 · My ten-year ability',
        E'**Day 1 · 我的十年生命能力**\n\n今天三件事：看完今天的课程，饭后走 10 分钟，然后回来打卡——写下你的十年生命能力、行动前后的感受，和今天最大的提醒。',
        E'**Day 1 · My ten-year ability**\n\nThree things today: watch today''s lesson, take a 10-minute walk after a meal, then come back and check in — your ten-year ability, how you felt before and after, and today''s biggest reminder.',
        v_questionnaire_id,
        E'**Day 1完成**\n我的十年生命能力：{{ten_year_ability}}\n用餐时间：{{meal_time}}\n步行时间：{{walk_time}}\n饱胀感：{{fullness.before}} → {{fullness.after}}\n精力状态：{{energy.before}} → {{energy.after}}\n身体舒适度：{{comfort.before}} → {{comfort.after}}\n今天最大的提醒：{{biggest_reminder}}',
        E'**Day 1 complete**\nMy ten-year ability: {{ten_year_ability}}\nMeal time: {{meal_time}}\nWalk time: {{walk_time}}\nFullness: {{fullness.before}} → {{fullness.after}}\nEnergy: {{energy.before}} → {{energy.after}}\nBody comfort: {{comfort.before}} → {{comfort.after}}\nBiggest reminder today: {{biggest_reminder}}'
    );

    FOR v_day IN 2..7 LOOP
        INSERT INTO program_days (program_id, day_index, title_zh, title_en)
        VALUES (v_program_id, v_day, 'Day ' || v_day, 'Day ' || v_day);
    END LOOP;
END $$;
