'use strict';

/**
 * Chronic food-sensitivity (IgG) panels: validate what the external extraction agent read off the
 * page, then derive the restriction guideline deterministically. CLAUDE.md §40.
 *
 * Same two principles as lib/docExtraction.js, for the same reason — extraction AUTO-WRITES:
 *
 *   1. REJECT, NEVER REPAIR. An unreadable value is not coerced, an unknown food is not mapped to
 *      its nearest neighbour, a class that contradicts its own printed band is refused rather than
 *      recomputed. Every refusal is counted and reported.
 *   2. NO DB, NO I/O. `foodCatalogRows` is the food_catalog the caller already fetched, so the
 *      whole rule set — and the guideline derivation — is testable offline, and the same function
 *      backs POST /doc-extract/validate.
 *
 * THE GUIDELINE IS DERIVED HERE, NOT BY A MODEL. What a class means is printed in the report
 * itself (停止摄食1个月 / 2个月 / 3-6个月), so CLASS_WINDOWS below is a transcription, not a
 * judgement. Same division the rest of this codebase draws — "the model ranks, the server
 * partitions" (§28f), "the model picks, the server writes" (§37). An external agent may narrate
 * the panel; it may not decide what the user is told to stop eating.
 */

const { normalizeUnit, toNumber, toIsoDate, trim, reject } = require('./extractionPrimitives');

// Mirrors OBSERVATION_CONFIDENCE_FLOOR in lib/docExtraction.js. A food item is one cell in a
// 120-cell grid, the same kind of read as one number in a lab panel, so it is held to the same
// bar — not to the higher FINDING_CONFIDENCE_FLOOR, which exists for free-text claims about a
// person rather than for a tabulated measurement.
const FOOD_CONFIDENCE_FLOOR = 0.6;

// 120 is the panel this was built for; the cap is headroom for a wider one, and matches
// MAX_OBSERVATIONS so neither half of a submission can be used to blow up the other.
const MAX_FOOD_ITEMS = 200;
const MAX_LABEL_LENGTH = 60;

// Transcribed from the report's own 过敏食物戒断方案 and 饮食调整建议 pages. `months` is how long
// the food is stopped; `reintroduce_interval_days` is the rotation the report prescribes AFTER
// that window, and only class 1 gets one — class 2 and 3 are told to recheck the titre first.
// `recheck_max_months` exists because class 3 is stated as a RANGE (3-6 months) and collapsing it
// to a single number would either understate the advice or overstate the evidence.
//
// Class 0 is absent on purpose: it is not a restriction and must never become one.
const CLASS_WINDOWS = {
    1: { months: 1, reintroduce_interval_days: 4 },
    2: { months: 2 },
    3: { months: 3, recheck_max_months: 6 },
};

// The dots a positive panel promotes. A chronic food-IgG response is a gut-barrier and immune
// story, and these are the only two dots in the formulary that address it:
//   DOT-N13 肠道焕新   Bacillus coagulans / subtilis — the report's own 5R "Reinoculate/Repair"
//   DOT-N14 免疫韧性   Beta-glucan — the immune arm
//
// BE HONEST ABOUT THE REST OF 5R. The report also prescribes digestive enzymes, betaine HCl,
// L-glutamine and essential fatty acids. NONE of the 18 dots contains any of them, and no dot may
// be promoted on a mechanism it does not have (§11's drop-don't-guess, applied to narration).
//
// Whether DOT-N16 (quercetin — real mast-cell stabilisation, but the dot targets Micro-Vascular
// Age) belongs here is a clinical call, not a code one. It is a named constant so it is one edit.
const GUT_AXIS_DOT_KEYS = ['DOT-N13', 'DOT-N14'];

// Calendar-month arithmetic that never rolls into the next month: 2026-01-31 + 1 month is
// 2026-02-28, not 2026-03-03. A restriction window that silently gained three days would put the
// recheck date the user is given out of step with the one stored.
function _addMonths(isoDate, months) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const firstOfTarget = new Date(Date.UTC(y, (m - 1) + months, 1));
    const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), Math.min(d, lastDay)))
        .toISOString().slice(0, 10);
}

// food_key first; a label only resolves through DECLARED vocabulary (name_zh or an explicit
// alias), never fuzzily. The aliases are why this exists at all: the source report prints
// 卵类粘蛋白 in its results table and 卵类黏蛋白 in its own appendix, and 螃蟹 vs 蟹.
function _buildFoodIndex(foodCatalogRows) {
    const byKey = new Map();
    const byLabel = new Map();
    for (const row of foodCatalogRows || []) {
        if (!row || !row.food_key) continue;
        byKey.set(row.food_key, row);
        const labels = [row.name_zh, row.name_en, ...(row.aliases || [])];
        for (const l of labels) {
            const t = String(l == null ? '' : l).trim();
            if (t) byLabel.set(t.toLowerCase(), row);
        }
    }
    return { byKey, byLabel };
}

function _resolveFood(entry, index) {
    if (entry.food_key != null) {
        const hit = index.byKey.get(String(entry.food_key).trim());
        if (hit) return hit;
    }
    const label = trim(entry.label, MAX_LABEL_LENGTH);
    if (label) {
        const hit = index.byLabel.get(label.toLowerCase());
        if (hit) return hit;
    }
    return null;
}

/**
 * @param {object} block  payload.food_sensitivity as the agent submitted it
 * @param {Array}  foodCatalogRows  rows of food_catalog (active only)
 * @returns {null|{panel, items, unmapped, rejected, counts}}
 *          null when no food_sensitivity block was submitted at all — which is the normal case
 *          for every other kind of document and is not an error.
 */
function validateFoodSensitivity(block, foodCatalogRows) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return null;

    const rejected = [];
    const unmapped = [];
    const items = [];

    const panelKey = trim(block.panel_key, 40);
    const unit = trim(block.unit, 20);
    const reportDate = toIsoDate(block.report_date);

    // A panel nobody can date cannot be compared to the next one, and comparison is the entire
    // clinical point of this test. Refuse the panel rather than stamping it with today, which is
    // the exact silent backfill handlePostHealthReport does and docExtraction exists to prevent.
    if (!panelKey || !unit || !reportDate) {
        reject(rejected, 'invalid_food_panel', { panel_key: panelKey, unit, report_date: block.report_date || null },
            !reportDate ? 'report_date is missing or unreadable' : 'panel_key and unit are both required');
        return {
            panel: null, items: [], unmapped: [], rejected,
            counts: { items_accepted: 0, items_submitted: Array.isArray(block.items) ? block.items.length : 0, unmapped: 0, rejected: rejected.length },
        };
    }

    // Only the bands the page actually printed. This report prints 轻度慢性过敏 (50.0-100.0)
    // because the user HAS a class-1 result, and prints no class-2 or class-3 band because they
    // have none. Bands are a cross-check on a class we were given, never a rule for deriving one.
    const bands = new Map();
    for (const b of Array.isArray(block.class_bands) ? block.class_bands : []) {
        if (!b || typeof b !== 'object') continue;
        const cls = Number(b.class);
        if (!Number.isInteger(cls) || cls < 0 || cls > 3) continue;
        const low = b.low == null ? null : toNumber(b.low);
        const high = b.high == null ? null : toNumber(b.high);
        bands.set(cls, { class: cls, low, high });
    }

    const panelUnit = normalizeUnit(unit);
    const index = _buildFoodIndex(foodCatalogRows);
    const submitted = Array.isArray(block.items) ? block.items : [];
    const seen = new Set();

    for (const entry of submitted.slice(0, MAX_FOOD_ITEMS)) {
        if (!entry || typeof entry !== 'object') continue;

        const food = _resolveFood(entry, index);
        if (!food) {
            const label = trim(entry.label, MAX_LABEL_LENGTH) || trim(entry.food_key, MAX_LABEL_LENGTH);
            unmapped.push({ label, value: trim(entry.value, 40), unit: trim(entry.unit, 40) });
            reject(rejected, 'unmapped_food', { label, food_key: trim(entry.food_key, MAX_LABEL_LENGTH) });
            continue;
        }

        // Number(null) is 0 and Number('') is 0, so an absent class would silently become "this
        // food is fine" — inventing the one answer that creates no restriction, from a read that
        // did not happen. Refuse it explicitly before coercing.
        const cls = (entry.class === null || entry.class === undefined || entry.class === '')
            ? NaN : Number(entry.class);
        if (!Number.isInteger(cls) || cls < 0 || cls > 3) {
            reject(rejected, 'invalid_food_class', { food_key: food.food_key, class: entry.class ?? null });
            continue;
        }

        // "<0.1" is left-censored: the lab declined to measure below its detection limit. It must
        // arrive as an explicit flag, never as the string (which toNumber refuses) and never as
        // 0.1 (which would assert a measurement that was not made). 13 of this report's 120
        // values are censored, so this is the common path, not an edge case.
        const belowDetection = entry.below_detection === true;
        const value = belowDetection ? null : toNumber(entry.value);
        if (!belowDetection && value == null) {
            reject(rejected, 'invalid_food_value', { food_key: food.food_key, value: trim(entry.value, 40) },
                'value must be a plain number, or below_detection must be true');
            continue;
        }
        if (value != null && value < 0) {
            reject(rejected, 'invalid_food_value', { food_key: food.food_key, value }, 'negative');
            continue;
        }

        if (entry.unit != null && normalizeUnit(entry.unit) !== panelUnit) {
            reject(rejected, 'food_unit_mismatch', { food_key: food.food_key, unit: trim(entry.unit, 40) },
                `expected ${unit}`);
            continue;
        }

        const band = bands.get(cls);
        if (band && value != null
            && ((band.low != null && value < band.low) || (band.high != null && value > band.high))) {
            reject(rejected, 'class_band_mismatch', { food_key: food.food_key, value, class: cls },
                `class ${cls} band is ${band.low == null ? '-∞' : band.low}–${band.high == null ? '∞' : band.high} ${unit}`);
            continue;
        }

        if (entry.confidence != null) {
            const conf = toNumber(entry.confidence);
            if (conf == null || conf < FOOD_CONFIDENCE_FLOOR) {
                reject(rejected, 'low_confidence', { food_key: food.food_key, confidence: entry.confidence });
                continue;
            }
        }

        if (seen.has(food.food_key)) {
            reject(rejected, 'duplicate_food_item', { food_key: food.food_key });
            continue;
        }
        seen.add(food.food_key);

        // Rebuilt from the catalog row, not echoed from the payload — the same rule
        // docExtraction applies to an accepted observation.
        items.push({
            food_key: food.food_key,
            name_zh: food.name_zh,
            category: food.category,
            value,
            below_detection: belowDetection,
            class: cls,
            // Contract 3 cell reference, passed through raw; lib/docExtraction.js validates it
            // against the structured block (it is the one that has it) and nulls a bad one.
            source: entry.source == null ? null : String(entry.source).slice(0, 40),
        });
    }

    if (submitted.length > MAX_FOOD_ITEMS) {
        reject(rejected, 'too_many_food_items', { submitted: submitted.length }, `cap is ${MAX_FOOD_ITEMS}`);
    }

    return {
        panel: {
            panel_key: panelKey,
            unit,
            sampled_at: toIsoDate(block.sampled_at),
            report_date: reportDate,
            institution: trim(block.institution, 120),
            sample_no: trim(block.sample_no, 60),
            class_bands: [...bands.values()].sort((a, b) => a.class - b.class),
        },
        items,
        unmapped,
        rejected,
        counts: {
            items_accepted: items.length,
            items_submitted: submitted.length,
            unmapped: unmapped.length,
            rejected: rejected.length,
        },
    };
}

/**
 * The restriction guideline, derived deterministically from an accepted panel.
 *
 * @param {{panel, items}} validated  the return of validateFoodSensitivity
 * @param {Array} foodCatalogRows     same rows, for common_sources_zh / substitutes_zh
 * @returns {{restrictions: Array, facts: Array}}
 */
function deriveFoodGuideline(validated, foodCatalogRows) {
    const empty = { restrictions: [], facts: [] };
    if (!validated || !validated.panel || !Array.isArray(validated.items)) return empty;

    const { byKey } = _buildFoodIndex(foodCatalogRows);
    const anchor = validated.panel.report_date;

    const restrictions = validated.items
        .filter(it => it.class >= 1)
        .sort((a, b) => (b.class - a.class) || ((b.value || 0) - (a.value || 0)))
        .map((it) => {
            const win = CLASS_WINDOWS[it.class];
            const row = byKey.get(it.food_key) || {};
            return {
                food_key: it.food_key,
                name_zh: it.name_zh,
                // Carried so an English-language surface does not have to print the Chinese name.
                // May be null: not every food on a panel has an English name worth having.
                name_en: row.name_en || null,
                category: it.category,
                class: it.class,
                value: it.value,
                below_detection: it.below_detection,
                unit: validated.panel.unit,
                avoid_until: _addMonths(anchor, win.months),
                avoid_months: win.months,
                recheck_max_months: win.recheck_max_months || null,
                reintroduce_interval_days: win.reintroduce_interval_days || null,
                common_sources_zh: row.common_sources_zh || [],
                substitutes_zh: row.substitutes_zh || [],
            };
        });

    // ONE SHORT, CANONICAL FACT PER RESTRICTED FOOD, and every part of that is load-bearing:
    //
    //  - category is 'dietary_restriction', NEVER 'allergy'. IgG is not IgE. The report devotes a
    //    page to the distinction and prompts/viva/systemChat.js already teaches it; escalating a
    //    50.9 U/mL class-1 titre to "allergy" is a clinical misstatement.
    //  - fact_zh stays SHORT. getFactMemoryBlock renders facts as a flat, UNCAPPED bullet list
    //    into ~14 prompt templates, and lib/formulationQuality.js's _collides is bidirectional
    //    substring containment — a long sentence swallows any dot ingredient name it happens to
    //    contain and deletes that dot from the user's formula. The window, the recheck date, the
    //    sources and the substitutes live on the restriction above, not in this string.
    //  - only class >= 1. This report has 117 class-0 foods; as facts they would flood every
    //    prompt. They stay queryable through the panel itself.
    const facts = restrictions.map(r => ({
        category: 'dietary_restriction',
        fact_zh: `避免${r.name_zh}`,
        severity: r.class,
        valid_until: r.avoid_until,
        food_key: r.food_key,
    }));

    return { restrictions, facts };
}

// Validated against the live formulary by the caller — a key that resolves to nothing is DROPPED,
// not guessed onto whatever dot now occupies that row (§11).
function resolveGutAxisDotKeys(dotsFormulary) {
    const present = new Set((dotsFormulary || []).map(d => d && d.key_name).filter(Boolean));
    return GUT_AXIS_DOT_KEYS.filter(k => present.has(k));
}

module.exports = {
    validateFoodSensitivity,
    deriveFoodGuideline,
    resolveGutAxisDotKeys,
    CLASS_WINDOWS,
    GUT_AXIS_DOT_KEYS,
    FOOD_CONFIDENCE_FLOOR,
    MAX_FOOD_ITEMS,
};
