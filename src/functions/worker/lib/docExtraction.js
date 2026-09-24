'use strict';

/**
 * Validate a health-document extraction submitted by the external agent (Curia's Viva agent).
 *
 * This module is the only thing standing between an OCR read of a scanned 体检报告 and the user's
 * digital twin. Extraction AUTO-WRITES — there is no confirm-first step — so the guarantees here
 * are what make that safe.
 *
 * Two principles, the same two agFormulation.js keeps:
 *
 *   1. REJECT, NEVER REPAIR. A value in the wrong unit is not converted on a guess, an
 *      out-of-band number is not clamped, an unknown marker is not mapped to its nearest
 *      neighbour. Every refusal is collected with a reason code and reported back, because a
 *      silent drop is precisely what made the pre-existing path unauditable:
 *      handlePostHealthReport skips an unresolvable key_name with no log and no counter, so a
 *      report row and its health_events children can disagree about what the report contained.
 *   2. NO DB, NO I/O. `catalogRows` is the `biomarker_catalog` the caller already fetched, so the
 *      whole rule set is testable offline — and the same function backs POST /doc-extract/validate,
 *      the dry-run endpoint an external implementer iterates against before touching a live job.
 *
 * Six rules apply to every observation, in order. Four of them exist because the path this feeds
 * does NOT check them itself:
 *
 *   - value is finite            → handlePostHealthReport does a bare parseFloat, no NaN check
 *   - unit matches the catalog   → today the model's unit string OVERRIDES the catalog's with no
 *                                  conversion, so a mg/dL number lands in an mmol/L column
 *   - value is physiologically plausible → biomarker_catalog carries ref_low/ref_high and nothing
 *                                  has ever read them
 *   - the date parses            → report_date silently backfills to TODAY when absent, which for
 *                                  a paper report from 2019 is a lie the twin then reads as current
 */

// A marker's own reference range is a CLINICAL band — being outside it is the finding, not an
// error — so these multipliers widen it into an ORDER-OF-MAGNITUDE guard. What this catches is a
// misread decimal point or a column read off the wrong row, not a sick patient.
//
// 100x rather than something tighter because several ref_high values in biomarker_catalog are
// RISK THRESHOLDS, not physiological ceilings: hsCRP's is 1.0 mg/L, and genuine acute
// inflammation reaches two orders of magnitude above that. A tight band would refuse exactly the
// abnormal values that matter most. It still catches what it needs to — LDL's ref_high is 3.4, so
// a misread "4200" is refused at 340.
//
// The residual is real and points the safe way: a genuinely extreme acute-phase value can be
// refused. That surfaces as a counted rejection the user and the agent both see, not as a wrong
// number silently steering the twin — and with auto-write and no confirm step, refusing is the
// direction to err in.
const PLAUSIBLE_LOW_FACTOR = 0.1;
const PLAUSIBLE_HIGH_FACTOR = 100;

// An observation is one number among dozens on a page; a finding is a sentence about the person
// that feeds product-safety filtering (_filterProductsByUserFacts, CLAUDE.md 37) and reaches dot
// formulation. A wrongly recorded penicillin allergy is a sharper failure than a wrong LDL, so
// findings are held to a higher bar.
const OBSERVATION_CONFIDENCE_FLOOR = 0.6;
const FINDING_CONFIDENCE_FLOOR = 0.8;

// Mirrored in handlers/health_documents.js (the PATCH endpoint's own copy) and in
// docs/doc-extract-api.md §7; tests/doc-extraction-contract.test.js holds the three together.
const VALID_DOC_TYPES = new Set([
    'hospital_record', 'lab_report', 'imaging', 'discharge_summary', 'prescription',
    'genetic', 'microbiome', 'functional_test', 'other',
]);

// Mirrors the user_memory_facts category CHECK (migration_user_memory_facts_document_source.sql).
// Validated against this fixed Set and NEVER taken on trust from the payload — the same rule
// remember_fact applies to the LLM's own category field in finalizeChatReply.
const VALID_FINDING_CATEGORIES = new Set([
    'dietary_restriction', 'allergy', 'preference', 'goal', 'condition', 'other',
]);

const MAX_OBSERVATIONS = 200;
const MAX_FINDINGS = 40;
const MAX_UNMAPPED = 200;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_TEXT_LENGTH = 200;
const MAX_INSTITUTION_LENGTH = 120;
const MAX_REF_TEXT_LENGTH = 60;
const MAX_SECTION_LENGTH = 60;

// The `structured` block (CLAUDE.md §39): free-form JSON for content that is neither a numeric
// analyte nor a finding — gene variants, microbiome abundances, HPV subtypes, an immune-age
// verdict. It has no schema by design, so the only defence is a hard ceiling on how much of it
// there can be and a strip of every string. Anything over is refused whole (`invalid_structured`),
// never truncated: a cut-off table is a wrong table.
const MAX_STRUCTURED_BYTES = 64 * 1024;
const MAX_STRUCTURED_DEPTH = 8;   // root=1: v2's root→sections→section→tables→table→rows→row is 7
const MAX_STRUCTURED_ARRAY = 200;
const MAX_STRUCTURED_STRING = 500;
const MAX_STRUCTURED_KEYS = 100;
// `structured.version: 2` (contract 3) keeps tables as tables — columns named, cells verbatim —
// so a reference range, unit and flag survive beside the value and a row can be re-promoted
// when the catalog grows. These bound the v2 shape specifically; the generic caps above still
// apply on top.
const MAX_STRUCTURED_SECTIONS = 50;
const MAX_STRUCTURED_TABLES = 20;     // per section
const MAX_STRUCTURED_ROWS = MAX_STRUCTURED_ARRAY;   // per table

// ── Contract 3: tags ──────────────────────────────────────────────────────────────────────
// A tag is a statement about the person with a KEY (tag_catalog), a tense and an anchor. A
// `fact` resolves in the catalog and is acted on; a `descriptor` does not and never is. The
// catalog is the vocabulary exactly as biomarker_catalog is for observations: an unknown key is
// not an error, it is a demotion to descriptor — stored, displayed, never guessed onto a
// neighbour (CLAUDE.md §11).
const VALID_TAG_KINDS = new Set(['fact', 'descriptor']);
const VALID_TAG_CATEGORIES = new Set([
    'allergy', 'condition', 'medication', 'diet', 'lifestyle', 'result', 'family_history', 'procedure',
]);
const VALID_TAG_STATUSES = new Set(['current', 'past', 'stopped']);
const MAX_TAGS = 60;
const TAG_CONFIDENCE_FLOOR = FINDING_CONFIDENCE_FLOOR;   // a fact is a finding with a key
// A contract-2 finding stored as a descriptor: its category, mapped into the tag vocabulary.
const FINDING_TO_TAG_CATEGORY = {
    allergy: 'allergy', condition: 'condition', dietary_restriction: 'diet',
    preference: 'other', goal: 'other', other: 'other',
};

// A cell reference into `structured`: "s0.t0.r3" (section, table, row) or "s2.p1" (section,
// pair). Malformed → dropped from the item with a `bad_source` warning; the item still lands.
const SOURCE_REF = /^s(\d+)(?:\.t(\d+)\.r(\d+)|\.p(\d+))$/;
const MAX_SOURCE_REF_LENGTH = 40;

// The report's own abnormal marker, however it was printed. Normalised to two values so a
// consumer can colour a row without re-parsing OCR; anything else is "not flagged".
const FLAG_ALIASES = {
    high: ['high', 'h', '↑', '+', '偏高', '高', 'above', 'hi'],
    low: ['low', 'l', '↓', '-', '偏低', '低', 'below', 'lo'],
};

// Hand-authored, and hand-authored on purpose: a generic unit-conversion library would happily
// convert between units that are not actually interchangeable for a given analyte. Each entry is
// a pair someone checked. Anything not listed is a `unit_mismatch` rejection, never a guess.
//
// The catalog is already SI (FPG/LDL/TotalCholesterol/Triglycerides/BUN in mmol/L, Creatinine in
// µmol/L), which matches how Chinese labs report — so this table mostly exists for a US-convention
// report. Same explicit-pairs approach as the lb→kg and mg/dL→mmol/L conversions already in
// handlePostAnalyzeImage.
const UNIT_CONVERSIONS = {
    FPG:              { 'mg/dl': v => v / 18.016 },
    TotalCholesterol: { 'mg/dl': v => v / 38.67 },
    LDL:              { 'mg/dl': v => v / 38.67 },
    HDL:              { 'mg/dl': v => v / 38.67 },
    Triglycerides:    { 'mg/dl': v => v / 88.57 },
    Creatinine:       { 'mg/dl': v => v * 88.4 },
    BUN:              { 'mg/dl': v => v / 2.8 },
    UricAcid:         { 'mg/dl': v => v * 59.48 },
    hsCRP:            { 'mg/dl': v => v * 10 },
    CRP:              { 'mg/dl': v => v * 10 },
    Hemoglobin:       { 'g/dl': v => v * 10 },
    // migration_biomarker_catalog_v2.sql keys. US-convention alternates only; a pair that is not a
    // fixed factor (Lp(a) nmol/L ↔ mg/L depends on isoform size) is deliberately absent.
    TBIL:             { 'mg/dl': v => v * 17.1 },
    DBIL:             { 'mg/dl': v => v * 17.1 },
    IBIL:             { 'mg/dl': v => v * 17.1 },
    ALB:              { 'g/dl': v => v * 10 },
    TP:               { 'g/dl': v => v * 10 },
    GLB:              { 'g/dl': v => v * 10 },
    MCHC:             { 'g/dl': v => v * 10 },
    // 2026-09-22 — what Chinese labs actually print, measured on the two subjects extracted so
    // far: B12 in ng/mL (0.07 on a real page, refused), TSH in µIU/mL (every thyroid panel;
    // numerically identical to mIU/L), FT4 in ng/dL and FT3 in pg/mL (the mass units most
    // Chinese immunoassay reports use). The rest are the same shape for their neighbours.
    // `uiu/ml` is what the normaliser makes of both micro signs.
    VitaminB12:       { 'pg/ml': v => v * 0.738, 'ng/ml': v => v * 738 },
    TSH:              { 'uiu/ml': v => v },
    Insulin:          { 'miu/l': v => v, 'pmol/l': v => v / 6.945 },
    FT4:              { 'ng/dl': v => v * 12.87 },
    FT3:              { 'pg/ml': v => v * 1.536 },
    Ferritin:         { 'ng/ml': v => v },
    Testosterone:     { 'ng/ml': v => v * 3.467, 'ng/dl': v => v * 0.03467 },
    Estradiol:        { 'pg/ml': v => v * 3.671, 'ng/l': v => v * 3.671 },
    Cortisol:         { 'ug/dl': v => v * 27.59, 'ug/l': v => v * 2.759 },
    VitaminD:         { 'ng/ml': v => v * 2.496, 'ug/l': v => v * 2.496 },
    Folate:           { 'ng/ml': v => v * 2.266, 'ug/l': v => v * 2.266 },
    Hcy:              { 'mg/l': v => v * 7.397 },
    // IFCC mmol/mol → NGSP %, the fixed master-equation form (NGSP = 0.09148·IFCC + 2.152).
    HbA1c:            { 'mmol/mol': v => v * 0.09148 + 2.152 },
};

// PROSE GUARD. Two live runs against dev user 55761144's 22 documents (2026-09-15) had the
// external agent's text-layer path submit sentence fragments as data — "同型半胱氨酸的理想水平是小于
// 10 μmol/L" as an Hcy of 10 (the real results were 12.6 and 8.7), "如果被检者年龄小于 40 ng/ml" as
// an analyte, and six `allergy` findings such as "过敏：个别病人" and "食物过敏：免疫" lifted from a
// genomics report's explanatory text, every one at a constant 0.85 confidence so the floor could
// not catch them. An allergy fact filters store recommendations and reaches dot formulation; a
// wrong Hcy sits in the twin panel. Auto-write means nano must refuse these itself.
//
// These are SHAPE checks on the label/text, not on the value — a printed analyte name is a noun
// phrase, never a clause. Anything refused is reported (`implausible_label` /
// `implausible_finding`) so the agent sees exactly what it sent.
// Parentheses are deliberately NOT here: 抗缪勒氏管激素（AMH）, 糖化血红蛋白(HbA1c) are normal labels.
const PROSE_PUNCT = /[。，,；;？?！!：:「」《》]/;
const PROSE_WORDS = /(如果|研究表明|患者|病人|人群|可以|可能|建议|通常|一般|正常范围|理想水平|小于|大于|超过|低于|高于|升高|降低|导致|即使|是否|每天|服用|约\d|大约|占$|为$|有$|的$|是$|即$)/;
const MAX_LABEL_LENGTH = 40;
const FINDING_GENERIC_VALUE = /^(免疫|个别病人|患者|无|有|是|否|未知|暂无|正常|异常)$/;

function _looksLikeProse(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (t.length > MAX_LABEL_LENGTH) return true;
    if (PROSE_PUNCT.test(t)) return true;
    if (PROSE_WORDS.test(t)) return true;
    return false;
}

// A finding is a short statement about the person ("青霉素过敏", "2型糖尿病"). A "label：value"
// split of a section heading ("过敏：免疫"), a population sentence, or a question is not.
function _looksLikeProseFinding(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    if (t.length > MAX_LABEL_LENGTH) return true;
    if (/[。；;？?！!]/.test(t)) return true;
    if (/\d+\s*%/.test(t)) return true;
    if (/(患者|病人|是否|人群|研究|通常|一般|个别|可能|如果|即使|建议)/.test(t)) return true;
    const m = t.match(/^([^：:]{1,20})[：:]\s*(.*)$/);
    if (m) {
        const value = m[2].trim();
        if (!value || value.length <= 1 || FINDING_GENERIC_VALUE.test(value)) return true;
    }
    return false;
}

function _normalizeFlag(raw) {
    if (raw == null) return null;
    const t = String(raw).trim().toLowerCase();
    if (!t) return null;
    if (FLAG_ALIASES.high.includes(t)) return 'high';
    if (FLAG_ALIASES.low.includes(t)) return 'low';
    return null;
}

// The printed-row fields an item carries beyond identity and value. Shared by the mapped and
// unmapped branches so health_report_items gets the same columns either way.
function _rowExtras(entry, trimFn) {
    return {
        ref_text: trimFn(entry.ref_text, MAX_REF_TEXT_LENGTH),
        flag: _normalizeFlag(entry.flag),
        section: trimFn(entry.section, MAX_SECTION_LENGTH),
    };
}

// Walks the `structured` block once: enforces the caps, strips ':::' from every string, and
// returns a fresh object (never the payload's own). A violation anywhere refuses the whole
// block — see MAX_STRUCTURED_* for why it is refused rather than trimmed.
function _sanitizeStructured(raw, sanitizeFn) {
    if (raw == null) return { value: null };
    if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not an object' };
    let bytes = 0;
    try { bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8'); } catch (e) { return { error: 'not serialisable' }; }
    if (bytes > MAX_STRUCTURED_BYTES) return { error: `${bytes} bytes exceeds ${MAX_STRUCTURED_BYTES}` };

    let error = null;
    const walk = (node, depth) => {
        if (error) return null;
        if (depth > MAX_STRUCTURED_DEPTH) { error = `nesting deeper than ${MAX_STRUCTURED_DEPTH}`; return null; }
        if (node == null) return null;
        if (typeof node === 'string') {
            return node.length > MAX_STRUCTURED_STRING
                ? (error = `string longer than ${MAX_STRUCTURED_STRING}`, null)
                : (sanitizeFn(node, MAX_STRUCTURED_STRING) ?? '');
        }
        if (typeof node === 'number') return Number.isFinite(node) ? node : null;
        if (typeof node === 'boolean') return node;
        if (Array.isArray(node)) {
            if (node.length > MAX_STRUCTURED_ARRAY) { error = `array longer than ${MAX_STRUCTURED_ARRAY}`; return null; }
            return node.map(n => walk(n, depth + 1));
        }
        if (typeof node === 'object') {
            const keys = Object.keys(node);
            if (keys.length > MAX_STRUCTURED_KEYS) { error = `object with more than ${MAX_STRUCTURED_KEYS} keys`; return null; }
            const out = {};
            for (const k of keys) {
                const key = String(k).slice(0, 80);
                if (!key || key === '__proto__') continue;
                out[key] = walk(node[k], depth + 1);
            }
            return out;
        }
        return null;
    };
    const value = walk(raw, 1);
    if (error) return { error };
    // Contract 2's shape (`version` absent or 1) is whatever the agent sent, already capped
    // above. Contract 3's `version: 2` is a table model and has to actually be one.
    if (value.version != null && value.version !== 1) {
        if (value.version !== 2) return { error: `unknown structured.version ${JSON.stringify(value.version)}` };
        const v2 = _checkStructuredV2(value);
        if (v2) return { error: v2 };
    }
    return { value };
}

// `structured.version: 2`: sections → tables (named columns, rows of equal length) + pairs.
// Every check here is a REFUSAL of the whole block: a table whose rows do not line up with its
// header is not a table with a gap, it is a table nano cannot read back.
function _checkStructuredV2(s) {
    if (!Array.isArray(s.sections)) return 'version 2 requires sections[]';
    if (s.sections.length > MAX_STRUCTURED_SECTIONS) return `more than ${MAX_STRUCTURED_SECTIONS} sections`;
    if (s.unanchored != null && !(Number.isInteger(s.unanchored) && s.unanchored >= 0)) return 'unanchored must be a non-negative integer';
    for (let si = 0; si < s.sections.length; si++) {
        const sec = s.sections[si];
        if (!sec || typeof sec !== 'object' || Array.isArray(sec)) return `sections[${si}] is not an object`;
        if (sec.title != null && typeof sec.title !== 'string') return `sections[${si}].title is not a string`;
        const tables = sec.tables == null ? [] : sec.tables;
        if (!Array.isArray(tables)) return `sections[${si}].tables is not an array`;
        if (tables.length > MAX_STRUCTURED_TABLES) return `sections[${si}] has more than ${MAX_STRUCTURED_TABLES} tables`;
        for (let ti = 0; ti < tables.length; ti++) {
            const t = tables[ti];
            const at = `sections[${si}].tables[${ti}]`;
            if (!t || typeof t !== 'object' || Array.isArray(t)) return `${at} is not an object`;
            if (!Array.isArray(t.columns) || t.columns.length === 0) return `${at}.columns is empty`;
            if (!t.columns.every(c => typeof c === 'string' && c.trim())) return `${at}.columns must be non-empty strings`;
            if (new Set(t.columns.map(c => c.trim())).size !== t.columns.length) return `${at}.columns are not unique`;
            const rows = t.rows == null ? [] : t.rows;
            if (!Array.isArray(rows)) return `${at}.rows is not an array`;
            if (rows.length > MAX_STRUCTURED_ROWS) return `${at} has more than ${MAX_STRUCTURED_ROWS} rows`;
            for (let ri = 0; ri < rows.length; ri++) {
                const r = rows[ri];
                if (!Array.isArray(r)) return `${at}.rows[${ri}] is not an array`;
                if (r.length !== t.columns.length) return `${at}.rows[${ri}] has ${r.length} cells for ${t.columns.length} columns`;
                if (!r.every(c => c == null || typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean')) return `${at}.rows[${ri}] has a non-scalar cell`;
            }
        }
        const pairs = sec.pairs == null ? [] : sec.pairs;
        if (!Array.isArray(pairs)) return `sections[${si}].pairs is not an array`;
        for (let pi = 0; pi < pairs.length; pi++) {
            const p = pairs[pi];
            if (!p || typeof p !== 'object' || Array.isArray(p)) return `sections[${si}].pairs[${pi}] is not an object`;
            if (typeof p.label !== 'string' || !p.label.trim()) return `sections[${si}].pairs[${pi}].label is empty`;
        }
    }
    return null;
}

// Validates an item's `source` against the (already sanitised) structured block. Returns the
// reference to store, or null — with a `bad_source` warning when one was sent and is malformed
// or points outside the block. A warning, not a rejection: the item lands either way.
function _sourceRef(raw, structured, warnings, entry) {
    if (raw == null || raw === '') return null;
    const ref = String(raw).trim().slice(0, MAX_SOURCE_REF_LENGTH);
    const m = ref.match(SOURCE_REF);
    let ok = !!m;
    if (ok && structured && structured.version === 2 && Array.isArray(structured.sections)) {
        const sec = structured.sections[Number(m[1])];
        if (!sec) ok = false;
        else if (m[2] != null) {
            const t = (sec.tables || [])[Number(m[2])];
            ok = !!t && Number(m[3]) < (t.rows || []).length;
        } else {
            ok = Number(m[4]) < (sec.pairs || []).length;
        }
    }
    if (!ok) { warnings.push({ reason: 'bad_source', entry: { ...entry, source: ref } }); return null; }
    return ref;
}

// The primitive coercions live in lib/extractionPrimitives.js so lib/foodSensitivity.js — which
// validates a food panel arriving in this same submission — applies byte-identical date and
// number rules. Aliased to the original underscore names to keep every call site below unchanged.
const {
    normalizeUnit: _normalizeUnit,
    toNumber: _toNumber,
    toIsoDate: _toIsoDate,
    trim: _trim,
    sanitizeText: _sanitizeText,
    reject: _reject,
} = require('./extractionPrimitives');

const { validateFoodSensitivity } = require('./foodSensitivity');

// Contract 3 `tags`. Each entry is admitted as a fact, demoted to a descriptor, or refused —
// and the three outcomes are deliberately different in what they cost the agent:
//   refused  — a malformed entry (unknown kind/category/status, empty text, bad value, low
//              confidence). Reported in `rejected`, lands nowhere.
//   demoted  — a fact whose key is not in tag_catalog (`unknown_tag`) or whose category
//              disagrees with the catalog's (`tag_category_mismatch`). Lands as a descriptor
//              with the reason on the row: the same honesty `unmapped` gives markers.
//   admitted — rebuilt from the catalog row, never echoed: category, and the value only from
//              the admitted list.
function _validateTags(raw, tagCatalogRows, { docDate, structured, rejected, warnings }) {
    const byKey = new Map();
    for (const row of tagCatalogRows || []) {
        if (row && row.tag_key) byKey.set(row.tag_key, row);
    }
    const submitted = Array.isArray(raw) ? raw : [];
    const tags = [];
    const seen = new Set();
    for (const t of submitted.slice(0, MAX_TAGS)) {
        const entry = t && typeof t === 'object' ? t : {};
        const kindRaw = String(entry.kind || '').trim();
        if (!VALID_TAG_KINDS.has(kindRaw)) {
            _reject(rejected, 'invalid_tag', { kind: kindRaw || null, tag_key: entry.tag_key ?? null }, 'kind must be fact or descriptor');
            continue;
        }
        const category = String(entry.category || '').trim();
        if (!VALID_TAG_CATEGORIES.has(category)) {
            _reject(rejected, 'unknown_tag_category', { category: category || null, tag_key: entry.tag_key ?? null });
            continue;
        }
        const text = _trim(entry.text, MAX_TEXT_LENGTH);
        if (!text) {
            _reject(rejected, 'empty_tag', { category, tag_key: entry.tag_key ?? null });
            continue;
        }
        const statusRaw = entry.status == null || entry.status === '' ? 'current' : String(entry.status).trim();
        if (!VALID_TAG_STATUSES.has(statusRaw)) {
            _reject(rejected, 'bad_tag_status', { category, text, status: String(entry.status).slice(0, 40) });
            continue;
        }
        let since = docDate;
        if (entry.since != null && entry.since !== '') {
            since = _toIsoDate(entry.since);
            if (!since) {
                _reject(rejected, 'unparseable_date', { category, text, since: String(entry.since).slice(0, 40) });
                continue;
            }
        }
        const confidence = _toNumber(entry.confidence);

        let kind = kindRaw;
        let tagKey = null;
        let reason = null;
        let value = null;
        let catalogCategory = category;
        if (kind === 'fact') {
            // A fact needs the bar a finding had — a stated confidence, and a high one.
            if (confidence === null || confidence < TAG_CONFIDENCE_FLOOR) {
                _reject(rejected, 'low_confidence', { category, text, tag_key: entry.tag_key ?? null, confidence });
                continue;
            }
            const keyRaw = String(entry.tag_key || '').trim();
            const cat = byKey.get(keyRaw);
            if (!cat) {
                kind = 'descriptor'; reason = 'unknown_tag';
            } else if (cat.category !== category) {
                kind = 'descriptor'; reason = 'tag_category_mismatch';
            } else {
                tagKey = cat.tag_key;
                catalogCategory = cat.category;
                const admitted = Array.isArray(cat.values) && cat.values.length > 0 ? cat.values : null;
                if (admitted) {
                    const v = entry.value == null ? '' : String(entry.value).trim().toLowerCase();
                    const hit = admitted.find(a => String(a).toLowerCase() === v);
                    if (!hit) {
                        _reject(rejected, 'bad_tag_value', { tag_key: tagKey, value: entry.value ?? null }, `admitted: ${admitted.join(' | ')}`);
                        continue;
                    }
                    value = hit;
                }
            }
        }
        const dedupeKey = tagKey ? `${tagKey}::${statusRaw}::${value || ''}` : `d::${category}::${text}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        tags.push({
            kind,
            tag_key: tagKey,
            category: catalogCategory,
            text,
            value,
            status: statusRaw,
            since,
            source: _sourceRef(entry.source, structured, warnings, { tag_key: tagKey || entry.tag_key || null, text }),
            confidence,
            reason,
        });
    }
    if (submitted.length > MAX_TAGS) {
        _reject(rejected, 'too_many_tags', { submitted: submitted.length }, `cap is ${MAX_TAGS}`);
    }
    return { tags, submitted: submitted.length };
}

/**
 * @param {object} payload  the agent's submission
 * @param {Array}  catalogRows  rows of biomarker_catalog (active only), as the handler fetched them
 * @param {Array}  foodCatalogRows  rows of food_catalog (active only). Required only when the
 *                 payload carries a food_sensitivity block; passing nothing when it does is
 *                 reported as food_catalog_unavailable rather than silently dropping the panel.
 * @param {object} [opts]
 * @param {string|null} [opts.fallbackDocDate]  the document ROW's doc_date — set by the user, or
 *                 by an earlier run. Used only when the payload names no date at all. Never
 *                 today: the caller's rule for "no readable date" stays "write no report".
 * @param {Array}  [opts.tagCatalogRows]  rows of tag_catalog (active only). Without it every
 *                 tag is a descriptor — a fact cannot be admitted against a vocabulary that was
 *                 not supplied.
 * @returns {{document, summary, observations, findings, tags, food_sensitivity, unmapped, structured, rejected, warnings, counts}}
 *          `rejected` is what did not land; `warnings` is a field dropped from an item that did
 *          (`bad_source`, `unknown_suggested_key`).
 */
function validateExtraction(payload, catalogRows, foodCatalogRows = null, opts = {}) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const rejected = [];
    const warnings = [];

    const byKey = new Map();
    for (const row of catalogRows || []) {
        if (row && row.key_name) byKey.set(row.key_name, row);
    }

    // ── Document metadata ────────────────────────────────────────────────────────────────
    const rawDoc = p.document && typeof p.document === 'object' ? p.document : {};
    const docTypeRaw = String(rawDoc.doc_type || '').trim();
    // An unrecognised doc_type falls back to 'other' rather than failing the submission: the
    // observations are the valuable part and a badge is not worth losing them over. It is still
    // reported, so a systematically wrong vocabulary is visible rather than absorbed.
    let docType = 'other';
    if (docTypeRaw && VALID_DOC_TYPES.has(docTypeRaw)) docType = docTypeRaw;
    else if (docTypeRaw) _reject(rejected, 'unknown_doc_type', { doc_type: docTypeRaw });

    const fallbackDocDate = _toIsoDate(opts && opts.fallbackDocDate);
    const payloadDocDate = _toIsoDate(rawDoc.doc_date);
    if (rawDoc.doc_date != null && !payloadDocDate) {
        _reject(rejected, 'unparseable_date', { doc_date: rawDoc.doc_date });
    }
    // The printed date wins; the row's date (user-set, or an earlier reading) fills a blank.
    const docDate = payloadDocDate || fallbackDocDate;

    const document = {
        doc_type: docType,
        doc_date: docDate,
        institution: _trim(rawDoc.institution, MAX_INSTITUTION_LENGTH),
        note: _trim(rawDoc.note, MAX_TEXT_LENGTH),
    };

    const summary = _sanitizeText(p.summary, MAX_SUMMARY_LENGTH);

    // ── Structured content ───────────────────────────────────────────────────────────────
    // Validated FIRST: every item below may carry a `source` cell reference into it.
    let structured = null;
    if (p.structured != null) {
        const r = _sanitizeStructured(p.structured, _sanitizeText);
        if (r.error) _reject(rejected, 'invalid_structured', null, r.error);
        else structured = r.value;
    }

    // ── Observations ─────────────────────────────────────────────────────────────────────
    const rawObs = Array.isArray(p.observations) ? p.observations.slice(0, MAX_OBSERVATIONS) : [];
    const observations = [];
    const unmapped = [];
    const seen = new Set();

    for (const o of rawObs) {
        const entry = o && typeof o === 'object' ? o : {};
        const keyName = String(entry.key_name || '').trim();

        // 1. The catalog is the vocabulary. An unknown marker is not an error — a real report
        //    carries far more analytes than the 25 nano models — so it moves to `unmapped`, where
        //    it stays visible and countable and can inform extending the catalog later.
        const catalog = byKey.get(keyName);
        if (!catalog) {
            unmapped.push({
                label: _trim(entry.label || entry.key_name || entry.source_text, MAX_TEXT_LENGTH),
                value: entry.value == null ? null : String(entry.value).slice(0, 40),
                unit: _trim(entry.unit, 40),
                ..._rowExtras(entry, _trim),
                source: _sourceRef(entry.source, structured, warnings, { key_name: keyName || null }),
                suggested_key: null, suggested_confidence: null,
            });
            _reject(rejected, 'unknown_marker', { key_name: keyName || null });
            continue;
        }

        // 1b. The printed label, when given, must be an analyte name, not a clause. A mapped key
        //     with a prose label means the number was lifted from a sentence about the marker
        //     ("理想水平是小于 10"), not from its result row.
        if (entry.label != null && _looksLikeProse(entry.label)) {
            _reject(rejected, 'implausible_label', { key_name: keyName, label: _trim(entry.label, MAX_TEXT_LENGTH), value: entry.value ?? null });
            continue;
        }

        // 2. Finite number.
        let value = _toNumber(entry.value);
        if (value === null) {
            _reject(rejected, 'invalid_value', { key_name: keyName, value: entry.value ?? null });
            continue;
        }

        // 3. Unit matches the catalog, or has a hand-authored conversion. Never stored under a
        //    unit it was not measured in.
        const catalogUnit = _normalizeUnit(catalog.unit);
        const givenUnit = _normalizeUnit(entry.unit);
        let converted = false;
        if (givenUnit && givenUnit !== catalogUnit) {
            const convert = (UNIT_CONVERSIONS[keyName] || {})[givenUnit];
            if (!convert) {
                _reject(rejected, 'unit_mismatch', { key_name: keyName, value, unit: entry.unit },
                    `expected ${catalog.unit}`);
                continue;
            }
            value = Math.round(convert(value) * 1000) / 1000;
            converted = true;
        }

        // 4. Physiologically plausible. A marker with no reference range in the catalog is only
        //    checked for non-negativity — inventing a band would be the guess this file exists to
        //    avoid.
        const low = catalog.ref_low == null ? null : Number(catalog.ref_low);
        const high = catalog.ref_high == null ? null : Number(catalog.ref_high);
        const floor = low != null ? low * PLAUSIBLE_LOW_FACTOR : 0;
        const ceiling = high != null ? high * PLAUSIBLE_HIGH_FACTOR : null;
        if (value < 0 || value < floor || (ceiling != null && value > ceiling)) {
            _reject(rejected, 'implausible_value', { key_name: keyName, value, unit: catalog.unit },
                `outside ${floor}–${ceiling == null ? '∞' : ceiling} ${catalog.unit}`);
            continue;
        }

        // 5. Confidence floor.
        const confidence = _toNumber(entry.confidence);
        if (confidence !== null && confidence < OBSERVATION_CONFIDENCE_FLOOR) {
            _reject(rejected, 'low_confidence', { key_name: keyName, confidence });
            continue;
        }

        // 6. A date that parses. Falls back to the document's own date; with neither, the caller
        //    writes no report rather than stamping it today.
        const dataDate = _toIsoDate(entry.data_date) || docDate;
        if (!dataDate) {
            _reject(rejected, 'missing_date', { key_name: keyName });
            continue;
        }

        // One value per marker per day. A duplicate is the same page read twice, and keeping the
        // first matches what health_events' ON CONFLICT DO NOTHING would do anyway.
        const dedupeKey = `${catalog.key_name}::${dataDate}`;
        if (seen.has(dedupeKey)) {
            _reject(rejected, 'duplicate_observation', { key_name: keyName, data_date: dataDate });
            continue;
        }
        seen.add(dedupeKey);

        // Rebuilt from the catalog row, not echoed from the payload — the agent supplies an
        // identifier and a number, and the server owns everything else. Same doctrine as
        // _validateProductRecommendations.
        observations.push({
            key_name: catalog.key_name,
            loinc_code: catalog.loinc_code || null,
            value,
            unit: catalog.unit,
            data_date: dataDate,
            ...(converted ? { converted_from: _trim(entry.unit, 40) } : {}),
            source_text: _trim(entry.source_text, MAX_TEXT_LENGTH),
            // The printed row, for health_report_items. `label` is what the report called it —
            // the catalog's display name is nano's, and the record should read like the page.
            label: _trim(entry.label, MAX_TEXT_LENGTH) || catalog.display_name_zh || catalog.display_name || catalog.key_name,
            ..._rowExtras(entry, _trim),
            source: _sourceRef(entry.source, structured, warnings, { key_name: keyName }),
        });
    }

    for (const u of (Array.isArray(p.unmapped) ? p.unmapped.slice(0, MAX_UNMAPPED) : [])) {
        const entry = u && typeof u === 'object' ? u : {};
        const label = _trim(entry.label, MAX_TEXT_LENGTH);
        if (!label) continue;
        if (_looksLikeProse(label)) {
            _reject(rejected, 'implausible_label', { label, value: entry.value ?? null });
            continue;
        }
        // The agent's guess at a key. Kept beside the row for review and re-promotion, NEVER
        // promoted here: a wrong key is a plausible number in the wrong marker of the twin. It
        // must at least name a real key, or the guess is dropped (the row still lands).
        let suggestedKey = null;
        let suggestedConfidence = null;
        if (entry.suggested_key != null && entry.suggested_key !== '') {
            const sk = String(entry.suggested_key).trim();
            if (byKey.has(sk)) {
                suggestedKey = sk;
                const sc = _toNumber(entry.suggested_confidence);
                suggestedConfidence = sc == null ? null : Math.min(1, Math.max(0, sc));
            } else {
                warnings.push({ reason: 'unknown_suggested_key', entry: { label, suggested_key: sk.slice(0, 60) } });
            }
        }
        unmapped.push({
            label,
            value: entry.value == null ? null : String(entry.value).slice(0, 40),
            unit: _trim(entry.unit, 40),
            ..._rowExtras(entry, _trim),
            source: _sourceRef(entry.source, structured, warnings, { label }),
            suggested_key: suggestedKey,
            suggested_confidence: suggestedConfidence,
        });
    }

    // ── Findings ─────────────────────────────────────────────────────────────────────────
    const rawFindings = Array.isArray(p.findings) ? p.findings.slice(0, MAX_FINDINGS) : [];
    const findings = [];
    const seenFacts = new Set();

    for (const f of rawFindings) {
        const entry = f && typeof f === 'object' ? f : {};
        const category = String(entry.category || '').trim();
        if (!VALID_FINDING_CATEGORIES.has(category)) {
            _reject(rejected, 'unknown_finding_category', { category: category || null });
            continue;
        }
        const text = _trim(entry.text, MAX_TEXT_LENGTH);
        if (!text) {
            _reject(rejected, 'empty_finding', { category });
            continue;
        }
        if (_looksLikeProseFinding(text)) {
            _reject(rejected, 'implausible_finding', { category, text });
            continue;
        }
        const confidence = _toNumber(entry.confidence);
        // Unlike an observation, a finding with NO stated confidence is refused rather than
        // accepted. It writes a durable claim about the person into product-safety filtering, so
        // the agent has to commit to how sure it is.
        if (confidence === null || confidence < FINDING_CONFIDENCE_FLOOR) {
            _reject(rejected, 'low_confidence', { category, text, confidence });
            continue;
        }
        const dedupeKey = `${category}::${text}`;
        if (seenFacts.has(dedupeKey)) continue;
        seenFacts.add(dedupeKey);
        findings.push({ category, text, confidence });
    }

    // ── Tags (contract 3) ────────────────────────────────────────────────────────────────
    const tagCatalogRows = Array.isArray(opts && opts.tagCatalogRows) ? opts.tagCatalogRows : [];
    const tagsOut = _validateTags(p.tags, tagCatalogRows, { docDate, structured, rejected, warnings });
    const tags = tagsOut.tags;
    // A contract-2 `finding` is stored as a descriptor: it has no key, so nothing may act on it.
    // (Under contract 2 it went to user_memory_facts; two live runs showed why that is not safe.)
    for (const f of findings) {
        tags.push({
            kind: 'descriptor', tag_key: null,
            category: FINDING_TO_TAG_CATEGORY[f.category] || 'other',
            text: f.text, value: null, status: 'current', since: docDate,
            source: null, confidence: f.confidence, reason: 'from_finding',
        });
    }

    // A chronic food-sensitivity (IgG) panel, when the document is one (CLAUDE.md §40). Kept as
    // its own section rather than folded into `observations`: a food is not a biomarker_catalog
    // marker, and routing 120 food titres through health_events(lab_result) would replace the
    // user's clinical panel in health_twin.latest_lab_data — see migration_food_catalog.sql.
    //
    // Its rejections and unmapped entries join the shared lists, so the agent and the user both
    // see one accounting of everything this submission got wrong.
    let foodSensitivity = null;
    if (payload && payload.food_sensitivity != null) {
        if (!Array.isArray(foodCatalogRows)) {
            _reject(rejected, 'food_catalog_unavailable', null,
                'the caller did not supply food_catalog, so the panel was not validated');
        } else {
            foodSensitivity = validateFoodSensitivity(payload.food_sensitivity, foodCatalogRows);
            if (foodSensitivity) {
                rejected.push(...foodSensitivity.rejected);
                unmapped.push(...foodSensitivity.unmapped);
                for (const it of foodSensitivity.items) {
                    it.source = _sourceRef(it.source, structured, warnings, { food_key: it.food_key });
                }
            }
        }
    }

    return {
        document,
        summary,
        observations,
        findings,
        food_sensitivity: foodSensitivity ? { panel: foodSensitivity.panel, items: foodSensitivity.items } : null,
        tags,
        unmapped,
        structured,
        rejected,
        warnings,
        counts: {
            observations_accepted: observations.length,
            observations_submitted: rawObs.length,
            findings_accepted: findings.length,
            findings_submitted: rawFindings.length,
            tags_submitted: tagsOut.submitted,
            facts_accepted: tags.filter(t => t.kind === 'fact').length,
            descriptors_accepted: tags.filter(t => t.kind === 'descriptor').length,
            food_items_accepted: foodSensitivity ? foodSensitivity.counts.items_accepted : 0,
            food_items_submitted: foodSensitivity ? foodSensitivity.counts.items_submitted : 0,
            unmapped: unmapped.length,
            structured: structured ? 1 : 0,
            rejected: rejected.length,
            warnings: warnings.length,
        },
    };
}

module.exports = {
    validateExtraction,
    VALID_DOC_TYPES,
    VALID_FINDING_CATEGORIES,
    VALID_TAG_CATEGORIES,
    VALID_TAG_STATUSES,
    MAX_TAGS,
    TAG_CONFIDENCE_FLOOR,
    MAX_STRUCTURED_SECTIONS,
    MAX_STRUCTURED_TABLES,
    MAX_STRUCTURED_ROWS,
    SOURCE_REF,
    UNIT_CONVERSIONS,
    OBSERVATION_CONFIDENCE_FLOOR,
    FINDING_CONFIDENCE_FLOOR,
    PLAUSIBLE_LOW_FACTOR,
    PLAUSIBLE_HIGH_FACTOR,
    MAX_OBSERVATIONS,
    MAX_FINDINGS,
    MAX_SUMMARY_LENGTH,
    MAX_UNMAPPED,
    MAX_STRUCTURED_BYTES,
    MAX_STRUCTURED_DEPTH,
    MAX_STRUCTURED_ARRAY,
    MAX_STRUCTURED_STRING,
    MAX_STRUCTURED_KEYS,
};
