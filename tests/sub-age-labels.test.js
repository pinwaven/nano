// A user never sees an internal sub-age key (lib/subAgeLabels.js).
//
// Prod 2026-09-14: a Formulate-Dots reply read 「生理年龄整体年轻（BioAge 39.2岁）…但MetabolicAge
// （41.5岁）…」. The model had learned the tokens from `get_biomarkers` handing back the raw
// `bioage_profile` object and from the formulation prompt's own `BioAge = X` line. Same remedy as
// lib/dotNames.js: stop showing the model the keys, and rewrite any that slip through, once, on the
// assembled string, outside `:::` fences.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');

const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};
stub('lib/db.js', { pool: { query: async () => ({ rows: [] }), connect: async () => { throw new Error('no tx'); } } });
stub('lib/gcnClient.js', {
    fetchFormulationOrders: async () => [], fetchFormulationCodes: async () => [], fetchFormulationTiers: async () => [],
    fetchAiCatalog: async () => [], fetchFormulationOrderStatus: async () => ({}),
    submitFastTrackFormulation: async () => ({}), redeemFormulationCode: async () => ({}), gcnFetch: async () => ({}),
});

const { describeBioAge, humanizeSubAgeKeys, subAgeLabel, SUB_AGE_KEYS } = require(path.join(WORKER, 'lib', 'subAgeLabels.js'));
const { createAgenticToolHandlers } = require(path.join(WORKER, 'lib', 'agenticTools.js'));

const PROFILE = {
    BioAge: 39.2, ChronoAge: 41,
    SubAges: { CellularAge: 36.5, MetabolicAge: 41.5, MicroVascularAge: 38, ResilienceAge: 41 },
    Scores: { CellularAge: 8.1 }, Details: { hsCRP: 'ok' }, mFI: 0.12,
};

// ── describeBioAge ────────────────────────────────────────────────────────────────────────────

test('describeBioAge projects a labelled, language-specific view and drops the internals', () => {
    const zh = describeBioAge(PROFILE, 'zh');
    assert.strictEqual(zh.biological_age, 39.2);
    assert.strictEqual(zh.chronological_age, 41);
    assert.strictEqual(zh.difference_years, -1.8);
    assert.deepStrictEqual(zh.sub_ages.map(s => s.dimension), ['抗压年龄', '细胞年龄', '代谢年龄', '微血管年龄']);
    const metabolic = zh.sub_ages.find(s => s.dimension === '代谢年龄');
    assert.strictEqual(metabolic.vs_chronological_years, 0.5);
    assert.strictEqual(metabolic.status, '老于实际年龄');
    assert.strictEqual(zh.sub_ages.find(s => s.dimension === '抗压年龄').status, '与实际年龄相同');
    assert.strictEqual(zh.sub_ages.find(s => s.dimension === '细胞年龄').status, '年轻于实际年龄');

    const en = describeBioAge(PROFILE, 'en');
    assert.deepStrictEqual(en.sub_ages.map(s => s.dimension), ['Resilience Age', 'Cellular Age', 'Metabolic Age', 'Micro-Vascular Age']);
    assert.strictEqual(en.sub_ages.find(s => s.dimension === 'Metabolic Age').status, 'older than chronological age');

    const text = JSON.stringify(zh) + JSON.stringify(en);
    for (const key of [...SUB_AGE_KEYS, 'BioAge', 'ChronoAge', 'Scores', 'Details', 'mFI']) {
        assert.ok(!text.includes(`"${key}"`), `${key} leaked into the projection`);
    }
});

test('describeBioAge tolerates a partial or missing profile', () => {
    assert.strictEqual(describeBioAge(null, 'zh'), null);
    assert.strictEqual(describeBioAge('x', 'zh'), null);
    const partial = describeBioAge({ BioAge: 40, SubAges: { CellularAge: 38 } }, 'zh');
    assert.strictEqual(partial.chronological_age, null);
    assert.strictEqual(partial.difference_years, null);
    assert.deepStrictEqual(partial.sub_ages, [{ dimension: '细胞年龄', age: 38, vs_chronological_years: null, status: null }]);
});

test('channel display-name overrides win, per language, and fall back per key', () => {
    const overrides = { MetabolicAge: { zh: '能量年龄', en: 'Energy Age' }, CellularAge: { zh: '  ' } };
    assert.strictEqual(subAgeLabel('MetabolicAge', 'zh', overrides), '能量年龄');
    assert.strictEqual(subAgeLabel('MetabolicAge', 'en', overrides), 'Energy Age');
    assert.strictEqual(subAgeLabel('CellularAge', 'zh', overrides), '细胞年龄', 'a blank override must not erase the label');
    assert.strictEqual(subAgeLabel('ResilienceAge', 'zh', overrides), '抗压年龄');
    const d = describeBioAge(PROFILE, 'zh', overrides);
    assert.ok(d.sub_ages.some(s => s.dimension === '能量年龄'));
});

// ── humanizeSubAgeKeys ────────────────────────────────────────────────────────────────────────

test('the prod reply is rewritten to display names in both languages', () => {
    const zh = '生理年龄整体年轻（BioAge 39.2岁），但MetabolicAge（41.5岁）是四个中相对最高的，高于ChronoAge。';
    assert.strictEqual(humanizeSubAgeKeys(zh, 'zh'),
        '生理年龄整体年轻（生理年龄 39.2岁），但代谢年龄（41.5岁）是四个中相对最高的，高于实际年龄。');
    const en = 'Your BioAge is 39.2; CellularAge and MicroVascularAge are younger, ResilienceAge equals ChronoAge.';
    assert.strictEqual(humanizeSubAgeKeys(en, 'en'),
        'Your biological age is 39.2; Cellular Age and Micro-Vascular Age are younger, Resilience Age equals chronological age.');
});

test('a key inside a longer identifier is left alone', () => {
    for (const s of ['BioAgeCalculator', 'bioage_profile', 'SubAges.MetabolicAge', 'getBioAge()', 'CellularAgeScore']) {
        // Only the exact word-bounded token is a key; `SubAges.MetabolicAge` has a boundary at the
        // dot, so it IS rewritten — that is prose that named a key, which is the whole point.
        const out = humanizeSubAgeKeys(s, 'zh');
        if (s === 'SubAges.MetabolicAge') assert.strictEqual(out, 'SubAges.代谢年龄');
        else assert.strictEqual(out, s, `${s} must not be rewritten`);
    }
});

test('nothing between ::: fences is touched, and the fence itself is left intact', () => {
    const text = [
        '你的 MetabolicAge 偏高。',
        ':::metric',
        'MetabolicAge | 41.5 | 岁 | 偏高',
        'BioAge | 39.2 | 岁 | 良好',
        ':::',
        '所以 BioAge 整体不错。',
        ':::formula',
        '#tier|轻享套装|6|1',
        'DOT-N5|线粒体|#abc|2|1',
        ':::',
    ].join('\n');
    const out = humanizeSubAgeKeys(text, 'zh');
    const lines = out.split('\n');
    assert.strictEqual(lines[0], '你的 代谢年龄 偏高。');
    assert.strictEqual(lines[2], 'MetabolicAge | 41.5 | 岁 | 偏高');
    assert.strictEqual(lines[3], 'BioAge | 39.2 | 岁 | 良好');
    assert.strictEqual(lines[5], '所以 生理年龄 整体不错。');
    assert.strictEqual(lines.slice(6).join('\n'), text.split('\n').slice(6).join('\n'));
});

test('a label the model glossed with its own key does not become a doubled label', () => {
    // The model writes the label AND the key as a parenthetical gloss; rewriting the key in place
    // would produce 「细胞年龄（细胞年龄）」. Live on dev before the collapse, 4× in one reply.
    assert.strictEqual(humanizeSubAgeKeys('细胞年龄（CellularAge）：50.9岁', 'zh'), '细胞年龄：50.9岁');
    assert.strictEqual(humanizeSubAgeKeys('实际年龄（ChronoAge）为49岁', 'zh'), '实际年龄为49岁');
    assert.strictEqual(humanizeSubAgeKeys('代谢年龄 (MetabolicAge) 最低', 'zh'), '代谢年龄 最低');
    // A genuine parenthetical that is NOT a self-gloss must survive.
    assert.strictEqual(humanizeSubAgeKeys('代谢年龄（最低）', 'zh'), '代谢年龄（最低）');
    // A key inside a parenthetical that also carries a value is a label(value), not a gloss.
    assert.strictEqual(humanizeSubAgeKeys('整体年轻（BioAge 39.2岁）', 'zh'), '整体年轻（生理年龄 39.2岁）');
});

test('overrides apply to the rewrite, non-strings and key-free text pass through unchanged', () => {
    assert.strictEqual(humanizeSubAgeKeys('MetabolicAge 偏高', 'zh', { MetabolicAge: { zh: '能量年龄' } }), '能量年龄 偏高');
    assert.strictEqual(humanizeSubAgeKeys(null, 'zh'), null);
    assert.strictEqual(humanizeSubAgeKeys(42, 'zh'), 42);
    const plain = '你的代谢年龄偏高，建议关注。';
    assert.strictEqual(humanizeSubAgeKeys(plain, 'zh'), plain);
    // The global regex must not carry lastIndex state between calls.
    assert.strictEqual(humanizeSubAgeKeys('BioAge', 'en'), 'biological age');
    assert.strictEqual(humanizeSubAgeKeys('BioAge', 'en'), 'biological age');
});

// ── get_biomarkers hands the model the projection, never the raw profile ─────────────────────

test('get_biomarkers returns bio_age (labelled) and no bioage_profile', async () => {
    const pool = {
        query: async () => ({ rows: [{ data: { validated: { hsCRP: 1.2 }, bioage_profile: PROFILE }, tested_at: new Date('2026-09-01T02:00:00Z') }] }),
    };
    const h = createAgenticToolHandlers({ pool, user_id: 'u1', language: 'zh', sub_age_display_names: { CellularAge: { zh: '细胞活力' } } });
    const res = await h.get_biomarkers();
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.data.validated, { hsCRP: 1.2 });
    assert.ok(!('bioage_profile' in res.data), 'raw profile must not reach the model');
    assert.strictEqual(res.data.bio_age.biological_age, 39.2);
    assert.ok(res.data.bio_age.sub_ages.some(s => s.dimension === '细胞活力'), 'channel override not honoured');
    const text = JSON.stringify(res.data);
    for (const key of [...SUB_AGE_KEYS, 'BioAge', 'ChronoAge', 'Scores', 'mFI']) {
        assert.ok(!text.includes(`"${key}"`), `${key} leaked into the tool result`);
    }
});

test('get_biomarkers with no scan returns data:null, not a fabricated profile', async () => {
    const h = createAgenticToolHandlers({ pool: { query: async () => ({ rows: [] }) }, user_id: 'u1', language: 'zh' });
    assert.deepStrictEqual(await h.get_biomarkers(), { ok: true, data: null });
});
