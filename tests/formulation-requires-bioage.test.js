'use strict';

// Formulate-Dots must not run without a BioAge, and the guardrail must not hand the model a
// ready-made refusal to emit as a whole reply.
//
// Source-level assertions, in the style of tests/dots-subtab-order-card.test.js: the failure
// being guarded against is a prod behaviour with no cheap runtime harness (it needs a user with
// no kino_chip row, an LLM turn, and the async delivery pipeline), and the two halves of the fix
// are a gate placed BEFORE the agentic call and a wording that exists in four synced copies.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DOTS = read('src/functions/worker/handlers/dots.js');
const MIGRATION = read('src/schemas/migration_knowledge_refusal_wording.sql');
const FALLBACK_FILES = [
    'src/functions/worker/lib/knowledgeBase.js',
    'src/functions/worker/prompts/chat/factConstraint.js',
    'src/functions/worker/prompts/viva/systemReport.js',
];

test('handlePostFormulaDots refuses before it formulates, not after', () => {
    const start = DOTS.indexOf('async function handlePostFormulaDots(body)');
    assert.ok(start > 0, 'handlePostFormulaDots not found');
    const body = DOTS.slice(start, DOTS.indexOf('\nasync function _handleFormulaDotsAgentic', start));

    const gate = body.indexOf('bioageProfile?.BioAge == null');
    const call = body.indexOf('_handleFormulaDotsAgentic({');
    assert.ok(gate > 0, 'no BioAge gate in handlePostFormulaDots');
    assert.ok(call > 0, 'agentic call not found');
    assert.ok(gate < call, 'the gate must come BEFORE the agentic formulation is started');

    // Everything the gate skips is work that would otherwise produce a plan or an LLM turn.
    for (const skipped of ['getEssentialBlock(personaType)', 'getCurrentSolarTerm(']) {
        assert.ok(body.indexOf(skipped) > gate,
            `${skipped} runs before the gate — the gate must short-circuit it`);
    }
});

test('the refusal reaches the user as a chat message on both channels', () => {
    const start = DOTS.indexOf('bioageProfile?.BioAge == null');
    const block = DOTS.slice(start, start + 2200);

    assert.match(block, /INSERT INTO notifications/,
        'no notifications row — the client polls that channel');
    assert.match(block, /_saveChatMessage\(user\.user_id, 'ai', message, null, personaType\)/,
        'no chat_messages row — the reply would vanish on reload');
    assert.match(block, /'formulation_proposal'/,
        'must reuse a notification_type already in the deployed client\'s AI_ECHO_TYPES');
    // Both channels are written, so a type outside AI_ECHO_TYPES would render the bubble twice.
    const clientTypes = read('src/mini/nano-miniapp/pages/main/main.js');
    const echo = clientTypes.slice(clientTypes.indexOf('const AI_ECHO_TYPES'), clientTypes.indexOf('const AG_NOTIFICATION_TYPES'));
    assert.ok(echo.includes("'formulation_proposal'"), 'formulation_proposal missing from AI_ECHO_TYPES');

    assert.match(block, /processing: true/,
        'without processing:true the client prints its canned "generated" line beside the refusal');
    assert.match(block, /Kino/, 'the English message must name the Kino scan');
    assert.match(block, /Kino 芯片检测/, 'the Chinese message must name the Kino scan');
});

test('no prompt hands the model a canned refusal sentence to copy', () => {
    const CANNED = '目前没有足够信息支持这个判断';
    for (const f of FALLBACK_FILES) {
        assert.ok(!read(f).includes(CANNED),
            `${f} still contains the verbatim refusal sentence`);
    }
    // The migration may quote it — it has to match the old text in order to replace it.
    assert.ok(MIGRATION.includes(CANNED), 'migration must target the old wording');
});

test('the new clause is byte-identical in the migration and all three fallbacks', () => {
    const m = MIGRATION.match(/'(如现有数据不足以支持某个判断，说明缺的是[^']*)'/);
    assert.ok(m, 'new clause not found in the migration');
    const clause = m[1];
    // A drifted fallback silently restores the old behaviour on any DB hiccup — the whole reason
    // CLAUDE.md §26/§37/§28f require these to change together.
    for (const f of FALLBACK_FILES) {
        assert.ok(read(f).includes(clause), `${f} is out of sync with the migration`);
    }
    assert.match(clause, /绝不能构成整条回复的全部内容/, 'the "never the whole reply" ban is missing');
    assert.match(clause, /自相矛盾/, 'the "do not then give the advice anyway" ban is missing');
});
