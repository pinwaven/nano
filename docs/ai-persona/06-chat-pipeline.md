# Chat Pipeline

**File:** `src/functions/worker/handlers/chat.js`. Key functions: `handlePostChat`, `finalizeChatReply` (shared tail), `handleChatGenerateEvent` (async/CloudEvent counterpart), `finalizeFormulaDotsGenerate`, `handlePostHealthAdvice`, `finalizeHealthAdviceReply`.

## `handlePostChat` — step by step

1. `resolveOrUpsertUser(body)` → `user`, `user.channel_id`.
2. Resolve `personaType` from `channels.config` (see [01-persona-selection.md](01-persona-selection.md)), plus `channelSubAgeNames` (per-channel display-name overrides for the 4 dimensions, passed to Viva's `subAgeLabels.js`).
3. Compute `currentSolarTerm` and `essentialKnowledge = await getEssentialBlock(personaType)` — **both unconditional for both personas** as of the current refactor (previously Viva-only).
4. **Intent classification** — one LLM call via `prompts/chat/intentClassifier.js`, `max_tokens: 60`, `temperature: 0.1`. Falls back to `casual_chat` on any parse failure. Returns `{ intent, required_data }`.
5. **Data fetch** — a mix of:
   - *Always-fetched, regardless of intent*: biomarkers, dots, user memory facts, health twin, questionnaire responses, active health plans. This is deliberate — doc-comments in the code reference prior bugs (stale data / wrong age) caused by intent-gating these fetches, so they now run on every turn.
   - *Conditionally fetched*, gated by `required_data`: nutrition plan, weight history.

   Assembled into `llmContext` — the canonical shape reused by `handlePostHealthAdvice` and `handlePostFormulaDots` too.
6. **Prompt selection**: `activePrompts = personaType === 'viva' ? vivaPrompts : nanoPrompts`; `promptBuilder = activePrompts[intent] || activePrompts.casual_chat`; `systemPrompt = promptBuilder(llmContext)`. See [02-prompt-architecture.md](02-prompt-architecture.md) for the full table.
7. `useAgenticLoop = HIGH_RISK_INTENTS.has(intent)` — persona-agnostic (see [03-agentic-chat-loop.md](03-agentic-chat-loop.md)).
8. Persist the user's message to `chat_messages` (tagged with `personaType`), unless this is a sandbox session.
9. Fetch persona-scoped conversation history (`WHERE persona_type = $3`), normalize roles, collapse consecutive same-role turns.
10. **Fork point — async delivery.** If `useAgenticLoop && !sandbox`, publish a `chat.generate` CloudEvent (`source: 'acs.chat'`) via `lib/chatEventBridge.js`'s `publishChatGenerateEvent()` and return `{ success: true, user_id, processing: true }` **immediately**, without awaiting generation. On publish failure, falls open and runs the loop inline/synchronously instead.
11. If not forked: runs either `runAgenticTurn()` (for the 4 high-risk intents) or an older 4-iteration `query_database` generic-SQL tool loop (non-agentic intents) — the latter's model-authored SQL is explicitly blocked from querying `biomarkers` directly.
12. `finalizeChatReply()` — the shared tail for every path (classic sync, sandbox, async-fallback-sync, and the EventBridge-triggered async path): biomarker-grounding retry, fabrication-risk retry (Viva-non-agentic-only, see [04-fact-checking-and-memory.md](04-fact-checking-and-memory.md)), `record_weight`/`set_reminder`/`remember_fact` action-JSON parsing + persistence + stripping from the visible reply, then `saveChatMessage(..., personaType)` plus an `INSERT INTO notifications (notification_type = 'chat_reply', status = 'pending')` for the frontend's polling mechanism. Sandbox sessions return the reply directly instead, bypassing the notifications side channel.

## Why async delivery exists

Aliyun FC cancels the invocation the instant the HTTP client disconnects, and the agentic loop can take 60–180s+ in the worst case (PLAN + 3 GENERATE iterations + 2 REVISE/re-JUDGE rounds). Awaiting the loop inline on the original HTTP request risked losing real, already-paid-for LLM work to a client timeout. Instead:

- The initial HTTP request returns near-instantly with `processing: true`.
- Generation actually happens inside `handleChatGenerateEvent`, triggered by the EventBridge `chat.generate` CloudEvent, routed from `worker/index.js` (`event.source === 'acs.chat' && event.type === 'chat.generate'`).
- Delivery to the user happens the same way any other proactive message does — a `notifications` row the frontend's 3-second poll picks up.

`handleChatGenerateEvent` dedupes via `INSERT INTO chat_generate_events (event_id) ON CONFLICT DO NOTHING RETURNING id`, since EventBridge is at-least-once delivery. It runs `runAgenticTurn()` then branches on `payload.kind`: the default branch calls `finalizeChatReply` (a normal chat turn); `'formula_dots_generate'` calls `finalizeFormulaDotsGenerate` (commits the actual weekly Dot allocation — see [08-formula-dots-and-reports.md](08-formula-dots-and-reports.md)). On failure, it falls back to the deterministic (non-agentic) formulation path rather than leaving the user with nothing.

`publishChatGenerateEvent` has a documented gotcha: HTTP-triggered functions get an **empty** `context` object (no `context.credentials`/`context.region`, unlike cron-triggered `dispatcher`), so it must use env-injected STS credentials (`ALIBABA_CLOUD_ACCESS_KEY_ID`/`_SECRET`/`_SECURITY_TOKEN`, `FC_REGION`) instead.

## Status/progress notifications during the async wait

`makeStatusNotifier(user_id, language)` — an `onStatus` callback `runAgenticTurn` fires at 3 checkpoints (`understanding` / `checking_data` / `verifying`), inserting `notification_type: 'chat_status'` rows the miniapp polls and renders as a caption (see `STATUS_COPY`) instead of a static typing indicator.

## `handlePostHealthAdvice`

A separate handler behind the "Health Advice" tool/button, with 3 callers: the miniapp's chat tab, the coach app, and the web `ChatTab.jsx`. Only the miniapp opts into async delivery (`body.async`); the other two callers stay synchronous. It reshapes its own fetched data into the identical `llmContext` contract `handlePostChat` produces, and reuses `runAgenticTurn`/`publishChatGenerateEvent`/`finalizeHealthAdviceReply`. `useAgenticLoop = true` unconditionally — not persona-gated, unlike CLAUDE.md's current description of this feature as Viva-only.
