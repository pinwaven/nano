# Waven Nano AI Backend

# Project Rules

## 1. Project Context

- **Name:** Waven Nano AI (Precision Health Ecosystem)
- **Tech Stack:** Node.js (Latest LTS), PostgreSQL 14 (Aliyun PolarDB Serverless)
- **Architecture:** Serverless Event-Driven (Aliyun FC 3.0 + EventBridge)
- **Infrastructure:** All production code must respect Aliyun FC 3.0 constraints (max 24h runtime, stateless execution).

## 2. Dev vs Prod Environments

There are two separate PolarDB databases. Both share the same Aliyun account and VPC.

| | Dev | Prod |
|---|---|---|
| DB name | `nano_db_dev` | `nano_db_prod` |
| s.yaml config | `s.yaml` | `s-prod.yaml` |
| Deploy scripts | `deploy:worker`, `deploy:dispatcher`, etc. | `deploy:worker:prod`, `deploy:dispatcher:prod`, etc. |
| Connection var | `DATABASE_URL` | `DATABASE_URL_PROD` |
| Migrate | `npm run migrate:dev` | `npm run migrate:prod` |

**Always develop and test on dev first. Never run untested SQL directly on prod.**

### Miniapp Backend Selection

The WeChat Mini Program (`src/mini/nano-miniapp/`) automatically selects the backend URL based on its `envVersion`:

- **`develop`** (IDE/Local Dev): `https://nano-dev.gcn.net`
- **`trial`** (Preview/Experience): `https://nano.gcn.net`
- **`release`** (Production): `https://nano.gcn.net`

This ensures that only developers in the IDE touch the dev environment, while all uploaded versions (including previews) use the production backend. Logic resides in `src/mini/nano-miniapp/utils/config.js`.

### Miniapp VERSION Marker

`src/mini/nano-miniapp/utils/config.js` exports a `VERSION` string (format `MMDD-N` — month+day, build number that day). **Bump it on every code change under `src/mini/nano-miniapp/`** (WXML/WXSS/JS, any page or util), no matter how small — the miniapp has no build pipeline and no other way to confirm a WeChat DevTools preview/upload is actually running the latest code versus a stale cached compile. Increment `N` for another change the same day; reset to `-1` on a new date. This is a bare `const`, no build step reads it — just edit the literal.

### WeChat DevTools Automation (for driving/testing the miniapp)

WeChat DevTools' "Service Port" (Settings → Security Settings) is open on **`22038`** — this is the IDE's CLI HTTP port (`cli open`/`cli preview`/etc.), not the automation websocket by itself. To actually drive the running miniapp (e.g. via the `miniprogram-automator` Node package) for testing UI changes, automation must additionally be enabled with its own port:

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto --project /Users/pin/waven/nano/src/mini/nano-miniapp --auto-port <port>
```

Then `automator.connect({ wsEndpoint: 'ws://127.0.0.1:<port>' })` (not `22038`) attaches to it. `automator.launch({ cliPath, projectPath, port })` does the open+auto+connect flow in one call and is the more reliable path from a cold start — a plain `cli auto` against an already-open project can leave the simulator's app launch hanging (`routeTo appLaunch timeout` in the IDE's `WeappLog` logs) if the project window is in a stale state; quitting (`cli quit --project <path>`) and relaunching via `automator.launch` resolves it.

**Don't re-derive this by hand each session** — [`tools/wechat-automator/`](tools/wechat-automator/README.md) wraps the above into a reusable `launch()`/`connect()` helper, plus a documented list of gotchas found via live debugging (screenshots don't work in this environment, synthetic touch doesn't trigger real scroll-view scrolling, `wx.storage` persists the logged-in user across relaunches). Use it instead of reinventing the connection dance; only write throwaway one-off repro/verify scripts to your scratchpad, not into that tool.

### WeChat Domain Setup

See [docs/wechat-domain-setup.md](docs/wechat-domain-setup.md) for request domain whitelist troubleshooting and business domain verification steps.

## 3. Database Migrations

Schema changes are tracked in a `schema_migrations` table and applied via `scripts/migrate.js`. **Never apply ad-hoc SQL directly to prod** — always write a migration file so it is tracked.

### Migration workflow

1. Write SQL as `src/schemas/migration_<name>.sql` (use `IF NOT EXISTS` for idempotency)
2. Apply to dev: `npm run migrate:dev`
3. Test, then apply to prod: `npm run migrate:prod`

Full details: `docs/architecture/database-migrations.md`

## 4. Core Technical Constraints

- **Database:** Use the `pg` library for raw SQL. **STRICTLY PROHIBITED:** No ORMs (like Prisma or TypeORM) to minimize cold-start latency and overhead.
- **SQL Standards:** PostgreSQL 14 compatible syntax. Use `ON CONFLICT` for upserts.
- **Messaging:** Follow **CloudEvents 1.0** standards for all event payloads.
- **AI Logic:** The AI Worker must decouple prompt engineering from execution. Prompts should be stored in `/prompts` as template files.

## 5. Directory Structure & Naming

- `/src/functions/dispatcher/`: FC 3.0 code for user scanning (Cron-triggered).
- `/src/functions/worker/`: FC 3.0 code for AI processing and WeChat notifications.
- `/src/lib/`: Shared logic (Database clients, WeChat API helpers).
- `/src/schemas/`: JSON Schema files for event validation.
- `/src/mini/nano-miniapp/`: WeChat Mini Program frontend (WXML/WXSS/JS, no build pipeline).
  - The **Kino Simulator** is implemented as a native WXML overlay inside `pages/main/` — it is not an iframe or externally loaded resource. All UI, state, and logic live in `main.wxml`, `main.wxss`, and `main.js`. Only the biomarker result data is fetched remotely (`/api/biomarkers`).
  - This miniapp Kino Simulator is unrelated to the web simulator iframes in `/src/web/admin-panel` (`/admin/sim/...`). The old web Kino simulator (`/admin/sim/kino/`) has been removed; only the Chat and Coach web simulators remain.
  - The Mini Program can be compiled into native iOS/Android applications using the WeChat Donut Multiterminal framework. For structural details, tooling, native plugin integration, and OTA hot updates, see [wechat-multiterminal.md](docs/architecture/wechat-multiterminal.md).
- `/tests/`: `node:test` suites (`*.test.js`), all offline — DB and GCN are stubbed through `require.cache`, never a live Postgres. `tests/agent-test.js` is a CLI script, not a test; `tests/worker-endpoints.test.js` is a legacy live-HTTP smoke that is skipped unless `RUN_ENDPOINT_TESTS=1`.
- `/src/web/admin-panel`: **Web Admin Panel** — React (Vite) SPA served by the FC worker. Full superadmin control: users, coaches, dots, store, channels, invites, simulators. Built with `npm run build` inside that directory; output goes to `src/functions/admin-panel/dist/`. Referred to as the **"web admin panel"**.
- `/src/mini/nano-miniapp/pages/admin/`: **Miniapp Admin Panel** — WeChat Mini Program page for channel-scoped admins. Manages users, coaches, store items, and invite codes within a single channel. No build step (native WXML/WXSS/JS). Referred to as the **"miniapp admin panel"**.
- `/src/mini/nano-miniapp/pages/superadmin/`: **Miniapp Superadmin Panel** — WeChat Mini Program page for superadmins. Global view of channels, users, coaches, dots (with full ingredient editing), and invites. Referred to as the **"miniapp superadmin panel"**.
- **File Naming:** kebab-case (e.g., `user-repository.js`).

## 6. Coding Standards (Node.js)

- **Style:** Modern ES Modules (`import/export`).
- **Error Handling:** Every async operation MUST be wrapped in a `try/catch` block.
- **Logging:** Use `console.log` for Aliyun CloudWatch integration, but format as JSON: `console.log(JSON.stringify({level: 'INFO', msg: '...', data: {}}))`.
- **Latency:** Keep the `lib/db.js` client outside the handler to leverage Aliyun container reuse.

## 7. Local Development & Testing

- Use `.env` for local variables. Never hardcode the PolarDB endpoint.
- **Command:** `npm test` runs every `tests/*.test.js` offline (`node --test`); a single file with `node --test tests/<name>.test.js`. Same shape in the GCN sibling repo. There is no CI — run it before every deploy.
- **Git:** Never commit without the user explicitly asking for it in that session — not even to satisfy a "commit after every build" habit. When a commit is requested, split it into one commit per modular component rather than bundling everything together.

## 8. AI Interaction Rules

- Before suggesting a change, check `src/schemas/` to ensure you aren't breaking the event contract.
- If writing a new Aliyun FC handler, always provide the `s.yaml` (Serverless Devs) configuration snippet.
- Prioritize **token efficiency**: Don't rewrite entire files if only one function needs a fix.

## 9. Changelog for code changes

- CHANGELOG.md

## 10. Role System

- 4 roles: `user`, `coach`, `admin`, `superadmin` — stored as `TEXT[]` on `users.roles`.
- A single WeChat openid can hold multiple roles simultaneously.
- Channel scoping is implicit via `users.channel_id`; no separate role-junction table.
- Coach role is auto-managed when `coaches.user_id` FK is set/unset.
- **`coaches` has NO `channel_id` column.** A coach's channel is always `users.channel_id` for the linked `user_id`. All channel-scoped coach queries join `coaches → users → channels`. Dropped via `migration_coaches_drop_channel_id.sql`.
- Full details: `docs/architecture/role-system.md`

## 11. The Four Sub Bio Ages

Moved to the `bio-ages` skill (`.claude/skills/bio-ages/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 12. Aliyun Function Compute 3.0 (FC 3.0) Runtime Behavior

FC 3.0's HTTP-trigger handler invocation model, event object shape, and response format differ from Express/Lambda conventions in ways that are easy to get wrong. Full reference (confirmed by live debugging): `fc3-handler-reference` skill — load it before writing or modifying an FC handler.

## 13. Kino Hardware System

Moved to the `kino-hardware` skill (`.claude/skills/kino-hardware/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 14. Dots System

Waven Dots are 36 mg precision nutrition cartridges. Each cartridge delivers one or more active compounds in an exact dose, calibrated to the user's biomarker profile. The system targets four biological age dimensions measured by the Kino chip. The Dots can be mixed by AI at realtime according to the user's actual health data.

### Cartridge Format

- **Payload:** 36 mg per dot
- **Pack size:** 800 dots per cartridge
- **Timing:** Morning or Evening (fixed per dot — set by the `timing` column in the `dots` table)
- **Types:** Isolates (single active compound) and Blends (two or more actives)

## 15. TEMP Folder
- location: ./temp
- save one time scripts such as migration scripts in the temp folder

## 16. AI Persona System

Moved to the `ai-persona` skill (`.claude/skills/ai-persona/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 17. Biomarker Actual vs Validated — Never Merge Actual Over Validated

`data.validated` (stored in the `biomarkers` table) is the **single source of truth** for biomarker values used in AI outputs. When passing biomarker values to any LLM prompt, always use `data.validated`, never merge `data.actual` on top of it.

### Why

`BiomarkerEstimator` validates each submitted value against a physiologically plausible range before accepting it. When a submitted value is within range, the estimator stores it as `validated` (so validated = actual). When a submitted value is out of range or missing, the estimator generates a plausible replacement. The BioAge calculation always runs on `data.validated`.

`data.actual` is the **raw unvalidated** value from the Kino reader. Merging it over `validated` in a prompt can pass an out-of-range value directly to the LLM while the stored BioAge was computed with the validated value — creating a contradiction in the report.

### The bug (fixed 2026-06-07)

`handlePostHealthAdvice` used `{ ...validatedBm, ...actualBm }`, which let `actual.hsCRP = 0.14` (below the estimator's 0.2 minimum) overwrite `validated.hsCRP = 1.02`. The LLM narrated "hsCRP = 0.14, excellent health" while the stored ResilienceAge had been scored with 1.02 — an internal contradiction visible to the user.

**Fix:** Use `validatedBm` directly (`src/functions/worker/index.js`, `handlePostHealthAdvice`).

### Rule for new code

When reading from `biomarkers.data` to feed an LLM prompt or build a user-facing biomarker summary:

```js
// CORRECT — validated, consistent with BioAge calculation
const biomarkers = latestBio?.data?.validated || {};

// WRONG — raw value can bypass estimator validation
const biomarkers = { ...latestBio?.data?.validated, ...latestBio?.data?.actual };
```

`data.actual` is for audit/debug purposes only. Do not use it to override `data.validated` in any user-facing output.

## 18. Wearable Ring System — Halo + V8 Only

**As of 2026-07, only Halo (`brand === 'halo'`) and V8 (`brand === 'v8'`) are actively supported.** Halo is our product name for the X3/X6/X9/V4 hardware family — X3, X6, and X9 are rings, V4 is a wrist-worn band; all four share the identical BLE protocol (confirmed, not assumed). V8 is a smart band from the same hardware team — a close protocol relative of Halo (same GATT UUIDs, same frame format, ~20 shared opcodes) but not identical (e.g. opcode `0x57` means something different on each) — see `docs/architecture/v8-smart-band.md`. BLE-advertised names literally start with the manufacturer's own model prefixes (`HALO_NAME_PREFIXES` in `halo/protocol.js`, `V8_NAME_PREFIXES` in `v8/protocol.js`) — not something we control or rename. Colmi and Aizo adapters (`src/mini/nano-miniapp/utils/wearable/colmi/`, `.../aizo/`) still exist in the codebase and must keep working for any users already bound to them, but **do not extend, "improve," or bug-fix their protocol/parsing code** — no new features, no refactors, no reuse-driven cleanups that touch `colmi/` or `aizo/`. All new wearable work (protocol changes, new data types, sync/backend changes, HealthTab UI) targets Halo and V8 only.

- `'x3'` is a legacy brand value from before the X3→Halo rename (2026-07) — still present in local storage / server rows for anyone bound before the rename shipped. `createWearable()` and the miniapp's `_normalizeBrand()` helper accept it as an alias for `'halo'`; don't remove that compat path without a data migration for existing bindings.
- Canonical Halo protocol + BLE implementation: `src/mini/nano-miniapp/utils/wearable/halo/` (`protocol.js` for packet builders/BCD parsing, `index.js` for the BLE-driven `HaloRing` class — also exports pure parsing helpers as `HaloRing.parsers` for reuse outside the wx.* BLE stack). The literal hardware name prefixes (`HALO_NAME_PREFIXES = ['X3', 'X6', 'X9', 'V4']`) must stay as-is — only the internal identifiers around them were renamed. Brand detection during scan (`user-health.js`) checks against this array directly rather than hardcoding individual prefixes, so adding a future model line is a one-line change there.
- Standalone debugging CLI for the Halo protocol (Node/noble, no phone required): `tools/halo/` — run with no arguments to dump every stored data type from a nearby ring. See its README for usage. `--device v8` targets V8 instead.
- V8 adapter: `src/mini/nano-miniapp/utils/wearable/v8/` (`protocol.js` + `index.js` for the `V8Band` class), registered as brand `'v8'` in `utils/wearable/index.js`. Wired into `user-health.js`'s bind/sync/interval-settings flow alongside Halo via a shared `_hasIntervalSettings(brand)` helper — their sync shapes are identical so this reuses Halo's code paths rather than duplicating them. Some fields are deliberately left `null` rather than guessed — notably sleep stage (deep/light/rem/awake) breakdown, since V8's raw stage codes don't match Halo's confirmed enum and mislabeling would be worse than a gap. Full protocol reference and the complete list of what didn't carry over 1:1 from Halo: `docs/architecture/v8-smart-band.md` §6–7.
- `HaloRing._stream()` resolves with whatever data has accumulated on timeout rather than rejecting — rings with a large unsynced backlog (sleep, HR log, temperature history) can take well over the 8–15s per-command timeout to fully stream. Do not revert this to a hard reject; every caller already expects partial results over a full failure.
- Server-side ring binding (`users.wearable_brand/wearable_mac/wearable_name/wearable_bound_at`, migration `migration_wearable_binding.sql`) is brand-agnostic in the DB/API layer, but in practice `wearable_mac` is only populated for Halo and V8 (the only brands implementing `getMac()`).
- Full Halo BLE protocol reference: `docs/architecture/halo-smart-ring.md`. The Colmi-focused `docs/architecture/wearable-system.md` predates Halo/Aizo and is kept for historical/OEM-transition context only — don't treat it as current guidance for new work.

## 19. GCN Integration (Aeviva Partner Storefront)

Moved into the `gcn-integration` skill (`.claude/skills/gcn-integration/SKILL.md`) on 2026-09-19 — invoke it before touching the nano↔GCN bridge.

## 20. Avatar Gallery System

Users pick a profile avatar from a gallery of 40 pregenerated characters (`components/avatar-picker/`) instead of uploading a real photo — WeChat's native `chooseAvatar` upload flow was removed entirely. Each character has 4 mood variants (engaged/relaxed/restored/stressed); `users.avatar_character` (migration `migration_avatar_character.sql`) records which character was picked, while `avatar_url` keeps storing a single resolved image URL exactly as before (now the character's `relaxed` variant) so every other read site is unaffected. In the health tab's self view only, `utils/mood.js`'s `computeMood()` derives a live mood client-side from already-synced wearable data and swaps the displayed image — purely client-rendered, never written back to the server. Gallery images live on the `waven-nano` OSS bucket; regenerate via `temp/upload-avatar-gallery.js` (rewrites `utils/avatar-gallery.js`). Full details: `docs/architecture/avatar-gallery.md`.

**Custom avatars (2026-09-20):** a user may instead upload their own photo; `lib/avatarGen.js` turns it into a personal 4-mood set in the gallery style with DashScope Qwen-Image (gate with `qwen-vl-plus`, base from photo + style reference, three **sequential** mood edits of the base — parallel calls 429), stored as `users.avatar_moods` under `avatar_character='custom'`. The source photo is deleted on every outcome; the upload key is server-minted under `avatar-uploads/<user_id>/` (never `/api/oss/presign`); one in-flight job per user and 3/day. Rides `chat.generate` as `kind:'avatar_generate'`. `avatar-gallery.md` §6.

## 21. Agentic Plan→Generate→Judge→Revise Loop — Rules

`runAgenticTurn()` (`lib/agenticChat.js`) runs for every intent in `HIGH_RISK_INTENTS`
(`biomarker_question`, `nutrition_question`, `longevity_science`, `record_action`) — gated on
intent, **not** persona (§16); `casual_chat`/`emotional_support` take the classic path for both
personas. Full record: [docs/ai-persona/03-agentic-chat-loop.md](docs/ai-persona/03-agentic-chat-loop.md).

- **Budget per turn:** PLAN 1 · GENERATE ≤3 (`GENERATE_MAX_ITERS`) · JUDGE 1 · REVISE ≤2
  (`REVISE_MAX_ROUNDS`) · re-JUDGE ≤2. Logged as `turn_budget_used`. Never loop past it.
- **GENERATE uses only the typed read tools** in `lib/agenticTools.js` — never raw model-authored
  SQL; biomarker-shaped data always from `data.validated` (§17). `health_events` is deliberately
  unexposed (`health_twin` summarizes it). Forced tools (`buildForcedToolQueue`) are capped at
  `GENERATE_MAX_ITERS - 1`, deterministic triggers first, and the final iteration pins
  `tool_choice:'none'` (§28).
- **JUDGE must see everything GENERATE saw**: the full pre-fetched `llmContext` (with
  `biomarkers`/`dots` re-fetched fresh), `tool_calls_made` with real results, the **current user
  message** (a `remember_fact` of something just said is self-evidently grounded), the curated KB
  matches, and `detectAllRisks`. Each of those was added after a live regression where a correct
  answer was stripped as "unsupported"; don't narrow JUDGE's inputs.
- `runJudge()` downgrades REJECT → PASS when every violation's `correction_hint` is empty (a JSON
  self-consistency failure, not a real violation). The REVISE prompt forbids a bare-JSON-only
  rewrite.
- **Every action tail must be taught to PLAN and JUDGE** (`planTemplate.js`,
  `judgeTemplate.js`) or it is graded as an unsupported claim and burns REVISE rounds —
  `remember_fact`, `formulate_dots`, `recommend_product` all hit this. Keep JUDGE's
  DELIBERATELY NARROW clauses.
- `verifyBiomarkerGrounding` runs afterward for every intent, receiving `extraValidDates`/
  `extraValidValues` from `extractToolGroundTruth()` — so tool results must be **flat arrays**
  (a wrapper object harvests nothing) and dates **date-only** (§28).
- `_regenerateIfFabricationRisk` is superseded on this branch (`!useAgenticLoop`) and remains
  gated `personaType === 'viva'` on the classic path — a real open asymmetry, not drift.
- **Known systemic over-strictness:** JUDGE rejects on cosmetic differences ("41.0岁" vs "41岁").
  Not fixed; revisit if REVISE churn becomes user-visible.

## 22. Async Chat Delivery — Rules

FC **cancels an invocation the instant the HTTP client disconnects** (confirmed live), so any
turn that can outlive `wx.request`'s timeout must leave the request cycle. Full record:
[docs/ai-persona/06-chat-pipeline.md](docs/ai-persona/06-chat-pipeline.md).

- For `useAgenticLoop` on **real (non-sandbox) traffic**, `handlePostChat` publishes a
  `chat.generate` CloudEvent (`lib/chatEventBridge.js`) and returns `{processing:true}`; the
  worker's `eb-trigger` (`acs.chat` source) runs `handleChatGenerateEvent` on a separate
  invocation. `sandbox:true` and the non-agentic intents never take this branch. On publish
  failure it **fails open** and runs inline.
- **One tail, not two:** `finalizeChatReply()` is the shared grounding/action/save+notify tail for
  the sync callers and the event handler. `handleChatGenerateEvent` branches on `kind`
  (`formula_dots_generate` → `finalizeFormulaDotsGenerate`).
- **Dedupe:** EventBridge is at-least-once; `chat_generate_events` is claimed via
  `INSERT … ON CONFLICT DO NOTHING RETURNING` before any real work.
- **Credentials:** HTTP-triggered `context` is an empty object — use the env-injected STS vars
  (`ALIBABA_CLOUD_ACCESS_KEY_ID`/`_SECRET`/`_SECURITY_TOKEN`, `FC_REGION`), not
  `context.credentials` (`fc3-handler-reference` skill).
- **Delivery is two-channel and both must stay.** `GET /api/notifications` is a destructive read
  with no ack, so one lost poll response consumes the only copy. (1) `handleGetChatHistory`'s
  `since_id` poll takes `roles=coach,ai` while a turn is pending (`_chatWaitStartedAt`), de-duped
  on normalized text (`_aiKey`) and scoped to `AI_ECHO_TYPES` — types that also write a
  `chat_messages` row; `coach_reminder` is deliberately excluded. (2) A 250s watchdog
  (`DELIVER_DEADLINE_MS`, env `CHAT_DELIVER_DEADLINE_MS` for tests) races the work; exactly one
  terminal message via `_deliverTerminalMessage` + single-use `claimDelivery()`.
- **Every client wait goes through `_beginChatWait`** (`CHAT_WAIT_SYNC_MS` 30s for sync turns,
  285s for async) so a budget can never be left over from a turn of the other kind. Status
  captions (`notification_type:'chat_status'`) come from `runAgenticTurn`'s `onStatus` callback
  via `makeStatusNotifier()`. Failure text is localized by `user.language`.

## 23. Chat Scroll-to-Bottom: Short Last Messages Clipped on Real Devices

Found and fixed 2026-07-29 via a real-device screenshot: a short last message (e.g. a one-line reply to "Hi") sometimes rendered almost entirely hidden behind the `.ai-disclaimer`/`.input-container` bar at the bottom of the chat tab (`pages/main/`), while long messages (e.g. a full health report) always rendered correctly. Not reproducible in WeChat DevTools' simulator — only seen on a real device.

### Root cause

`scrollTop`/`scroll-into-view` are **no-ops when there's nothing to scroll** — a short message that fits within the scroll-view's viewport never overflows, so neither mechanism ever fires. Real WeChat clients (unlike the DevTools simulator) appear to sometimes not fully repaint a newly-appended last message into the `scroll-view`'s content box until something forces a relayout — which an actual overflowing scroll triggers, but a short non-overflowing message never does. This is why long messages (which always overflow and actively scroll) were unaffected while short ones clipped.

Two rounds of scroll-mechanism fixes were tried first and did **not** resolve it — worth recording so the same dead end isn't retried:
1. Replacing `_scrollBottom()`'s single blind `setTimeout(50ms)` with `wx.nextTick()` + two follow-up timers (120ms/500ms), to rule out a render-timing race.
2. Adding `scroll-into-view` (bound to the last message's DOM id, `id="m{{item.id}}"` in `main.wxml`) as a second, layout-aware scroll mechanism alongside the numeric `scrollTop` flip trick, to rule out a `scroll-view`-first-paint quirk.

Both were reasonable and are still in place (real, if secondary, improvements for the *overflowing* case — e.g. long messages, or the async agentic-loop status captions arriving via polling), but neither touches the actual bug, which only manifests when there's no overflow to scroll in the first place.

### The fix

`.chat-inner`'s (the scrollable content wrapper) bottom padding was bumped from `8rpx` to `200rpx` (`main.wxss`) — generous buffer well past the disclaimer + input bar's own height, so the last line of any message clears the clipping edge regardless of whether the underlying repaint quirk fires. This is the standard, low-risk mitigation for this bug class in WeChat Mini Programs — chasing the exact real-device relayout behavior further wasn't worth it once a reliable, cheap fix was in hand. **Do not shrink this padding back down** without confirming the underlying repaint issue is actually fixed, not just untested.

Files: `pages/main/main.wxss` (`.chat-inner` padding), `pages/main/main.js` (`_scrollBottom`/`_onChatImageLoad`, kept from the earlier rounds), `pages/main/main.wxml` (`scroll-into-view`/`data-id`, kept from the earlier rounds), `utils/config.js` (VERSION bump).

## 24. Health Advice Tool — Rules

`handlePostHealthAdvice` (`chat.js`) runs the same agentic loop **unconditionally for both
personas**, reshaping its fetches into the same `llmContext` contract `handlePostChat` produces
(`plan`/`questionnaire_context`/`sub_age_display_names` left `null`, not faked), so it reuses
`publishChatGenerateEvent`/`handleChatGenerateEvent`/`finalizeChatReply` with no new event type.
Record: [docs/ai-persona/06-chat-pipeline.md](docs/ai-persona/06-chat-pipeline.md).

- **`pages/main/main.js` and the web user-app's `chat/useChat.js` are wired async** (`opts.async:true`) —
  both run the two-channel poll (`hooks/useNotificationPoll.js` on the web). `pages/coach/coach.js`
  has no polling and stays synchronous; `coach.js`'s `_req` takes a `timeoutMs` and
  `runHealthAdvice` requests 180s (the loop measured ~167s).
- The synchronous tail is `finalizeHealthAdviceReply()` — same grounding-with-one-retry, returns
  `{success, message}` inline instead of writing `notifications`.
- `/health-advice` is exempt from `index.js`'s sandbox short-circuit alongside `/chat`; without
  it the toolbox button never worked in admin preview.

## 26. Knowledge Base — `knowledge_entries` — Rules

Viva's always-injected guardrail block and the keyword-matched curated KB both live in one table,
`knowledge_entries` (`tier` = `essential` | `optional`, `persona_type`), editable from the admin
panel's Content ▸ Knowledge sub-tab (superadmin). Record:
[docs/ai-persona/05-knowledge-base.md](docs/ai-persona/05-knowledge-base.md).

- `lib/knowledgeBase.js`: `getEssentialBlock(personaType)` (active essential rows, ordered by
  `sort_order, id`) and `findRelevantEntries(personaType, text, limit)` — the same in-process
  substring/tag match as before, **no RAG/embeddings**, no caching (tiny table).
- **On any DB error or zero rows, `FALLBACK_ESSENTIAL_BLOCK` ships** — a hardcoded copy kept so a
  transient error never sends a reply with no guardrails. That is why every essential-block
  wording change is a **three-site change**: the `knowledge_entries` row(s), `FALLBACK_ESSENTIAL_BLOCK`,
  and `prompts/chat/factConstraint.js`'s fallback. Instances so far: store-product narrowing
  (§37), refusal wording and tier-copy permission (§28). Drift here silently restores old
  behaviour only when the DB blips.
- **Fetched once per request, not per template**: handlers `await getEssentialBlock()` where they
  resolve `personaType` and thread it as `llmContext.essential_knowledge`;
  `getFactConstraintBlock(preloaded)` returns `preloaded || FALLBACK_ESSENTIAL_BLOCK`. The async
  event path needs no re-fetch — it travels in the event payload.
- An entry cannot be `status='active'` without `reviewed_by` (enforced in
  `handlers/knowledge.js`). Zero KB matches is not a failure signal.
- **Nano has zero `persona_type='nano'` rows seeded** — its PLAN/JUDGE always fall back to the
  default block (§16, `docs/ai-persona/09-known-issues.md`).

## 27. Personal Memory Facts — `user_memory_facts` — Rules

Durable per-user facts ("I don't eat pork") — distinct from `users.bio_data` (onboarding
checklist) and from `knowledge_entries` (general science). Record:
[docs/ai-persona/04-fact-checking-and-memory.md](docs/ai-persona/04-fact-checking-and-memory.md).

- **Not persona-scoped** (an allergy is true for both personas). `category` is a fixed enum
  (`dietary_restriction`/`allergy`/`preference`/`goal`/`other`, plus `condition` from §39),
  validated against a `Set` in `finalizeChatReply()` — never trusted from the LLM. Partial unique
  index on `(user_id, category, fact_zh) WHERE status='active'` powers the `ON CONFLICT` upsert;
  no fuzzy dedup or contradiction resolution by design.
- Written via the `remember_fact` action tail (same mechanism as `record_weight`/`set_reminder`);
  `stripActionJson()` and the final `.replace()` chain both know the pattern. A reply that strips
  to nothing falls back to `好的，已记录：<fact>` — never ships blank.
- **Recall is always-fetched**, not intent-gated (`fetches.user_facts` in `handlePostChat`,
  `handlePostHealthAdvice`, `handlePostFormulaDots`), rendered by `getFactMemoryBlock()` as a
  flat **uncapped** bullet list into ~14 templates — which is why `fact_zh` must stay short (§40's
  dot-deletion hazard). Extraction is wired into 5 chat templates + 3 report templates, not
  `science.js`/`reminder.js`.
- Consumers with teeth: `formulationQuality`'s `allergy_conflict` removes dots (§28/§40);
  `_filterProductsByUserFacts` suppresses store products (§37). A wrong fact is sharper than a
  wrong lab value.
- CRUD: `handlers/userFacts.js` at `/api/user-facts[?openid=/coach_id=]`, coach-scoped by the
  same `users.coach_id` ownership check as `handleGetCoachUserChat`; admin panel Facts tab and
  coach-app Facts tab.
- **`chat/nutrition.js` carries the "answer what was actually asked" rule** `chat/biomarker.js`
  has — JUDGE checks facts, not relevance, so a correct-but-generic status recap passes clean.

## 28. Dots Formulation, Packages & Orders (营养定制) — Rules

Moved to the `dots-formulation` skill (`.claude/skills/dots-formulation/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 29. Viva Proactive Daily Check-Ins — Rules

Viva initiates up to three in-app messages a day (`morning_checkin` 05–10h, `midday_checkin`
11–16h, `evening_checkin` 17–23h Shanghai; none 00–04h), triggered by the user's **own first
app-open within a period** (`last_active_at` via `/api/heartbeat`), not a clock slot. In-app only
— no WeChat push exists in this codebase. Record:
[docs/ai-persona/07-proactive-messaging.md](docs/ai-persona/07-proactive-messaging.md).

- Dispatcher "Scan 0" (`getCheckinPeriod()`, `dispatchToWorker()`) selects Viva-channel users
  with an `active` plan whose schedules for today are **scoped to that plan** (`s.plan_id = np.id`
  — superseded plans share dates), honours `users.preferences->>'daily_checkin_enabled'`, and
  dispatches `checkin.daily` CloudEvents to the **worker**, never the legacy `agent` function
  (which hardcodes "You are Nano"). Same-tick dedupe against the `user_online` scan via
  `checkinUserIds`.
- **The slot is claimed atomically before any slow work.** `migration_checkin_dedup.sql` adds
  `notifications.checkin_date` + a partial unique index on
  `(user_id, notification_type, checkin_date)`; `handleDailyCheckinEvent` opens with
  `INSERT … ON CONFLICT DO NOTHING RETURNING id` and returns if it loses. Without this, repeated
  foregrounding produced 2–3 duplicate messages per period (live bug, 2026-07-31).
- The claim row starts `status='claiming'`, **not `'pending'`** — the 3s poll would surface an
  empty pending row as a blank bubble and burn the slot. It flips to `'pending'` with content on
  success, `'failed'` on error.
- Content is a **single lightweight `qwen-plus` completion** (`prompts/viva/systemDailyCheckin.js`,
  one template parameterized by `period`), no agentic loop, no action parsing, no JUDGE. The
  most-elevated sub-age is picked **in code**, from `bioage_profile.SubAges` (never
  `data.actual`). Saved via `saveChatMessage(…, 'viva')` + a `notifications` row. No frontend
  changes.

## 30. Deploy DNS Workaround — `scripts/dns-override.js`

Ported 2026-08-08 from the sibling GCN repo (`/Users/pin/waven/gcn/scripts/dns-override.js`), which hit and fixed the identical issue for its own Aliyun FC deploys.

`s <fn> deploy` can fail with `getaddrinfo ENOTFOUND resourcemanager.aliyuncs.com` (or another `*.aliyuncs.com` host Serverless Devs resolves during deploy) — confirmed 2026-08-08: the system DNS resolver returned nothing for `resourcemanager.aliyuncs.com` while `nslookup resourcemanager.aliyuncs.com 8.8.8.8` resolved it fine. This is local/ISP DNS resolver flakiness, not an actual outage or a code/config problem — safe to reach for whenever this specific error shows up, no need to diagnose further first.

`scripts/dns-override.js` works around this **without touching any system/network settings** — it's a `--require`-loaded Node module that monkey-patches `dns.lookup` in that one process only, using `dns.Resolver` (Node's own c-ares client, independent of the OS resolver) pointed at `8.8.8.8`. Nothing persists after the command exits.

```bash
source .env && NODE_OPTIONS="--require ./scripts/dns-override.js" s worker deploy -t s-prod.yaml -y
```

Substitute the function name / `-t s-prod.yaml` as needed for other functions or the dev target.

## 31. Health-Plan-Focus-Linked Formulation & the GCN Custom-Formulation Bridge — Rules

A user's active health-plan **focus** (`health_plans`) biases which Dots their formulation
emphasizes, a committed formulation links back to the focus that shaped it, and a webview
`context` payload carries purchase intent through the GCN SSO handoff. Record (with its
superseded parts marked): [docs/architecture/health-plan-system.md](docs/architecture/health-plan-system.md).

- **Weighting is soft, never exclusionary.** `_resolveCandidateDotKeys(activeHealthPlans,
  dotsFormulary)` unions `health_plan_templates.recommended_dot_ids` (stores `key_name` strings
  — §11) across active focuses, or `null` for "no narrowing". `_fallbackCountForDot(dot,
  isRecommended)` lifts a recommended dot to 75% of its own range, 25% when a focus is active
  but the dot is off-list, midpoint with no focus — **never zeroes a non-recommended dot**. The
  agentic prompts say the same (`focusWeightingSection`). §40's food-sensitivity gut-axis dots
  ride this same additive channel — union, never replace.
- `nutrition_plans.primary_health_plan_id`/`secondary_health_plan_id` (nullable FKs,
  `ON DELETE SET NULL`) record the focus at formulation time; `handleGetHealthPlanDetail`
  returns a `formulation` field (day-0 dot breakdown of the plan linking back to *this* focus)
  or `null`, which the plan-detail overlay renders as chips or a "run Formulate Dots" hint.
- `users.custom_formulation_purchased_at` is nano's **entire** signal that a user ever bought a
  custom formulation, set by GCN via `POST /formulation-purchase-confirmed` (plain UPDATE). Since
  §28d the live order list comes from `fetchFormulationOrders`; don't build on this timestamp
  for anything order-shaped.
- **`webview_tokens.context` (JSONB)** carries an arbitrary intent
  (`{intent:'buy_custom_formulation', nutrition_plan_id}`, `'view_product'`,
  `'redeem_formulation_code'`, …) from the miniapp's `openUserApp(path, context)` →
  `POST /webview-token` → `POST /exchange-webview-token` → GCN's `dashboard.html` verbatim. **A
  new intent is a new `context` shape, not a new endpoint.**
- `GET /formulation-checkout-snapshot?planId=&openid=` (`GCN_ALLOWED_PATHS`) validates a purchase
  against the buyer's real recipe — `openid` is what GCN resolved from its own SSO session, never
  trusted client input. Always 200 with `{valid, reason}`; callers branch on `valid`. Day 0 is
  read because it is never an N7 isolation day.
- **Superseded, do not resurrect:** `handleNutritionTopupEvent` and `_commitNutritionPlan` were
  removed 2026-08-28 (§28 — nothing creates a plan on a timer); nothing on the server emits
  `formulation_reorder_ready` any more (the client still lists it in `AI_ECHO_TYPES`, harmless).
  `/health-plan-templates` is **not** in `GCN_ALLOWED_PATHS` today.

## 32. Shared PolarDB Cluster with GCN — Rules

**Cluster `pc-uf6ttj5kse63r270k` is not nano-exclusive**: it hosts `nano_db`/`nano_db_dev`/
`nano_db_test` **and** GCN's `gcn_db`/`gcn_db_dev` (same public endpoint, different database
name). Either side's connection behaviour can take the other down — on 2026-08-16 nano's
unbounded pools (181 of 227 backends) locked GCN prod out. Incident record:
[docs/deployment.md](docs/deployment.md) (appendix).

- **Every `new Pool({...})` in all five `db.js` copies** (`worker`, `dispatcher`, `agent`,
  `lab`, `kino`, both the `DATABASE_URL` and discrete `DB_HOST` branches) carries
  `max: 5, idleTimeoutMillis: 10000`. Never add a pool without it. `worker/lib/estimator/db.js`
  is Tablestore, not Postgres. The MCP function uses `max: 2` (§41).
- PolarDB Serverless scales on **CPU% only** (`ScaleMax: 4`, threshold 85); a pile of idle open
  connections is invisible to it. The per-container cap lowers but does not remove the ceiling
  (~200 connections at 1 PCU); no FC concurrency cap was added.
- **If connections fail again, first run `pg_stat_activity` grouped by `usename`/`datname`** on
  this cluster — nano and GCN are neighbours on shared infra.

## 33. Multi-Phone & Email Identity — Rules

A user can hold several verified phones (`user_phones`) and, on Waven-root channels, several
verified emails (`user_emails`), and log in with **any** of them. Full detail:
[docs/architecture/multi-phone-system.md](docs/architecture/multi-phone-system.md) (§6 for email).

- **`users.phone`/`phone_verified_at` are a denormalized cache of the primary row**, never a
  second source of truth — every phone-changing path calls `syncPrimaryPhone`
  (`handlers/users.js`, `phone-otp.js`, `login.js`).
- **Login matches through `user_phones`, not `users.phone`** (`handlePhoneOtpVerify`) — any
  verified phone resolves to the same account, including an admin-added unverified one once a
  real OTP succeeds (known cosmetic gap: that row's `verified_at` is not set retroactively).
- `POST /admin-phone-add` attaches a number with no OTP proof, so it is gated by
  `requireAdminTab(adminCtx, 'users')`, **not** under `/phone-otp/`'s bearer exemption. The
  pencil-icon `UserModal` is read-only for phones; the Phones tab in `UserDetailModal` mutates.
- **GCN's `handleNanoSSO` resolves by `nano_user_id` first**, phone only as fallback, and mirrors
  nano's **full** phone list into GCN's `user_phones`, reconciled exactly; `partners.phone` is
  synced via `syncPartnerPhoneFromUser` from every phone-changing call site.
- **Email** (2026-09-15): `handlers/email-otp.js` mirrors `phone-otp.js`; DirectMail
  (`lib/email.js`, sender `DM_ACCOUNT_NAME` — empty logs the code instead of sending) only
  delivers; nano owns the code lifecycle (`lib/email-otp.js`, `email_otp_codes`). Allowed by the
  channel **root** (`resolveRootChannelKey`), deliberately not `GCN_LINKED_CHANNEL_KEYS`. No
  backfill of legacy `users.email`. `WEBVIEW_USER_SELECT` now returns `email_verified`, `emails[]`
  and `channel.root_key_name` — the last **arms GCN's channel/sector guard**, so verify an
  `aeviva-china` user still enters `aeviva.gcn.net` after deploying it.
- **GCN linkage is resolved through the channel tree** (`lib/channels.js` `resolveGcnSector`,
  `GCN_SECTOR_FOR_ROOT_CHANNEL = {aeviva, waven}`; admin panel `gcnSectorForChannel`; miniapp
  `GCN_STORE_HOST_FOR_CHANNEL`). The six `GCN_LINKED_CHANNEL_KEYS` copies are gone; don't
  reintroduce a leaf-key set. `fetchFormulationTiers(sector)` carries the sector.

## 34. Digital Twin Terminology & Layer Taxonomy — Rules

"Digital Twin / 数字孪生" is the umbrella for a user's **entire** health model — never a single
data source. Canonical definition: [docs/architecture/digital-twin.md](docs/architecture/digital-twin.md).

| # | ZH | EN | Backing |
|---|---|---|---|
| 1 | `精准检测` | `Precision Testing` | `biomarkers(kino_chip)`; `health_twin.latest_bio_age/latest_sub_ages` |
| 2 | `日常监测` | `Daily Monitoring` | `health_events(sleep\|activity\|vitals\|body_composition\|ecg)`; `health_twin.avg_*`, weight/BMI/body-fat, `trend_data` |
| 3 | `医疗记录` | `Medical Records` | `health_reports`; `health_events(lab_result)`; `health_documents`; `health_twin.latest_lab_data` |
| 4 | `个人档案` | `Personal Profile` | `users.bio_data`; `questionnaire_responses`; `user_memory_facts` |

- **Interventions are deliberately not a layer** (`health_plans`/`nutrition_plans` own the Plans
  tab). **Any new health data surface must declare its layer**; if it fits none, question the
  surface rather than add a fifth.
- **Coupling rule** — these names change in four places together: `TWIN_LAYER_LABELS` + the
  `t.layer*` keys in both language blocks of `components/user-health/user-health.js` (WXML has no
  key checking — a renamed key renders empty), `prompts/chat/twinVocabulary.js`'s
  `getTwinVocabBlock()`, `src/web/user-app/src/i18n/health.js` (generated — `npm run sync:i18n`), and the layer table in
  `digital-twin.md`. The miniapp keeps the `KINO` brand in the layer-1 label.
- Ring/BP/weight data must render **ungated** by `subAgeList.length` — a bound ring with no Kino
  scan previously showed none of the user's own data.

## 35. Viva AG — External Deep-Analysis Agent — Rules

Moved to the `viva-ag` skill (`.claude/skills/viva-ag/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 36. AI 精准营养素 — the AG Dots Ordering Flow — Rules

Moved to the `viva-ag` skill (`.claude/skills/viva-ag/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 37. AI Store-Product Recommendation — Rules

Viva can suggest a GCN storefront's **non-Dots** products inside a health conversation. Reactive
only; it never volunteers one. Record:
[docs/architecture/store-product-recommendation.md](docs/architecture/store-product-recommendation.md).

- The essential block's "Dots formulary only / no purchase channel" rule is **narrowed, not
  removed**: formulary **or** a catalog explicitly provided in this prompt. Three sites change
  together (§26): `knowledge_entries` rows (`migration_knowledge_store_products.sql`),
  `FALLBACK_ESSENTIAL_BLOCK`, `factConstraint.js`. The company-business-info ban (prices,
  stock, delivery, promotions) is untouched.
- **Never feed `products.description` to the model.** The reviewed record is GCN's
  `product_ai_profiles` (`sub_age_targets` uses §11's canonical keys; `ai_recommendable` is
  admin-only and rejected without `reviewed_by`; a supplier write omits the flag rather than
  defaulting it false).
- **Reactive-only is structural**: the catalog is fetched only when the intent classifier's
  `required_data` includes `store_products` and the channel resolves to a GCN sector
  (`resolveGcnSector`). A classifier miss is the desired failure mode — no catalog, no
  vocabulary, rule collapses back to Dots-only.
- **The model picks, the server writes.** The `recommend_product` tail carries `sku_id` + one
  sentence; `_validateProductRecommendations` drops unknown ids silently;
  `_buildProductCardBlock` renders `:::product` from the same snapshot. **Prices are never shown
  to the model** — a number it was never given cannot leak.
- **Allergies are a code filter** (`_filterProductsByUserFacts`, before the catalog is rendered;
  bidirectional substring, biased toward over-suppression), not a prompt rule.
- PLAN and JUDGE are taught the tail; `detectFakeStoreProduct` covers a product named in prose
  but never picked. `detectAllRisks(reply, dotsFormulary, storeProducts)` — both call sites pass
  all three.
- Tap-through: `handleProductCardTap` → `_openAevivaStoreGated({intent:'view_product', sku_id})`
  → GCN's existing `?sku=` opener, which must `await loadMall()` first. A native handler is
  mandatory — chat prose cannot open an external link.
- Catalog is per-user and **store-scoped** (GCN `/api/mall/nano/ai-catalog`, via
  `partner_bindings` `consumer_store`, delegating to `handleStoreItems`); always 200, `{items:[]}`
  on any failure; `fetchAiCatalog` never throws, 4s limit. Every SKU with its own purchase flow
  (`is_custom_formulation`, `is_ag_formulation_bundle`, `viva_subscription_plan_key`,
  `grants_partner_type`, `package_only`, `is_parent`) is excluded.

## 38. 健康文档 — Health Documents Are Twin Data — Rules

Moved to the `health-documents` skill (`.claude/skills/health-documents/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 39. Document Extraction — a Second External-Agent Queue — Rules

Moved to the `health-documents` skill (`.claude/skills/health-documents/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 40. 慢性食物过敏 — Food-Sensitivity Panels — Rules

Moved to the `health-documents` skill (`.claude/skills/health-documents/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 41. MCP Server — Read-Only Data Access for the Analysis Workshop (2026-09-15)

`src/functions/mcp/` (`nano-mcp-dev`, `https://nano-dev.gcn.net/mcp`) exposes **both** dev
databases — `nano_db_dev` and `gcn_db_dev` — to MCP-compatible clients as five tools:
`waven_get_data_map`, `waven_list_tables`, `waven_describe_table`, `waven_search_columns` and
`waven_query` (one `SELECT`-shaped statement, row-capped). Bearer `MCP_API_TOKEN`. Deploy with
`npm run deploy:mcp`; run locally with `npm run mcp:local`. Full detail, including why the
Streamable HTTP transport is hand-rolled on FC's event-function model:
[docs/architecture/mcp-server.md](docs/architecture/mcp-server.md).

Three rules, each load-bearing:

- **Dev only, by construction.** `lib/db.js` refuses any database whose name does not end in
  `_dev`, and `s-prod.yaml` has no `mcp` block. Do not add an env switch to reach prod — that
  needs a read-only Postgres role and its own decision.
- **Every query runs inside `SET TRANSACTION READ ONLY`** (`withReadOnly()`), catalog lookups
  included. `lib/sql-guard.js` is the second layer (single statement, allowed leads, no
  `FOR UPDATE`/`pg_sleep`/`lo_*`/…); Postgres is the one that actually refuses writes.
- **Pools stay at `max: 2`.** Same cluster as GCN prod (§32).

**Scope is the whole of each dev database.** It connects as `nano_admin` / `gcn_admin` — the
application accounts — so every table, including `users.phone`, openids, chat text and GCN's
`ledger`, is readable; there is no allowlist and no masking. Narrowing it, if ever wanted, means a
read-only Postgres role with column-level `GRANT`s, not more regexes in the guard.

`lib/data-map.md` is what the model reads first — the cross-database join keys
(`gcn.users.nano_user_id` ↔ `nano.users.user_id`, `order_item_custom_formulations.nano_nutrition_plan_id`
↔ `nutrition_plans.id`, `partners.nano_partner_id`, `sectors.owner_nano_channel_id` ↔
`channels.key_name`) and the naming traps (§11's `key_name` rule, §17's `validated`-not-`actual`
rule, GCN's "no `stores` table"). Keep it current when a cross-repo key is added.

## 42. Check-in Programs (打卡计划) — Multi-day Curricula in the Chat Tab — Rules

Moved to the `checkin-programs` skill (`.claude/skills/checkin-programs/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 43. Per-User Health Report — `health-report` skill (2026-09-16)

A 50+ page, chart-rich, Chinese PDF that fuses **everything** a user has — every uploaded
`health_documents` PDF read in full, Kino/lab biomarkers, BioAge, epigenetic clocks, genome,
microbiome, food IgG, wearables, memory facts, plans, chat — into findings, an anti-aging
interpretation, a Dots recipe, lifestyle/diet plans, a physician summary and a follow-up calendar.
Load the `health-report` skill for any "health report / 健康报告 / analyze user X's data" request;
it holds the extraction and build scripts, the page/chart framework and the reasoning rules. Two
rules it encodes that matter beyond it: the platform's document extractor sees almost nothing in
a genome/IgG/microbiome/glycan report, so **read the PDFs**; and `annual_lab` rows flagged
`legacy` are demo imports that can contradict real results (grade C, exclude, explain).

Published reports are completed `viva_ag_jobs` rows (`claimed_by='claude-code-analyst'`) and
surface on the 数字孪生 subtab's **综合报告 card** (`GET /api/twin-reports`,
`handlers/twin_reports.js` — ownership-gated, not AG-entitlement-gated, files by index) and in the
Viva AG panel.

## 44. Wearable Insights — analysis over synced ring data — Rules

Moved to the `wearable-insights` skill (`.claude/skills/wearable-insights/SKILL.md`) on 2026-09-19 — invoke it before working in this area.

## 45. 心电节律 — ECG Rhythm Strips from the V8 Band — Rules

Moved to the `wearable-insights` skill (`.claude/skills/wearable-insights/SKILL.md`) on 2026-09-19 — invoke it before working in this area.
