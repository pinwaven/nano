'use strict';

/**
 * Rewrite internal dot codes out of user-facing prose.
 *
 * `D-N9` is how the formulation prompt addresses a dot, and `DOT-N9` is its `dots.key_name` and
 * the key of a `:::formula` row. Neither is a name — a user has no way to read one, and both
 * `systemFormulaGenerate.js` prompts already tell the model to use the 对话中称呼 (`key_name_zh`,
 * "原粒9号") instead. Prod shows the model ignoring that in 13 of 4394 AI replies over 30 days,
 * so this rewrites rather than asks again: the server already owns what the card says, and the
 * prose beside it is held to the same standard.
 *
 * Rewriting is the whole fix. There is deliberately no detector and no retry — a code has exactly
 * one correct rendering, taken from the same `dots` row the card is drawn from, so there is
 * nothing to judge and nothing that can come back wrong.
 *
 * WHAT IT MUST NOT TOUCH: the inside of a `::: ... :::` block. `:::formula` rows are
 * `key|name|color|am|pm` and `utils/markdown.js` parses that key — rewriting it there would break
 * the card outright. Fences are tracked exactly as the client tracks them (an opening
 * `:::name` line, closed by a bare `:::` or implicitly by the next `:::name`).
 */

// `DOT` is tried before `D` so "DOT-N9" matches whole rather than leaving a stray "OT".
const CODE_RE = /\b(?:DOT|D)-N(\d{1,2})\b/g;

const OPEN_RE = /^:::\s*[a-z][a-z0-9_-]*\s*$/i;
const CLOSE_RE = /^:::\s*$/;

/**
 * @param {Array} dotsFormulary rows from `dots` (needs key_name plus the display columns)
 * @param {string} lang 'zh' | 'en'
 * @returns {Map<string, string>} numeric suffix -> what a user should see
 */
function buildDotNameMap(dotsFormulary, lang) {
    const map = new Map();
    for (const d of dotsFormulary || []) {
        const m = /^DOT-N(\d{1,2})$/.exec(d?.key_name || '');
        if (!m) continue;
        // zh gets the conversational name the prompts already name ("原粒9号"); en has no such
        // column, and the English formulary line shows the dot's name, so that is what a user
        // there has actually been shown.
        const display = lang === 'en'
            ? (d.name || d.name_zh)
            : (d.key_name_zh || d.name_zh || d.name);
        if (display) map.set(m[1], display);
    }
    return map;
}

/**
 * Replace every internal dot code outside a ::: block with its display name.
 * An unmapped code (a dot that does not exist) is left exactly as written — it is a fabrication
 * for `factCheck.js` to flag, not something this function can silently make look legitimate.
 */
function humanizeDotCodes(text, dotsFormulary, lang = 'zh') {
    if (!text || typeof text !== 'string') return text;
    if (!CODE_RE.test(text)) { CODE_RE.lastIndex = 0; return text; }
    CODE_RE.lastIndex = 0;

    const map = buildDotNameMap(dotsFormulary, lang);
    if (map.size === 0) return text;

    let inFence = false;
    const out = text.split('\n').map(line => {
        if (OPEN_RE.test(line)) { inFence = true; return line; }
        if (inFence) {
            if (CLOSE_RE.test(line)) inFence = false;
            return line;
        }
        return line.replace(CODE_RE, (whole, num) => map.get(num) || whole);
    });
    return out.join('\n');
}

module.exports = { humanizeDotCodes, buildDotNameMap };
