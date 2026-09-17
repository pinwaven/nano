# Proactive Messaging

Three mechanisms initiate a message to a user without them speaking first, with genuinely different maturity and persona-awareness. All three deliver via the same `notifications` table the frontend polls every 3 seconds — that channel itself doesn't distinguish who or what wrote the row.

## A) The legacy `agent` FC function — persona-agnostic, hardcodes "Nano"

**Files:** `src/functions/agent/index.js` + `src/functions/agent/prompts/proactive.js`.

`runCoachingSession(user_id, trigger_reason, extra, dry_run)` fetches a lightweight context (profile, BioAge, biomarkers, nutrition gap, last-10 chat messages) and does **one** LLM completion — no PLAN/JUDGE, `max_tokens: 200`, `temperature: 0.8` — through `proactivePromptTemplate`, whose very first line is hardcoded:

> "You are Nano, a warm and knowledgeable longevity health coach built by Waven."

There is **zero `persona_type`/`personaType` reference anywhere in either file.** It delivers via a `chat_messages` insert (role `'assistant'`, **no `persona_type` column passed** — defaults to `'nano'` at the DB level regardless of the user's actual persona) plus a `notifications` insert (`notification_type: 'coach_message'`).

### Triggers, from `dispatcher/index.js`

- **Scan 1 ("user_online")** — any user active in the last 2 minutes whose last chat message wasn't from the assistant, for both personas, except users already captured this tick by the check-in scan (below).
- **Scan 2 ("reminder")** — due reminders with `coach_id IS NULL`, for online users, for both personas.

### Important: this is not fully bypassed for Viva

CLAUDE.md §29 frames the daily check-in feature as routing "straight to `worker`... instead of the legacy `agent` function," which is true — but only describes the check-in feature's own routing choice, not a blanket statement that Viva users never reach the legacy agent. A Viva user who is active but *not* captured by the current period's check-in scan (already got today's check-in for this period; or is outside the 2-minute window when the check-in scan itself last ran) can still be picked up by Scan 1/2 above and receive a **"You are Nano"-branded** message. This is a real, still-live gap — not resolved by the check-in feature, and worth surfacing rather than repeating the "largely bypassed" framing uncritically.

### `nutrition.topup` — dispatched, but silently dropped

A third dispatcher scan (separate from Scan 1/2) fires for users whose scheduled nutrition days run under 7, dispatched to the `worker` function (`type: 'nutrition.topup'`) rather than to `agent`. `worker/index.js`'s CloudEvent router currently has cases only for `acs.lab`, `acs.chat`/`chat.generate`, and `acs.dispatcher`/`checkin.daily` — **no case for `acs.dispatcher`/`nutrition.topup`**. A successfully-published event matches no branch and is silently dropped with `{ ok: true }` returned. This is unrelated to persona, but is worth knowing if you're debugging why nutrition top-ups don't seem to fire.

## B) Daily check-ins — now both personas

**File:** `src/functions/worker/handlers/checkin.js`. Full design (three Shanghai-time periods, per-user first-app-open trigger via `last_active_at`, dedupe mechanics) is documented in CLAUDE.md §29 — this section covers what the current refactor changes on top of that.

1. **Persona-agnostic now.** The dispatcher's Scan 0 SQL dropped its `WHERE c.config->>'persona_type' = 'viva'` clause and now selects `COALESCE(c.config->>'persona_type', 'nano') AS persona_type` per eligible user, threaded through the `checkin.daily` CloudEvent payload. `handleDailyCheckinEvent` picks `nano/systemDailyCheckin.js` vs `viva/systemDailyCheckin.js` accordingly, defaulting to `'nano'` if unset.
2. **Dedup-race fix (2026-07-31, documented in CLAUDE.md §29, and cross-referenced in the sibling `gcn` repo's own `CLAUDE.md` Known Issues section)** — users could receive up to 3 duplicate check-ins per period because the dedupe guard was only written *after* a multi-second LLM call, leaving a window where several dispatcher ticks could all pass the "not yet sent" check before any of them finished. Fixed via `migration_checkin_dedup.sql` (a `notifications.checkin_date` column + partial unique index) and an atomic claim-before-work pattern: `INSERT ... ON CONFLICT (...) DO NOTHING RETURNING id` right at the top of `handleDailyCheckinEvent`, before any DB fan-out or LLM call. The claimed row starts as `status = 'claiming'` (not `'pending'`) specifically because the miniapp's 3-second poll surfaces and marks-sent any `'pending'` row immediately — an empty-content claim would otherwise flash a blank chat bubble and burn the slot before real content exists. It flips to `'pending'` with real content once the LLM call succeeds, or `'failed'` on error.
3. **Tone softening — three-way `most_elevated`, not always-pick-the-worst (2026-08-16).** Users reported the check-ins felt like a daily reminder of negative BioAge info. Root cause: `most_elevated` always took the single highest of the 4 sub-age dimensions with no magnitude check, so even a barely-elevated (or objectively fine) dimension got surfaced as "the thing to watch" every day, and the prompt handed the LLM a pre-built clinical string (`"细胞年龄：50.9岁（实际年龄45岁）"`) that all but guaranteed a bare deficit-framed number in the reply — echoed again in the evening touchpoint for "continuity." Fixed by computing `delta = sub_age - chrono_age` per dimension and gating on `MEANINGFUL_ELEVATION_YEARS = 2.0` (chosen relative to `BioAgeCalculator._scoreToSubAge`'s ~±10-12yr hard clamp on a dimension's deviation — comfortably above compression-curve noise near zero, well below the ceiling). `mostElevated` is now three-way: `{key, sub_age, chrono_age, delta}` when a dimension actually clears the threshold, `{status: 'all_tracking_well', chrono_age}` when nothing does (new — lets the prompt give a genuine positive check-in instead of manufacturing a concern), or `null` when there's no biomarker snapshot at all (unchanged). Both `handlers/checkin.js`'s `health_twin` query and both prompt templates were also wired to read `health_twin.trend_data` (`hrv_trend`/`sleep_trend`, already computed elsewhere by `healthTwinUpdater.js`'s `computeTrend()` but previously unused here) as a real, non-fabricated positive counterbalance — surfaced as the primary content of the all-tracking-well branch, or an optional pairing alongside a genuinely elevated dimension. Evening's "echo the elevated dimension" instruction is now conditional on one actually being elevated, rather than always finding something to reinforce. Applies to both personas identically (shared threshold logic in `checkin.js`; only prompt copy differs between `prompts/nano/systemDailyCheckin.js` and `prompts/viva/systemDailyCheckin.js`).

## C) Everything else that writes to `notifications`

- `chat_status` rows — progress captions during an async agentic wait (see [06-chat-pipeline.md](06-chat-pipeline.md)). Not really "proactive," but shares the same delivery channel.
- `coach_reminder` rows — flushed unconditionally from the `reminders` table, regardless of persona.
- `nutrition_plan` rows — from formula/dots generation, both the agentic and deterministic-fallback paths (see [08-formula-dots-and-reports.md](08-formula-dots-and-reports.md)).

## Summary: which mechanism owns which persona today

| Mechanism | Nano | Viva |
|---|---|---|
| Legacy `agent` (user_online / reminder scans) | ✅ this *is* the Nano voice | ⚠️ still reachable in check-in scan gaps — see caveat above |
| Daily check-ins | ✅ | ✅ |
| Chat replies (sync + async) | ✅ | ✅ |
| `nutrition.topup` | 🚫 dropped for everyone — router gap, not persona-specific | 🚫 same |

---

# Appendix: the `CLAUDE.md` §29 record (moved here verbatim 2026-09-15)

The project-rules entry as it stood before being condensed; the rules that must hold are now
summarised in `CLAUDE.md`. Kept because it records decisions and live findings in the words they
were made in.

## 29. Viva Proactive Daily Check-Ins (Morning / Midday / Evening)

Added 2026-07-29. Every previous Viva feature (§21-28) only responds when the user speaks first. This adds the reverse: Viva initiates, up to three times a day, checking in on today's dots and flagging one grounded thing to watch for. Delivery is **in-app only** — the message waits in `notifications` for the user's next app-open (identical to how reminders/coach messages already surface), not a true WeChat push (no subscribe-message/template-message send exists anywhere in this codebase; that would need a new WeChat-platform template plus opt-in UI — out of scope). Content generation is a **single lightweight completion**, not the full PLAN→GENERATE→JUDGE→REVISE agentic loop — appropriate for a routine message going out to every eligible user up to 3x/day. **Viva only.**

### Trigger model: each user's own first app-open within a period, not a fixed clock slot

Different users open the app at different times, so this fires on individual activity, not a global time. The signal already existed: the miniapp's `onShow()` (`pages/main/main.js`, fires on every app open/foreground) calls `POST /api/heartbeat` → `UPDATE users SET last_active_at = NOW()` (`handlePostHeartbeat`, `handlers/chat.js`) — the same recency signal the pre-existing `user_online` dispatcher scan already keys off (`last_active_at > NOW() - INTERVAL '2 minutes'`). The day is split into three non-overlapping Shanghai-time periods via a new `getCheckinPeriod(hour)` helper (`dispatcher/index.js`):

| Period | Shanghai hours | `notification_type` |
|---|---|---|
| morning | 05:00–10:59 | `morning_checkin` |
| midday | 11:00–16:59 | `midday_checkin` |
| evening | 17:00–23:59 | `evening_checkin` |
| (none) | 00:00–04:59 | — no check-in fires |

Each period is independently gated by "already sent today" (a `NOT EXISTS` against `notifications`, checked per period-specific `notification_type`) — this, not the period boundary, is what actually enforces "once per period per day," so a missed cron tick is harmless and there's no per-user schedule state to store. A user whose first open of the day happens to be at 8pm gets only the evening message, not a backdated morning+midday. `users.preferences->>'daily_checkin_enabled'` (the pre-existing, previously-unused `preferences JSONB` column) is an opt-out honored from day one even though no settings UI was built for it in v1.

### Dispatcher scan (`src/functions/dispatcher/index.js`)

New "Scan 0," run once per cron tick before the existing scans, gated on `getCheckinPeriod(getNowShanghai().hour)` returning non-null:

```sql
SELECT u.user_id
FROM users u
JOIN channels c ON c.id = u.channel_id
JOIN nutrition_plans np ON np.user_id = u.user_id AND np.status = 'active'
WHERE c.config->>'persona_type' = 'viva'
  AND 'user' = ANY(u.roles)
  AND COALESCE((u.preferences->>'daily_checkin_enabled')::boolean, true) = true
  AND u.last_active_at > NOW() - INTERVAL '2 minutes'
  AND EXISTS (SELECT 1 FROM nutrition_schedules s WHERE s.plan_id = np.id AND s.scheduled_date = CURRENT_DATE)
  AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.user_id AND n.notification_type = $1 /* e.g. 'morning_checkin' */ AND n.sent_at::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date)
```

The schedule-existence check is scoped to `s.plan_id = np.id` (the specific active plan), not just `user_id` + today's date — testing during this pass surfaced that a user can accumulate schedule rows sharing the same `scheduled_date` across multiple superseded/pending plans from repeated re-formulation, so an unscoped check could false-positive on stale rows. Matched users are dispatched via a new `dispatchToWorker()` helper (factored out of the existing inline `nutrition_topup` EventBridge-publish-with-HTTP-fallback block, now shared) as a CloudEvent (`source: 'acs.dispatcher'`, `type: 'checkin.daily'`, `data: { user_id, period }`) straight to the `worker` function — not to the legacy `agent` function (see below).

**Same-tick dedupe against `user_online`:** because this scan keys off the same `last_active_at` recency as the pre-existing `user_online` scan, a Viva user's first open within a period could otherwise double-fire — this check-in *and* the legacy proactive-coach nudge. `checkinUserIds` (the set of users dispatched by Scan 0 this tick) is checked and skipped inside the `user_online` scan's dispatch loop.

### Why this bypasses the legacy `agent` FC function entirely

`src/functions/agent/index.js` + its `proactive.js` prompt (used today for `user_online`/`reminder` triggers) is **entirely persona-agnostic and hardcodes "You are Nano"** in its system prompt — it predates the nano/viva persona split built in `worker/`. Reusing it as-is would ship a Viva user a Nano-branded message. Instead, this feature routes straight to `worker` (which already owns every Viva prompt, `getEssentialBlock`, `saveChatMessage`, persona-aware everything) via the identical EventBridge dispatch pattern `dispatcher` already uses to reach `worker` for `nutrition.topup`.

**Pre-existing gap noticed in passing, not fixed here:** `worker/index.js`'s EventBridge CloudEvent routing block had cases only for `acs.lab`/`biomarker.lab_complete` and `acs.chat`/`chat.generate` — no case for `acs.dispatcher`/`nutrition.topup`. Since the trigger's source filter already allows `acs.dispatcher` through, a `nutrition.topup` CloudEvent that reaches `worker` via a successful EventBridge publish matches no branch and is silently dropped (`{ok:true}` returned, nothing done) — only the rarer HTTP-fallback path (used when EventBridge itself throws) would have any chance of being handled, and even that fallback POSTs a bare payload with no `rawPath`, so it likely doesn't route correctly either. This feature's own `checkin.daily` gets an explicit, correct case (see below) so it doesn't inherit the same silent-drop bug, but the `nutrition_topup` gap itself is untouched — worth a dedicated follow-up.

### Worker routing (`src/functions/worker/index.js`)

New branch alongside the existing two:
```js
} else if (event.source === 'acs.dispatcher' && event.type === 'checkin.daily') {
    try { await handleDailyCheckinEvent(cloudData); }
    catch (err) { console.error(JSON.stringify({ level: 'ERROR', msg: 'handleDailyCheckinEvent failed', error: err.message })); }
}
```

### New handler (`src/functions/worker/handlers/checkin.js`)

`handleDailyCheckinEvent({ user_id, period })` fetches (single-purpose queries, no agentic tool loop): user profile, today's `nutrition_schedules` for the user's **active** plan specifically (flattened via the `dots` table into real names, `recipe.dots` keyed by `key_name` e.g. `DOT01`), the latest biomarker snapshot's `bioage_profile.SubAges` (never `data.actual`, per §17), active health plans, `getEssentialBlock('viva')`, and the current solar term. The single most-elevated sub-age dimension is picked **deterministically in code** (highest sub-age value, not left for the LLM to compare) — consistent with this codebase's general principle of not trusting an LLM with arithmetic it doesn't need to do. One `qwen-plus` completion via a new prompt, `prompts/viva/systemDailyCheckin.js` (one shared template parameterized by `period`, not three near-duplicate files — fetched context and output-format rules are identical across periods, only framing/emphasis differs: morning asks about today's dots + names one thing to watch for; midday is a light, no-new-data progress check; evening asks about evening dots and echoes — not repeats — morning's grounded data point for day-to-day continuity). No action-JSON parsing (one-way message, not a user action) and no grounding/JUDGE pass, consistent with the "lightweight" scope decision. Saved via the existing `saveChatMessage(user_id, 'ai', message, null, 'viva')` and a `notifications` insert (`notification_type: '${period}_checkin'`). On any failure, logs and returns without throwing further — the next period (or tomorrow) naturally retries via the dispatcher's own idempotency check.

**No frontend changes** — surfaces exactly like existing proactive coach/reminder messages, a `chat_messages` row + `notifications` insert shown as a normal AI bubble on the miniapp's next 3s poll. The user's eventual reply flows through the normal `/chat` → `handlePostChat` path like any other message.

**RESOLVED 2026-07-31 — users could receive up to 3 duplicate check-in messages per period instead of 1.** Root cause: the dispatcher's per-tick eligibility query (`NOT EXISTS` against `notifications`) was only ever satisfied by the `notifications` INSERT at the *end* of `handleDailyCheckinEvent`, after two DB round trips and a full LLM completion — a multi-second window during which the dedup guard didn't exist yet. A real user re-foregrounding the app a few times in a row (each `onShow()` → `/api/heartbeat` re-extends the 2-minute `last_active_at` eligibility window) let 2-3 dispatcher ticks all pass the `NOT EXISTS` check and each independently generate + save their own message before the first one's insert landed; `notifications` also had no unique constraint to catch it at the DB level. Fixed by claiming the `(user_id, notification_type, day)` slot **atomically before any slow work starts**: `migration_checkin_dedup.sql` adds `notifications.checkin_date` plus a partial unique index on `(user_id, notification_type, checkin_date) WHERE checkin_date IS NOT NULL`; `handleDailyCheckinEvent` now opens with an `INSERT ... ON CONFLICT (...) WHERE checkin_date IS NOT NULL DO NOTHING RETURNING id` and returns immediately if it loses the race, before touching the DB fan-out or the LLM. The claim row starts `status='claiming'` rather than `'pending'` — the miniapp's 3s `/api/notifications` poll surfaces and marks-sent any `'pending'` row immediately, so an empty-content claim would otherwise flash a blank bubble and burn the slot; the row only flips to `'pending'` (with real content) once the LLM completion succeeds, or to `'failed'` on error. Verified via a direct concurrent-insert test against dev (3 simultaneous claims for the same user/period/day → exactly 1 winner) before shipping to prod.

### Files

New: `src/functions/worker/prompts/viva/systemDailyCheckin.js`, `src/functions/worker/handlers/checkin.js`. Modified: `src/functions/dispatcher/index.js` (`getCheckinPeriod()`, `dispatchToWorker()` helper, Scan 0, `user_online` same-tick dedupe), `src/functions/worker/index.js` (new EventBridge case + `handlers/checkin` require).

