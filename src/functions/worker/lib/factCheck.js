/**
 * Output-side backstop against the highest-confidence fabrication patterns
 * that testing showed slipping past pure prompt instructions (2026-07-25):
 * fake p-values, fake gene SNP IDs, fake named-cohort studies, fake
 * journal-with-year citations. None of the approved canonical evidence
 * phrases ("有随机对照试验（RCT）支持" etc.) ever produce these patterns,
 * so a hit here is a strong signal of real fabrication, not a paraphrase
 * of something legitimate.
 *
 * This is a backstop, not a replacement for the prompt-level rules in
 * chat/factConstraint.js (shared by both personas) -- keep patterns conservative/high-precision to
 * avoid false-flagging legitimate content and triggering needless retries.
 */
'use strict';

const PATTERNS = {
    pValue: /p\s*[<>=]\s*0\.\d+/i,
    geneRsId: /\brs\d{3,}\b/,
    cohortMention: /队列/,
    fakeInstitution: /中华医学会|参考数据库|多中心数据库/,
    // Allows one level of nested half-width parens in the body (only excludes full-width （）)
    // since real fabricated citations often include a volume(issue) page range, e.g.
    // "(J Am Coll Cardiol. 2020;76(1):1-15)" — the earlier version excluded all parens from
    // the body and missed exactly this pattern.
    journalYearCitation: /[（(][*\s]*[A-Za-z][^（）]{0,80}\d{4}[^（）]{0,20}[）)]/,
    bookTitleCitation: /《[^《》]{2,40}》/,
    // The product only has 4 real dimensions (Cellular/Metabolic/MicroVascular/Resilience Age).
    // Testing found the model sometimes invents a specific numeric value for a dimension that
    // doesn't exist (e.g. "排毒年龄（42.5岁，偏高）") instead of saying it isn't measured —
    // flag only when a fake dimension name is immediately followed by an asserted value, not
    // when the reply is correctly explaining that the dimension doesn't exist.
    fakeDimensionValue: /(排毒年龄|肠道年龄|皮肤年龄|免疫年龄|情绪年龄|骨骼年龄)[^。！？\n]{0,15}\d+(\.\d+)?\s*岁/,
    // Colloquial/TCM ingredient names that never appear verbatim in the real dots catalog
    // (which uses formal pharmacological names, e.g. "小檗碱" not "黄连素") — testing found
    // these recurring as external-supplement recommendations despite the dots-only rule.
    knownExternalIngredient: /黄连素|硫辛酸|葡萄籽|原花青素/,
};

// A specific mg dosage not attributed to a named dot (referenced as "X号" and/or "原粒") on the
// same line is almost always an external-supplement recommendation slipping past the dots-only
// rule — real dot ingredients are always sub-36mg and named right next to their dot on one line.
// Two deliberate narrowings to cut false positives found in testing:
//  - "mg" only, not "g": whole-food meal suggestions (explicitly allowed) are measured in g
//    (e.g. "山药60g"), while every real dot ingredient is dosed in mg.
//  - excludes "mg/L", "mg/dL" etc: biomarker concentration units, not dosages, and appear
//    constantly in completely normal biomarker discussion (e.g. "hsCRP 1.07 mg/L").
function hasStandaloneDosage(text) {
    const mgRegex = /\d+(\.\d+)?\s*mg\b(?!\s*\/)/gi;
    let match;
    while ((match = mgRegex.exec(text)) !== null) {
        const lineStart = text.lastIndexOf('\n', match.index);
        const windowStart = lineStart === -1 ? 0 : lineStart;
        if (!/\d号|原粒/.test(text.slice(windowStart, match.index))) return true;
    }
    return false;
}

// Broader companion to the fakeDimensionValue pattern above: catches asserting a fake
// dimension's existence/methodology without giving a number yet (e.g. "Kino芯片能...同步
//输出情绪年龄"), which the number-anchored pattern can't see. Checked per-occurrence since a
// reply can correctly disclaim a term once, then still assert it as real later on (as observed
// in testing) -- a single whole-text "is there a disclaiming word anywhere" check would miss that.
function hasFakeDimensionAssertion(text) {
    const dimTerms = /排毒年龄|肠道年龄|皮肤年龄|免疫年龄|情绪年龄|骨骼年龄/g;
    const assertiveVerbs = /输出|评估|测量|包含|计算|生成|提供|包括/;
    // Broadened after testing found real misses: "未包含"/"未测量"/"未检测"/"暂未" are common
    // honest-disclaim phrasings that the original narrower list didn't recognize (false negative
    // on legitimate content), and Chinese sentence order often puts the verb *before* the term
    // ("生成包括情绪年龄在内的报告") rather than after, which the original forward-only window missed.
    const disclaimTerms = /未提供|并非|不属于|没有|暂无|不是|无法|未包含|未测量|未检测|暂未|不能仅凭|不能仅通过/;
    let m;
    while ((m = dimTerms.exec(text)) !== null) {
        const before = text.slice(Math.max(0, m.index - 20), m.index);
        const after = text.slice(m.index, m.index + 40);
        const hasDisclaim = disclaimTerms.test(before) || disclaimTerms.test(after.slice(0, 15));
        const hasVerbAfter = assertiveVerbs.test(after);
        const hasVerbBefore = assertiveVerbs.test(before);
        if ((hasVerbAfter || hasVerbBefore) && !hasDisclaim) {
            return true;
        }
    }
    return false;
}

function detectFabricationRisk(text) {
    if (!text || typeof text !== 'string') return [];
    const hits = [];
    for (const [name, re] of Object.entries(PATTERNS)) {
        if (re.test(text)) hits.push(name);
    }
    if (hasStandaloneDosage(text)) hits.push('standaloneDosage');
    if (hasFakeDimensionAssertion(text)) hits.push('fakeDimensionAssertion');
    return hits;
}

// Extracts every "X号原粒 NAME" / "DOT-NX（NAME）" style dot reference from a reply, so it can
// be cross-checked against the real formulary. Testing found the model reusing pre-migration
// dot names against post-migration dot numbers (e.g. "DOT12（深度睡眠与恢复）" when the real
// DOT-N12 is "敏锐心智") and inventing product names tied to no real dot at all ("NeuroPrime").
// Sentence-continuation words the model correctly uses after "X号原粒" when it deliberately
// avoids naming/describing the dot (the "number-only fallback" instructed in factConstraint.js
// and the retry correction). Testing showed the greedy name-capture misreading these as a
// fabricated claimed name, e.g. "12号原粒有随机对照试验（RCT）支持" -> falsely captured "有随机
// 对照试验" as if it were a name. Treat a captured span starting with one of these as "no name
// claimed" rather than a mismatch.
const _NON_NAME_CONTINUATIONS = /^(是|有|针对|可以|能够|能|为|其|该|这|可|将|会|须|需|按|建议|来自|来源于)/;

function _extractDotReferences(text) {
    const refs = [];
    const zhRegex = /(\d{1,3})号原粒[\s:：]*[「『'"*]*([^\n，,。！？；;（(「『'"*]{2,16})/g;
    let m;
    while ((m = zhRegex.exec(text)) !== null) {
        const claimedName = m[2].trim().replace(/[*」』'"]+$/, '');
        if (_NON_NAME_CONTINUATIONS.test(claimedName)) continue;
        refs.push({ num: parseInt(m[1], 10), claimedName });
    }
    const enRegex = /DOT-?N?(\d{1,3})[\s:：]*[（(]([^（）()]{2,20})[）)]/g;
    while ((m = enRegex.exec(text)) !== null) {
        const claimedName = m[2].trim();
        if (_NON_NAME_CONTINUATIONS.test(claimedName)) continue;
        refs.push({ num: parseInt(m[1], 10), claimedName });
    }
    return refs;
}

// Requires the real dots_formulary (as fetched server-side, e.g. llmContext.dots) since the
// reply text alone can't reveal a mismatch — the ground truth for "what is dot #12 actually
// called" only exists in the DB, not in any regex pattern.
function detectDotNameMismatch(text, dotsFormulary) {
    if (!text || !Array.isArray(dotsFormulary) || dotsFormulary.length === 0) return [];
    const byId = new Map(dotsFormulary.map(d => [d.id, d]));
    const mismatches = [];
    for (const ref of _extractDotReferences(text)) {
        const real = byId.get(ref.num);
        if (!real) {
            mismatches.push({ num: ref.num, claimedName: ref.claimedName, realName: null });
            continue;
        }
        const realName = (real.name_zh || real.name || '').trim();
        if (!realName) continue;
        if (!ref.claimedName.includes(realName) && !realName.includes(ref.claimedName)) {
            mismatches.push({ num: ref.num, claimedName: ref.claimedName, realName });
        }
    }
    return mismatches;
}

// Catches a subtler variant detectDotNameMismatch can't see: the dot NUMBER is correct (and
// possibly no name is even claimed) but the parenthetical ingredient list is fabricated, e.g.
// "12号原粒（含南非醉茄提取物、磷脂酰丝氨酸、维生素B5）" when the real DOT-N12 is Citicoline +
// Huperzine A. Extracts the first parenthetical after "X号原粒", tokenizes it (splitting on
// +/、/, and stripping mg amounts / a leading "含"), and flags if none of the claimed tokens
// match any of the dot's real ingredient names -- a real listing always names at least one
// real ingredient verbatim, so zero overlap is a strong fabrication signal.
function detectDotIngredientMismatch(text, dotsFormulary) {
    if (!text || !Array.isArray(dotsFormulary) || dotsFormulary.length === 0) return [];
    const byId = new Map(dotsFormulary.map(d => [d.id, d]));
    const mismatches = [];
    const refRegex = /(\d{1,3})号原粒[^（(\n]{0,20}[（(]([^（）()]{4,100})[）)]/g;
    let m;
    while ((m = refRegex.exec(text)) !== null) {
        const num = parseInt(m[1], 10);
        const real = byId.get(num);
        if (!real) continue;
        const realIngredients = (real.ingredients_zh || real.ingredients || []);
        if (!Array.isArray(realIngredients) || realIngredients.length === 0) continue;
        const realNames = realIngredients.map(i => (i.name || '').trim()).filter(Boolean);
        if (realNames.length === 0) continue;
        const claimedTokens = m[2]
            .replace(/^含/, '')
            .split(/[+、,，]/)
            .map(t => t.replace(/\d+(\.\d+)?\s*mg/gi, '').trim())
            .filter(t => t.length >= 2);
        if (claimedTokens.length === 0) continue;
        const anyMatch = claimedTokens.some(t => realNames.some(rn => t.includes(rn) || rn.includes(t)));
        if (!anyMatch) {
            mismatches.push({ num, claimedIngredients: claimedTokens, realIngredients: realNames });
        }
    }
    return mismatches;
}

// Catches the other half of the fabricated-product problem: names invented with no dot number
// attached at all ("「NeuroPrime」组合", "「晨光原粒」"), which _extractDotReferences can't see
// since there's no "X号"/"DOTX" to anchor on. Flags a quoted name near formulary-ish framing
// ("配方库"/"Waven"/"原粒") that doesn't match any real dot name.
function detectFakeProductName(text, dotsFormulary) {
    if (!text || !Array.isArray(dotsFormulary) || dotsFormulary.length === 0) return [];
    const realNames = Array.from(new Set(dotsFormulary.map(d => (d.name_zh || d.name || '').trim()).filter(Boolean)));
    const mismatches = [];
    const quoteRegex = /[「『]([^「『」』]{2,20})[」』]/g;
    let m;
    while ((m = quoteRegex.exec(text)) !== null) {
        const name = m[1].trim();
        const isReal = realNames.some(rn => name.includes(rn) || rn.includes(name));
        if (isReal) continue;
        const contextStart = Math.max(0, m.index - 80);
        if (/配方库|原粒库/.test(text.slice(contextStart, m.index))) {
            mismatches.push({ claimedName: name, realName: null });
        }
    }
    return mismatches;
}

// Aggregates every detector above into one risk-category list for a reply. Shared by the
// existing single-retry fast path (chat.js `_regenerateIfFabricationRisk`) and the JUDGE step
// of the agentic loop (lib/agenticChat.js) so both call one implementation instead of
// duplicating the detector list.
// ── Dimension misattribution, computed rather than asked ─────────────────────
// biomarkerStatus.js's DIMENSION_BIOMARKERS comment says the map exists so JUDGE can
// "mechanically catch a reply that attributes a biomarker to the wrong dimension" — but it was
// only ever handed to the LLM as a table to reason over, and the LLM is measurably bad at it.
// Live sampling 2026-08-22 on a draft containing ZERO real misattributions: JUDGE raised 3-7
// dimension_misattribution violations per run, every one a false positive, several openly
// self-contradictory ("This is factually incorrect. According to dimension_biomarker_map,
// MicroVascularAge is indeed computed from CystatinC"). Since every REJECT costs a REVISE round
// (~70s) and rewrites a correct reply into a worse one, that single category was the dominant
// driver of both the latency and the quality loss.
//
// This does the comparison in code, in the same spirit as classifyBiomarkers replacing "ask the
// model to threshold-compare a value". Deliberately conservative — a false positive here is
// exactly the failure being fixed, so it only fires on an unambiguous case:
//   * the segment names EXACTLY ONE dimension (two or more is ambiguous prose -> skip),
//   * it contains a STRONG causal verb (not "影响"/"关联", which are everywhere and mean little),
//   * and it names a biomarker that dimension's score genuinely does not take as input.
// Everything softer stays JUDGE's job, but can no longer by itself force a rewrite.
const _DIMENSION_LABELS = {
    CellularAge:      ['细胞年龄', 'Cellular Age', 'CellularAge'],
    MetabolicAge:     ['代谢年龄', 'Metabolic Age', 'MetabolicAge'],
    MicroVascularAge: ['微血管年龄', 'Micro-Vascular Age', 'MicroVascular Age', 'MicroVascularAge'],
    ResilienceAge:    ['抗压年龄', 'Resilience Age', 'ResilienceAge'],
};

const _BIOMARKER_ALIASES = {
    hsCRP:     [/hs-?CRP/i, /超敏C反应蛋白/],
    IL6:       [/IL-?6\b/i, /白细胞介素-?6/],
    GDF15:     [/GDF-?15\b/i, /生长分化因子-?15/],
    CD38:      [/CD38\b/i],
    GA:        [/\bGA\b/, /糖化白蛋白/],
    CystatinC: [/cystatin\s*-?c/i, /胱抑素\s*-?C?/],
};

// Strong, unambiguous causal attribution only.
const _CAUSAL_MARKERS = /(核心驱动|主要驱动|核心因素|主导因素|驱动因素|所?驱动|主导|导致|造成|源于|决定于|由[^，。；\n]{0,12}计算得出|推高|拉高|归因于|drives?|driven by|core factor|main driver|caused by|explains?|determined by|attributable to)/i;

function detectDimensionMisattribution(reply, dimensionBiomarkers, extraLabels) {
    if (!reply || !dimensionBiomarkers) return [];
    const labels = {};
    for (const dim of Object.keys(dimensionBiomarkers)) {
        labels[dim] = (_DIMENSION_LABELS[dim] || []).slice();
        const override = extraLabels && extraLabels[dim];
        if (override && !labels[dim].includes(override)) labels[dim].push(override);
    }
    const out = [];
    const segments = String(reply).split(/[。！？!?\n]+|；|;/);
    for (const seg of segments) {
        if (!seg || !_CAUSAL_MARKERS.test(seg)) continue;
        const named = Object.keys(labels).filter(dim => labels[dim].some(l => seg.includes(l)));
        if (named.length !== 1) continue; // 0 = nothing to check, 2+ = ambiguous prose
        const dim = named[0];
        const own = dimensionBiomarkers[dim] || [];
        for (const key of Object.keys(_BIOMARKER_ALIASES)) {
            if (own.includes(key)) continue;
            if (!_BIOMARKER_ALIASES[key].some(re => re.test(seg))) continue;
            out.push({ dimension: dim, biomarker: key, allowed: own, quote: seg.trim().slice(0, 120) });
        }
    }
    return out;
}

// Catches a store product the model invented rather than picked from the catalog it was given.
//
// The counterpart to detectFakeProductName above, and structurally identical: a bracket-quoted
// name in a shopping context that matches nothing real. Needed as a separate detector because
// the shipped card is built from validated ids only — so a fabricated product never appears as a
// CARD, but nothing otherwise stops the model from naming one in its prose ("你可以看看「深海鱼油
// 胶囊」"), which reads to a user exactly like a real recommendation and sends them looking for
// something the store does not sell.
//
// Only fires when a catalog was actually supplied. On a turn with no catalog the essential block
// already forbids naming any product at all, and that is detectFakeProductName's territory.
function detectFakeStoreProduct(text, storeProducts) {
    if (!text || !Array.isArray(storeProducts) || storeProducts.length === 0) return [];
    const realNames = storeProducts.map(p => String(p.product_name_zh || '').trim()).filter(Boolean);
    const mismatches = [];
    const quoteRegex = /[「『]([^「『」』]{2,30})[」』]/g;
    let m;
    while ((m = quoteRegex.exec(text)) !== null) {
        const name = m[1].trim();
        if (realNames.some(rn => name.includes(rn) || rn.includes(name))) continue;
        // Same narrow-context guard detectFakeProductName uses: only treat a quoted string as a
        // product claim when the surrounding text is actually talking about buying something.
        // Chinese prose brackets plenty of things that are not products.
        const contextStart = Math.max(0, m.index - 80);
        if (/商城|商品|购买|下单|店铺|选购/.test(text.slice(contextStart, m.index))) {
            mismatches.push({ claimedName: name, realName: null });
        }
    }
    return mismatches;
}

function detectAllRisks(reply, dotsFormulary, storeProducts) {
    const risk = detectFabricationRisk(reply);
    if (dotsFormulary && dotsFormulary.length > 0) {
        if (detectDotNameMismatch(reply, dotsFormulary).length > 0) risk.push('dotNameMismatch');
        if (detectFakeProductName(reply, dotsFormulary).length > 0) risk.push('fakeProductName');
        if (detectDotIngredientMismatch(reply, dotsFormulary).length > 0) risk.push('dotIngredientMismatch');
    }
    if (detectFakeStoreProduct(reply, storeProducts).length > 0) risk.push('fakeStoreProduct');
    return risk;
}

module.exports = {
    detectFabricationRisk,
    detectDimensionMisattribution,
    detectDotNameMismatch,
    detectFakeProductName,
    detectFakeStoreProduct,
    detectDotIngredientMismatch,
    detectAllRisks,
};
