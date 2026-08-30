// The coach panel's empty state must say WHY it is empty, and the strings must actually resolve.
//
// Prod 2026-08-30: a coach's client list rendered as "暂无分配的客户" while she had 37 real clients.
// Three different causes — no coach id in the session (so the API is never called), a non-200
// response (`_req` resolves on any status, so it became a silent `[]`), and a genuinely empty list
// — all produced that one identical screen. It took several rounds of live prod debugging to tell
// them apart, because the app discarded the one fact that would have answered it immediately.
//
// This reads the real page source, in the style of text-scale-accessibility.test.js, so a later
// edit cannot quietly collapse the branches back into one or drop a key.
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const MINI = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp');
const read = (...p) => fs.readFileSync(path.join(MINI, ...p), 'utf8');

const coachJs = read('pages', 'coach', 'coach.js');
const coachWxml = read('pages', 'coach', 'coach.wxml');
const coachWxss = read('pages', 'coach', 'coach.wxss');

// Slice out the zh/en blocks of the page's T table by brace matching from `const T = {`.
function langBlock(src, lang) {
    const start = src.indexOf(`  ${lang}: {`);
    assert.ok(start > -1, `T.${lang} block not found`);
    let depth = 0, i = src.indexOf('{', start);
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
    }
    throw new Error(`unterminated T.${lang}`);
}
const zh = langBlock(coachJs, 'zh');
const en = langBlock(coachJs, 'en');

test('every empty-state string resolves in BOTH languages', () => {
    // WXML has no compile-time key checking — a key missing from one language renders as blank,
    // which is exactly the failure mode this whole feature exists to eliminate.
    for (const key of ['noClients', 'noMatchClients', 'clientsLoadFailed', 'noCoachSession', 'retryLoad']) {
        assert.ok(new RegExp(`\\b${key}:`).test(zh), `t.${key} missing from the zh block`);
        assert.ok(new RegExp(`\\b${key}:`).test(en), `t.${key} missing from the en block`);
    }
});

test('the three empty reasons render as three distinct branches', () => {
    for (const branch of [
        `wx:if="{{clientsLoadState === 'no_coach'}}"`,
        `wx:elif="{{clientsLoadState === 'failed'}}"`,
        `wx:elif="{{clients.length === 0}}"`,
    ]) {
        assert.ok(coachWxml.includes(branch), `missing empty-state branch: ${branch}`);
    }
});

test('no comment node sits between the wx:if / wx:elif / wx:else siblings', () => {
    // A comment between conditional siblings makes the page fail to open on Android devices
    // ("Page not found") — it is invisible in the DevTools simulator, so only a rule catches it.
    const block = coachWxml.slice(
        coachWxml.indexOf(`wx:if="{{clientsLoadState === 'no_coach'}}"`),
        coachWxml.indexOf('wx:for="{{filteredClients}}"'),
    );
    assert.ok(!block.includes('<!--'), 'comment node between wx:if/wx:elif/wx:else siblings');
});

test('a no-coach session never calls the API, and says so', () => {
    // The bug was that this case fell through to `Promise.resolve({ data: { users: [] } })`,
    // producing an empty list indistinguishable from a coach with no clients.
    assert.ok(/if \(!this\._coachId\)/.test(coachJs), 'missing the explicit no-coach guard');
    assert.ok(/clientsLoadState: 'no_coach'/.test(coachJs), 'no-coach guard must set its own state');
    assert.ok(!/Promise\.resolve\(\{ data: \{ users: \[\] \} \}\)/.test(coachJs),
        'the silent empty-list fallback must be gone');
});

test('a non-200 response is treated as a failure, not an empty list', () => {
    assert.ok(/!Array\.isArray\(payload\.users\)/.test(coachJs),
        '_loadAll must verify the response actually carries a users array');
    assert.ok(/clientsLoadState: 'failed'/.test(coachJs), 'failed load must set its own state');
});

test('a successful load clears the failure state', () => {
    // Otherwise a recovered refresh keeps showing the error banner over a good list.
    assert.ok(/clientsLoadState: '', diagText: ''/.test(coachJs), 'success path must reset the state');
});

test('onShow refetches, but not on the first show', () => {
    // onLoad fires once per page instance; without onShow a backgrounded panel showed a stale list
    // forever. WeChat fires onLoad -> onShow on first open, so the first onShow must not re-fetch.
    assert.ok(/onShow\(\) \{\s*if \(!this\._loaded\) return\s*this\._loadAll\(\)/.test(coachJs),
        'onShow must refetch and guard the first invocation');
    assert.ok(/this\._loaded = true\s*\n\s*this\._loadAll\(\)/.test(coachJs),
        'onLoad must mark the page loaded before its own fetch');
});

test('the diagnostic line reports backend, coach id and build', () => {
    assert.ok(/_diagText\(res, err\)/.test(coachJs), 'missing _diagText');
    for (const bit of ['BASE', 'coach=', 'VERSION']) {
        assert.ok(coachJs.includes(bit), `_diagText should surface ${bit}`);
    }
    assert.ok(/const \{ BASE, VERSION \} = require/.test(coachJs), 'VERSION must be imported');
    assert.ok(coachWxss.includes('.empty-diag'), 'the diagnostic line needs a style');
});

test('a missing coach id is repaired from the server before giving up', () => {
    // globalData.coach is captured at login and never refreshed (nano_user is rewritten from the
    // server in several places; nano_coach only at login and sandbox enter/exit). A null therefore
    // persists across relaunches forever while roles keep updating — the exact state seen in prod
    // on 2026-08-30: header says 教练, coach=null, panel permanently empty.
    assert.ok(/_repairCoachSession\(\)/.test(coachJs), 'missing the repair attempt');
    assert.ok(/\/api\/my-coach\?user_id=/.test(coachJs), 'repair must re-resolve from the server');
    assert.ok(/wx\.setStorageSync\('nano_coach', coach\)/.test(coachJs),
        'the repair must persist, or it is redone on every visit');
    assert.ok(/if \(this\._repairAttempted\) return false/.test(coachJs),
        'the repair must be attempted once, not on every reload');
});
