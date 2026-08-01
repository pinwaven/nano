# Fact-Checking & Personal Memory

Two related but distinct systems: a deterministic, regex-based fabrication detector that runs on LLM *output*, and a prompt-injected block that tells the LLM what it's *allowed* to claim and what it already knows about a specific user.

## `factCheck.js` — deterministic output-side backstop

**File:** `src/functions/worker/lib/factCheck.js`. Pure pattern matching, **no LLM call**, fully persona-agnostic (no persona branching anywhere in the module).

Pattern detectors (`PATTERNS`): `pValue`, `geneRsId`, `cohortMention`, `fakeInstitution`, `journalYearCitation`, `bookTitleCitation`, `fakeDimensionValue`, `knownExternalIngredient`.

Function-based detectors:
- `hasStandaloneDosage()` — flags an mg dosage not attributed to a named Dot on the same line, distinguishing fabricated external-supplement dosing from legitimate whole-food gram amounts or biomarker mg/L units.
- `hasFakeDimensionAssertion()` — catches asserting a nonexistent age dimension (e.g. "排毒年龄"/"detox age") even without a numeric value attached.
- `detectDotNameMismatch()` / `detectDotIngredientMismatch()` / `detectFakeProductName()` — cross-check any `"X号原粒..."` or `"DOT-NX(...)"` reference against the real dots formulary passed in.

`detectAllRisks(reply, dotsFormulary)` aggregates all of the above, and is shared by exactly two call sites:
1. `_regenerateIfFabricationRisk` (the classic single-retry path, described below).
2. JUDGE, inside the agentic loop (see [03-agentic-chat-loop.md](03-agentic-chat-loop.md)) — as pre-flags the judge model is shown.

## Two layers of retry, and one deliberate remaining asymmetry

### 1. `_regenerateIfFabricationRisk` — Viva-only, non-agentic path

`handlers/chat.js`'s `finalizeChatReply`, gated:

```js
if (personaType === 'viva' && !useAgenticLoop) { /* one retry */ }
```

One retry only. The correction prompt (`_buildCorrectionPrompt`) is built dynamically from *which* risk categories fired, mapping risk names to Chinese correction instructions via `_CITATION_RISKS` / `_INGREDIENT_RISKS` / `_DIMENSION_RISKS` / `_NAME_RISKS` sets.

**This is still persona-gated in the current code**, unlike almost everything else in this system — the uncommitted refactor did not touch this condition. The practical effect: **Nano's non-agentic intents (`casual_chat`, `emotional_support`, `set_reminder`) get zero fabrication-risk retry**, for any persona, since Viva's own non-agentic intents are the same three and the gate requires both `personaType === 'viva'` and `!useAgenticLoop`. Nano never satisfies the first half. This appears to be a deliberate scope decision rather than an oversight (it wasn't touched while genericizing everything else), but it's worth confirming before assuming it should be extended to Nano — a fabrication risk on `casual_chat`/`emotional_support` is inherently lower-stakes than on the 4 `HIGH_RISK_INTENTS`, which both personas already cover via JUDGE.

### 2. JUDGE inside the agentic loop

Supersedes #1 whenever `useAgenticLoop === true` — i.e. for both personas, on all 4 high-risk intents. See [03-agentic-chat-loop.md](03-agentic-chat-loop.md).

### Separately: `verifyBiomarkerGrounding()`

Always runs, regardless of persona or intent. Extracts biomarker-value/date/age mentions from the reply text and cross-checks them against ground truth (`llmContext.biomarkers` plus `extraValidDates`/`extraValidValues` harvested from the agentic loop's own tool-call history, when available). One retry on mismatch.

## The fact-constraint prompt block

**File:** `prompts/chat/factConstraint.js` — `getFactConstraintBlock(preloaded, isZh = true)`.

Returns `preloaded` (the DB-fetched `essential_knowledge` string from `getEssentialBlock`, see [05-knowledge-base.md](05-knowledge-base.md)) if present, else a hardcoded `FALLBACK_ZH`/`FALLBACK_EN` string. Injected as the **first block** of nearly every prompt template, for both personas:

```js
${getFactConstraintBlock(ctx.essential_knowledge, isZh)}
```

Content: bans fabricated study names, journals, p-values, gene loci, allele frequencies, and institution names; restricts evidence claims to 4 canonical evidence-level phrases; bans company-logistics fabrication; restricts the model to the 4 real BioAge dimensions; enforces "Dots-only, no outside purchases" and "copy Dot names/ingredients verbatim, never from memory."

## The personal-memory block

**File:** `prompts/chat/factMemoryBlock.js` — `getFactMemoryBlock(existingFacts, isZh = true)`.

Combines two things in one prompt block: a bulleted recall of known facts about this specific user, and the `remember_fact` extraction-instruction contract the model uses to record new ones:

```json
{ "action": "remember_fact", "category": "...", "fact": "..." }
```

Parsing and persistence happen in `finalizeChatReply()`: regex-extract the trailing action JSON → `JSON.parse` → validate `category` against a fixed set (`dietary_restriction | allergy | preference | goal | other`) → upsert into `user_memory_facts`:

```sql
INSERT INTO user_memory_facts (...)
VALUES (...)
ON CONFLICT (user_id, category, fact_zh) WHERE status = 'active'
DO UPDATE SET last_mentioned_at = ...
```

**`user_memory_facts` is not persona-scoped** — an allergy or dietary restriction is true regardless of which persona the user happens to be talking to. This is a deliberate divergence from `knowledge_entries` (which *is* persona-scoped) and from `chat_messages` (also persona-scoped) — memory facts about the user are shared, conversation history and reference knowledge are not.
