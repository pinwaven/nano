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
