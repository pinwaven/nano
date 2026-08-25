# Changelog

All user-facing changes must be reflected in **both** `src/web/user-app` and `src/mini/user-miniapp`.

---

## [Unreleased]

### Changed

- **微信同声传译 (`WechatSI`) plugin bumped 0.3.5 → 0.3.10** (`nano-miniapp/app.json`)
  - The upstream release note is 修复网络耗时过久问题 (fixes excessive network latency), which lands directly on the only path we use the plugin for: the chat tab's hold-to-talk voice input (`pages/main/main.js`'s `getRecordRecognitionManager()`), where the mic stays open until the recognition round trip returns `onStop`.
  - A pinned plugin version never updates on its own, so this is an explicit bump; no MP-console change is needed since approval is per-plugin, not per-version. No code changes — the `start`/`stop`/`onStop`/`onError` surface is unchanged across 0.3.x.

### Changed

- **Formulate Dots is now an evaluation tool — it no longer writes a plan, and shows the allocation as a chart in the chat** (`worker/handlers/dots.js`, `worker/handlers/chat.js`, `nano-miniapp/pages/main/`, `nano-miniapp/utils/markdown.js`)
  - The 28-day formula a user actually receives now comes from Viva AG's `dots_formulation` job, so the chat toolbox's Formulate Dots stopped committing: no `'pending'` `nutrition_plans` row is inserted, and nothing writes to `nutrition_plans` / `nutrition_schedules` on any of its three paths (async finalizer, EventBridge-publish fail-open, and the async error fallback).
  - **The numbers moved into the bubble.** A new `:::formula` display-card directive renders the proposed AM/PM allocation as two colour-segmented capsule bars plus a legend, using each dot's own catalog colour (`dots.color_hex`). Both bars are scaled against the larger capsule so their lengths are comparable rather than each filling the track.
  - The card is built **server-side from the already-validated recipe** (`_buildFormulaChartBlock`), never by the model, so the bars cannot disagree with the counts they draw; the renderer derives every total from the rows, so the arithmetic exists in one place only.
  - **The "查看方案" button is gone** (miniapp, `utils/tool-actions.js`, and the web user-app's `ChatTab.jsx`). It opened the Dots subtab, which this run no longer changes — it would have shown the user the *previous* plan while they were reading a new evaluation.
  - `handleNutritionTopupEvent` is deliberately untouched and still commits; its dispatcher scan matches users with no plan at all, so it remains what keeps the Dots subtab populated.

### Added

- **Viva AG `原粒定制` preset + a specified 28-day formula contract** (`nano-miniapp/components/viva-ag-panel/`, `worker/handlers/viva_ag.js`, `worker/docs/viva-ag-api.md`)
  - A fourth preset chip in the AG subtab's 发起分析 row, `原粒定制` / `Dot formulation` (`command_key: 'dots_formulation'`), asking the external agent for a custom Dots formulation designed from the whole digital twin.
  - The deliverable is **specified, not free-form**: a 28-day / 56-capsule formula attached as an `.md` result file in a fixed machine-readable layout (§8 of the API doc) — a summary table with a `total_dots` checksum, all 56 capsule rows written out individually as `<dot_key>x<count>` tokens, and a per-dot totals table. The format exists so downstream systems such as Aeviva's processing center can consume it rather than reading prose.
  - **Every rule is mirrored from nano's own formulator** (`handlers/dots.js`): 28 days, 56 capsules, ≤72 dots per capsule, per-dot `target_dots_min`/`target_dots_max` applied to the *daily* total rather than each capsule, `timing`/`timing_flexible` slot rules, pulse windows, and the `DOT-N7` isolation days where days 10–11 are `DOT-N7` alone at its max. The worked example is arithmetically correct against the live catalog, deliberately — it makes visible the trap that isolation days displace everything else, so an everyday dot totals 26 days across the cycle, not 28.
  - **Nano does not parse or validate the file** for now; the contract says so to the agent's authors rather than letting them assume a safety net. The formula also does not touch `nutrition_plans` — it stays a read-only artifact, per the original Viva AG design decision.
  - Also corrected a stale line in the same doc: the per-user daily job cap has been environment-configurable since 2026-08-23 (dev 50, prod 10), not a flat 3.

- **Viva AG report files — the external agent can attach `.pdf` and `.md` results, shown in the AG subtab** (`worker/handlers/viva_ag.js`, `nano-miniapp/components/viva-ag-panel/`, `utils/markdown.js`, `migration_viva_ag_result_files.sql`)
  - A job now carries up to **5** artifacts (`viva_ag_jobs.result_files`) instead of a single file, so the agent can hand back a rendered PDF *and* its markdown source rather than choosing. `result_oss_key` is still written with the first file, so legacy rows and any single-file caller are unaffected.
  - **Allowed types are `pdf`, `md` and `txt` only**, refused at `/viva-ag/result-upload-url` before the upload is spent. The miniapp is the only consumer, and `wx.openDocument` **cannot open markdown** — its `fileType` list is `doc/docx/xls/xlsx/ppt/pptx/pdf`, so an `.md` handed to it fails in the user's hands. PDFs open in the system viewer; markdown and text download and render **in-app** through a new `.ag-viewer` overlay.
  - Every submitted key is prefix-confined to its own job, type-checked, and verified to actually exist in OSS (`headObject`) — a key that was minted but never PUT would otherwise become a download button that fails. Any bad file refuses the whole submission, so a half-committed result is never delivered. `oss_key` never leaves the server; the client addresses files by index and gets a fresh 300s signed URL per tap.
  - **Rendering an externally-authored `.md` is treated as a trust boundary.** New `mdToHtml()` in `utils/markdown.js` deliberately does *not* interpret `:::` display-card directives the way `mdToSegments()` does — the same injection surface that already makes result *summaries* get stripped. Links are neutralised to plain text, because mp-html's `linkTap` calls `wx.navigateTo` for any scheme-less href, which would let a report push the user into an arbitrary page of the miniapp. Raw HTML was already escaped by the existing parser.
  - Reports surface as chips on the job card in the AG subtab (one tap, no sheet to open) and as a titled file list with sizes inside the job detail sheet.
  - Verified against dev and real OSS: both files uploaded and submitted together, foreign-prefix / never-uploaded / unsupported-type / over-count submissions all refused, PDF sorted first, filenames sanitised, both files downloaded by index with matching sizes and content types, markdown round-tripping byte-for-byte, and — in WeChat DevTools — a real `.md` fetched from OSS with `wx.downloadFile` and rendered end to end.

- **Viva AG (Advanced Generation) — an external deep-analysis agent, its job queue, and health-record PDF management** (`worker/handlers/viva_ag.js`, `handlers/health_documents.js`, `lib/twinBundle.js`, `lib/vivaAgAccess.js`, `nano-miniapp/components/viva-ag-panel/`, 3 migrations)
  - A user holding the **Viva AG add-on** gets a second subtab inside the health tab where they manage PDFs of hospital records and issue long-running analysis commands. An external agent pulls each job, reads a full digital-twin bundle plus those PDFs, and posts a result back, which is delivered into the user's chat.
  - **The entitlement is an add-on column (`users.viva_ag_expires_at`), not a third persona.** The regular chatbox stays powered by Viva; AG is only active in its own subtab. Making it a `persona_override_type` value would have forced a third branch through every prompt-routing site, `chat_messages.persona_type` and the dispatcher's inlined SQL copy — for a feature that changes none of them. Grants reuse the existing `persona_subscription_grants` audit table with `persona_type='viva_ag'`; every gate composes `hasActiveVivaAgAccess()` with the Viva check the chatbox paywall already applies, so AG can't be more permissive than Viva itself. Admin-grant only for v1; the one-migration upgrade path to redeem codes is written into the migration comment.
  - **No EventBridge and no cron, deliberately.** CLAUDE.md §22's CloudEvent machinery exists for exactly one reason — FC cancels an invocation when the HTTP client disconnects — and Viva AG has no nano-side long work: enqueue is one INSERT, and delivery is two INSERTs inside the agent's own result request. Lease expiry is swept lazily at the top of the claim handler and the user's job list instead of by a scheduler.
  - **`result_token` is a fencing token, rotated on every claim.** It is simultaneously the submission credential and the idempotency key: a worker whose lease expired and was re-claimed holds a stale token and is rejected, so two workers can never both write a result and no separate idempotency key is needed. `FOR UPDATE SKIP LOCKED` on the claim gives two concurrent pollers two different jobs — verified with three simultaneous claims against a one-job queue.
  - **Large files never pass through Function Compute.** The response envelope base64-encodes binary bodies, so proxying a 50 MB PDF would inflate it ~33%, buffer it in the worker and hit FC's response ceiling. Every download is a direct-from-OSS presigned GET, which also makes HTTP Range (chunked/resumable transfer) work for free. Verified end to end with a real 16 MB PDF: `206` on a range request, MD5 of the full download matching the stored ETag.
  - **Content-Type is fixed at upload, not overridden at download** — this bucket rejects a `response-content-type` override outright (`400 InvalidRequest`, "Can not override response header on content-type", confirmed live), so `generatePresignedPutUrl` now takes an optional real content type. `generatePresignedGetUrl` gained an optional `filename` that sets an RFC 5987 `Content-Disposition`, so a PDF arrives named `2026年度体检报告.pdf` rather than a hex key.
  - **The twin bundle is pseudonymous.** No `/viva-ag/*` response carries a `user_id`, openid or nickname — `job_uid` is the only handle, so a leaked service token can drain the queue but cannot enumerate users or reach a twin it wasn't handed a job for. There is deliberately no "fetch the twin for an arbitrary openid" endpoint.
  - **The API documents itself**: `GET /viva-ag/docs` (Markdown) and `GET /viva-ag/openapi.json`, served from files that ship inside the worker's own code directory so the contract cannot drift from the implementation. A check asserts the spec's paths and the token's allowlist agree in both directions.
  - Documents go in a new `health_documents` table rather than `health_reports` — that table means "a parsed lab report" (mandatory `report_date`, observations, `health_events` children) and a discharge PDF has neither. Delete is a soft delete so a job holding a 6-hour URL isn't broken mid-run. Declared as twin layer 3, Medical Records, in `docs/architecture/digital-twin.md`.
  - Documents are **not** routed through `/oss/presign`: that endpoint performs zero authorization on a client-supplied key and would hand a signed URL for any object to any caller holding the app token. Keys are minted server-side under `health-documents/<user_id>/`, registration rejects anything outside the caller's own prefix, `oss_key` is never returned to the client, and user-facing URLs live 300s instead of ten years.
  - `saveChatMessage` and `_deliverTerminalMessage` now return their inserted ids (every pre-existing caller ignores them) so a job can record exactly what was delivered; `viva_ag_result` / `viva_ag_failed` were added to `AI_ECHO_TYPES`, without which the bubble renders twice once the history-replay backstop and the notification poll both fire.
  - Fixed along the way: `DATE` columns were shipping as UTC instants (`scheduled_date` for 2026-08-16 serialized as `"2026-08-15T16:00:00.000Z"` — the **wrong day** to any consumer), found by an ISO-leak scan over a real bundle and fixed with explicit `::text` casts.
  - **Upload offers two sources.** `wx.chooseMessageFile` (the only way to get a PDF in a Mini Program) additionally requires the 「选中的文件」 scope to be declared in the MP console's privacy guidelines — without it WeChat rejects the call with `api scope is not declared in the privacy agreement` (errno 112), and no runtime consent flow can rescue it because the failure is a missing *declaration*, not a missing *consent*. Photo capture via `wx.chooseMedia` reuses the scope the chat tab's image upload already has and works with no console change, so it is offered alongside and named in the error message. The PDF branch now distinguishes cancel (silent) from a scope error (explanatory modal) from a generic failure (toast), following `fetchWechatAddress`'s precedent — the first cut swallowed every failure and made the button look dead.
  - The per-day cap is `VIVA_AG_MAX_JOBS_PER_DAY` (dev 50, prod 10, code default 3) rather than a constant — a hardcoded bound made the feature untestable after three runs. `GET /viva-ag/jobs` now reports `daily_limit`/`daily_used` so the panel disables submit and shows the remaining count before the user composes a request that would be refused, and each refusal reason (`daily_limit_reached`, `job_already_active`, `viva_ag_inactive`) gets its own message instead of a generic "please retry" that is both uninformative and wrong — retrying a quota refusal never succeeds.
  - Accepts the formats a clinic actually hands out — PDF, Word, Excel, PowerPoint and images — not just PDFs, since asking someone to convert a file on a phone means the record never gets uploaded. `CONTENT_TYPE_BY_EXT` is the single source of truth: it gates the upload, supplies the type signed into the presigned PUT, and is what the external agent branches on. The picker uses `type: 'all'` so a report forwarded into a chat as an *image* is reachable (it would be invisible under `type:'file'`, and `extension` only filters that mode), validating client-side so an unsupported file gets named rather than silently hidden. The viewer now branches: `wx.previewImage` for images (which `wx.openDocument` cannot render at all) and `wx.openDocument` with a per-extension `fileType` for documents — the previous hardcoded `fileType:'pdf'` would have broken every Word and Excel file.
  - **Bulk history is paginated, not inlined.** The twin bundle stays a digest and gains an `inventory` block (per-resource counts, date ranges, per-category `health_events` breakdown, and the endpoint serving each) so the agent decides what to pull instead of probing; `/viva-ag/health-events`, `/lab-results`, `/biomarker-history` and `/chat-history` then serve it, and "fetch everything" is paging to the end. Chat history is opt-in and 90-day-windowed by default — the bundle is otherwise pseudonymous and transcripts routinely contain names and family details, so requesting one is a deliberate act; `user_memory_facts` already covers durable personal facts.
  - Two pagination bugs found by live testing, both easy to reintroduce: (a) a drain now pins `id <= snapshot` because these tables are append-only but *not* append-in-order — a ring sync backdates events by hours, so a row inserted mid-drain below the cursor was skipped forever; (b) the cursor carries Postgres's own timestamp text rather than a JS `Date`, which is millisecond-precision and silently truncated `timestamptz` microseconds — a 3523-row drain returned 3522, losing exactly the one row (`...18.054021`) that landed on a page boundary. Verified after the fix by draining all four resources at page sizes 7/50/500: twelve drains, each returning exactly its snapshot with no duplicates.
  - Deep-analysis replies are attributed to **Viva AG** in the chat rather than plain Viva, via a new `chat_messages.source` column rendered as a label above the bubble (same shape as the existing Coach label). It needs its own column: `persona_type='viva_ag'` would make the row invisible to the persona-scoped history query, so the bubble would flash once and vanish on reload, and `notification_type` isn't durable because notifications are read destructively. Both delivery channels set it and all three history queries select it.
  - Verified end to end: 39 backend assertions against dev, 18 more covering lease expiry/fencing/retry/cancel, the full external API over HTTPS (including a 403 on every non-allowlisted path), 24 UI assertions driving the real miniapp, and a complete journey — submit from the app, claim/heartbeat/complete as the external agent, reply rendered exactly once in the chat tab.

- **Sparklines on the chat tab's biomarker metric tiles** (`nano-miniapp/utils/biomarker-series.js`, `pages/main/main.{js,wxml,wxss}`)
  - Each `:::metric` tile now carries a micro bar chart of that biomarker's last 8 Kino readings plus a signed delta (`↑+25%`), coloured by whether the trend is an improvement.
  - **The series is built client-side from the user's own history, never from the model.** A trend is exactly the kind of number an LLM invents fluently: `verifyBiomarkerGrounding` only ever compares a reply against the latest snapshot, so a fabricated "your hsCRP has fallen every month since March" has nothing to fail against. Sourcing it from `GET /api/biomarkers` on the client makes the sparkline structurally incapable of showing a history that didn't happen — the model's only contribution to the tile is the label. As a side effect, a fabricated trend claim in the prose is now visibly contradicted by the chart beside it.
  - Reads `data.validated` only (CLAUDE.md §17) and only `test_type='kino_chip'` rows — `lab_import` also carries `validated` but comes off a different assay, and splicing the two would draw a step change that reflects the instrument, not the user.
  - A label that doesn't resolve to one of the six canonical keys renders **no** sparkline rather than a guessed one. Bare `CRP` deliberately does not resolve to `hsCRP` (`systemHealthReport.js` treats them as separate markers); aliases under 4 characters must match exactly, so `GA` cannot be pulled out of "Omega-3".
  - A near-constant series (relative spread <2%) renders level bars and no delta instead of amplifying assay noise into a full-height staircase.
  - Bars are views, not a `<canvas>`: a canvas in a long scroll-view needs a per-instance `SelectorQuery`, manual dpr scaling and an imperative redraw on every theme toggle and history append, and at 108×36rpx an 8-point line reads worse than bars anyway. They ride on `currentColor` at 0.55 opacity, which follows the theme with no `.theme-light` override — measured 4.55:1 (dark) / 3.18:1 (light) against the tile, clearing WCAG 1.4.11's 3:1 non-text bar; 0.40 measured 1.8:1 and was rejected.
  - No extra network call: `_initChat` already fetched `/api/biomarkers`, and a mid-session Kino scan folds its own result in via `appendReading` since `POST /api/biomarkers` returns verbatim what it wrote to `data.validated`.
  - 29 unit tests (`tests/biomarker-spark.test.js`) plus two contrast audits added to `tests/chat-card-contrast.test.js`. Verified live in WeChat DevTools against Pin's real 80-record dev history: 3 of 4 tiles resolved and rendered in both themes, the deliberately-unresolvable `Omega-3` tile correctly got none, and the worst-case row (`GDF-15 | 1240 | pg/mL`) left a 10px gap with zero overflow.

### Fixed

- **Health Advice (and any async agentic turn) could leave the user on "还在处理中" forever, even after the reply had been generated** (`worker/handlers/chat.js`, `worker/index.js`, `nano-miniapp/pages/main/main.js`, `nano-miniapp/utils/tool-actions.js`)
  - Reported from the miniapp: tapping 健康管理 showed the wait caption, then the "still processing, check back later" fallback, and nothing ever arrived. Traced on dev to a specific turn — request at 16:07:48, `chat_messages` row **and** its `notifications` row both written at 16:09:09 (81s later, well inside every budget) — the reply was generated fine and still never reached the device.
  - **Root cause: `GET /api/notifications` is a destructive read.** `handleGetNotifications` flips rows to `'sent'` in the same `UPDATE … RETURNING` that returns them, with no ack from the client. One poll response the app never receives — backgrounded mid-request (`onHide` also kills the poll timer), a network blip, a request timeout — consumes the only copy of the reply permanently. Every long turn sits in exactly that window.
  - **Fix (recovery):** `handleGetChatHistory`'s `since_id` poll takes a new `roles` param (default `coach`, so every other caller is untouched). While — and only while — a turn is actually pending, the miniapp asks for `roles=coach,ai`, so an AI reply that was written to `chat_messages` (not destructive) is picked up within one 3s tick regardless of what happened to its notification. Cross-channel de-duplication is keyed on normalised text and scoped to notification types that genuinely echo into `chat_messages`, so two identical `coach_reminder`s ("喝水" twice) are still two messages.
  - **Fix (guaranteed terminal message):** `handleChatGenerateEvent` now races its work against a 250s watchdog. `runAgenticTurn`'s 200s deadline plus the grounding check's extra ~60s call can legitimately reach ~270s against the worker's hard 300s FC ceiling, and a platform kill runs no JS at all — so the existing catch blocks could never have saved that case. Whoever finishes first (real reply, error fallback, or watchdog) delivers exactly one message, through both channels.
  - The failure text was hardcoded English ("I'm sorry, I'm having trouble connecting to my brain right now") and shown verbatim to zh-only Viva users; it is now localised, and distinguishes "took too long" from "something went wrong". The client's own last-resort message at 285s changed from the misleading "还在处理中，请稍后回来看看" to an honest "didn't finish in time, please try again" — by then both delivery channels and the server's own watchdog have all had their turn, so there is nothing still coming.
  - The wait-timeout check also moved **below** the chat-history catch-up in `_poll`, so a reply recovered on the same tick can't be overtaken by the timeout message.
  - Verified live in WeChat DevTools against Pin's real dev account, twice: once on the happy path (reply rendered, its now-redundant notification correctly suppressed as a duplicate rather than double-posted), and once with a DB-level thief marking every notification `'sent'` before the client could poll it — the page received **zero** notifications for that turn and the reply still landed, from `chat_messages`, at 76s. The 285s bound was also observed firing on a genuinely stranded page and producing the new honest message. 7 offline checks in `tests/chat-async-delivery.test.js` cover the watchdog (both channels written, single delivery, a late finisher posting nothing, localised timeout and error text) with `lib/db`/`lib/agenticChat` stubbed — `CHAT_DELIVER_DEADLINE_MS` makes the 250s deadline overridable so this needs no wall clock.
  - `runHealthAdvice`'s synchronous timeout raised 180s → 290s. 180s sat *below* the server's own worst case, so the callers with no polling fallback (`pages/coach`, the web app) were cancelling turns that were about to succeed — and an FC invocation cancelled by client disconnect destroys the in-progress work rather than delaying it.

- **JUDGE rejected replies that were entirely correct, burning a REVISE round each time** (`worker/lib/factCheck.js`, `worker/lib/agenticChat.js`, `worker/prompts/viva/judgeTemplate.js`, `worker/handlers/chat.js`)
  - CLAUDE.md §27 recorded this as known, systemic, and "too large a retuning" to take on. Measured properly it was worse than assumed: on two real health-advice drafts whose **every** biomarker value matched ground truth (hsCRP 1.8, IL-6 2.1, GA 16.5, CD38 1.5, GDF-15 600, CystatinC 0.85) and where the deterministic detectors found nothing, JUDGE produced **10 violations and REJECTed both** — a 100% false-positive rate.
  - Built an offline eval harness over captured real JUDGE inputs (2 positive drafts + 5 injected material errors as negative controls) so the prompt could be iterated at one ~25s call instead of one ~200s turn. **Baseline 6/10; final 19/21**, with all five negative controls at 3/3.
  - **Root cause: JUDGE was asked to do comparisons a machine should do.** `biomarkerStatus.js`'s own comment says `DIMENSION_BIOMARKERS` exists so JUDGE can "*mechanically* catch" a misattribution — but the map was only ever handed to the model to reason over, and it is measurably bad at it, producing openly self-contradictory output ("This is factually incorrect. According to dimension_biomarker_map, MicroVascularAge is indeed computed from CystatinC"). New `detectDimensionMisattribution()` does it in code — conservative by design (one dimension named, a strong causal verb, a biomarker genuinely absent from that dimension's inputs). It returns **zero** hits on both real drafts and catches every injected misattribution.
  - The model's own `dimension_misattribution` flags are now discarded outright and the scan's findings injected instead; `dot_mismatch` is gated on the existing deterministic dot checks; and both scans' findings are applied **even when the judge response fails to parse** — previously the fail-open path returned before them, so a real code-detected error would slip through exactly when the judge was malfunctioning.
  - Violations now carry a `severity`, and only `material` ones can REJECT. Also dropped: rows whose own detail says the draft is right ("…matches ground truth. Correct.", "(This was a false positive — disregard.)") — five such rows appeared in a single verdict, all marked material. That filter requires the correction_hint to be empty or equally self-negating, so a genuine violation that merely discusses a neighbouring clause is still kept.
  - Prompt-side: `unsupported_science_claim` narrowed to *fabricated specifics* (named study, journal, year, N, p-value, % change, timeframe) — an empty knowledge base is no longer treated as evidence a claim is false, which mattered because `findRelevantEntries` returned zero excerpts on these turns. Explicit non-violation list for the observed patterns: a statement matching ground truth is never a violation "but then…"; omission is never a violation; the plan is not an allowlist; a dimension may be discussed with its own normal biomarkers; an elevated dimension with an in-range marker is expected, not a contradiction; persona framing (solar terms, East-Asian dietary perspective) is voice, not a factual claim; the four approved evidence-level phrases are pre-vetted hedges.
  - **Separately, a deterministic over-strictness costing a full extra LLM call on every turn:** `extractDateMentions` matched every date in a reply with no context, and the prompts have the model open with "今天是&lt;date&gt;" — so every reply reported a `tested_at` mismatch and triggered a ~40s grounding retry, unconditionally. Same bug class as the documented 2026-07-26 `set_reminder` date false positive, and the same reason `extractAgeMentions` right below it is window-scoped. Dates introduced as *today* are now skipped.
  - **Measured end to end: 266s → 93s on dev** (locally 257s → 110-149s), typical budget down from `judge:3, revise:2, rejudge:2` to `judge:1-2, revise:0-1`, with the grounding retry gone. 19 unit tests pin the deterministic layer.

### Fixed

- **The 健康管理 (Health Advice) tool timed out in the chat tab** (`worker/lib/agenticChat.js`, `prompts/viva/judgeTemplate.js`, `mini/nano-miniapp/pages/main/main.js`)
  - **Root cause: JUDGE was handed two conflicting biomarker sources under identical key names and no precedence rule.** `runJudge` builds its ground truth as `{ ...llmContext, biomarkers: <fresh> }`, and `llmContext.health_twin.latest_lab_data.markers` is an *external* lab panel (an uploaded report — the Medical Records twin layer) keyed by the very same names as the authoritative Kino panel, from a different and usually older test. For the reproduction account the two disagree on **5 of the 6 Kino-core markers** (hsCRP 1.8 vs 0.35, IL6 2.1 vs 1.1, GA 16.5 vs 12.8, …).
  - JUDGE therefore **oscillated**: round 1 "hsCRP is 0.35, not 1.8", round 2 "hsCRP is 1.8, not 0.35", round 3 flipped again on CystatinC — and REVISE dutifully complied each time. The turn could never converge, so it burned its **entire** budget (`judge:3, revise:2, rejudge:2`) plus a grounding retry on *every* health-advice turn.
  - **Second, compounding defect: the deadline check only stopped a stage from starting once the budget was already blown.** `timeLeftMs() <= 0` happily began a ~70s revise round with 1ms left. Measured live: JUDGE finished at 81s, re-judge round 1 at 149s, round 2 still started (51s left) and ran to 218s, then `finalizeChatReply`'s grounding retry added ~39s — **~266s**. Against the worker's hard **300s** FC invocation ceiling, a cold start was enough to push a turn over it and get it killed by the platform, delivering nothing at all and leaving `chat_generate_events` stuck at `claimed` (observed live).
  - **Third: the client gave up before the server was even out of budget.** The miniapp's safety timeout was 180s while `TURN_DEADLINE_MS` alone is 200s, so any turn using its full budget showed a spurious "still working" even when the reply landed moments later. Raised to 285s, which sits above the server's realistic worst case and below the 300s ceiling past which no reply can arrive.
  - Fixes: the external panel moves to its own clearly-labelled `external_lab_panel` key (with its collection date) instead of colliding inside `health_twin`, and `judgeTemplate` now states the precedence explicitly — `biomarkers` is the only authority for the six Kino-core markers, while the external panel is used solely to verify the ~17 markers the chip doesn't measure at all (ALT, HDL, HbA1c, eGFR, …), which is why it can't simply be dropped. Every stage (GENERATE iteration, JUDGE, REVISE round) is now timed, and the next one only starts if it actually **fits** in the remaining budget rather than merely finding it non-zero.
  - Verified by reproducing against a real dev account end-to-end: **266s → 198s**, event `done`, reply delivered. Locally the same turn went 257s → 203s with the budget correctly cut short (`judge:2, revise:1, rejudge:1`). 8 dev users have both panels and were exposed to the oscillation.
  - Note the remaining REJECT churn is the **pre-existing** JUDGE over-strictness already recorded in CLAUDE.md §27 (cosmetic/dimension-attribution nitpicking), not this bug — the fix here removes the guaranteed-every-turn oscillation and makes the loop unable to overrun its own deadline, rather than retuning JUDGE.

### Added

- **AI chat replies now have a real typographic system, plus three designed cards** (`mini/nano-miniapp/utils/markdown.js` (new), `pages/main/main.{js,wxml,wxss}`, `prompts/chat/outputFormat.js` (new), `prompts/{nano,viva}/chat/{biomarker,nutrition,science}.js`, `handlers/chat.js`, `lib/agenticChat.js`, `prompts/viva/judgeTemplate.js`)
  - **Root cause: there was not a single `.msg-html` rule anywhere in the codebase.** AI bubbles have rendered through `mp-html` for a while, but nothing ever styled its output, so everything fell back to the component's stock `node.wxss`: AI text used WeChat's **32rpx page default** (vs `28rpx` for the user's own bubbles, with no line-height), `._p` had **zero margin** so paragraphs were glued together, `._h1/._h2` were `2em`/`1.5em` with no margins, and lists indented by a hardcoded **40px** (not rpx) inside a bubble capped at 90% width. The prompts have been asking for markdown all along, so bold/lists/headings were arriving into a renderer with no styling for any of them.
  - `mp-html` is style-isolated (no `options.styleIsolation`), so `main.wxss` selectors cannot reach its output — prose styling now comes from a `tag-style` map (`MD_TAG_STYLE`), and cards are native page-scope views. **`tag-style` is deliberately static**: `mp-html`'s `properties` declares an observer on `content` only, so rebinding it on a theme toggle would never re-parse messages already on screen. Colour therefore rides on inheritance (which `.theme-light .message-ai` already flips) and card chrome uses tokens.
  - `mdToHtml` became `mdToSegments`, a block **segmenter** returning typed segments; only prose runs go through `<mp-html>`. Extracted to `utils/markdown.js` so it is unit-testable outside a 3900-line Page (39 tests).
  - **Markdown gaps closed:** tables, blockquotes, links, nested lists (2- and 4-space), task lists, `~~strike~~`. Wrapped lines now collapse into one `<p>` joined with `<br>` while a blank line becomes real rhythm — previously every source line was its own zero-margin `<p>` and a blank line emitted a stray bare `<br>`.
  - **Fixed: `---` rendered nothing.** `mdToHtml` emitted `<hr>`, which is absent from `rich-text`'s tag whitelist — a silent no-op. It is now a rendered rule segment.
  - **Fixed: an AI message with both an image and text silently dropped the text** (a `wx:elif` chain). The image is now a sibling `wx:if`, and a new `imageOnly` flag stops such a bubble from losing its padding to `.msg-bubble-image`.
  - **Fixed: `**bold**` inside a backtick span was processed as bold, and the unanchored `_x_` rule mangled `user_id` / `DOT_N7`.** The inline pass now stashes code spans before transforming and requires word boundaries for `_italic_`.
  - **Fixed: link taps showed a hardcoded Chinese toast** from `mp-html`'s own `linkTap`, regardless of the user's language. Handled locally now with a localised action sheet.
  - Ten message-construction sites (two of which skipped markdown conversion entirely, and two more the original survey missed) collapse into one `_makeMsg` factory. Nothing rendered is written back to the server — the persist path still posts its own raw argument.
  - New cards, emitted via `:::metric` / `:::takeaway` / `:::dots` fences: biomarker value tiles with status colouring, a key-takeaway callout, and dot recommendation chips. `:::` was chosen over a JSON code fence because the same `chat_messages` rows are also rendered by the coach app and the web user-app, and on those (and on a stale cached miniapp build) a fence degrades to readable lines rather than a wall of braces.
  - Markers are gated on `client: 'miniapp'` **and** `CHAT_MARKERS !== 'off'` (a no-deploy kill switch), and wired into only the six long-form templates. `casual`/`emotional`/`record`/`reminder`/`systemDailyCheckin` are deliberately left alone — they ban markdown or are one-line transactional turns.
  - **Contrast: the global `--success`/`--warn`/`--danger`/`--info` tokens are audited against the page background, but the cards sit on a tinted surface layered over the bubble.** Reusing them there measured **2.86:1–4.26:1** — the same failure mode as the light-theme incident. New `--chat-*` tokens re-solve the same hues against the actual composited backgrounds; every pair now clears **5.1:1** in both themes, pinned by `tests/chat-card-contrast.test.js` so a future tweak can't silently regress it.
  - Bubble chrome: AI bubbles go full-width (user stays at 84%) with more padding, and a time separator appears between messages more than 30 min apart — the agentic loop delivers replies minutes later via polling, and history spans days with no marker at all today.
  - Backend guards: `stripTrailingQuestion` is now fence-aware (its sentence regex excludes `\n`, so a trailing `:::` made the fence itself the "last sentence" — an invitation *inside* a takeaway would have shipped, defeating a backstop that exists because prompting alone was proven insufficient); REVISE gains a `directivePreserveBlock` mirroring the existing `actionPreserveBlock`, since a revise round has already been observed silently dropping a trailing tag no violation mentioned; and JUDGE is told the fences are display markup.
  - Verified live in the DevTools simulator: cards render two-up, `--`- rules render, theme colours flip, and the resolved `tag-style` reaches `mp-html`'s parsed nodes with rpx correctly converted. 63 unit tests across the segmenter, contrast, and the backend guards.

### Fixed

- **Light theme was largely unreadable; every text surface now meets WCAG AA (4.5:1)** (`app.wxss`, `pages/main/main.wxss`, `components/user-health/user-health.{wxss,wxml}`, `pages/coach/coach.wxss`, `pages/{referral,phones}/*.wxss`, `components/avatar-picker/avatar-picker.wxss`)
  - **Root cause: `page` sets `color: #EEF2FF` for the dark theme, and the `.theme-light` block only ever redefined CSS *variables* — never `color` itself.** So every element without an explicit color rule inherited near-white text onto the cream background, measured live at **1.05:1**. Fixed by setting `color: var(--text)` on `.theme-light`, which re-roots inheritance for the whole light subtree (it also reaches into custom components, since inheritance is unaffected by style isolation).
  - The light palette had been built to mirror the dark theme's *hue* and was never checked for contrast. Darkened the tokens (`--blue` 2.46→4.89:1, `--text-sub` 4.43→5.52:1, `--text-muted` 1.79→4.64:1). `--blue` doubles as the primary button fill, so white-on-button went 2.63→5.22:1 too.
  - Added semantic **text** tokens (`--success`, `--warn`, `--danger`, `--info`, `--gold`, `--steel`, …) and swapped 126 hardcoded `color:` declarations onto them. Each token's dark value is byte-identical to the hex it replaced, so **dark theme is unchanged** (verified live). Backgrounds/borders keep their raw rgba tints.
  - Muted text used `rgba(var(--wave-rgb), 0.25–0.6)` — alpha tuned for a bright colour on dark navy. On cream, alpha itself is the blocker (even pure black at α=0.3 tops out near 1.9:1), so light theme gets opaque values via a 4-step ramp that preserves the original faint→strong hierarchy. 72 generated `.theme-light` overrides; base rules untouched.
  - Health tab status colours are applied as **inline** `style="color:…"` from `user-health.js`, which no class rule can override. A `<wxs>` mapper now maps each to a darker same-hue variant at render time (reactive to `theme` for free); chart fills/bars keep the bright originals since they're shapes, not text.
  - Verified live in WeChat DevTools via the automator, reading real computed styles: across all five tabs plus the health component, low-contrast text went from **80+ failures to 0** (the 14 remaining sub-4.5 hits are chart bar segments, decorative dots, and white-on-gradient bubbles — none of them text). Health-tab examples: `ht-lab-name` 1.32→4.88, `dt-metric-label` 1.92→5.32, `dt-sa-val` 2.62→5.82.

- **Status bar icons were nearly invisible in light theme** (`pages/main/main.js`, `pages/coach/coach.js`, `pages/referral/referral.js`)
  - These pages use `navigationStyle: "custom"`, but `app.json`'s global `navigationBarTextStyle: "white"` suits only the dark navy header — it never tracked the switch to light theme's cream header, leaving white clock/battery icons on a light background. Each page now calls `wx.setNavigationBarColor()` on load and on theme toggle.

### Added

- **Health tab (the Digital Twin) now refreshes when you return to it, instead of only on first attach** (`components/user-health/user-health.js` — new `refreshIfStale()`; `pages/main/main.js` — `switchTab`)
  - Chat writes into the twin (`remember_fact`, `record_weight`, report uploads), but the health component only loaded on `attached()` and on a `userId`/`lang` change — so anything stated in chat stayed invisible until the miniapp was restarted. Confirmed live via the DevTools automator: saying "我对海鲜过敏" in chat wrote `user_memory_facts` within ~20s, but the Personal Profile section still showed the old list after switching back to the health tab.
  - Uses the same 30s staleness guard `switchTab` already applies to the plans/dots tabs, rather than refetching on every tab tap.
  - Also: `_recomputeTwinLayers()` now counts `epigenetic_result` toward the Medical Records layer. It's a real 6th `health_events` category on dev that predates the taxonomy and isn't in the five documented ones; without it a user whose only outside test is an epigenetic panel showed that layer as empty.

- **Digital Twin reframed as the umbrella for a user's whole health model, with four named layers** (`prompts/chat/twinVocabulary.js` (new), `components/user-health/*`, `web/user-app/src/{i18n.js,tabs/HealthTab.jsx}`, `docs/architecture/digital-twin.md`, CLAUDE.md §34)
  - "Digital Twin / 数字孪生" previously meant the wearable rolling-average section and nothing else — the user manual defined it that way, and every prompt rendering `health_twin` was headed `DIGITAL TWIN (WEARABLE & LIFESTYLE DATA)`. It now names the whole model, split into **精准检测 / Precision Testing**, **日常监测 / Daily Monitoring**, **医疗记录 / Medical Records**, and **个人档案 / Personal Profile**.
  - Terminology + IA only — **zero schema change**. The `health_twin` row was never actually wearable-only (it already carried the latest lab panel and denormalized BioAge); the narrowness was in labels and layout.
  - Miniapp Health tab: new umbrella header with a four-chip completeness strip (derived from already-loaded data, no new fetch); section titles are now the layer names; `t.digitalTwin` was a dead string and is now the umbrella.
  - **Fixed: a user with a bound ring but no Kino scan saw none of their own data.** The health tags, weight/BMI/steps/HRV strip and photo-captured BP/glucose row were all inside a card gated on `subAgeList.length > 0`. They're now in an ungated sibling card.
  - **`user_memory_facts` got its first end-user surface** — a read-only list of the dietary restrictions/allergies/preferences the AI has noted, in the new Personal Profile section (self view only; the coach app already has its own Facts tab). Previously visible only to admins and coaches.
  - Prompts: new shared `getTwinVocabBlock()` teaches both personas the same four layer names the UI shows; `systemHealthAdvice.js` section headers renamed per layer; the `实时健康数据 / 近7天穿戴设备均值 / Wearable context` prefixes across `chat/{biomarker,nutrition,emotional}.js`, `systemFormulaGenerate.js` and `systemDailyCheckin.js` are now `数字孪生 · 日常监测` / `TWIN · DAILY MONITORING`.
  - Viva's persona copy claimed the twin was built from `遗传多态性` and `昼夜节律类型` — neither has any table behind it anywhere in the schema, a fabrication risk under the codebase's own fact-constraint rules. Rewritten to the four real layers.
  - Resolved a name collision: the legacy ILI/MFI/MRI/MVII block in the (orphaned) `prompts/systemReport.js` copies was called `数字孪生评分 / Digital Twin Scores`; it is now `生物系统评分 / Biological System Scores`.

- **Admin panel: Edit User modal now shows the real phone list (read-only) instead of a raw single-value override, with a link into the Phones tab** (`web/admin-panel/src/tabs/UsersTab.jsx` — `UserModal`, `UserDetailModal`'s new `initialTab` prop, `UsersTab`'s `detailInitialTab`)

  The pencil-icon "编辑用户" modal (`UserModal`) still had its own, separate single `phone` text field, untouched by the Phones-tab work below and unaware `user_phones` exists — two places that could both mutate the same account's phone, in different ways, with no relationship to each other. In edit mode it now fetches and shows the real `user_phones` list (primary/secondary/unverified badges, same as the Phones tab) instead of an editable input, and no longer sends `phone` in its own save payload at all — `handlePutUser` only touches `users.phone` when the key is present in the request body, so this modal genuinely can't mutate it anymore. A "Manage in Phones tab" button closes this modal and reopens the user detail drawer straight onto its Phones tab (`UserDetailModal` gained an `initialTab` prop for this, reusing its existing lazy-fetch-on-tab-switch logic rather than duplicating a fetch). Add-mode (creating a brand-new user) is unaffected — there's no `user_id` yet to fetch a phone list for, so the original single-value input is still how a new account's initial phone gets set.

- **Admin panel: "Add Phone" action in the user detail drawer's Phones tab** (`functions/worker/handlers/phone-otp.js` new `handlePhoneOtpAdminAdd`, `functions/worker/index.js` new `POST /admin-phone-add`, `web/admin-panel/src/tabs/UsersTab.jsx` new `PhoneAddModal`)

  Follow-up to the multi-phone work below — the new Phones tab could view/set-primary/remove a user's verified phones, but staff had no way to attach a genuinely new number (e.g. a user reports one over the phone but can't complete self-service OTP verification right now). Mirrors `handlePhoneAcceptUnverified`'s "no OTP proof" model but inserts into `user_phones` (not a direct `users.phone` overwrite), so it shows up in the same list as every other phone: `phone_verified_at` stays NULL unless the account currently has zero phones, in which case it becomes primary. Deliberately **not** routed under `/phone-otp/`'s bearer-auth exemption (unlike every other endpoint in that file) — attaching an unverified number to an arbitrary account with zero ownership proof needs the same `requireAdminTab('users')` gate every other admin user-write endpoint already has, so it's mounted at a separate `/admin-phone-add` path instead.

- **Self-service multi-phone management ("My Phone Numbers" miniapp page) + GCN identity anchored by `nano_user_id` instead of phone** (`functions/worker/handlers/phone-otp.js` new `handlePhoneOtpList`/`handlePhoneOtpRemove`, `functions/worker/handlers/partners.js` new `syncPartnerPhoneFromUser`, `functions/worker/handlers/login.js` `WEBVIEW_USER_SELECT` phones array, `mini/nano-miniapp/pages/phones/`, `web/admin-panel/src/tabs/UsersTab.jsx` new Phones tab; sibling `gcn` repo `functions/auth/index.js` `handleNanoSSO`)

  Nano's backend already modeled a user's phones as a list (`user_phones`, with `is_primary`) and already let `/phone-otp/bind` add a second phone without demoting the first — but nothing exposed that list: no GET endpoint, no UI in the miniapp or admin panel, and no way to remove a phone at all. Added `GET /phone-otp/list` and `POST /phone-otp/remove` (auto-promotes another verified phone to primary, or clears to a WeChat-only account if none remain), plus a new miniapp settings page (`pages/phones/`, reached from the main menu) to list/add/set-primary/remove phones self-service, and a read-only "Phones" tab in the admin panel's user detail drawer.

  Separately, tracing how this interacts with the GCN (Aeviva storefront) SSO bridge surfaced a real bug: `handleNanoSSO` resolved/created its consumer account by matching on a single phone value, writing nano's `user_id` only as a denormalized backreference — never as a lookup key. A user switching their primary phone in nano would silently get a second, blank GCN account on their next store visit, orphaning the first one's order history/referral position/ledger. Fixed on the GCN side: `handleNanoSSO` now resolves by `nano_user_id` first, falling back to phone-based lookup only for first-time/pre-migration accounts, and mirrors nano's *full* phone list (not just the current primary) into its own `user_phones` on every login — reconciled exactly (stale/removed numbers are dropped), so GCN's own native OTP login also recognizes any of a user's nano-verified phones. `partners.phone` (the separate cache used to push updates to a provisioned GCN store partner) is now kept in sync via `syncPartnerPhoneFromUser`, called from every call site that changes a user's primary phone (OTP bind/set-primary/remove, admin edit, WeChat bind/resolve) — previously only partner-record edits touched it.

### Fixed

- **Real users (incl. Pin) got a duplicate "查看营养方案" nutrition-plan chat message + notification every ~60 seconds, continuously, for 35+ hours — traced to a forgotten test-environment cron leaking into prod via a shared EventBridge source string**

  A long-abandoned `nano-dispatcher-test` Function Compute function (created May 2026, pointed at `nano_db_test`, untouched since June 30) still had a live per-minute cron. It never had its own `EVENT_SOURCE_SUFFIX`, so it published its `nutrition.topup` CloudEvents under the same bare `acs.dispatcher` source real prod's `nano-dispatcher` uses — the identical class of cross-environment leak already fixed for `acs.chat` on 2026-08-01 (see the comment at the top of `dispatcher/index.js`), but never extended to this stray function. Since `nano_db_test`'s copy of ~10 real users' data (apparently seeded from prod at some point, sharing the same `user_id`s) never reflected real completions, its "needs topup" query matched those same 10 users on every single tick, forever, and each event fanned out to **both** `nano-worker-test` (harmless) and real prod's `nano-worker` (because EventBridge rules can't distinguish the source). This was silent and harmless until `nutrition.topup`'s handler landed in prod worker (`handleNutritionTopupEvent`, `handlers/dots.js`) very recently — before that it was received and silently dropped. Confirmed via direct read-only prod queries: exactly 60 duplicate notifications/hour, no gaps, for 10 specific users, bloating `nutrition_schedules` to 2.15M rows prod-wide.

  Fixed live by deleting `nano-dispatcher-test`'s cron trigger and the two EventBridge rules that routed its events (`nano-worker-test-eb-trigger`, `nano-agent-test-eb-agent-trigger`) — no code deploy needed, fully reversible if the test stack is ever needed again (would just need its own suffix set up correctly first). Cleaned up ~37.7K storm-generated `nutrition_plans` rows (cascading to ~2.11M `nutrition_schedules` rows) and ~37.7K each of spam `notifications`/`chat_messages`, scoped tightly to the exact 10 affected users and the exact storm window (2026-08-16 08:38 UTC → 2026-08-18 23:31 UTC) — each user's current active plan and one representative notification/message were kept, and all pre-storm history was left untouched.

  Also found and fixed along the way: `nutrition_schedules.plan_id` has an `ON DELETE CASCADE` FK from `nutrition_plans(id)` but no index of its own — deleting the 37.7K stray plans against the then-2.1M-row table forced an index-less scan per deleted parent row and took 2.5+ hours before being cancelled; the same cleanup completed in seconds after adding `idx_nutrition_schedules_plan_id` (`migration_nutrition_schedules_plan_id_index.sql`, applied via `CREATE INDEX CONCURRENTLY` directly to prod during the incident, tracked/baselined afterward, plain form applied to dev). This index also protects the existing periodic supersede-and-reformulate paths (§25/§28-style dot reformulation) from the same slow-cascade risk going forward.

- **体成分 (body composition) twin card showed frozen fake demo weight/BMI/body-fat data — traced to a one-off seed script run against 4 real prod accounts** (`functions/worker/handlers/{chat,labs}.js`, `temp/cleanup-fake-seeded-body-composition.js`)

  User 陈柏颖 reported wrong weight (52.2 kg / BMI 20.6 / 23.8% body fat) on the health tab's digital-twin card. Traced the card to `health_twin.latest_weight_kg/latest_bmi/latest_body_fat_pct`, sourced from the newest `health_events` row with `category='body_composition'` — and found `temp/seed-demo-digital-twin.js` had inserted exactly those numbers directly into **prod** for 4 real accounts (Mary, test_echo, 吕凯, 陈柏颖) as a one-off demo, never cleaned up. Separately confirmed the underlying design bug that let stale data survive indefinitely: none of the app's 3 real weight-writing paths (manual weight-log task, chat's `record_weight` action, scale-photo AI extraction) ever wrote to `health_events` — all three wrote only to the legacy `biomarkers` table / `users.bio_data`, which `health_twin` never reads, so the card had no live writer at all.

  Fixed both problems: (1) all 3 paths now also write a `health_events` row (`category='body_composition'`, via new shared helper `_syncBodyCompositionTwin()`) and call `updateHealthTwin()`, so the card reflects real data going forward — deliberately never fabricates `body_fat_pct`, since nothing in the app measures it; (2) `labs.js`'s `updateHealthTwin(user_id)` call was separately found missing its `pool` argument, silently no-op'ing on every lab import — added; (3) deleted the 12 fake seeded rows and explicitly nulled the 4 accounts' `health_twin` body fields (confirmed `updateHealthTwin`'s COALESCE-preserving UPSERT can never do this itself — it only overwrites with a fresh non-null value, so deleting the source rows alone left the twin frozen at the stale numbers).

- **Halo/V8 "stress" score tracked HRV upward instead of inversely — confirmed inverted vs. its documented scale** (`mini/nano-miniapp/utils/wearable/{halo,v8}/index.js`, `docs/architecture/halo-smart-ring.md`)

  A prod screenshot for user Pin showed the HRV and Stress charts moving together (peaks aligning) rather than opposing each other, the opposite of the expected "higher HRV = lower stress" relationship. The raw 0x56/0x28 stress byte is undocumented by the OEM; our own reverse-engineered label (`Stress / tiredness index (0–100)`) assumed higher = more stressed, the standard direction, but the data pattern suggested it may run the other way. `_parseHrvRecords56()` and `getRealtime('pressure')` in `halo/index.js` now invert it (`100 - raw`) before it reaches the app. **Confirmed live 2026-08-02** via a real-device sync from Pin after the sync-batching fix below shipped (was initially flagged as inferred-but-unverified). Same fix applied to V8's `_parseHrvChunk` (`v8/index.js`), which shares this byte position — 0/no-reading sentinel preserved as-is so it isn't misinterpreted as a valid 100. Colmi/Aizo were not touched — different protocol entirely, not checked for the same issue.

  Backfilled Pin's dev `health_events.data.stress` (249 rows, scoped to their `user_id`) to match. Discovered along the way: `health_events.source` is hardcoded `'smart_ring'` for every wearable brand, so historical rows can't be scoped by brand from the DB — this backfill was necessarily user-scoped, not brand-scoped, and the same limitation applies to any future per-brand data fix.

  Separately, found that self-view's HRV/SpO2/Stress charts were rendering from a local WeChat-storage cache (`wearable_ring_data`, populated by the last BLE sync) rather than the server — so a DB-side correction like the above had no effect on what the device displayed until its next real ring sync. Switched self-view to always source chart data from the server (`_loadRingDataFromServer()`, previously coach-view-only) instead of the local cache, so it can never drift from what's actually persisted. Local storage is still used for BLE binding/connection state (inherently device-specific) and is still written after each sync (unchanged). Fixed a latent clobber bug surfaced by this change: `_loadRingDataFromServer()` unconditionally set `wearableId: '__server__'`, which would have overwritten a real bound device's ID (breaking "Sync Now") now that this path runs unconditionally for self-view too — it now preserves an existing real binding.

- **Wearable sync silently failing outright once the backlog exceeded 500 events — could never self-recover** (`mini/nano-miniapp/utils/wearable/sync.js`, `components/user-health/user-health.js`)

  The server-only chart switch above surfaced a second, unrelated, pre-existing bug: Pin's real-device sync updated the on-screen chart immediately (rendered from the just-synced in-memory data) but never actually landed in the DB — confirmed identical in both dev and prod, both stuck at the same `2026-07-26` timestamp. Root-caused via a direct diagnostic `curl` POST to `/api/health-events/sync` (worked fine, ruling out a backend bug) plus new error logging surfaced through WeChat remote debugging: `"max 500 events per sync call"`. `handlePostHealthEventsSync` hard-rejects the *entire* batch above 500 events, and `syncWearableData()` sent everything (HRV + SpO2 + temp + sleep + activity slots) in one POST — Halo's ~3-day cached buffer routinely exceeds 500 once there's any sync gap, and since the rejection is all-or-nothing, the backlog can never shrink on its own; every subsequent sync attempt fails the same way indefinitely. Fixed by chunking `events` into ≤500-event batches client-side, sent as sequential POSTs.

  Also fixed while diagnosing: `_commitRingData`'s push to the server used a bare `.catch(() => {})`, but `syncWearableData()` never actually rejects (its `wx.request` `fail` handler resolves `{success:false, error}` rather than throwing) — so that `.catch()` was dead code, and any real failure (this one included) was discarded with zero trace. Now inspects the resolved result and logs a `wearable server sync failed`/`...threw` line in dev builds.

- **Wearable binding (brand/mac/name) never reached the server for accounts bound before that sync existed, with no way to recover** (`components/user-health/user-health.js`)

  Confirmed directly against both dev and prod DBs: Pin's account (`37c8774e`) has been actively syncing ring data for months, yet `users.wearable_brand`/`wearable_mac`/`wearable_name`/`wearable_bound_at` were all `NULL` in both — the miniapp showed "Halo (X3B 53687) connected" from local storage alone, with nothing server-side to back it up. `_syncWearableBindingToServer()` only ever fires once, at the moment of a fresh BLE bind (fire-and-forget, no retry) — a binding made before that code path existed, or a bind-time PATCH that silently failed, had no way to ever reach the server afterward. Added `_ensureWearableBindingSynced()`, called on every load when a local device is bound: compares the local binding against the server record and only PATCHes when they actually differ, so it self-heals a stuck account like Pin's without spamming `wearable_bound_at` on every app open once they match.

- **Added `health_events.wearable_name`** (`schemas/migration_health_events_wearable_name.sql`, `mini/nano-miniapp/utils/wearable/sync.js`, `functions/worker/handlers/chat.js`)

  Follow-up to the two backfills above, which both had to be scoped by `user_id` instead of brand because `health_events.source` is hardcoded `'smart_ring'` for every wearable brand — there was no per-row way to tell which physical device synced a given historical reading. `syncWearableData()` now attaches the bound device's display name (e.g. `"X3B 53687"`, from `this.data.wearableName`) to every event as `wearable_name`; `handlePostHealthEvent`/`handlePostHealthEventsSync` store it, `handleGetHealthEvents` returns it. Migration applied to dev. Doesn't fully solve brand attribution on its own (the name string still needs interpreting, e.g. via `HALO_NAME_PREFIXES`/`V8_NAME_PREFIXES`), but it's enough to distinguish "was this the same physical ring" for any future per-device fix or backfill.

- **Server-loaded stress/HRV chart showed far fewer records than what was actually just synced** (`functions/worker/handlers/chat.js`, `components/user-health/user-health.js`)

  Reported for Pin in dev: pressing Sync showed 135 HRV records in-session, but logging out and back in (server-only load, per the fix above) showed only 32. Root cause confirmed by breaking down `health_events` by sub-type: `category='vitals'` bundles several independently-sampled streams — temp, hrv, spo2, resting_hr, realtime (differentiated only by `external_id` prefix, no dedicated category value) — sharing one `GET /api/health-events?category=vitals` row budget, hard-capped server-side at 200 regardless of what the client requests. Temp samples more frequently than hrv on Halo (499 vs 367 rows all-time for Pin), so it silently crowded hrv/spo2 out of the "most recent 200" window once a sync produced a large enough multi-type batch. Raised the cap on both sides (server clamp 200 → 1000, client request 200 → 1000).

- **Miniapp light theme: dozens of elements stayed dark-mode-tuned regardless of the user's theme setting** (`mini/nano-miniapp/pages/{main,coach,referral}/*.wxss`, `mini/nano-miniapp/components/{user-health,avatar-picker}/*.wxss`, `components/user-health/user-health.js`)

  Theming works via CSS custom properties (`--blue`, `--text`, `--navy-card`, etc.) defined as dark defaults on `page` in `app.wxss`, fully overridden to a warm cream/gold palette by a `.theme-light` class applied at each theme-aware root view. Any rule written with a literal hex/rgba instead of `var(...)` never participated in that swap and stayed frozen at its dark-tuned value. Audited and fixed all five theme-aware WXSS files:

  - `pages/main/main.wxss` — ~245 selectors fixed; the entire Academy/training tab and the guest signup/login sheet had **zero** light-theme coverage at all (dark navy cards, near-white text, blue accents all stayed frozen), plus scattered gaps elsewhere including a signup-flow error message at ~1.5:1 contrast on white (functionally unreadable, not just off-brand).
  - `pages/coach/coach.wxss` — ~85 selectors fixed; the Training tab (course cards, library/lesson rows, video player) had no light coverage at all, and the client search bar was a dark island on an otherwise light page.
  - `components/user-health/user-health.wxss` (shared by both the main app's Health tab and coach's client-detail view) — ~185 fixes; light coverage stopped partway through the file, so everything past that point (BioAge dashboard internals, wearable sync UI, report cards) was dark-only.
  - `pages/referral/referral.wxss` — 20 fixes, including low-contrast status/success/error text.
  - `components/avatar-picker/avatar-picker.wxss` — the selected-avatar ring was hardcoded brand-blue instead of `var(--blue)`, so it never re-tinted gold in light mode.

  A second, distinct bug found in the same pass: the Health tab's BioAge chart, weight chart, and per-metric trend charts (BMI/steps/HRV/stress/glucose) are drawn via `wx.createCanvasContext`, which paints literal colors — CSS custom properties never reach canvas draw calls, so none of the above WXSS fixes touch them. The BioAge chart in particular explicitly filled its whole canvas with a hardcoded near-black background (`#0a1228`) every render, so it would have stayed a dark box floating on an otherwise light-themed page regardless of any container-level fix. Added a `_chartPalette()` helper (`user-health.js`) keyed off `this.data.theme` and rewired `_drawWeightSparkline`, `_drawBioAgeChart`, `_drawWeightFullChart`, and `_drawGenericChart` to pull background/grid/text/dot colors from it; left each metric's own semantic line color (e.g. steps' sky blue, HRV's green) untouched since those are saturated, self-contained accents rather than text needing contrast correction.

  Left deliberately unconverted, matching this codebase's own established pattern: solid brand-gradient CTA buttons and their glow shadows, full-screen dark modal scrims, and the Kino device-mockup UI (`.ksm-*`) — these are meant to stay visually fixed in both themes. Admin, superadmin, login, and a few other pages have no theme toggle at all and were left out of scope (confirmed with the user) — a separate, larger feature to add if ever wanted.

  Not verified on-device/in-simulator (no WeChat DevTools automation available in this environment) — this is a thorough static contrast/coverage review, not a confirmed visual pass.

### Added

- **Per-user AI persona subscriptions, manageable from the web admin panel** (`schemas/migration_users_persona_override.sql`, `migration_persona_subscription_grants.sql`, `functions/worker/lib/{persona,personaOverride}.js`, `functions/worker/handlers/persona_subscriptions.js`, `web/admin-panel/src/tabs/{UsersTab,AIPersonaTab,PersonaSubscriptionsTab}.jsx`)

  Which AI persona (nano/viva) a user gets was previously channel-only (`channels.config.persona_type`), with a separate, superadmin-only, Viva-only paywall (`users.viva_subscription_expires_at` + code redemption) layered on top that could only gate access within an already-Viva channel — it could never put a Nano-channel user on Viva or vice versa. Generalizes both into one mechanism: a per-user, time-limited persona override (`users.persona_override_type`/`persona_override_expires_at`) that takes priority over the channel default while active (`resolveEffectivePersona()`), with the Viva paywall gate (`hasActiveVivaAccess()`) now just the `persona_type === 'viva'` case of the same state. Existing Viva subscribers are backfilled into the new columns and `viva_subscription_expires_at` is kept as a mirrored legacy column, so the existing GCN code-redemption/checkout-confirm flows are unchanged. Channel admins can now grant/revoke a persona subscription for any user in their own channel directly from the Users tab (new "AI Persona" row action, `PersonaSubscriptionModal`) — ownership-scoped the same way `UserCreditModal`'s backend already is, no new permission string needed. Superadmins get an additional cross-channel view (`AIPersonaTab`'s Subscriptions sub-tab, `PersonaSubscriptionsTab`) alongside the existing Viva-codes audit table. Every grant/revoke (admin-issued or code-redeemed) is logged to a new `persona_subscription_grants` audit table. No miniapp changes required — `GET /viva-subscription-status` now returns the resolved effective persona, and existing client logic already handles it correctly.

- **Viva proactive daily check-ins — morning/midday/evening** (`functions/dispatcher/index.js` new `getCheckinPeriod()`/Scan 0/`dispatchToWorker()`, `functions/worker/index.js` new `checkin.daily` EventBridge case, `functions/worker/handlers/checkin.js` new `handleDailyCheckinEvent`, `functions/worker/prompts/viva/systemDailyCheckin.js`)

  Viva now speaks first, up to 3x/day, asking whether today's dots have been taken and flagging one grounded thing to watch for — Viva-persona users only. Fires on each user's own first app-open within whichever Shanghai time-of-day period (morning 05:00–10:59 / midday 11:00–16:59 / evening 17:00–23:59) is currently active, reusing the existing `last_active_at`/`/api/heartbeat` recency signal the pre-existing `user_online` scan already keys off — not a fixed clock slot, since different users open the app at different times. In-app delivery only (waits in `notifications` for the next app-open, same as reminders/coach messages) — no WeChat subscribe-message push exists in this codebase. Content is a single lightweight completion (not the full PLAN→GENERATE→JUDGE→REVISE agentic loop), grounded in today's real scheduled dots and the single most-elevated BioAge sub-dimension (picked deterministically in code, not left for the LLM to compare). Deliberately bypasses the legacy `agent`/`proactive.js` FC function used for `user_online`/`reminder` triggers — that function is persona-agnostic and hardcodes "You are Nano," which predates the nano/viva split; routes through `worker` directly instead, via the same EventBridge dispatch pattern already used for `nutrition.topup`. A same-tick dedupe in the dispatcher prevents a Viva user's first open of a period from also triggering the legacy Nano-branded `user_online` nudge in the same run. Noted in passing (not fixed): `worker/index.js`'s CloudEvent routing had no case for `acs.dispatcher`/`nutrition.topup`, so that dispatch appears to silently no-op on a successful EventBridge publish — this feature's own event gets a correct, explicit case so it doesn't inherit the same gap.

- **`POST /partner-lookup-gcn`** (`functions/worker/handlers/partners.js` `handleGcnPartnerLookup`, wired in `functions/worker/index.js`, added to the `GCN_ALLOWED_PATHS` service-token allowlist)

  GCN's `lookupNanoDirectStore` (`gcn`'s `auth/index.js`) has called this exact path at login/webview-SSO time since the aeviva provisioning refactor, to decide whether to auto-create an unprovisioned GCN partner row at the caller's real nano tier instead of defaulting to plain `member` — but the endpoint was never actually implemented on nano's side, and wasn't allow-listed either. Every call 403'd/404'd, was swallowed by `lookupNanoDirectStore`'s `catch` (resolves to `null` on any failure, by design), and silently downgraded every not-yet-provisioned real partner to `member` on their first Store-tab visit. Found investigating a report of a real `leader_partner` showing up as plain `member` in GCN — see gcn's own `CHANGELOG.md` for the matching fix on its side (a second, compounding bug in how GCN ranks multiple partner rows for the same account). Thin wrapper around the existing `handleGetPartnerByPhone` logic (same phone/channel-subtree scoping), just exposed as a fixed POST path so it's allow-listable under the scoped `GCN_API_TOKEN`.

### Changed

- **Aeviva Store tab now re-checks `phone_verified` against the server instead of trusting the cached flag** (`mini/nano-miniapp/pages/main/main.js` `switchTab`/new `_checkPhoneVerified()`, `functions/worker/handlers/users.js` `handleGetUser`)

  Found while investigating a report of a specific prod user landing on GCN's login screen instead of auto-logging into the Aeviva store. Root cause: their account predates the forced-SMS-OTP migration (`phone_verified_at` deliberately left `NULL`, unbackfilled, for every phone already on file — see that migration's own changelog entry) and has never been re-verified, so GCN's `handleNanoSSO` correctly 403s (`phone_not_verified`). But `switchTab`'s gate checked `this.data.user.phone_verified` straight off the in-memory/locally-cached user object, which `app.js`'s `onLaunch` restores from `wx.getStorageSync('nano_user')` on every returning session **without ever re-syncing it against the server** — only a fresh `wx-login` call (skipped whenever a cached user already exists) updates it. Any account whose cache held a stale `true` would sail past the client-side "验证手机号" modal, open the GCN webview anyway, hit the 403, and silently dead-end on GCN's login page (`gcn`'s `ext-nano-sso.js` only `console.error`s an SSO failure) — no explanation, indistinguishable from the store simply not working. Fixed by having `switchTab` `await` a fresh `GET /api/users/:id` check (new `_checkPhoneVerified()`, added `phone_verified` to `handleGetUser`'s response) before deciding whether to show the verification modal or open the store, and writing the fresh value back to both `app.globalData.user` and `nano_user` storage so the cache self-heals. Falls back to the cached value on a network error rather than blocking store access outright.

- **Nano's own public domain: `nano(-dev/-test).fros.cc` → `nano(-dev/-test).gcn.net`** (`s.yaml`, `s-test.yaml`, `s-prod.yaml`, all four `mini/nano-miniapp/utils/*.config.js`, `pages/webadmin/webadmin.wxml`, `pages/qrlogin/qrlogin.js`, `web/admin-panel`'s `GcnInventoryEmbed.jsx`/`PartnersTab.jsx`, `web/user-app`'s `vite.config.js`/`ReferralTab.jsx`, deploy scripts, docs)

  Retires `fros.cc` for nano entirely now that `gcn.net` has its own ICP filing — nano no longer needs a separately ICP-filed domain of its own. `GCN_API_BASE_URL` (dev) now points at `edge-dev.gcn.net` directly instead of the old `gcn-dev.fros.cc` relay. DNS, TLS certs (borrowed gcn's `*.gcn.net` wildcard), and dev+prod deploys are done. Business-domain verification file (`QJaeMN3iR8.txt`, reused as-is) is now hosted and confirmed live on `nano.gcn.net`, `nano-dev.gcn.net`, `aeviva.gcn.net`, `aeviva-dev.gcn.net` (added the missing dev route in `s.yaml`; sibling `gcn` repo changes in its own `CHANGELOG.md`). **Still owed:** the actual WeChat mp console clicks (request-domain whitelist entry, clicking "Verify" on the business domain) — that's a QR-login-gated manual step, not something automatable.

- **`s-prod.yaml` was missing `GCN_API_TOKEN`/`GCN_API_BASE_URL`/`GCN_SERVICE_TOKEN` on the `worker` component entirely** (only `s.yaml`/dev ever had them) — found via a live repro of the Aeviva Store tab silently falling through to GCN's login page instead of auto-authenticating. Nano's prod worker was rejecting GCN's server-to-server `/exchange-webview-token` calls with a flat `401` (comparing the incoming token against `undefined`), which `gcn-auth`'s `handleNanoSSO` swallows into a generic "invalid or expired nano session" — indistinguishable from a real expired token without checking deployed env vars directly. **This means the Aeviva store SSO bridge likely never worked in production before this fix**, on any domain — probably only ever exercised against nano's dev environment. Fixed by adding the three vars to `s-prod.yaml` (same secrets dev already uses) and redeploying `nano-worker` prod. Sibling `gcn-auth`/`gcn-auth-dev` also redeployed to finally pick up the `NANO_API_BASE_URL` domain-migration edit from earlier, which had never actually been pushed. Worth an audit: other prod-vs-dev env var gaps may exist on nano's other prod functions (dispatcher/agent/lab/kino/media) — not checked, only `worker` was in scope here.

- **Aeviva GCN storefront webview: `edge(-dev).gcn.net` → `aeviva(-dev).gcn.net` (direct hostname)** (`mini/nano-miniapp/pages/main/main.js` `_openAevivaStore()`)

  Found via a live 体验版 (trial) repro: WeChat's `<web-view>` refused `https://edge.gcn.net/aeviva/dashboard.html` with "不支持打开" (business-domain check failure). Root cause — the earlier `edge(-dev).gcn.net` migration (below) picked a domain that never got a WeChat business-domain verification file hosted; only `aeviva(-dev).gcn.net` did. Both hostnames serve the identical `gcn/src/functions/web/site/aeviva/dashboard.html` (confirmed via `web/index.js`'s routing — `edge` strips the `/aeviva` path prefix, direct-hostname routing doesn't need to), so switching is a pure domain swap with no behavior change. Uploaded to the `waven` miniapp channel (`npm run upload:waven`) to ship the fix.

- **Aeviva GCN storefront webview: `gcn(-dev).fros.cc` → `edge(-dev).gcn.net`** (`mini/nano-miniapp/pages/main/main.js`, `mini/nano-miniapp/pages/appview/appview.js`)

  `gcn.net` obtained its own ICP filing (2026-07), removing the reason `_openAevivaStore()` routed through the `gcn(-dev).fros.cc` Nginx relay (an ICP-backed fros.cc proxy in front of the otherwise ICP-exempt `edge(-dev).gcn.net` FC domain, needed for WeChat's `<web-view>` business-domain check). The miniapp now opens `edge(-dev).gcn.net` directly. Sibling `gcn` repo changes: `web/index.js`/`s*.yaml` comments updated, ECS relay box renamed `gcn` → `ec1.gcn.net` and left running (unused fallback) pending the WeChat mp console business-domain cutover — see `gcn/docs/deploy.md`.

### Added

- **Avatar gallery picker replaces photo upload; avatar reacts to live wearable mood** (`mini/nano-miniapp/components/avatar-picker/`, `mini/nano-miniapp/utils/{mood,avatar-gallery}.js`, `components/user-health/`, `pages/verify-phone/`, `pages/main/main.js`, `functions/worker/handlers/{users,login,phone-otp}.js`, `schemas/migration_avatar_character.sql`)

  Onboarding (`verify-phone`) and the health-tab "change avatar" pill both used WeChat's native `open-type="chooseAvatar"` (upload/select a real photo). Replaced with a bottom-sheet gallery of 40 pregenerated character avatars, each with 4 mood variants (engaged/relaxed/restored/stressed) — pregenerated source images in `temp/avatar/moods/`, resized (300px full / 160px thumb, JPEG) and uploaded to the `waven-nano` OSS bucket via the one-off `temp/upload-avatar-gallery.js`, which wrote the URL manifest to `utils/avatar-gallery.js` (10-year signed URLs, same convention as existing `avatar_url`s).

  New `users.avatar_character` column (e.g. `'avatar-07'`) records which character was picked; `avatar_url` keeps storing the resolved image URL exactly as before (now the character's *relaxed* variant), so every other read site (coach client list, admin/superadmin panels, referrals, qrlogin) is unaffected. In the health tab's self view only, `utils/mood.js`'s `computeMood()` derives a live mood client-side from the already-synced ring data (stress/sleep/HRV/steps thresholds) and swaps the displayed image between the 4 mood variants — purely client-rendered, never written back to the server, so no extra PUT traffic on every wearable sync. No wearable attached/synced → always the `relaxed` default, per product decision. The old upload/OSS-presign round trip in `handleHealthChooseAvatar`/`verify-phone.js` is gone entirely — picking a gallery avatar just resolves a URL and PUTs it, no file transfer needed.

- **24 Solar Terms (二十四节气) seasonal framing for Viva** (`functions/worker/lib/solarTerms.js`, `functions/worker/handlers/{chat,dots}.js`, `functions/worker/prompts/viva/{systemNutrition,systemHealthAdvice,chat/nutrition}.js`)

  Viva (the Chinese-oriented persona, `channels.config.persona_type === 'viva'`) now frames advice and dots recommendations around the current solar term. `solarTerms.js` is a fixed 24-entry reference-date table (`{key, name_zh, name_en, month, day, season_zh, organ_zh, dimension, theme_zh}`, accurate to ~1 day) rather than an astronomical calculation — sufficient for narrative/dietary framing, no new npm dependency. `getCurrentSolarTerm(date)` does a linear scan for the latest term whose `(month, day) <= today`, falling back to the prior year's 冬至 for the Jan 1–5 edge case.

  Each of the four TCM seasons maps to one of Waven's four real BioAge dimensions (春/肝→ResilienceAge, 夏/心→MicroVascularAge, 秋/肺→MetabolicAge, 冬/肾→CellularAge) — a pragmatic simplification, not strict TCM canon, flagged in the source file for review. Computed once per request (`personaType === 'viva' ? getCurrentSolarTerm(...) : null`) in both `handlePostChat` and `handlePostFormulaDots`, and threaded into `llmContext`/`nutritionContext` as `current_solar_term`; nano templates ignore the unknown field entirely, so nano behavior is unchanged. Influence is capped as a **soft nudge only** — biomarker-driven dot dosing stays authoritative; the season can only shift narrative tone or break a near-tie, explicitly never override biomarker-driven priority (`systemNutrition.js`'s task instructions state this directly: "节气仅作为轻微调节参考，不得掩盖或推翻生物标志物驱动的优先级排序").

- **Waven Dots catalog migration: DOT01–18 → DOT-N1–18, new names/ingredients/dosing ranges** (`schemas/migration_dots_new_lineup.sql`, `functions/worker/handlers/dots.js`, `mini/nano-miniapp/pages/main/main.js`)

  All 18 dots were renamed and re-formulated from `src/dots/dots-new.md` (new `key_name`s `DOT-N1`…`DOT-N18`, new `name`/`name_zh`, `ingredients`/`ingredients_zh`, `timing`, `sub_age_target`). Added `target_dots_min`/`target_dots_max` columns capturing each dot's real per-day dosing range — these vary from 1 to 100+ dots/day per formula, replacing the old "AI assigns 1–10 dots" model that `_calcDotCounts()` used to encode via biomarker-scored heuristics tuned for the old lineup's biology. Those heuristics don't carry over to the new formulas, so `_calcDotCounts()` was simplified to a flat neutral fallback (`4`, matching the prompt's own "3–4 for unrelated dots" framing) for any `DOT-Nxx` key the LLM's own FORMULATION output happens to omit — re-deriving 18 new per-dot heuristics was out of scope for this pass. Cascading updates: the miniapp's `CART_SETS` (`main.js`), the FORMULATION output regex (`/^(D-N\d+):\s*(\d+)$/`, was `/^(D\d{2}):\s*(\d+)$/`), and every prompt file that renders a dot listing.

- **Anti-hallucination infrastructure for Viva** (`functions/worker/lib/factCheck.js`, `functions/worker/prompts/viva/factConstraint.js`, `functions/worker/lib/biomarkerStatus.js`, `functions/worker/handlers/chat.js`)

  Built after real-user-data testing (2026-07-25/26) surfaced Viva fabricating research citations, p-values, gene SNP IDs, a non-existent "detox age" dimension, and external (non-catalog) supplement recommendations — 6 of 7 `viva/chat/*.js` intent files had never had any fact-constraint text at all (only `nutrition.js` did).

  - **`factConstraint.js`**: single shared `getFactConstraintBlock()` anti-fabrication text block, `require()`'d into every Viva prompt (all 7 `chat/*.js` intent files plus `systemNutrition.js`/`systemHealthAdvice.js`/`systemChat.js`) instead of duplicating it, so one fix reaches every intent. Covers: no fabricated studies/journals/p-values/gene IDs/institutions (only standard evidence-level phrases like "有随机对照试验（RCT）支持" allowed); no fabricated business/logistics info; the system's four real BioAge dimensions are the *only* ones that exist — any other "age" concept must be disclaimed, not answered; dots-only recommendations (no external supplements/herbs); dot numbers/names/ingredients must be copied verbatim from the prompt's own formulary, never from training-data memory of an older lineup.
  - **`factCheck.js`**: output-side regex backstop (not a replacement for the prompt-level rules — a second line of defense) — `detectFabricationRisk()` flags p-values, `rs`-prefixed gene IDs, cohort mentions, fake institution names, journal-year citations, book-title citations, fabricated fake-dimension values/assertions, known non-catalog ingredient names (e.g. "黄连素", "硫辛酸"), and standalone mg dosages not attributed to a named dot. `detectDotNameMismatch()`/`detectFakeProductName()`/`detectDotIngredientMismatch()` cross-check any "X号原粒 NAME(ingredients)" reference in a reply against the real `dotsFormulary` fetched server-side — catching both stale pre-migration names reused against new dot numbers and wholesale invented product names/ingredient lists that a text-only regex can't see.
  - **`biomarkerStatus.js`**: pre-computed normal/elevated/high labels per CLAUDE.md §11's documented thresholds, injected directly into prompts so the model states a biomarker's status rather than comparing a raw value against a threshold itself — a real LLM failure mode (a live Viva reply called GDF-15=650 "升高" against a stated `<750`=normal range).
  - **`chat.js`**: `_regenerateIfFabricationRisk()` — after a reply is generated, runs the above detectors; on any hit, does one risk-category-aware regeneration pass with a correction prompt built only from the specific violations found (citation/ingredient/dimension/name-mismatch), so a reply flagged for e.g. external-ingredient recommendation gets a correction that actually addresses that, not a generic citation-only note. Wired into both `handlePostChat` and `handlePostHealthAdvice`, viva-only.

- **`原粒` (dots) formulary and dosing ranges now surfaced to every Viva chat intent, not just nutrition** (`functions/worker/handlers/chat.js`, `prompts/viva/chat/{biomarker,nutrition}.js`)

  `fetches.dots` (small table, cheap query) is now always fetched in `handlePostChat` regardless of classified intent — it used to be gated behind `required_data.includes('dots')`, which `biomarker_question` (and most other intents) never triggers, so when the model was asked for a concrete next step it reached for generic external supplement knowledge instead of a real dot. `viva/chat/biomarker.js` in particular never destructured or rendered `dots` context at all before this change; it's the root cause traced for most of the external-ingredient-recommendation fabrications found in testing. Both `chat/biomarker.js` and `chat/nutrition.js` render each dot's `target_dots_min`/`target_dots_max` range (from the dots migration above) so the model states the correct per-dot dosing instead of guessing/defaulting to "1 dot."

### Fixed

- **Viva persona always fell back to Nano in `handlePostHealthAdvice`** (`functions/worker/handlers/chat.js`)

  `handlePostHealthAdvice`'s user lookup never selected `channel_id`, so `personaType` resolution (which reads `channels.config.persona_type` via the user's `channel_id`) always defaulted to `'nano'` — every Viva user got the Nano-branded, English-terminology health-advice template regardless of their channel. Added `channel_id` to the `SELECT`, mirroring the same resolution block already used in `handlePostChat`.

- **GDF-15 mislabeled as "elevated" (650, actually normal at <750) in a live Viva reply** (`functions/worker/handlers/{chat,dots}.js`)

  Root cause: some biomarker rows lack `data.validated` (an older shape or a duplicate insert), and the query fetching the latest kino-chip row didn't filter for its presence — so a request could pick up a row with no validated values, and the model was left to reason about a raw/absent figure instead of the estimator-validated one. Added `AND (data->'validated') IS NOT NULL` to every query selecting the latest `kino_chip` biomarker row (3 sites in `chat.js`, 1 in `dots.js`). `biomarkerStatus.js` (above) is a second, independent layer of defense against the same failure mode — pre-computed status labels the model reads directly instead of comparing a value against a threshold itself.

- **`提醒我明天早上8点吃原粒` (and any other `set_reminder` message) produced a fabricated, off-topic biomarker essay instead of confirming the reminder** (`functions/worker/handlers/chat.js`)

  `handlePostChat`'s post-reply grounding check (`verifyBiomarkerGrounding`, added to catch the model misstating biomarker figures/BMI/dates/age — see prior `2026-07-14`/`2026-07-16` entries) runs unconditionally whenever the user has any known biomarker data, birth date, or BMI — regardless of the classified intent. Its `extractDateMentions()` blindly regex-matches any `YYYY-MM-DD` in the reply and compares it against the biomarker `tested_at` ground truth, with no awareness that a `set_reminder` reply's own `scheduled_for` JSON field is a legitimate, unrelated *future* timestamp, not a claim about the test date. This produced a guaranteed false-positive "date mismatch" on essentially every reminder reply for any user with biomarker data on file, which fed the (correct, but entirely irrelevant) biomarker/BMI/age ground truth into a correction prompt instructing the model to "rewrite your previous reply using ONLY these exact values" — hijacking a one-line reminder confirmation into a fabricated CD38/biomarker lecture, with the reminder's `{"action":"set_reminder",...}` JSON dropped entirely so the reminder was never actually saved. Deterministic and 100% reproducible for any `set_reminder` message from a user with biomarker data.

  **Fix:** strip the `record_weight`/`set_reminder` action JSON out of the reply before running both the grounding check and the fabrication-risk detector (`_regenerateIfFabricationRisk`), so structured action payloads are never mistaken for narrative claims about the user's health record. Verified against the live dev endpoint with the original failing message plus a second reminder phrasing and a weight-record regression check.

### Changed

- **China `users.phone` values are now stored as E.164 (`+86...`), matching non-China numbers, instead of a bare 11-digit national number** (`lib/phone.js` (new), `handlers/phone-otp.js`, `handlers/login.js`, `schemas/migration_users_phone_e164_cn.sql`, `pages/verify-phone/verify-phone.js`)

  Previously China numbers were stored bare (`13812345678`) while non-China numbers accepted via `handlePhoneAcceptUnverified` were stored with their dial code (`+18005551234`) — an inconsistent format across the same column. New `lib/phone.js` exports `normalizeCnPhone(phone)`, which E.164-prefixes a bare `1\d{10}` value and passes anything else through unchanged (idempotent). Applied at every site that writes or looks up a China number against `users.phone`: `handlePhoneOtpVerify`/`handlePhoneOtpBind` (`phone-otp.js`), and `handleWxLogin`'s WeChat-consent resolve/backfill/insert, `handleWxAppLogin`, and both branches of `handleBindPhone` (`login.js`). `sendOTP`/`verifyOTP` (`lib/sms.js`) and the `phone_otp_codes` table are intentionally untouched — they keep operating on the bare number, which is what Aliyun PNVS and that table's existing keying expect; the `+86` is added only at the `users.phone` boundary, after OTP verification succeeds.

  One-time backfill migration (`migration_users_phone_e164_cn.sql`) re-prefixes every existing bare China row; safe to re-run since already-prefixed rows no longer match its `WHERE` clause. Applied to dev (275 rows migrated, confirmed via direct query); **prod backfill + `deploy:worker-prod` still pending** — must ship together, since prod rows would otherwise sit in the old bare format while a fresh deploy's code paths all assume/write E.164.

  `verify-phone.js`'s phone-step prefill (`onLoad`) strips the `+86` back off before populating the bare-digit input box, since `user.phone` may now carry it. Checkout/store phone prefill and admin/superadmin phone displays elsewhere in the miniapp and web-admin were deliberately left untouched (deferred, cosmetic-only — they'll just render the `+86...` value verbatim).

- **`verify-phone` phone step: country-code dropdown, non-China numbers accepted without OTP, "发送验证码" hidden until 11 digits, secondary/primary button hierarchy** (`handlers/phone-otp.js`, `index.js`, `pages/verify-phone/verify-phone.js`, `pages/verify-phone/verify-phone.wxml`, `pages/verify-phone/verify-phone.wxss`)

  Added a `<picker>` country-code dropdown next to the phone input with 9 entries (China +86, US +1, Hong Kong +852, Singapore +65, Taiwan +886, Thailand +66, Malaysia +60, Vietnam +84, Japan +81), defaulting to China. Only China (`otpSupported: true`) goes through real SMS-OTP — `PHONE_RE` and PNVS's `countryCode` are both hardcoded to `'86'` server-side, and Aliyun PNVS's ability to deliver OTP SMS to the other 8 countries under this account's current sign-name/template approval hasn't been confirmed.

  For every other country, the number is **accepted as typed with no verification at all**: selecting one swaps the primary action from "发送验证码"/OTP to a "确认" button calling a new `POST /phone-otp/accept-unverified` (`handlePhoneAcceptUnverified`), which stores the number (prefixed with its dial code, e.g. `+18005551234`, so it can never collide with a bare 11-digit China number) and intentionally leaves `phone_verified_at` `NULL` — nothing was actually proven. The WeChat-consent button is hidden for these countries too, since it can only ever return a China number regardless of the selected country. `pendingPhoneVerification` is still cleared on success so sign-up completes the same way the OTP path does, just without `phone_verified` ever becoming true for these accounts. Wiring up real OTP for the other 8 (per-country format validation, passing the selected `countryCode` through to `lib/sms.js`, confirming Aliyun-side delivery/approval) remains separate follow-up work if ever needed.
  `onPhoneInput` now caps at 11 digits. The "发送验证码" button is hidden (`wx:if="{{countryOptions[countryIndex].supported && phone.length === 11}}"`) until a full 11-digit China mobile number is present, whether typed manually or filled via the WeChat-consent button. That WeChat-consent button ("使用微信手机号") moved to a new smaller, muted `.login-btn-secondary` style so it reads as the secondary path once "发送验证码" appears as the primary gradient CTA, rather than two identically-styled full-size buttons stacked on top of each other.

- **`verify-phone`'s OTP code entry now uses the 6-box pin-digit UI** (`pages/verify-phone/verify-phone.js`, `pages/verify-phone/verify-phone.wxml`), matching the invite-code entry style already used elsewhere (the guest sheet in `main.js`, `.pin-field`/`.pin-boxes`/`.pin-box` classes in `login.wxss`) rather than a plain text input. `onCodeInput` now builds a `codeDigits` array (mirroring `main.js`'s `onGuestInviteInput`) and auto-submits via `verifyCode()` once all 6 digits are entered, same as the invite-code flow auto-submits at 6 digits. Added a `loading` guard to `verifyCode` since it can now fire from both the auto-submit and the manual button tap.

### Fixed

- **`verify-phone` avatar picker rendered as an oval instead of a circle; phone/code input text was vertically clipped** (`pages/login/login.wxss`, shared with `verify-phone` via `@import`)

  `.avatar-pick-btn` is a native `<button>` (required for `open-type="chooseAvatar"`), which doesn't reliably respect an explicit `width`/`height` from a flex parent the way a plain `<view>` does — it was rendering at roughly the card's full width while `height: 144rpx` was honored, turning the `border-radius: 50%` circle into a wide oval. Pinned the box with `min-width`/`max-width`/`min-height`/`max-height` (in addition to `width`/`height`) plus `flex-shrink: 0` to force the native button to the intended 144rpx square — confirmed fixed.

  Separately, `.login-input`'s phone number field clipped the top of every glyph (worse on the placeholder specifically). A ratio-based `line-height: 1.4` on top of padding-based sizing did not fix it — WeChat's native `<input>` placeholder doesn't reliably inherit a class's `line-height` at all. Switched to a fixed `height: 96rpx` with `line-height: 96rpx` (equal, not a ratio) and horizontal-only padding, and added an explicit `placeholder-style="line-height: 96rpx; ..."` attribute directly on the `<input>` in `verify-phone.wxml` as a second, WeChat-specific mechanism, since `placeholder-class`/inherited CSS alone isn't dependable for this native component.

- **Cancelling sign-up (or just closing the app) at `verify-phone` left behind a usable, unverified account** (`pages/login/login.js`, `pages/main/main.js`, `pages/verify-phone/verify-phone.js`)

  Reported: after starting a sign-up and reaching `verify-phone`, cancelling out still let the same WeChat account log back in and use the app — showing "User" as the header name (no nickname set, since it fell through to `main.js`'s onboarding chat asking for a name). Root cause: `_finishNewUser` (login.js) persists the freshly-created, unverified account to storage *before* `verify-phone` ever runs, and neither logging out nor simply force-quitting/reopening the app was gated afterward — closing the app right after being sent to `verify-phone` silently dropped the user into `main` on next open (session-restore had no way to know the account was mid-signup), and tapping the page's own "退出登录" logout button just cleared the local session while leaving the DB row (and therefore the WeChat openid → account link) fully intact.

  **Fix:**
  - Added a client-only `pendingPhoneVerification: true` flag, set only by `_finishNewUser` and cleared only on successful OTP bind. `login.js`'s session-restore branch and `main.js`'s `onLoad` (defense in depth) both redirect back to `verify-phone?new=1` whenever this flag is still set — so reopening the app mid-signup resumes verification instead of silently granting access. This flag is distinct from `phone_verified` and is never set for a returning/existing account or a silently auto-created one (channel-branded `channel_slug` signup with no explicit invite/coach), which continue to browse freely per the earlier fix.
  - `verify-phone`'s "退出登录" now also fires a best-effort `DELETE /api/users/:user_id` before clearing the local session — this page is only ever reached moments after account creation with zero attached data (no phone, no chat history), so cancelling here now actually undoes the sign-up instead of leaving an orphaned, permanently-unverified row that the same openid can just log back into.

### Added

- **Guest chat tab: full input row shown, mic button replaced with Sign-up** (`pages/main/main.js`, `pages/main/main.wxml`, `pages/main/main.wxss`)

  Guests previously never saw the chat input row at all — it was gated on `obStep === 'done'`, which only happens after finishing an onboarding questionnaire that guest sessions skip entirely; they instead saw a separate "guest CTA bar" banner. Now the same textarea/plus-button/send-button row guests see is shown to logged-in users too (`obStep === 'done' || isGuest`), with two guest-specific swaps: the mic button (shown when the textarea is empty) is replaced by a `guestSignupBtn` pill ("注册"/"Sign up") that opens the guest sign-up sheet (`openGuestSheet`), and tapping send while typed text is present also opens the sign-up sheet instead of calling `handleSend`. The now-redundant standalone "guest CTA bar" banner (`guestChatCtaText`/`guestChatCtaBtn`) was removed since the input row itself is now the CTA. The guest header name (`t.guestHeaderName`, 访客/Guest) was already correctly wired up and needed no change.

- **Consolidated the two independent "new account" signup implementations into one** (`pages/login/login.js`, `pages/main/main.js`, `pages/verify-phone/`)

  A guest browsing the chat tab could sign up via `main.js`'s "guest sheet" — a completely separate, second copy of "avatar picker + WeChat phone consent + hidden `1709` skip-passcode" from the one already in `pages/login/login.js` (for a fresh visitor arriving via an invite/coach link). Both called the same backend `handleWxLogin`, but only the `login.js` copy had been wired up to the SMS-OTP gate added above — the guest-sheet path (`proceedGuestSignup`/`_completeGuestSignup`) never checked `phone_verified` and never redirected to `verify-phone`, so guest-tab signups bypassed OTP entirely.

  **What changed:**
  - Removed both duplicate "avatar + phone-consent + skip-passcode" screens entirely, along with the `1709` skip-passcode (there is no bypass left — see the logout escape hatch already on `verify-phone` for the "can't verify right now" case).
  - `login.js`'s `wxLogin`/`submitCode`, on `new_user`, now go straight to `wx.reLaunch('/pages/verify-phone/verify-phone?new=1')` instead of showing its own phone screen (`_finishNewUser`, replacing the old avatar/phone `step: 'phone'` UI).
  - `verify-phone` gained the (optional) avatar-picker, shown only when `?new=1` is present — ported from `login.js`'s old `handleChooseAvatar` (OSS presign + upload). An already-existing account forced through this gate retroactively never sees it.
  - `main.js`'s guest sheet is now invite-code entry only (`submitGuestInvite` validates via `/api/validate-invite`, then hands off with `wx.reLaunch('/pages/login/login?invite=' + code)`) — it no longer touches phone/avatar/account-creation at all, reusing `login.js`'s flow (and therefore the OTP gate) instead of a second copy.
  - Net result: exactly one implementation of "create account → optional avatar → verified phone" (`login.js` → `verify-phone`), reached identically whether the user arrives via a link or converts from guest browsing.

- **Forced SMS-OTP phone verification in the miniapp** (`schemas/migration_users_phone_verified.sql`, `handlers/phone-otp.js`, `handlers/login.js`, `index.js`, `mini/nano-miniapp/pages/verify-phone/`, `pages/login/login.js`, `pages/main/main.js`)

  Users could previously end up with an unverified or missing phone number: WeChat's `getPhoneNumber` consent proves the number came from WeChat but was never separately confirmed by us, a raw-phone fallback (Flutter app) accepted any 11-digit string with zero proof, and the phone step could be skipped entirely (including via a hidden QA passcode). A missing phone was only nudged once via a dismissible in-chat message.

  **What changed:**
  - Added `users.phone_verified_at` (nullable `TIMESTAMPTZ`) — `NULL` means unverified. No backfill: every phone already on file, however it was obtained, is treated as unverified.
  - New `handlePhoneOtpBind` (`POST /phone-otp/bind`) attaches + proves a phone for an already-logged-in (WeChat openid) user via Aliyun PNVS SMS-OTP (`verifyOTP` from `lib/sms.js`), rejecting with `phone_in_use` if the number is already bound to a different account. Distinct from `handlePhoneOtpVerify`, which looks up/creates a user *by* phone for the web `user-app`'s login screen — the miniapp needs to bind a phone to an existing identity, not switch identity.
  - `phone_verified` (derived from `phone_verified_at IS NOT NULL`) is now returned alongside every user row the client can receive (`handleWxLogin`, `handleWxAppLogin`, `handleExchangeWebviewToken`, `phone-otp.js`'s shared `USER_SELECT`).
  - New miniapp page `pages/verify-phone/verify-phone`: phone entry (prefillable via the existing no-write `resolve-phone` WeChat-consent decrypt, or manual entry) → 6-digit OTP entry with 60s resend cooldown → binds via `/phone-otp/bind`. WeChat consent is now only a convenience prefill — SMS-OTP is always required afterward regardless of how the number was obtained.
  - `verify-phone` is only ever reached as the final step of a **deliberate, in-app sign-up** — a user tapping an invite/coach link, or entering an invite code via the guest sheet (`login.js`'s `wxLogin`/`submitCode`, gated on `this._inviteCode || this._coachId` being set, not merely `new_user`). It is never a standing gate on session restore or on `main.js`'s `onLoad`: WeChat mini-program review requires free tab browsing, so a silently auto-created account (e.g. a branded channel's `channel_slug` default, with no explicit invite/coach) is logged in like anyone else, unverified phone and all — same as true guest browsing (`user.guest === true`), which was always exempt.
  - Retired the old passive in-chat nudge (`bind_phone` action in `_onAllQuestionnaireDone`, `nano_phone_prompted` flag, `handleBindPhone`/`_removePhonePrompt` in `main.js`) — this UX slot is now covered by the deliberate-sign-up `verify-phone` step instead.

### Fixed

- **Kino chip scan silently reassigned ownership when a second user re-scanned an already-claimed chip** (`functions/worker/handlers/kino.js`, `mini/nano-miniapp/utils/tool-actions.js`, `mini/nano-miniapp/pages/main/main.js`, `mini/nano-miniapp/pages/coach/coach.js`)

  Reported: a chip scanned by user A, then scanned again by user B, ended up registered to B in the database. Root cause was in `handlePostKinoScan` — `kino_chips.status` only flips to `'used'` once a scan *completes* (`handlePostKinoResult`), so a chip with a still-`pending` scan (someone mid-test) still looks scannable to anyone else. The existing-row check only special-cased `scan_status === 'completed'` and `row.user_id === user_id`; any other case (a different user, still pending) fell through to `INSERT ... ON CONFLICT (chip_id) DO UPDATE SET user_id = EXCLUDED.user_id`, which silently overwrote the row's owner and returned a normal `status: 'registered'` success to the second scanner — no warning to either user. Since `handlePostKinoResult` looks up the scan's owner by `chip_id` alone at the moment the physical reader posts results (not who owned it when the physical test started), a re-scan mid-test could also misattribute the eventual biomarker result to the second user instead of the one who actually ran the chip.

  **Fix:** `handlePostKinoScan` now returns `{ success: false, status: 'claimed_by_other' }` when a chip has a pending scan owned by a different user, instead of reassigning it. Also tightened the insert's `ON CONFLICT` from `DO UPDATE` to `DO NOTHING` (with a `claimed_by_other` response when zero rows come back) to close the same hole for two concurrent first-time scans racing on a brand-new chip. Added the `claimed_by_other` status to the miniapp's chat-tool scan flow (`tool-actions.js`) and zh/en copy in both `main.js` and `coach.js`. A chip legitimately stuck in this state can still be freed via the existing admin "Reset Chip" action.

  A separate, pre-existing bug in the web admin's own scan modal (`HealthTab.jsx`) was found during this investigation and fixed below.

- **Web admin Kino chip scan modal sent the wrong field and reported every soft-failure status as success** (`src/web/user-app/src/tabs/HealthTab.jsx`, `src/web/user-app/src/i18n.js`)

  `KinoScanModal`'s `handleScan` POSTed `{ chip_code: code, openid }` to `/kino-scan`, but `handlePostKinoScan` (see entry above) reads `chip_id` from the body — the field never actually arrived, so every scan through this modal was hitting the `if (!chip_id) throw new Error('chip_id is required')` guard and only "succeeding" by accident of `handleScan` never checking `response.data.status` in the first place: it treated any non-throwing (HTTP 200) response as success, which is what all of this handler's soft-failure statuses (`invalid_chip`, `used`, `already_linked`, `claimed_by_other`) return — none of them throw or set a non-2xx status.

  **Fix:** send `chip_id` instead of `chip_code`. `handleScan` now branches on `response.data.status` with a status→message/ok map (`registered`/`already_linked` → success styling and copy; `used`/`invalid_chip`/`claimed_by_other` → error styling with a status-specific message; unrecognized status → generic `scanError` fallback). Only a truthy `ok` outcome closes the modal via `onDone`. Added `scanAlreadyLinked`/`scanUsed`/`scanInvalidChip`/`scanClaimedByOther` zh/en strings to `i18n.js`.

### Changed

- **X3 → Halo rename** (`src/mini/nano-miniapp/utils/wearable/{x3→halo}/`, `tools/{x3-ring→halo}/`, `components/user-health/user-health.{js,wxml}`, `utils/wearable/{index,sync}.js`, `docs/architecture/`, `CLAUDE.md`)

  "X3" is the OEM hardware model number (the ring literally advertises itself over BLE as `X3B`/`X6...`), not our product name — renamed the internal identifiers to "Halo" to avoid conflating a specific vendor SKU with the ring line we're building support around.

  **What changed:**
  - `brand === 'x3'` → `brand === 'halo'` everywhere (factory dispatch, local storage, server `wearable_brand` column, UI checks). `'x3'` is kept as a permanent legacy alias — `createWearable()` and a new `_normalizeBrand()` helper in `user-health.js` accept it so anyone already bound before this rename doesn't break.
  - Folder + class rename: `utils/wearable/x3/` → `utils/wearable/halo/`, `X3Ring` → `HaloRing`. `X3Ring.parsers` → `HaloRing.parsers`.
  - Local storage keys `x3_interval_settings`/`x3_work_mode_settings` → `halo_interval_settings`/`halo_work_mode_settings`; reads fall back to the old key names, unbind clears both old and new.
  - CLI tool `tools/x3-ring/` → `tools/halo/` (package name `halo`, bin `halo`, main entry `src/halo.js`, `HaloRingClient` → `HaloClient` — matches the bare-name convention already used for "kino"/"nano" elsewhere in this repo, not `<name>-ring`/`<name>-tool`); confirmed working end-to-end against a real ring after the rename.
  - **Not renamed, intentionally:** `HALO_NAME_PREFIXES` still holds the literal hardware-broadcast values, not something we control. `model: 'X3'` in `getDeviceInfo()` similarly stays (real hardware model field); only the human-facing `name` became `'Halo Smart Ring'`.
  - `docs/architecture/x3-smart-ring.md` → `docs/architecture/halo-smart-ring.md`; `CLAUDE.md` §18 and `docs/architecture/wearable-system.md` updated to match.
  - **Extended to the full Halo product line:** `HALO_NAME_PREFIXES` grew from `['X3', 'X6']` to `['X3', 'X6', 'X9', 'V4']` (X9 is another ring model, V4 is a wrist band — confirmed to share the identical BLE protocol). Brand detection during scan (`user-health.js`) now checks against `HALO_NAME_PREFIXES` directly instead of hardcoding `'x3'`/`'x6'` prefix checks inline, so future model additions are a one-line change to that array rather than a second place to remember.

### Fixed

- **`user-app` never sent the API bearer token, so nearly every authenticated call 401'd silently** (`web/user-app/vite.config.js`, `web/user-app/src/main.jsx`)

  The miniapp hardcodes `Authorization: Bearer <token>` on every `wx.request` call (`app.js`); `user-app`'s axios calls never set it. On the deployed dev environment (which enforces `API_BEARER_TOKEN`), this meant `/api/biomarkers`, `/chat-history`, `/health-plans`, `/health-twin`, `/health-events`, and effectively every other non-login endpoint returned 401 and silently fell back to empty states — the entire app looked broken/empty, not just the newly-built tabs. Root-caused by inspecting live network requests against the deployed site with a real logged-in session.

  **Fix:** `vite.config.js` now sets `envDir` to the repo root so the build picks up `VITE_API_TOKEN` from the existing root `.env` (previously unused — Vite only reads `.env` from the project's own directory by default). `main.jsx` sets it as `axios.defaults.headers.common['Authorization']` at startup, mirroring the miniapp's pattern. Also fixed a related bug found during verification: `HealthTab.jsx`'s "latest biomarker record" picked the chronologically-last `biomarkers` row regardless of `test_type`, so a `body_composition` (weight) entry newer than the last Kino scan could blank out the sub-age/biomarker display even with real Kino data present — now filtered to `test_type === 'kino_chip'` first, matching the miniapp's `kinoRecords` filtering.

- **`user-app`'s tab arrangement didn't match the miniapp's** (`web/user-app/src/App.jsx`, `tabs/PlansTab.jsx`, `tabs/AcademyTab.jsx`, new `components/DotsView.jsx`, removed `tabs/DotsTab.jsx`, `i18n.js`, `style.css`)

  `user-app` is meant to be a browser fallback for when the miniapp is unavailable, so its navigation structure needs to match, not just its feature set. Restructured to mirror the miniapp exactly rather than the ad-hoc 6-tab layout from the original port:
  - **Bottom tab bar**: 5 tabs in the miniapp's order — Chat, Health, Plans, Learn, Store (was 6, with a standalone Dots tab that doesn't exist in the miniapp's tab bar at all).
  - **Plans tab**: now a 2-way inner toggle (方案/Plans ↔ 原粒/Dots, `plansDotsPlanTab`/`plansDotsDotsTab` in the miniapp), matching `main.wxml`'s `inner-tab-bar` exactly. Dots content moved from the removed standalone tab into `components/DotsView.jsx`, rendered as the toggle's second pane. "Browse Plans" (加入方案) is now a button that opens an overlay sheet (`TemplateBrowseSheet`), not a persistent third sub-tab — matches the miniapp's `openPlanBrowse()`/Plan Browse Sheet, which is also an overlay, not a tab. The standalone "Events" sub-tab was removed entirely; Activities/Events are only reachable inside a plan's detail sheet, exactly like the miniapp (confirmed via `grep` that `main.wxml` has no top-level events browsing anywhere outside `planSubTab === 'activities'`).
  - **Learn tab**: now a 2-way inner toggle (学院/Academy ↔ 魔盒/Box) — the second pane was previously mislabeled "Wellness"; the miniapp's actual i18n key is `learnBoxTab` = "魔盒"/"Box". Consolidated Courses, Learning Paths, My Certifications, and Reference Materials (previously "Library" — miniapp's real label) from 4 separate persistent sub-tabs into one continuous scrollable Academy view with inline section headers, matching `main.wxml`'s single `trainingView === 'list'` block exactly. Added the Academy status card (tier badge, credits, completed-lessons/certifications counts via `GET /academy/coach-dashboard` — despite the name, this endpoint is not coach-gated and the miniapp calls it for every regular user) and course prerequisite-locking (a course with an incomplete `prerequisite_course_id` shows a lock badge and a toast instead of opening), both present in the miniapp but missing from the original port. Removed the Leaderboard sub-tab entirely — confirmed via `grep` that no leaderboard UI exists anywhere in the miniapp's regular user-facing page (`main.wxml`/`main.js`); it was invented for the original port with no miniapp equivalent.
  - Certificate tap now opens a detail overlay (name, course, cert number, issue date, score, download-via-presigned-URL) instead of just a static row, matching the miniapp's cert detail card.

- **Real phone + SMS-OTP login for `user-app`** (`schemas/migration_phone_otp_codes.sql`, `schemas/migration_users_phone_unique.sql`, `schemas/migration_phone_otp_codes_drop_attempts.sql`, `functions/worker/lib/sms.js`, `functions/worker/lib/auth.js`, `functions/worker/handlers/phone-otp.js`, `functions/worker/index.js`, `web/user-app/src/components/LoginScreen.jsx`, `web/user-app/src/i18n.js`, `web/user-app/src/style.css`, `s.yaml`, `s-prod.yaml`)

  `LoginScreen.jsx`'s phone tab was dead code (only the QR-login tab button rendered) and, even if reachable, wasn't real auth — it fetched the entire `/api/users` list and did a client-side substring match on phone number. Replaced it with a real two-step SMS-OTP flow, kept alongside the existing WeChat QR-login (not replacing it).

  **What changed:**
  - `lib/sms.js` uses Aliyun's PNVS SMS Authentication Service (`@alicloud/dypnsapi20170525`), mirroring gcn's already-proven `src/functions/auth/lib/otp.js` (see gcn's `docs/pnvs.md`) rather than classic Dysmsapi — an initial version of this feature used Dysmsapi with self-hosted code hashing/storage before this was found and switched over. PNVS generates, sends, and verifies the code entirely on Aliyun's side using a **system-provided (赠送) sign/template** (`恒创联众` / template `100001`) that's already approved — no custom sign-name/template approval wait, unlike classic Dysmsapi. Reuses the existing `OSS_ACCESS_KEY_ID`/`SECRET` (same Aliyun account, already confirmed to have `dypnsapi` permission per gcn's docs) — no new SMS credential provisioned. `phone_otp_codes` is now only written to by the local dev-bypass path (no `SMS_ACCESS_KEY_ID` configured, e.g. running `scripts/local-dev.js` off `.env`) — the real PNVS path stores/validates nothing locally.
  - `users.phone` was not unique — added a partial unique index (`migration_users_phone_unique.sql`) so it's safe to use as a login key. One pre-existing duplicate was found on both dev and prod (two active accounts, "Tim" a coach and "test_jerry" a user, sharing a number); resolved by nulling Tim's phone per product decision before the migration ran.
  - New `handlers/phone-otp.js`: `POST /phone-otp/send` and `POST /phone-otp/verify` (find-or-create by phone mirroring `handleWxLogin`'s existing-user projection, with a unique-violation catch/retry for two concurrent first-time verifies racing the insert). No custom rate-limiting/attempt-lockout on nano's side — matches gcn's `handleOTPSend`/`handleOTPVerify`, trusting PNVS's own send/verify enforcement rather than duplicating it. Both routes added to `index.js`'s bearer-auth skip-list alongside `/qr-login/*`, since the browser client sends no `Authorization` header.
  - Verified end-to-end against `nano_db_dev` in dev-bypass mode (direct handler calls and via `scripts/local-dev.js`'s real FC-routing bridge): send, wrong-code and reused-code rejection, new-user creation, and existing-user lookup all behave correctly. Not yet verified against a real PNVS send or in an actual browser session (browser tooling unavailable this session) — recommend both before shipping.
  - Not touched: the miniapp itself, which keeps its native WeChat login unchanged; Kino Simulator and wearable BLE sync stayed out of scope for this web app per the original ask.

- **`user-app` brought to feature parity with the miniapp** (`web/user-app/src/App.jsx`, `tabs/{Chat,Health,Dots,Plans,Academy}Tab.jsx`, `components/{PlanDetailSheet,EventsView,ChatToolbox,ActionChip,GaugeBar,LineChart,MetricChartModal,AudioPlayer}.jsx`, `tabs/ReferralTab.jsx`, `utils.js`, `i18n.js`, `style.css`)

  The live `user-app` at `nano-dev.fros.cc/app` had drifted far from the miniapp it's meant to duplicate for non-WeChat browser users — several tabs were materially thinner than their miniapp counterparts, and one page (Referral) didn't exist at all. Closed the gap across six areas, each ported from the equivalent miniapp logic in `mini/nano-miniapp/pages/main/main.js` and `components/user-health/user-health.js`. Wearable BLE sync, the Kino Simulator/chip-scan overlay, and other WeChat-native-only mechanisms (address autofill, native share, voice recording) stay out of scope, matching the phone-OTP work above — Health tab surfaces server-aggregated data read-only, Dots tab stays a read-only schedule view.

  **What changed:**
  - **Referral** (new `tabs/ReferralTab.jsx`): reachable via a header icon (bottom tab bar was already full at 6). Uses `GET /my-referrals`, which already returns more than the miniapp's own referral page surfaces (per-referral commission, running totals) — display-only for now; auto-applying an invite code from a `?ref=` link at phone-OTP signup would need a `phone-otp.js` change, deliberately deferred.
  - **Dots**: fixed `DotChip` reading `dot?.color` when the real column is `color_hex` (every chip was silently falling back to the default color). Ported `mapStructuredSchedules` so the tab prefers `GET /nutrition-plan`'s `structured_plan`/`schedules` fields, falling back to the legacy free-text parser only when no structured plan exists — previously only the legacy path was ever read.
  - **Plans**: replaced the flat check-in/adherence card with a plan-detail sheet (`components/PlanDetailSheet.jsx`) — Overview/Progress/Activities/Guidance sub-tabs, reminder pause/resume, switch-type/abandon actions. Added today's-task chips (dots/weight/questions) to each plan card, with `WeightEntryModal`/`DailyQuestionsModal` for the latter two. `EventsView` extracted to its own component so the standalone Events tab and the detail sheet's Activities tab share one implementation. Also fixed `PlanCard` reading a non-existent `plan.started_at` column (real column is `start_date`), which had made every plan's day-count/adherence math silently wrong.
  - **Chat**: added a toolbox (`+` button) for the three browser-portable tools — image upload (native `<input type="file">` against the existing OSS presign contract), formula-dots, health-advice. Camera chip-scan stays excluded (hardware). Ported inline `role: 'action'` tappable message chips (e.g. the lab-report-photo consent flow) and a distinct coach-message bubble style for `role: 'coach'` messages, now correctly polled via `chat-history?since_id=`.
  - **Health**: added a read-only Digital Twin section — health score, domain scores, vital gauges, body-composition bar, and a lab-results snapshot, all sourced from `GET /health-twin` (previously never called). Added trend charts (BioAge, weight, BMI from existing `/biomarkers` records; steps/HRV/resting-HR/glucose from `GET /health-events`, previously never called) via new `LineChart`/`GaugeBar`/`MetricChartModal` components. Ported the miniapp's scoring functions and lab-panel builder verbatim into `utils.js`. BP/glucose charts filter to `manual_photo`-sourced rows only, matching the miniapp (ring-inferred readings are unreliable). A "stress" trend card from the original plan was dropped after confirming no `stress` field exists anywhere in `health_events` data.
  - **Learn**: added Wellness (audio/video/doc media library from `GET /digital-assets`, previously unused — native `<audio>`/`<video>` elements replace the miniapp's manual background-audio state machine), Learning Paths (`GET /academy/learning-paths`), and Library (`GET /academy/library`) sub-tabs. Fixed a real, previously-silent bug in the quiz flow: `openLesson` discarded the `quiz_questions` field from `GET /academy/lessons/:id`'s response entirely (only kept `.lesson`), so the quiz UI's `activeLesson.quizzes` was always `undefined` and never rendered; submission also sent the wrong request shape (`{question_id, answer}[]`) and read a `correct_count` field the handler never returns. Fixed to read `quiz_questions`, submit `{questionId: optionIndex}`, and display the real `score`/`passed` response.
  - No backend changes anywhere in this pass — every phase reuses worker endpoints already called by the miniapp.

- **`POST /partner-descendants-gcn` — full downline for GCN's stock-rollup panel** (`functions/worker/handlers/partners.js`, `functions/worker/index.js`)

  GCN wanted a parent aeviva store to see a per-store inventory rollup across its *entire* downline, not just one tree level at a time like the existing Network panel (`handleGcnPartnerChildren`/`/partner-children-gcn`). A per-node fetch doesn't fit a stock aggregate — GCN needs the complete set of descendant partner ids up front to run a single grouped query against its own `partner_inventory` table. Added `handleGcnPartnerDescendants`, a recursive `referred_by_partner_id` query returning every descendant of `requesting_partner_id` at any depth as a flat id list. Always rooted at the caller's own id (never an arbitrary target), so unlike `handleGcnPartnerChildren` it needs no ancestry check. Registered at `/partner-descendants-gcn` and added to `GCN_ALLOWED_PATHS`, gated by the same scoped `GCN_API_TOKEN` as the rest of the nano↔GCN bridge. Seeded/verified against `nano_db_dev`'s existing sandbox tree (`temp/seed-sandbox-partner-tree.js`, 990001→990002/990006/990009→...). See GCN `CHANGELOG.md` same date for the consuming endpoint/UI.

- **`tools/infinity` — standalone Infinity/Aizo ring BLE CLI** (`tools/infinity/`)

  Added a Node/`noble` debug CLI for scanning and reading an Infinity/Aizo ring directly over Bluetooth without wiring anything into the miniapp. The checked demo under `temp/aizoring_sdk_demo` does **not** expose the raw protocol; it lazy-loads the closed WeChat `RingPlug` plugin (`provider: wxfd42c6749120cf46`, version `1.0.2`). The CLI therefore keeps an isolated copy of the previously captured Infinity/Aizo BLE framing, UUIDs, bind handshake, and known reads (battery/status, steps, sleep, stress, heart-rate, SpO2 best-effort parsing), plus a `raw` command for exploring plugin/protocol gaps against real hardware.

- **Miniapp menu — "Aeviva Store" entry into the GCN storefront** (`mini/nano-miniapp/pages/main/main.{js,wxml}`, `pages/appview/appview.js`)

  Aeviva channel users had no in-app way to reach the GCN storefront (`aeviva.gcn.net`), a separate serverless store/ERP platform being integrated as the sales engine for nano's existing Aeviva partner program. Added a menu item (aeviva channels only, hidden for guests) that opens it as an embedded `<web-view>` via the existing appview page.

  **What changed:**
  - `appview.js`'s `onLoad` now accepts an absolute `http(s)://` URL in `options.url` (previously only `/app/...`-relative paths), still appending a one-time `wvt` webview token the same way so the external page can identify the user without its own login.
  - `main.js`: `openAevivaStore()` picks `aeviva-dev.gcn.net` vs `aeviva.gcn.net` by checking whether `BASE` is the `-dev.` host — mirrors the same develop-vs-trial/release split `BASE` itself uses (CLAUDE.md "Miniapp Backend Selection"), rather than `IS_DEV`, which also covers trial builds.
  - `main.wxml`: new menu item, gated on `channel.key_name === 'aeviva' || 'aeviva-china'`.
  - Not yet done: `aeviva.gcn.net`/`aeviva-dev.gcn.net` still need WeChat business-domain verification (only `nano.fros.cc` is verified today per `docs/wechat-domain-setup.md`) before this works outside the DevTools domain-check bypass.

- **Admin Panel Hardware tab — Tested Chips sub-tab** (`schemas/migration_scans_biomarker_id.sql`, `functions/worker/handlers/kino.js`, `functions/worker/index.js`, `web/admin-panel/src/tabs/ChipsTab.jsx`, `web/admin-panel/src/translations.js`)

  There was no way to see which Kino chips had actually been tested, or inspect what a specific chip's raw scan + biomarker results looked like — only aggregate inventory counts (available/used/damaged) via the existing Batches/Models sub-tabs. Added a third "Tested" sub-tab under Hardware → Chips: a paginated, searchable (chip code or nickname) list of completed scans; clicking a row opens a detail modal showing chip/batch/model, device, BioAge + sub-ages, validated vs. raw biomarker values side by side, clinical context, and the raw `scan_results` JSON.

  **What changed:**
  - `scans.biomarker_id` (new column, migration) — links a completed scan directly to the `biomarkers` row it produced. There was previously no FK at all; `handlePostKinoResult`'s only association was a fragile "same user + closest timestamp within a device's 10-minute window" heuristic, used purely to *avoid re-creating* a biomarker row and never persisted anywhere. `handlePostKinoResult` now writes this column on completion.
  - `GET /api/kino-tested-chips` (paginated list) and `GET /api/kino-tested-chips/:id` (detail) — join `scans` → `kino_chips` → `kino_chip_batches`/`kino_chip_models` → `users` → `biomarkers` → `kino_devices`. For historical scans that predate the new column, falls back to the same nearest-timestamp heuristic so old tests still show up correctly instead of being silently excluded.
  - Reuses the existing `UserDetailModal` styling (`modal-user-detail`, `udm-*`, `bm-table` CSS classes) rather than inventing new modal chrome.

- **"Reset Chip" action in the Tested Chips detail modal** (`functions/worker/handlers/kino.js`, `functions/worker/index.js`, `web/admin-panel/src/tabs/ChipsTab.jsx`)

  No way to free a chip for reuse (bad test, intentional re-test) short of manual SQL. Added a "Reset Chip" button (behind a confirm dialog) that marks the chip `available` again in `kino_chips` and deletes its `scans` row — freeing the unique `chip_id` index so the chip can be scanned/registered fresh exactly like a brand-new one. The user's `biomarkers` history record is left untouched; only the chip's binding/scan state resets. `POST /api/kino-tested-chips/:id/reset`.

- **Server-side wearable ring binding** (`schemas/migration_wearable_binding.sql`, `functions/worker/handlers/users.js`, `components/user-health/user-health.js`)

  The bound ring (brand/device) previously lived only in `wx.storageSync` on one phone — lost on reinstall, cache clear, or switching devices, and invisible to the Android/iOS builds of this same codebase (WeChat Donut Multiterminal). Now persisted server-side on `users` so any client app can discover the same binding.

  **What changed:**
  - Migration adds `users.wearable_brand`, `wearable_mac`, `wearable_name`, `wearable_bound_at` — purely additive columns, no other schema impact. `wearable_mac` is the ring's stable hardware MAC (from `ring.getMac()`), not the BLE `deviceId`, which is a per-OS/per-scan handle that isn't portable across devices. Only Halo currently exposes a MAC; other brands bind with `mac: null`.
  - `handlePatchUser` (`PATCH /api/users/:id`) accepts a new `wearable: {brand, mac, name} | null` field alongside the existing `theme` field — reuses the existing generic user-patch endpoint rather than adding a new route. `handleGetUser` now returns the four new columns.
  - `user-health.js`: `handleBindWearable` now also calls `ring.getMac()` (Halo only) and pushes `{brand, mac, name}` to the server after a successful local bind; `handleUnbindWearable` clears it. Both are best-effort (wrapped so a server hiccup doesn't block the local BLE flow). When a device/install has no local `wearable_device` in storage, `_loadWearableHintFromServer()` checks the account for an existing server-side binding and shows "Already bound on this account: <name>" in the empty-state card instead of looking like the user has never paired a ring.
  - No auto-reconnect across devices — the BLE `deviceId` still requires a fresh scan on each device regardless of what's stored server-side; this only removes the "which ring did I have again" ambiguity and gives a foundation for future admin/coach visibility into device bindings.

- **Miniapp HealthTab — weekly multi-block sleep timeline** (`components/user-health/user-health.{js,wxml,wxss}`, `utils/wearable/sync.js`)

  The wearable section's sleep chart previously collapsed every session on a calendar day into a single merged total, hiding naps and wake-interrupted night segments (found via direct BLE investigation against a real X3 ring — `tools/x3-ring`). Replaced the old single-bar-per-day trend with a 7-day timeline that shows every discrete sleep block (naps and night-sleep segments) positioned on a noon-to-noon 24h vertical axis, so overnight sleep isn't split across the midnight boundary. Also added a date label and per-stage minute counts (not just percentages) to the existing "last night" detail view, and fixed that view to prefer the most recent actual **night** session over a trailing daytime nap.

  **What changed:**
  - `sync.js`: each per-date sleep event now also carries a `sessions` array (each discrete block's onset, duration, and stage minutes) alongside the existing merged-total fields — purely additive to the `health_events.data` JSONB, no schema migration, fully backward compatible with existing consumers reading only the aggregate fields.
  - `user-health.js`: new shared helpers `_isNightSession` (20:00–05:59 = night, else nap), `_minutesSinceNoon` (positions a session on the noon-to-noon axis used by `x3/index.js`'s `_nightKey`), `_dayQualityColor`, `_fmtHM`, and `_sessionsFromEventData` (reads the new `sessions` array, or synthesizes one session from older rows that predate this change). Both the live BLE sync path and the server-hydration path now prefer the latest night session (not just the latest session) for the quick-glance card.
  - `user-health.wxml`/`.wxss`: new `ring-sleepweek-*` timeline chart (replaces the old `sleepDayBars` bar chart) with per-day tracks, positioned blocks, a 12/18/24/06/12 time axis, and a night-vs-nap legend.

### Fixed

- **Chat replies (Viva persona) stated the wrong chronological age** (`src/functions/worker/handlers/chat.js`)

  Reported in prod for user `b0b33614`: Viva's reply said "69岁" while the correct age is 73 (birth date 1953-06-13), and a Nano-persona message for the same user 18 minutes earlier correctly said 73. `calculateAge()` and `llmContext.user_profile.age` were both correct and handed to the model directly — the bug was that `questionnaire_context` also carried the user's raw onboarding answer for "出生日期" (birth date) alongside the pre-computed age, giving the model conflicting material to (wrongly) re-derive age from instead of trusting the given figure. None of the `biomarker_question`/`nutrition_question`/`casual_chat` prompt templates (Nano or Viva) inject the current date, so the model had no anchor for that arithmetic. Existing biomarker/test-date grounding checks didn't cover age, so nothing caught the drift before it reached the user.

  **Fix:** (1) the questionnaire-responses query in `handlePostChat` now excludes the row with `save_field = 'birth_date'`, removing the redundant/competing signal from `questionnaire_context`. (2) `verifyBiomarkerGrounding` now also cross-checks a stated age against `user_profile.age` and retries with an explicit correction if they mismatch, mirroring the existing biomarker-value/test-date checks added for the 2026-07-14 stale-data bug. The age check is scoped to a short window right after the patient's name (matching how every template opens: "`<nickname>`, `<age>`岁") rather than scanning the whole reply, so it doesn't false-positive on unrelated population statistics the model cites elsewhere (e.g. "60岁以上女性…" demographic trivia). (3) Also corrected the one already-stored bad message (`chat_messages.id = 12183`) in prod from "69岁" to "73岁".

- **Chat replies could have the same wrong-derivation risk for BMI, just not yet observed** (`src/functions/worker/handlers/chat.js`, `prompts/{nano,viva}/chat/{biomarker,nutrition,casual}.js`)

  Follow-up to the wrong-age bug above: unlike age, `handlePostChat`'s `llmContext` never handed the model a precomputed BMI at all — it only had raw height/weight (from `questionnaire_context`) or `health_twin.latest_bmi` when wearable/scale data existed. Every BMI the model stated was live, ungrounded arithmetic; it happened to compute correctly for user `b0b33614` (61kg / 1.6m² = 23.8) but nothing would have caught it if it hadn't. **Fix:** BMI is now precomputed server-side in `handlePostChat` (preferring `health_twin.latest_bmi`, falling back to `bio_data.height`/`bio_data.weight`), injected as `user_profile.bmi`, and surfaced in the same six prompt templates that already show age. The raw height/weight questionnaire answer (`save_biomarker_type = 'body_composition'`) is now excluded from `questionnaire_context` for the same reason birth-date is. `BMI` was added to `BIOMARKER_LABEL_PATTERNS` so the existing grounding-check/retry machinery covers it exactly like the six Kino biomarkers.

- **Admin Panel Users tab — user detail modal showed "No biomarker data yet." and blank biomarker trends for every user** (`web/admin-panel/src/tabs/UsersTab.jsx`)

  `UserDetailModal` still read `data.estimated`, but `migration_biomarkers_rename_estimated_to_validated.sql` renamed that key to `data.validated` on every existing row (dev is migrated; prod migration is still pending). With no `estimated` key left on dev, `latestBm` was always `null` and `trendFor()` always returned an empty array — reproduced exactly as reported. BioAge/sub-ages still rendered fine (they come from the `bio_age` column and `bioage_profile`, neither of which were renamed); only "Latest Biomarkers" and "Biomarker Trends" were empty. **Fix:** updated the three stale reads to `data?.validated`. Do not ship this fix to prod until the equivalent rename migration runs there — prod's still-`estimated`-keyed rows would otherwise show the same blank state instead.

- **HealthTab "Last Night" sleep summary and stage bar only showed one segment of a wake-interrupted night** (`components/user-health/user-health.js`)

  A night with a long enough awake gap (several hours) splits into multiple discrete session records — the ring's own history parser (`SPLIT_GAP_MINS = 90` in `halo/index.js`) treats a >90min gap between blocks as a new session, and both the live BLE sync path and the server-hydration path picked only the single most recent night session for the "Last Night" quick-glance card and its stage bar. The 7-day weekly chart already summed every session sharing a night's date bucket, so it correctly showed the combined total (e.g. 6h36m across two segments) while the headline card showed only the later segment's duration (4h56m), and the 睡眠分期 stage bar rendered only that one segment with no visual gap for the hours spent awake in between.

  Two rounds of fixing were needed to get the merge right:
  - First pass grouped sessions by shared date bucket, but the grouping was still filtered down to only sessions individually classified as "night" by the `_isNightSession` hour heuristic (20:00–05:59). A segment that resumed after 6am (e.g. falling back asleep at 6:15 after being awake most of the night) is legitimately part of the same night but gets classified as a "nap" by that heuristic and was excluded from the merge even though it shared the same noon-to-noon date bucket.
  - Second pass fixed the grouping to pull in every session sharing the chosen night's date bucket (regardless of individual night/nap classification) — `_isNightSession` is now used only to decide *which* date bucket is "last night" (so a trailing daytime nap doesn't take it over), not to filter which sessions get merged into it.

  Even after both logic fixes landed, the phone kept showing the stale number — because the merge only runs at BLE sync time. `_loadWearableFromStorage()` (the non-coach display path) just replays whatever `sleepMinutes`/`sleepSlots` were pre-computed into `wx.storageSync('wearable_ring_data')` the last time a real BLE sync ran (`_commitRingData`); reloading the miniapp or redeploying code doesn't recompute those cached fields. Confirmed fixed only after forcing a fresh sync with the physical ring so `_commitRingData` re-ran with the corrected logic and overwrote the stale cached values.

  **Fix:** added `_mergeNightSessions()` (sums deep/light/rem/awake minutes across sessions and inserts a synthetic `awake` slot sized to the gap between them, so the stage bar visually shows the time spent awake) and `_selectLastNight()` (picks the most recent night's date bucket, then merges every session under it). Applied in both `_loadRingDataFromServer` (server-hydration/coach-mode path) and the Halo BLE live-sync path — the latter also deduplicated a `sleepHistory` mapping that was built twice. A stale local cache will still show the old numbers until the next real ring sync.

- **Server-hydrated wearable data missing HRV, stress, SpO2, temperature, resting HR, and all distribution/trend charts** (`functions/worker/handlers/chat.js`)

  `handleGetHealthEvents`'s SQL query never selected `external_id`, even though the miniapp's `_loadRingDataFromServer()` depends entirely on it to tell apart resting-HR/HRV/SpO2/temperature/realtime events — they're all stored under the same `category: 'vitals'`, distinguished only by `external_id` suffix (`_resting_hr_`, `_hrv_`, `_spo2_`, `_temp_`, `_realtime_`). With `external_id` always `undefined` in the response, every `extId.includes(...)` check silently failed and none of that data was ever categorized — steps and sleep worked (they don't need `external_id` matching), but HRV/stress/SpO2/temp/restingHr and the hourly/weekly charts derived from them stayed empty. Confirmed via direct inspection of the running miniapp simulator (WeChat DevTools automation) after the fix above: `hasHrv`/`hasStress`/`hasSpo2`/`hasBodyTemp`/`hasHr` all `false`, `stepsBars`/`hrBars`/`hrvDayBars`/`spo2DayBars` all `null`, while `hasSteps`/`hasSleep`/`sleepWeek` (which don't need `external_id`) worked fine — an exact match for the reported "Android shows full data, WeChat DevTools simulator shows a reduced subset" symptom. **Fix:** added `external_id` to the SELECT. Requires a worker deploy to take effect.

- **HealthTab wearable section empty on any client that never did a local BLE sync (simulator, fresh install, second device)** (`components/user-health/user-health.js`)

  `_loadWearableFromStorage()` (the self-mode load path — everything except `mode === 'coach'`) only ever read `wearable_ring_data` from local `wx.storageSync`, with no server fallback. The coach-mode path already had one (`_loadRingDataFromServer()`, which hydrates `ringData` from `/api/health-events` and sets a `wearableId: '__server__'` sentinel so the summary/detail cards render). Reported as: same account, same ring, fully synced and showing data on the Android app, but completely empty in a fresh WeChat DevTools simulator session that had never locally bound/synced a ring — it had no way to populate that local cache. (Note: WeChat DevTools' simulator does bridge to the host machine's real Bluetooth radio — confirmed by directly calling `wx.openBluetoothAdapter`/`getBluetoothDevices` and seeing real nearby devices — so this isn't a BLE-capability limitation, just a "hasn't paired here yet" state, same as any fresh install.)

  **Fix:** when there's no local `wearable_ring_data` snapshot **and** no local `wearable_device` binding, fall back to `_loadRingDataFromServer()` (same function coach-mode already uses) so the last-synced data from any client app shows instead of nothing. Guarded to only fire when there's truly no local device bound — if a real device *is* bound locally but just hasn't synced yet on this install, the fallback does not run, so it can never overwrite a real `wearableId` with the `'__server__'` sentinel and break the "Sync Now" button.

- **X3 ring — sleep, resting HR, and temperature silently empty after sync on rings with a large unsynced backlog** (`utils/wearable/x3/index.js`)

  `X3Ring._stream()` rejected the whole request if the ring's history transfer didn't finish (hit its terminator packet) within the timeout (8–15s depending on data type). Confirmed via direct BLE capture (`tools/x3-ring`) against a real ring that hadn't synced in 2+ weeks: the ring genuinely sends real, well-formed data for sleep (0x53), HR log (0x55), and temperature (0x62) — it just takes far longer than the timeout to stream a large backlog. Every caller wraps these in `.catch(() => [])`/`.catch(() => null)`, so the reject was silently swallowed and the UI showed "—" for sleep and resting HR with no error, indistinguishable from "the ring truly has no data."

  **Fix:** `_stream()` now resolves with whatever has accumulated so far on timeout instead of rejecting (only rejects if literally zero packets arrived). Since every notification is one complete, self-contained record, a partial buffer still parses correctly — it just loses the oldest tail of an unusually large backlog rather than the entire request. This mirrors the fix already applied to the standalone `tools/x3-ring` CLI's own copy of this logic during that investigation, which was never ported back into this canonical production file until now.

- **X3 ring — sleep records missing after sync** (`utils/wearable/x3/index.js`, `components/user-health/user-health.js`, `utils/wearable/sync.js`)

  Real overnight sleep would silently disappear from the app after syncing, sometimes for several days in a row, even though the ring had recorded it.

  **Root cause:** `f69742c` ("enabled pull to load more history") changed `_parseSleepHistory` to split same-night blocks into distinct sessions (e.g. an afternoon nap vs. the night's sleep) whenever there's a >90 min gap. `user-health.js` still picked only `sleepHist[sleepHist.length - 1]` (the chronologically last session) and treated it as "last night." If a nap happened after the real overnight sleep, the nap won instead. `sync.js` then tagged whatever was picked with a hardcoded `data_date = yesterday` regardless of which session it actually was, and upserted it into `health_events` keyed on `(user_id, source, external_id)` — so the mislabeled nap overwrote the correct prior night's row.

  Verified independently by connecting directly to the physical X3 ring over BLE (`temp/x3-connect.js`) — the ring's raw sleep buffer did contain the missing data; only the miniapp's session-selection and dating logic was dropping it.

  **What changed:**
  - `user-health.js` now keeps `sleepStart`/`sleepEnd`/per-stage `slots` on each entry in `raw.sleepHistory` (previously only `date`/`totalMinutes`/`deep`/`light`/`rem`/`awake`).
  - `sync.js` (`syncWearableData`) now builds one `sleep` event per calendar date from `snapshot.sleepHistory`, using each session's own recorded date instead of a hardcoded "yesterday" offset. Multiple sessions on the same date (nap + night) are merged into a single event rather than the last one silently winning. The old single-session/hardcoded-date path is kept as a fallback for sources without per-session history.
  - As a side effect, this also fixes a pre-existing chart/backend date mismatch for the Colmi ring, whose local sleep chart already dated sessions by their actual day (`_shanghaiDateStr(Date.now())`) while the backend previously stored them one day off.

### Added

- **Web admin panel — coach row opens a users modal** (`src/web/admin-panel/src/tabs/CoachTab.jsx`, `translations.js`)

  Clicking a coach row in the Coaches tab now opens a modal listing all users assigned to that coach (avatar/nickname, openid, BioAge, phone, email, join date), fetched from the existing `GET /api/coach-users/:coachId` endpoint. Action buttons (enroll/edit/delete) still work independently via `stopPropagation`, matching the Users tab's clickable-row pattern. New bilingual strings `modal.coachUsersTitle` / `modal.coachUsersEmpty`.

- **`tools/x3-ring` — standalone CLI for the X3 smart ring** (`tools/x3-ring/`, `utils/wearable/x3/index.js`)

  A Node/`noble`-based CLI (mirroring the existing `tools/colmi-ring` tool) for scanning, connecting to, and reading data directly from an X3 ring over BLE from a terminal — useful for debugging sync issues without going through the Mini Program. Run with no arguments to auto-scan and dump every stored data type (battery, device time/MAC/firmware, auto-monitoring schedule, steps, sleep history, heart rate, HRV, SpO2, temperature, exercise sessions, sleep apnea risk, oxygen variation); `scan` lists nearby rings; `set-time` syncs the ring's clock; `get-auto-monitoring` reads the HR/SpO2/Temperature/HRV background schedule on its own.

  **Bug fixed during live debugging against a real ring:** `src/ble.js`'s UUID comparison stripped dashes/lowercased but never expanded short-form UUIDs — noble reports `fff0`/`fff6`/`fff7` while `protocol.js`'s constants are full 128-bit UUIDs, so every connection failed with `X3 service ... not found`. Fixed by expanding 16-/32-bit UUIDs to the full Bluetooth base form, matching what the miniapp's `wx.*` ble-manager already does.

  Reuses the production X3 protocol (packet builders + BCD/byte parsers) from `src/mini/nano-miniapp/utils/wearable/x3/protocol.js` directly, so decoding stays identical to what the Mini Program does — only the BLE transport differs (`noble` instead of `wx.*`). `utils/wearable/x3/index.js` now also exposes its previously-private parsing functions as `X3Ring.parsers` (purely additive, no behavior change) so the CLI doesn't have to duplicate ~500 lines of delicate bit-parsing logic.

- **User web app — full feature parity with miniapp (all 4 phases)** (`src/web/user-app/src/`)

  Refactored from a single 1,585-line `App.jsx` into a modular structure and added Plans, Store, Events, Kino scan, and Health Reports. App now has 6 tabs: Chat, Health, Dots, Plans, Store, Learn.

  **Architecture changes:**
  - `App.jsx` → root shell only (~120 lines), imports from tab files
  - `i18n.js` — all bilingual strings (zh/en) extracted into one place
  - `utils.js` — shared helpers (`chronoAge`, `fmtDate`, `fmtDateTime`, `bioAgeColor`, `BM_META`)
  - `components/LoginScreen.jsx`, `components/Sparkline.jsx`, `components/Widgets.jsx` (DatePickerWidget, NameInputWidget, BodySliderWidget, LangToggle)
  - `tabs/ChatTab.jsx`, `tabs/HealthTab.jsx`, `tabs/DotsTab.jsx`, `tabs/AcademyTab.jsx` — existing features
  - `tabs/PlansTab.jsx` — health plan templates browser, active plan check-in with progress tracking, events sign-up/cancel
  - `tabs/StoreTab.jsx` — product grid with cart, shipping address form, CNY/credits payment, order history, credits balance + history
  - Shared modal system (`.modal-overlay`, `.modal-card`) used by Kino scan, checkin, checkout

  **Phase 4 features added to HealthTab:**
  - Kino chip link button (`scanChip`) → modal for manual chip code entry, calls `POST /api/kino-scan`
  - Health report generation button → calls `POST /api/health-reports`, lists past reports with markdown viewer

  **Backend change (`src/functions/worker/index.js`):**
  - `GET /events` now accessible without admin auth when `openid` query param is present; automatically maps `openid` → `user_id` for the signed_up field

### Added

- **Store cart — inline shipping form with WeChat address pre-fill** (`app.json`, `pages/main/main.{js,wxml,wxss}`, `handlers/chat.js`, `docs/architecture/orders-fulfillment.md`)

  The store cart now collects shipping details via an editable 收货信息 form inside the cart sheet, replacing reliance on the deprecated-fragile `wx.chooseAddress()` as the sole path. Recipient name pre-fills from `user.nickname` and phone from `user.phone`; the WeChat address book is an optional pre-fill helper via a 「使用微信地址」 button.

  **What changed:**
  - Cart sheet renders a name/phone/address form *inside* the `scroll-view` (so it scrolls with items while 结算 stays pinned). Fields fixed for text clipping (`box-sizing: border-box`, `line-height`, `min-height`).
  - `handleCheckout`: validates the form and submits directly; when the address is empty it pre-fills name/phone and calls `fetchWechatAddress()`. `fetchWechatAddress()` calls `wx.chooseAddress` to pre-fill, staying silent on cancel/deny and toasting otherwise.
  - **`app.json`: added `"chooseAddress"` to `requiredPrivateInfos`** — `wx.chooseAddress` fails with `the api need to be declared in the requiredPrivateInfos field` without it (that field is *not* geolocation-only). Still requires the MP-backend 用户隐私保护指引 「用户收货地址」 declaration; first-use consent flows through the existing `onNeedPrivacyAuthorization` modal.
  - `POST /api/heartbeat` now returns `phone` (`UPDATE ... RETURNING phone`), cached onto the user in `main.js`, because `login.js` strips phone from session storage as PII so it's null on session restore.
  - Fixed cart sheet dismissing on any inner button tap: `catchtap=""` → `catchtap="noop"` (empty handler name doesn't reliably register the catch binding).
  - **Insufficient-credits guard**: for credit-paid carts, `handleCheckout` now stops before submitting and shows an 积分不足 modal (with need/have amounts) when `creditBalance < needCredits`. Also fixed a latent bug where `_submitBatchOrder` ignored the response payload — `wx.request` resolves on HTTP 4xx too, so a backend `Insufficient credits` 400 previously still showed the success toast. It now checks `res.data.success`, surfaces insufficient-credits (re-syncing balance) vs. generic errors, and refreshes the balance after a successful debit. (Backend `handlePostOrderBatch` already validates balance transactionally — this is matching client UX + defense in depth.)
  - **No DB migration.**

- **Chat lab-report upload → consent → save to digital twin + photo lookup** (`prompts/nano/systemHealthReport.js`, `handlers/chat.js`, `handlers/health-plans.js`, `index.js`, `utils/tool-actions.js`, `pages/main/main.js`, `components/user-health/user-health.{js,wxml,wxss}`)

  When a user uploads a lab/checkup report photo in the chatbox, Nano now reads it out and then **asks for consent** before saving — instead of silently storing it. The user is asked (1) "Is this your own report?" and (2) "Save it to your health records?" via inline Yes/No buttons. On confirmation the report is saved to `health_reports` (with the photo) and, when core biomarkers are present, the BioAge digital twin is updated. Saved report photos are now viewable in the Health tab (thumbnail on each Lab card + full photo in the report detail sheet, tap to preview full-screen).

  **What changed:**
  - Vision prompt: Type-A (health report) output now also emits `institution`, `report_type`, and an `observations[]` array keyed by canonical `biomarker_catalog` `key_name`s.
  - `handlePostAnalyzeImage`: for `content_type === 'health_report'`, no longer auto-inserts a `biomarkers` row — returns `pending_health_report: true` + a `payload` (oss_key, get_url, report_date, institution, report_type, observations) and still saves the chat read-out. All other photo types unchanged.
  - `handlePostHealthReport`: accepts `oss_key`/`get_url`/`compute_bioage`, maps observations by `key_name` (in addition to `loinc_code`), stores the photo (`oss_key` column + `raw_data.image_url`), allows photo-only reports, and runs the existing lab-import BioAge pipeline inline when core markers are present (deps injected from `index.js`). `handleGetHealthReports` now returns `image_url`. Also fixed a pre-existing bug where its `ON CONFLICT (user_id, source, external_id)` on `health_events` was missing the `WHERE external_id IS NOT NULL` predicate, so it failed to match the partial dedup index and threw on every insert with observations.
  - Miniapp: `tool-actions.js` surfaces the pending flag to the page; `main.js` runs the two-step consent state machine (inline action-card buttons) and POSTs `/api/health-reports` on confirm; `user-health` renders report photo thumbnails + a tappable photo in the detail sheet (`wx.previewImage`). New zh/en strings added.
  - **No DB migration** — `health_reports.oss_key` already exists; the photo URL is stored in `raw_data`.

- **Coach invite codes — optional note/label** (`migration_invitations_note.sql`, `handlers/users.js`, `index.js`, `pages/coach/coach.js`, `coach.wxml`, `coach.wxss`)

  Coaches can now attach a free-text note to each invite code (e.g. "WeChat group A", "Spring promo") so they remember what each code is for. The note is captured when generating a code and can be edited later, and it shows on each invite card.

  **What changed:**
  - DB: `invitations` gains a nullable `note TEXT` column (`migration_invitations_note.sql`). **Run `npm run migrate:dev` then `npm run migrate:prod`.**
  - Backend: `handlePostInvitation` accepts and stores `note`; `handleGetInvitations` selects `note`; new `handlePatchInvitation(id, { note })` updates it, routed at `PATCH /api/invitations/:id` (guarded by `requireAdminTab('invites')`, same as create).
  - Miniapp: `generateInvite` now opens an editable `wx.showModal` to capture the note before creating; new `editInviteNote` edits an existing code's note via PATCH. The invite card shows a tappable note row (placeholder "Tap to add a note" when empty). Strings added to the `invite` block in both zh and en.

- **Coach CRM — move clients between pipeline stages via long-press** (`pages/coach/coach.js`, `pages/coach/coach.wxml`)

  Coaches can now long-press a card in the CRM pipeline kanban to open an action sheet of the other stages and move the client. The change persists via the existing `POST /api/client-pipeline` upsert and updates the kanban in place (counts adjust immediately); a short tap still opens the client detail sheet. No backend change.

  **What changed:**
  - `coach.js`: new `openStagePicker(e)` (action sheet → `POST /api/client-pipeline` with `coach_id`/`user_id`/`stage`, then local `clients` update + rebuild). Extracted `_buildPipelineColumns()` (plus `_stageOrder`/`_stageColorMap`) so `_loadCRM` and the picker share column-building logic. Added `crmMoveTitle`/`crmMoveSuccess`/`crmMoveError` strings (zh + en).
  - `coach.wxml`: pipeline card gains `bindlongpress="openStagePicker"` (keeps `catchtap` for detail).

### Changed

- **Coach panel swipe navigation is now edge-only** (`pages/coach/coach.js`, `pages/main/main.js`)

  The swipe shortcuts that open (main → coach, left-swipe) and exit (coach → back, right-swipe) the coach panel now only trigger when the swipe *starts* within ~40px of the relevant screen edge, matching native iOS edge gestures. Previously these were page-wide, so any horizontal in-page gesture (e.g. the CRM kanban interaction) could unintentionally navigate. The coach panel remains reachable via the menu button and native back.

- **Chatbox — load older messages on scroll to top** (`handlers/chat.js`, `index.js`, `pages/main/main.js`, `pages/main/main.wxml`)

  The miniapp chatbox previously loaded only the most recent 20 messages with no way to see older history. Scrolling to the top of the chat now fetches the previous page of messages and prepends them, while keeping the scroll position anchored to what was the first visible message.

  **What changed:**
  - `handleGetChatHistory` accepts a new `beforeId` parameter. When provided, it queries messages with `id < beforeId` (DESC, `limit+1`) then re-orders ASC, returning a `has_more` flag. The initial load also returns `has_more`.
  - `index.js` extracts `before_id` from the query string and passes it to the handler.
  - `main.wxml`: scroll-view gains `bindscrolltoupper="onScrollToUpper"` and `scroll-into-view="{{scrollAnchor}}"`. Message element IDs changed from `msg{{index}}` (unstable after prepend) to `m{{item.id}}` (content-based, stable).
  - `main.js`: `_initChat` now records `_oldestDbId` (min DB id in first batch) and `_hasMoreHistory`. `onScrollToUpper` triggers `_loadMoreHistory`, which fetches the previous page, normalises messages, prepends them, then anchors the scroll-view to the former first message via `scrollAnchor`. The anchor resets to `''` after 300 ms so normal bottom-scroll continues to work.

- **X3 ring — workMode badges and scheduled monitoring** (`user-health.js`, `user-health.wxml`, `user-health.wxss`)

  The interval settings panel now shows a tappable workMode badge next to each metric label (HRV, SpO₂, HR, Temp). Tapping cycles Off → Auto → Sched → Off. Badges are color-coded: green for active modes, red for Off. Defaults are `hr: 30 min / spo₂: 60 min / temp: 60 min / hrv: 120 min`, all in Scheduled mode (workMode = 2).

  **What changed:**
  - `x3WorkModes: { hr, spo2, temp, hrv }` added to component data; persisted via `wx.setStorageSync('x3_work_mode_settings')`.
  - `handleWorkModeChange(e)` handler cycles the mode; sets `x3IntervalsChanged: true` so Save button appears.
  - `saveRingIntervals` reads stored workModes and passes them to `setAutoMonitoring`.
  - `toggleRingSettings` reads back all 4 types via `getAutoMonitoring` and stores workModes alongside intervals.
  - On first X3 bind (`handleBindWearable`), default scheduled config is applied immediately to the ring and saved to storage.
  - `handleSyncWearable` now reads back type=4 after `setAutoMonitoring` and logs a WARN if HRV monitoring is not active.
  - Error logging in the X3 sync catch block gated behind `IS_DEV`.

- **X3 ring — temperature history fetch** (`user-health.js`, `x3/index.js`, `sync.js`)

  Temperature was collected by the ring but never fetched or displayed. Added `getTemperatureHistory()` method on the X3 driver (command 0x62, all cached days, no date filter). Sync now fetches the full temp history, picks the latest valid reading (>34 °C), and stores `bodyTempC` / `tempSlots` in the raw snapshot.

  `sync.js` now emits one `health_events` row per temperature reading (`external_id: smart_ring_temp_<timestamp>`) with `body_temp_c` and `skin_temp_c` fields, following the same per-reading upsert pattern as HRV/SpO₂.

- **X3 ring data display — multi-day trend charts** (`user-health.js`, `user-health.wxml`, `user-health.wxss`)

  The detail card now shows four daily trend bar charts above the dense history charts:

  | Chart | Source | Color scale |
  |---|---|---|
  | HRV 趋势 | `hrvSlots` daily avg, last 7 days | blue ≥80 / green ≥50 / orange ≥30 / red |
  | SpO₂ 趋势 | `spo2Slots` daily avg, last 7 days | blue ≥98% / green ≥95% / orange ≥90% / red |
  | 睡眠趋势 | `sleepHistory` per night, last 7 nights | green ≥7h / blue ≥6h / orange ≥5h / red |
  | 体温 | latest `bodyTempC` | green <37.2°C / orange <38°C / red |

  Body temperature also appears as a summary card in the metrics grid (same row as HRV/SpO₂/Stress), gated on `hasBodyTemp`.

  **What changed:**
  - `_buildRingDisplayData`: added `hrvDayBars`, `spo2DayBars`, `sleepDayBars`, `bodyTempC`, `tempPct`, `tempColor`, `hasBodyTemp`; `hasSlotCharts` extended to include all new chart types.
  - `.ring-chart-day-col`, `.ring-chart-day-avg`, `.ring-chart-day-label`, `.ring-reading-date-header` added to WXSS.

- **X3 ring data display — dense bar charts for HRV/SpO₂/Stress history** (`user-health.js`, `user-health.wxml`, `user-health.wxss`)

  Replaced the long scrollable grouped readings list (which could reach 200+ entries) with three dense bar charts — one each for HRV, SpO₂, and Stress. Each chart bins up to 48 bars from all cached readings (oldest → newest, left → right), with bar height encoding the value within its min–max range and bar color encoding quality.

  The header row shows the latest reading colored by quality; the footer shows min / count / max.

  **Note:** WeChat Mini Program does not apply `{{}}` data bindings to SVG child element attributes (`<polyline points="...">`, `<path d="...">`). The initial SVG implementation rendered blank charts. Replaced with the same WXML bar-column pattern used by the existing steps/HR charts.

  **What changed:**
  - `_buildReadingLineCharts(readings)` added: extracts HRV/SpO₂/Stress value arrays, bins into ≤48 bars with `_toBars()`, returns `{ hrvChart, spo2Chart, stressChart }` each with `{ hasData, bars, latestVal, latestColor, minVal, maxVal, count }`.
  - Called at both `_commitRingData` sites; result spread into `ringData` with `hasSlotCharts` updated to include line chart data.
  - `.ring-lc-bars`, `.ring-lc-col`, `.ring-lc-bar` added to WXSS.

- **X3 ring — multi-night sleep history** (`user-health.js`, `x3/index.js`)

  Sleep trend requires multi-night data. The X3 ring caches up to ~3 nights via command 0x53.

  **What changed:**
  - X3 sync path: `getSleep()` replaced with `getSleepHistory()` (returns all cached nights oldest → newest). Last element is used for the existing `sleepMinutes` / `sleepSlots` / `sleepStart` / `sleepEnd` fields. Full array stored as `sleepHistory: [{ date, totalMinutes, deep, light, rem, awake }]`.
  - Colmi sync path: `getSleep()` result wrapped into a single-element `sleepHistory` array so the display code is uniform.
  - `_buildRingDisplayData`: `sleepDayBars` computed from `raw.sleepHistory` (up to last 7 nights).

### Added

- **Finance tab visible to channel admins** (`auth.js`, `index.js`, `handlers/partners.js`, `handlers/credits.js`)

  Channel admin accounts (including autonomous channels like Aeviva China) can now access the **Finance** tab in the admin panel. They see partner payouts, coach commissions, channel payouts, and credit withdrawals scoped to their own channel. Previously the Finance tab was superadmin-only.

  - Added `finance:read`, `finance:write` to `CHANNEL_ADMIN_FULL_PERMS`
  - All Finance GET routes in `index.js` now inject `adminCtx.channelId` so channel admins are auto-scoped
  - `handleGetPartnerCommissions` now supports `channel_id` filtering
  - `handleGetAdminWithdrawals` now supports `channel_id` filtering via `users.channel_id`
  - Generate-payouts POST routes enforce channel scope for channel admin callers

### Fixed

- **Toolbox image upload — second upload silently hangs, picker never opens** (`components/toolbox/toolbox.js`, `pages/main/main.js`, `pages/coach/coach.js`, `utils/tool-actions.js`)

  After a user successfully uploaded an image, tapping "Upload Image" in the toolbox again produced no visible result — `wx.chooseMedia` was called (confirmed via vConsole) but neither the success nor fail callback ever fired.

  **Root cause:** `wx.chooseMedia` requires WeChat's privacy authorization (`onNeedPrivacyAuthorization`). The app routes that event through `_app._onPrivacyRequest`, which the `user-health` component registers to show its own privacy popup. However, `user-health` lives inside `.health-tab`, which applies `display: none !important` whenever the chat tab is active. A `position: fixed; z-index: 9999` element inside a `display: none` parent is also hidden — the user never saw the privacy prompt, could never tap "Agree", `resolve()` was never called, and `wx.chooseMedia` hung indefinitely. Each subsequent tap stacked another pending call.

  **What changed:**
  - `main.js` and `coach.js` each register their own `_app._onPrivacyRequest` in `onReady` (which fires after component `attached()`, so it wins over user-health's registration). This points to a page-level `showPrivacyModal` flag instead of user-health's component-scoped flag.
  - A privacy consent modal (`page-privacy-mask`) was added at the root of `main.wxml` and `coach.wxml`, outside all tab containers, so it is always visible regardless of which tab is active.
  - `onPrivacyAgree` / `onPrivacyCancel` handlers added to both pages; they call `_app._privacyResolve(...)` the same way user-health did.
  - After `readFile` loads the image into memory as an ArrayBuffer, the temp file is immediately `unlink`'d so WeChat can allocate a fresh temp path on the next `wx.chooseMedia` call.
  - After OSS PUT succeeds, the chat image message URL is swapped from the local temp path to the permanent OSS `get_url` (better for persistence and frees the temp file reference).

- **Aizo ring (Infinity Ring) — BLE scanning and UUID normalization fixes** (`ble-manager.js`, `user-health.js`, `aizo/index.js`, `colmi/index.js`)

  **What changed:**
  - **UUID Normalization:** Modified `_normalizeUUID` in `ble-manager.js` and `colmi/index.js` to support expanding standard 16-bit and 32-bit UUIDs (e.g., `fe02`, `010a`) to their 128-bit equivalents (using the standard Bluetooth base UUID `00000000-0000-1000-8000-00805f9b34fb`). This ensures standard 16-bit characteristic UUIDs returned by WeChat match the 128-bit strings defined in protocol files.
  - **Scanning by Name:** The physical "infinity ring" does not advertise its service UUID `fe02` in its BLE advertisement headers. Changed `AizoRing.scan` in `aizo/index.js` to scan by name prefixes (`AIZO_NAME_PREFIXES` which contains `"infinity"`) rather than filtering on `[BLE_SERVICE_UUID]`.
  - **Case-Insensitive Scan Matching:** Updated the scan loop in `user-health.js` and `ble-manager.js` to perform case-insensitive name prefix matching (e.g., matching `"Infinity Ring"` to `"infinity"`) and check `d.localName` if `d.name` is empty.

- **X3 ring settings — BLE connection leak causing '同步失败' on Save** (`user-health.js`)

  `toggleRingSettings` used `Promise.all` for 4 concurrent `getAutoMonitoring` calls. Because `_send` has a single `notifyHandler` slot, concurrent calls overwrote each other: 3 of 4 timed out, `Promise.all` rejected, and `ring.disconnect()` was never reached — leaving the BLE device connected. When "Save to Ring" was subsequently pressed, `ring.connect()` failed because the device was already connected, triggering the error toast.

  **What changed:**
  - `toggleRingSettings`: `Promise.all` replaced with sequential `await` calls; `ring` declared before `try` so `finally` can always call `ring.disconnect().catch(() => {})`.
  - `saveRingIntervals`: `ring.disconnect()` likewise moved to `finally`; catch now logs the error for easier debugging.

- **X3 health tab — repeated sync shows identical HRV/Stress/SpO2 readings** (`user-health.js`)

  `_commitRingData` accumulated the latest ring reading into `wearable_realtime_today` on every sync call. Because X3 auto-monitoring readings don't change between syncs (only the ring's own schedule updates them), each sync pushed the same HRV=142, Stress=91, SpO2=95 values with a new timestamp, making the "readings" list grow with identical entries.

  The `wearable_realtime_today` store was designed for Colmi Phase 2 on-demand measurements (each reading is new). For X3 the full per-measurement history is already in `raw.hrvSlots`/`raw.spo2Slots`.

  **What changed:**
  - Added `_slotsToReadings(hrvSlots, spo2Slots)` — merges HRV and SpO2 slot arrays by timestamp into the standard reading shape (CST timestamps converted to Unix ms via `+08:00` suffix).
  - `_commitRingData`: skips `wearable_realtime_today` accumulation when `raw.hrvSlots != null`; builds `realtimeReadings` from slots instead.
  - Page-load path (`_loadWearableFromStorage`) updated to the same slot-first logic.
  - Colmi path unchanged — falls through to existing `_getRealtimeReadings` when no slots are present.

- **X3 sync pipeline — per-measurement HRV and SpO2 storage** (`sync.js`, `user-health.js`)

  The X3 sync path in `user-health.js` was broken after `getHrvLog()` and `getSpo2Log()` were updated to return arrays: the code still accessed `.hrv` and `.spo2` as scalar properties on the returned arrays (both resolving to `undefined`).

  Additionally, only the last reading was ever stored; the full day's auto-monitoring history was discarded.

  **What changed:**
  - `user-health.js` X3 path: `getHrvLog()` / `getSpo2Log()` results now treated as arrays; last element used for display fields (`hrv`, `stress`, `spo2`, …); full arrays passed as new `hrvSlots` / `spo2Slots` fields.
  - `sync.js`: Added `hrvSlots` and `spo2Slots` to `WearableSnapshot`. When present, one `health_events` vitals row is generated per measurement (unique `external_id` = `smart_ring_hrv_<timestamp>` / `smart_ring_spo2_<timestamp>`). The existing single-realtime-event path is preserved for Colmi (which has no slots).
  - Repeated syncs upsert the same rows via `ON CONFLICT (user_id, source, external_id)` — no duplicates accumulate.
  - `health_twin` averages (`avg_hrv_ms`, `avg_spo2`) now reflect all daily readings rather than just the last sync.

- **X3 ring auto-SpO2 parser — array returned instead of single latest value** (`src/mini/nano-miniapp/utils/wearable/x3/index.js`)

  The old `getSpo2Log()` returned a single scalar (the last matching SpO2 value for today) instead of all readings.

  **What changed:**
  - `_parseSpo2Log66` replaced by `_parseSpo2Records66` — returns an array of `{ timestamp, spo2 }` records, deduped by timestamp and sorted oldest-first.
  - Added `getAutoSpo2History()` returning the full multi-day array (named `getAuto…` to avoid collision with the existing `getSpo2History()` which reads the 0x57 detail stream).
  - `getSpo2Log(date)` now calls `getAutoSpo2History()` internally and filters to the requested day.

  **Verified live** against an X3B ring: 80 unique records across 4 days (Jun 17–20) returned; today's 6 readings all correct.

- **X3 ring HRV parser — all records returned instead of last** (`src/mini/nano-miniapp/utils/wearable/x3/index.js`)

  The old `_parseHrvLog56` accumulated HRV fields into a single result object, overwriting each field with the next matching record. A ring with 293 records in its buffer (3+ days at 15-min intervals) returned only the values from the final record.

  **Root cause:** The parser looped through all 0x56 records but kept only one accumulator object, so every record overwrote the previous.

  **What changed:**
  - `_parseHrvLog56` replaced by `_parseHrvRecords56` — returns an array of all records, with `Set`-based deduplication by timestamp (ring sends the full batch twice in one BLE response) and sorted oldest-first.
  - `getHrvLog(date)` now calls the new `getHrvHistory()` internally and filters to the requested day, so both methods share a single BLE round-trip.
  - Added `getHrvHistory()` returning the full multi-day array, parallel to `getSleepHistory()`.

  **Verified live** against an X3B ring: 230 unique records across 4 days (Jun 17–20) now returned by `getHrvHistory()`; `getHrvLog()` for today returns all 15 readings instead of 1.

- **X3 ring sleep parser — multi-block 1-min format** (`src/mini/nano-miniapp/utils/wearable/x3/index.js`)

  The X3B ring stores sleep data as **130-byte 1-minute-resolution blocks** (up to 12 blocks ≈ 3 nights cached), not as 34-byte 5-minute blocks. The old `_parseSleep53` treated the entire multi-block response as one 130-byte single-block record, producing a 5-min nap instead of a full night.

  **Root cause:** the original format-detection used `buf.length === 130` as the only 1-min guard; any larger buffer fell through to the 34-byte parser, which then only found one valid `0x53` header (at offset 0) and discarded the rest.

  **What changed:**
  - Added `_dateStrToMin()` helper for gap arithmetic without JS `Date` timezone hazards.
  - `_parseSleep53` now checks `dataLen % 130 === 0` first (multi-block 1-min path), sorts the blocks oldest-first (ring transmits newest-first, with a sequence counter at `byte[1]`), then isolates the most recent continuous sleep session by dropping any blocks separated from the tail by a gap > 4 hours. Falls through to the 34-byte 5-min path for rings that use that format.
  - `getSleep()` stream timeout raised from 12 s → 15 s to handle larger multi-block transfers reliably.

  **Verified live** against an X3B ring: 1 562-byte response (12 × 130-byte blocks, 3 nights) now correctly returns only the last session — onset 00:17, 5 blocks, 6 h 47 m total (Deep 27 % / Light 53 % / REM 18 % / Awake 2 %).

### Refactored
- **Admin Panel — hub tab consolidation** — The web admin panel sidebar was reduced from 24 tabs to 20 by grouping related tabs under three new hub wrappers. Each hub renders a top-level subtab row and delegates to the existing tab components unchanged; no backend changes.

  | New hub tab | Replaces | Subtabs |
  |---|---|---|
  | **Hardware** (`tabs/HardwareTab.jsx`) | `kino` + `chips` | Devices (`KinoTab`) · Chips (`ChipsTab`) |
  | **Content** (`tabs/ContentTab.jsx`) | `academy` + `questionnaires` + `health-plans` + `events` | Academy · Questionnaires · Health Plans · Events |
  | **Finance** (`tabs/FinanceTab.jsx`) | scattered subtabs in Rewards + Partners + Store | Overview · Credit Withdrawals · Channel Payouts · Coach Commissions · Partner Payouts · Order Payments |

  **Finance tab** additionally adds a new **Order Payments** subtab — the first UI surface that exposes `payment_status` management for orders (mark an unpaid order as paid via `PUT /api/orders/:id { payment_status: 'paid' }`). Previously `payment_status` was displayed read-only inside the Store orders row detail.

  **Rewards tab** (`RewardsTab.jsx`) now shows only the Commission Settings subtab (rate config). Channel Payouts, Coach Commissions, and Credit Withdrawals subtabs moved to Finance.

  **Partners tab** (`PartnersTab.jsx`) Payouts subtab moved to Finance; Partners, Commissions, Commission Rules, and Partner Types subtabs remain.

- **Worker and Admin Panel modularisation** — Both large monolith files have been split into focused domain modules to improve maintainability and reduce Claude Code editing errors caused by context-window overrun.

  **Worker (`src/functions/worker/index.js`):** 11,635 → 1,019 lines. All handler functions extracted into `handlers/` (one file per domain) and shared auth/permission helpers extracted into `lib/auth.js`.

  | Handler file | Domain |
  |---|---|
  | `handlers/academy.js` | Academy courses, lessons, certifications, learning paths |
  | `handlers/admin-accounts.js` | Admin accounts, channel roles, admin login |
  | `handlers/channels.js` | Channel CRUD, subchannel management, rewards/store/warehouse config |
  | `handlers/chat.js` | AI chat, health advice, biomarkers, health events, health twin |
  | `handlers/coach-groups.js` | Coach group CRUD and KPIs |
  | `handlers/coaches.js` | Coach management, reminders, coach-user chat |
  | `handlers/commissions.js` | Commission settings, payout generation |
  | `handlers/crm.js` | Coach CRM — tags, pipeline, notes, campaigns, appointments, goals, NPS, KPIs, follow-up rules |
  | `handlers/credits.js` | User credit balance, history, withdrawals |
  | `handlers/digital-assets.js` | Digital assets, OSS presign, Kone APK releases |
  | `handlers/dots.js` | Dots inventory, cartridges, dispense, orders, nutrition plan, formulation |
  | `handlers/events.js` | Offline events (线下活动) |
  | `handlers/health-plans.js` | Health plan templates, plans, checkins, milestones, health reports |
  | `handlers/inventory.js` | Warehouse inventory stock |
  | `handlers/kino.js` | Kino devices, chip batches, chip models, scan flow |
  | `handlers/labs.js` | Lab providers, user mappings, lab reports, lab import |
  | `handlers/login.js` | WeChat login (miniapp + app), phone binding, invite validation, referrals |
  | `handlers/partners.js` | Partner system — types, rules, commission rules, referral network, payouts |
  | `handlers/questionnaires.js` | Questionnaire CRUD, assignments, responses, AI fill |
  | `handlers/reports.js` | Saved reports, admin report generation |
  | `handlers/store.js` | SKUs, store items, orders |
  | `handlers/tickets.js` | Support tickets |
  | `handlers/users.js` | User CRUD, dashboard stats, biomarkers, notifications, invitations |
  | `lib/auth.js` | Token sign/verify, permission constants, `requirePermission`, WeChat access-token cache |

  **Admin Panel (`src/web/admin-panel/src/App.jsx`):** 17,761 → 284 lines. All tab components extracted into `tabs/` (one file per tab). Shared utilities and the translation object split into `shared.jsx` and `translations.js`.

  | File | Contents |
  |---|---|
  | `translations.js` | The full `T` i18n object (EN + ZH) |
  | `shared.jsx` | `LangCtx`, `useLang`, `PERMS`, `hasPermission`, `LoginScreen`, `StatCard`, `RichStatCard`, `Badge`, `fmt`, `fmtDate`, `bioAgeColor`, Kino normalisation helpers |
  | `tabs/AcademyTab.jsx` | Academy — courses, lessons, library, certifications, learning paths _(wrapped by ContentTab)_ |
  | `tabs/AdminAccountsTab.jsx` | Admin account management |
  | `tabs/ChannelTab.jsx` | Channel CRUD, subchannel config, `ChannelConfigModal` |
  | `tabs/ChipsTab.jsx` | Kino chip batches and chip models _(wrapped by HardwareTab)_ |
  | `tabs/CoachCRMTab.jsx` | Coach CRM kanban, campaigns, client drawer |
  | `tabs/CoachTab.jsx` | Coach management, coach groups |
  | `tabs/ContentTab.jsx` | Hub: Academy · Questionnaires · Health Plans · Events |
  | `tabs/DashboardTab.jsx` | Dashboard KPIs and sparklines |
  | `tabs/DigitalAssetsTab.jsx` | Digital asset upload and management |
  | `tabs/DotsTab.jsx` | Dots catalogue management |
  | `tabs/EventsTab.jsx` | Offline events _(wrapped by ContentTab)_ |
  | `tabs/FinanceTab.jsx` | Hub: Credit Withdrawals · Channel Payouts · Coach Commissions · Partner Payouts · Order Payments |
  | `tabs/HardwareTab.jsx` | Hub: Kino Devices · Chips |
  | `tabs/HealthPlansTab.jsx` | Health plan templates and active plans _(wrapped by ContentTab)_ |
  | `tabs/InventoryTab.jsx` | Channel inventory, warehouses, SKUs |
  | `tabs/InvitesTab.jsx` | Invite code management |
  | `tabs/KinoTab.jsx` | Kino device management and APK releases _(wrapped by HardwareTab)_ |
  | `tabs/LabTab.jsx` | Lab providers, user mappings, lab reports |
  | `tabs/PartnersTab.jsx` | Partner system — Partners, Commissions, Commission Rules, Partner Types |
  | `tabs/QuestionnairesTab.jsx` | Questionnaire CRUD, assignment, responses _(wrapped by ContentTab)_ |
  | `tabs/ReportsTab.jsx` | Saved reports and admin report generation |
  | `tabs/RewardsTab.jsx` | Commission rate settings only (payouts moved to FinanceTab) |
  | `tabs/SimulatorsTab.jsx` | Kino and Nano simulators |
  | `tabs/StoreTab.jsx` | Store items, orders, SKUs, stock adjustments |
  | `tabs/TicketsTab.jsx` | Support tickets |
  | `tabs/UsersTab.jsx` | User management, user detail, credit, referral network |

  No functional changes — pure structural refactor. Build (`npm run build`) and worker syntax check (`node -e "require('./src/functions/worker/index.js')"`) both pass.

### Added
- **Magic Box (魔盒) — Digital Asset Distribution** — New miniapp tab and admin panel section for distributing large digital files (audio, video, APK, documents) to channel members.
  - **Schema** (`migration_digital_assets.sql`): new `digital_assets` table with `type`, `title`, `title_zh`, `oss_key`, `content_type`, `duration_seconds`, `channel_id`, `is_active`, `sort_order`.
  - **Backend** (`index.js`): 5 new endpoints — `GET /api/digital-assets`, `POST /api/digital-assets`, `PUT /api/digital-assets/:id`, `DELETE /api/digital-assets/:id`, `GET /api/digital-assets/presign`. Channel admins are scoped to their own channel's assets. Presigned GET URLs use 7-day expiry and the `nano-oss.fros.cc` CNAME domain.
  - **Miniapp — Box tab**: replaces the placeholder Wellness tab. Fetches all active assets for the user's channel. Audio assets play via `wx.getBackgroundAudioManager()` (lock-screen capable). Video/other assets copy a presigned download link to clipboard. Icon: `assets/icons/box.svg`. Tab label: **Box** (EN) / **魔盒** (ZH).
  - **Admin panel — Media tab**: full CRUD for digital assets. Channel admins see only their channel's assets with no channel selector. Superadmins get a channel filter dropdown. Presigned PUT URLs power direct-to-OSS uploads. Tab is at the bottom of the sidebar and is granted via `CHANNEL_ADMIN_FULL_PERMS`.
  - **OSS CNAME** (`nano-oss.fros.cc`): custom domain CNAME → `waven-nano.oss-cn-shanghai.aliyuncs.com`; `*.fros.cc` wildcard SSL cert bound via `aliyun oss bucket-cname --item certificate`. Download links are browser-accessible without raw OSS endpoint exposure. Full details: `docs/architecture/digital-assets.md`.

- **SKU Variant System** — Products with multiple sizes, colours, or other attributes are now modelled with a parent-child relationship inside the `skus` table.
  - **Schema** (`migration_sku_variants.sql`): added `parent_sku_id UUID REFERENCES skus(id)`, `attributes JSONB DEFAULT '{}'`, and `is_parent BOOLEAN DEFAULT FALSE` to `skus`. Index on `parent_sku_id` for fast child lookups. All three columns default to their "standalone" state so existing rows are unaffected.
  - **Backend** (`index.js`): `handlePostSku` and `handlePutSku` now persist and return the three variant columns.
  - **Admin panel — SKU modal**: 3-mode selector: **Standalone** (default), **Parent product** (`is_parent=TRUE`), **Variant / Child SKU** (`parent_sku_id` + attributes). Variant mode shows a parent picker, a dynamic key-value attribute editor, and a **Suggest code** button that auto-builds `{PARENT_CODE}-{ATTR_VALUES}`.
  - **Admin panel — SKU list** (Store tab and Inventory → SKUs sub-tab): collapsible tree view. Parent rows show a `PARENT` badge, variant count, and **Add Variant** shortcut. Child rows appear indented with coloured attribute chips. Standalone rows unchanged.

- **Autonomous channel flag** — A new `channels.autonomous` boolean (superadmin-only) lets a channel operate as a fully independent unit (e.g. country-level partner `aeviva-china`). When set, all capability flags are implicitly true; the JWT carries `auto: true` and the auth middleware overrides all per-request flags accordingly. Admin panel: purple `AUTO` badge on channel rows; toggle in Channel Settings → General (superadmin-only). API: `PUT /api/channels/:id/autonomous`. Migration: `migration_autonomous_channel.sql`.

- **Warehouse management for channel admins** — New `channels.can_manage_warehouses` boolean unlocks the **Inventory → Warehouses sub-tab** for channel admins, scoped to SKUs they own. Delegatable from a parent channel admin with `can_manage_subchannels`. Autonomous channels get this automatically. API: `PUT /api/channels/:id/warehouse-permission`. Migration: `migration_warehouse_permission.sql`.

- **Store tab access for autonomous channel admins** — Autonomous channel admins can now browse the **Store → Items sub-tab** (global catalog, read-only). SKUs, Warehouses, and Orders sub-tabs within Store remain superadmin-only.

### Fixed
- **WeChat unionid/openid db columns missing crash** — Created and applied [migration_add_wx_unionid_and_app_openid.sql](file:///Users/pin/waven/nano/src/schemas/migration_add_wx_unionid_and_app_openid.sql) to add missing `wx_unionid` and `wx_app_openid` columns to the `users` table, resolving database crash: `column "wx_unionid" of relation "users" does not exist` during guest registration/sign-on in WeChat mini-program.
- **Channels tab click blank screen / crash** — Fixed a crash in the web admin panel where clicking the "Channels" tab caused a blank screen. This was caused by: (1) Missing imports for `Building2`, `Users`, `Cpu`, and `Activity` icons from `lucide-react`. (2) Missing definition for `EMPTY_CHANNEL` referenced by the add channel modal state. (3) Missing definition for `SUB_AGE_KEYS_CONFIG` referenced by the sub-age label customization modal. (4) Missing definition for `uploadToOSS` helper referenced by the channel logo upload flow. All missing dependencies have been added/defined within [ChannelTab.jsx](file:///Users/pin/waven/nano/src/web/admin-panel/src/tabs/ChannelTab.jsx).
- **`loadTierCfg` ReferenceError hoisting fix** — Moved the `useEffect` hook below the declaration of the `loadTierCfg` async arrow function inside [ChannelTab.jsx](file:///Users/pin/waven/nano/src/web/admin-panel/src/tabs/ChannelTab.jsx) to prevent a runtime `ReferenceError` (accessing variable before initialization) when the "Partner Tiers" settings are loaded.
- **Missing `handleGetKinoUpgrade` endpoint handler** — Restored the `handleGetKinoUpgrade` handler function to [digital-assets.js](file:///Users/pin/waven/nano/src/functions/worker/handlers/digital-assets.js) and imported it inside [index.js](file:///Users/pin/waven/nano/src/functions/worker/index.js), resolving an undeclared `ReferenceError` that crashed the worker's `/kino-upgrade` GET endpoint after the code split.
- **SKU save "nothing happens" bug** — Three compounding issues were fixed: (1) `t.saveFailed` was referenced at the wrong object path in `SkuModal`. (2) Template literals in PUT/DELETE URLs used a backslash-escaped `\${sku.id}`, preventing interpolation. (3) `handlePostSku` didn't return a `statusCode` on DB errors, so unique-constraint failures returned HTTP 200 and the modal closed silently.

### Added
- **Channel-scoped Partner System** — Channels granted `can_customize_partner_system` permission can now define their own partner types and commission rules independently of the global system.
  - **Schema** (`migration_partner_channel_scope.sql`): added `channel_id` FK to `partner_types` and `partner_commission_rules`; unique constraint changed to `(COALESCE(channel_id,0), key)` so each channel can have its own type with the same key as a global type; `partners.tier` FK dropped (application-layer validation). Added `can_customize_partner_system BOOLEAN DEFAULT FALSE` to `channels`.
  - **Commission engine** (`partnerCommissions.js`): `getCommissionRules(eventType, channelId)` now prefers channel-specific rules when they exist; falls back to global rules if not. `getPartnerProductDiscount`, `recordReferralCommission`, and `recordSalesCommission` all pass channel context.
  - **API**: `GET /api/partner-types` returns effective types for caller context (channel-specific if permission+types exist, else global); `?channel_id=X` returns only types stored for channel X (for CRUD). All partner-types and commission-rules CRUD endpoints are channel-scoped — channel admins with permission can only manage their own channel's records. New `PUT /api/channels/:id/partner-system-permission` endpoint (same permission model as `partner-tiers-permission`).
  - **Admin panel**: New **Partner System** tab in Channel Settings modal — permission toggle, Partner Types CRUD table + add/edit form, Commission Rules CRUD table + add/edit form, subchannel permission toggles. Tab is only shown when the channel has permission or viewer is superadmin.

- **Flexible Partner Types & Commission Rules** — Replaced all hardcoded partner tier strings (`light_entrepreneur`, `leader_partner`, `operations_center`) and the singleton `partner_commission_config` table with dynamic, admin-configurable systems.
  - **New `partner_types` table** — create/edit/deactivate partner types from the admin panel without code changes. `sort_order`, `label`, `label_zh`, `color`, `entry_fee` all configurable per type. `partners.tier` CHECK constraint replaced with a FK to `partner_types.key` (ON UPDATE CASCADE).
  - **New `partner_commission_rules` table** — replaces `partner_commission_config` singleton. Each row is one commission rule: `event_type` (`referral`, `team_income`, `product_discount`, `training_discount`), `upline_level` (N levels supported), `earner_type` / `subject_type` (NULL = wildcard). Seeded from existing config on migration.
  - **N-level commission engine** (`src/functions/worker/lib/partnerCommissions.js`) — `recordReferralCommission` and `recordSalesCommission` now use recursive CTEs to walk up as many levels as defined in commission rules, enabling 2nd-level referral cascade and 3+ level team income. Rate resolution uses most-specific-match (earner+subject > earner-only > wildcard).
  - **8 new API endpoints** — `GET/POST /api/partner-types`, `PUT/DELETE /api/partner-types/:key`, `GET/POST /api/partner-commission-rules`, `PUT/DELETE /api/partner-commission-rules/:id`. Existing `/api/partner-commission-config` endpoints kept as backward-compat shims.
  - **Admin panel** (`src/web/admin-panel/src/App.jsx`) — Partners tab gains "Partner Types" sub-tab with full CRUD. Tier dropdowns, referral matrix, and discount tables all render dynamically from the API. Channel config partner-tiers tab fetches types from API instead of hardcoded defaults.
  - **Migrations**: `migration_partner_types.sql`, `migration_partner_tier_dynamic.sql`, `migration_partner_commission_rules.sql`.

### Fixed
- **Health report shows wrong biomarker value inconsistent with BioAge** — `handlePostHealthAdvice` merged `data.actual` over `data.estimated` when building the biomarker object passed to the LLM prompt. Because `BiomarkerEstimator` only accepts hsCRP values ≥ 0.2 mg/L, a submitted value of 0.14 was rejected and replaced with an age-based estimate (1.02) for the BioAge calculation — but `data.actual.hsCRP = 0.14` still survived the merge and reached the LLM. The report then narrated "hsCRP = 0.14 mg/L, excellent health" while the stored ResilienceAge was computed with 1.02, contradicting the text. Fix: use `data.estimated` directly (already contains the actual value when it is valid, and the validated estimate when it is not). `src/functions/worker/index.js` `handlePostHealthAdvice`.
- **Coaches tab shows stale channel after user reassignment** — `coaches.channel_id` was a redundant copy of `users.channel_id` that was never synced when a user's channel changed. Finished the rationalization started by `migration_rationalize_coaches`: dropped the column and updated all queries to derive channel via `JOIN coaches → users → channels`. Migration: `src/schemas/migration_coaches_drop_channel_id.sql`. The Coach modal's channel selector has been removed.

### Added
- **WeChat Multiterminal Apps (Donut) Documentation** — Added architectural documentation (`docs/architecture/wechat-multiterminal.md`) outlining WeChat's Donut Multi-platform Framework. This includes configuration workflows, DevTools integration, Mobile App Assistant testing tools, debugging limitations, and the path for deploying `nano-miniapp` as native iOS and Android packages.
- **Weight recording via scale photo** — Users can now photograph their weight scale in the chat tab (toolbox → Upload Image). The vision model (`qwen-vl-plus`) reads the displayed value, handles kg/lb conversion, compares to the last 5 weight records for plausibility, auto-saves as a `body_composition` biomarker, and replies in chat with the recorded value and a trend vs. recent average (or a warning if the value differs by more than 20 kg). No UI changes to the miniapp — reuses the existing photo upload flow. `src/functions/worker/index.js` `handlePostAnalyzeImage`, `buildWeightNarrative`; `src/functions/worker/prompts/nano/systemHealthReport.js` (added Type E — scale_reading).
- **Web Admin Panel — Dashboard overhaul** (`src/web/admin-panel/src/App.jsx`, `style.css`, `src/functions/worker/index.js`) — rebuilt the Dashboard tab around real time-series data instead of static aggregate buckets.
  - **New backend endpoint** `GET /api/admin/dashboard-stats` (`handleGetDashboardStats`) — read-only aggregates in one round trip: daily signups / scans / orders+revenue for the last 30 days, bio-age-delta histogram (6 buckets, latest biomarker per user vs chrono age), average sub-ages for the four dimensions (from `biomarkers.data->bioage_profile->SubAges`), top-8 channels by user count (superadmin only), revenue totals (30d + all-time), open ticket count, and the 6 newest users with avatar/bio-age/channel. Channel admins are automatically scoped via `adminCtx.channelId`; requires worker deploy to take effect.
  - **KPI row**: five cards with 30-day sparklines — users (+7d), scans (+7d), revenue 30d (with all-time sub), coaches (+7d), avg bio-age (Δ vs chrono).
  - **30-Day Activity chart**: dual-gradient area chart of daily signups and scans (zero-filled days).
  - **Needs Attention panel**: live counts for pending orders, open tickets, inactive Kino devices, low chip stock (<15% available), and untested users — each row navigates to the relevant tab (respecting channel-admin tab permissions); shows an all-clear state when empty.
  - **Bio-Age Δ distribution** histogram (green→red buckets) with gender/tested% footer; **Four Dimensions card** with average sub-age bars and per-dimension delta vs average chrono age; **Orders & Revenue card** with status donut (computed from the orders list) plus 30d/all-time revenue.
  - **Superadmin row**: top channels by users (ranked bars) and Kino hardware with a chip-usage progress bar.
  - **Recent Users / Recent Orders** tables upgraded: avatars, channel column, item name (localized), order amount (¥ price×qty), and status badges. Recent users now come from the new endpoint — previously the superadmin list was sorted by a `created_at` field the minimal users query never returned.
- **Web Admin Panel — CRM tab overhaul** (`src/web/admin-panel/src/App.jsx`, `style.css`) — the CRM tab now surfaces the full coach-CRM backend (tags, stage changes, notes, activity log, goals, campaign recipients, message templates) that was previously API-only. Frontend-only change; no backend or DB modifications.
  - **Pipeline**: new Kanban board view (default) with one column per stage — client cards show avatar, bio-age delta, colored coach tags (`/api/coach-tags`), last scan, and days-in-stage; drag-and-drop between columns persists the stage via `POST /api/client-pipeline` (optimistic update with rollback on failure). Toggleable table view with inline stage dropdown, search box (name / user id / tag), and summary stat cards (total, active, at-risk, avg Δ bio-age, scanned %).
  - **Client drawer**: clicking a client opens a slide-in panel with four tabs — Overview (ages, delta, stage, tags, stage note), Notes (full CRUD + pin/unpin via `/api/coach-notes`), Activity (icon timeline from `/api/client-activity`), Goals (progress bars from `/api/client-goals`).
  - **Campaigns**: stat cards (total / sent / drafts / reach), per-campaign delivery progress bar (`sent_count/recipient_count`), recipients modal with per-user delivery status (`/api/bulk-campaigns/:id/recipients`), and a message-template picker in the create modal (`/api/message-templates`) that prefills title/content. Create modal switched from the unstyled `modal-backdrop` class to the proper `modal-overlay`.
  - **Activity (new sub-tab)**: coach-wide activity timeline (`/api/coach-activity-feed`) alongside the next 7 days of appointments (`/api/appointments/upcoming`).
  - **Performance**: clickable sortable column headers, totals row, and a clients-vs-scans comparison bar chart across coaches.
  - **NPS**: 0–10 score-distribution histogram (promoter/passive/detractor colors), coach filter, and a response-rate stat; aggregate cards always visible.
  - Sub-tab buttons now use the shared `.subtab-btn` style; new CSS blocks for the kanban board, drawer, timeline, notes, tag chips, and progress bars appended to `style.css`.
- **HTML store item descriptions (text + pictures)** — store item and channel inventory descriptions can now contain HTML, including `<img>` pictures.
  - **Web Admin Panel** `src/web/admin-panel/src/App.jsx`: new shared `HtmlDescField` component replaces the plain desc inputs in both the Store item modal and the Channel Inventory item modal — multiline HTML textarea, an **Insert image** button (uploads to OSS via the existing `/api/oss/presign` flow with progress %, inserts the `<img>` tag at the cursor position), and a live HTML preview toggle. The preview is sanitized (scripts, iframes, `on*` handlers, and `javascript:` URLs stripped) since descriptions can be authored by channel admins but previewed by superadmins.
  - **Miniapp** `src/mini/nano-miniapp/pages/main/`: store cards detect HTML descriptions and render them with `<rich-text>`; `<img>` tags are normalized to `max-width:100%` so pictures fit the card. Plain-text descriptions render exactly as before.
  - No DB change — `desc_en` / `desc_zh` are already `TEXT` on both tables.
- **Partner store pricing** — active partners see (and pay) their tier's discounted product price in the miniapp store, with the regular price shown struck-through next to a "合伙人价 / Partner Price" badge. The discount comes from `partner_commission_config.product_discount_rates` (default 30% / 40% / 50% for light_entrepreneur / leader_partner / operations_center).
  - **Backend** `src/functions/worker/lib/partnerCommissions.js`: new `getPartnerProductDiscount(userId)` (resolves the active partner record for a user and its tier's product discount rate) and `applyPartnerDiscount(price, rate)`.
  - **Backend** `src/functions/worker/index.js`: `GET /api/store-items?openid=…` returns `partner_price_cny` / `partner_price_usd` per item plus a top-level `partner: {tier, discount_rate}` when the user is an active partner; `POST /api/orders` and `POST /api/orders/batch` apply the same discount server-side so the recorded order price matches the displayed partner price.
  - **Miniapp** `src/mini/nano-miniapp/pages/main/`: store cards show the partner price (accent color) with the regular price struck through; cart rows and the cart total use the partner price.
- **Channel-scoped partner tier customization** — root channels and permitted sub-channels can override partner tier display names, entry fees, colors, and descriptions on a per-channel basis; unpermitted sub-channels inherit from their parent.
  - **DB migration** `src/schemas/migration_partner_tiers_config.sql`: adds `can_customize_partner_tiers BOOLEAN` (permission flag, default false) and `partner_tiers_config JSONB` (null = inherit) on `channels`.
  - **Backend** `src/functions/worker/index.js`: `GET/PUT /api/channels/:id/partner-tiers-config` (walk parent chain, read/write tier config), `PUT /api/channels/:id/partner-tiers-permission` (parent admin grants flag to child).
  - **Web Admin Panel** `src/web/admin-panel/src/App.jsx`: new **Partner Tiers** tab in `ChannelConfigModal` with per-tier card editor (label EN/ZH, entry fee, color, description), source-inheritance badge, and sub-channel permission toggles. `PartnersTab` now fetches the effective tier config for the current channel and uses live labels/colors.
- **Academy System Overhaul** — upgraded the academy from a flat video library into a full continuous-learning platform for coaches with credits, tiers, quizzes, certifications, and learning paths.
  - **DB migration** `src/schemas/migration_academy_overhaul.sql` (migration #79):
    - Extended `academy_courses` with `credit_value`, `level` (foundation/intermediate/advanced/expert), `prerequisite_course_id`, `thumbnail_oss_key`.
    - Extended `academy_lessons` with `content_type` (video/text/interactive), `text_content`, `credit_value`, `min_watch_seconds`.
    - Extended `academy_coach_progress` with `credits_earned`, `quiz_best_score`, `time_spent_seconds`.
    - New `academy_lesson_quizzes` — per-lesson quiz questions with scenario text, JSONB options, and per-question credit values.
    - New `academy_quiz_attempts` — per-coach attempt record with answers, 0–100 score, pass/fail status.
    - New `academy_credit_ledger` — append-only event log separate from the monetary `credit_ledger` (reasons: `lesson_complete / quiz_pass / cert_earned / bonus`).
    - New `academy_certifications` — admin-managed cert definitions with required course list, min credits, and tier (bronze/silver/gold/platinum).
    - New `academy_coach_certifications` — certs earned by coaches (unique per coach+cert).
    - New `academy_learning_paths` and `academy_learning_path_courses` — curated ordered course sequences by tier.
  - **Backend** `src/functions/worker/index.js`:
    - Modified `GET /academy/courses`, `POST/PUT /academy/courses`, `GET /academy/lessons`, `POST/PUT /academy/lessons` to accept/return the new fields.
    - Modified `POST /academy/progress` to award lesson credits (first completion only) and auto-check certification eligibility via `_checkAndAwardCertifications()`.
    - New `GET /academy/lessons/:id` — lesson detail with quiz questions.
    - New `POST /academy/quiz-attempts` — scores submitted answers, awards credits on first pass, returns `{score, passed, credits_earned, correct_answers[]}`.
    - New `GET/POST/PUT/DELETE /academy/lesson-quizzes` — admin CRUD for quiz questions.
    - New `GET/POST/PUT/DELETE /academy/certifications` — admin CRUD for certification definitions.
    - New `GET/POST/PUT/DELETE /academy/learning-paths` — admin CRUD for learning paths with ordered course assignment.
    - New `GET /academy/coach-dashboard` — aggregated stats (credits, tier, lessons, quizzes, certs).
    - New `GET /academy/coach-credits` — credit total, tier, ledger history.
    - New `GET /academy/coach-certifications` — coach's earned certifications.
    - New `GET /academy/leaderboard` — top 20 coaches by total credits.
  - **Web Admin Panel** `src/web/admin-panel/src/App.jsx` — AcademyTab expanded from 3 to 5 subtabs:
    - **Courses**: course form adds level, credit_value, prerequisite dropdown; lesson form adds content_type toggle (Video/Text/Interactive), text editor, credit_value, min_watch_seconds; inline `QuizEditorSection` per lesson for managing quiz questions.
    - **Certifications** (new): CRUD table + modal for certification definitions — tier badge, required courses checklist, min credits.
    - **Paths** (new): CRUD table + modal for learning paths — ordered course list with up/down reordering.
    - **Progress** (enhanced): adds credits_earned and quiz_best_score columns; side panel shows top-20 leaderboard with tier badges.
    - Full bilingual (EN/ZH) localization via existing `useLang()` hook.
  - **Coach Mini-App** `src/mini/nano-miniapp/pages/coach/`:
    - Credit dashboard card at top of Training tab (total credits, tier badge, lesson/quiz/cert counts).
    - Learning paths section with per-path progress bars.
    - Lesson player: content_type routing (video → presigned OSS; text/interactive → scrollable text); quiz panel with scenario, question list, submit, score + explanations.
    - Mark-complete button gated on quiz pass (if quiz exists).
    - Certifications grid: earned badge cards + locked (grayed) not-yet-earned certs.
  - **Docs** `docs/architecture/academy-system.md` — full architecture reference.

- **Credit system for commissions** — all commission earnings (referral, coach, channel) now flow into a per-user credit ledger. Users can exchange credits for cash via a withdrawal request processed by a superadmin.
  - **DB migration** `src/schemas/migration_credit_system.sql`:
    - `credit_ledger` — append-only ledger; one row per earn or debit event; balance = `SUM(amount)` per user.
    - `credit_withdrawals` — tracks cash-out requests through `pending → approved → completed` (or `rejected`). Exchange rate is snapshotted at request time.
  - **Credit library** `src/functions/worker/lib/credits.js`: `creditUser`, `debitUser`, `getUserBalance`, `getLedgerHistory`, `getChannelExchangeRate`, `getChannelCurrency`.
  - **Commission service** `src/functions/worker/lib/commissions.js`: after each commission insert, calls `creditUser()` using the channel's exchange rate. Covers referral, coach, and channel commissions.
  - **Per-channel exchange rate**: stored in `channels.config.credit_exchange_rate` (credits per 1 unit of currency) and `channels.config.currency` (ISO code). Configurable in the Channels edit modal.
  - **Backend** `src/functions/worker/index.js`:
    - `GET /api/credits/balance` — user's balance, exchange rate, currency.
    - `GET /api/credits/history` — paginated ledger.
    - `POST /api/credits/withdraw` — submit a cash-out request (validates balance).
    - `GET /api/credits/withdrawals` — user's own withdrawal history.
    - `GET /api/admin/credit-withdrawals` — admin list, filterable by status.
    - `PUT /api/admin/credit-withdrawals/:id` — approve (triggers ledger debit) / reject / complete.
  - **Web Admin Panel** `src/web/admin-panel/src/App.jsx`:
    - Rewards tab → new **Credit Withdrawals** sub-tab: table with approve / reject / mark-completed actions.
    - Channels edit modal → **Exchange Rate** and **Currency** fields.
  - **Miniapp main page** `pages/main/main.js` + `main.wxml` + `main.wxss`: credit balance fetched on load and on show; displayed as a tinted row at the top of the header menu when balance > 0; tapping navigates to the referral page.
  - **Miniapp referral page** `pages/referral/referral.js` + `.wxml` + `.wxss`: credit balance card, cash-equivalent display, withdrawal bottom-sheet form, withdrawal history list with status badges.


- **Complete Orders Fulfillment & SKU Registry System** — comprehensive, enterprise-grade e-commerce, multi-location stock tracking, and logistics workflow across backend, mini program client, and web admin dashboards.
  - **DB Migration (`migration_orders_fulfillment.sql`)**:
    - `skus` table: centralized registry of raw physical/virtual product assets (`WD-DOT-MONTHLY`, `KINO-CHIP-V2`, etc.) mapping standard names, units, and types.
    - `inventory_stock` table: maps SKU assets to specific warehouse (`shanghai-central`) or clinic channels with quantities and low-stock warning thresholds.
    - Extended `orders` table: adds support for shipping recipient name, phone, address, carrier name, tracking numbers, shipped/delivered timestamps, and asset serial logs.
  - **Worker Backend (`index.js`)**:
    - Extended `handlePostOrder` to extract `sku_id` and perform atomic location-scoped stock checks and decrements.
    - Upgraded `handlePutOrder` to log shipped/delivered timestamps and implement **auto-restock on cancellation** (cancelling orders automatically returns stock to locations).
    - Upgraded `handleGetMyOrders` and `handleGetOrders` to resolve joined custom names, units, and tracking data via `skus` fallbacks.
    - Added SKU CRUD APIs (`GET/POST/PUT/DELETE /api/skus`) and Stock Adjustments APIs (`POST /api/inventory-stock`).
  - **WeChat Mini Program Client**:
    - Integrated native WeChat address picker (`wx.chooseAddress`) with developer mock fallbacks.
    - Upgraded order cards with recipient details, collapsible logs, click-to-copy courier codes (`wx.setClipboardData`), and client-side cancellation actions.
    - Fixed shortId fallback naming rendering bug in client-side order listings.
  - **Web Admin Panel Dashboard (`App.jsx`)**:
    - Added collapsible order drawer rows displaying shipping address cards, fulfillment logs, and payment states.
    - Built a premium glassmorphic **Fulfillment & Shipping Modal** to collect courier carrier, tracking code, logistical comments, and pre-printed hardware serial IDs.
    - Built the **SKUs & Stock Registry Subtab** inside the Store Management page with comprehensive SKU CRUD modals (`SkuModal`, `DeleteSkuConfirm`) and a premium **Location Stock Adjuster Widget** (`StockAdjustModal`) with low-stock warnings.
    - Added SKU binding selectors to both global `StoreItemModal` and channel-specific `ChannelInventoryItemModal`.
- **Coach Groups** — business entity groupings (clinics, studios, nutrition stores) within a channel, enabling group-level KPI aggregation.
  - **DB migration** `src/schemas/migration_coach_groups.sql`: new `coach_groups` table (`id, channel_id, name, description, type`); adds nullable `group_id` FK on `coaches`.
  - **Backend** `src/functions/worker/index.js`:
    - `GET /api/coach-groups?channel_id=X` — list groups with `coach_count` per group.
    - `POST /api/coach-groups` — create a group (channel-scoped).
    - `PUT /api/coach-groups/:id` — update name/description/type.
    - `DELETE /api/coach-groups/:id` — delete group; `ON DELETE SET NULL` FK ungroups coaches automatically.
    - `GET /api/coach-group-kpis?group_id=X&period=YYYY-MM` — aggregate KPIs across all coaches in the group; uses `coach_performance_snapshots` for historical months, live SQL for current month.
    - `GET /coach-list` and `GET /channel-coaches/:id` — now return `group_id` and `group_name` per coach.
    - `POST /coaches` and `PUT /coaches/:id` — now accept optional `group_id`.
  - **Web admin panel** `src/web/admin-panel/src/App.jsx`:
    - **CoachTab**: group filter pills, "Group" column in coach table, inline group management panel (add/edit/delete groups), group assignment in `CoachModal`.
    - **CoachCRMTab**: new "Groups" sub-tab showing aggregate stat cards + KPI table + per-coach breakdown for the selected group.

### Changed
- **Coach / user architecture rationalized** — `users` is now the single source of truth for coach identity. The `coaches` table is a thin "coach seat" (`id, user_id NOT NULL UNIQUE, channel_id, created_at`); all profile data (name, email, phone, avatar_url, language) is read from the linked `users` row via JOIN.
  - **DB migration** `src/schemas/migration_rationalize_coaches.sql`: enforces `coaches.user_id NOT NULL UNIQUE`, changes FK to `ON DELETE CASCADE`, drops the duplicated profile columns. A follow-up `migration_rationalize_coaches_fix.sql` ensures the drops are applied where the first migration was tracked but rolled back.
  - **Worker** `src/functions/worker/index.js`:
    - `GET /coach-list` and `GET /channel-coaches/:id` now JOIN `users` for profile fields; response shape is unchanged (same field names).
    - `GET /users`, `GET /channel-users/:id`, `GET /wx-login` — `coach_name` now comes from the linked coach's `users.nickname` instead of the dropped `coaches.name` column.
    - `POST /coaches` — `user_id` is now required; inserts only `(user_id, channel_id)`; always adds `'coach'` role to the linked user.
    - `PUT /coaches/:id` — updates only `user_id` and `channel_id`; profile edits go through `PUT /users/:id`.
    - `DELETE /coaches/:id` — **bug fixed**: now removes `'coach'` role from the linked user after deletion; blocked with 409 if the coach still has assigned users.
    - `PUT /users/:id` — **new**: assigning the `'coach'` role automatically creates a `coaches` row (using the user's `channel_id`); removing the `'coach'` role deletes it. Removal is blocked with 409 if users are still assigned.
    - `GET /users` — results now ordered by `created_at DESC` (newest first).
  - **Web admin panel** `src/web/admin-panel/src/App.jsx` — `CoachModal` replaced name/email/phone/language inputs with a live user-search picker; only `user_id` and `channel_id` are submitted.
  - **Miniapp admin panel** `src/mini/nano-miniapp/pages/admin/` — coach add/edit form replaced with a native picker over the channel's user list.
  - **Miniapp coach panel** — no change required; only uses `coach.id` and `coach.channel_id` from the login response.

### Added
- **External lab integration (`nano-lab`)** — new Aliyun FC function that ingests clinical lab results from third-party laboratory systems and feeds them back into the BioAge pipeline.
  - **New FC function** `src/functions/lab/` (512 MB, 600 s timeout): routes `POST /lab/webhook/:labName` (push — lab notifies Nano) and a 4-hour timer trigger (pull — Nano polls the lab API). Both paths converge on the same normalization and storage pipeline.
  - **Adapter registry** `src/functions/lab/lib/adapters/`: each lab is one file implementing `{ validateWebhook, fetchOrder, fetchNewResults, parseResponse }`. `generic.js` ships as a reference implementation. Adding a lab = one file + one `lab_providers` row + redeploy.
  - **DB migrations**:
    - `migration_biomarker_catalog.sql` — `biomarker_catalog` table: registry of all 26 known biomarkers (6 Kino core + 20 clinical panel) with LOINC codes, Chinese display names, units, categories, `nano_dimension` mapping, and reference ranges.
    - `migration_health_reports.sql` — `health_reports` table: document-level wrapper for complete lab/health report uploads (institution, date, status, OSS key, raw observations). Adds `report_id` FK to `health_events`.
    - `migration_lab_user_mappings.sql` — `lab_user_mappings` table: maps each lab's patient identifier to a Nano `user_id`. Fallback: phone number match.
    - `migration_lab_providers.sql` — `lab_providers` table: per-lab instance credentials, base URL, polling state, and soft-delete flag. Supports multiple regional instances of the same lab.
  - **EventBridge integration**: on ingestion, if ≥1 Kino core biomarker is found, `nano-lab` publishes `{ source: 'acs.lab', type: 'biomarker.lab_complete', data: { report_id, user_id } }` using FC context credentials (same pattern as the dispatcher).
  - **Worker: `handleLabImportEvent`** — new EventBridge handler in `src/functions/worker/index.js`. Loads the report's Kino core observations, fills missing values via `BiomarkerEstimator`, runs `BioAgeCalculator`, inserts a `biomarkers` row with `test_type='lab_import'`, and calls `updateHealthTwin`.
  - **Worker: health report API routes** — `POST /health-reports` (store a report with raw observations or a FHIR R4 Bundle), `POST /health-events/fhir` (alias with `source='fhir_import'`), `GET /health-reports` (list by user), `GET /health-reports/:id` (report + linked events).
  - **Worker EventBridge CloudEvent detection** — the handler now checks for `event.specversion` before HTTP routing and short-circuits to the appropriate CloudEvent handler; returns 200 immediately for all EventBridge invocations.
  - **`tagRegistry.js`**: restored `BIOMARKER_DEFINITIONS` export (6 Kino biomarkers with LOINC codes + units) that was removed by a previous linter pass.
  - **`s.yaml` / `s-prod.yaml`**: `lab:` function block added; worker EventBridge filter extended to `["acs.dispatcher","acs.lab"]`; domain routes `/lab/*` and `/lab` added.
  - **`package.json`**: `deploy:lab` and `deploy:lab:prod` scripts added.
  - **Architecture doc** `docs/architecture/lab-integration.md`.

- **Digital Twin health profile system** — continuous wearable/lifestyle data stored as a two-layer model alongside the existing Kino chip biomarkers.
  - **DB migrations** `src/schemas/migration_health_events.sql` and `src/schemas/migration_health_twin.sql`: append-only event log (`health_events`) for all time-series health data and a one-row-per-user materialized summary (`health_twin`) with 7-day rolling averages, latest body/lab/Kino values, and 30-day trend signals.
  - **Five event categories**: `sleep`, `activity`, `vitals`, `body_composition`, `lab_result`. Six data sources: `apple_health`, `garmin`, `fitbit`, `manual`, `annual_lab`, `hospital`. Deduplication via `UNIQUE (user_id, source, external_id) WHERE external_id IS NOT NULL`.
  - **Real-time updater** `src/functions/worker/lib/healthTwinUpdater.js`: `updateHealthTwin(userId, pool)` runs aggregation queries and UPSERTs `health_twin` after every event insert. Non-fatal — ingestion never fails due to twin computation errors.
  - **Worker API routes**: `POST /health-events` (single event), `POST /health-events/sync` (batch up to 500), `GET /health-events` (paginated query), `GET /health-twin` (full twin row).
  - **AI prompt integration**: `health_twin` is always fetched alongside questionnaire data in `handlePostChat` and passed to intent-specific prompts (`chat/biomarker.js`, `chat/nutrition.js`, `chat/emotional.js`); `handlePostHealthAdvice` includes a full `DIGITAL TWIN` section in the system prompt with a "Lifestyle Connection" reasoning step.
  - **Miniapp health tab** (`components/user-health/`): Digital Twin section at the bottom of the health tab with a visual health dashboard:
    - **Health Score card** — 0–100 aggregate score with grade label (优秀/良好/一般/偏低) and per-domain breakdown bars (Recovery, Cardio, Activity, Body).
    - **Vital gauge rows** — each metric (Sleep, HRV, Resting HR, SpO₂, Daily Steps) rendered as a color-zoned track (red/orange/green/blue clinical ranges) with a floating dot marker at the user's current value, trend arrow, and optimal-range sublabel.
    - **Body composition bar** — horizontal segmented bar: lean mass (green gradient) and fat (orange gradient) with percentage legend.
    - **Source coverage chips** — shows which data streams have data and their last sync date.
  - **Scoring functions** (`user-health.js`): `_scoreSleep`, `_scoreHrv`, `_scoreRestHr`, `_scoreSpo2`, `_scoreSteps`, `_scoreBmi` map raw metric values to 0–100 health scores using clinically meaningful thresholds; domain scores are averaged into Recovery, Cardio, Activity, and Body composites.
  - **Demo seed script** `temp/seed-pin-digital-twin.js`: inserts 14 days of realistic data across all 5 categories for user Pin and calls `updateHealthTwin`.
  - **Architecture doc** `docs/architecture/digital-twin.md`.

- **Coach CRM system** — full production-grade CRM across DB, API, miniapp, and web admin panel.
  - **DB migrations** `src/schemas/migration_coach_crm_phase{1–5}.sql`: 12 new tables — `client_tags`, `client_tag_assignments`, `client_pipeline_stages`, `coach_client_notes`, `client_activity_log` (Phase 1); `message_templates`, `bulk_message_campaigns`, `bulk_message_recipients` (Phase 2); `appointments`, `client_goals` (Phase 3); `client_nps_surveys`, `coach_performance_snapshots` (Phase 4); `follow_up_rules` (Phase 5).
  - **Worker API** (`src/functions/worker/index.js`): 35+ new routes covering tags, pipeline stages, notes, activity log, message templates, bulk campaigns, appointments, client goals, NPS surveys, coach KPIs, and follow-up rules. `handleGetCoachUsers` extended to support `?stage=` and `?tag_id=` filters via LEFT JOINs. `refreshGoalProgress(userId)` called fire-and-forget after every Kino scan to auto-advance goal milestones. `logActivity()` helper writes to `client_activity_log` fire-and-forget throughout all handlers.
  - **Miniapp coach page** (`src/mini/nano-miniapp/pages/coach/`): two new tabs added — **CRM** (pipeline kanban by stage, upcoming appointments, cross-client activity feed, appointment booking modal) and **Performance** (KPI grid, top improvers leaderboard). Client cards now show stage pill and tag chips. Client detail sheet gains **Notes** tab (pinned-first list, compose, long-press actions) and **Goals** tab (progress bars, goal-type picker with target value/date). Message template picker added to chat compose area. 7 new tabs total.
  - **Web admin panel** (`src/web/admin-panel/src/App.jsx`): new **Coach CRM** nav item (using `Target` icon from lucide-react) renders `CoachCRMTab` with 4 sub-tabs — **Pipeline** (coach selector, Recharts stage-distribution BarChart, client table with stage badge + bio-age delta + tags), **Campaigns** (bulk campaign table with send action, create draft modal with stage filter), **Performance** (period picker, coach comparison table with all KPI columns), **NPS** (date-range filter, response table, aggregate promoter/passive/detractor cards + NPS score).

- **NL2SQL tool call in chat** — the worker's chat LLM can now query the user's health data dynamically when the pre-loaded context isn't enough. An agentic loop (max 4 iterations) offers the model a `query_database` tool; when called, the worker validates the SQL is a `SELECT` with `$1` for `user_id`, runs it against PolarDB, and feeds the rows back. Supports `biomarkers`, `nutrition_schedules`, `reminders`, and `chat_messages`. No new routes, no schema changes — change is entirely within `handlePostChat` in `src/functions/worker/index.js`.
- **Tag-driven biomarker estimator** — the `BiomarkerEstimator` now consumes a registry-defined tag set so its 6 estimated biomarkers respond to the user's actual nutrition compliance, weight trend, and prior-scan trajectory instead of just age + BMI. The estimator stays deterministic and synchronous — no LLM on the hot path.
  - **New** `src/functions/worker/lib/estimator/tagRegistry.js`: controlled vocabulary mapping each tag to one or more biomarker adjustments (`['*' | '+', n]`). Includes Chinese-tag aliases (`糖尿病` → `diabetes_diagnosed`).
  - **New** `src/functions/worker/lib/estimator/tagDerivation.js`: pure `deriveTags({ history, weightHistory, compliance, selfReported })` returning a deduped tag set. Rules: per-pathway compliance ≥ 0.7 / ≤ 0.3 → "low/high load" tag; ≥ ±2 kg over 90 d → weight tag; clear hsCRP slope across ≥ 3 prior scans → trajectory tag.
  - **Refactor** `BiomarkerEstimator.js`: tag adjustments via generic registry loop (deletes inline `糖尿病` branches). Constructor accepts `{ seed }`; noise switches to a seeded mulberry32 PRNG so the same `userId + scan-date` reproduces identical estimates across retries (required for trajectory tags not to chase their own noise). v3 noise model (Box-Muller, capped) is now adopted in the worker copy too — the worker was previously running a simpler uniform-noise version.
  - **Wired in** `handlePostBiomarkers` (`src/functions/worker/index.js`): new `fetchTagDerivationContext(user_id)` runs three queries — last 5 `kino_chip` rows, last 10 `body_composition` rows, and a 14-day `nutrition_schedules ⨝ dots` per-pathway compliance aggregate keyed by `dots.sub_age_target`. Derived tags + a deterministic seed (`user_id:YYYY-MM-DD`) are passed to the estimator and persisted into `biomarkers.data.tags`. Each derivation logs a JSON `biomarker_tags_derived` line for production audit.
  - **Tests** `tests/tagRegistry.test.js`, `tests/tagDerivation.test.js`, `tests/biomarkerEstimator.test.js`: 29 unit tests covering registry validity, threshold rules, weight-trend boundaries, slope detection, dedup, alias normalization, seed determinism (100-run identity), and tag-effect direction. Run with `node --test tests/*.test.js`.
- **Store item images** — each store item can now have a product picture uploaded from the admin panel.
  - **DB migration** `temp/migration_store_items_image.sql`: adds `image_url TEXT` column to `store_items`.
  - **Worker** `GET /api/store-items` returns `image_url`; `POST` and `PUT` accept and persist `image_url`.
  - **Admin panel** — Store → Items tab: new image column shows a 40×40 thumbnail (or a placeholder icon). Add/Edit item modal has an image upload zone: picks a PNG/JPG, gets a presigned OSS PUT URL (category `store`), uploads directly from the browser, and stores the 10-year presigned GET URL in `image_url`. Existing image is previewed with a remove button.
- **Kino chip models registry** — first slice of bringing the physical Kino One device onto the nano flow. Replaces the per-batch free-text `model` string with a real per-model record that carries the chip's declared biomarker outputs and full physical scan config.
  - **DB migration** `temp/migration_kino_chip_models.sql`: new `kino_chip_models` table (`code` PK, `name`, `biomarker_keys TEXT[]`, `config JSONB`, `guide_video`, `guide_text`, `status`, `notes`, timestamps). Seeds K2 (`biomarker_keys=['hsCRP']`) with the verbatim card_config currently used by kone (scan_ppmm=40, 4-region top_list with hsCRP on id0, piecewise var_list, cut_off1=-10, cut_off2=300, scope=0.2, etc., supabase row metadata stripped). Normalizes existing `kino_chip_batches.model` values to `'K2'` and adds the `kino_chip_batches_model_fkey` foreign key.
  - **Worker** `GET /api/kino-chip` (`handleGetKinoChip`) now joins through `scans → kino_chips → kino_chip_batches → kino_chip_models` and returns `model`, `biomarker_keys`, `chip_config`, `guide_video`, `guide_text` alongside the existing user-linkage fields. Also includes `birth_date`, `chrono_age` (computed via existing `calculateAge`), and `gender` so the device can render the patient header without a second round-trip. Joins are LEFT so legacy/unmodeled chips still resolve with the model-side fields nulled. The `chip_config` JSONB blob is byte-compatible with the supabase `card_config` shape kone already deserializes.
- **Academy tab** in the web admin panel with two subtabs and Aliyun OSS-backed file storage:
  - **Courses subtab**: upload and manage video courses — admin gets a presigned OSS PUT URL, uploads the video directly from the browser (with progress bar), and the course record (title, description, status, OSS key) is saved to `academy_courses`. Published/draft status toggle; videos can be viewed via a time-limited OSS GET URL. Edit and delete with automatic OSS object cleanup.
  - **Library subtab**: upload and manage Markdown documents — same direct-to-OSS upload pattern, saved to `academy_library`. Documents can be opened directly from the admin via signed URL.
  - **DB migration** `temp/migration_academy.sql`: new `academy_courses` table (id, title, description, oss_key, thumbnail_key, status, sort_order, timestamps) and `academy_library` table (id, title, oss_key, file_size, created_at).
  - **OSS library** `src/functions/worker/lib/oss.js`: wraps `ali-oss` — `generateKey`, `generatePresignedPutUrl`, `generatePresignedGetUrl`, `deleteObject`. Requires env vars `OSS_REGION`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_BUCKET`.
  - **Worker API routes**: `GET /oss/presign` (presigned PUT or GET URL), `GET /academy/courses`, `POST /academy/courses`, `PUT /academy/courses/:id`, `DELETE /academy/courses/:id`, `GET /academy/library`, `POST /academy/library`, `PUT /academy/library/:id`, `DELETE /academy/library/:id`.
- **Invitation system**: coaches and channel admins can generate shareable invite codes; new users must enter a valid code to register.
  - **DB migration** `migration_add_invitations.sql`: new `invitations` table (code, created_by, channel_id, type, max_uses, use_count, is_active, expires_at); new `invitation_uses` table for per-redemption attribution; `invited_by_invitation_id` FK added to `users`.
  - **Worker API**: `GET /api/invitations` (filterable by `channel_id` or `created_by`), `POST /api/invitations` (generates a random 6-char uppercase code), `DELETE /api/invitations/:id` (soft-deactivates); `POST /api/wx-login` updated — new users without an invite code receive `{ new_user: true }` instead of being auto-created; an invalid code returns `{ invalid_code: true }`; valid codes resolve the channel, optionally assign the creating coach, increment `use_count`, insert an `invitation_uses` row, and set `users.invited_by_invitation_id`.
  - **Mini-app login page** (`pages/login`): auto-login now shows an invite code input card for new users; user types the code and taps **加入 Nano**; invalid code shows inline error; users arriving via `?invite=CODE` deep-link bypass the input step entirely.
  - **Coach panel** (`pages/coach`): new **邀请码 / Invite Codes** tab alongside the existing Clients tab; coaches can generate their own codes (`type: 'coach'`), copy the mini-program path to clipboard, and deactivate codes; code fetched filtered by `created_by`.
  - **Channel admin panel** (`pages/admin`): new **邀请 / Invites** tab; channel admins generate codes scoped to their channel (`type: 'channel'`).
  - **Super admin panel** (`pages/superadmin`): new **邀请 / Invites** tab showing all platform codes with channel name and creator; **Generate Invite** button on each channel card; deactivate from list.
- **Dots tab moved to Super Admin**: removed from Channel Admin panel (`pages/admin`) and added to Super Admin panel (`pages/superadmin`) — channels should not modify the platform formula.
- **Kino Simulator passcode bypass for superadmin**: users with the `superadmin` role skip the passcode and open the simulator directly from the menu.

### Changed
- **User deletion blocked when extra roles are present**: attempting to delete a user who holds any role beyond `user` now shows an error in both the mini-app Channel Admin page and the web admin panel, requiring all elevated roles to be removed first.
- **Login screen**: new users no longer auto-register on first open — registration now requires a valid invite code.
- **Top app header banner** (`pages/main`): increased padding, logo size, and font sizes to better balance with the bottom tab bar.

### Fixed
- **Store item images returning 403 in production** — 7 store items had `image_url` values signed with a rotated OSS access key (`LTAI5t9hF93pvWC8BiDpMXiy`). Because OSS validates presigned URLs against the key that signed them, rotating the key immediately invalidates all URLs generated with the old key. Fix: `temp/fix-prod-store-image-urls.js` extracts the OSS object key from each stored URL, regenerates a 10-year presigned GET URL with the current credentials, and updates the prod DB row. **Operational note:** any time `OSS_ACCESS_KEY_ID` is rotated, all presigned GET URLs stored in the database (currently `store_items.image_url`, `channel_inventory.image_url`, `chat_messages.image_url`) will break and must be regenerated.
- **Kino Simulator — silent "Failed" status with working chips** (`src/mini/nano-miniapp/pages/main/main.js`): `bmLabels` and `subAgeLabels` were referenced in `_runKinoAnalysis` but never defined in either the `zh` or `en` translation objects. Every successful chip scan threw a TypeError when building the biomarker display list, which was silently caught and set `kinoSimStatus: 'failed'` with no toast. Added both objects to both language blocks.
- **Login — existing sessions forced through re-auth on every launch** (`src/mini/nano-miniapp/pages/login/login.js`): the login page always called `wxLogin()` on every app start, even when a valid user was already in `app.globalData`. If the server was temporarily unavailable (cold start, transient error), users with valid sessions were locked out. `onLoad` now short-circuits to `main` when a session is already present and no `invite`/`coach_id` deep-link params are present.
- **Role system**: users can hold multiple roles simultaneously (`user`, `coach`, `admin`, `superadmin`).
  - **DB migration** `migration_add_roles.sql`: `roles TEXT[]` on `users` (default `{user}`); `user_id` FK on `coaches` to link a WeChat identity; GIN index on roles; Pin and echo seeded as superadmins.
  - **Worker API**: `handleWxLogin` now returns `roles` on the user object and fetches the `coach` record when the user has the coach role; `handleGetUsers` includes `roles`; `handlePutUser` accepts `roles`; `handlePostCoaches`/`handlePutCoach` accept `user_id` and auto-manage the `coach` role; new scoped endpoints `GET /channel-users/:id`, `GET /channel-coaches/:id`, `GET /coach-users/:id`.
  - **Mini-app global state**: `app.globalData` now holds `coach` (set at login, persisted to `nano_coach`).
  - **Mini-app header menu** (`pages/main`): shows **Coach Panel**, **Channel Admin**, and **Super Admin** links conditionally based on `user.roles`.
  - **New `pages/coach/coach`**: coach dashboard — lists assigned clients with bio/chrono age chips, client detail overlay with latest biomarkers, send health instruction to any client.
  - **Rebuilt `pages/admin/admin`**: now role-gated on `onLoad` (redirects if user lacks `admin`/`superadmin` role); data scoped to the user's own channel via `/channel-users/:id` and `/channel-coaches/:id`.
  - **New `pages/superadmin/superadmin`**: platform-wide panel — Channels tab (full CRUD), Users tab (all users with channel + roles display, inline role-management modal), Coaches tab (all coaches with channel and linked-user display).
- **Multi-channel support**: distribution channels (e.g. Nanovate, Aeviva) with per-channel branding (name, logo). distribution channels (e.g. Nanovate, Aeviva) with per-channel branding (name, logo).
  - **DB migration** `migration_add_channels.sql`: new `channels` table; `channel_id` FK added to `coaches` and `users`; existing rows backfilled to `nanovate`.
  - **Worker API**: `GET/POST /channels`, `PUT/DELETE /channels/:id`; all user and coach CRUD endpoints accept `channel_id`; `GET /users` and `GET /coach-list` return `channel_name` and `channel_logo_url`; `POST /wx-login` accepts optional `coach_id` (from deep-link invite), resolves channel from coach, and returns `{ user, channel }`.
  - **Admin panel**: new **Channels** tab (CRUD); channel badge column in Users and Coaches tables; channel selector in Add/Edit modals for both users and coaches.
  - **Mini-app login**: reads `coach_id` from URL params (deep-link onboarding), passes to `wx-login`, stores returned `channel` in `globalData` and local storage.
  - **Mini-app header**: displays `channel.name | username` and `channel.logo_url` (falls back to Waven logo if not set).

### Changed
- **Waven Dots Payload Update**: each dot is now 40mg (previously 16mg).
  - **Database — `dots` table**: scaled all `mg` values in `ingredients` and `ingredients_zh` columns by 2.5x.
  - **AI Prompts**: updated `systemChat.js`, `systemNutrition.js` (worker), and `systemNutrition.js` (dispatcher) to reflect the new 40mg payload per dot.
- **"营养点" renamed to "原粒"** throughout nano-miniapp admin panel and web admin panel.
- **Admin panel coach label**: Chinese label updated to "教练".
- **Admin panel tab text**: inactive tabs use `#7A9ABF` at weight 500; active tab uses `#A0B4FF` at weight 700 for clearer visibility.
- **`prompts/systemNutrition.js`** rewritten: LLM now outputs only `DXX:N` count lines (not a full 7-day text block), with explicit biomarker reference ranges and a clear scoring guide; 7-day calendar is assembled in code from those counts.
- **`POST /api/formula-dots`** model bumped from `qwen-turbo` to `qwen-plus` for better instruction-following on the structured count output.
- Dot `ingredients` / `ingredients_zh` columns now included in `PUT /api/dots` and `POST /api/dots` upsert queries; stored as JSONB `[{name, mg}]` arrays.

### Fixed
- Chat scroll: switched from `scroll-into-view` to alternating `scroll-top` (999998/999999) via `wx.nextTick` so the view always lands at the last message.
- Admin dots edit modal: changed `max-height` → `height: 88vh` on the bottom sheet so flex children (including ingredient rows) can scroll correctly.
- Modal background scroll bleed: `catchtouchmove="noop"` added to both overlay and panel in admin.wxml.
- Ingredient display showing `[object Object]`: fixed `_ingrToArr` and save path in admin.js to correctly handle the `[{name, mg}]` array format.
- `handlePostFormulaDots`: `getNowShanghai()` returns a Luxon DateTime; changed `.toISOString()` → `.toISO()` (Luxon API) so the start date is correctly derived instead of throwing and silently returning the old plan.

---

## [Unreleased — pre-refactor]

### Added
- **Store — Mini App:** New Store tab (fourth tab) in the WeChat Mini Program. Products are fetched from `GET /api/store-items`. Tapping a product shows a confirmation modal; confirming posts an order to `POST /api/orders`. Bilingual display (zh/en); language-toggle re-maps labels from cached API data without a second request. Loading spinner and empty state included.
- **Store — Admin Panel:** New "Store" section in the admin panel sidebar (between Dots and Simulators), with two subtabs:
  - *Items:* full CRUD for store products — bilingual name/description/unit, CNY/USD pricing, tag (Best Seller / Value Pack), sort order, active toggle.
  - *Orders:* table of all orders with user, item, quantity, price, and an inline status selector (Pending → Confirmed → Shipped → Delivered → Cancelled).
  - Four stat cards: total items, active items, total orders, pending orders.
- **Backend — Store APIs** (worker):
  - `GET /api/store-items` — active items for the Mini App; pass `?all=true` to include inactive items (used by admin).
  - `POST /api/store-items`, `PUT /api/store-items/{id}`, `DELETE /api/store-items/{id}` — item CRUD.
  - `GET /api/orders` — all orders joined with user nickname and item names.
  - `POST /api/orders` — place an order; snapshots item price at time of purchase.
  - `PUT /api/orders/{id}` — update order status.
- **Database** (`src/schemas/migration_store.sql`): `store_items` and `orders` tables; seeded with three initial products (Kino chip ×1, Kino chip ×3, Waven Dots monthly).
- WeChat miniapp (`src/mini/user-miniapp`) — full clone of user-app with login, chat, health, and dots tabs.
- Health conditions onboarding step (miniapp): multi-select question 「您是否曾被诊断/体检出以下方面的问题？」with 9 options (血糖高, 血压高, 血脂高, 胆固醇高, 心脏问题, 痛风或尿酸高, 肾病, 睡眠不足, 其他). Runs after body composition; shown once and skipped on subsequent logins. Answers saved to `users.bio_data.health_conditions` (string array).
- `src/schemas/bio-data.schema.json` — JSON Schema documenting all known keys for `users.bio_data`.

### Changed
- `handleWxLogin` (worker) — returns `bio_data` in the user object so the miniapp can detect whether conditions have already been collected.
- `handlePutUser` (worker) — now accepts a `bio_data` field and merges it into the column using JSONB `||`, leaving unrelated keys untouched.

### Fixed
- Miniapp name input height: added `line-height`, `min-height`, `box-sizing` to `.ob-input` so text is fully visible.
- Miniapp height/weight sliders: added `bindchanging` so the displayed value updates in real time while dragging.
- Miniapp weight display: weight always shows one decimal place (e.g. `65.0`) to prevent digit-count jumping while sliding.

---

## [0.5.0] — 2026-04-20

### Added
- Dots / nutrition tab in user-app and miniapp: displays daily morning/evening supplement plan parsed from `/api/nutrition-plan`
- Chat context enriched with dots formulary and nutrition plan data

### Fixed
- Tab reload issue in user-app: all three tabs are now always mounted to preserve scroll and polling state
- `body_composition` record saving

---

## [0.4.0] — 2026-04-10

### Added
- Bio age and chrono age comparison chips on health tab hero section
- Sub-age grid (Resilience, Cellular, Metabolic, Micro-Vascular) on health tab

---

## [0.3.0] — 2026-04-05

### Added
- i18n: full English / Chinese toggle on login screen; language follows user profile setting
- Tabbed layout: Chat, Health, Dots bottom navigation

---

## [0.2.0] — 2026-03-20

### Added
- User app initial release (`src/web/user-app`): phone login, onboarding flow (name → gender → birthday → body), chat with AI polling

---

## How to update both platforms

When making a change, work through this checklist:

- [ ] `src/web/user-app/src/App.jsx` — React web app
- [ ] `src/mini/user-miniapp/pages/main/main.js` — miniapp logic
- [ ] `src/mini/user-miniapp/pages/main/main.wxml` — miniapp markup
- [ ] `src/mini/user-miniapp/pages/main/main.wxss` — miniapp styles
- [ ] `src/mini/user-miniapp/pages/login/login.js` — if login flow changes
- [ ] Add an entry to this file under `[Unreleased]`
