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

---

# Appendix: the `CLAUDE.md` §27 record (moved here verbatim 2026-09-15)

The project-rules entry as it stood before being condensed; the rules that must hold are now
summarised in `CLAUDE.md`. Kept because it records decisions and live findings in the words they
were made in.

## 27. Personal Memory Facts — `user_memory_facts` (Dietary Restrictions, Allergies, Preferences, Goals)

Added 2026-07-29. Viva previously had no way to remember durable personal facts a user states in conversation ("I don't eat pork," "I'm allergic to shellfish"). This is distinct from `users.bio_data` (fixed onboarding checklist — height/weight/`health_conditions`) and from §26's `knowledge_entries` (persona-scoped curated *general* science KB, not user-specific facts). A `users.preferences JSONB` column already existed in the schema but was confirmed to have **zero read/write call sites anywhere in the codebase** — dead column, not reused here in favor of a real table with per-fact metadata (category, source, timestamps) the admin panel and coach app can list/edit/audit.

### Design: reuses the existing action-JSON mechanism, not a new one

The codebase already had a proven pattern for "the LLM detects an explicit statement, emits a trailing action JSON, the server parses/persists/strips it" — `record_weight` and `set_reminder`, both handled in `handlers/chat.js`'s `finalizeChatReply()`. This adds a third action, `remember_fact`, following the identical mechanism and the same risk-acceptance level (regex + fixed-enum validation only, no semantic/JUDGE verification — consistent with the existing two, not a new gap).

### Schema

`user_memory_facts` (migration `src/schemas/migration_user_memory_facts.sql`): `id`, `user_id` (FK, **not** persona-scoped — an allergy is true regardless of which persona the user talks to, intentionally diverging from `knowledge_entries`' persona scoping), `category` (fixed enum: `dietary_restriction`/`allergy`/`preference`/`goal`/`other`), `fact_zh`, `status` (`active`/`inactive`), `source` (`chat_extracted`/`admin_added`), `first_mentioned_at`, `last_mentioned_at`. A partial unique index on `(user_id, category, fact_zh) WHERE status='active'` powers an `ON CONFLICT ... DO UPDATE` upsert — a repeated exact restatement just bumps `last_mentioned_at` instead of creating a duplicate row. No fuzzy-dedup/contradiction-resolution ("vegetarian" superseding "no pork") — explicitly out of scope, left for manual cleanup via the CRUD UI.

### Extraction (write) — 5 templates, not all 7

New shared prompt block `prompts/viva/factMemoryBlock.js`'s `getFactMemoryBlock(existingFacts)` combines recall (lists known facts) + the extraction instruction (`{"action":"remember_fact","category":"...","fact":"..."}`) in one block, injected the same way `getFactConstraintBlock(context.essential_knowledge)` is — called right after it in each template. Wired into `chat/{casual,biomarker,nutrition,record,emotional}.js` (where personal facts realistically surface) plus `systemHealthAdvice.js`, `systemNutrition.js`, and `systemFormulaExplain.js` (report/formulation prompts — recall-only there, since those flows have no free-form user message to extract a *new* fact from). Deliberately excludes `chat/science.js` (pure science Q&A, low signal) and `chat/reminder.js` (scheduling, unrelated). Nano is out of scope for this pass; nothing in the table design blocks adding nano's equivalent templates later since the table isn't persona-scoped.

`finalizeChatReply()` gained a `remember_fact` regex-extract/`JSON.parse`/validate block (category checked against a fixed `Set`, never trusted blindly from the LLM — same principle as `record_weight`'s numeric bounds check) alongside the existing weight/reminder blocks, plus the upsert `INSERT ... ON CONFLICT`. `stripActionJson()` and the final reply-cleanup `.replace()` chain were both extended with the new pattern so it never leaks into the biomarker-grounding check or the user-visible reply (same rationale as the 2026-07-26 `set_reminder` strip fix).

### Recall (read) — always-fetched, not matched-on-request

Mirrors how `biomarkers`/`dots`/`health_twin` are unconditionally fetched every turn, not gated behind the intent classifier's `required_data` — an allergy needs to be visible regardless of intent. `fetches.user_facts` added to the existing `Promise.all` bundle in `handlePostChat`, plus separate fetches in `handlePostHealthAdvice` and `handlePostFormulaDots` (both `nutritionContext`/Phase-1 and `llmContext`/Phase-2, since ingredient-conflict awareness matters for the dot-count decision itself, not just the narrative explaining it).

### Admin/coach visibility

New `handlers/userFacts.js` (CRUD, mirrors `handlers/knowledge.js`'s shape but scoped by `user_id`), routed at `/api/user-facts[?openid=/coach_id=][/:id]` in `index.js` — follows the existing `?openid=`-scoped fan-out pattern the admin panel/coach app already use per-section (`/api/biomarkers?openid=`, `/api/health-reports?openid=`), rather than one big nested user-detail endpoint. `handleGetUserFacts` takes an optional `coachId` and enforces the same coarse ownership check `handleGetCoachUserChat` already does (`SELECT 1 FROM users WHERE user_id=$1 AND coach_id=$2`) — only when the caller supplies its own `coach_id`; the admin panel omits it and sees everyone.

- Admin panel: new "Facts" tab in `UserDetailModal` (`UsersTab.jsx`), lazy-fetched on tab click exactly like the existing `chat`/`plans` tabs, with a `UserFactModal` add/edit form (category select, status select, fact textarea).
- Coach app: new "Facts" tab in the client detail sheet (`pages/coach/coach.js`/`.wxml`), mirroring the existing Notes tab's compose-area pattern (category `<picker>` + textarea + save button, list with delete).

### Files

New: `src/schemas/migration_user_memory_facts.sql`, `src/functions/worker/prompts/viva/factMemoryBlock.js`, `src/functions/worker/handlers/userFacts.js`. Modified: `handlers/chat.js` (`remember_fact` action parsing/upsert in `finalizeChatReply()`, `user_facts` fetch + `llmContext` field in `handlePostChat`/`handlePostHealthAdvice`), `handlers/dots.js` (same in `handlePostFormulaDots`), `prompts/viva/{systemHealthAdvice,systemNutrition,systemFormulaExplain}.js` + `chat/{casual,biomarker,nutrition,record,emotional}.js` (one `getFactMemoryBlock()` call site each), `index.js` (`/user-facts` routes), `src/web/admin-panel/src/tabs/UsersTab.jsx` (Facts tab + `UserFactModal`), `src/mini/nano-miniapp/pages/coach/{coach.js,coach.wxml}` (Facts tab, `utils/config.js` VERSION bump).

### Follow-up (2026-07-29): real-user bug report — Viva replied with an unrelated bioage/dots recap instead of acknowledging a stated food preference

Found via a live dev report (user "Pin", channel `aeviva`): stating "我吃素，也吃鸡蛋和牛奶" (a food preference) got back a completely unrelated ~200-word BioAge/dot-formulation summary. Root-caused via direct log inspection (`s worker logs`) and local reproduction (`handlePostChat({...}, {sandbox:true})` run directly against the dev DB, bypassing FC/EventBridge to iterate fast) — **three separate, compounding bugs**, all in code shipped earlier the same day as part of §27:

1. **JUDGE had no visibility into the current user message.** `judgeTemplate.js` only received pre-fetched DB ground truth (`llmContext` + fresh biomarkers/dots + `tool_calls_made`) — never the raw `message` the user just sent. A `remember_fact` action recording a fact for the very first time is, by definition, not yet in `user_facts` (that only reflects facts saved from *prior* turns), so JUDGE flagged the model's correct acknowledgment of what the user just said as an unsupported `biomarker_mismatch`/fabrication and forced a REVISE cycle. **Fix:** `judgeTemplate.js` now takes a `message` param and is told explicitly that content merely restating the user's own current message (including a `remember_fact` tail) is self-evidently grounded, not a claim requiring a database record. `planTemplate.js` got a parallel one-line clarification (PLAN was separately flagging self-reported diet facts as needing knowledge-base "evidence_level" backing, which they don't).
2. **A REVISE-round completion could ship as a blank reply.** When forced into an unnecessary REVISE cycle by bug #1, the model sometimes complied with "remove the unsupported claim" so literally that its rewritten completion was *only* the corrected `remember_fact` JSON tail with no prose — `finalizeChatReply()`'s action-stripping `.replace()` chain then removed everything, shipping an empty string. **Fix:** the stripped result now falls back to an acknowledgment referencing the actual recorded fact (`好的，已记录：<fact>`) rather than ever shipping blank — the fact text is already validated (fixed-enum category) by that point, so it's safe to echo back. `agenticChat.js`'s REVISE correction prompt also now explicitly forbids a bare-JSON-only rewrite, to reduce how often the fallback is needed at all.
3. **`chat/nutrition.js` was missing the "answer what was actually asked" guardrail `chat/biomarker.js` already had.** Even after fixing #1, GENERATE would still sometimes default to a generic BioAge/dots status recap for `nutrition_question` regardless of the actual message — and since that canned content is factually accurate, JUDGE has no basis to flag it (JUDGE checks facts, not relevance/topicality, so a correct-but-irrelevant answer passes clean). **Fix:** added the same "directly address the user's specific message first; don't default to a generic status overview unless one was actually requested" rule `chat/biomarker.js` already carried, to `chat/nutrition.js`.

A fourth, smaller issue was also caught and fixed along the way: on a long/complex ground-truth payload, JUDGE would occasionally reason its own way to "no real issue found" in its analysis text but still emit a structured `REJECT` (a JSON self-consistency failure, not specific to this feature) — `runJudge()` in `agenticChat.js` now downgrades a `REJECT` to `PASS` when every violation's `correction_hint` comes back empty (a real violation always names a concrete fix; an empty hint is the reliable signal that the judge itself found nothing fixable).

**Verified via repeated local trials** (`sandbox:true` runs against dev, bypassing async delivery for fast iteration): before these fixes the canned-recap failure reproduced consistently; after, the large majority of trials correctly acknowledge the stated fact, with the fallback text (`好的，已记录：...`) as an honest, on-topic minimum whenever GENERATE still doesn't produce full prose. **Known residual risk, explicitly out of scope for this pass:** JUDGE is separately prone to rejecting on purely cosmetic wording differences (e.g. "41.0岁" vs "41岁", "已验证" vs "validated") — a pre-existing, systemic over-strictness issue affecting the whole agentic loop, not specific to personal facts, and too large a retuning to take on as part of a targeted bug fix. Revisit if this keeps surfacing as user-visible unnecessary REVISE churn.


