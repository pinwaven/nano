'use strict';
// The 综合报告 card and the Viva AG panel say who produced a report and whether a person reviewed
// it — from what the row records and nothing else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { reportAttribution: a } = require('../src/functions/worker/lib/reportAttribution');

test('a Curia contribution names its speaker and says it was not reviewed', () => {
    assert.equal(a({ origin: { principal_kind: 'platform-agent', display_name: 'Viva', reviewed: false } }).text,
        '由Viva（平台智能体）生成 · 未经人工审阅');
});

test('a physician agent is a different speaker from the platform agent', () => {
    const r = a({ origin: { principal_kind: 'physician', display_name: '王医生', reviewed: true } });
    assert.equal(r.kind, 'physician');
    assert.equal(r.text, '由王医生的智能体生成 · 已经人工审阅');
});

test('a queue job answered by vivad carries its speaker the same way', () => {
    assert.equal(a({ speaker: { kind: 'platform-agent', agent: 'PA-VIVA', reviewed: false } }, 'en').text,
        'By Viva (platform agent) · not reviewed by a person');
});

test('nothing recorded about review is never rendered as reviewed', () => {
    assert.equal(a({ source: 'viva-analyst' }).text, '由Viva（平台智能体）生成');
    assert.equal(a({}).text, '由Viva（平台智能体）生成');
    assert.equal(a(null).reviewed, null);
});

test('both surfaces render it', () => {
    const mini = path.join(__dirname, '../src/mini/nano-miniapp/components');
    assert.match(fs.readFileSync(path.join(mini, 'user-health/user-health.wxml'), 'utf8'), /twinReportLatest\.attribution\.text/);
    assert.match(fs.readFileSync(path.join(mini, 'viva-ag-panel/viva-ag-panel.wxml'), 'utf8'), /item\.attribution\.text/);
});
