'use strict';

// A user must never be shown an internal dot code (`D-N9`, `DOT-N9`). Both formulation prompts
// already say so; prod shows the model writing one anyway in 13 of 4394 AI replies over 30 days,
// four of them in reports authored by the external Viva AG agent. So it is rewritten, not asked
// for — and the two halves that make that safe are the fence rule (a :::formula row is keyed on
// the code and MUST survive) and applying it to one assembled string per delivery.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { humanizeDotCodes, buildDotNameMap } = require('../src/functions/worker/lib/dotNames');

const DOTS = [
    { key_name: 'DOT-N6', key_name_zh: '原粒6号', name_zh: '线粒体焕新', name: 'Mito Renew' },
    { key_name: 'DOT-N9', key_name_zh: '原粒9号', name_zh: 'NAD焕新', name: 'NAD Renew' },
    { key_name: 'DOT-N11', key_name_zh: '原粒11号', name_zh: '代谢焕新', name: 'Metabolic Renew' },
];

test('prose codes are rewritten, in both code spellings and both languages', () => {
    // The real prod leak, message 60798.
    const prose = '故D-N6、D-N9、D-N11作为代谢年龄与细胞年龄双维核心，给予高强度支持。';
    assert.strictEqual(
        humanizeDotCodes(prose, DOTS, 'zh'),
        '故原粒6号、原粒9号、原粒11号作为代谢年龄与细胞年龄双维核心，给予高强度支持。');

    // The AG spelling, message 59872.
    assert.match(humanizeDotCodes('开封 DOT-N1 与 DOT-N6 连续 8 周', DOTS, 'zh'), /原粒6号/);
    assert.ok(!humanizeDotCodes('开封 DOT-N6 连续 8 周', DOTS, 'zh').includes('DOT-N6'));

    // English has no 对话中称呼 column; the English formulary line shows the name, so does this.
    assert.strictEqual(humanizeDotCodes('We emphasise D-N9 here.', DOTS, 'en'), 'We emphasise NAD Renew here.');
});

test('a :::formula card is left byte-identical — its rows are KEYED on the code', () => {
    const card = [
        'prose mentioning D-N9',
        '',
        ':::formula',
        '#cycle|28|56',
        '#rung|8种原粒|8|一句话',
        'DOT-N6|线粒体焕新|#8A9AAB|17|0',
        'DOT-N9|NAD焕新|#7FA99B|0|12',
        ':::',
        'tail mentioning D-N6',
    ].join('\n');
    const out = humanizeDotCodes(card, DOTS, 'zh');
    assert.ok(out.includes('DOT-N6|线粒体焕新|#8A9AAB|17|0'), 'card row was rewritten — the card would break');
    assert.ok(out.includes('DOT-N9|NAD焕新|#7FA99B|0|12'), 'card row was rewritten');
    assert.ok(out.startsWith('prose mentioning 原粒9号'), 'prose before the fence not rewritten');
    assert.ok(out.endsWith('tail mentioning 原粒6号'), 'prose after the fence not rewritten');
});

test('an unmapped code is left exactly as written', () => {
    // A code for a dot that does not exist is a fabrication for factCheck.js to flag. Renaming it
    // to something plausible would hide it.
    assert.strictEqual(humanizeDotCodes('D-N77 is not real', DOTS, 'zh'), 'D-N77 is not real');
    assert.strictEqual(humanizeDotCodes('no codes here', DOTS, 'zh'), 'no codes here');
    assert.strictEqual(humanizeDotCodes('D-N9', [], 'zh'), 'D-N9', 'no formulary — leave it alone');
});

test('zh falls back through key_name_zh -> name_zh -> name', () => {
    const m = buildDotNameMap([{ key_name: 'DOT-N3', name_zh: '静心夜', name: 'Quiet Mind' }], 'zh');
    assert.strictEqual(m.get('3'), '静心夜');
    const en = buildDotNameMap([{ key_name: 'DOT-N3', name_zh: '静心夜' }], 'en');
    assert.strictEqual(en.get('3'), '静心夜', 'en with no English name falls back rather than dropping');
});

test('every path that hands a user prose runs it through the rewriter', () => {
    const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const sites = {
        // one assembled string per delivery — a chat row and a notification row differing by a
        // token would defeat the client's text-keyed de-dup and render the bubble twice.
        'src/functions/worker/handlers/chat.js': 3,        // chat reply, formula card, health advice
        'src/functions/worker/handlers/dots.js': 1,        // deterministic fail-open delivery
        'src/functions/worker/handlers/checkin.js': 1,     // daily check-in
        'src/functions/worker/handlers/viva_ag.js': 1,     // external agent's summary
        'src/functions/worker/lib/rungCopy.js': 1,         // pitches live INSIDE the fence
    };
    for (const [file, count] of Object.entries(sites)) {
        const s = read(file);
        const calls = (s.match(/humanizeDotCodes\(/g) || []).length;
        assert.strictEqual(calls, count, `${file}: expected ${count} humanizeDotCodes call(s), found ${calls}`);
        assert.match(s, /require\('\.\.?\/(lib\/)?dotNames'\)/, `${file} does not require dotNames`);
    }
});

test('checkin selects the conversational name it now needs', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'src/functions/worker/handlers/checkin.js'), 'utf8');
    assert.match(s, /SELECT key_name, key_name_zh, name, name_zh FROM dots/,
        'without key_name_zh the check-in rewrite falls back to the dot name');
});
