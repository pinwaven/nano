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

const TOOL_NAME_RE = /`?\bget_[a-z_]+\b`?/g;
// A （…） or (…) group whose content mentions a tool; non-nested, which is all these ever are.
const TOOL_PAREN_RE = /\s*[（(][^（）()\n]*?`?\bget_[a-z_]+\b`?[^（）()\n]*?[）)]/g;

const OPEN_RE = /^:::\s*[a-z][a-z0-9_-]*\s*$/i;
const CLOSE_RE = /^:::\s*$/;

function scrubToolNames(text, language = 'zh') {
    if (!text || typeof text !== 'string') return text;
    if (!TOOL_NAME_RE.test(text)) { TOOL_NAME_RE.lastIndex = 0; return text; }
    TOOL_NAME_RE.lastIndex = 0;
    const neutral = language === 'en' ? 'the system data' : '系统数据';

    let inFence = false;
    return text.split('\n').map(line => {
        if (OPEN_RE.test(line)) { inFence = true; return line; }
        if (inFence) {
            if (CLOSE_RE.test(line)) inFence = false;
            return line;
        }
        return line.replace(TOOL_PAREN_RE, '').replace(TOOL_NAME_RE, neutral);
    }).join('\n');
}

module.exports = { scrubToolNames };
