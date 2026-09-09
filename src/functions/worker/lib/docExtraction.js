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

const VALID_DOC_TYPES = new Set([
    'hospital_record', 'lab_report', 'imaging', 'discharge_summary', 'prescription', 'other',
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
    VitaminD:         { 'ng/ml': v => v * 2.496 },
    hsCRP:            { 'mg/dl': v => v * 10 },
    CRP:              { 'mg/dl': v => v * 10 },
    Hemoglobin:       { 'g/dl': v => v * 10 },
};

// Unit strings arrive from OCR, so they carry whatever casing, spacing and Unicode the report
// used. µ vs u and L vs l are the two that actually show up.
function _normalizeUnit(raw) {
    return String(raw == null ? '' : raw)
        .trim().toLowerCase()
        .replace(/µ/g, 'u')      // MICRO SIGN
        .replace(/μ/g, 'u')      // GREEK SMALL LETTER MU
        .replace(/\s+/g, '');
}

function _toNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
}

// Accepts only a plain calendar date. A timestamp is truncated to its date part; anything else is
// refused rather than coerced, because the caller's fallback for "no readable date" is to write no
// report at all, and a wrong date is worse than no report.
function _toIsoDate(v) {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
    if (typeof v !== 'string') return null;
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
    if (!m) return null;
    const [, y, mo, d] = m;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1
        || dt.getUTCDate() !== Number(d)) return null;                 // 2026-02-31 and friends
    // A lab result dated in the future is a misread year, not a prophecy. One day of slack covers
    // a report issued across a timezone boundary.
    if (dt.getTime() > Date.now() + 24 * 3600 * 1000) return null;
    return dt.toISOString().slice(0, 10);
}

function _trim(v, max) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max).trim() : s;
}

// The ':::' display-card fences are interpreted by the miniapp chat renderer, so an external
// system emitting them could render arbitrary UI in the user's chat. Same strip
// handlers/viva_ag.js applies to an AG summary on ingest, for the same reason.
function _sanitizeText(raw, max) {
    let text = String(raw == null ? '' : raw).replace(/^:::.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return null;
    return text.length > max ? text.slice(0, max).trim() : text;
}

function _reject(list, code, entry, detail) {
    list.push({ reason: code, entry, ...(detail ? { detail } : {}) });
}

/**
 * @param {object} payload  the agent's submission
 * @param {Array}  catalogRows  rows of biomarker_catalog (active only), as the handler fetched them
 * @returns {{document, summary, observations, findings, unmapped, rejected, counts}}
 */
function validateExtraction(payload, catalogRows) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const rejected = [];

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

    const docDate = _toIsoDate(rawDoc.doc_date);
    if (rawDoc.doc_date != null && !docDate) {
        _reject(rejected, 'unparseable_date', { doc_date: rawDoc.doc_date });
    }

    const document = {
        doc_type: docType,
        doc_date: docDate,
        institution: _trim(rawDoc.institution, MAX_INSTITUTION_LENGTH),
        note: _trim(rawDoc.note, MAX_TEXT_LENGTH),
    };

    const summary = _sanitizeText(p.summary, MAX_SUMMARY_LENGTH);

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
            });
            _reject(rejected, 'unknown_marker', { key_name: keyName || null });
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
        });
    }

    for (const u of (Array.isArray(p.unmapped) ? p.unmapped.slice(0, MAX_UNMAPPED) : [])) {
        const entry = u && typeof u === 'object' ? u : {};
        const label = _trim(entry.label, MAX_TEXT_LENGTH);
        if (!label) continue;
        unmapped.push({
            label,
            value: entry.value == null ? null : String(entry.value).slice(0, 40),
            unit: _trim(entry.unit, 40),
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

    return {
        document,
        summary,
        observations,
        findings,
        unmapped,
        rejected,
        counts: {
            observations_accepted: observations.length,
            observations_submitted: rawObs.length,
            findings_accepted: findings.length,
            findings_submitted: rawFindings.length,
            unmapped: unmapped.length,
            rejected: rejected.length,
        },
    };
}

module.exports = {
    validateExtraction,
    VALID_DOC_TYPES,
    VALID_FINDING_CATEGORIES,
    UNIT_CONVERSIONS,
    OBSERVATION_CONFIDENCE_FLOOR,
    FINDING_CONFIDENCE_FLOOR,
    PLAUSIBLE_LOW_FACTOR,
    PLAUSIBLE_HIGH_FACTOR,
    MAX_OBSERVATIONS,
    MAX_FINDINGS,
    MAX_SUMMARY_LENGTH,
};
