// The document-extraction API is meant to be implemented by an external team from
// GET /doc-extract/docs and /openapi.json ALONE, with no access to this repo. That only holds if
// the two documents stay true to the code, so this file checks the three ways they can drift:
// a path the spec describes that the token cannot reach, a live path the spec omits, and a worked
// example that documents a payload nano would actually reject.
//
// The CHANGELOG claims an equivalent check exists for the Viva AG spec. It does not — nothing
// under tests/ references VIVA_AG_ALLOWED_PATHS. This is that check, written rather than assumed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKER = path.join(ROOT, 'src', 'functions', 'worker');
const DOCS = path.join(WORKER, 'docs');

const indexJs = fs.readFileSync(path.join(WORKER, 'index.js'), 'utf8');
const md = fs.readFileSync(path.join(DOCS, 'doc-extract-api.md'), 'utf8');
// Prose is hard-wrapped, so a phrase check has to run against whitespace-normalised text or it
// fails on where the line happened to break.
const mdFlat = md.replace(/\s+/g, ' ');
const spec = JSON.parse(fs.readFileSync(path.join(DOCS, 'doc-extract-openapi.json'), 'utf8'));
const { validateExtraction } = require(path.join(WORKER, 'lib', 'docExtraction.js'));

// The allowlist as index.js actually declares it.
function allowedPaths() {
    const block = indexJs.slice(indexJs.indexOf('const DOC_EXTRACT_ALLOWED_PATHS'));
    const set = block.slice(0, block.indexOf(']'));
    return [...set.matchAll(/'(\/doc-extract\/[^']+)'/g)].map(m => m[1]).sort();
}

// Every migration that seeds catalog rows. A key that lives only in a later file would otherwise
// come back undefined here and fail the conversions test with an unhelpful message — which is
// exactly what happened when v2 landed.
const CATALOG_MIGRATIONS = ['migration_biomarker_catalog.sql', 'migration_biomarker_catalog_v2.sql'];
const CATALOG_ROW = /^\s{4}\('([^']+)',\s*(NULL|'[^']*'),\s*'[^']*',\s*'([^']*)',\s*'([^']*)',\s*'[^']*',\s*(NULL|'[^']*'),\s*(TRUE|FALSE),\s*(NULL|[\d.]+),\s*(NULL|[\d.]+)\)/gm;

function loadCatalog() {
    const rows = [];
    for (const file of CATALOG_MIGRATIONS) {
        const sql = fs.readFileSync(path.join(ROOT, 'src', 'schemas', file), 'utf8');
        const found = [...sql.matchAll(CATALOG_ROW)];
        assert.ok(found.length > 0, `${file} yields no catalog rows — the row format the test parses has drifted`);
        for (const m of found) {
            rows.push({
                key_name: m[1], loinc_code: m[2] === 'NULL' ? null : m[2].slice(1, -1),
                display_name_zh: m[3], unit: m[4],
                ref_low: m[7] === 'NULL' ? null : Number(m[7]), ref_high: m[8] === 'NULL' ? null : Number(m[8]),
            });
        }
    }
    return rows;
}

test('the v2 catalog rows are well-formed for both the validator and the extraction agent', () => {
    const rows = loadCatalog();
    const keys = rows.map(r => r.key_name);
    assert.equal(new Set(keys).size, keys.length, 'a key_name is seeded twice');
    const loincs = rows.map(r => r.loinc_code).filter(Boolean);
    assert.equal(new Set(loincs).size, loincs.length, 'a loinc_code is seeded twice — the UNIQUE constraint would abort the migration');
    for (const r of rows) {
        // The agent ignores names under 2 characters (its matcher's rule), so a 1-char Chinese
        // name — 锌, 硒 — would never resolve. Every row must carry a matchable name.
        assert.ok(r.display_name_zh.length >= 2, `${r.key_name}'s display_name_zh "${r.display_name_zh}" is too short for the agent to match`);
        if (r.ref_low != null && r.ref_high != null) assert.ok(r.ref_low < r.ref_high, `${r.key_name} has ref_low >= ref_high`);
    }
    assert.ok(rows.length >= 70, `expected the widened catalog, got ${rows.length} rows`);
});

test('the three doc_type vocabularies agree', () => {
    const { VALID_DOC_TYPES: fromValidator } = require(path.join(WORKER, 'lib', 'docExtraction.js'));
    const { VALID_DOC_TYPES: fromDocuments } = require(path.join(WORKER, 'handlers', 'health_documents.js'));
    assert.deepEqual([...fromValidator].sort(), [...fromDocuments].sort(),
        'lib/docExtraction.js and handlers/health_documents.js disagree on VALID_DOC_TYPES');
    assert.deepEqual([...spec.components.schemas.DocType.enum].sort(), [...fromValidator].sort(),
        'the OpenAPI DocType enum differs from the code');
    const table = md.slice(md.indexOf('### `document`'), md.indexOf('### `summary`'));
    for (const t of fromValidator) assert.ok(table.includes(`\`${t}\``), `doc_type ${t} is accepted but undocumented`);
});

test('the spec and the token allowlist agree in both directions', () => {
    const allowed = allowedPaths();
    const documented = Object.keys(spec.paths).sort();
    assert.ok(allowed.length > 0, 'DOC_EXTRACT_ALLOWED_PATHS could not be read out of index.js');
    // A documented path that 403s wastes an implementer's afternoon; an allowlisted path the spec
    // omits is undiscoverable surface.
    assert.deepEqual(documented, allowed);
});

test('every allowlisted path is actually routed', () => {
    for (const p of allowedPaths()) {
        assert.ok(indexJs.includes(`path === '${p}'`), `${p} is allowlisted but never routed`);
    }
});

test('the scoped token branch sits above the channel-admin prefix branch', () => {
    // The 'ch.' branch matches on PREFIX, so a token starting "ch." would be swallowed there and
    // 401 as a malformed channel-admin JWT.
    const docExtractAt = indexJs.indexOf('process.env.DOC_EXTRACT_API_TOKEN');
    const chAt = indexJs.indexOf("token.startsWith('ch.')");
    assert.ok(docExtractAt > -1 && chAt > -1);
    assert.ok(docExtractAt < chAt, 'the doc-extract token branch fell below the ch. prefix branch');
});

test('the doc-extract token is separate from every other credential', () => {
    // Extraction is available to every user while Viva AG is a paid add-on, so one credential
    // covering both would mean a compromise of the cheap service opened the paid queue too.
    const branch = indexJs.slice(indexJs.indexOf('process.env.DOC_EXTRACT_API_TOKEN'),
        indexJs.indexOf("token.startsWith('ch.')"));
    assert.ok(!branch.includes('VIVA_AG_API_TOKEN'));
    assert.ok(!branch.includes('API_BEARER_TOKEN'));
    assert.match(branch, /adminCtx\.username = 'doc-extract-service'/);
    for (const yaml of ['s.yaml', 's-prod.yaml']) {
        assert.match(fs.readFileSync(path.join(ROOT, yaml), 'utf8'), /DOC_EXTRACT_API_TOKEN:/,
            `${yaml} never declares the token`);
    }
    // Distinct value per environment, or a dev-configured agent could claim real prod documents.
    assert.match(fs.readFileSync(path.join(ROOT, 's.yaml'), 'utf8'), /\$\{env\(DOC_EXTRACT_API_TOKEN\)\}/);
    assert.match(fs.readFileSync(path.join(ROOT, 's-prod.yaml'), 'utf8'), /\$\{env\(DOC_EXTRACT_API_TOKEN_PROD\)\}/);
});

test('both documents load through the served handlers', async () => {
    const { handleGetDocExtractDocs, handleGetDocExtractOpenApi } =
        require(path.join(WORKER, 'handlers', 'doc_extraction_docs.js'));
    const docs = await handleGetDocExtractDocs();
    assert.equal(docs._rawText, true);
    assert.ok(docs.content.length > 3000, 'the contract is suspiciously short');
    const api = await handleGetDocExtractOpenApi();
    assert.equal(api._rawBinary, true);
    // Emitted verbatim rather than re-serialized, so key order and formatting survive.
    assert.deepEqual(JSON.parse(Buffer.from(api.content, 'base64').toString('utf8')), spec);
});

test("the contract's worked example is one nano would actually accept", () => {
    // A documented example that fails validation teaches an implementer the wrong shape. This
    // runs the example from §7 through the real validator against the real catalog.
    const block = md.slice(md.indexOf('## 7. Submitting a result'));
    const json = block.slice(block.indexOf('```json') + 7, block.indexOf('```', block.indexOf('```json') + 7));
    const example = JSON.parse(json);
    const r = validateExtraction(example, loadCatalog());

    assert.equal(r.rejected.length, 0,
        `the documented example is rejected: ${JSON.stringify(r.rejected)}`);
    assert.equal(r.observations.length, example.observations.length);
    assert.equal(r.findings.length, example.findings.length);
    assert.equal(r.unmapped.length, example.unmapped.length);
    assert.equal(r.document.doc_date, '2026-08-12');
});

test('every key_name in the example exists in the catalog', () => {
    const known = new Set(loadCatalog().map(c => c.key_name));
    const block = md.slice(md.indexOf('## 7. Submitting a result'));
    const json = block.slice(block.indexOf('```json') + 7, block.indexOf('```', block.indexOf('```json') + 7));
    for (const o of JSON.parse(json).observations) {
        assert.ok(known.has(o.key_name), `${o.key_name} is documented but not in biomarker_catalog`);
    }
});

test('the documented unit conversions match the code and the catalog', () => {
    const { UNIT_CONVERSIONS } = require(path.join(WORKER, 'lib', 'docExtraction.js'));
    const catalog = new Map(loadCatalog().map(c => [c.key_name, c.unit]));
    const table = md.slice(md.indexOf('### Convertible units'), md.indexOf('### Per finding'));
    for (const [key, conversions] of Object.entries(UNIT_CONVERSIONS)) {
        assert.ok(table.includes(`\`${key}\``), `${key} converts in code but is undocumented`);
        // The documented "catalog unit" column has to be the real one, or an implementer sends
        // values in a unit nano will refuse.
        assert.ok(table.includes(catalog.get(key)), `${key}'s catalog unit ${catalog.get(key)} is not in the table`);
        for (const from of Object.keys(conversions)) {
            assert.notEqual(from, String(catalog.get(key)).toLowerCase(),
                `${key} declares a conversion from its own catalog unit`);
        }
    }
});

test('the documented reason vocabulary matches the code', () => {
    const { REASONS } = require(path.join(WORKER, 'handlers', 'doc_extraction.js'));
    const specReasons = spec.components.schemas.Reason.enum;
    assert.deepEqual([...specReasons].sort(), Object.values(REASONS).sort());
    // The prose table is what an implementer actually reads.
    const table = md.slice(md.indexOf('### Reason vocabulary'), md.indexOf('## 3. Lifecycle'));
    for (const r of Object.values(REASONS)) {
        if (r === 'nothing_extracted') continue;   // reserved, not yet returned by any path
        assert.ok(table.includes(`\`${r}\``), `${r} is returned by the code but undocumented`);
    }
});

test('the documented limits match the code', () => {
    const dx = require(path.join(WORKER, 'handlers', 'doc_extraction.js'));
    const val = require(path.join(WORKER, 'lib', 'docExtraction.js'));
    const limits = md.slice(md.indexOf('## 10. Limits'));
    for (const n of [dx.MIN_LEASE_SECONDS, dx.MAX_LEASE_SECONDS, dx.DEFAULT_LEASE_SECONDS,
        val.MAX_OBSERVATIONS, val.MAX_FINDINGS, val.MAX_SUMMARY_LENGTH, val.MAX_UNMAPPED,
        val.OBSERVATION_CONFIDENCE_FLOOR, val.FINDING_CONFIDENCE_FLOOR,
        val.MAX_STRUCTURED_DEPTH, val.MAX_STRUCTURED_ARRAY, val.MAX_STRUCTURED_STRING, val.MAX_STRUCTURED_KEYS,
        `${val.MAX_STRUCTURED_BYTES / 1024} KB`]) {
        assert.ok(limits.includes(String(n)), `limit ${n} is enforced but not in the limits table`);
    }
});

test('the contract answers what an implementer has to know before writing code', () => {
    // Not a style check — each of these is a question that, unanswered, forces an out-of-band
    // conversation, which is exactly what a self-documenting endpoint exists to prevent.
    for (const [what, needle] of [
        ['how to authenticate', 'Authorization: Bearer'],
        ['where the job token goes', 'X-Doc-Extract-Job-Token'],
        ['that failures are HTTP 200', 'Branch on the body, not the status code'],
        ['that an empty queue is not an error', '"job": null'],
        ['that the catalog is the vocabulary', 'must come from this list, verbatim'],
        ['what to do with an unknown analyte', 'unmapped'],
        ['that nano rejects rather than repairs', 'Nano rejects; it never repairs'],
        ['the no-readable-date consequence', 'no observations are stored at all'],
        ['that findings are held to a higher bar', 'worse outcome than a missed one'],
        ['how to test without a live job', '/doc-extract/validate'],
        ['how to tell a lost job', 'Knowing when you have lost a job'],
        ['a worker loop to copy', 'POST /doc-extract/jobs/claim {worker_id'],
    ]) {
        assert.ok(mdFlat.includes(needle.replace(/\s+/g, ' ')), `the contract never explains ${what}`);
    }
});

test('fetchCatalog selects every field the validator reads off a catalog row', () => {
    // The gap this closes: validateExtraction REBUILDS each observation from the catalog row
    // rather than echoing the payload, so a column the production query forgets to select
    // silently becomes null on every stored observation. A unit-test fixture that happens to
    // carry the field hides it completely — which is exactly how loinc_code shipped as null to
    // dev before this test existed.
    const handler = fs.readFileSync(path.join(WORKER, 'handlers', 'doc_extraction.js'), 'utf8');
    const fn = handler.slice(handler.indexOf('async function fetchCatalog'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    const validator = fs.readFileSync(path.join(WORKER, 'lib', 'docExtraction.js'), 'utf8');

    for (const field of [...new Set([...validator.matchAll(/\bcatalog\.(\w+)/g)].map(m => m[1]))]) {
        assert.ok(body.includes(field),
            `validateExtraction reads catalog.${field}, which fetchCatalog never selects`);
    }
});

// ── the food-sensitivity half of the contract (§40) ──────────────────────────────────────────
// Same rule as the rest of this file: the spec ships inside the function, so it cannot drift from
// the code by deployment — only by someone editing one and not the other. These are what stop it.

test('every food rejection reason the validator emits is documented', () => {
    const src = fs.readFileSync(path.join(WORKER, 'lib', 'foodSensitivity.js'), 'utf8');
    const emitted = [...new Set([...src.matchAll(/reject\(rejected, '([a-z_]+)'/g)].map(m => m[1]))];
    assert.ok(emitted.length >= 7, `only found ${emitted.length} food reason codes`);
    const table = md.slice(md.indexOf('### Per food-sensitivity item'), md.indexOf('### Convertible units'));
    for (const r of emitted) {
        assert.ok(md.includes(`\`${r}\``), `${r} is emitted by the code but appears nowhere in the contract`);
    }
    // The per-item ones belong in the per-item table specifically, where an implementer looks.
    for (const r of emitted.filter(x => x !== 'invalid_food_panel' && x !== 'too_many_food_items')) {
        assert.ok(table.includes(`\`${r}\``), `${r} is missing from the per-item rule table`);
    }
});

test('the documented food limits match the code', () => {
    const fsv = require(path.join(WORKER, 'lib', 'foodSensitivity.js'));
    const limits = md.slice(md.indexOf('## 10. Limits'));
    assert.ok(limits.includes(String(fsv.MAX_FOOD_ITEMS)), 'MAX_FOOD_ITEMS is not in the limits table');
    assert.ok(limits.includes(String(fsv.FOOD_CONFIDENCE_FLOOR)), 'the food confidence floor is not in the limits table');
    assert.ok(spec.components.schemas.FoodSensitivity.properties.items.maxItems === fsv.MAX_FOOD_ITEMS,
        'the spec and the code disagree about the item cap');
});

test("the contract's food example is one nano would actually accept", () => {
    // The same guarantee the biomarker worked example already carries: an implementer copying the
    // block out of the docs gets something that validates.
    const { validateFoodSensitivity } = require(path.join(WORKER, 'lib', 'foodSensitivity.js'));
    const block = md.slice(md.indexOf('### `food_sensitivity`'));
    const json = block.slice(block.indexOf('```json') + 7, block.indexOf('```', block.indexOf('```json') + 7));
    const payload = JSON.parse(json);
    assert.ok(payload.food_sensitivity, 'the example has no food_sensitivity block');

    const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'schemas', 'migration_food_catalog.sql'), 'utf8');
    const catalog = [...sql.matchAll(/^\s{4}\('([^']+)', '([^']+)', '([^']*)', '([^']+)',/gm)]
        .map(m => ({ food_key: m[1], name_zh: m[2], name_en: m[3], category: m[4], aliases: [] }));
    const r = validateFoodSensitivity(payload.food_sensitivity, catalog);
    assert.deepStrictEqual(r.rejected, [], 'the documented example is rejected by the real validator');
    assert.strictEqual(r.counts.items_accepted, payload.food_sensitivity.items.length);
});

test('the spec declares the food payload and the catalog ships the food vocabulary', () => {
    assert.ok(spec.components.schemas.ResultPayload.properties.food_sensitivity,
        'ResultPayload does not declare food_sensitivity');
    assert.ok(spec.paths['/doc-extract/catalog'].get.responses['200']
        .content['application/json'].schema.properties.food_catalog,
        'the catalog endpoint does not declare food_catalog');
    // The handler must actually send it, or an implementer cannot produce a food_key at all.
    const handler = fs.readFileSync(path.join(WORKER, 'handlers', 'doc_extraction.js'), 'utf8');
    assert.ok(handler.includes('food_catalog: await fetchFoodCatalog()'),
        'the claim response does not ship food_catalog');
});

// ── contract 3: structured v2, source refs, suggested_key, tag_catalog, tags ──────────────────

const TAG_ROW = /^\s{4}\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']*)',\s*'\{([^}]*)\}',\s*(NULL|'\{[^}]*\}'),\s*(NULL|'[^']*'),\s*\d+\)/gm;
function loadTagCatalog() {
    const sql = fs.readFileSync(path.join(ROOT, 'src', 'schemas', 'migration_tag_catalog.sql'), 'utf8');
    const rows = [...sql.matchAll(TAG_ROW)].map(m => ({
        tag_key: m[1], category: m[2], name_zh: m[3], name_en: m[4],
        aliases: m[5] ? m[5].split(',').map(a => a.trim()).filter(Boolean) : [],
        values: m[6] === 'NULL' ? null : m[6].slice(2, -2).split(',').map(v => v.trim()),
        memory_category: m[7] === 'NULL' ? null : m[7].slice(1, -1),
    }));
    assert.ok(rows.length > 100, `migration_tag_catalog.sql yields ${rows.length} rows — the row format the test parses has drifted`);
    return rows;
}

test('the tag catalog rows are well-formed', () => {
    const { VALID_TAG_CATEGORIES } = require(path.join(WORKER, 'lib', 'docExtraction.js'));
    const rows = loadTagCatalog();
    const keys = rows.map(r => r.tag_key);
    assert.equal(new Set(keys).size, keys.length, 'a tag_key is seeded twice');
    const names = new Map();
    for (const r of rows) {
        assert.match(r.tag_key, /^[a-z_]+:[a-z0-9_]+$/, `${r.tag_key} is not <category>:<slug>`);
        assert.equal(r.tag_key.split(':')[0], r.category, `${r.tag_key}'s prefix disagrees with its category`);
        assert.ok(VALID_TAG_CATEGORIES.has(r.category), `${r.tag_key} has an unknown category`);
        assert.ok(r.name_zh.length >= 2, `${r.tag_key}'s name_zh is too short to match`);
        if (r.values) assert.ok(r.values.length >= 2, `${r.tag_key} admits fewer than two values`);
        // family_history must never reach a consumer looking for the subject's own conditions.
        if (r.category === 'family_history') assert.equal(r.memory_category, null, `${r.tag_key} is mirrored — a relative's condition would read as the user's`);
        // An alias that two keys claim resolves to nothing at re-promotion (lib/repromotion.js);
        // catch it at seed time instead.
        for (const n of [r.name_zh, ...r.aliases]) {
            const k = n.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
            assert.ok(!names.has(k) || names.get(k) === r.tag_key, `"${n}" is claimed by both ${names.get(k)} and ${r.tag_key}`);
            names.set(k, r.tag_key);
        }
    }
    assert.deepEqual(spec.components.schemas.TagCategory.enum.sort(), [...VALID_TAG_CATEGORIES].sort(),
        'the OpenAPI TagCategory enum differs from the code');
});

test("the contract's worked example is accepted under contract 3, tags and structured v2 included", () => {
    const block = md.slice(md.indexOf('## 7. Submitting a result'));
    const json = block.slice(block.indexOf('```json') + 7, block.indexOf('```', block.indexOf('```json') + 7));
    const example = JSON.parse(json);
    const r = validateExtraction(example, loadCatalog(), null, { tagCatalogRows: loadTagCatalog() });
    assert.deepEqual(r.rejected, [], `the documented example is rejected: ${JSON.stringify(r.rejected)}`);
    assert.deepEqual(r.warnings, [], `the documented example draws a warning: ${JSON.stringify(r.warnings)}`);
    assert.equal(r.structured.version, 2);
    // Every source in the example points inside the structured block it ships with.
    for (const o of r.observations) assert.ok(o.source, `${o.key_name} lost its source`);
    const facts = r.tags.filter(t => t.kind === 'fact');
    assert.equal(facts.length, 1);
    assert.equal(facts[0].tag_key, 'allergy:penicillin');
    // The descriptor sent as one, plus the finding stored as one.
    assert.equal(r.tags.filter(t => t.kind === 'descriptor').length, 2);
    assert.ok(r.tags.some(t => t.reason === 'from_finding'));
    const suggested = r.unmapped.find(u => u.suggested_key);
    assert.ok(suggested, 'the suggested_key in the example was dropped');
    assert.equal(suggested.suggested_key, 'RDW');
});

test("the contract's structured v2 example (§7) validates", () => {
    const block = md.slice(md.indexOf('### `structured`'));
    const json = block.slice(block.indexOf('```json') + 7, block.indexOf('```', block.indexOf('```json') + 7));
    const r = validateExtraction(JSON.parse(json), loadCatalog());
    assert.deepEqual(r.rejected, []);
    assert.equal(r.structured.sections[0].tables[0].rows.length, 2);
});

test("the contract's tags example (§7) validates against the seeded catalog", () => {
    const block = md.slice(md.indexOf('### `tags`'));
    const json = block.slice(block.indexOf('```json') + 7, block.indexOf('```', block.indexOf('```json') + 7));
    const payload = JSON.parse(`{${json}}`);
    const r = validateExtraction({ document: { doc_date: '2026-06-01' }, ...payload }, loadCatalog(), null, { tagCatalogRows: loadTagCatalog() });
    assert.deepEqual(r.rejected, []);
    assert.deepEqual(r.tags.map(t => [t.kind, t.tag_key, t.status, t.value]), [
        ['fact', 'allergy:shellfish', 'current', null],
        ['fact', 'result:hpv52', 'current', 'positive'],
        ['fact', 'medication:metformin', 'stopped', null],
        ['descriptor', null, 'current', null],
    ]);
    assert.equal(r.tags[0].since, '2026-05-10');
    assert.equal(r.tags[1].since, '2026-06-01', 'since defaults to doc_date');
});

test('every per-item reason and warning the validator emits is documented', () => {
    const src = fs.readFileSync(path.join(WORKER, 'lib', 'docExtraction.js'), 'utf8');
    const emitted = [...new Set([...src.matchAll(/_reject\(rejected, '([a-z_]+)'/g)].map(m => m[1]))];
    assert.ok(emitted.length >= 15, `only found ${emitted.length} reason codes`);
    const rules = md.slice(md.indexOf('## 8. What nano validates'), md.indexOf('## 9. Testing'));
    for (const r of emitted) assert.ok(rules.includes(`\`${r}\``), `${r} is emitted by the validator but appears nowhere in §8`);
    const warned = [...new Set([...src.matchAll(/warnings\.push\(\{ reason: '([a-z_]+)'/g)].map(m => m[1]))];
    assert.deepEqual(warned.sort(), ['bad_source', 'unknown_suggested_key']);
    for (const w of warned) assert.ok(rules.includes(`\`${w}\``), `warning ${w} is undocumented`);
    assert.deepEqual(spec.components.schemas.Warning.properties.reason.enum.sort(), warned);
    // The demotion reasons land on the stored row, not in `rejected`; the doc must still name them.
    for (const d of ['unknown_tag', 'tag_category_mismatch']) assert.ok(rules.includes(d), `${d} is undocumented`);
});

test('the spec declares tag_catalog everywhere the claim and catalog ship it, and the tags payload', () => {
    assert.ok(spec.components.schemas.Job.properties.tag_catalog, 'Job does not declare tag_catalog');
    assert.ok(spec.paths['/doc-extract/catalog'].get.responses['200'].content['application/json'].schema.properties.tag_catalog);
    assert.equal(spec.components.schemas.ResultPayload.properties.tags.maxItems,
        require(path.join(WORKER, 'lib', 'docExtraction.js')).MAX_TAGS);
    assert.deepEqual(spec.components.schemas.Structured.properties.version.enum, [1, 2]);
    const handler = fs.readFileSync(path.join(WORKER, 'handlers', 'doc_extraction.js'), 'utf8');
    assert.ok(handler.includes('tag_catalog: await fetchTagCatalog()'), 'the claim response does not ship tag_catalog');
    // memory_category is nano's decision about what ACTS on a fact — never the agent's to see.
    const fn = handler.slice(handler.indexOf('async function fetchTagCatalog'));
    assert.ok(!fn.slice(0, fn.indexOf('\n}')).includes('memory_category'), 'fetchTagCatalog leaks memory_category to the agent');
});

test('the documented contract-3 limits match the code', () => {
    const val = require(path.join(WORKER, 'lib', 'docExtraction.js'));
    const limits = md.slice(md.indexOf('## 10. Limits'));
    for (const n of [val.MAX_TAGS, val.TAG_CONFIDENCE_FLOOR, val.MAX_STRUCTURED_SECTIONS, val.MAX_STRUCTURED_TABLES, val.MAX_STRUCTURED_ROWS]) {
        assert.ok(limits.includes(String(n)), `limit ${n} is enforced but not in the limits table`);
    }
    assert.ok(limits.includes(`depth ${val.MAX_STRUCTURED_DEPTH}`));
    assert.ok(mdFlat.includes('Contract version 4'));
});
