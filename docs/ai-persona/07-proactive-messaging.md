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
