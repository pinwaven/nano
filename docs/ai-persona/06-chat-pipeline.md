# Chat Pipeline

**File:** `src/functions/worker/handlers/chat.js`. Key functions: `handlePostChat`, `finalizeChatReply` (shared tail), `handleChatGenerateEvent` (async/CloudEvent counterpart), `finalizeFormulaDotsGenerate`, `handlePostHealthAdvice`, `finalizeHealthAdviceReply`.

## `handlePostChat` — step by step

1. `resolveOrUpsertUser(body)` → `user`, `user.channel_id`.
2. Resolve `personaType` from `channels.config` (see [01-persona-selection.md](01-persona-selection.md)), plus `channelSubAgeNames` (per-channel display-name overrides for the 4 dimensions, passed to Viva's `subAgeLabels.js`).
3. Compute `currentSolarTerm` and `essentialKnowledge = await getEssentialBlock(personaType)` — **both unconditional for both personas** as of the current refactor (previously Viva-only).
4. **Routing** — picks `intent` (which template) and `required_data` (which optional fetches). Two routers, selected by `CHAT_UNDERSTANDING_MODE` (§47, [11-intent-understanding.md](11-intent-understanding.md)):
   - the **UNDERSTAND step** (`lib/understanding.js`, `qwen3.8-flash`, thinking off): reads the message with the last 4 turns and a one-line user state, restates the request, then names a route. It decides in `on` (dev).
   - the **classifier** (`prompts/chat/intentClassifier.js`, message only, `max_tokens: 60`, `temperature: 0.1`, `casual_chat` on parse failure): it decides in `off` and `shadow` (prod), and whenever the understanding fails in `on`.

   Then five regex backstops adjust the intent. Their demotions away from `formulate_dots` always apply; their promotions apply only when the classifier routed. Every turn logs `Chat intent classified`; a turn where the two routers differ also logs `route_disagreement`.
5. **Data fetch** — a mix of:
   - *Always-fetched, regardless of intent*: biomarkers, dots, user memory facts, health twin, questionnaire responses, active health plans. This is deliberate — doc-comments in the code reference prior bugs (stale data / wrong age) caused by intent-gating these fetches, so they now run on every turn.
   - *Conditionally fetched*, gated by `required_data`: nutrition plan, weight history.

   Assembled into `llmContext` — the canonical shape reused by `handlePostHealthAdvice` and `handlePostFormulaDots` too.
6. **Prompt selection**: `activePrompts = personaType === 'viva' ? vivaPrompts : nanoPrompts`; `promptBuilder = activePrompts[intent] || activePrompts.casual_chat`; `systemPrompt = promptBuilder(llmContext)`, plus `resolvedRequestLine()` when the understanding routed a continuation (「那运动呢？」). See [02-prompt-architecture.md](02-prompt-architecture.md) for the full table.
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

---

# Appendix: the `CLAUDE.md` §22 and §24 record (moved here verbatim 2026-09-15)

The project-rules entry as it stood before being condensed; the rules that must hold are now
summarised in `CLAUDE.md`. Kept because it records decisions and live findings in the words they
were made in.

## 22. Async Chat Delivery for the Agentic Loop (High-Risk Intents, Shared by Both Personas)

Added 2026-07-28 to fix a real bug, not just a UX rough edge: `handlePostChat` originally awaited the entire agentic loop (§21) inline within the HTTP request/response cycle. Live testing found Aliyun FC **cancels the function invocation** the instant the client (the WeChat Mini Program's `wx.request`) disconnects — confirmed via a live log line, `FC Invoke End RequestId: ..., Error: Invocation canceled by client (duration: 60990ms...)`. So a client-side timeout didn't just fail to show the reply, it destroyed the in-progress work server-side: no notification was ever saved, and the user's question went unanswered until they asked again.

### The fix

For any of the 4 high-risk intents (`useAgenticLoop === true`, either persona — originally Viva-only, genericized by the persona-unification refactor, see §16) on **real (non-sandbox) traffic only**, `handlers/chat.js` publishes a `chat.generate` CloudEvent and returns `{success:true, user_id, processing:true}` immediately, instead of awaiting `runAgenticTurn` inline. The worker's existing EventBridge trigger (`s.yaml`'s `eb-trigger`, previously only consuming `acs.dispatcher`/`acs.lab`, now also `acs.chat`) delivers the event back to the same worker function on a **separate invocation** a client disconnect can't reach, where `handleChatGenerateEvent` runs the real generation and delivers the reply through the existing `notifications`-table polling mechanism.

- **Scope:** deliberately narrow — both personas' `casual_chat`/`emotional_support` (already 2-15s) and **`sandbox: true`** (admin "login as" preview, chat-simulator dev tool — no polling mechanism, needs the reply synchronously) are completely unaffected; they never take the async branch.
- **Shared tail:** the grounding-check/action-detection/save+notify logic that used to run inline is extracted into `finalizeChatReply()`, called identically by the synchronous callers (classic path, sandbox, and the fail-open fallback below) and by `handleChatGenerateEvent` — one implementation, not two copies drifting apart.
- **Fail-open on publish failure:** if `publishChatGenerateEvent` throws (EventBridge unavailable), `handlePostChat` falls through and runs the agentic loop synchronously right there, exactly as before — never silently drops the user's message just because EventBridge is down.
- **Dedupe:** EventBridge is at-least-once delivery, and generation has real side effects (chat_messages insert, weight recording, reminder creation). `chat_generate_events` (migration `migration_chat_generate_events.sql`) is checked via `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id` before any real work — a duplicate delivery is a no-op.
- **Progress status, not a static "typing…":** `runAgenticTurn` (`lib/agenticChat.js`) takes an optional `onStatus(key)` callback fired at 3 phase checkpoints (before PLAN, before GENERATE, before the first JUDGE) — `makeStatusNotifier()` in `chat.js` turns each into a `notifications` row (`notification_type: 'chat_status'`, reusing the existing table/polling with zero schema change). The miniapp (`pages/main/main.js`) routes these rows to a `chatStatusText` caption instead of a chat bubble, replacing the old static 3-dot animation's lack of feedback during a long wait. A client-side 3-minute safety timeout clears the wait UI with a gentle "still working" message if nothing arrives — pure UX bound, not an assumption the turn failed (server-side work may still complete and deliver on a later poll).

### Delivery is now two-channel (fixed 2026-08-22)

`GET /api/notifications` is a **destructive read** — `handleGetNotifications` flips rows to
`'sent'` inside the same `UPDATE ... RETURNING` that returns them, with no ack from the client. So
one poll response the miniapp never receives (app backgrounded mid-request — `onHide` also clears
the poll timer — a network blip, a request timeout) permanently consumes the only copy of the
reply, and the user sits on the typing indicator until the client's own wait bound gives up.
Confirmed live on dev: a health-advice reply written to `chat_messages` **and** `notifications` 81s
after the request never reached the device.

Two things now backstop it, and both must stay:

1. **`chat_messages` replay.** `handleGetChatHistory`'s `since_id` poll takes a `roles` param
   (default `'coach'`, so every other caller is unchanged). While a turn is pending — and only
   then, gated on `_chatWaitStartedAt` in `pages/main/main.js`'s `_poll` — the miniapp asks for
   `roles=coach,ai`, and any AI row written since the last tick is rendered from there.
   `chat_messages` is not destructive, so this recovers the lost-notification case within one 3s
   tick. Cross-channel de-dup is keyed on normalised text (`_aiKey`/`_markRenderedAi`) and scoped
   to `AI_ECHO_TYPES` — notification types that genuinely also write a `chat_messages` row.
   `coach_reminder` is deliberately excluded: it has no chat row, and two identical reminders are
   two real messages, not a duplicate.
2. **A 250s watchdog in `handleChatGenerateEvent`** (`DELIVER_DEADLINE_MS`). `runAgenticTurn`'s own
   200s `TURN_DEADLINE_MS` plus `finalizeChatReply`'s grounding retry (one more ~60s LLM call) can
   legitimately reach ~270s against the worker's hard 300s FC ceiling — and a platform kill runs no
   JS at all, so nothing in that function's `catch` can rescue it. The work is raced against the
   watchdog; whoever gets there first (real reply, error fallback, or watchdog) delivers exactly
   one terminal message via `_deliverTerminalMessage` (both `chat_messages` and `notifications`),
   guarded by a single-use `claimDelivery()`.

`DELIVER_DEADLINE_MS` reads `CHAT_DELIVER_DEADLINE_MS` so the watchdog is testable without a 250s
wall clock (`tests/chat-async-delivery.test.js`); nothing sets it in `s.yaml`.

**The replay covers synchronous turns too (2026-09-13).** Until then `_chatWaitStartedAt` was only
opened on a `{processing:true}` ack, so a `casual_chat`/`emotional_support` reply — persisted to
both tables *before* its `{success:true}` ack — was delivered by the destructive notification read
alone, and one lost poll response made it vanish for good (dots for ~2s, then nothing; the row sat
in `chat_messages` until the next app open). Reproduced on dev with 「你好」. `_sendMessage` now
opens the wait through `_beginChatWait(CHAT_WAIT_SYNC_MS)` (30s, not the async 285s — the reply
already exists when the ack arrives), polls at once rather than on the next tick, and keeps the
typing indicator up until the reply lands. **Every wait must go through `_beginChatWait`** so the
budget can never be left over from a turn of the other kind. In DevTools specifically, a hot
reload leaves an orphaned poller that consumes notifications (see the automator README); this is
now survivable rather than a lost reply.

The failure text is localised by `user.language` (`_asyncFailureMessage`) — it was hardcoded
English and shown verbatim to zh-only Viva users. The client's last-resort message at 285s now says
the turn didn't finish rather than "还在处理中", because by then both channels and the server
watchdog have all had their turn.

### The credentials gotcha

`publishChatGenerateEvent` (`lib/chatEventBridge.js`) does **not** use `context.credentials`/`context.region` the way the Cron-triggered `dispatcher/index.js` does — a live probe found `context` is an **empty object** for this HTTP-triggered function. It uses the runtime role's env-injected STS credentials instead (`ALIBABA_CLOUD_ACCESS_KEY_ID`/`_SECRET`/`ALIBABA_CLOUD_SECURITY_TOKEN`, `FC_REGION`), confirmed present regardless of trigger type. Full details: `fc3-handler-reference` skill.

### Files

- New: `src/schemas/migration_chat_generate_events.sql`, `lib/chatEventBridge.js`.
- Modified: `handlers/chat.js` (fork point, `finalizeChatReply` extraction, `handleChatGenerateEvent`, `makeStatusNotifier`), `lib/agenticChat.js` (`onStatus` param), `index.js` (new EventBridge routing case), `worker/package.json` (`@alicloud/eventbridge`, `uuid`), `s.yaml`/`s-prod.yaml` (`eb-trigger`'s source filter), `pages/main/main.js`/`main.wxml`/`main.wxss` (status caption UI, safety timeout), `utils/config.js` (VERSION bump).


## 24. Health Advice Tool: Agentic Loop + Async (Phase A) — Shared by Both Personas

Added 2026-07-29, originally Viva-only, **now unconditional for both personas** (persona-unification refactor, see §16's note — `handlePostHealthAdvice`'s `useAgenticLoop` is `true` unconditionally, not persona-gated). The toolbox's "Health Advice" button (`utils/tool-actions.js`'s `runHealthAdvice`) never went through §21/§22's work — it calls a completely separate handler, `handlePostHealthAdvice` (`chat.js`), which historically ran a single completion + (viva-only) `_regenerateIfFabricationRisk` retry, not `runAgenticTurn`. Fixed: the same PLAN→GENERATE→JUDGE→REVISE loop, and (for the miniapp's own chat tab only) the same async `chat.generate` delivery §22 built for `/chat`.

### Scope decision (confirmed via discussion)

`handlePostHealthAdvice` has **3 callers**, only one of which had a landing spot for async replies:
- `pages/main/main.js` (end user's own chat) — has `_poll`, so this is the only caller wired for async (`opts.async: true` passed to `runHealthAdvice`).
- `pages/coach/coach.js` (coach viewing a client's chat) — confirmed via investigation: **no polling mechanism at all** (no `setInterval`/`/api/notifications` anywhere in that file). Stays fully synchronous by design; building async delivery here would require new polling infrastructure from scratch, out of scope for this pass.
- `src/web/user-app`'s `ChatTab.jsx` — a separate browser app, also synchronous, also out of scope.

### Backend reuse — no new event type needed

`handlePostHealthAdvice`'s fetched data is reshaped into the *same* `llmContext` contract `handlePostChat` produces (`user_profile`, `biomarkers`, `biomarkers_tested_at`, `dots`, `active_health_plans`, ... — `plan`/`questionnaire_context`/`sub_age_display_names` left `null`, not fetched by this handler, flagged as a known Phase-A gap rather than faked). Because the shape matches, the handler can publish through the **exact same** `publishChatGenerateEvent`/`handleChatGenerateEvent`/`finalizeChatReply` pipeline §22 already built — no new CloudEvent type, no new EventBridge routing. The synchronous tail (nano always; viva when sandbox, no `async` flag, or EventBridge-publish-failure fallback) uses a new small `finalizeHealthAdviceReply()` instead — same grounding-check-with-one-retry logic, but returns `{success:true, message}` directly rather than writing to `notifications` (this endpoint's synchronous callers expect the reply inline, not via polling).

### Two real bugs found during verification, fixed same pass

1. **`coach.js`'s call site had no timeout override** and the agentic loop measured up to **~167s** synchronously (vs. ~15-25s for the old single completion) — without a fix this would have made the FC-cancellation-on-client-timeout bug (§22's original motivation) *more* likely to hit here, not less. Fixed: `coach.js`'s `_req` gained the same optional `timeoutMs` param `main.js`'s already had; `runHealthAdvice` now requests 180s specifically for this call.
2. **The sandbox router short-circuit was missing `/health-advice`** — `index.js`'s blanket `if (sandbox && method !== 'GET' && path !== '/chat')` rule meant a sandbox request to `/health-advice` never reached the handler at all (confirmed live: instant `{success:true,sandbox:true}` with no `message`), so the toolbox's Health Advice button has **never actually worked in sandbox/admin-preview mode** — always showed a generic error. This predates this session's changes entirely. Fixed by adding `/health-advice` to the same exemption `/chat` already has.

### Files

Modified: `handlers/chat.js` (`finalizeHealthAdviceReply`, `handlePostHealthAdvice` rewrite), `index.js` (sandbox router exemption), `utils/tool-actions.js` (`runHealthAdvice` async + timeout), `pages/main/main.js` (`onAsyncStart`, `{async:true}`), `pages/coach/coach.js` (`_req` timeout param — behavior otherwise unchanged), `utils/config.js` (VERSION bump).


