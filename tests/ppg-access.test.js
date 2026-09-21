// handlers/ppg.js — the same ownership contract as ecg.js (a query without a matching user
// 404s, coach_id is honoured on reads only, oss_key never leaves the server), the brand table
// (V8 and Halo, 'x3' accepted as the legacy Halo value), and the worker's /ppg routes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const handler = read('src', 'functions', 'worker', 'handlers', 'ppg.js');
const index = read('src', 'functions', 'worker', 'index.js');

function bodyOf(name) {
    const i = handler.indexOf(`function ${name}(`);
    assert.ok(i > 0, `${name} is gone from handlers/ppg.js`);
    const j = handler.indexOf('\nasync function ', i + 1);
    return handler.slice(i, j === -1 ? handler.indexOf('\nmodule.exports', i) : j);
}

test('every PPG handler resolves the owner server-side; only reads honour coach_id', () => {
    for (const name of ['handleGetPpgList', 'handleGetPpgWaveform']) {
        assert.match(bodyOf(name), /_resolveOwner\((query|body)\?\.openid, (query|body)\?\.coach_id\)/, `${name} must pass coach_id through _resolveOwner`);
    }
    for (const name of ['handlePostPpg', 'handleDeletePpg']) {
        const b = bodyOf(name);
        assert.match(b, /_refuseCoach\(/, `${name} must refuse a coach`);
        assert.match(b, /_resolveOwner\((query|body)\?\.openid, null\)/, `${name} resolves the owner as the caller only`);
    }
    assert.ok(!/oss_key/.test(bodyOf('_publicRow').replace(/const \{ oss_key, peaks, \.\.\.summary \} = d;/, '')), 'oss_key must never reach a client');
    assert.match(handler, /SUPPORTED_BRANDS = new Set\(\['v8', 'halo'\]\)/, 'PPG streams from both devices (CLAUDE.md §18)');
    assert.match(bodyOf('handlePostPpg'), /if \(brand === 'x3'\) brand = 'halo'/, 'the pre-rename binding value still records');
    assert.match(handler, /CATEGORY = 'ppg'/);
    assert.match(handler, /`ppg\/\$\{userId\}\/\$\{startedAtMs\}\.ppg24`/, 'the waveform key is server-minted under ppg/<user_id>/');
    assert.match(bodyOf('handlePostPpg'), /\[owner\.userId, brand, CATEGORY/, 'health_events.source is the brand, as the wearable sync writes it');
    // The refusal stores nothing: the OSS put and the INSERT both sit after the analysis gate.
    const post = bodyOf('handlePostPpg');
    assert.ok(post.indexOf('if (!result.ok)') < post.indexOf('putObjectBuffer'));
    assert.ok(post.indexOf('if (!result.ok)') < post.indexOf('INSERT INTO health_events'));
});

test('the worker routes GET/POST/DELETE /ppg and the waveform read', () => {
    assert.match(index, /path === '\/ppg'\) \{\s*result = await handleGetPpgList\(query\)/);
    assert.match(index, /path === '\/ppg'\) \{\s*result = await handlePostPpg\(parsedBody\)/);
    assert.match(index, /handleGetPpgWaveform\(path\.match\(\/\^\\\/ppg\\\/\(\\d\+\)\\\/waveform\$\/\)\[1\], query\)/);
    assert.match(index, /handleDeletePpg\(path\.match\(\/\^\\\/ppg\\\/\(\\d\+\)\$\/\)\[1\], query\)/);
});
