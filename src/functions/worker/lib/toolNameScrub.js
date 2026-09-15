'use strict';

/**
 * A user never sees an internal tool name.
 *
 * GENERATE narrates its own tool calls — 「已确认你当前没有原粒方案（`get_nutrition_schedule` 返回空数组）」
 * on dev, 2026-09-15, in three consecutive runs with a prompt rule forbidding exactly that. Same
 * remedy as lib/dotNames.js and lib/subAgeLabels.js: rewrite deterministically, once, on the
 * assembled string, outside `:::` fences.
 *
 * A parenthetical that exists only to cite the tool — 「（`get_x` 返回空）」, "(via get_x)" — is
 * removed whole, because what remains of it would be nonsense. A bare mention elsewhere is
 * reduced to a neutral 「系统数据」/"the system data", never left as an identifier.
 */

// Any snake_case identifier — a tool (`get_nutrition_schedule`), an action (`set_reminder`,
// 「需调用 set_reminder」 reached prose on dev 2026-09-15), or a field label quoted straight out
// of a tool result (`stage_meaning`: "…", same day, §28g's rule notwithstanding). Nothing a user
// should read is written in snake_case, so two or more underscore-joined lowercase parts is the
// signature of an internal identifier.
const IDENT = String.raw`\b[a-z]+(?:_[a-z0-9]+)+\b`;
const TOOL_NAME_RE = new RegExp('`?' + IDENT + '`?', 'g');
// A backticked code span that quotes machine state — `timing_flexible=false`, `timing='Evening'`,
// `status: proposed` — goes whole. Replacing only the identifier inside it left 「系统数据=false`」
// in a reply (dev, 2026-09-15). A span with none of = ' " : _ is a name the model chose to
// emphasise (a dot, a food) and is left alone.
const CODE_SPAN_RE = /`([^`\n]{1,80})`/g;
const MACHINE_SPAN = /[=_'":]/;
// A quoted field label with its colon — `stage_meaning`: … — goes as a unit, leaving the value.
const FIELD_LABEL_RE = new RegExp('`?' + IDENT + '`?\\s*[:：]\\s*', 'g');
// A （…） or (…) group whose content mentions an identifier; non-nested, which is all these ever are.
const TOOL_PAREN_RE = new RegExp(String.raw`\s*[（(][^（）()\n]*?` + '`?' + IDENT + '`?' + String.raw`[^（）()\n]*?[）)]`, 'g');

const OPEN_RE = /^:::\s*[a-z][a-z0-9_-]*\s*$/i;
const CLOSE_RE = /^:::\s*$/;

function scrubToolNames(text, language = 'zh') {
    if (!text || typeof text !== 'string') return text;
    const hasIdent = TOOL_NAME_RE.test(text); TOOL_NAME_RE.lastIndex = 0;
    const hasSpan = CODE_SPAN_RE.test(text); CODE_SPAN_RE.lastIndex = 0;
    if (!hasIdent && !hasSpan) return text;
    const neutral = language === 'en' ? 'the system data' : '系统数据';

    let inFence = false;
    return text.split('\n').map(line => {
        if (OPEN_RE.test(line)) { inFence = true; return line; }
        if (inFence) {
            if (CLOSE_RE.test(line)) inFence = false;
            return line;
        }
        // Parenthetical first: it keys on the identifier the span rule would neutralise.
        return line
            .replace(TOOL_PAREN_RE, '')
            .replace(FIELD_LABEL_RE, '')
            .replace(CODE_SPAN_RE, (whole, inner) => (MACHINE_SPAN.test(inner) ? neutral : whole))
            .replace(TOOL_NAME_RE, neutral);
    }).join('\n');
}


/**
 * Drop a line that is entirely in the wrong language.
 *
 * A REVISE round pastes the fact-checker's English hint straight into a Chinese reply — twice on
 * dev 2026-09-15 as a bold heading: 「**No matched knowledge base entries exist for vegetarian or
 * plant-based capsule formulation claims.**」 — with a prompt rule against exactly that in force.
 * A Chinese reply has no legitimate line of five-plus English words and not one CJK character:
 * a product name, a unit, a biomarker key are all short and sit inside Chinese sentences.
 * Fences are left alone (markup), as are table rows (a pipe row with no CJK is a separator).
 */
const CJK_RE = /[\u4e00-\u9fff]/;
const LATIN_WORDS_RE = /\b[A-Za-z]{2,}\b/g;
const FOREIGN_LINE_MIN_WORDS = 5;

function dropForeignLines(text, language = 'zh') {
    if (!text || typeof text !== 'string' || language === 'en') return text;
    let inFence = false;
    const kept = [];
    for (const line of text.split('\n')) {
        if (OPEN_RE.test(line)) { inFence = true; kept.push(line); continue; }
        if (inFence) { if (CLOSE_RE.test(line)) inFence = false; kept.push(line); continue; }
        const isForeign = !CJK_RE.test(line)
            && !/^\s*\|/.test(line)
            && (line.match(LATIN_WORDS_RE) || []).length >= FOREIGN_LINE_MIN_WORDS;
        if (!isForeign) kept.push(line);
    }
    // Collapse the blank line a dropped paragraph leaves behind.
    return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

module.exports = { scrubToolNames, dropForeignLines };
