'use strict';

const { pool } = require('../lib/db');
const { getNowShanghai } = require('../lib/time-utils');
const { getCurrentSolarTerm } = require('../lib/solarTerms');
const { getEssentialBlock } = require('../lib/knowledgeBase');
const { saveChatMessage } = require('./chat');
const systemDailyCheckinTemplate = require('../prompts/nano/systemDailyCheckin');
const vivaSystemDailyCheckinTemplate = require('../prompts/viva/systemDailyCheckin');
const OpenAI = require('openai');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

// Flattens a nutrition_schedules.recipe JSONB ({dots: {DOT01: 2, ...}}) into a display list
// using real dot names, filtering out zero-count entries.
function flattenRecipeDots(recipe, dotNameByKey) {
    if (!recipe || !recipe.dots) return [];
    return Object.entries(recipe.dots)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => ({ name: dotNameByKey.get(key) || key, count }));
}

/**
 * Dispatched by the dispatcher's daily-check-in scan (source: 'acs.dispatcher',
 * type: 'checkin.daily', both personas — CLAUDE.md) — fires on a user's own first app-open
 * within whichever time-of-day period (morning/midday/evening) is currently active.
 * Deliberately lightweight: a single completion, no PLAN/GENERATE/JUDGE agentic loop,
 * matching the routine/low-stakes nature of a daily check-in going out to every eligible
 * user up to 3x/day.
 */
async function handleDailyCheckinEvent({ user_id, period, persona_type }) {
    const personaType = persona_type || 'nano';
    if (!user_id || !period) {
        console.warn(JSON.stringify({ level: 'WARN', msg: 'handleDailyCheckinEvent missing user_id/period', user_id, period }));
        return;
    }

    // Claim this (user, period, day) slot atomically before doing any slow work, so
    // concurrent dispatcher ticks racing the same user (e.g. repeated app-opens
    // re-extending the 2-minute eligibility window while an earlier tick's LLM call
    // is still in flight) can't all pass the dispatcher's own NOT EXISTS check and
    // each generate + save their own duplicate message. Status starts as 'claiming'
    // (not 'pending') because the miniapp's 3s /api/notifications poll immediately
    // surfaces and marks 'sent' any 'pending' row — an empty content string here
    // would otherwise flash a blank bubble and consume the slot before the real
    // message exists.
    let notificationId;
    try {
        const claim = await pool.query(
            `INSERT INTO notifications (user_id, notification_type, checkin_date, content, status)
             VALUES ($1, $2, (NOW() AT TIME ZONE 'Asia/Shanghai')::date, '', 'claiming')
             ON CONFLICT (user_id, notification_type, checkin_date) WHERE checkin_date IS NOT NULL DO NOTHING
             RETURNING id`,
            [user_id, `${period}_checkin`]
        );
        if (claim.rows.length === 0) {
            console.log(JSON.stringify({ level: 'INFO', msg: 'Daily check-in skipped, already claimed', user_id, period }));
            return;
        }
        notificationId = claim.rows[0].id;
    } catch (claimErr) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleDailyCheckinEvent claim failed', user_id, period, error: claimErr.message }));
        return;
    }

    try {
        const [userResult, bioResult, dotsResult, scheduleResult, activePlansResult] = await Promise.all([
            pool.query('SELECT user_id, nickname, language FROM users WHERE user_id = $1', [user_id]),
            pool.query(
                `SELECT data FROM biomarkers
                 WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL
                 ORDER BY tested_at DESC LIMIT 1`,
                [user_id]
            ),
            pool.query('SELECT key_name, name, name_zh FROM dots'),
            // Scoped to the currently ACTIVE plan only — a user can accumulate schedule rows
            // for the same scheduled_date across superseded/pending plans (re-formulation),
            // and reading unscoped could surface a stale plan's dots instead of the real one.
            pool.query(
                `SELECT ns.slot_name, ns.recipe
                 FROM nutrition_schedules ns
                 JOIN nutrition_plans np ON np.id = ns.plan_id
                 WHERE ns.user_id = $1 AND ns.scheduled_date = CURRENT_DATE AND np.status = 'active'`,
                [user_id]
            ),
            pool.query(
                `SELECT hp.id, hpt.name_en, hpt.name_zh, hpt.goal_en, hpt.goal_zh
                 FROM health_plans hp
                 LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
                 WHERE hp.user_id = $1 AND hp.status = 'active'
                 ORDER BY hp.start_date DESC LIMIT 5`,
                [user_id]
            ),
        ]);

        const user = userResult.rows[0];
        if (!user) {
            console.warn(JSON.stringify({ level: 'WARN', msg: 'handleDailyCheckinEvent user not found', user_id }));
            return;
        }
        const lang = user.language || 'zh';

        const dotNameByKey = new Map(dotsResult.rows.map(d => [d.key_name, lang === 'zh' ? (d.name_zh || d.name) : d.name]));
        const morningRow = scheduleResult.rows.find(r => r.slot_name === 'morning_cup');
        const eveningRow = scheduleResult.rows.find(r => r.slot_name === 'evening_cup');
        const morningDots = flattenRecipeDots(morningRow?.recipe, dotNameByKey);
        const eveningDots = flattenRecipeDots(eveningRow?.recipe, dotNameByKey);

        const bioData = bioResult.rows[0]?.data || {};
        const bioageProfile = bioData.bioage_profile || {};
        const subAges = bioageProfile.SubAges || {};
        // Pick the single most-elevated dimension deterministically (highest sub-age relative
        // to chrono-age) rather than asking the LLM to compare numbers itself.
        const subAgeEntries = Object.entries(subAges).filter(([, v]) => typeof v === 'number');
        let mostElevated = null;
        if (subAgeEntries.length) {
            subAgeEntries.sort((a, b) => b[1] - a[1]);
            mostElevated = { key: subAgeEntries[0][0], sub_age: subAgeEntries[0][1], chrono_age: bioageProfile.ChronoAge ?? null };
        }

        const activeHealthPlans = activePlansResult.rows.map(p => ({
            name: lang === 'zh' ? p.name_zh : p.name_en,
            goal: lang === 'zh' ? p.goal_zh : p.goal_en,
        }));

        const currentSolarTerm = getCurrentSolarTerm(getNowShanghai().toJSDate());
        const essentialKnowledge = await getEssentialBlock(personaType);

        const checkinTemplate = personaType === 'viva' ? vivaSystemDailyCheckinTemplate : systemDailyCheckinTemplate;
        const systemPrompt = checkinTemplate({
            user_profile: { nickname: user.nickname, language: lang },
            period,
            morning_dots: morningDots,
            evening_dots: eveningDots,
            most_elevated: mostElevated,
            active_health_plans: activeHealthPlans,
            current_solar_term: currentSolarTerm,
            essential_knowledge: essentialKnowledge,
        });

        const llmClient = getLlmClient();
        const completion = await llmClient.chat.completions.create({
            model: process.env.MODEL || 'qwen-plus-latest',
            messages: [{ role: 'system', content: systemPrompt }],
            max_tokens: 200,
            temperature: 0.8,
        });

        const message = completion.choices[0]?.message?.content?.trim();
        if (!message) throw new Error('LLM returned empty response');

        await saveChatMessage(user_id, 'ai', message, null, personaType);
        // Flip the claimed row to 'pending' only now that real content exists — this is
        // the point the miniapp's poll can first see and surface it.
        await pool.query(
            `UPDATE notifications SET content = $1, status = 'pending' WHERE id = $2`,
            [message, notificationId]
        );

        console.log(JSON.stringify({ level: 'INFO', msg: 'Daily check-in delivered', user_id, period }));
    } catch (err) {
        // Mark the claimed slot failed rather than leaving it stuck in 'claiming' forever.
        // A missed check-in is not worth a retry storm — the next period (or tomorrow's
        // morning) will naturally try again once a fresh checkin_date is eligible.
        await pool.query(`UPDATE notifications SET status = 'failed' WHERE id = $1`, [notificationId]).catch(() => {});
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleDailyCheckinEvent failed', user_id, period, error: err.message }));
    }
}

module.exports = { handleDailyCheckinEvent };
