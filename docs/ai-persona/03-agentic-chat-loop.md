# The Agentic Chat Loop: PLAN → GENERATE → JUDGE → REVISE

**File:** `src/functions/worker/lib/agenticChat.js`, entry point `runAgenticTurn()`.

This is the mechanism behind any chat reply that touches health data closely enough that a fabricated or ungrounded claim would actually matter — biomarker values, nutrition/dot recommendations, longevity-science claims, or logging a health record on the user's behalf. It replaces a single LLM completion with a 4-stage pipeline that plans what it intends to claim, generates a draft with tool access to real data, has a second model grade the draft against ground truth, and revises if it fails.

## Who runs the loop

```js
const HIGH_RISK_INTENTS = new Set(['biomarker_question', 'nutrition_question', 'longevity_science', 'record_action']);
const useAgenticLoop = HIGH_RISK_INTENTS.has(intent);
```

This is **persona-agnostic** as of the current refactor — both Nano and Viva run the identical loop for these 4 intents. (CLAUDE.md's §21 still describes this as Viva-only; see [09-known-issues.md](09-known-issues.md).) `casual_chat`, `emotional_support`, and `set_reminder` never use it, for either persona.

Two other call sites also force it unconditionally, regardless of intent or persona:
- `handlePostHealthAdvice` (the dedicated "Health Advice" tool/button) — `useAgenticLoop = true` always.
- `handlePostFormulaDots` → `_handleFormulaDotsAgentic` — always agentic, for both personas (see [08-formula-dots-and-reports.md](08-formula-dots-and-reports.md)).

## Stage 1 — PLAN

One LLM call, `temperature: 0.1`, using `prompts/chat/planTemplate.js` (deliberately English and persona-agnostic — this is internal reasoning, never shown to the user). Produces:

```json
{ "intended_claims": [...], "tools_needed": [...], "risk_notes": "..." }
```

Immediately after, `validatePlan()` runs a **zero-LLM-cost, deterministic** check on those intended claims:
- Any `dot_recommendation` claim referencing a `ref_id` not present in the real dots formulary.
- Any `dimension_reference` outside the 4 real dimensions: `CellularAge`, `MetabolicAge`, `MicroVascularAge`, `ResilienceAge`.

Violations here don't block generation — they're folded into GENERATE's system prompt as a `【PLAN CHECK】` warning block, so the model sees its own plan flagged before it starts writing prose.

## Stage 2 — GENERATE

Up to `GENERATE_MAX_ITERS = 3` tool-calling iterations, `temperature: 0.3`. Uses `AGENTIC_TOOL_DEFS` / `createAgenticToolHandlers` from `lib/agenticTools.js` — 11 dedicated, typed, read-only tools, one per data domain:

`get_biomarkers`, `get_biomarker_history`, `get_dots`, `get_health_plan`, `get_formulation_packages`, `get_health_reports`, `get_questionnaire_responses`, `get_weight_history`, `get_health_twin`, `get_nutrition_schedule`, `get_reminders`

None of these tool handlers branch on persona internally — the tool layer itself is fully persona-generic (the file's own header comment still says "for the Viva agentic chat loop," which is stale — see [09-known-issues.md](09-known-issues.md)). Every tool call is logged into `toolCallLog`, consulted later by JUDGE and by `extractToolGroundTruth`.

## Stage 3 — JUDGE

One LLM call, `temperature: 0.1`, `runJudge()`, using `prompts/viva/judgeTemplate.js` — note this file still physically lives under `viva/` but is required unconditionally for **both** personas; it's a stale file location, not a Viva-only mechanism.

JUDGE grades the GENERATE draft against:
- PLAN's `intended_claims`
- **Freshly re-fetched** `biomarkers`/`dots` (not the GENERATE-time snapshot — this catches drift if something changed mid-conversation)
- The complete `tool_calls_made` log — a claim matching any tool result is considered grounded even if it doesn't appear in the fresh biomarkers/dots re-fetch
- Matched knowledge-base excerpts (`findRelevantEntries`, see [05-knowledge-base.md](05-knowledge-base.md))
- `detectAllRisks()` hits from `factCheck.js` (see [04-fact-checking-and-memory.md](04-fact-checking-and-memory.md)), passed in as pre-flags

Returns:

```json
{ "verdict": "PASS" | "REJECT", "violations": [{ "category": "...", "detail": "...", "correction_hint": "..." }] }
```

Two defensive behaviors are deliberately baked in:
- **Fails open to PASS** if the judge call itself fails or returns unparseable output — a broken judge should never block a reply outright.
- **Self-contradiction downgrade**: a `REJECT` with every violation's `correction_hint` left empty gets downgraded to `PASS` — this catches the judge model reasoning its way to "actually there's no real issue here" but still emitting `REJECT` out of habit.

## Stage 4 — REVISE + RE-JUDGE

Up to `REVISE_MAX_ROUNDS = 2`. Each round:
1. One correction-retry completion (`temperature: 0.2`) built from the violations' `detail`/`correction_hint`, explicitly instructed to preserve the same language/tone/structure and never ship a bare action-JSON with no surrounding prose.
2. Re-judge.

Stops early on the first `PASS`. If it still `REJECT`s after the final round, the latest revision ships anyway — the loop always terminates with *a* reply, never a hard failure back to the user.

## Output

```js
{ reply, extraValidDates, extraValidValues }
```

The latter two come from `extractToolGroundTruth(toolCallLog)`, which harvests every date-shaped field and every historical numeric biomarker value the tool loop actually fetched during GENERATE. This feeds back into `handlers/chat.js`'s `verifyBiomarkerGrounding()` so a factually-correct historical answer (e.g. "you've had 63 tests total") isn't misflagged as fabrication just because it isn't the single latest snapshot value.

## Cost / observability

`budget = { plan, generateIters, judge, revise, rejudge }` is logged as `turn_budget_used` on every call. Typical cost is ~4 LLM calls (PLAN + 1 GENERATE iteration + JUDGE + nothing else); worst case is ~11 (PLAN + 3 GENERATE iterations + JUDGE + 2×(REVISE + re-JUDGE)).

## Intent → prompt-file selection is separate from this loop

The loop itself doesn't pick which `prompts/{persona}/chat/*.js` file to use — that routing happens in `handlers/chat.js` before `runAgenticTurn()` is ever called, and is what actually differs between Nano and Viva for a given turn. See [02-prompt-architecture.md](02-prompt-architecture.md)'s routing table and [06-chat-pipeline.md](06-chat-pipeline.md) for how the two connect.
