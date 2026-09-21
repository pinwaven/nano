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
const recJs = read(MINI, 'components', 'strip-record', 'strip-record.js');
const recWxml = read(MINI, 'components', 'strip-record', 'strip-record.wxml');
const uhJs = read(MINI, 'components', 'user-health', 'user-health.js');
const uhWxml = read(MINI, 'components', 'user-health', 'user-health.wxml');
const uhJson = JSON.parse(read(MINI, 'components', 'user-health', 'user-health.json'));
const v8Index = read(MINI, 'utils', 'wearable', 'v8', 'index.js');
const v8Proto = read(MINI, 'utils', 'wearable', 'v8', 'protocol.js');

// The component's T is { ecg: { zh, en }, ppg: { zh, en } } built over a COMMON block; the
// host's is the flat { zh, en }. Both are evaluated from `const COMMON`/`const T` to the end of T.
function loadT(src) {
    const c = src.indexOf('const COMMON = {');
    const i = c >= 0 ? c : src.indexOf('const T = {');
    const t = src.indexOf('const T = {', i);
    const j = src.indexOf('\n}\n', t) + 3;
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
    assert.ok(!/oss_key/.test(bodyOf('_publicRow').replace(/const \{ oss_key, peaks, \.\.\.summary \} = d;/, '')), 'oss_key must never reach a client');
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
    const haloIndex = read(MINI, 'utils', 'wearable', 'halo', 'index.js');
    assert.ok(!/recordEcg/.test(haloIndex), 'Halo has no ECG opcode');
    // PPG: both adapters expose the same recordPpg() contract over the 0x78/0x3a tap.
    assert.match(v8Proto, /function ppgModePacket\(mode, status\)/);
    assert.match(v8Proto, /function parsePpgChunk\(buf\)/);
    assert.match(v8Index, /async recordPpg\(opts = \{\}\)/);
    assert.match(haloIndex, /async recordPpg\(opts = \{\}\)/);
    assert.match(haloIndex, /ppgControlPacket\(3, 0\)[\s\S]{0,200}ppgControlPacket\(5, 0\)/, 'stop then quit');
});

test('every t.* key the strip WXML uses exists in both languages, for both kinds', () => {
    const recT = loadT(recJs);
    const uhT = loadT(uhJs);
    const recKeys = new Set([...recWxml.matchAll(/\bt\.([A-Za-z0-9_]+)\b/g)].map((m) => m[1]));
    assert.ok(recKeys.size > 10, 'strip-record: no keys found');
    for (const kind of ['ecg', 'ppg']) for (const lang of ['zh', 'en']) for (const k of recKeys) {
        assert.ok(k in recT[kind][lang], `strip-record ${kind}/${lang} lacks ${k}`);
    }
    const uhKeys = new Set([...uhWxml.matchAll(/\bt\.((?:ecg|ppg)[A-Za-z0-9_]*)\b/g)].map((m) => m[1]));
    assert.ok(uhKeys.size > 0, 'user-health: no keys found');
    for (const k of uhKeys) {
        assert.ok(k in uhT.zh, `user-health: zh lacks ${k}`);
        assert.ok(k in uhT.en, `user-health: en lacks ${k}`);
    }
    for (const lang of ['zh', 'en']) {
        assert.ok(!/诊断心电图|diagnos(e|tic ECG) (your|the) heart/i.test(JSON.stringify(recT.ecg[lang])), 'ECG copy must not claim a diagnosis');
        assert.match(recT.ecg[lang].notDiagnosis, /不是心电图诊断|not a diagnostic ECG/);
        // PPG: never an oxygen or glucose reading — the stream is the SDK's "blood glucose" tap.
        assert.match(recT.ppg[lang].notDiagnosis, /不是血氧或血糖|not an oxygen or glucose/);
        assert.match(uhT[lang].ppgNotDiagnosis, /不是血氧或血糖|not an oxygen or glucose/);
        assert.ok(!/血糖测量结果|glucose level|blood sugar reading/i.test(JSON.stringify(recT.ppg[lang])), 'PPG copy must not promise glucose');
    }
});

test('recording is self-only; a stored strip opens read-only for a coach; the overlay is registered', () => {
    assert.strictEqual(uhJson.usingComponents['strip-record'], '../strip-record/strip-record');
    // Mounted for self, or for anyone viewing a stored strip — and then read-only unless self,
    // with the coach id riding along so the server runs its users.coach_id check.
    assert.match(uhWxml, /<strip-record wx:if="\{\{mode === 'self' \|\| stripViewId\}\}" kind="\{\{stripKind\}\}"/);
    assert.match(uhWxml, /read-only="\{\{mode !== 'self'\}\}"/);
    assert.match(uhWxml, /coach-id="\{\{mode === 'coach' \? coachId : ''\}\}"/);
    assert.match(recJs, /if \(!id \|\| this\.data\.readOnly\) return/, 'delete re-checks readOnly in code, not only in WXML');
    assert.match(uhWxml, /wx:if="\{\{mode === 'self' && ecgSupported\}\}" class="wd-sync-btn" catchtap="openEcgRecord" data-kind="ecg"/);
    assert.match(uhWxml, /wx:if="\{\{mode === 'self' && ppgSupported\}\}" class="wd-sync-btn" catchtap="openEcgRecord" data-kind="ppg"/);
    assert.match(uhJs, /const ecg = bound && brand === 'v8'/, 'ecgSupported is V8-only');
    assert.match(uhJs, /const ppg = bound && \(brand === 'v8' \|\| brand === 'halo'\)/, 'ppgSupported is V8 + Halo');
    // The component itself refuses a kind its brand cannot record, with the same brand table.
    assert.match(recJs, /ecg: \{ durationSec: 30, method: 'recordEcg', path: 'ecg', brands: \['v8'\]/);
    assert.match(recJs, /ppg: \{ durationSec: 60, method: 'recordPpg', path: 'ppg', brands: \['v8', 'halo'\]/);
    assert.match(uhJs, /wearableId !== '__server__'/, 'a server-only binding has no BLE id to record with');
    // user-health's _req resolves with the whole wx.request response (found live: the card never
    // rendered because the list was read off the response instead of its body).
    assert.match(uhJs, /const body = res && res\.data\n\s+const items = \(body && body\.success/, '_loadEcg must read the response body');
});
