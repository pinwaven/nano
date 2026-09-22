'use strict';
// Runs the UNDERSTAND step (§47) and turns its output into the two things the chat handler has
// always routed on: an intent label and the `required_data` keys that gate the optional fetches.
//
// Everything here is written to degrade to the old behaviour rather than to fail: a bad model
// response, a timeout, an unknown route — every one of them returns { ok:false } and the caller
// falls back to prompts/chat/intentClassifier.js. The understanding never becomes a new way for a
// turn to die.
const understandingTemplate = require('../prompts/chat/understanding');

// The keys of the two prompt maps in handlers/chat.js, plus `formulate_dots` — which has no
// template on purpose: it hands the turn to the miniapp's formulation tool and degrades to
// nutrition_question everywhere else. A route outside this set is a model error, not a new
// intent — reject the whole understanding rather than route to a template that doesn't exist
// (activePrompts[intent] would silently fall back to casual_chat, which has no tools at all).
const VALID_ROUTES = new Set([
    'casual_chat', 'biomarker_question', 'nutrition_question', 'lifestyle_question',
    'formulate_dots', 'longevity_science', 'record_action', 'set_reminder', 'emotional_support',
]);

// The understanding names data by tool, the handler's optional fetches are keyed by the
// classifier's older `required_data` vocabulary. Only the three keys that actually gate a fetch
// are mapped; biomarkers/bioage/dots/twin/facts are fetched unconditionally on every turn
// (a classifier miss must never blind the model — see handlePostChat) so listing them is a no-op.
const NEED_TO_REQUIRED_DATA = {
    get_health_plan: 'plan',
    get_nutrition_schedule: 'plan',
    get_weight_history: 'weight_history',
    store_products: 'store_products',
};

// `helpful` is enough for a fetch that only adds context, but NOT for the store catalog: §37
// makes "Viva never volunteers a product" structural by withholding the catalog unless the user
// themselves asked what they could obtain. "It would be nice to have" is not that ask.
const HELPFUL_EXCLUDED = new Set(['store_products']);

const MODEL = () => process.env.UNDERSTANDING_MODEL || 'qwen3.8-flash';
// qwen3.8-flash reasons before answering by default, which takes 15–45s per message here — every
// call blew the timeout below. With it off the model routes as well as qwen3-max did (97–98% eval,
// 95.5–97% held out, two runs each) at ~6s median. `UNDERSTANDING_THINKING=on` restores the
// model's default; it is not a setting to flip without re-measuring latency.
const THINKING = () => (process.env.UNDERSTANDING_THINKING || 'off').toLowerCase() === 'on';
// Measured ~6s median / ~8–9s p90 (qwen3.8-flash, thinking off). 25s is well past that and well
// inside the client's own 60s ceiling, so a stalled understanding costs the turn a few seconds and
// the old classifier, not the whole invocation.
const TIMEOUT_MS = parseInt(process.env.UNDERSTANDING_TIMEOUT_MS || '25000', 10);

// off    — the classifier alone, exactly as before this change.
// shadow — both run; the classifier routes, the understanding is logged for comparison. This is
//          the default, so deploying this code changes no user-visible behaviour until the env
//          var is set (the recommendation out of the sandbox comparison: shadow on prod traffic
//          before switching, since the measured win is entirely in the cases where they disagree).
// on     — the understanding routes, the classifier runs only when it fails.
function understandingMode() {
    const m = (process.env.CHAT_UNDERSTANDING_MODE || 'shadow').toLowerCase();
    return (m === 'on' || m === 'off' || m === 'shadow') ? m : 'shadow';
}

function requiredDataFrom(needs) {
    const out = new Set();
    for (const [list, excluded] of [[needs?.required, null], [needs?.helpful, HELPFUL_EXCLUDED]]) {
        for (const n of Array.isArray(list) ? list : []) {
            const key = NEED_TO_REQUIRED_DATA[n];
            if (key && !(excluded && excluded.has(n))) out.add(key);
        }
    }
    return [...out];
}

/**
 * The last few turns and a one-line state for this user — the two inputs the old classifier never
 * had, and the reason it could not read 「那运动呢？」 or 「刚才说错了，是男」 at all. Two small
 * indexed queries, run in parallel, before the turn's own message is persisted.
 */
async function fetchUnderstandingInputs(pool, user_id, personaType, turns = 4) {
    const [hist, st] = await Promise.all([
        pool.query(
            `SELECT role, content FROM chat_messages
              WHERE user_id = $1 AND persona_type = $2 AND role IN ('user','ai')
              ORDER BY id DESC LIMIT $3`,
            [user_id, personaType, turns]
        ).catch(() => ({ rows: [] })),
        pool.query(
            `SELECT u.language,
                    EXISTS(SELECT 1 FROM biomarkers b WHERE b.user_id = u.user_id AND b.test_type = 'kino_chip') AS has_kino,
                    u.wearable_brand IS NOT NULL AS has_wearable,
                    EXISTS(SELECT 1 FROM nutrition_plans p WHERE p.user_id = u.user_id AND p.status = 'active') AS has_nutrition_plan,
                    (SELECT array_agg(fact_zh) FROM (SELECT fact_zh FROM user_memory_facts f WHERE f.user_id = u.user_id AND f.status = 'active' LIMIT 6) s) AS facts,
                    (SELECT array_agg(COALESCE(custom_name_zh, '')) FROM health_plans h WHERE h.user_id = u.user_id AND h.status = 'active') AS health_plans
               FROM users u WHERE u.user_id = $1`,
            [user_id]
        ).catch(() => null),
    ]);
    const s = st?.rows?.[0];
    return {
        history: hist.rows.reverse().map(r => ({ role: r.role, content: String(r.content || '').slice(0, 600) })),
        // null, not a row of falses: the prompt renders an absent state as "(unknown)", while
        // `has_wearable=false` on a user who does have a ring is a claim we would be making up,
        // and the route follows it («我昨晚睡得怎么样» is only a data question if there is data).
        state: s ? {
            language: s.language, has_kino: s.has_kino, has_wearable: s.has_wearable,
            has_nutrition_plan: s.has_nutrition_plan,
            facts: s.facts || [], health_plans: (s.health_plans || []).filter(Boolean),
        } : null,
    };
}

async function runUnderstanding({ client, message, history, state, logContext = {} }) {
    const startedAt = Date.now();
    try {
        const completion = await client.chat.completions.create({
            model: MODEL(),
            messages: [{ role: 'user', content: understandingTemplate({ message, history, state }) }],
            temperature: 0.1,
            enable_thinking: THINKING(),
        }, { timeout: TIMEOUT_MS });
        const raw = (completion.choices[0].message.content || '').replace(/```json|```/g, '').trim();
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
        const ms = Date.now() - startedAt;
        if (!parsed || !VALID_ROUTES.has(parsed.route)) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'understanding_unusable', ...logContext, ms, route: parsed?.route || null, raw: parsed ? undefined : raw.slice(0, 300) }));
            return { ok: false, ms };
        }
        return {
            ok: true,
            route: parsed.route,
            required_data: requiredDataFrom(parsed.needs),
            understanding: parsed,
            ms,
            tokens: completion.usage?.total_tokens || null,
        };
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'understanding_failed', ...logContext, ms: Date.now() - startedAt, error: err.message }));
        return { ok: false, ms: Date.now() - startedAt, err: err.message };
    }
}

/**
 * The ONE line of the understanding that is worth putting in front of GENERATE, and only for a
 * message that cannot be read on its own. Three rounds of end-to-end grading (README in
 * temp/understanding-harness) found injecting the full understanding — family, topics, must_not,
 * success_criteria — made replies slightly WORSE on the 11 of 14 cases where both arms routed
 * the same: the templates are heavily tuned and an extra meta-layer competes with them. A
 * continuation is the exception: 「那运动呢？」 is not answerable from the message, and the
 * resolved request is exactly what the template is missing.
 */
function resolvedRequestLine(u) {
    if (!u?.ok || !u.understanding?.continuation_of || !u.understanding?.request) return null;
    return `\n\n【本轮】用户这条消息承接上文（${u.understanding.continuation_of}），实际要问的是：${u.understanding.request}\n只回答这一句；对话历史是背景，不是本轮的题目。`;
}

module.exports = {
    runUnderstanding, fetchUnderstandingInputs, understandingMode, resolvedRequestLine,
    requiredDataFrom, VALID_ROUTES, NEED_TO_REQUIRED_DATA,
};
