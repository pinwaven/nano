'use strict';

/**
 * A user never sees an internal sub-age key.
 *
 * `BioAge`, `ChronoAge`, `CellularAge`, `MetabolicAge`, `MicroVascularAge`, `ResilienceAge` are the
 * keys of `bioage_profile` (CLAUDE.md §11) — code identifiers, not names. Prod 2026-09-14: a
 * Formulate-Dots reply read 「生理年龄整体年轻（BioAge 39.2岁）…但MetabolicAge（41.5岁）是四个中相对
 * 最高的」. The model learned the tokens from two places that showed them verbatim — the
 * formulation prompts' own `年龄：BioAge = X, ChronoAge = Y` line, and `get_biomarkers` handing back
 * the raw `bioage_profile` object — and echoed them into Chinese prose.
 *
 * Same remedy as lib/dotNames.js for dot codes: stop showing the model the tokens, and rewrite
 * any that still slip through, once, on the assembled string, outside `:::` fences. A key has
 * exactly one correct rendering, so there is nothing to judge and no retry.
 *
 * Channel overrides (`channels.config.sub_age_display_names`, shape `{Key: {zh, en}}`) take
 * precedence — the same source prompts/viva/subAgeLabels.js already honours.
 */

const SUB_AGE_LABELS = {
    ResilienceAge:    { zh: '抗压年龄',  en: 'Resilience Age' },
    CellularAge:      { zh: '细胞年龄',  en: 'Cellular Age' },
    MetabolicAge:     { zh: '代谢年龄',  en: 'Metabolic Age' },
    MicroVascularAge: { zh: '微血管年龄', en: 'Micro-Vascular Age' },
};

const AGE_LABELS = {
    BioAge:    { zh: '生理年龄', en: 'biological age' },
    ChronoAge: { zh: '实际年龄', en: 'chronological age' },
};

const SUB_AGE_KEYS = Object.keys(SUB_AGE_LABELS);

function _lang(language) {
    return language === 'en' ? 'en' : 'zh';
}

function subAgeLabel(key, language, overrides) {
    const lang = _lang(language);
    return overrides?.[key]?.[lang]?.trim() || SUB_AGE_LABELS[key]?.[lang] || key;
}

/**
 * The bio-age profile as a model should see it: labelled, in the user's language, and with the
 * comparison to chronological age already done so it need not do arithmetic. Internals the
 * profile also carries (`Scores`, `Details`, `mFI`) are deliberately not projected — nothing a
 * user-facing reply should narrate.
 */
function describeBioAge(bioage, language, overrides) {
    if (!bioage || typeof bioage !== 'object') return null;
    const lang = _lang(language);
    const chrono = typeof bioage.ChronoAge === 'number' ? bioage.ChronoAge : null;
    const subAges = SUB_AGE_KEYS
        .filter(k => typeof bioage.SubAges?.[k] === 'number')
        .map(k => {
            const age = bioage.SubAges[k];
            const diff = chrono == null ? null : Math.round((age - chrono) * 10) / 10;
            const status = diff == null ? null
                : diff > 0 ? (lang === 'zh' ? '老于实际年龄' : 'older than chronological age')
                : diff < 0 ? (lang === 'zh' ? '年轻于实际年龄' : 'younger than chronological age')
                : (lang === 'zh' ? '与实际年龄相同' : 'equal to chronological age');
            return { dimension: subAgeLabel(k, lang, overrides), age, vs_chronological_years: diff, status };
        });
    const bio = typeof bioage.BioAge === 'number' ? bioage.BioAge : null;
    return {
        biological_age: bio,
        chronological_age: chrono,
        difference_years: bio != null && chrono != null ? Math.round((bio - chrono) * 10) / 10 : null,
        sub_ages: subAges,
    };
}

/**
 * One sub-age against chronological age, computed so a prompt states the direction instead of
 * leaving the model to subtract. A model left to do it drifts: the health-advice report called a
 * dimension 43.9 years old for a 51-year-old "明显偏高" in its summary, because a marker feeding it
 * was tagged 偏高 — while the same report's per-dimension section said "7.1 years younger". Within
 * ±0.5 year counts as equal. `older` is the only direction that makes a dimension 偏高 / needs
 * attention; that is the same rule the JUDGE's elevated_dimensions uses (SubAge > ChronoAge).
 */
function relationToChrono(age, chrono, language) {
    const zh = _lang(language) === 'zh';
    if (typeof age !== 'number' || typeof chrono !== 'number') return { diff: null, direction: null, text: '' };
    const diff = Math.round((age - chrono) * 10) / 10;
    const abs = Math.abs(diff).toFixed(1);
    if (Math.abs(diff) < 0.5) return { diff, direction: 'equal', text: zh ? '与实际年龄基本持平' : 'about the same as chronological age' };
    if (diff > 0) return { diff, direction: 'older', text: zh ? `比实际年龄老 ${abs} 岁` : `${abs} years older than chronological age` };
    return { diff, direction: 'younger', text: zh ? `比实际年龄年轻 ${abs} 岁` : `${abs} years younger than chronological age` };
}

// Word-bounded so `BioAge` inside a longer identifier is left alone. CJK characters are
// non-word to JS `\b`, so a token glued to Chinese text (`（BioAge 39.2岁）`) still matches.
const KEY_RE = /\b(BioAge|ChronoAge|ResilienceAge|CellularAge|MetabolicAge|MicroVascularAge)\b/g;
const OPEN_RE = /^:::\s*[a-z][a-z0-9_-]*\s*$/i;
const CLOSE_RE = /^:::\s*$/;
// A CJK/word label immediately re-stated in parentheses as itself, e.g. 「细胞年龄（细胞年龄）」 —
// the artifact of rewriting a key the model wrote as a gloss after its own label. `\1` matches only
// when the two are identical, so an unrelated parenthetical (「代谢年龄（最低）」) is left alone.
const GLOSS_RE = /([一-龥A-Za-z-]+)\s*[（(]\s*\1\s*[）)]/g;

/**
 * Replace every internal age key outside a ::: block with its display name.
 */
function humanizeSubAgeKeys(text, language, overrides) {
    if (!text || typeof text !== 'string') return text;
    if (!KEY_RE.test(text)) { KEY_RE.lastIndex = 0; return text; }
    KEY_RE.lastIndex = 0;
    const lang = _lang(language);
    const render = (key) => AGE_LABELS[key]?.[lang] || subAgeLabel(key, lang, overrides);

    let inFence = false;
    return text.split('\n').map(line => {
        if (OPEN_RE.test(line)) { inFence = true; return line; }
        if (inFence) {
            if (CLOSE_RE.test(line)) inFence = false;
            return line;
        }
        const rewritten = line.replace(KEY_RE, (_, key) => render(key));
        // The model routinely writes the label AND the key it just learned it from, as a gloss:
        // 「细胞年龄（CellularAge）」, 「实际年龄（ChronoAge）」. Rewriting the key in place would
        // then produce 「细胞年龄（细胞年龄）」. Collapse a label immediately followed by a
        // parenthesised copy of itself (full- or half-width parens), which is exactly that gloss.
        return rewritten.replace(GLOSS_RE, '$1');
    }).join('\n');
}

module.exports = { SUB_AGE_LABELS, SUB_AGE_KEYS, subAgeLabel, describeBioAge, relationToChrono, humanizeSubAgeKeys };
