// A 120-item food IgG panel auto-writes into the twin exactly as a lab panel does, so this
// validator is the only thing between an OCR read of a printed grid and a restriction the user is
// told to follow. Every rule here exists because the thing it guards has a concrete failure:
//
//   - "<0.1" is left-censored (13 of the source report's 120 values). Coerced to 0.1 it asserts a
//     measurement the lab declined to make; left as a string it is not a number.
//   - the class is PRINTED on the page, and only bands that have results are printed at all, so a
//     class can never be re-derived from thresholds we invented.
//   - a food that resolves to nothing must be counted, not mapped onto its nearest neighbour.
//
// Pure module, no DB.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
    validateFoodSensitivity, deriveFoodGuideline, resolveGutAxisDotKeys,
    CLASS_WINDOWS, GUT_AXIS_DOT_KEYS, FOOD_CONFIDENCE_FLOOR, MAX_FOOD_ITEMS,
} = require('../src/functions/worker/lib/foodSensitivity');

// Built from the real migration, so a catalog change that breaks an assumption here fails a test
// rather than surprising production. Same idiom as doc-extraction-validation.test.js.
function loadFoodCatalog() {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'schemas', 'migration_food_catalog.sql'), 'utf8');
    const arr = (s) => s === "'{}'" ? [] : [...s.matchAll(/'([^']*)'/g)].map(m => m[1]);
    const rows = [];
    const re = /^\s{4}\('([^']+)', '([^']+)', '([^']*)', '([^']+)', ('\{\}'|ARRAY\[[^\]]*\]::TEXT\[\]), ('\{\}'|ARRAY\[[^\]]*\]::TEXT\[\]), ('\{\}'|ARRAY\[[^\]]*\]::TEXT\[\])\)/gm;
    for (const m of sql.matchAll(re)) {
        rows.push({
            food_key: m[1], name_zh: m[2], name_en: m[3], category: m[4],
            aliases: arr(m[5]), common_sources_zh: arr(m[6]), substitutes_zh: arr(m[7]),
        });
    }
    return rows;
}

const CATALOG = loadFoodCatalog();
const item = (o) => ({ food_key: 'apple', value: 13.0, class: 0, confidence: 0.9, ...o });
const block = (o) => ({
    panel_key: 'igg_120', unit: 'U/mL', sampled_at: '2026-04-15', report_date: '2026-04-23',
    class_bands: [{ class: 1, low: 50.0, high: 100.0 }], items: [], ...o,
});
const run = (o) => validateFoodSensitivity(block(o), CATALOG);
const reasons = (r) => r.rejected.map(x => x.reason);

test('the catalog fixture actually parsed all 120 foods', () => {
    assert.strictEqual(CATALOG.length, 120, `parsed ${CATALOG.length} rows`);
    assert.ok(CATALOG.some(f => f.food_key === 'cow_milk' && f.name_zh === '牛奶'));
    assert.ok(CATALOG.some(f => f.food_key === 'casein' && f.category === 'dairy_egg'));
    assert.strictEqual(new Set(CATALOG.map(f => f.food_key)).size, 120, 'duplicate food_key');
});

test('every catalog row has a category the schema documents', () => {
    const VALID = new Set(['dairy_egg', 'fruit', 'vegetable', 'meat', 'seafood', 'grain_nut', 'other']);
    for (const f of CATALOG) assert.ok(VALID.has(f.category), `${f.food_key} has category ${f.category}`);
});

test('no food_catalog row ships a dot_conflict_key — an empty list is the safe default', () => {
    // A populated one would let a food restriction delete a dot from a real formula. Adding the
    // first entry is a deliberate clinical act; it must never arrive as a seeding accident.
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'schemas', 'migration_food_catalog.sql'), 'utf8');
    assert.ok(!/dot_conflict_keys[^;]*ARRAY\[/.test(sql.split('INSERT INTO')[1] || ''),
        'the seed populates dot_conflict_keys');
});

test('no block at all is not an error — most documents are not food panels', () => {
    assert.strictEqual(validateFoodSensitivity(undefined, CATALOG), null);
    assert.strictEqual(validateFoodSensitivity(null, CATALOG), null);
    assert.strictEqual(validateFoodSensitivity([], CATALOG), null);
});

// ── the censored value, which is the common path and not an edge case ────────────────────────
test('below_detection is carried as a flag with a null value, never as 0.1', () => {
    const r = run({ items: [item({ food_key: 'watermelon', value: undefined, below_detection: true })] });
    assert.strictEqual(r.counts.items_accepted, 1);
    assert.strictEqual(r.items[0].value, null);
    assert.strictEqual(r.items[0].below_detection, true);
});

test('the literal string "<0.1" is refused rather than parsed', () => {
    const r = run({ items: [item({ food_key: 'watermelon', value: '<0.1' })] });
    assert.deepStrictEqual(reasons(r), ['invalid_food_value']);
    assert.strictEqual(r.counts.items_accepted, 0);
});

test('a numeric string is accepted — the grid is OCR, not JSON', () => {
    const r = run({ items: [item({ food_key: 'casein', value: '52.8', class: 1 })] });
    assert.strictEqual(r.items[0].value, 52.8);
});

// ── the class is read, never derived ────────────────────────────────────────────────────────
test('a class contradicting its own printed band is refused, not recomputed', () => {
    const r = run({ items: [item({ food_key: 'cow_milk', value: 12.0, class: 1 })] });
    assert.deepStrictEqual(reasons(r), ['class_band_mismatch']);
});

test('a class whose band the page never printed is accepted exactly as read', () => {
    // The source report prints no class-2 or class-3 band, because that user has neither. A
    // panel from someone who does must still ingest.
    const r = run({ items: [item({ food_key: 'wheat', value: 158.0, class: 2 })] });
    assert.strictEqual(r.counts.items_accepted, 1);
    assert.strictEqual(r.items[0].class, 2);
});

test('a class outside 0-3 is refused', () => {
    for (const bad of [4, -1, 1.5, 'one', null]) {
        assert.deepStrictEqual(reasons(run({ items: [item({ class: bad })] })), ['invalid_food_class'], String(bad));
    }
});

// ── vocabulary ──────────────────────────────────────────────────────────────────────────────
test('an unknown food is counted in BOTH unmapped and rejected, never mapped onto a neighbour', () => {
    const r = run({ items: [item({ food_key: 'dragonfruit', label: '火龙果', value: 8 })] });
    assert.deepStrictEqual(reasons(r), ['unmapped_food']);
    assert.strictEqual(r.unmapped.length, 1);
    assert.strictEqual(r.unmapped[0].label, '火龙果');
    assert.strictEqual(r.counts.items_accepted, 0);
});

test('a label resolves through declared aliases — the same lab spells one food two ways', () => {
    // This report prints 卵类粘蛋白 in its results grid and 卵类黏蛋白 in its own appendix.
    const r = run({ items: [item({ food_key: undefined, label: '卵类黏蛋白', value: 3, class: 0 })] });
    assert.strictEqual(r.counts.items_accepted, 1);
    assert.strictEqual(r.items[0].food_key, 'ovomucoid');
});

test('an accepted item is rebuilt from the catalog, not echoed from the payload', () => {
    const r = run({ items: [item({ food_key: 'casein', name_zh: '毒药', category: 'other', value: 52.8, class: 1 })] });
    assert.strictEqual(r.items[0].name_zh, '酪蛋白');
    assert.strictEqual(r.items[0].category, 'dairy_egg');
});

// ── panel-level refusals ────────────────────────────────────────────────────────────────────
test('a panel with no readable report_date is refused whole — comparison is the point of the test', () => {
    const r = validateFoodSensitivity(block({ report_date: 'April 2026', items: [item({})] }), CATALOG);
    assert.deepStrictEqual(reasons(r), ['invalid_food_panel']);
    assert.strictEqual(r.panel, null);
    assert.strictEqual(r.counts.items_submitted, 1, 'the submitted count still reports what was sent');
});

test('a future report_date is refused — a misread year, not a prophecy', () => {
    const r = validateFoodSensitivity(block({ report_date: '2099-01-01' }), CATALOG);
    assert.deepStrictEqual(reasons(r), ['invalid_food_panel']);
});

test('a unit that disagrees with the panel is refused, never converted on a guess', () => {
    const r = run({ items: [item({ unit: 'IU/mL' })] });
    assert.deepStrictEqual(reasons(r), ['food_unit_mismatch']);
});

test('unit normalisation still tolerates OCR casing and spacing', () => {
    const r = run({ items: [item({ unit: ' u/ML ' })] });
    assert.strictEqual(r.counts.items_accepted, 1);
});

test('a repeated food is rejected once, first read wins', () => {
    const r = run({ items: [item({ food_key: 'casein', value: 52.8, class: 1 }), item({ food_key: 'casein', value: 9.9, class: 0 })] });
    assert.deepStrictEqual(reasons(r), ['duplicate_food_item']);
    assert.strictEqual(r.items[0].value, 52.8);
});

test('a low-confidence read is refused; an absent confidence is not', () => {
    assert.deepStrictEqual(reasons(run({ items: [item({ confidence: FOOD_CONFIDENCE_FLOOR - 0.01 })] })), ['low_confidence']);
    assert.strictEqual(run({ items: [item({ confidence: undefined })] }).counts.items_accepted, 1);
});

test('more items than the cap are truncated and the overflow is reported', () => {
    const many = Array.from({ length: MAX_FOOD_ITEMS + 5 }, () => item({ food_key: 'apple' }));
    const r = run({ items: many });
    assert.ok(reasons(r).includes('too_many_food_items'));
});

test('a garbage payload yields empty results rather than throwing', () => {
    assert.doesNotThrow(() => validateFoodSensitivity({ items: [null, 7, 'x'] }, CATALOG));
    assert.doesNotThrow(() => validateFoodSensitivity(block({ items: [null, 7, 'x'] }), CATALOG));
    assert.doesNotThrow(() => validateFoodSensitivity(block({ items: [item({})] }), []));
});
