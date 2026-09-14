// The restriction guideline is derived in code, not written by a model: what a class means is
// printed in the report itself (停止摄食1个月 / 2个月 / 3-6个月), so CLASS_WINDOWS is a
// transcription. These tests pin that transcription, and pin the three properties of a derived
// fact that are load-bearing rather than cosmetic — see lib/foodSensitivity.js's comment on the
// facts block.
//
// Pure module, no DB.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
    validateFoodSensitivity, deriveFoodGuideline, resolveGutAxisDotKeys,
    CLASS_WINDOWS, GUT_AXIS_DOT_KEYS,
} = require('../src/functions/worker/lib/foodSensitivity');

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

// Dot names and ingredient names as actually seeded, for the collision test below.
function loadDotStrings() {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'schemas', 'migration_dots_new_lineup.sql'), 'utf8');
    const out = new Set();
    for (const m of sql.matchAll(/name_zh = '([^']+)'/g)) out.add(m[1]);
    for (const m of sql.matchAll(/"name":"([^"]+)"/g)) out.add(m[1]);
    for (const m of sql.matchAll(/ingredients_summary = '([^']+)'/g)) {
        for (const part of m[1].split(',')) {
            for (const half of part.split('/')) {
                const t = half.trim();
                if (t) out.add(t);
            }
        }
    }
    return [...out].filter(s => s.length >= 2);
}

const CATALOG = loadFoodCatalog();

// The exact panel from 胡仿璇's 慢性食物过敏（120项IgG）report: three class-1 dairy proteins,
// everything else class 0.
const REPORT = {
    panel_key: 'igg_120', unit: 'U/mL', sampled_at: '2026-04-15', report_date: '2026-04-23',
    sample_no: '559535391997',
    class_bands: [{ class: 1, low: 50.0, high: 100.0 }],
    items: [
        { food_key: 'casein', value: 52.8, class: 1, confidence: 0.97 },
        { food_key: 'beta_lactoglobulin', value: 51.2, class: 1, confidence: 0.97 },
        { food_key: 'cow_milk', value: 50.9, class: 1, confidence: 0.97 },
        { food_key: 'cherry', value: 44.3, class: 0, confidence: 0.95 },
        { food_key: 'shrimp', value: 35.8, class: 0, confidence: 0.95 },
        { food_key: 'watermelon', below_detection: true, class: 0, confidence: 0.95 },
    ],
};
const derive = (blk) => deriveFoodGuideline(validateFoodSensitivity(blk, CATALOG), CATALOG);

test('the bug-report panel yields exactly three restrictions and three facts', () => {
    const g = derive(REPORT);
    assert.strictEqual(g.restrictions.length, 3);
    assert.strictEqual(g.facts.length, 3);
    assert.deepStrictEqual(g.restrictions.map(r => r.food_key).sort(),
        ['beta_lactoglobulin', 'casein', 'cow_milk']);
});

test('a class-0 food never becomes a restriction', () => {
    const g = derive(REPORT);
    for (const k of ['cherry', 'shrimp', 'watermelon']) {
        assert.ok(!g.restrictions.some(r => r.food_key === k), `${k} became a restriction`);
    }
});

test('117 negatives would not reach the prompt — only positives become facts', () => {
    const items = CATALOG.map((f, i) => ({ food_key: f.food_key, value: 10 + i * 0.1, class: 0, confidence: 0.9 }));
    items[0] = { food_key: CATALOG[0].food_key, value: 52.8, class: 1, confidence: 0.9 };
    const g = derive({ ...REPORT, items });
    assert.strictEqual(g.facts.length, 1);
});

// ── the windows, transcribed from the report's own 过敏食物戒断方案 page ──────────────────────
test('each class carries the window the report prescribes', () => {
    const one = derive({ ...REPORT, items: [{ food_key: 'casein', value: 52.8, class: 1, confidence: 0.9 }] });
    assert.strictEqual(one.restrictions[0].avoid_until, '2026-05-23');
    assert.strictEqual(one.restrictions[0].avoid_months, 1);
    assert.strictEqual(one.restrictions[0].reintroduce_interval_days, 4);

    const two = derive({ ...REPORT, class_bands: [], items: [{ food_key: 'wheat', value: 158, class: 2, confidence: 0.9 }] });
    assert.strictEqual(two.restrictions[0].avoid_until, '2026-06-23');
    assert.strictEqual(two.restrictions[0].reintroduce_interval_days, null,
        'class 2 rechecks the titre before reintroducing — it has no rotation interval');

    const three = derive({ ...REPORT, class_bands: [], items: [{ food_key: 'egg_white', value: 260, class: 3, confidence: 0.9 }] });
    assert.strictEqual(three.restrictions[0].avoid_until, '2026-07-23');
    assert.strictEqual(three.restrictions[0].recheck_max_months, 6,
        'class 3 is stated as a RANGE and must not be collapsed to one number');
});

test('the window is anchored to the report date, so a stale report yields a window already past', () => {
    const g = derive({ ...REPORT, report_date: '2024-01-10', sampled_at: '2024-01-05' });
    assert.strictEqual(g.restrictions[0].avoid_until, '2024-02-10');
    assert.ok(g.restrictions[0].avoid_until < new Date().toISOString().slice(0, 10));
});

test('month arithmetic never rolls past the end of the target month', () => {
    const g = derive({ ...REPORT, report_date: '2026-01-31', class_bands: [],
        items: [{ food_key: 'wheat', value: 158, class: 2, confidence: 0.9 }] });
    assert.strictEqual(g.restrictions[0].avoid_until, '2026-03-31');
    const feb = derive({ ...REPORT, report_date: '2026-01-31',
        items: [{ food_key: 'casein', value: 52.8, class: 1, confidence: 0.9 }] });
    assert.strictEqual(feb.restrictions[0].avoid_until, '2026-02-28');
});

// ── the three load-bearing properties of a derived fact ──────────────────────────────────────
test('a derived fact is a dietary_restriction, never an allergy — IgG is not IgE', () => {
    for (const f of derive(REPORT).facts) {
        assert.strictEqual(f.category, 'dietary_restriction');
    }
});

test('a restriction carries an English name, so an en surface need not print Chinese', () => {
    const r = derive(REPORT).restrictions.find(x => x.food_key === 'cow_milk');
    assert.strictEqual(r.name_en, 'Cow milk');
    assert.strictEqual(r.name_zh, '牛奶');
});

test('a derived fact carries its class as severity and its window as valid_until', () => {
    const f = derive(REPORT).facts.find(x => x.food_key === 'cow_milk');
    assert.strictEqual(f.severity, 1);
    assert.strictEqual(f.valid_until, '2026-05-23');
});

test('a derived fact NEVER contains a dot name or ingredient name', () => {
    // formulationQuality._collides is bidirectional substring containment and allergy_conflict
    // DELETES the dot from both recipes. A verbose fact sentence that happened to contain
    // "槲皮素" or "锌" would silently strip that dot out of the user's formula. Keeping fact_zh
    // canonical is what prevents it; this test is what keeps it canonical.
    const dotStrings = loadDotStrings();
    assert.ok(dotStrings.length > 20, `only parsed ${dotStrings.length} dot strings`);
    const items = CATALOG.map(f => ({ food_key: f.food_key, value: 52.8, class: 1, confidence: 0.9 }));
    for (const f of derive({ ...REPORT, items }).facts) {
        for (const h of dotStrings) {
            assert.ok(!f.fact_zh.includes(h), `fact "${f.fact_zh}" contains dot string "${h}"`);
        }
        assert.ok(f.fact_zh.length <= 12, `fact "${f.fact_zh}" is too long to stay collision-safe`);
    }
});

test('the window, sources and substitutes live on the restriction, not inside fact_zh', () => {
    const g = derive(REPORT);
    const casein = g.restrictions.find(r => r.food_key === 'casein');
    assert.deepStrictEqual(casein.common_sources_zh, ['牛奶', '羊奶', '双皮奶', '奶酪']);
    assert.deepStrictEqual(casein.substitutes_zh, ['豆浆', '鸡蛋', '虾皮']);
    const fact = g.facts.find(f => f.food_key === 'casein');
    assert.strictEqual(fact.fact_zh, '避免酪蛋白');
    assert.ok(!fact.fact_zh.includes('豆浆'));
});

test('a food the lab published no ontology for still derives, with empty arrays', () => {
    const g = derive({ ...REPORT, items: [{ food_key: 'cow_milk', value: 50.9, class: 1, confidence: 0.9 }] });
    assert.deepStrictEqual(g.restrictions[0].common_sources_zh, []);
    assert.deepStrictEqual(g.restrictions[0].substitutes_zh, []);
    assert.strictEqual(g.facts.length, 1, 'a missing ontology must not suppress the restriction');
});

// ── dot promotion ───────────────────────────────────────────────────────────────────────────
test('gut-axis dots resolve against the live formulary and unknown keys are dropped', () => {
    assert.deepStrictEqual(resolveGutAxisDotKeys([{ key_name: 'DOT-N13' }, { key_name: 'DOT-N1' }]), ['DOT-N13']);
    assert.deepStrictEqual(resolveGutAxisDotKeys([]), []);
    assert.deepStrictEqual(resolveGutAxisDotKeys(null), []);
});

test('every promoted dot key exists in the seeded formulary', () => {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'schemas', 'migration_dots_new_lineup.sql'), 'utf8');
    for (const k of GUT_AXIS_DOT_KEYS) {
        assert.ok(sql.includes(`key_name = '${k}'`), `${k} is not in the formulary`);
    }
});

test('an empty or invalid panel derives nothing rather than throwing', () => {
    assert.deepStrictEqual(deriveFoodGuideline(null, CATALOG), { restrictions: [], facts: [] });
    assert.deepStrictEqual(deriveFoodGuideline({ panel: null, items: [] }, CATALOG), { restrictions: [], facts: [] });
    assert.deepStrictEqual(derive({ ...REPORT, items: [] }), { restrictions: [], facts: [] });
});

test('CLASS_WINDOWS has no entry for class 0 — a negative is not a restriction', () => {
    assert.ok(!(0 in CLASS_WINDOWS));
    assert.deepStrictEqual(Object.keys(CLASS_WINDOWS).sort(), ['1', '2', '3']);
});

// ── the collision guard, which is why user_memory_facts.food_key exists ──────────────────────
// lib/formulationQuality.js's _collides is bidirectional substring containment, and
// allergy_conflict is the ONE finding handlers/chat.js acts on: it deletes the dot from both
// recipes. Foods and compounds are different namespaces, and real food names are substrings of
// real ingredient names — 玉米 inside 玉米黄质 (DOT-N8 明眸) is the live example.
//
// The fixture uses ingredients_zh in its STRING shape because that is the shape _ingredientNames
// actually matches on. With the JSONB shape pg returns for the real column it matches nothing at
// all (v.map(String) yields "[object Object]"), so today the prose path only ever compares
// against dot names. That is a pre-existing gap in the allergen check, not something this feature
// introduces — but it means the hazard below goes live the moment anyone fixes it, which is
// exactly why food restrictions are routed around prose rather than tuned into it.
const { checkFormulationQuality } = require('../src/functions/worker/lib/formulationQuality');

const DOTS = [
    { key_name: 'DOT-N8',  name_zh: '明眸',     target_dots_min: 1, target_dots_max: 30,
      ingredients_zh: '[{"mg":24,"name":"叶黄素"},{"mg":6,"name":"玉米黄质"}]' },
    { key_name: 'DOT-N13', name_zh: '肠道焕新', target_dots_min: 1, target_dots_max: 2,
      ingredients_zh: '[{"mg":15,"name":"凝结芽孢杆菌"}]' },
];
const check = (facts) => checkFormulationQuality({
    morningRecipe: { dots: { 'DOT-N8': 20, 'DOT-N13': 2 } }, eveningRecipe: { dots: {} },
    dotsFormulary: DOTS, bioage: null, userFacts: facts,
});
const conflicts = (r) => r.findings.filter(f => f.code === 'allergy_conflict');

test('a chat-stated 玉米 fact still deletes DOT-N8 — the prose path is untouched', () => {
    // Also the non-vacuity guard for the test below: if this ever stops colliding, that one stops
    // proving anything and the fixture needs revisiting.
    const r = check([{ category: 'dietary_restriction', fact_zh: '玉米' }]);
    assert.strictEqual(conflicts(r).length, 1);
    assert.deepStrictEqual(conflicts(r)[0].keys, ['DOT-N8']);
});

test('a corn IgG restriction does NOT delete DOT-N8 明眸, because it carries a food_key', () => {
    const r = check([{ category: 'dietary_restriction', fact_zh: '避免玉米', food_key: 'corn', dot_conflict_keys: [] }]);
    assert.deepStrictEqual(conflicts(r), [], 'a food restriction matched prose and removed a dot');
});

test('a food restriction DOES delete a dot once a human declares the link', () => {
    const r = check([{ category: 'dietary_restriction', fact_zh: '避免玉米', food_key: 'corn', dot_conflict_keys: ['DOT-N8'] }]);
    assert.deepStrictEqual(conflicts(r)[0].keys, ['DOT-N8']);
});

test('the real panel facts disturb neither dot the panel itself promotes', () => {
    const facts = derive(REPORT).facts.map(f => ({ ...f, dot_conflict_keys: [] }));
    assert.deepStrictEqual(conflicts(check(facts)), []);
});
