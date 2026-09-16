# Knowledge Base

**File:** `src/functions/worker/lib/knowledgeBase.js`. Backed by the `knowledge_entries` DB table (`src/schemas/migration_knowledge_entries.sql`), editable via the admin panel's Knowledge tab (`handlers/knowledge.js` + `KnowledgeTab.jsx`).

## Two access functions

- **`getEssentialBlock(personaType)`** — `SELECT content_zh FROM knowledge_entries WHERE persona_type = $1 AND tier = 'essential' AND status = 'active' ORDER BY sort_order, id`, rows joined with `\n\n`. Falls back to a hardcoded `FALLBACK_ESSENTIAL_BLOCK` constant on DB error **or on zero matching rows**. This return value is what gets threaded into `getFactConstraintBlock()`'s `preloaded` argument (see [04-fact-checking-and-memory.md](04-fact-checking-and-memory.md)).
- **`findRelevantEntries(personaType, text, limit = 8)`** — fetches all active `tier = 'optional'` rows for the persona, then does an **in-process substring/tag match** (`entry.topic.some(tag => text.includes(tag))`). No RAG, no embeddings — this is a deliberate design choice per the module's own doc-comment, not a missing feature.

Both are called with a `personaType` that must match what's stored in `knowledge_entries.persona_type` exactly.

## The Nano-seeding gap

`persona_type TEXT NOT NULL DEFAULT 'viva'` — and **every seed `INSERT` in the migration relies on that column default**, meaning every row ever seeded has `persona_type = 'viva'`. No other migration touches this table. There is currently no `persona_type = 'nano'` row in the schema at all.

**Practical consequence: `getEssentialBlock('nano')` and `findRelevantEntries('nano', ...)` return zero rows on every single call, today.** This isn't a hypothetical edge case — it's the live, permanent state for Nano until someone adds rows via the admin panel:

- Nano's fact-constraint block always falls through to the hardcoded `FALLBACK_ESSENTIAL_BLOCK` (which is itself worded generically — "Dots," not "原粒" — so it doesn't read as obviously Viva-specific, but it also can't carry any Nano-specific curated knowledge).
- Nano's PLAN and JUDGE stages in the agentic loop always see an empty/`(none matched)` optional-knowledge excerpt list, since `findRelevantEntries('nano', ...)` never has anything to match against.

If you're doing anything that depends on Nano having curated domain knowledge beyond the hardcoded fallback — a new health claim category, a Nano-specific caveat, anything an admin would otherwise edit via the Knowledge tab — it will silently do nothing until `persona_type = 'nano'` rows are seeded. This is worth fixing (or at minimum flagging to whoever owns the Nano persona) rather than assuming parity with Viva just because the code path is shared.

## Admin editability

Full CRUD via the admin panel. `status = 'active'` requires a non-null `reviewed_by` — draft/unreviewed entries never reach `getEssentialBlock`/`findRelevantEntries` regardless of persona.

## Real-usage content gap

The 14 rows seeded by the migration (1 essential + 13 optional TCM-gene-variant/nutrition-protocol/longevity-science facts) don't cover what users actually ask about in prod — see [10-knowledge-entries-draft-aeviva.md](10-knowledge-entries-draft-aeviva.md) for ~25 candidate rows drafted from a real sample of 1,470 Viva/aeviva prod chat messages, covering biomarker/sub-age reference questions, food-compatibility rules, TCM practice questions, and several chronic-condition entries that need clinical review before activation. Proposal only — none of it is inserted yet.

---

# Appendix: the `CLAUDE.md` §26 record (moved here verbatim 2026-09-15)

The project-rules entry as it stood before being condensed; the rules that must hold are now
summarised in `CLAUDE.md`. Kept because it records decisions and live findings in the words they
were made in.

## 26. Knowledge Base Moved to DB — `knowledge_entries` (Essential + Optional Tiers)

Added 2026-07-29. Viva's two static, code-only knowledge layers (§21) — the always-injected `factConstraint.js` guardrail block and the 13-entry, keyword-matched-on-request curated KB (`prompts/viva/knowledge/*.js`) — are now backed by a single DB table, `knowledge_entries`, editable from the web admin panel without a deploy. This also resolves §21's open question about who vets new KB entries: `reviewed_by` is now a real, enforced field (an entry cannot be set to `status='active'` without one), not a hardcoded `'placeholder'`.

### Why one table, not two

Essential and optional entries share an identical shape (id, content, evidence/review-tracking) and differ only in which consumption path reads them — a `tier` column (`'essential' | 'optional'`) does this split within one table, the same way `kino_chip_models.status` already splits active/inactive without a second table. `persona_type` (default `'viva'`) is included from the start even though only Viva populates it today, so Nano could plug into the same table later with zero schema change.

### Schema

`knowledge_entries` (migration `src/schemas/migration_knowledge_entries.sql`): `id` (PK, lowercase kebab-case slug), `persona_type`, `tier`, `category`, `topic` (`TEXT[]`, tag list — unused for essential rows), `content_zh`, `evidence_level` (optional-tier only), `status` (`active`/`inactive`), `sort_order` (essential-row concatenation order), `last_reviewed`, `reviewed_by`, `created_at`/`updated_at`. Seeded once with the prior static content: the 13 optional entries (unchanged content, `category` set per source file) plus one essential row (`id='fact-constraint-core'`, `content_zh` = factConstraint.js's original guardrail text verbatim).

### Loading layer — `lib/knowledgeBase.js`

Replaces the static `require()`-based merge:
- `getEssentialBlock(personaType)` — `SELECT content_zh ... WHERE tier='essential' AND status='active' ORDER BY sort_order, id`, joined with `\n\n`. On any DB error, or if the table has zero matching rows, falls back to `FALLBACK_ESSENTIAL_BLOCK` — a hardcoded copy of the original guardrail text kept in code for exactly this case, so a transient DB error can never ship a Viva reply with zero anti-hallucination guardrails.
- `findRelevantEntries(personaType, text, limit=8)` — fetches all active optional-tier rows for the persona, then runs the **exact same in-process substring/tag match** `findRelevantEntries` always used (`entry.topic.some(tag => text.includes(tag))`) — only the source of the entry list changed from `require()` to a query. Still no RAG/embeddings, per the existing by-design constraint.
- No caching: the table is small (~15 rows today) and each function runs at most once or twice per chat turn, negligible next to the LLM call latency it sits beside. Add a TTL cache later only if this is ever shown to matter.

### Call-site plumbing — fetched once per request, not re-fetched per template

`factConstraint.js`'s `getFactConstraintBlock()` is called inline inside a template literal in 12 Viva prompt files, all synchronous. Rather than making all 12 async, each handler (`handlers/chat.js`'s `handlePostChat`/`handlePostHealthAdvice`, `handlers/dots.js`'s `handlePostFormulaDots`) fetches `essentialKnowledge` once via `await getEssentialBlock('viva')` right where it already resolves `personaType`, and threads it through as `llmContext.essential_knowledge` (or the equivalent `context`/`ctx` field each of the 12 templates already receives) — `getFactConstraintBlock(preloaded)` now returns `preloaded || FALLBACK_ESSENTIAL_BLOCK`, a one-line change at each of the 12 call sites, no async propagation needed. `handleChatGenerateEvent` (the EventBridge-triggered async path, §22) needs no separate fetch — `llmContext` (already carrying `essential_knowledge`) travels whole through the published event payload. `runAgenticTurn`'s only `findRelevantEntries` call site was already inside an async function, so it became a one-line `await` plus a new `personaType` param threaded from all 3 of its call sites in `chat.js`.

### Admin panel — Knowledge sub-tab under Content

Full CRUD (`handlers/knowledge.js`, routes mirroring `kino_chip_models`'s pattern in `index.js`) plus a new **Knowledge** sub-tab under the Content tab (`ContentTab.jsx` → `KnowledgeTab.jsx`), superadmin-only. Add/edit form: tier and persona selects, topic tags as a comma-separated input, content textarea, evidence-level select (optional-tier only), and a `reviewed_by` field the backend rejects `status='active'` without.

### Files

New: `src/schemas/migration_knowledge_entries.sql`, `src/functions/worker/lib/knowledgeBase.js`, `src/functions/worker/handlers/knowledge.js`, `src/web/admin-panel/src/tabs/KnowledgeTab.jsx`. Modified: `prompts/viva/factConstraint.js` (`getFactConstraintBlock(preloaded)` + `FALLBACK_ESSENTIAL_BLOCK`), all 12 Viva prompt template files (one-line call-site change each), `lib/agenticChat.js` (`findRelevantEntries` now async + `personaType` param), `handlers/chat.js`/`handlers/dots.js` (essential-knowledge prefetch + `personaType` threading into `runAgenticTurn`), `index.js` (`/knowledge-entries[/:id]` routes), `ContentTab.jsx` (new sub-tab). Deleted (superseded): `prompts/viva/knowledge/{index,tcmGeneVariants,nutritionProtocols,longevityScience}.js`.


