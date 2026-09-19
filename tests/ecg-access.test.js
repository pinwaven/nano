// The ECG surfaces are three files that nothing checks at runtime: the worker routes (a lost
// branch 404s silently), the ownership pattern in handlers/ecg.js (a query without
// _resolveOwner reads another user's strips), and the miniapp copy (WXML renders a mistyped
// t.* key as empty text; a missing en key renders Chinese to an English user). Static checks
// over the shipping sources, no DB.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const MINI = path.join(ROOT, 'src', 'mini', 'nano-miniapp');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const handler = read(ROOT, 'src', 'functions', 'worker', 'handlers', 'ecg.js');
const index = read(ROOT, 'src', 'functions', 'worker', 'index.js');
const recJs = read(MINI, 'components', 'ecg-record', 'ecg-record.js');
const recWxml = read(MINI, 'components', 'ecg-record', 'ecg-record.wxml');
const uhJs = read(MINI, 'components', 'user-health', 'user-health.js');
const uhWxml = read(MINI, 'components', 'user-health', 'user-health.wxml');
const uhJson = JSON.parse(read(MINI, 'components', 'user-health', 'user-health.json'));
const v8Index = read(MINI, 'utils', 'wearable', 'v8', 'index.js');
const v8Proto = read(MINI, 'utils', 'wearable', 'v8', 'protocol.js');

function loadT(src) {
    const i = src.indexOf('const T = {');
    const j = src.indexOf('\n}\n', i) + 3;
    const ctx = vm.createContext({});
    vm.runInContext(src.slice(i, j) + '\nglobalThis.T = T;', ctx);
    return ctx.T;
}
function bodyOf(name) {
    const i = handler.indexOf(`function ${name}(`);
    assert.ok(i > 0, `${name} is gone from handlers/ecg.js`);
    const j = handler.indexOf('\nasync function ', i + 1);
    return handler.slice(i, j === -1 ? handler.indexOf('\nmodule.exports', i) : j);
}

test('every ECG handler resolves the owner server-side; only reads honour coach_id', () => {
    for (const name of ['handleGetEcgList', 'handleGetEcgWaveform']) {
        const b = bodyOf(name);
        assert.match(b, /_resolveOwner\((query|body)\?\.openid, (query|body)\?\.coach_id\)/, `${name} must pass coach_id through _resolveOwner`);
    }
    for (const name of ['handlePostEcg', 'handleDeleteEcg']) {
        const b = bodyOf(name);
        assert.match(b, /_refuseCoach\(/, `${name} must refuse a coach`);
        assert.match(b, /_resolveOwner\((query|body)\?\.openid, null\)/, `${name} resolves the owner as the caller only`);
    }
    assert.ok(!/oss_key/.test(bodyOf('_publicRow').replace(/const \{ oss_key, \.\.\.summary \} = d;/, '')), 'oss_key must never reach a client');
    assert.match(handler, /SUPPORTED_BRANDS = new Set\(\['v8'\]\)/, 'ECG is V8-only (CLAUDE.md §18)');
});

test('the worker routes GET/POST/DELETE /ecg and the waveform read', () => {
    assert.match(index, /path === '\/ecg'\) \{\s*result = await handleGetEcgList\(query\)/);
    assert.match(index, /path === '\/ecg'\) \{\s*result = await handlePostEcg\(parsedBody\)/);
    assert.match(index, /handleGetEcgWaveform\(path\.match\(\/\^\\\/ecg\\\/\(\\d\+\)\\\/waveform\$\/\)\[1\], query\)/);
    assert.match(index, /handleDeleteEcg\(path\.match\(\/\^\\\/ecg\\\/\(\\d\+\)\$\/\)\[1\], query\)/);
});

test('the miniapp adapter ports the CLI\'s ECG protocol and asks for the capture length as duration', () => {
    assert.match(v8Proto, /function setMeasurementPacket\(type, open, durationSeconds\)/);
    assert.match(v8Proto, /function parseEcgChunk\(buf\)/);
    assert.match(v8Index, /async recordEcg\(opts = \{\}\)/);
    assert.match(v8Index, /setMeasurementPacket\('ecg', true, durationSec\)/, 'the band ends the measurement itself at the requested duration — the only stop that works');
    assert.ok(!/utils\/wearable\/halo\/.*ecg/i.test(read(MINI, 'utils', 'wearable', 'halo', 'index.js')), 'Halo has no ECG opcode');
});

test('every t.* key the ECG WXML uses exists in both languages', () => {
    const recT = loadT(recJs);
    const uhT = loadT(uhJs);
    for (const [wxml, T, label] of [[recWxml, recT, 'ecg-record'], [uhWxml, uhT, 'user-health']]) {
        const keys = new Set([...wxml.matchAll(/\bt\.(ecg[A-Za-z0-9_]*|title|guide\d|start|connecting|measuring|noSignal|saving|stopEarly|packets|beatsLive|beats|rrMedian|rrSd|duration|done|retry|close|notDiagnosis)\b/g)].map((m) => m[1]));
        assert.ok(keys.size > 0, `${label}: no keys found`);
        for (const k of keys) {
            assert.ok(k in T.zh, `${label}: zh lacks ${k}`);
            assert.ok(k in T.en, `${label}: en lacks ${k}`);
        }
    }
    for (const lang of ['zh', 'en']) {
        assert.ok(!/诊断心电图|diagnos(e|tic ECG) (your|the) heart/i.test(JSON.stringify(recT[lang])), 'copy must not claim a diagnosis');
        assert.match(recT[lang].notDiagnosis, /不是心电图诊断|not a diagnostic ECG/);
    }
});

test('the card and the overlay are hosted for the self view only, and the overlay is registered', () => {
    assert.strictEqual(uhJson.usingComponents['ecg-record'], '../ecg-record/ecg-record');
    assert.match(uhWxml, /<ecg-record wx:if="\{\{mode === 'self'\}\}"/);
    assert.match(uhWxml, /wx:if="\{\{mode === 'self' && ecgSupported\}\}" class="wd-sync-btn" catchtap="openEcgRecord"/);
    assert.match(uhJs, /brand === 'v8'/, 'ecgSupported is V8-only');
    assert.match(uhJs, /wearableId !== '__server__'/, 'a server-only binding has no BLE id to record with');
});
