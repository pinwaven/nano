# Persona Selection

## Storage

A persona is a property of a **channel**, not a user. `channels.config` is a JSONB column with no DB-level default or CHECK constraint on `persona_type` — `'nano'` is a JS-side fallback used everywhere persona is resolved, not a database default. No migration under `src/schemas/*.sql` sets a `channels`-level default for it.

Admins set it via the admin panel's Channels tab, which issues:

```sql
UPDATE channels SET config = config || '{"persona_type":"viva"}' WHERE id = <channel_id>;
```

**Valid values today: only `'nano'` and `'viva'`.** Every branch is a plain string-literal comparison (`personaType === 'viva'`), never an enum or a switch over a closed set. There's no DB constraint stopping any other string from being written into `config.persona_type` — if that ever happens, code silently falls through to Nano-branch behavior wherever it does `personaType === 'viva' ? X : Y`, with no error or warning anywhere.

## Resolution — always per-request, never cached on the user

Persona is **not** stored on `users` and is **not** cached anywhere. Every handler that needs it resolves it independently, on every call, with the same pattern:

```js
let personaType = 'nano';
if (user.channel_id) {
    try {
        const chRes = await pool.query('SELECT config FROM channels WHERE id = $1', [user.channel_id]);
        personaType = chRes.rows[0]?.config?.persona_type ?? 'nano';
    } catch (err) { /* defaults to nano on failure */ }
}
```

Call sites doing this independently:

| File | Function |
|---|---|
| `src/functions/worker/handlers/chat.js` (~line 713) | `handlePostChat` |
| `src/functions/worker/handlers/chat.js` (~line 1450) | `handlePostHealthAdvice` |
| `src/functions/worker/handlers/dots.js` (~line 993) | `handlePostFormulaDots` |

`resolveOrUpsertUser` (`handlers/chat.js:113`) returns `channel_id` but deliberately does **not** resolve persona itself — that's left to each caller. There is no shared `resolvePersonaType(user)` helper; the query above is copy-pasted at each call site. If a fourth call site is ever added, it needs the identical lookup — there's nothing today that would catch a call site that forgets it (it would just silently default to `'nano'`).

A failed channel lookup (DB error, missing row) also defaults to `'nano'` — persona resolution fails open toward Nano, never toward Viva, and never throws.

## What persona fans out into

Once resolved, `personaType` is threaded through nearly everything downstream of a request:

- **Which prompt files get selected** — see [02-prompt-architecture.md](02-prompt-architecture.md).
- **`chat_messages.persona_type`** (`NOT NULL DEFAULT 'nano'`, added by `migration_chat_messages_persona_type.sql`) — every message insert is tagged, and conversation-history reads are scoped by it (`WHERE user_id = $1 AND persona_type = $3`). A user who somehow talks to both personas (e.g. their channel's `persona_type` gets changed by an admin mid-relationship) never sees the other persona's history bleed into the current conversation.
- **`knowledge_entries.persona_type`** — see [05-knowledge-base.md](05-knowledge-base.md). Defaults to `'viva'` at the DB level; only Viva rows exist today.
- **The dispatcher's daily check-in scan** — reads `COALESCE(c.config->>'persona_type', 'nano')` per eligible user (`dispatcher/index.js:177`) and threads `persona_type` through the `checkin.daily` CloudEvent payload, so `checkin.js` can pick the right template. See [07-proactive-messaging.md](07-proactive-messaging.md).

## What persona does *not* gate anymore

As of the current uncommitted refactor (see the [README](README.md)'s framing note), several mechanisms that used to be gated on `personaType === 'viva'` are now persona-agnostic — gated only on intent, or unconditional:

- The PLAN→GENERATE→JUDGE→REVISE agentic loop itself (gated on `HIGH_RISK_INTENTS.has(intent)`, not persona)
- Async CloudEvent-based chat delivery (gated on `useAgenticLoop && !sandbox`, not persona)
- The Health Advice tool's agentic path (`useAgenticLoop = true` unconditionally)
- Formula/Dots generation's agentic path (`_handleFormulaDotsAgentic`, both personas)
- The daily check-in feature (dispatcher's Scan 0 no longer filters by `persona_type = 'viva'`)
- Computing `currentSolarTerm` and fetching `essentialKnowledge` in `handlePostChat` (both now unconditional; previously `personaType === 'viva' ? ... : null`)

The one deliberate, still-live exception is `_regenerateIfFabricationRisk` (the non-agentic-path fabrication retry) — still gated on `personaType === 'viva' && !useAgenticLoop`. See [04-fact-checking-and-memory.md](04-fact-checking-and-memory.md) for why this asymmetry exists and what it means for Nano's non-agentic intents.
