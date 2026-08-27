'use strict';

/**
 * Validate a clarifying questionnaire authored by the external Viva AG agent.
 *
 * When the twin bundle is missing something the agent needs, it can park its claimed job and push
 * back a short questionnaire instead of guessing. This module is what stands between that
 * agent-authored payload and nano's questionnaire tables.
 *
 * It deliberately mirrors lib/agFormulation.js: pure functions, no DB, no I/O, and violations are
 * COLLECTED AND NAMED rather than thrown, so the caller can hand the agent a list to correct.
 *
 * ── The security boundary ───────────────────────────────────────────────────────────────────
 *
 * `questionnaire_questions` is a WRITE PATH INTO USER DATA. handlePostQuestionnaireResponse acts
 * on three of its columns when an answer arrives:
 *
 *   save_target = 'user_field'      → UPDATE users SET <save_field> = answer
 *   save_target = 'bio_data_field'  → users.bio_data ||= { <save_field>: answer }
 *   save_target = 'biomarker'       → INSERT INTO biomarkers (…, save_biomarker_type, …)
 *
 * and a fourth, `completion_check`, makes the client's _isQuestionAnswered auto-skip a question
 * whose answer it thinks already exists — so a non-empty one could push a form that instantly
 * self-completes and resumes the job having asked nothing.
 *
 * None of those four are read from the agent's payload AT ALL. They are hard-written by the
 * caller as NULL/NULL/NULL/'{}'. Not validated, not rejected — never sourced. An external system
 * gets to ask questions; it does not get to decide where the answers are written. Treat any future
 * change that starts reading them from the payload as a security regression.
 *
 * The same reasoning covers config.other_key on multi_select: the miniapp writes that key straight
 * into users.bio_data from the client. It is stripped, and an option keyed 'other' (which is what
 * reveals the free-text input the key would receive) is rejected — an agent that wants free text
 * should ask a separate 'text' question, where the answer actually lands in the response record.
 */

// The five values questionnaire_questions.input_type's CHECK constraint allows. The miniapp's
// renderer (pages/main/main.wxml:325-440) has one widget per value and no default branch, so a
// sixth would render as a question with no way to answer it.
const INPUT_TYPES = new Set(['text', 'button_select', 'date_picker', 'slider_group', 'multi_select']);

const MAX_QUESTIONS = 12;
const MAX_PROMPT_LENGTH = 500;
const MAX_OPTIONS = 12;
const MAX_LABEL_LENGTH = 80;
const MAX_SLIDERS = 6;
const MAX_PLACEHOLDER_LENGTH = 80;

const KEY_RE = /^[a-z0-9_]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

// 'other' reveals a free-text input whose value never reaches questionnaire_responses (see the
// header). 'none' is deliberately NOT reserved — handleToggleCondition treats it as mutually
// exclusive, which is genuinely useful and writes nothing.
const RESERVED_OPTION_KEYS = new Set(['other']);

function _violation(code, message, detail) {
    return detail === undefined ? { code, message } : { code, message, detail };
}

/**
 * Question prompts are pushed into the chat as AI bubbles (main.js's _showQuestion) and saved to
 * chat_messages, so they hit exactly the renderer viva_ag.js's _sanitizeSummary already guards.
 * Two display-layer risks, both neutralised rather than rejected — a stray fence is a formatting
 * slip, not a broken contract:
 *
 *   ::: fences  — outputFormat.js display cards; an external system emitting one renders
 *                 arbitrary UI in the user's chat.
 *   [t](href)   — mp-html navigates in-app for scheme-less hrefs, so a link could push the user
 *                 into an arbitrary page of this miniapp. Same rewrite the AG panel's
 *                 _neutralizeLinks applies to report files.
 */
function sanitizeDisplayText(raw) {
    return String(raw == null ? '' : raw)
        .replace(CONTROL_RE, '')
        .replace(/^:::.*$/gm, '')
        .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_m, text, href) => (text ? `${text} (${href})` : href))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function _label(raw) {
    const t = sanitizeDisplayText(raw);
    return t.length > MAX_LABEL_LENGTH ? t.slice(0, MAX_LABEL_LENGTH) : t;
}

function _num(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
}

// ---------------------------------------------------------------------------------------
// Per-input-type config
// ---------------------------------------------------------------------------------------

function _buildOptionConfig(rawConfig, idx, violations) {
    const raw = Array.isArray(rawConfig && rawConfig.options) ? rawConfig.options : null;
    if (!raw || raw.length === 0) {
        violations.push(_violation('missing_options', `Question ${idx + 1}: this input type needs a non-empty config.options array.`));
        return null;
    }
    if (raw.length > MAX_OPTIONS) {
        violations.push(_violation('too_many_options', `Question ${idx + 1}: ${raw.length} options, max ${MAX_OPTIONS}.`));
        return null;
    }
    const options = [];
    const seen = new Set();
    for (let i = 0; i < raw.length; i++) {
        const o = raw[i] || {};
        // The renderer reads `value` for button_select and `key || value` for multi_select, so
        // emit both from one source and the option works under either widget.
        const value = String(o.value != null ? o.value : (o.key != null ? o.key : '')).trim();
        if (!KEY_RE.test(value)) {
            violations.push(_violation('invalid_option_value',
                `Question ${idx + 1} option ${i + 1}: value must match ${KEY_RE} (got ${JSON.stringify(value)}).`));
            continue;
        }
        if (RESERVED_OPTION_KEYS.has(value)) {
            violations.push(_violation('reserved_option_key',
                `Question ${idx + 1} option ${i + 1}: '${value}' is reserved. Ask a separate 'text' question for free-form input.`));
            continue;
        }
        if (seen.has(value)) {
            violations.push(_violation('duplicate_option_value', `Question ${idx + 1}: option value '${value}' appears more than once.`));
            continue;
        }
        seen.add(value);
        const zh = _label(o.label_zh != null ? o.label_zh : o.label_en);
        const en = _label(o.label_en != null ? o.label_en : o.label_zh);
        if (!zh && !en) {
            violations.push(_violation('missing_option_label', `Question ${idx + 1} option ${i + 1}: needs label_zh or label_en.`));
            continue;
        }
        options.push({ key: value, value, label_zh: zh || en, label_en: en || zh });
    }
    if (!options.length) return null;
    // No other_key: see the module header.
    return { options };
}

function _buildSliderConfig(rawConfig, idx, violations) {
    const raw = Array.isArray(rawConfig && rawConfig.sliders) ? rawConfig.sliders : null;
    if (!raw || raw.length === 0) {
        violations.push(_violation('missing_sliders', `Question ${idx + 1}: slider_group needs a non-empty config.sliders array.`));
        return null;
    }
    if (raw.length > MAX_SLIDERS) {
        violations.push(_violation('too_many_sliders', `Question ${idx + 1}: ${raw.length} sliders, max ${MAX_SLIDERS}.`));
        return null;
    }
    const sliders = [];
    const seen = new Set();
    for (let i = 0; i < raw.length; i++) {
        const s = raw[i] || {};
        const key = String(s.key || '').trim();
        if (!KEY_RE.test(key)) {
            violations.push(_violation('invalid_slider_key', `Question ${idx + 1} slider ${i + 1}: key must match ${KEY_RE}.`));
            continue;
        }
        if (seen.has(key)) {
            violations.push(_violation('duplicate_slider_key', `Question ${idx + 1}: slider key '${key}' appears more than once.`));
            continue;
        }
        seen.add(key);
        const min = _num(s.min);
        const max = _num(s.max);
        const step = _num(s.step);
        if (min === null || max === null || min >= max) {
            violations.push(_violation('invalid_slider_range',
                `Question ${idx + 1} slider '${key}': needs numeric min < max.`, { min: s.min, max: s.max }));
            continue;
        }
        if (step === null || step <= 0 || step > (max - min)) {
            violations.push(_violation('invalid_slider_step',
                `Question ${idx + 1} slider '${key}': step must be > 0 and <= (max - min).`, { step: s.step }));
            continue;
        }
        // _showQuestion seeds state from `default` unconditionally, so an absent one would render
        // an empty slider. Midpoint is the neutral choice and is always in range.
        let def = _num(s.default);
        if (def === null || def < min || def > max) def = min + Math.round(((max - min) / 2) / step) * step;
        const zh = _label(s.label_zh != null ? s.label_zh : s.label_en);
        const en = _label(s.label_en != null ? s.label_en : s.label_zh);
        sliders.push({
            key, min, max, step, default: def,
            label_zh: zh || en || key, label_en: en || zh || key,
            unit: _label(s.unit) || '',
        });
    }
    if (!sliders.length) return null;
    return { sliders };
}

function _buildDateConfig(rawConfig, idx, violations) {
    const config = {};
    for (const bound of ['min_date', 'max_date']) {
        const v = rawConfig && rawConfig[bound];
        if (v == null || v === '') continue;
        if (!DATE_RE.test(String(v))) {
            violations.push(_violation('invalid_date_bound', `Question ${idx + 1}: ${bound} must be YYYY-MM-DD (got ${JSON.stringify(v)}).`));
            continue;
        }
        config[bound] = String(v);
    }
    if (config.min_date && config.max_date && config.min_date > config.max_date) {
        violations.push(_violation('invalid_date_bound', `Question ${idx + 1}: min_date is after max_date.`));
        return null;
    }
    return config;
}

function _buildTextConfig(rawConfig) {
    const config = {};
    const zh = sanitizeDisplayText(rawConfig && rawConfig.placeholder_zh).slice(0, MAX_PLACEHOLDER_LENGTH);
    const en = sanitizeDisplayText(rawConfig && rawConfig.placeholder_en).slice(0, MAX_PLACEHOLDER_LENGTH);
    if (zh || en) {
        config.placeholder_zh = zh || en;
        config.placeholder_en = en || zh;
    }
    return config;
}

// ---------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------

/**
 * @param {Array}  rawQuestions  the agent's `questions` array, entirely untrusted
 * @returns {{ok: boolean, questions: Array, violations: Array}}
 *          `questions` is the exact shape createDynamicQuestionnaire() consumes:
 *          { key, input_type, prompt_zh, prompt_en, config }
 */
function validateAgQuestions(rawQuestions) {
    const violations = [];
    const questions = [];

    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        return { ok: false, questions: [], violations: [_violation('no_questions', 'questions must be a non-empty array.')] };
    }
    if (rawQuestions.length > MAX_QUESTIONS) {
        return {
            ok: false, questions: [],
            violations: [_violation('too_many_questions', `${rawQuestions.length} questions, max ${MAX_QUESTIONS}.`)],
        };
    }

    const seenKeys = new Set();
    for (let idx = 0; idx < rawQuestions.length; idx++) {
        const q = rawQuestions[idx] || {};

        const inputType = String(q.input_type || '').trim();
        if (!INPUT_TYPES.has(inputType)) {
            violations.push(_violation('unknown_input_type',
                `Question ${idx + 1}: input_type must be one of ${[...INPUT_TYPES].join(', ')} (got ${JSON.stringify(q.input_type)}).`));
            continue;
        }

        // A key is only ever an internal handle (it becomes obStep and identifies the question in
        // the response row), so generating a missing one is not "repairing a claim" — nothing the
        // user or the agent reads depends on its text.
        let key = String(q.key == null ? '' : q.key).trim().toLowerCase();
        if (!key) key = `q${idx + 1}`;
        if (!KEY_RE.test(key)) {
            violations.push(_violation('invalid_key', `Question ${idx + 1}: key must match ${KEY_RE} (got ${JSON.stringify(q.key)}).`));
            continue;
        }
        if (seenKeys.has(key)) {
            violations.push(_violation('duplicate_key', `Question ${idx + 1}: key '${key}' appears more than once.`));
            continue;
        }

        let promptZh = sanitizeDisplayText(q.prompt_zh);
        let promptEn = sanitizeDisplayText(q.prompt_en);
        if (!promptZh && !promptEn) {
            violations.push(_violation('missing_prompt', `Question ${idx + 1}: needs prompt_zh or prompt_en.`));
            continue;
        }
        // Both columns are NOT NULL and the renderer picks one by the USER's current language,
        // which may differ from the job's — so a one-sided prompt is mirrored rather than left to
        // render as an empty bubble.
        if (!promptZh) promptZh = promptEn;
        if (!promptEn) promptEn = promptZh;
        if (promptZh.length > MAX_PROMPT_LENGTH || promptEn.length > MAX_PROMPT_LENGTH) {
            violations.push(_violation('prompt_too_long',
                `Question ${idx + 1}: prompt exceeds ${MAX_PROMPT_LENGTH} characters.`));
            continue;
        }

        const rawConfig = (q.config && typeof q.config === 'object' && !Array.isArray(q.config)) ? q.config : {};
        let config;
        if (inputType === 'button_select' || inputType === 'multi_select') config = _buildOptionConfig(rawConfig, idx, violations);
        else if (inputType === 'slider_group') config = _buildSliderConfig(rawConfig, idx, violations);
        else if (inputType === 'date_picker') config = _buildDateConfig(rawConfig, idx, violations);
        else config = _buildTextConfig(rawConfig);
        if (config === null) continue;

        seenKeys.add(key);
        questions.push({ key, input_type: inputType, prompt_zh: promptZh, prompt_en: promptEn, config });
    }

    // All-or-nothing: a partially accepted form would ask the user a subset the agent never
    // designed, and it has no way to know which subset it got.
    return { ok: violations.length === 0, questions: violations.length === 0 ? questions : [], violations };
}

module.exports = {
    validateAgQuestions,
    sanitizeDisplayText,
    INPUT_TYPES,
    MAX_QUESTIONS,
    MAX_PROMPT_LENGTH,
    MAX_OPTIONS,
};
