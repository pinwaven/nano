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

function loadCatalog() {
    const sql = fs.readFileSync(path.join(ROOT, 'src', 'schemas', 'migration_biomarker_catalog.sql'), 'utf8');
    return [...sql.matchAll(/^\s{4}\('([^']+)',\s*(NULL|'[^']*'),\s*'[^']*',\s*'[^']*',\s*'([^']*)',\s*'[^']*',\s*(NULL|'[^']*'),\s*(TRUE|FALSE),\s*(NULL|[\d.]+),\s*(NULL|[\d.]+)\)/gm)]
        .map(m => ({
            key_name: m[1], loinc_code: m[2] === 'NULL' ? null : m[2].slice(1, -1), unit: m[3],
            ref_low: m[6] === 'NULL' ? null : Number(m[6]), ref_high: m[7] === 'NULL' ? null : Number(m[7]),
        }));
}

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
        val.MAX_OBSERVATIONS, val.MAX_FINDINGS, val.MAX_SUMMARY_LENGTH,
        val.OBSERVATION_CONFIDENCE_FLOOR, val.FINDING_CONFIDENCE_FLOOR]) {
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
