'use strict';
// The UNDERSTAND step (§47) — the replacement for prompts/chat/intentClassifier.js.
//
// The classifier read the message alone, with no history and nothing about the user, and picked
// one of 8 labels with max_tokens 60. The label does not pick the wording of the answer, it picks
// the TEMPLATE — i.e. which rules, data, tools and vocabulary the model is given — so a misread
// label doesn't degrade an answer, it writes it in the wrong world (2026-09-22:
// 「根据我的情况定制运动方案」 → nutrition template → grocery tool forced → 盒马 shopping list).
// Five deterministic regex backstops accumulated in ten days patching individual cases of that.
//
// This prompt instead asks one reasoning call to read the message the way a coach would — with the
// last few turns and a one-line user state — and to say in words what is being asked before it
// names a route. Measured against hand labels (temp/understanding-harness, 2026-09-22): mid-80s
// → mid-90s on both gold sets (eval 85.8% → 96–99%, held out 88.1% → 94–97% over repeated runs)
// and 50% → 83–92% on the messages that need conversation history. The extra fields (request /
// topics / must_not / success_criteria) are what make it reason before routing; only `route`,
// `needs` and `request` are consumed downstream.
//
// The wording is the version those numbers were measured on, down to the blank line between the
// two guidance blocks — the one deliberate addition since is the `store_products` sentence in
// item 5. Re-score with `temp/understanding-harness/07-run-shipped.js` after any edit here, twice:
// the run-to-run spread at temperature 0.1 is ~2 points, which is the same size as the drop from
// reordering two guidance bullets (measured 2026-09-22).
const FAMILIES = `
- explain_data       — explain/interpret THEIR OWN data: biomarkers, sub-ages, a report they uploaded, wearable readings, a comparison across tests, what to prioritise
- advice_plan        — asking what to DO for themselves: a diet/meal plan, an exercise or sleep plan, "how do I improve X", is this food/habit ok for me, what supplements might help
- symptom_concern    — reporting a symptom, condition or acute event and asking what it means or what to do (dizziness, edema, poisoning, a lump, chest tightness…)
- dots_question      — a question ABOUT 原粒/dots or an external supplement: what #N is, ingredients, timing, can I take it with X, contraindications, what to expect from taking them
- formulate_request  — asking to START a custom dots formulation NOW ("请帮我配制我的原粒方案", "营养定制生成", "现在就给我配置") — a request to act, not a question
- commerce           — orders, shipping, packages, price, where/how to buy, which store products could help
- science_general    — general knowledge not about their own data: what a marker is in general, food science, drug–food interactions, a supplement's function, which hospital tests exist
- record             — logging their own data or stating a fact about themselves: a weight, a meal they ate, exercise they did, "I am not taking folate", "I take selenium"
- reminder           — asking to be reminded
- profile_correction — change name / DOB / gender / a mistyped value
- emotional          — stress, fatigue, low mood, burnout expressed as a feeling, seeking support
- meta_complaint     — complaining about the assistant or a previous reply: "you didn't answer", "答非所问", "I did send the image", "your test is wrong", trust/methodology challenges
- app_usage          — how to use the app: where to upload, change settings, font size, customer service, a pasted link
- third_party        — about someone else's data (a friend, a client)
- document_share     — announcing/sharing an uploaded report ("这是我的同型半胱氨酸检测报告")
- small_talk         — greetings, thanks, off-topic chit-chat, a status update with no question
- form_answer        — a bare answer to a question the assistant just asked in a questionnaire ("早上6点" after "你通常几点起床？")`;

const ROUTES = `
- casual_chat        — greetings, small talk, app usage, complaints with no data need; NO tools, NO wearable block
- biomarker_question — their own results, bio age, sub-ages, wearable/sleep/HRV data, reports, comparisons, symptoms read against their data; has all data tools
- nutrition_question — dots/原粒 questions, supplements, diet/meal plans, food sensitivity, orders/packages/purchases/prices, store products; has the grocery and package tools
- lifestyle_question — exercise / training / sleep routine / daily schedule / stress practice plans; no catalog vocabulary
- formulate_dots     — START a custom formulation now (the client launches the formulation tool — a wrong pick here starts a real formulation)
- longevity_science  — general science/education not about their personal data
- record_action      — log a value (weight etc.)
- set_reminder       — set a reminder
- emotional_support  — stress/fatigue/low mood`;

const NEEDS = `get_biomarkers, get_biomarker_history, get_dots, get_health_plan, get_formulation_packages, get_food_sensitivity, get_grocery_products, get_health_reports, get_lab_history, get_questionnaire_responses, get_weight_history, get_health_twin, get_nutrition_schedule, get_reminders, get_wearable_daily, store_products`;

const ACTIONS = `record_weight, record_meal, record_exercise, set_reminder, formulate_dots, update_profile, remember_fact`;

// How a coach reads a message. Every line here is a class of error the closed-enum classifier made
// on real prod traffic, generalised — not a keyword patch for one message.
const READING_GUIDANCE = `
HOW A GOOD COACH READS A MESSAGE — apply these before deciding:
- Take the message at face value. A bare value or a plain statement about themselves ("空腹体重，52.30", "178cm 75.9kg", "练了12分钟八段锦", "我没有补充叶酸") is a record to acknowledge and log — do NOT invent a question the user did not ask (no "explain what this means for my metabolic age").
- A symptom, ache, lump, dizziness, poisoning, "X怎么办" about a medical condition is symptom_concern → route biomarker_question (their data is the context; the reply may need to say "see a doctor"). It is never lifestyle_question and never emotional_support unless the message is about a feeling.
- "Analyse / interpret / explain my results, my report, each indicator, what drives my bio age, what is hsCRP" from a user who HAS a Kino test is explain_data → biomarker_question (it is about THEIR numbers). science_general/longevity_science is only for knowledge questions that are clearly not about their own data (a food, a drug interaction, a supplement in general, which hospital tests exist).
- General "how do I improve / what should I do / give me a plan" that mixes diet, dots, reports, weight or overall health → biomarker_question (or nutrition_question when diet/dots dominate). lifestyle_question is ONLY for a request that is specifically an exercise / sleep / daily-routine / stress-practice plan with no diet, dots or report interpretation in it.
- "Is my weight ok / should I lose more" is about their own data → biomarker_question.
- App mechanics — where to upload, how to change a name, font size, a pasted link, "上传文档解析" — are app_usage → casual_chat. A pasted URL with no question is small_talk/app_usage → casual_chat.
- A question about what a numbered 原粒 is, its ingredients, timing, contraindications, or what taking a set of them will change → dots_question → nutrition_question.
- Ask a clarifying question ONLY when no reasonable reading exists AND no data tool could resolve it. "对比我最近两次检测" is resolved by get_biomarker_history, not by asking. Announcing an upload ("这是我的X报告") needs no clarification: read it (get_health_reports).

- Anything about what THEY should eat, drink or avoid — a food ("我能喝牛奶吗", "烤地瓜能吃吗"), a meal, a diet adjustment for a symptom ("胃酸，如何通过饮食来调整"), "what to eat before exercise", "the best way of eating according to my results" — is advice_plan with topic diet → route nutrition_question, even when it is phrased as a symptom or as "according to my results". That template holds the diet rules and the food-sensitivity tool; biomarker_question and longevity_science do not.
- "定制营养素是什么", "what is custom nutrition", anything asking what the dots programme/formulation IS → dots_question → nutrition_question, not longevity_science.
- Vague references are usually resolvable: "这个数据", "我的数据", "这份报告", "6个指标", "六项指标", "刚才那6个" from a user with a Kino test mean their latest Kino result (six biomarkers, four sub-ages) → explain_data → biomarker_question. Do not ask which data. A garbled or typo-ridden message ("您看的饮食需要那样调理") gets its most plausible reading, not a clarification.
`;

/**
 * @param {object} c
 * @param {string} c.message   the user's latest message
 * @param {Array<{role:string,content:string}>} [c.history]  prior turns, oldest first ('user'|'ai'|'assistant')
 * @param {object} [c.state]   { language, has_kino, has_wearable, has_nutrition_plan, facts[], health_plans[] }
 */
module.exports = (c) => {
    const hist = (c.history || [])
        .map(h => `${h.role === 'user' ? 'USER' : 'ASSISTANT'}: ${String(h.content || '').replace(/\s+/g, ' ').slice(0, 500)}`)
        .join('\n') || '(no earlier turns)';
    const st = c.state;
    const state = st
        ? `language=${st.language || 'zh'}; has_kino_test=${!!st.has_kino}; has_wearable=${!!st.has_wearable}; has_active_dots_plan=${!!st.has_nutrition_plan}; recorded_facts=${(st.facts || []).slice(0, 6).join(' / ') || 'none'}; active_health_plans=${(st.health_plans || []).join(' / ') || 'none'}`
        : '(unknown)';
    return `You are the understanding step of Viva, a longevity health coach for Chinese users. Before anything is answered, read the user's latest message the way an experienced human coach would: in the context of the last few turns and what is known about this user, and say — in words — what they actually want and what a good answer must contain. Do not answer the message.

WHAT WE KNOW ABOUT THE USER: ${state}

RECENT TURNS (oldest first; the assistant's earlier replies may be long — they are context, never the subject of this turn unless the user refers to them):
${hist}

LATEST USER MESSAGE:
${c.message}
${READING_GUIDANCE}
Decide:
1. request — one sentence, in Chinese, restating what the user wants from THIS message. If the message continues or corrects an earlier turn ("那运动呢", "内容呢？", "刚才说错了", "我说的是图片里的…"), resolve it against the turns above and restate the full request.
2. family — exactly one of:${FAMILIES}
3. topics — 1–4 short open-vocabulary tags (e.g. exercise, diet, sleep, dots, order, hsCRP, wearable, weight, pregnancy). Multi-topic is normal ("运动前要吃什么" → diet + exercise).
4. continuation_of — null, or a few words naming the earlier turn this depends on.
5. needs — which of these the answer genuinely requires (required) or would improve it (helpful): ${NEEDS}. Do not list a data source the request does not call for: an exercise plan does not need the grocery catalog; a greeting needs nothing. "store_products" is ONLY for a user asking what they could obtain, buy or use for a concern ("有没有什么产品可以帮助睡眠") — never for an order, a delivery, a package they already bought, or a price.
6. actions — side effects the user is asking for, from: ${ACTIONS}. Empty unless explicitly requested. formulate_dots ONLY for a clear request to start formulating now — never for a question about dots, a meal plan, a purchase, or "what is custom nutrition".
7. must_not — 0–3 things a reply must avoid given this request (e.g. "不要改答饮食", "不要报价格", "不要把历史里的餐单当作本轮题目").
8. success_criteria — 2–4 concrete checks a good reply satisfies, in Chinese, specific to THIS request. They describe the SHAPE of a good answer (what it must address), never its content: you have not seen the user's data, so never assume a value or a trait ("静息心率低", "体能好", "微血管老化") and never require the reply to mention a specific data source. The same goes for must_not: never forbid the coach's normal advice or safety guidance.
9. confidence — 0..1 that the request is understood. clarify — null, or ONE short question in Chinese if the message is too ambiguous to answer usefully (rare; a coach usually makes a reasonable reading).
10. route — which existing reply template fits best, exactly one of:${ROUTES}
    Choose the route from your understanding, not from surface words: 定制/方案/计划 do not imply nutrition; 吃 in "原粒怎么吃" is about dots, not food. A meal plan is nutrition_question, an exercise or sleep plan is lifestyle_question, a symptom read against their data is biomarker_question, "what is hsCRP" from a user who has a test is biomarker_question, and a purchase/order/price question is nutrition_question (that template holds the order tools). Only formulate_dots when the user is asking to start a formulation right now.

RESPOND WITH ONLY VALID JSON, NO OTHER TEXT:
{
  "reasoning": "<2–5 sentences: what is being asked, in light of the turns above; what a good answer contains>",
  "request": "<one sentence, Chinese>",
  "family": "<family>",
  "topics": ["<tag>", "..."],
  "continuation_of": null,
  "needs": {"required": [], "helpful": []},
  "actions": [],
  "must_not": [],
  "success_criteria": ["<check>", "..."],
  "confidence": 0.0,
  "clarify": null,
  "route": "<route>"
}`;
};
