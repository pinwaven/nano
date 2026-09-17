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

---

# Appendix: the `CLAUDE.md` §21 record (moved here verbatim 2026-09-15)

The project-rules entry as it stood before being condensed; the rules that must hold are now
summarised in `CLAUDE.md`. Kept because it records decisions and live findings in the words they
were made in.

## 21. Agentic Plan→Generate→Judge→Revise Loop (High-Risk Intents, Shared by Both Personas)

Added 2026-07-28, originally Viva-only, **genericized to both personas by the 2026-08 persona-unification refactor** (see §16's note). Applies when the classified intent is in `HIGH_RISK_INTENTS` (`biomarker_question`, `nutrition_question`, `longevity_science`, `record_action`) — gated in `handlers/chat.js` via `useAgenticLoop = HIGH_RISK_INTENTS.has(intent)`, independent of `personaType`. Nano's and Viva's `casual_chat`/`emotional_support` are unaffected and take the pre-existing code path, for both personas.

### Flow

For the gated case, `handlers/chat.js` delegates to `runAgenticTurn()` (`lib/agenticChat.js`) instead of the classic 4-iteration `query_database` tool loop:

1. **PLAN** (1 LLM call, `prompts/chat/planTemplate.js`) — produces a structured `intended_claims` list *before* any prose is written.
2. **Plan validation** (deterministic, 0 LLM calls) — cross-checks dot/dimension references in the plan against real data; mismatches become an extra instruction folded into the GENERATE system prompt rather than blocking generation outright.
3. **GENERATE** (up to 3 tool-calling iterations) — uses dedicated per-domain read tools (`lib/agenticTools.js`: `get_biomarkers`, `get_biomarker_history`, `get_dots`, `get_health_plan`, `get_formulation_packages`, `get_health_reports`, `get_questionnaire_responses`, `get_weight_history`, `get_health_twin`, `get_nutrition_schedule`, `get_reminders`) instead of the generic `query_database` SQL tool. Each tool is a fixed, typed wrapper — never raw model-authored SQL — and biomarker-shaped data always comes from `data.validated`, never `data.actual` (per §17). `get_biomarker_history`/`get_health_reports` were added 2026-07-28 after live testing showed the original tool set (mirroring the pre-fetch context) had no way to answer questions like "how many Kino tests have I done" or "how many doses of a dot do I have left" — data that existed in `biomarkers`/`user_cartridges`/`health_reports` but was reachable by nothing, causing Viva to correctly but unhelpfully fall back to "not enough information." `health_events` (raw wearable ingestion log) was deliberately left unexposed — `health_twin`'s rolling averages/trend_data already summarize it cleanly, and dumping its heterogeneous per-category JSONB into a tool would add hallucination surface rather than reduce it.
4. **JUDGE** (1 LLM call, `prompts/viva/judgeTemplate.js`) — grades the draft against the plan; the full pre-fetched `llmContext` GENERATE's system prompt was itself built from (health_twin, questionnaire_context, active_health_plans, user_profile, plan, ...), with `biomarkers`/`dots` overridden by a fresh re-fetch (not the GENERATE-time snapshot, so drift is still caught for those two specifically); `tool_calls_made`, the complete list of every tool call GENERATE actually made with its real result; the curated knowledge base (below); and `factCheck.js`'s existing detectors (via the shared `detectAllRisks` export). Both the `llmContext` spread and `tool_calls_made` were added 2026-07-28 after live testing found the same bug twice — first narrowly (JUDGE couldn't verify `get_biomarker_history`'s test count, only `get_biomarkers`/`get_dots`), then broadly (JUDGE had no visibility into `llmContext` at all, so a correct wearable-data analysis sourced straight from the pre-fetched `health_twin` got fully stripped out as "unsupported" across 2 revise rounds). The fix generalizes to the whole context rather than patching each data source one at a time.
5. **REVISE + RE-JUDGE** — on REJECT, up to 2 correction-retry + re-check rounds (`REVISE_MAX_ROUNDS`), stopping early the moment a re-judge PASSes; ships the latest revision regardless if it still REJECTs after the last round. Widened from 1 to 2 rounds on 2026-07-28 after live dev testing showed a single revise pass sometimes left residual violations unfixed on multi-violation drafts. Never loops past this bound.
6. `verifyBiomarkerGrounding` still runs unconditionally afterward for every intent/persona (unchanged, orthogonal check: numeric drift vs. science/catalog fabrication) — for the agentic branch it also receives `extraValidDates`/`extraValidValues`, extracted from every tool call GENERATE actually made (`extractToolGroundTruth()` in `lib/agenticChat.js`). Without this, any legitimate historical date/value surfaced via `get_biomarker_history` (or the other history-shaped tools) gets misflagged as a fabrication — it only ever compared against the single latest snapshot — and gets silently rewritten away. Found and fixed via live dev testing 2026-07-28 (a correct "63 past tests" answer citing real historical dates/values was rewritten twice before this fix). Empty for the non-agentic path, which has no tool history to draw from, so its behavior is unchanged.
7. `_regenerateIfFabricationRisk` is **superseded** for this branch only (JUDGE subsumes it) — guarded with `!useAgenticLoop` at its call site; still runs as before for `casual_chat`/`emotional_support`. Note this retry itself remains gated `personaType === 'viva' && !useAgenticLoop` — a genuine, still-open asymmetry (Nano's non-agentic intents get no equivalent retry), not doc drift; see §16's persona-unification note.

Hard per-turn ceilings: plan 1, generate ≤3, judge 1, revise ≤2, re-judge ≤2 — logged as `turn_budget_used` for tuning. Typical-case cost (~4 calls) is roughly today's worst case; worst-case cost (~11 calls) is not user-latency-sensitive because the production (non-`sandbox`) path never returns synchronously — replies are delivered via the `notifications` polling mechanism regardless. Only `sandbox: true` (admin "login as" preview) is latency-sensitive to this change.

**Correction (2026-07-28):** the previous paragraph's claim that the production path "never returns synchronously" was aspirational, not actually true, until §22 below shipped — `handlePostChat` originally awaited the entire agentic loop inline within the HTTP request/response cycle regardless of sandbox, and Aliyun FC cancels the invocation the moment the client disconnects, so a client-side timeout genuinely destroyed in-progress work rather than just delaying it. See §22 for the actual fix.

### Curated knowledge base

`prompts/viva/knowledge/` (`tcmGeneVariants.js`, `nutritionProtocols.js`, `longevityScience.js`, merged by `index.js`) is the ground truth PLAN/JUDGE check Viva's science/TCM/protocol claims against — the one hallucination surface `factCheck.js` never covered (it only validates biomarker numbers and dot names/ingredients). Matching is a cheap in-process keyword/tag substring check (`findRelevantEntries()`), not embeddings/RAG — none exists in this codebase. Zero KB matches is not a failure signal; JUDGE falls back to `factConstraint.js`'s general rules + detector hits alone in that case. Seeded from claims already shipping as static prose in `systemChat.js`/`chat/science.js` (already implicitly product-approved). **Open question, not yet resolved:** who authors/vets *new* KB entries beyond the seed set — a product/clinical decision, recommended to require a named reviewer via normal PR review once someone is assigned.


