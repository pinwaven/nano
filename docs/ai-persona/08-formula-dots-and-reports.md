# Formula/Dots Generation & Reports

## Formula/Dots generation — now a shared engine

**File:** `src/functions/worker/handlers/dots.js`.

`handlePostFormulaDots` resolves `personaType`, computes `currentSolarTerm`/`essentialKnowledge` unconditionally (previously Viva-gated), then calls `_handleFormulaDotsAgentic` — **renamed from `_handleFormulaDotsViva`** — for both personas. It:

1. Inserts a `'pending'` `nutrition_plans` row.
2. Builds the shared `llmContext` (same shape `handlePostChat` produces).
3. Selects `personaType === 'viva' ? vivaSystemFormulaGenerateTemplate : systemFormulaGenerateTemplate` — both now require the shared `prompts/chat/factConstraint.js`/`factMemoryBlock.js`.
4. Publishes a `chat.generate` CloudEvent with `kind: 'formula_dots_generate'` (see [06-chat-pipeline.md](06-chat-pipeline.md) for the async delivery mechanism this reuses).
5. On EventBridge publish failure, fails open to `_runDeterministicFormulation` + `_commitNutritionPlan`, committed synchronously.

`prompts/nano/systemFormulaGenerate.js` (new) is a near line-for-line structural mirror of `prompts/viva/systemFormulaGenerate.js` — same AM/PM 30%-split balancing rule, same per-dot min/max range enforcement, same output contract (`{"action":"formulate_dots","formulation":[...]}`), differing only in bilingual (`isZh`) branching and "Nano/Waven" vs "Viva/Aeviva" branding. Its own doc-comment states the two personas "now share the agentic engine and differ only in prompt wording... plus `knowledge_entries` rows" — see [05-knowledge-base.md](05-knowledge-base.md) for why that second part is currently a gap for Nano specifically.

`finalizeFormulaDotsGenerate()` (in `handlers/chat.js`, the shared finisher for the `formula_dots_generate` async event) extracts the trailing `{"action":"formulate_dots",...}` JSON via a brace-depth scan (`_extractTrailingJson` — needed because this action's payload nests arrays/objects, unlike the flat `record_weight`/`set_reminder`/`remember_fact` actions), clamps every Dot's `morning + evening` total into its real `target_dots_min/max`, fills any omitted Dot with a deterministic per-Dot fallback (`_fallbackCountForDot`), and commits via `_commitNutritionPlan`.

`_runDeterministicFormulation` — the original single-shot, non-agentic formulator — is now purely a **fallback**, used when the agentic publish or turn fails, for either persona. (Previously this was Nano's *only* path and Viva's fallback; the roles have effectively reversed — the agentic path is now primary for both.) It selects `personaType === 'viva' ? vivaSystemNutritionTemplate : systemNutritionTemplate`.

## Health-plan-focus-linked formulation weighting

A user's active `health_plans` row(s) (primary + secondary, both joined in `_handleFormulaDotsAgentic`'s `activePlansResult` query, `handlers/dots.js`) carry `recommended_dot_ids` — sourced from `health_plan_templates.recommended_dot_ids`, a column that already existed before this pass but was never previously read by the formulation code. Both formulation paths now factor it in as a **soft, non-exclusionary weighting hint**: recommended dots skew toward the higher end of their own `target_dots_min/max` range, but no dot is ever forced to 0 just for being off the list — a real biomarker need outside the chosen focus must still be able to surface.

- **Deterministic fallback path** — `_fallbackCountForDot(dot, isRecommended)` (`handlers/dots.js`) gained a third state. Previously it always fell back to the plain midpoint of a dot's own min/max when the LLM's `FORMULATION:` output omitted a key; now `isRecommended === true` biases toward 75% of the range (`min + (max - min) * 0.75`), `isRecommended === false` (a focus is active but this dot isn't on its recommended list) biases toward 25%, and `isRecommended === undefined` (no active focus at all) keeps the original unbiased midpoint. `_resolveCandidateDotKeys(activeHealthPlans, dotsFormulary)` resolves the union of `recommended_dot_ids` across all active health plans into a `Set` of dot `key_name`s — or `null` when no active focus has any recommended dots, meaning "no narrowing" (today's full-18-dot default), not "recommend nothing." It's the shared input `_runDeterministicFormulation` and the new `handleNutritionTopupEvent` (see [09-known-issues.md](09-known-issues.md)) both pass through.
- **Agentic prompt path** — both `prompts/nano/systemFormulaGenerate.js` and `prompts/viva/systemFormulaGenerate.js` independently build a `focusWeightingSection` from the same `recommended_dot_ids` union (resolved inline, `dots.id` → `key_name`, `DOT` prefix rewritten to `D` to match the formulary's short-key convention), rendered as an explicit instruction: skew the listed dots toward the higher end of their range; never force any other dot to 0 just for being off the list; if a biomarker is clearly abnormal but its dot isn't recommended, still assign it a reasonable dose. Nano's version is bilingual (`isZh` branch, injected into both the `taskZh`/`taskEn` templates); Viva's is Chinese-only, matching each file's existing convention.

`_commitNutritionPlan` also now persists `primary_health_plan_id`/`secondary_health_plan_id` onto the `nutrition_plans` row itself (both the update-from-`pending` branch and the fresh-insert branch), resolved from `activeHealthPlans` by matching `plan_type`. So which focus(es) actually drove a given formulation is now recorded on the plan row, not just implied by whichever `health_plans` happened to be active at generation time.

## Reports

- **Vision/photo lab-report analysis** (`handlePostAnalyzeImage`) always uses `nano/systemHealthReport.js`, regardless of persona — there is no persona check here at all, just a single hardcoded call site. `viva/systemHealthReport.js` exists but has no caller anywhere (see [02-prompt-architecture.md](02-prompt-architecture.md)).
- **The "NanoFirstReport" workflow** (`lib/reports/workflow.js`) always uses `nano/systemReport.js` + `nano/systemNutrition.js`, regardless of persona. Its entry point (`runFirstReportWorkflow`, imported in `worker/index.js`) appears to have no caller anywhere in the current codebase — likely dead/vestigial, worth confirming before relying on it for anything persona-related.
- **`systemAdminReport.js`** is shared and persona-agnostic — it's the admin-facing report generator (`handlers/reports.js`), unrelated to end-user persona at all.

## Onboarding

No persona-specific onboarding logic was found in `resolveOrUpsertUser` (`handlers/chat.js`) — it doesn't branch on persona. If you're looking for persona-differentiated onboarding, it likely doesn't exist yet; check `handlers/questionnaires.js` / `handlers/coaches.js` if this becomes relevant, as those weren't covered in this pass.

## Sub-age display-name customization

`prompts/viva/subAgeLabels.js`'s `getVivaLabels(sub_age_display_names)` lets a channel override the 4 dimension names' Chinese labels via `channels.config.sub_age_display_names` (threaded through as `channelSubAgeNames`). **This is Viva-only** — Nano's prompt files hardcode English/Chinese dimension names inline, with no equivalent override mechanism found. If a Nano channel needs custom dimension labels, that capability doesn't exist today.
