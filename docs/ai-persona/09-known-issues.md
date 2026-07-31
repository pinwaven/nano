# Known Issues

## CLAUDE.md is currently out of date on the persona-unification refactor

The only uncommitted edit to `CLAUDE.md` itself is a single new paragraph appended to §29 documenting the 2026-07-31 check-in dedup-race fix. **Nothing else in CLAUDE.md reflects the "Nano adopted Viva's core" refactor**, even though that refactor's own code comments repeatedly cite CLAUDE.md §21/§25/§28 as if they already describe the current shared state. Specific divergences, section by section:

- **§16 "AI Persona System"** — still frames Viva as having its own prompt island (`prompts/viva/`) distinct from a Nano-only `systemChat.js` flagship file. `systemChat.js` is dead code for both personas (see [02-prompt-architecture.md](02-prompt-architecture.md)); §16's directory listing omits `factConstraint.js`, `factMemoryBlock.js`, `planTemplate.js`, `judgeTemplate.js`, `subAgeLabels.js`, `systemDailyCheckin.js`, and `systemFormulaGenerate.js` entirely.
- **§21 "Agentic Plan→Generate→Judge→Revise Loop (Viva, High-Risk Intents)"** — the title itself is inaccurate. The loop is gated on intent only (`HIGH_RISK_INTENTS.has(intent)`), not on `personaType === 'viva'`; that exact code condition no longer exists. §21's "Curated knowledge base" subsection also still describes `prompts/viva/knowledge/` (e.g. `tcmGeneVariants.js`) as live — that was already superseded by the DB-backed `knowledge_entries` table (§26, which is itself accurate but doesn't mention the Nano-seeding gap — see below).
- **§22 "Async Chat Delivery for Viva's Agentic Loop"** — same issue; the CloudEvent fork is gated on `useAgenticLoop && !sandbox`, true for Nano's high-risk intents too now.
- **§24 "Health Advice Tool: Agentic Viva + Async"** — `handlePostHealthAdvice`'s `useAgenticLoop` is `true` unconditionally, not persona-gated.
- **§25/§28 (Formulate Dots)** — both explicitly say "Nano keeps its original fast path" and name the handler `_handleFormulaDotsViva()`. The working code renames it `_handleFormulaDotsAgentic()` and routes both personas through it; Nano's "original fast path" is now a fallback only, for either persona, not Nano's primary path.
- **§26 "Knowledge Base Moved to DB"** — accurate as written (correctly documents `persona_type` defaulting to `'viva'`, "included from the start... so Nano could plug in later with zero schema change"), but doesn't flag that this is a **currently live gap**, not just a forward-compatibility note — see below.
- **§29 "Viva Proactive Daily Check-Ins"** — its "why this bypasses the legacy `agent` function" framing is accurate for the check-in feature's own routing choice, but doesn't mean Viva users can't still reach the legacy "You are Nano"-branded agent via other dispatcher scans. See [07-proactive-messaging.md](07-proactive-messaging.md).

**If you're editing CLAUDE.md's persona sections to match current code, do it as a deliberate, reviewed pass** — not by trusting individual section titles in isolation, since some (§26) are accurate and some (§21/§22/§24/§25/§28) are not.

## Real functional gaps (not just doc drift)

1. **`knowledge_entries` has zero `persona_type = 'nano'` rows.** `getEssentialBlock('nano')` and `findRelevantEntries('nano', ...)` return nothing on every call, today — Nano always falls back to the hardcoded default block and sees no optional-knowledge matches in PLAN/JUDGE. See [05-knowledge-base.md](05-knowledge-base.md).
2. **`nutrition.topup` CloudEvents are silently dropped.** `worker/index.js`'s CloudEvent router has no case for `acs.dispatcher`/`nutrition.topup` — a successfully-published event matches no branch and returns `{ ok: true }` having done nothing. Unrelated to persona, but affects both.
3. **The legacy `agent` function is still reachable for Viva users** outside the daily check-in feature's own coverage (any `user_online`/`reminder` dispatcher hit not captured by the same-tick check-in dedupe) and always speaks as "Nano," with no `persona_type` written to the `chat_messages` row it inserts. A Viva user can end up mid-conversation with a "Nano"-voiced message they never asked for.
4. **`_regenerateIfFabricationRisk` (the non-agentic-path fabrication retry) remains Viva-only** (`personaType === 'viva' && !useAgenticLoop`) — Nano's `casual_chat`/`emotional_support`/`set_reminder` intents get no equivalent retry, for either persona under that same gate. Appears deliberate (untouched by the broader genericization pass) but worth confirming with whoever owns this system rather than assuming it should silently stay Viva-only forever.

## Dead code

- `prompts/nano/systemChat.js`, `prompts/viva/systemChat.js` — no `require()` site anywhere; superseded by the intent-routed `prompts/{persona}/chat/*.js` files.
- `prompts/viva/systemHealthReport.js`, `prompts/viva/systemReport.js` — no `require()` site anywhere. Vision-report analysis and the "NanoFirstReport" workflow both use the `nano/` versions unconditionally, regardless of persona.
- `prompts/strings.js` — no `require()` site found.
- `lib/reports/workflow.js`'s `runFirstReportWorkflow` — imported in `worker/index.js` but no caller found anywhere in the current codebase.

## Stale in-code comments (not user-facing, but will mislead future readers)

- `lib/agenticTools.js`'s file header still says "for the Viva agentic chat loop" — the tool layer itself has no persona branching and is used by both.
- `lib/agenticChat.js` still `require()`s the JUDGE prompt from `prompts/viva/judgeTemplate.js`, even though it's used for both personas — a stale file location, not a stale comment, but has the same misleading effect.
- By contrast, `handlers/chat.js`'s comment about `factCheck.js` *was* updated in the current refactor to say "shared by both personas" — evidence the refactor's comment-updating was applied inconsistently across files rather than uniformly skipped.

## If you're picking this up

The single highest-leverage next step, if someone wants to close the gap between code and docs properly, is: (1) commit the in-flight refactor, (2) do a dedicated pass updating CLAUDE.md §16/§21/§22/§24/§25/§28 to match, (3) seed at least placeholder `knowledge_entries` rows for `persona_type = 'nano'` so it isn't silently running on the fallback block indefinitely. None of that was done as part of writing these docs — this directory only describes what's true today, not what should change.
