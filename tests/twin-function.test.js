'use strict';
// The twin function (src/functions/twin): the shared-code rule, auth, routing, the origin a
// contribution must carry, and the shape of what leaves it. The database paths are exercised
// live against dev (docs/architecture/twin-function.md §Verified); these hold what can be held
// without one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

process.env.TWIN_API_TOKEN = 'twn_' + 'a'.repeat(32);
process.env.VIVA_AG_API_TOKEN = 'vag_' + 'b'.repeat(32);
process.env.DOC_EXTRACT_API_TOKEN = 'dex_' + 'c'.repeat(32);
const TWIN = path.join(__dirname, '../src/functions/twin');
// shared/ is generated (git-ignored), exactly as the pre-deploy action generates it.
execFileSync(process.execPath, [path.join(__dirname, '../scripts/sync-twin-shared.js')], { stdio: 'pipe' });
const { handler, _internals } = require(path.join(TWIN, 'index.js'));
const read = require(path.join(TWIN, 'lib/read.js'));
const contributions = require(path.join(TWIN, 'lib/contributions.js'));

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('shared/ is the worker code the queue handlers reach, and nothing is committed there', () => {
    const shared = path.join(TWIN, 'shared/worker');
    for (const f of ['handlers/viva_ag.js', 'handlers/doc_extraction.js', 'lib/twinBundle.js', 'lib/twinMirror.js']) {
        assert.ok(fs.readFileSync(path.join(shared, f)).equals(fs.readFileSync(path.join(__dirname, '../src/functions/worker', f))), f);
    }
    // A committed copy is a second source; the worker is the only one.
    assert.match(fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8'), /^src\/functions\/twin\/shared\/$/m);
});

test('the twin function requires nothing outside its own directory', () => {
    const files = [];
    const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.name === 'node_modules') continue;
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
    } };
    walk(TWIN);
    for (const f of files) {
        for (const m of strip(fs.readFileSync(f, 'utf8')).matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
            const target = path.resolve(path.dirname(f), m[1]);
            assert.ok(target.startsWith(TWIN + path.sep), `${path.relative(TWIN, f)} requires ${m[1]}, outside the function`);
        }
    }
});

const ev = (p, { method = 'GET', auth = `Bearer ${process.env.TWIN_API_TOKEN}`, body, b64 = false } = {}) => Buffer.from(JSON.stringify({
    rawPath: p, httpMethod: method, headers: auth ? { authorization: auth } : {}, queryParameters: {},
    ...(body !== undefined ? { body: b64 ? Buffer.from(JSON.stringify(body)).toString('base64') : JSON.stringify(body), isBase64Encoded: b64 } : {}),
}));

test('no token or a wrong one is 401', async () => {
    for (const auth of [null, 'Bearer nope', `Bearer ${process.env.API_BEARER_TOKEN || 'superadmin'}`, `Bearer ${process.env.TWIN_API_TOKEN}x`]) {
        const r = await handler(ev('/api/twin/ping', { auth }));
        assert.equal(r.statusCode, 401, String(auth));
    }
});

test('each token opens its own scope and is 403 everywhere else', async () => {
    const T = process.env.TWIN_API_TOKEN, V = process.env.VIVA_AG_API_TOKEN, D = process.env.DOC_EXTRACT_API_TOKEN;
    const cases = [
        [V, '/api/twin/bundle'], [V, '/api/twin/doc-extract/jobs/claim'], [V, '/api/twin/contributions'],
        [D, '/api/twin/viva-ag/jobs/claim'], [D, '/api/twin/versions'],
        [T, '/api/twin/viva-ag/jobs/claim'], [T, '/api/twin/doc-extract/jobs/claim'],
        [V, '/api/twin/viva-ag/twin-versions'], [V, '/api/twin/viva-ag/subject-bundle'],
    ];
    for (const [tok, p] of cases) {
        const r = await handler(ev(p, { method: 'POST', auth: `Bearer ${tok}`, body: {} }));
        assert.equal(r.statusCode, 403, `${tok.slice(0, 4)} → ${p}`);
    }
});

test('the served contracts load in their own scopes', async () => {
    for (const [tok, p, min] of [[process.env.VIVA_AG_API_TOKEN, '/api/twin/viva-ag/docs', 5000],
                                  [process.env.DOC_EXTRACT_API_TOKEN, '/api/twin/doc-extract/docs', 3000],
                                  [process.env.TWIN_API_TOKEN, '/api/twin/docs', 1500]]) {
        const r = await handler(ev(p, { auth: `Bearer ${tok}` }));
        assert.equal(r.statusCode, 200, p);
        assert.ok(r.body.length > min, `${p} is suspiciously short`);
        assert.ok(!/nano-dev\.gcn\.net\/api\/(viva-ag|doc-extract)/.test(r.body), `${p} still points at the worker`);
    }
});

test('an unknown route is 404 and names itself', async () => {
    const r = await handler(ev('/api/twin/nothing-here'));
    assert.equal(r.statusCode, 404);
    assert.equal(JSON.parse(r.body).reason, 'not_found');
});

test('an unknown feed is refused before anything is read', async () => {
    const r = await read.feed('users', { subject_ref: 'vs_x' });
    assert.equal(r.success, false);
    assert.equal(r.reason, 'not_found');
});

test('a base64 event body is decoded and the /api/twin prefix is stripped', () => {
    const p = _internals.parseEvent(ev('/api/twin/contributions', { method: 'POST', body: { a: 1 }, b64: true }));
    assert.equal(p.path, '/contributions');
    assert.deepEqual(p.body, { a: 1 });
});

test('a feed hands out only settled rows and never a user id', () => {
    const src = strip(fs.readFileSync(path.join(TWIN, 'lib/read.js'), 'utf8'));
    assert.match(src, /twin_seq_at < NOW\(\) - make_interval/);
    assert.match(src, /at < NOW\(\) - make_interval/);
    const row = { id: 1, user_id: 'U-SECRET', source: 's', category: 'c', data: {}, raw_data: {}, twin_seq: '5',
                  recorded_at: new Date(), created_at: new Date(), tested_at: new Date(), role: 'user', content: 'x' };
    for (const [name, spec] of Object.entries(read.FEEDS)) {
        assert.ok(!JSON.stringify(spec.map(row)).includes('U-SECRET'), `${name} leaks user_id`);
    }
});

test('the biomarker feed carries validated, never actual (CLAUDE.md §17)', () => {
    const out = read.FEEDS.biomarkers.map({ id: 1, test_type: 'kino_chip', tested_at: new Date(), created_at: new Date(),
        data: { validated: { a: 1 }, actual: { a: 99 } } });
    assert.deepEqual(out.validated, { a: 1 });
    assert.ok(!JSON.stringify(out).includes('99'));
});

test('a contribution must say who produced it and whether it was gated', () => {
    const good = { agent_id: 'PA-VIVA', principal_kind: 'platform-agent', display_name: 'Viva', gated: false };
    assert.ok(contributions._origin(good).origin);
    assert.equal(contributions._origin(good).origin.system, 'curia');
    for (const bad of [null, { ...good, agent_id: '' }, { ...good, principal_kind: 'operator' },
                       { ...good, display_name: ' ' }, { ...good, gated: 'yes' }, (({ gated, ...o }) => o)(good)]) {
        assert.equal(contributions._origin(bad).error?.reason, 'invalid_origin', JSON.stringify(bad));
    }
});

test('a contribution id is the sender\'s UUID and nothing else', () => {
    assert.ok(contributions._uid('3F2504E0-4F89-41D3-9A0C-0305E82C3301'));
    for (const bad of ['', '1', '../x', 'vs_abc', '3f2504e0-4f89-41d3-9a0c-0305e82c330']) assert.equal(contributions._uid(bad), null);
});

test('only kinds with a landing place are accepted', () => {
    assert.deepEqual([...contributions.KINDS_ACCEPTED], ['report']);
});

test('the change signal reads twin_touch, and the touch trigger cannot abort a caller on a duplicate', () => {
    const mirror = strip(fs.readFileSync(path.join(__dirname, '../src/functions/worker/lib/twinMirror.js'), 'utf8'));
    assert.match(mirror, /FROM twin_touch/);
    const sql = fs.readFileSync(path.join(__dirname, '../src/schemas/migration_twin_sync.sql'), 'utf8');
    assert.match(sql, /FROM \(SELECT DISTINCT user_id FROM twin_changed/);
    assert.match(sql, /mint_all_users BOOLEAN NOT NULL DEFAULT FALSE/);
});
