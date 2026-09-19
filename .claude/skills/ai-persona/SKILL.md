---
name: ai-persona
description: AI persona system rules — channel-level persona_type routing and inheritance, per-persona prompts and behaviour. Load when changing chat personas, prompts, or channel persona config.
---

Moved verbatim from `CLAUDE.md` on 2026-09-19 (section numbers kept; `§N` references point at `CLAUDE.md`).

## 16. AI Persona System

The platform supports multiple AI personas, routed at the **channel level** via `channels.config.persona_type` (JSONB field). **Unset inherits from the parent chain**: `effective_persona_type(channel_id)` (`migration_channel_persona_inheritance.sql`) walks up to the nearest ancestor that sets it and returns `'nano'` only at a root with none — so a sub-channel of `aeviva-china` is Viva without any config of its own. Server code reads the function, never `config->>'persona_type'` directly. `sub_age_display_names`, `admin_tabs` and `locale` inherit likewise through `effective_channel_config(channel_id, key)` (`migration_channel_config_inheritance.sql`; NULL/`{}`/`[]`/`""` = unset).

### Personas

| Persona | Brand | LLM | Prompt language | Domain |
|---|---|---|---|---|
| `nano` | Waven Nano | DashScope (Qwen) | Bilingual (zh/en via `user.language`) | Kino biomarkers, BioAge, Dots nutrition |
| `viva` | Aeviva | Alibaba Qwen Plus | Pure Chinese (simplified) | Developer-defined — prompts in `prompts/viva/` |

### How routing works

1. `handlePostChat` calls `resolveOrUpsertUser` (which returns `channel_id`).
2. The channel's `config.persona_type` is fetched from the `channels` table.
3. `personaType` defaults to `'nano'` if the field is absent or the channel lookup fails.
4. The active prompt set (`nanoPrompts` or `vivaPrompts`) and LLM context are selected accordingly.
5. Every `chat_messages` row stores `persona_type` — conversation history is scoped per persona so histories never bleed across personas.

### Prompt directory layout

```
src/functions/worker/prompts/
  nano/                  ← Nano-specific prompts (bilingual)
    systemChat.js
    systemHealthAdvice.js
    systemHealthReport.js
    systemNutrition.js
    systemReport.js
    chat/
      casual.js  biomarker.js  nutrition.js  science.js
      record.js  reminder.js   emotional.js
  viva/                  ← Viva-specific prompts (pure Chinese)
    systemChat.js
    systemHealthAdvice.js
    systemHealthReport.js
    systemNutrition.js
    systemReport.js
    chat/
      casual.js  biomarker.js  nutrition.js  science.js
      record.js  reminder.js   emotional.js
  chat/
    intentClassifier.js  ← shared, persona-agnostic
    planTemplate.js       ← shared PLAN-stage prompt (§21)
    factConstraint.js     ← shared guardrail block, `getFactConstraintBlock()` (§21, §26)
    factMemoryBlock.js    ← shared personal-memory recall/extraction block (§27)
  viva/
    judgeTemplate.js       ← shared JUDGE-stage prompt (§21) — stale directory location,
                              used for both personas, not moved as of this writing
    subAgeLabels.js         ← Viva-only per-channel sub-age label override (see below)
    systemDailyCheckin.js   ← shared daily check-in prompt (§29)
    systemFormulaGenerate.js ← shared agentic Formulate-Dots prompt (§28)
  strings.js             ← shared UI strings
  systemAdminReport.js   ← shared admin report prompt
```

**`prompts/nano/systemChat.js` and `prompts/viva/systemChat.js` are dead code** — no `require()` site for either exists anywhere in the codebase; both personas are fully routed through the intent-classified `chat/*.js` files instead. Don't add to them expecting it to take effect.

### Persona-unification note (2026-08-14)

An in-repo refactor ("Nano adopted Viva's core," commit `e81b344`) genericized what §21/§22/§24/§28 below (and the since-deleted §25) originally described as Viva-only mechanisms — the agentic PLAN→GENERATE→JUDGE→REVISE loop, its async CloudEvent delivery, the Health Advice tool's agentic path, and Formulate Dots' agentic generation — so **all of them are now gated on intent/feature, not on `personaType === 'viva'`**, and apply equally to Nano. Each affected section below has been corrected to reflect this; where a section's title or body still says "(Viva...)" in a way that reads as a persona gate, treat it as historical framing from when the feature first shipped, not current behavior. Two genuine, still-live asymmetries remain (not doc drift — actual gaps): `_regenerateIfFabricationRisk` (the older, non-agentic-path fabrication retry) is still gated `personaType === 'viva' && !useAgenticLoop`, so Nano's `casual_chat`/`emotional_support` intents get no equivalent retry; and `knowledge_entries` (§26) has zero `persona_type = 'nano'` rows seeded, so Nano's PLAN/JUDGE always falls back to the hardcoded default block. Full detail: `docs/ai-persona/09-known-issues.md`.

### Assigning a persona to a channel

Update `channels.config` via the admin panel (Channels tab) or directly in the DB:
```sql
UPDATE channels SET config = config || '{"persona_type":"viva"}' WHERE id = <channel_id>;
```

### Adding or modifying Viva prompts

Edit files under `src/functions/worker/prompts/viva/`. All Viva prompts are pure Chinese — do not add `isZh` branching. Deploy with `npm run deploy:worker`.

### DB migration

`chat_messages.persona_type` was added via `src/schemas/migration_chat_messages_persona_type.sql`. Existing rows default to `'nano'`.
