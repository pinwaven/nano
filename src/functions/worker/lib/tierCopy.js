'use strict';
/**
 * One line of copy per purchasable package (CLAUDE.md §28f), written by a short second LLM call
 * that is SHOWN the dots it is describing.
 *
 * WHY THIS IS A SEPARATE CALL. The formulation prompt used to ask for the copy inline, keyed to a
 * "tier" tag the model also had to assign. That could not work: the copy is keyed on a package's
 * POSITION while its MEMBERSHIP falls out of _capDistinctDots' emphasis ranking, so the two agree
 * only when the model's tags happen to reproduce the server's ranking exactly. Measured 2026-09-07
 * over nine qwen-plus runs and three revisions of the instruction, that never once happened
 * (17/0/0, 7/6/4, 9/4/4 x3, 4/0/0 x2, 6/3/2) — and the revision that pushed hardest on the tag
 * counts made one run zero 13 of 17 dots and emit no ladder at all. Copy written about dots that
 * are not in the package is worse than no copy, so every mismatch was dropped and 6 of 8 shipped
 * bare.
 *
 * Here the packages already exist and are final. The model is handed their real contents and asked
 * only to describe them, so a mismatch is not possible by construction, and the main formulation
 * prompt gets shorter rather than longer.
 *
 * IT DESCRIBES A WHOLE PACKAGE, NOT AN UPGRADE STEP. Until 2026-09-10 this wrote one line per
 * upgrade rung — "what a wider tier adds" — because the card drew one formula with rungs beneath
 * it. The card now draws three complete formulas, one per package sold, so the narrowest gets a
 * line of its own and every line answers the same question: what is this package, for this user.
 *
 * NEVER FATAL. A package with no copy is the pre-existing, well-handled state (the card renders
 * its dots either way), so every failure path here returns what it has. This runs on the async
 * delivery path where the user is not waiting on the HTTP response.
 */

const { getFactConstraintBlock } = require('../prompts/chat/factConstraint');
const { humanizeDotCodes } = require('./dotNames');

const MAX_PITCH_CHARS = 60;      // the card's own cap is 90; leave room for the guardrail's own trim
const CALL_TIMEOUT_MS = 25_000;
const N7_KEY = 'DOT-N7';

function _dotLabel(dot, isZh) {
    if (!dot) return '';
    return (isZh ? (dot.name_zh || dot.name) : (dot.name || dot.name_zh)) || dot.key_name;
}

// Every non-N7 dot a package contains, anywhere in the cycle. DOT-N7 is in all three and counted
// toward none of them, so naming it would describe no difference at all.
function _tierKeys(tier) {
    const keys = new Set();
    for (const recipe of [tier.morning, tier.evening]) {
        for (const [key, count] of Object.entries(recipe?.dots || {})) {
            if (key !== N7_KEY && count > 0) keys.add(key);
        }
    }
    return keys;
}

// The package as the user will see it: the dots' real names, what each targets, and nothing else.
// Doses are deliberately omitted — the copy must not cite a number, so it is not given one.
function _describeTier(tier, byKey, isZh) {
    return [...(tier.keys || _tierKeys(tier))].map(key => {
        const dot = byKey.get(key);
        if (!dot) return '';
        const target = dot.sub_age_target ? `，对应维度：${dot.sub_age_target}` : '';
        const ing = isZh ? dot.ingredients_zh : dot.ingredients;
        const ingStr = ing ? `［${typeof ing === 'string' ? ing : Object.keys(ing).join('、')}］` : '';
        return `${_dotLabel(dot, isZh)}${ingStr}${target}`;
    }).filter(Boolean);
}

function buildTierCopyPrompt(tiers, dotsFormulary, lang, essentialKnowledge) {
    const isZh = lang !== 'en';
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const blocks = tiers.map((t, i) => {
        const items = _describeTier(t, byKey, isZh);
        const label = t.tier_label || `${t.max_distinct_dots}${isZh ? '种' : ' dots'}`;
        const note = t.tier_description ? (isZh ? `（门店定位：${t.tier_description}）` : ` (store positioning: ${t.tier_description})`) : '';
        return isZh
            ? `第 ${i + 1} 档（${label}）${note}的完整配方：\n${items.map(x => `  · ${x}`).join('\n')}`
            : `Package ${i + 1} (${label})${note} contains, in full:\n${items.map(x => `  · ${x}`).join('\n')}`;
    }).join('\n\n');

    const rules = isZh
        ? `你是精准长寿顾问的文案。上面是同一位用户可以购买的 ${tiers.length} 档 28 天套餐，每一档的配方都已经由系统定好，不会再变；越往下的档位每周可同时服用的原粒种类越多。
为每一档写一句话，规则：
· 一句话，${MAX_PITCH_CHARS} 字以内，直接写给用户看；
· 只描述这一档整体覆盖到什么方向——**一个原粒的名称都不要出现**，卡片会在这句话下方逐个列出它们，重复只会显得啰嗦；
· 三句话要能互相区分：读完应该看得出为什么它们是三款不同的套餐，而不是同一款的三种大小；
· 语气可以向往、有画面感，它是产品介绍，不是疗效承诺；
· 绝不可写出起效时间、改善幅度、任何数值预测或效果保证；不得编造成分、机制或功效；不得写价格、库存或购买渠道；
· 只依据上面列出的原粒来写，不要引入它们没有的作用。
只输出 JSON，不要任何其他文字：
{"pitches":[${tiers.map((_, i) => `"第${i + 1}档的那句话"`).join(',')}]}`
        : `You write copy for a precision-longevity advisor. Above are the ${tiers.length} 28-day packages this one user can buy. Each package's formula is already fixed by the system and will not change; later packages run more distinct dots in any one week.
Write one line per package:
· one sentence, under 25 words, written for the user;
· describe only what the package covers as a whole — **never name a single dot**; the card lists them directly below this line, so repeating them only reads as padding;
· the lines must tell each other apart: a reader should see why these are three different packages, not three sizes of one;
· the tone may be aspirational and evocative; it is a product description, not a promise of effect;
· never state an onset window, an improvement magnitude, any numeric forecast, or a guarantee of results; never invent an ingredient, mechanism or effect; never write a price, stock level or purchase channel;
· write only from the dots listed above — do not attribute effects they do not have.
Output JSON only, nothing else:
{"pitches":[${tiers.map((_, i) => `"the line for package ${i + 1}"`).join(',')}]}`;

    return `${getFactConstraintBlock(essentialKnowledge, isZh)}\n\n${blocks}\n\n${rules}`;
}

function _parsePitches(raw, expected) {
    if (!raw) return null;
    const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    let parsed = null;
    try { parsed = JSON.parse(cleaned); } catch (_) {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (!m) return null;
        try { parsed = JSON.parse(m[0]); } catch (_) { return null; }
    }
    if (!parsed || !Array.isArray(parsed.pitches)) return null;
    // Length is not required to match: a short array leaves later packages bare, which is the
    // handled state. A long one is truncated rather than trusted to line up.
    return parsed.pitches.slice(0, expected).map(p => (typeof p === 'string' ? p.trim() : ''));
}

/**
 * Returns the tiers with `pitch` filled in. Always returns an array of the same length and
 * order; on any failure the pitches are simply empty strings.
 */
async function attachTierCopy({ client, model, tiers, dotsFormulary, lang, essentialKnowledge, logContext }) {
    const list = Array.isArray(tiers) ? tiers : [];
    if (list.length === 0) return list;
    // Nothing to describe. A single package is not a choice, and the card does not draw a ladder
    // for one — so this call is skipped rather than spent.
    if (list.length < 2) return list;
    if (!list.some(t => _tierKeys(t).size > 0)) return list;

    const prompt = buildTierCopyPrompt(list, dotsFormulary, lang, essentialKnowledge);
    let raw = '';
    try {
        const completion = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7, // copy, not arithmetic — the only call here that wants some range
        }, { timeout: CALL_TIMEOUT_MS });
        raw = completion.choices?.[0]?.message?.content || '';
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'tier_copy_call_failed', context: logContext, error: err.message }));
        return list;
    }
    const pitches = _parsePitches(raw, list.length);
    if (!pitches) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'tier_copy_parse_failed', context: logContext, raw: raw.slice(0, 200) }));
        return list;
    }
    // A pitch is rendered INSIDE the :::formula fence (`#pitch|...`), which the fence-aware pass in
    // the delivery path deliberately skips — so a code has to be rewritten here, on the bare
    // string, before it is ever placed in the card.
    return list.map((t, i) => ({
        ...t,
        pitch: humanizeDotCodes((pitches[i] || '').slice(0, MAX_PITCH_CHARS), dotsFormulary, lang),
    }));
}

module.exports = { attachTierCopy, buildTierCopyPrompt, _parsePitches, MAX_PITCH_CHARS };
