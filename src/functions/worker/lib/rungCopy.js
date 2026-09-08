'use strict';
/**
 * One line of upgrade copy per rung of the purchasable ladder (CLAUDE.md §28f), written by a
 * short second LLM call that is SHOWN the dots it is describing.
 *
 * WHY THIS IS A SEPARATE CALL. The formulation prompt used to ask for the copy inline, keyed to a
 * "tier" tag the model also had to assign. That could not work: the copy is keyed on a rung's
 * POSITION while a rung's MEMBERSHIP falls out of _capDistinctDots' emphasis ranking, so the two
 * agree only when the model's tags happen to reproduce the server's ranking exactly. Measured
 * 2026-09-07 over nine qwen-plus runs and three revisions of the instruction, that never once
 * happened (17/0/0, 7/6/4, 9/4/4 x3, 4/0/0 x2, 6/3/2) — and the revision that pushed hardest on
 * the tag counts made one run zero 13 of 17 dots and emit no ladder at all. Copy written about
 * dots that are not in the rung is worse than no copy, so every mismatch was dropped and 6 of 8
 * rungs shipped bare.
 *
 * Here the rungs already exist and are final. The model is handed their real contents and asked
 * only to describe them, so a mismatch is not possible by construction, and the main formulation
 * prompt gets shorter rather than longer.
 *
 * NEVER FATAL. A rung with no copy is the pre-existing, well-handled state (the card renders the
 * dot names above the line either way), so every failure path here returns what it has. This runs
 * on the async delivery path where the user is not waiting on the HTTP response.
 */

const { getFactConstraintBlock } = require('../prompts/chat/factConstraint');
const { humanizeDotCodes } = require('./dotNames');

const MAX_PITCH_CHARS = 60;      // the card's own cap is 90; leave room for the guardrail's own trim
const CALL_TIMEOUT_MS = 25_000;

function _dotLabel(dot, isZh) {
    if (!dot) return '';
    return (isZh ? (dot.name_zh || dot.name) : (dot.name || dot.name_zh)) || dot.key_name;
}

// The rung as the user will see it: the dots' real names, what each targets, and nothing else.
// Doses are deliberately omitted — the copy must not cite a number, so it is not given one.
function _describeRung(rung, byKey, isZh) {
    const items = (rung.added || []).map(a => {
        const dot = byKey.get(a.key);
        const target = dot && dot.sub_age_target ? `，对应维度：${dot.sub_age_target}` : '';
        const ing = dot && (isZh ? dot.ingredients_zh : dot.ingredients);
        const ingStr = ing ? `［${typeof ing === 'string' ? ing : Object.keys(ing).join('、')}］` : '';
        return `${_dotLabel(dot, isZh)}${ingStr}${target}`;
    }).filter(Boolean);
    return items;
}

function buildRungCopyPrompt(rungs, dotsFormulary, lang, essentialKnowledge) {
    const isZh = lang !== 'en';
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const blocks = rungs.map((r, i) => {
        const items = _describeRung(r, byKey, isZh);
        const label = r.tier_label || `${r.max_distinct_dots}${isZh ? '种' : ' dots'}`;
        return isZh
            ? `第 ${i + 1} 档（${label}）比上一档多出的原粒：\n${items.map(x => `  · ${x}`).join('\n')}`
            : `Rung ${i + 1} (${label}) adds these dots over the tier below:\n${items.map(x => `  · ${x}`).join('\n')}`;
    }).join('\n\n');

    const rules = isZh
        ? `你是精准长寿顾问的文案。上面每一档是用户在核心配方之外可以再加上的原粒——它们已经由系统选定，不会再变。
为每一档写一句升级说明，规则：
· 一句话，${MAX_PITCH_CHARS} 字以内，直接写给用户看；
· 只描述这一档补上了什么能力或方向——**一个原粒的名称都不要出现**，卡片会在这句话正上方逐个列出它们，重复只会显得啰嗦；
· 语气可以向往、有画面感，它是产品介绍，不是疗效承诺；
· 绝不可写出起效时间、改善幅度、任何数值预测或效果保证；不得编造成分、机制或功效；不得写价格、库存或购买渠道；
· 只依据上面列出的原粒来写，不要引入它们没有的作用。
只输出 JSON，不要任何其他文字：
{"pitches":[${rungs.map((_, i) => `"第${i + 1}档的那句话"`).join(',')}]}`
        : `You write copy for a precision-longevity advisor. Each rung above is what the user can add on top of the core formula — the system has already chosen them and they will not change.
Write one upgrade line per rung:
· one sentence, under 25 words, written for the user;
· describe only what the rung completes — **never name a single dot**; the card lists them on the line directly above, so repeating them only reads as padding;
· the tone may be aspirational and evocative; it is a product description, not a promise of effect;
· never state an onset window, an improvement magnitude, any numeric forecast, or a guarantee of results; never invent an ingredient, mechanism or effect; never write a price, stock level or purchase channel;
· write only from the dots listed above — do not attribute effects they do not have.
Output JSON only, nothing else:
{"pitches":[${rungs.map((_, i) => `"the line for rung ${i + 1}"`).join(',')}]}`;

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
    // Length is not required to match: a short array leaves later rungs bare, which is the
    // handled state. A long one is truncated rather than trusted to line up.
    return parsed.pitches.slice(0, expected).map(p => (typeof p === 'string' ? p.trim() : ''));
}

/**
 * Returns the rungs with `pitch` filled in. Always returns an array of the same length and
 * order; on any failure the pitches are simply empty strings.
 */
async function attachRungCopy({ client, model, rungs, dotsFormulary, lang, essentialKnowledge, logContext }) {
    const list = Array.isArray(rungs) ? rungs : [];
    if (list.length === 0) return list;
    // A rung whose additions were squeezed out by the daily budget has nothing to describe.
    if (!list.some(r => (r.added || []).length > 0)) return list;

    const prompt = buildRungCopyPrompt(list, dotsFormulary, lang, essentialKnowledge);
    let raw = '';
    try {
        const completion = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7, // copy, not arithmetic — the only call here that wants some range
        }, { timeout: CALL_TIMEOUT_MS });
        raw = completion.choices?.[0]?.message?.content || '';
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'rung_copy_call_failed', context: logContext, error: err.message }));
        return list;
    }
    const pitches = _parsePitches(raw, list.length);
    if (!pitches) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'rung_copy_parse_failed', context: logContext, raw: raw.slice(0, 200) }));
        return list;
    }
    // A pitch is rendered INSIDE the :::formula fence (`#rung|label|width|pitch`), which the
    // fence-aware pass in the delivery path deliberately skips — so a code has to be rewritten
    // here, on the bare string, before it is ever placed in the card.
    return list.map((r, i) => ({
        ...r,
        pitch: humanizeDotCodes((pitches[i] || '').slice(0, MAX_PITCH_CHARS), dotsFormulary, lang),
    }));
}

module.exports = { attachRungCopy, buildRungCopyPrompt, _parsePitches, MAX_PITCH_CHARS };
