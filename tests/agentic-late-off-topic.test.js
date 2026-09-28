// A RE-JUDGE may not turn a draft the first JUDGE found on topic into an off_topic rewrite.
// Dev 2026-09-23: 「帮我定制运动计划」 — the first JUDGE raised only value nits, the re-judge then
// flagged the revised plan off_topic (while its own detail said it delivered the plan), the
// off-topic framing asked for a NEW reply, and the user got an explanation of the Kino markers.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const kbPath = require.resolve(path.join(WORKER, 'lib', 'knowledgeBase'));
require.cache[kbPath] = { id: kbPath, filename: kbPath, loaded: true,
  exports: { findRelevantEntries: async () => [], getEssentialBlock: async () => null } };
const { runAgenticTurn } = require(path.join(WORKER, 'lib', 'agenticChat'));

function scriptedClient(judgeVerdicts) {
  const calls = { judge: 0, revise: 0, revisionPrompts: [] };
  const reply = (content) => ({ choices: [{ message: { content, tool_calls: [] }, finish_reason: 'stop' }] });
  const client = { chat: { completions: { create: async (req) => {
    const first = String(req.messages[0]?.content || '');
    if (first.startsWith('Grade the DRAFT REPLY')) return reply(JSON.stringify(judgeVerdicts[calls.judge++]));
    if (req.tools) return reply('七天运动计划：周一骑行 30 分钟……');
    const last = req.messages[req.messages.length - 1];
    if (last && last.role === 'user' && /fact-checker|answered the wrong question/.test(last.content)) {
      calls.revise++;
      calls.revisionPrompts.push(last.content);
      return reply(/answered the wrong question/.test(last.content) ? 'Kino 六项指标分别代表……' : '七天运动计划（修订）：周一骑行 30 分钟……');
    }
    return reply(JSON.stringify({ intended_claims: [], tools_needed: [] })); // PLAN
  } } } };
  return { client, calls };
}

const base = {
  model: 'm', message: '帮我定制运动计划', intent: 'lifestyle_question', systemPrompt: 'sys', cleanHistory: [],
  llmContext: { biomarkers: {}, dots: [], bioage: null, sub_age_display_names: null },
  pool: { query: async () => ({ rows: [] }) }, user_id: 'u1', language: 'zh', personaType: 'viva', logContext: {},
};
const nit = { category: 'biomarker_mismatch', severity: 'material', detail: 'avg sleep is 6.3h not 5.8h', correction_hint: 'use 6.3h' };
const offTopic = { category: 'off_topic', severity: 'material', detail: 'the draft delivers a weekly plan…', correction_hint: 'answer the exercise request' };

test('a re-judge off_topic on a draft the first JUDGE found on topic is dropped, not acted on', async () => {
  const { client, calls } = scriptedClient([
    { verdict: 'REJECT', violations: [nit] },          // JUDGE: value nit only
    { verdict: 'REJECT', violations: [offTopic] },     // RE-JUDGE 1: late, false off_topic
  ]);
  const out = await runAgenticTurn({ ...base, client });
  assert.match(out.reply, /七天运动计划（修订）/);
  assert.equal(calls.revise, 1, 'no second, off-topic-framed rewrite');
});

test('an off_topic the first JUDGE raised still gets the new-reply rewrite', async () => {
  const { client, calls } = scriptedClient([
    { verdict: 'REJECT', violations: [offTopic] },
    { verdict: 'PASS', violations: [] },
  ]);
  const out = await runAgenticTurn({ ...base, client });
  assert.equal(calls.revise, 1);
  assert.match(out.reply, /Kino 六项指标/, 'the scripted off-topic framing was used');
});

 test('English revisions stay English even when the draft contains Chinese', async () => {
  const { client, calls } = scriptedClient([
    { verdict: 'REJECT', violations: [nit] },
    { verdict: 'PASS', violations: [] },
  ]);
  await runAgenticTurn({ ...base, language: 'en', client });
  assert.equal(calls.revise, 1);
  assert.match(calls.revisionPrompts[0], /Write every user-facing sentence in English/);
  assert.doesNotMatch(calls.revisionPrompts[0], /the reply is in Simplified Chinese/);
});
