// 健康文档 is hosted by two subtabs and reachable by two roles, and every guard that keeps that
// straight is invisible at runtime: WXML has no compile-time checking (a lost gate silently
// brings an upload button back for a coach, a mistyped `t.` key renders as empty text), and the
// server's gate is a call site that reads fine whether or not it is there.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const MINI = path.join(ROOT, 'src', 'mini', 'nano-miniapp');
const HD = path.join(MINI, 'components', 'health-documents');

const handler = fs.readFileSync(
    path.join(ROOT, 'src', 'functions', 'worker', 'handlers', 'health_documents.js'), 'utf8');
const hdJs = fs.readFileSync(path.join(HD, 'health-documents.js'), 'utf8');
const hdWxml = fs.readFileSync(path.join(HD, 'health-documents.wxml'), 'utf8');
const userHealthWxml = fs.readFileSync(
    path.join(MINI, 'components', 'user-health', 'user-health.wxml'), 'utf8');
const agJs = fs.readFileSync(
    path.join(MINI, 'components', 'viva-ag-panel', 'viva-ag-panel.js'), 'utf8');
const agWxml = fs.readFileSync(
    path.join(MINI, 'components', 'viva-ag-panel', 'viva-ag-panel.wxml'), 'utf8');
const coachJs = fs.readFileSync(path.join(MINI, 'pages', 'coach', 'coach.js'), 'utf8');
const coachWxml = fs.readFileSync(path.join(MINI, 'pages', 'coach', 'coach.wxml'), 'utf8');
const hdWxss = fs.readFileSync(path.join(HD, 'health-documents.wxss'), 'utf8');

// Runs the shipping T block rather than a copy of it.
function loadT(src) {
    const i = src.indexOf('const T = {');
    const j = src.indexOf('\n}\n', i) + 3;
    const ctx = vm.createContext({});
    vm.runInContext(src.slice(i, j) + '\nglobalThis.T = T;', ctx);
    return ctx.T;
}

// The five handlers, and which of them may honour a coach_id.
const READ_HANDLERS = ['handleGetHealthDocuments', 'handleGetHealthDocumentUrl'];
const WRITE_HANDLERS = ['handleGetHealthDocumentPresign', 'handlePostHealthDocument',
    'handleDeleteHealthDocument'];

function bodyOf(name) {
    const i = handler.indexOf(`function ${name}(`);
    assert.ok(i > 0, `${name} is gone from health_documents.js`);
    const j = handler.indexOf('\nasync function ', i + 1);
    return handler.slice(i, j === -1 ? handler.indexOf('\nmodule.exports', i) : j);
}

test('the Viva AG entitlement no longer gates health documents', () => {
    // The whole point of the change: any logged-in user can build an archive. A reintroduced
    // requireVivaAgAccess here 403s every non-AG user on the 数字孪生 subtab, silently — the
    // client cannot distinguish it from an empty list.
    assert.ok(!/requireVivaAgAccess/.test(handler),
        'health_documents.js is AG-gated again; the 数字孪生 subtab would 403 for most users');
    assert.ok(!/vivaAgAccess/.test(handler), 'the vivaAgAccess import is back');
});

test('every handler resolves the owner server-side', () => {
    // openid is a client-supplied string. Nothing may reach a query without going through the
    // resolver, which is also where the coach ownership check lives.
    for (const name of READ_HANDLERS.concat(WRITE_HANDLERS)) {
        assert.match(bodyOf(name), /_resolveOwner\(/, `${name} does not resolve an owner`);
        assert.ok(!/\bgate\b/.test(bodyOf(name)), `${name} still references the old gate`);
    }
});

test('a coach may read a client\'s records but never write to them', () => {
    for (const name of READ_HANDLERS) {
        assert.match(bodyOf(name), /_resolveOwner\([^)]*coach_id\)/,
            `${name} drops coach_id, so a coach would read as themselves or unscoped`);
    }
    for (const name of WRITE_HANDLERS) {
        const body = bodyOf(name);
        assert.match(body, /_refuseCoach\(/, `${name} accepts a coach_id`);
        assert.match(body, /_resolveOwner\([^)]*,\s*null\)/,
            `${name} passes a coach_id into the resolver — a coach could write as a client`);
    }
});

test('the ownership check only runs when the caller names a coach', () => {
    // Matches handleGetUserFacts / handleGetCoachUserChat: the admin panel and the user's own
    // miniapp omit coach_id and address themselves. Making it unconditional locks them out.
    const resolver = handler.slice(handler.indexOf('async function _resolveOwner'),
        handler.indexOf('function _refuseCoach'));
    assert.match(resolver, /if \(coachId\) \{/, 'the coach check is no longer conditional');
    assert.match(resolver, /WHERE user_id = \$1 AND coach_id = \$2/,
        'the ownership check no longer compares the client against the coach');
});

test('the twin subtab hosts the section, and a coach gets no upload button', () => {
    const tag = userHealthWxml.match(/<health-documents[\s\S]*?\/>/);
    assert.ok(tag, 'the 数字孪生 subtab no longer hosts <health-documents>');
    assert.match(tag[0], /can-upload="\{\{mode === 'self'\}\}"/,
        'can-upload is not bound to the self view — a coach would get an upload button');
    assert.match(tag[0], /coach-id="\{\{coachId\}\}"/, 'coach-id is not forwarded');
    assert.match(tag[0], /wx:if="\{\{!isGuest\}\}"/, 'a guest, who has no server-side account, would mount it');

    // Bottom of the twin body, as asked: nothing but the trailing spacer may follow it.
    const after = userHealthWxml.slice(userHealthWxml.indexOf(tag[0]) + tag[0].length,
        userHealthWxml.indexOf('</block>'));
    assert.ok(!/<view class="health-section"/.test(after),
        'another section was added below 健康文档; it is meant to be last');
});

test('canUpload gates the destructive controls, not just the button', () => {
    assert.match(hdWxml, /class="hd-upload-btn[^"]*"/);
    assert.ok(/wx:if="\{\{canUpload\}\}"[^>]*class="hd-upload-btn/.test(hdWxml.replace(/\s+/g, ' ')),
        'the upload button is not gated on canUpload');
    assert.ok(/<text wx:if="\{\{canUpload\}\}" class="hd-doc-del"/.test(hdWxml),
        'the delete control is not gated on canUpload');
    // Belt-and-braces: the tap handler refuses too, since a WXML gate is one edit from gone.
    assert.match(hdJs, /deleteDocument\(e\) \{\s*\n\s*if \(!this\.properties\.canUpload\) return/,
        'deleteDocument does not re-check canUpload');
});

test('coach_id reaches the server on read, and never on a write', () => {
    const scoped = hdJs.match(/`\$\{BASE\}\/api\/health-documents[^`]*`/g) || [];
    // Matched precisely rather than by "the one that isn't presign or url": the component has
    // grown write endpoints that also carry ?openid=, and a loose heuristic silently starts
    // asserting against the wrong one.
    const list = scoped.find(u => /health-documents\?openid=/.test(u));
    const url = scoped.find(u => u.includes('/url?openid='));
    assert.ok(list && url, 'the list or document-url request could not be found');
    assert.match(list, /_scope\(\)/, 'the list request drops coach_id');
    assert.match(url, /_scope\(\)/, 'the document-url request drops coach_id');

    // Every write is the owner's alone. A coach_id on one of these is refused outright by the
    // server (_refuseCoach), so sending one would break the coach view rather than protect it.
    for (const [label, marker] of [['delete', 'deleteDocument(e)'], ['re-run', 'rerunExtraction(e)'],
        ['reject extraction', 'rejectExtraction(e)']]) {
        const at = hdJs.indexOf(marker);
        if (at === -1) continue;   // the action does not exist in this build
        const body = hdJs.slice(at, at + 900);
        assert.ok(!/_scope\(\)/.test(body), `${label} sends a coach_id, which the server refuses`);
        assert.match(body, /if \(!this\.properties\.canUpload\) return/,
            `${label} is not re-checked against canUpload in JS`);
    }
});

test('the coach page can actually supply a coach id', () => {
    // this._coachId lives outside `data`, so WXML cannot read it. Both assignment sites have to
    // mirror it or the coach's read is unscoped (and 403s once the server checks).
    assert.match(coachJs, /\n\s*coachId: null,/, 'data.coachId is missing');
    assert.match(coachWxml, /coach-id="\{\{coachId\}\}"/, 'coach.wxml does not pass coach-id');
    const assigns = [...coachJs.matchAll(/this\._coachId = /g)];
    const mirrors = [...coachJs.matchAll(/coachId: (this\._coachId|coach\.id)/g)];
    assert.equal(mirrors.length, assigns.length,
        `${assigns.length} assignments of _coachId but ${mirrors.length} mirror it into data`);
});

test('the AG panel kept nothing of its own upload path', () => {
    // A second copy is two upload paths drifting apart against one backend.
    assert.match(agWxml, /<health-documents /, 'the AG panel no longer hosts the shared component');
    for (const dead of ['_uploadDocument', '_choosePdf', '_choosePhoto', 'chooseDocument',
        '_loadDocuments', 'ALLOWED_EXTENSIONS', 'MAX_BYTES']) {
        assert.ok(!agJs.includes(dead), `viva-ag-panel.js still carries ${dead}`);
    }
    // ...but the pieces its job/report viewer needs must survive the extraction.
    assert.match(agJs, /_sizeLabel\(/, 'result-file sizes lost their formatter');
    assert.match(agJs, /const DOC_EXTENSIONS/, 'openResultFile lost its openDocument fileType list');
});

test('every t. key resolves in both languages', () => {
    for (const [label, src, wxml] of [['health-documents', hdJs, hdWxml], ['viva-ag-panel', agJs, agWxml]]) {
        const T = loadT(src);
        const i = src.indexOf('const T = {'), j = src.indexOf('\n}\n', i) + 3;
        const body = src.slice(0, i) + src.slice(j) + wxml;
        const used = [...new Set([...body.matchAll(/\bt\.([A-Za-z_]\w*)/g)].map(m => m[1]))];
        const missing = used.filter(k => !(k in T.zh) || !(k in T.en));
        assert.deepEqual(missing, [], `${label} reads keys absent from a language block`);
        assert.deepEqual(Object.keys(T.zh).sort(), Object.keys(T.en).sort(),
            `${label}'s zh and en blocks have diverged`);
    }
});

// The upload is presign -> readFile -> PUT -> register, and only the last two steps used to be
// distinguishable: 'uploading' covered ~95% of the wait and never moved while it did, which on a
// large scan over a slow uplink is indistinguishable from a hang.
test('the upload reports three phases, in the order they happen', () => {
    const body = hdJs.slice(hdJs.indexOf('async _uploadDocument('));
    const seen = [...body.matchAll(/uploadStatus: t\.(\w+)/g)].map(m => m[1]);
    assert.deepEqual(seen, ['preparing', 'uploading', 'registering'],
        'the phases are missing, reordered, or one of them stopped being announced');

    // readFile pulls the whole file into the JS heap and reports nothing, so it belongs to
    // 'preparing' — announcing 'uploading' before it means the label lies for its slowest step.
    const readAt = body.indexOf('readFile');
    assert.ok(readAt > -1 && readAt < body.indexOf('uploadStatus: t.uploading'),
        'the transfer label now precedes readFile, so it covers work that is not the transfer');
});

test('the progress bar is indeterminate, and actually moves', () => {
    assert.match(hdWxml, /wx:if="\{\{canUpload && uploading\}\}"[\s\S]{0,80}hd-progress/,
        'the bar renders outside an upload, or where there is no upload button to sit under');

    // An "indeterminate bar" with no animation is a static line: the motion IS the signal.
    assert.match(hdWxss, /@keyframes hd-indeterminate/, 'the bar has no keyframes to move it');
    assert.match(hdWxss, /\.hd-progress-bar[\s\S]*?animation: hd-indeterminate/,
        'the bar never references its own animation');

    // wx.request exposes no upload progress events, so any percentage here would be invented.
    // Matched as CALLS — both names are discussed in this component's own comments, which is
    // where the reasoning for the indeterminate bar lives and should stay.
    assert.ok(!/onProgressUpdate\(|wx\.uploadFile\(/.test(hdJs),
        'a real progress source appeared — the bar should stop being indeterminate too');
});
