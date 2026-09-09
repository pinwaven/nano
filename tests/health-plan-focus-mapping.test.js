// A health-plan focus names dots by key_name, and only ever promotes them.
//
// Two failures this pins, both of which shipped silently once:
//
//  1. recommended_dot_ids held numeric dots.id. migration_dots_new_lineup.sql replaced the
//     formulary and reused the ids, so every seeded list resolved cleanly to a DIFFERENT dot —
//     no error, no filter-out. 焕能减重 recommended macular and skin dots; 深度睡眠 excluded the
//     only sleep dot there is.
//  2. An off-list dot was DEMOTED to 25% of its range — below the 50% it gets with no focus at
//     all — so joining a plan actively suppressed everything the plan did not name.
//
// Source-level assertions for the client halves, because the miniapp has no compile-time
// checking: a raw id renders as plausible-looking text rather than failing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const MIGRATION = read('src', 'schemas', 'migration_health_plan_recommended_dot_keys.sql');
const dotsJs = read('src', 'functions', 'worker', 'handlers', 'dots.js');

// The real formulary, as the current lineup defines it (migration_dots_new_lineup.sql).
const LINEUP = Array.from({ length: 18 }, (_, i) => ({
    id: i + 1,
    key_name: `DOT-N${i + 1}`,
    target_dots_min: 10,
    target_dots_max: 30,
}));

// dots.js is a live handler module; pull the two pure functions out of the source rather than
// requiring it, so the test needs no DB and no env.
function extract(name) {
    const start = dotsJs.indexOf(`function ${name}(`);
    assert.notStrictEqual(start, -1, `${name} is gone from dots.js`);
    let depth = 0, i = dotsJs.indexOf('{', start);
    for (let j = i; j < dotsJs.length; j++) {
        if (dotsJs[j] === '{') depth++;
        else if (dotsJs[j] === '}' && --depth === 0) {
            // eslint-disable-next-line no-new-func
            return new Function(`${dotsJs.slice(start, j + 1)}; return ${name};`)();
        }
    }
    throw new Error(`could not close ${name}`);
}
const _resolveCandidateDotKeys = extract('_resolveCandidateDotKeys');
const _fallbackCountForDot = extract('_fallbackCountForDot');

// ── the mapping itself ────────────────────────────────────────────────────────

const SEEDED = ['weight_loss', 'anti_aging', 'energy_boost', 'sleep_improvement', 'immunity', 'metabolic_health'];

function mappedKeys(planKey) {
    // The UPDATE for one template, matched on its key_name — which is how the migration addresses
    // them, deliberately, since an id is the identity this whole change exists to stop trusting.
    //
    // Split on the statement boundary rather than spanning it with a lazy quantifier: `[\s\S]*?`
    // between the SET and the WHERE happily runs across intervening statements, which silently
    // returned the FIRST template's list for every lookup and made half of these assertions
    // vacuous. Found the first time this suite ran.
    const stmt = MIGRATION.split('UPDATE health_plan_templates')
        .find(chunk => chunk.includes(`WHERE key_name = '${planKey}';`) && chunk.includes('recommended_dot_ids ='));
    assert.ok(stmt, `no mapping UPDATE for ${planKey}`);
    const m = stmt.match(/SET recommended_dot_ids = '(\[[^\]]*\])'::jsonb/);
    assert.ok(m, `${planKey}'s UPDATE has no jsonb array literal`);
    return JSON.parse(m[1]);
}

test('every mapped key names a real dot in the current lineup', () => {
    const known = new Set(LINEUP.map(d => d.key_name));
    for (const plan of SEEDED) {
        const keys = mappedKeys(plan);
        assert.ok(keys.length > 0, `${plan} has an empty focus list`);
        for (const k of keys) {
            assert.ok(known.has(k), `${plan} recommends ${k}, which is not in the formulary`);
        }
    }
});

test('no plan lists DOT-N7', () => {
    // dosing_protocol='pulse'. It is filtered out of _rankDotsBySeverity AND _padCandidatesFor,
    // _planExpansionContext lifts it out of the everyday recipe, and _countDistinctDots does not
    // count it toward a tier — so it is in every plan regardless and listing it can only waste
    // ranking weight on a dot the list cannot influence.
    for (const plan of SEEDED) {
        assert.ok(!mappedKeys(plan).includes('DOT-N7'), `${plan} lists DOT-N7`);
    }
});

test('no plan repeats a dot, and every list stays a signal', () => {
    for (const plan of SEEDED) {
        const keys = mappedKeys(plan);
        assert.strictEqual(new Set(keys).size, keys.length, `${plan} lists a dot twice`);
        // Tiers are 6/8/10 distinct dots per week (§28c). A list longer than that degenerates
        // into "everything on-dimension is promoted" and stops distinguishing anything.
        assert.ok(keys.length <= 6, `${plan} lists ${keys.length} dots — longer than the narrowest tier`);
    }
});

test('the sleep plan recommends the sleep dot', () => {
    // The single most legible symptom of the old mapping: 深度睡眠 had zero defensible entries
    // and omitted DOT-N3 静心夜, which is the only magnesium/ashwagandha/saffron dot in the
    // formulary and the one the plan is nominally about.
    assert.ok(mappedKeys('sleep_improvement').includes('DOT-N3'));
});

test('the migration addresses templates by key_name, never by id', () => {
    assert.ok(!/WHERE id = \d/.test(MIGRATION), 'the migration matches a template by id');
    for (const plan of SEEDED) assert.ok(MIGRATION.includes(`WHERE key_name = '${plan}'`));
});

// ── resolution accepts both stored shapes ─────────────────────────────────────

test('key form and legacy id form resolve to the same set', () => {
    const asKeys = [{ recommended_dot_ids: ['DOT-N3', 'DOT-N13', 'DOT-N5'] }];
    const asIds = [{ recommended_dot_ids: [3, 13, 5] }];
    const a = _resolveCandidateDotKeys(asKeys, LINEUP);
    const b = _resolveCandidateDotKeys(asIds, LINEUP);
    assert.deepStrictEqual([...a].sort(), [...b].sort());
    assert.deepStrictEqual([...a].sort(), ['DOT-N13', 'DOT-N3', 'DOT-N5']);
});

test('a mixed array resolves both halves', () => {
    // Reachable in the wild: the admin panel and the worker deploy separately, so a template can
    // be half-converted between the two.
    const set = _resolveCandidateDotKeys([{ recommended_dot_ids: ['DOT-N3', 11] }], LINEUP);
    assert.deepStrictEqual([...set].sort(), ['DOT-N11', 'DOT-N3']);
});

test('an unknown entry is dropped, never guessed', () => {
    const set = _resolveCandidateDotKeys([{ recommended_dot_ids: ['DOT-N3', 'DOT-N77', 999] }], LINEUP);
    assert.deepStrictEqual([...set], ['DOT-N3']);
});

test('no focus at all still means no narrowing, not an empty set', () => {
    // null is "every dot decided normally by severity". An empty Set would read as
    // "recommend nothing", which is a very different formula.
    assert.strictEqual(_resolveCandidateDotKeys([], LINEUP), null);
    assert.strictEqual(_resolveCandidateDotKeys([{ recommended_dot_ids: [] }], LINEUP), null);
    assert.strictEqual(_resolveCandidateDotKeys([{ recommended_dot_ids: ['DOT-N77'] }], LINEUP), null);
});

// ── the weighting is additive ─────────────────────────────────────────────────

test('an off-list dot is dosed exactly as it would be with no focus at all', () => {
    const dot = { target_dots_min: 37, target_dots_max: 67 };
    assert.strictEqual(_fallbackCountForDot(dot, false), _fallbackCountForDot(dot, undefined),
        'a focus is demoting off-list dots again — it must only ever promote');
    assert.strictEqual(_fallbackCountForDot(dot, false), 52);
});

test('a listed dot is still promoted', () => {
    const dot = { target_dots_min: 37, target_dots_max: 67 };
    assert.strictEqual(_fallbackCountForDot(dot, true), 60);
    assert.ok(_fallbackCountForDot(dot, true) > _fallbackCountForDot(dot, undefined));
});

test('joining a focus can never lower any dot below its no-focus dose', () => {
    // The property that matters, stated over the whole formulary rather than one example.
    for (const dot of [{ target_dots_min: 1, target_dots_max: 2 }, { target_dots_min: 17, target_dots_max: 47 },
                       { target_dots_min: 28, target_dots_max: 87 }, { target_dots_min: 1, target_dots_max: 1 }]) {
        const baseline = _fallbackCountForDot(dot, undefined);
        assert.ok(_fallbackCountForDot(dot, true) >= baseline);
        assert.ok(_fallbackCountForDot(dot, false) >= baseline);
    }
});

// ── one resolver, not three ───────────────────────────────────────────────────

test('both formulation prompts read the resolved key set', () => {
    for (const persona of ['nano', 'viva']) {
        const src = read('src', 'functions', 'worker', 'prompts', persona, 'systemFormulaGenerate.js');
        assert.ok(/Array\.isArray\(recommended_dot_keys\)/.test(src),
            `${persona}/systemFormulaGenerate.js does not consume llmContext.recommended_dot_keys`);
        assert.ok(/recommended_dot_keys,/.test(src),
            `${persona}/systemFormulaGenerate.js does not destructure recommended_dot_keys from ctx`);
    }
});

test('both prompts still resolve a legacy context, and render it identically', () => {
    const dots = [
        { id: 11, key_name: 'DOT-N11', name_zh: '代谢焕新', name: 'Metabolic Renew', sub_age_target: 'Metabolic Age',
          target_dots_min: 17, target_dots_max: 47, timing: 'Morning', timing_flexible: true },
        { id: 15, key_name: 'DOT-N15', name_zh: '抗糖化防护', name: 'Glycation Guard', sub_age_target: 'Metabolic Age',
          target_dots_min: 37, target_dots_max: 67, timing: 'Evening', timing_flexible: true },
    ];
    const base = { user_profile: { language: 'zh' }, biomarkers: {}, bioage: {}, dots,
                   health_twin: null, questionnaire_context: null, current_solar_term: null };
    for (const persona of ['nano', 'viva']) {
        const build = require(path.join(ROOT, 'src/functions/worker/prompts', persona, 'systemFormulaGenerate.js'));
        const legacy = build({ ...base, active_health_plans: [{ recommended_dot_ids: [11, 15] }] });
        const keyed = build({ ...base, active_health_plans: [{ recommended_dot_ids: ['DOT-N11', 'DOT-N15'] }] });
        const prefilled = build({ ...base, active_health_plans: [{ recommended_dot_ids: [11, 15] }],
                                  recommended_dot_keys: ['DOT-N11', 'DOT-N15'] });
        assert.strictEqual(legacy, keyed, `${persona}: the legacy id shape no longer renders`);
        assert.strictEqual(keyed, prefilled, `${persona}: the prefilled key set renders a different prompt`);
        assert.ok(/D-N11/.test(prefilled), `${persona}: the focus section is missing entirely`);
    }
});

// ── no client renders a raw dot id ────────────────────────────────────────────

test('neither plan-detail surface prints an internal dot identifier', () => {
    const wxml = read('src', 'mini', 'nano-miniapp', 'pages', 'main', 'main.wxml');
    const jsx = read('src', 'web', 'user-app', 'src', 'components', 'PlanDetailSheet.jsx');
    assert.ok(!/DOT\{\{item\}\}/.test(wxml), 'main.wxml still renders a raw recommended_dot_ids entry');
    assert.ok(!/DOT\{id\}/.test(jsx), 'PlanDetailSheet.jsx still renders a raw recommended_dot_ids entry');
    assert.ok(/planDetailData\.recommendedDots/.test(wxml), 'main.wxml does not read the resolved list');
    assert.ok(/detail\.recommended_dots/.test(jsx), 'PlanDetailSheet.jsx does not read the resolved list');
});

test('the server resolves the names, and keeps the raw field for the admin panel', () => {
    const src = read('src', 'functions', 'worker', 'handlers', 'health-plans.js');
    assert.ok(/recommended_dots,/.test(src), 'the detail response no longer returns recommended_dots');
    assert.ok(/key_name_zh/.test(src), 'the resolved dots carry no zh display name (§28b convention)');
    assert.ok(/hpt\.recommended_dot_ids/.test(src), 'the raw field was dropped from the detail query');
});

test('a template cannot be saved with a dot that does not exist', () => {
    const src = read('src', 'functions', 'worker', 'handlers', 'health-plans.js');
    assert.ok(/_validateRecommendedDots/.test(src));
    for (const fn of ['handlePostHealthPlanTemplate', 'handlePutHealthPlanTemplate']) {
        const start = src.indexOf(`async function ${fn}(`);
        const body = src.slice(start, src.indexOf('\n}\n', start));
        assert.ok(/_validateRecommendedDots\(recommended_dot_ids\)/.test(body), `${fn} does not validate`);
    }
});

test('the admin panel selects dots by key_name', () => {
    const src = read('src', 'web', 'admin-panel', 'src', 'tabs', 'HealthPlansTab.jsx');
    assert.ok(/toggleDot\(d\.key_name\)/.test(src), 'the admin panel still toggles by dots.id');
    assert.ok(/isDotSelected/.test(src), 'selection state does not handle both stored shapes');
});

test('the remap runs after the seed it converts, on a fresh database', () => {
    // Plain ASCII sort puts this migration BEFORE migration_health_plans.sql ('_' < 's' after the
    // shared "migration_health_plan" prefix), so on an empty DB the conversion would run first,
    // no-op, and the seed would then insert the integer ids this migration removes. The
    // `-- @requires:` declaration is what reorders it, and it is easy to lose in a rename.
    const { parseRequires, orderMigrations } = require(path.join(ROOT, 'scripts', 'migration-order'));
    const dir = path.join(ROOT, 'src', 'schemas');
    const files = fs.readdirSync(dir)
        .filter(f => f.startsWith('migration_') && f.endsWith('.sql'))
        .map(name => ({ name, requires: parseRequires(fs.readFileSync(path.join(dir, name), 'utf8')) }));
    files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const order = orderMigrations(files).map(f => f.name);
    const seed = order.indexOf('migration_health_plans.sql');
    const remap = order.indexOf('migration_health_plan_recommended_dot_keys.sql');
    assert.ok(seed !== -1 && remap !== -1, 'a migration went missing');
    assert.ok(seed < remap, 'the remap is ordered before the seed it converts — the @requires was lost');
});
