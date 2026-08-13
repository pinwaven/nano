# AI Persona System

Nano serves two AI personas — **Nano** (the original, bilingual, "Waven"-branded coach) and **Viva** (Chinese-only, "Aeviva"-branded, Eastern-population framing) — over what is, as of this writing, **one shared agentic chat engine**. This directory documents that engine in detail: how a persona is selected, how a chat turn actually runs (intent classification → PLAN → GENERATE → JUDGE → REVISE), how fabrication is guarded against, how the knowledge base and personal-memory systems work, and how the system proactively messages users outside of a direct chat turn.

## Documents current, committed state

The large refactor genericizing what was originally a Viva-only agentic loop, async delivery mechanism, fact-checking system, and daily check-in feature — so both personas now share them — was, as of 2026-07-31, an uncommitted ~30-file change under `src/functions/worker/` and `src/functions/dispatcher/`. Its own code comments describe it as *"Nano adopted Viva's core."* **That refactor is now committed** (`e81b344 updated nano with viva core`, present in `git log` on the `work` branch) and is current, stable behavior — not an in-flight risk. CLAUDE.md's §16/§21/§22/§24/§25/§28 have likewise been updated to reflect the shared, intent-gated (not persona-gated) mechanisms; see [09-known-issues.md](09-known-issues.md) for confirmation of what's now resolved there.

These docs describe the code as it exists on disk today. This directory is a detailed companion to CLAUDE.md's persona sections, not a replacement for them — when the two disagree, treat CLAUDE.md as authoritative and this directory as due for a refresh.

## Quick facts

| | Nano | Viva |
|---|---|---|
| `channels.config->>'persona_type'` value | `'nano'` (also the fallback for unset/unknown) | `'viva'` |
| Brand voice | Bilingual (`isZh` branching), "Waven" | Chinese-only, "Aeviva" |
| Agentic PLAN→GENERATE→JUDGE→REVISE loop | ✅ shared engine | ✅ shared engine |
| Async CloudEvent chat delivery | ✅ shared mechanism | ✅ shared mechanism |
| Fact-checking guardrail block (`factConstraint.js`) | ✅ shared module | ✅ shared module |
| Non-agentic-path fabrication retry (`_regenerateIfFabricationRisk`) | ❌ not gated on — genuine remaining asymmetry | ✅ |
| `knowledge_entries` DB rows seeded | ❌ none — falls back to hardcoded default | ✅ |
| Daily check-ins (morning/midday/evening) | ✅ shared feature | ✅ shared feature |
| Legacy "You are Nano"-branded proactive `agent` function | Reachable (it's *the* Nano voice) | Still reachable in gaps the check-in feature doesn't cover — see [07-proactive-messaging.md](07-proactive-messaging.md) |

## Contents

1. [Persona Selection](01-persona-selection.md) — where `persona_type` lives, how it's resolved per-request, what it fans out into
2. [Prompt File Architecture](02-prompt-architecture.md) — full inventory of `prompts/`, what's shared vs. persona-specific, dead files
3. [The Agentic Chat Loop](03-agentic-chat-loop.md) — PLAN → GENERATE → JUDGE → REVISE, stage by stage
4. [Fact-Checking & Personal Memory](04-fact-checking-and-memory.md) — `factCheck.js`, the guardrail prompt blocks, `user_memory_facts`
5. [Knowledge Base](05-knowledge-base.md) — `knowledge_entries`, `getEssentialBlock`, the Nano-seeding gap
6. [Chat Pipeline](06-chat-pipeline.md) — `handlePostChat`/`handleChatGenerateEvent`/`handlePostHealthAdvice`, sync vs. async delivery
7. [Proactive Messaging](07-proactive-messaging.md) — the legacy `agent` function, daily check-ins, `nutrition.topup`
8. [Formula/Dots Generation & Reports](08-formula-dots-and-reports.md) — nutrition plan generation, vision/lab reports
9. [Known Issues](09-known-issues.md) — CLAUDE.md drift, dead code, real functional gaps

## Where to start

- Modifying persona-specific wording → [02-prompt-architecture.md](02-prompt-architecture.md)
- Debugging a hallucinated/fabricated claim → [03-agentic-chat-loop.md](03-agentic-chat-loop.md) + [04-fact-checking-and-memory.md](04-fact-checking-and-memory.md)
- Adding a new proactive trigger → [07-proactive-messaging.md](07-proactive-messaging.md)
- Onboarding a third persona → start with [01-persona-selection.md](01-persona-selection.md), then [02](02-prompt-architecture.md) and [05](05-knowledge-base.md) (the two places persona-specific content actually needs new rows/files)
