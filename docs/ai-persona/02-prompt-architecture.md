# Prompt File Architecture

## Current tree (`src/functions/worker/prompts/`)

```
prompts/
  chat/                                    ← shared/generic, persona-agnostic
    factConstraint.js      — the anti-hallucination guardrail block, now shared
    factMemoryBlock.js     — "known user facts" + remember_fact instruction block, now shared
    intentClassifier.js    — classifies into 7 intents, English, persona-agnostic
    planTemplate.js        — PLAN step of the agentic loop
  nano/
    systemChat.js                          — DEAD CODE, no require() site anywhere
    systemDailyCheckin.js                  — Nano's daily check-in prompt
    systemFormulaGenerate.js               — Nano's agentic dot-formulation prompt
    systemHealthAdvice.js
    systemHealthReport.js                  — used for vision/photo lab-report analysis, for BOTH personas (see below)
    systemNutrition.js                     — legacy single-shot nutrition formulator, now a fallback only
    systemReport.js                        — used only by the dead "NanoFirstReport" workflow
    chat/
      biomarker.js  casual.js  emotional.js  nutrition.js  record.js  reminder.js  science.js
  viva/
    systemChat.js                          — DEAD CODE, no require() site anywhere
    systemDailyCheckin.js
    systemFormulaGenerate.js
    systemHealthAdvice.js
    systemHealthReport.js                  — DEAD CODE, no require() site anywhere
    systemNutrition.js
    systemReport.js                        — DEAD CODE, no require() site anywhere
    judgeTemplate.js                       — JUDGE step; lives under viva/ but used for BOTH personas (stale location)
    subAgeLabels.js                        — Chinese sub-age dimension display-name overrides, Viva-only mechanism
    chat/
      biomarker.js  casual.js  emotional.js  nutrition.js  record.js  reminder.js  science.js
  strings.js                                — small bilingual UI-string dict, appears unused
  systemAdminReport.js                      — shared, persona-agnostic, used only by handlers/reports.js (admin reports)
```

## The in-flight genericization refactor

`prompts/viva/factConstraint.js` and `prompts/viva/factMemoryBlock.js` were deleted; `prompts/chat/factConstraint.js` and `prompts/chat/factMemoryBlock.js` are their untracked replacements. The new files' own doc-comments state the intent explicitly:

> "Moved out of prompts/viva/ (was Viva-only) when Nano adopted the same agentic engine — the DB-driven content is persona-scoped via `knowledge_entries.persona_type`, so this module itself is now shared."

Every prompt template that previously required the Viva-only copy (or newly needs it, for Nano) was updated to `require('../chat/factConstraint')` / `require('../../chat/factConstraint')`: `viva/systemChat.js`, `viva/systemDailyCheckin.js`, `viva/systemFormulaGenerate.js`, `viva/systemHealthAdvice.js`, `viva/systemNutrition.js`, all 7 `viva/chat/*.js` files, and all 7 `nano/chat/*.js` files.

**Notable finding**: before this refactor, `nano/systemHealthAdvice.js` and `nano/systemNutrition.js` had **zero anti-hallucination guardrail at all** — this pass adds `getFactConstraintBlock`/`getFactMemoryBlock` to them for the first time. Nano's per-intent `chat/*.js` files already had it from an earlier, already-committed pass; only these two flat system-prompt files were missing it.

**What has *not* been unified yet**: despite `factConstraint.js`/`factMemoryBlock.js`/`intentClassifier.js`/`planTemplate.js` moving to shared `prompts/chat/`, the **per-intent chat prompt bodies themselves are still fully duplicated** between `prompts/nano/chat/*.js` and `prompts/viva/chat/*.js` — 7 files each, structurally parallel (identical `dataSection`/`planSection` shape, identical anti-fabrication phrasing) but independently written: Nano bilingual with `isZh` branching and "Waven"/"Nano" branding, Viva pure-Chinese with "Aeviva"/"Viva" branding and Eastern-population framing sourced from `subAgeLabels.js`. If you're changing shared *structure* (e.g. adding a new data section to every intent prompt), you currently have to edit all 14 files, not 7.

## Dead / orphaned prompt files

Confirmed via a repo-wide grep for `require()` sites — none of the following are referenced anywhere:

- **`prompts/nano/systemChat.js`** and **`prompts/viva/systemChat.js`** — superseded by the intent-routed `prompts/{persona}/chat/*.js` files, never deleted. CLAUDE.md §16 still lists `systemChat.js` as the flagship prompt file — that's stale documentation, not just stale code.
- **`prompts/viva/systemHealthReport.js`** and **`prompts/viva/systemReport.js`** — no call site. `handlePostAnalyzeImage` (`handlers/chat.js`, vision-based lab-photo analysis) uses `nano/systemHealthReport.js` **unconditionally, regardless of persona**. `lib/reports/workflow.js`'s "NanoFirstReport" workflow uses `nano/systemReport.js` + `nano/systemNutrition.js` unconditionally too — and that workflow's own entry point (`runFirstReportWorkflow`, imported in `worker/index.js`) appears to have no caller anywhere in the current codebase, i.e. likely fully dead.
- **`prompts/strings.js`** — bilingual UI-string dict, no current `require()` site found.

If you're adding a persona-aware version of vision-report analysis, note that today it's Nano-only in practice (not by a deliberate `personaType` check — there simply is no Viva branch), and the `viva/systemHealthReport.js` file that looks like it should be the counterpart is unused.

## Intent → prompt-file routing table

`handlers/chat.js` defines two parallel maps with an identical key set:

```js
const nanoPrompts = {
  casual_chat: nano/chat/casual, biomarker_question: nano/chat/biomarker,
  nutrition_question: nano/chat/nutrition, longevity_science: nano/chat/science,
  record_action: nano/chat/record, set_reminder: nano/chat/reminder,
  emotional_support: nano/chat/emotional,
};
const vivaPrompts = { /* identical key set, viva/chat/* files */ };
```

```js
const activePrompts = personaType === 'viva' ? vivaPrompts : nanoPrompts;
const promptBuilder = activePrompts[intent] || activePrompts.casual_chat;
```

An unrecognized/unclassified intent (or an intent-classifier parse failure) falls back to `casual_chat` for whichever persona is active.

## Adding a third persona

Based on the current architecture, a new persona needs:

1. A new `prompts/<persona>/` directory with the 7 `chat/*.js` intent files, `systemDailyCheckin.js`, `systemFormulaGenerate.js`, `systemHealthAdvice.js`, `systemNutrition.js` (all requiring the shared `prompts/chat/factConstraint.js`/`factMemoryBlock.js`).
2. A third branch at every `personaType === 'viva' ? vivaX : nanoX` call site — there is currently no persona registry or lookup table; every one of these is a hardcoded binary ternary, not a `PROMPTS_BY_PERSONA[personaType]` map. Expect to touch `handlers/chat.js`, `handlers/dots.js`, and `checkin.js`.
3. `knowledge_entries` rows seeded with the new `persona_type` value (see [05-knowledge-base.md](05-knowledge-base.md)) — otherwise the new persona silently gets the hardcoded fallback essential-knowledge block and zero optional-knowledge matches, the same gap Nano currently has.
4. Decide whether the new persona needs its own `subAgeLabels.js`-equivalent override mechanism (currently Viva-only) or hardcodes dimension names like Nano does.
