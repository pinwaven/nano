# Regression findings — Nano + GCN, 2026-09-15

Full-build regression pass across `/Users/pin/waven/nano` (branch `work`) and the sibling
`/Users/pin/waven/gcn`. Method and IDs: [regression-plan-2026-09.md](regression-plan-2026-09.md).
Dev was exercised read/write; prod was read-only (SQL sweeps + `s <fn> info` only). No deploys, no
commits, no prod writes.

## Baseline

| | Before | After hygiene |
|---|---|---|
| nano `npm test` | 659 pass / 11 fail (all stale/env, not code) | **689 pass / 0 fail** |
| GCN `npm test` | 296 / 0 | 296 / 0 |
| nano migrations | dev 195/0 pending, prod 195/0 | — |
| GCN migrations | dev 113/0, **prod 112 / 1 pending** (`0113_waven_sector`, dev-only by design) | — |

**Deployed vs source (T6.5).** dev worker = HEAD + the uncommitted WIP; prod worker (2026-09-14
09:47) = commit `648ce1e`, **without** the meal-plan guard or the sub-age humanizer. **dev kino
(08-16) is behind prod kino (08-18)** — dev lacks `b97c8bd` "bioage capping" (the weekly-swing cap
and estimator changes), so the Kino scan path differs between environments. agent/lab/dispatcher
match source.

## Severity legend
HIGH = user-facing breakage or security exposure now · MEDIUM = wrong behaviour in a real flow or a
data/ops problem · LOW = cosmetic / defensive · INFO = observation, no action required.

---

## Fixed in this pass (test hygiene + WIP defects I own)

| ID | What | Where |
|---|---|---|
| F0.1 | Kino admin test read `App.jsx`; `KinoModal` moved to `tabs/KinoTab.jsx` when the panel was split. | `tests/admin-panel-kino-device-registration.test.js` |
| F0.2 | `app.wxss` `.fs-3 --fs-11` was `16rpx`; the documented curve says `17` (typo from `8a27003`). | `src/mini/nano-miniapp/app.wxss` |
| F0.3 | `.code-chip` (22rpx) and `.code-wx-addr` (24rpx) shipped as literal font-sizes on 2026-09-01, so the redeem-code chip did not scale with the text-size control. Tokenised. | `pages/main/main.wxss` |
| F0.4 | Text-scale test asserted the pre-`8a27003` chat-only `onChatTouchMove`; it is now `onTabTouchMove` on all four tabs, and the conversion is page-wide. Rewrote the two asserts. | `tests/text-scale-accessibility.test.js` |
| F0.5 | `worker-endpoints.test.js` is a pre-bearer live-HTTP smoke (`/ingest`, Glucose→`/chat`) that fails against any deployed worker and would create a real user; gated behind `RUN_ENDPOINT_TESTS=1`. `.env`'s `NANO_API_TARGET` still points at the dead `nano-dev.fros.cc`. | test + `.env` note |
| F0.6 | `npm test` wired in both repos; CLAUDE.md §5/§7 dead refs (`tests/mocks/`, `test:local`, `local-bus.js`) corrected. | `package.json` ×2, `CLAUDE.md` |
| F0.7 | `t.guestLockMsg` referenced in `main.wxml:699` since 2026-05-03 but never defined → guests saw a 🔒 card with empty text on Plans ▸ Plans. Added zh/en. | `pages/main/main.js` |
| F0.8 | `VERSION` was `0913-1` while commit `6557b78` (09-14) changed `main.js` without bumping it. Bumped to `0915-1`. | `utils/config.js` |
| **F2.2** | **WIP double-label bug: `humanizeSubAgeKeys` turned the model's gloss 「细胞年龄（CellularAge）」 into 「细胞年龄（细胞年龄）」 (reproduced 4× in one dev reply). Added a self-gloss collapse.** | `lib/subAgeLabels.js` |
| — | New coverage: `tests/sub-age-labels.test.js` (11) and `tests/static-invariants.test.js` (5: pool caps §32, `AI_ECHO_TYPES` ⊇ every dual-write type, `VIVA_AG_ALLOWED_PATHS` ⇄ openapi, the two essential-block fallbacks byte-identical, i18n keys resolve in both languages). | new |

---

## Open findings

### HIGH

**F1.1 — the entire `/phone-otp/` prefix is unauthenticated and unowned (prod + dev).**
`index.js:299` exempts every `/phone-otp/*` path from the bearer gate, and no handler checks the
caller owns the `user_id` it is handed.
- `GET /api/phone-otp/list?user_id=<8-hex>` with **no token** returns a user's full phone numbers
  (confirmed on dev against a real id; prod returns 200 for a bogus id, so the exemption is live
  there too). `user_id` is an 8-hex value — enumerable.
- `POST /phone-otp/bind {user_id, phone, code}` — `verifyOTP` proves possession of the **new**
  phone, then binds it to any `user_id`; login (`handlePhoneOtpVerify`) matches through
  `user_phones`, so this is an **account-takeover** path. `accept-unverified` writes `users.phone`
  with no OTP at all. `remove`/`set-primary` mutate any account's phones with no proof.
- Direction: keep only `send`/`verify` (login) exempt; put `list`/`bind`/`set-primary`/`remove`/
  `accept-unverified` behind the bearer and resolve `user_id` from the session (miniapp openid→user
  server-side), not the request body. Introduced `e569e66`, 2026-07-20.

**F7.1 — document extraction has never run on prod.** `doc_extraction_jobs` on prod: 14 rows, all
`queued`, `attempts=0`, never claimed; **0 completed ever**. Dev: 3 completed by
`curia-docextract-1` on 09-09, then nothing since 09-11. Any user who uploads a 健康文档 sees it sit
unextracted forever. Check `DOC_EXTRACT_API_TOKEN_PROD` on the Curia side and that the agent polls
prod, not just dev. (Feature shipped 2026-09-10.)

### MEDIUM

**F2.1 — internal tool name leaked into a reply.** 「已确认你当前没有原粒方案（`get_nutrition_schedule`
返回空）」. Nothing stripped `get_*` the way dot codes / sub-age keys are stripped.
*Being addressed concurrently by you* — `lib/toolNameScrub.js` appeared on the working tree during
this pass and does exactly this; make sure it's wired at every delivery point (`humanizeDotCodes`/
`humanizeSubAgeKeys` sites) and add a test.

**F3.2 — the sub-age humanizer is defeated by data on the live aeviva channel.**
`channels.config.sub_age_display_names` on `aeviva-china` (dev **and** prod) sets `en` to the raw
key for all four dimensions (`"CellularAge"`, …). `subAgeLabel()` prefers the override, so for an
en-language user `describeBioAge()` labels dimensions with raw keys and `humanizeSubAgeKeys()` is a
no-op. Fix the rows (admin ChannelSubAgeLabelsModal), and make `subAgeLabel` ignore an override
whose value equals the key so bad data can't re-defeat the WIP fix.

**F7.2 — unbounded, undelivered notification backlog.** `notifications` pending >1 day:
3480 prod / 3578 dev, almost all `coach_reminder` (3411 prod across 64 users; top user 259 rows
since 2026-05-08). The dispatcher's reminder flush inserts one per due daily reminder regardless of
whether the user is active, and `handleGetNotifications` (`users.js:423`) is an unbounded
`UPDATE … RETURNING` with no age cutoff — a returning user gets every stacked reminder as bubbles
in one poll, and the table grows without bound. Add an age cutoff / cap, and stop flushing
reminders for long-inactive users.

**F2.5 — JUDGE does not catch package-content or population-specific claims.** A store-recommendation
reply asserted 「臻选套装与尊享套装均包含3号与6号原粒」 (package contents — but packages are
personalised per user) and 「已通过人体临床证据验证其对东方人群的适用性」 (population-specific
efficacy). Both are the class §37 warns about (JUDGE checks facts, not relevance), one level up.

### LOW / INFO

- **F1.2 (→ INFO)** `GET /formulation-label?c=<unknown>` returns JSON `reason:"not_found"`, but GCN's
  `formulation-label.html` renders the correct 「已失效…已被新配方替代」 wording (T3.5 ✓). Non-issue.
- **F1.3** `/phone-otp/list` with no `user_id` → HTTP 200 `success:false` (should be 400).
- **F1.4** unknown POST path falls through to `handlePostChat` → HTTP 500 `openid is required` with a
  `debug` object. Should be a 404; pollutes error logs.
- **F1.5** CLAUDE.md §31 says `/health-plan-templates` was added to nano's `GCN_ALLOWED_PATHS`; it
  was **not** (403 with the GCN token). GCN never calls it. Fix the doc, or drop the line.
- **F2.3** zh replies mix English status words ("hsCRP elevated（1.16 mg/L）").
- **F2.4** a formulation narrative said 「CD38升高（1.4，超过1.3的临界值）」; CLAUDE.md §11 says CD38
  baseline ~1.0. Confirm the prompt defines a 1.3 threshold, else it's fabricated.
- **F3.3** the `/exchange-webview-token` response ships `bio_data`, `bio_age`, `email`,
  `merged_into_user_id` to GCN — more than GCN reads; `channel.logo_url` is a presigned OSS URL that
  expires in 2094 (effectively permanent).
- **F3.4** (known nano gap, confirmed) nano's `fetchFormulationCodes` never passes `sector_id`, and
  Pin's unactivated 轻享 code is in the `waven` sector → `codes:[]`; the card can't offer 开始配制 for
  it. Same root as the `GCN_LINKED_CHANNEL_KEYS` hardcode GCN's CLAUDE.md lists as pending nano work.
- **F7.4** `knowledge_entries.fact-constraint-core` (viva; the only essential row — **no nano row on
  dev or prod**) differs from `FALLBACK_ESSENTIAL_BLOCK` in 2 lines (DB says "Aeviva 客服" and
  "原粒（如"12号原粒"）"; code says "客服" and "Dots"). Looks like a deliberate brand-neutral fallback,
  but §26/§37's "change all three together" is not literally true — document the intended divergence.
- **F7.5** 1 `kino_chip` biomarkers row (dev and prod each) has no `data.validated` and still carries
  `data.estimated` — a straggler from the 2026-06-23 rename.
- **F7.6** 1 user (dev and prod each) with `users.phone` set but no matching primary `user_phones` row.
- **F8.1 (known, §35)** `GET /oss/presign?action=get&key=<another user's health-documents key>` with
  the app token returns a signed URL — no per-object authorization. Mitigated only by key
  unguessability + keys never returned to clients. Pre-existing; do not widen.
- **INFO** `product_ai_profiles` is empty on dev and prod → the §37 store-recommendation `:::product`
  card can never render today; the feature is dormant. GCN has no unit test for
  `handleNanoAiCatalog`'s exclusion list (coverage gap).
- **INFO** 0 `active` nutrition_plans and 0 `%_checkin` notifications in 14 days on both envs → the
  daily check-in feature (§29) is exercised by no one in prod; nobody had scanned a box until this
  pass (T3.3 created the first).
- **INFO** `pg_stat_activity`: `nano_admin` = 3 (nano_db) / 12–13 (nano_db_dev, incl. this session),
  well under the §32 incident's 227.
- **INFO** `s worker logs` returns only FC Invoke Start/End lines on dev (warns "local logConfig
  differs from remote") — application JSON logs aren't retrievable that way; check the SLS logstore.

---

## What passed cleanly

- **T1** auth/route matrix: branch order correct (none/junk/`ch.`→401, cross-service & off-allowlist
  tokens→403, own ping→200); all 17 nano `GCN_ALLOWED_PATHS` reachable with the GCN token; GCN's 11
  `requireNanoService` routes 401/403 without the service token and 200/400 with it.
- **T2** chat: meal-plan guard (the 09-14 prod incident) routes 「订制…营养餐」 to a meal answer with no
  `launch_tool`; 「我要定制营养素」→ `launch_tool:formula_dots` in 1.1s; package / food-sensitivity
  tools force-queued correctly; history grounding cites real dates/values un-rewritten; the sub-age
  humanizer strips raw keys in prose while leaving `:::` fences byte-identical.
- **T2.6/T3.2/T3.3** the full Dots journey on dev, end to end: no-BioAge → refusal + 0 plan rows;
  BioAge → one `'proposed'` plan, a three-`#tier` card (`#order|buy`, no `#label`, `#plan` digits,
  no dot counts in prose, N7 isolation days, capsules balanced); against a paid order → `#order|submit`
  → `/formulation-submit` → GCN `compounding` with `nano_label_code`, idempotent on resubmit; box
  scan → plan `active`, 56 schedules / 28 days, `start_date`=today, non-transferable, idempotent,
  `box_not_found` for an unknown code.
- **T3.1** SSO: single-use 60s webview token → GCN `sso/nano` 200, context echoed verbatim, resolves
  the existing GCN account, exchange returns `coach_user_id`/phones/`phone_verified`.
- **T3.5** public label JSON carries no identity fields for active/superseded/unknown codes.
- **T3.7** waven-sector isolation: aeviva-dev pages still carry Aeviva literals as the static
  fallback; waven-dev overlays only `sector-config.js` + `index.html`; per-sector `sector-config`.
- **T4** miniapp (live DevTools): `VERSION` `0915-1` running; sync reply renders once (no duplicate)
  and the `chat_messages` replay backstops a lost notification poll; Dots subtab reflects the live
  package/plan state; the health tab's twin shows 4/4 layers, the food-sensitivity keys, and the
  health-documents component (upload enabled in self mode, extraction status surfaced).
- **T5.1** web admin panel builds clean; every list endpoint returns through the proxy (the four
  400s are missing required channel_id/coach_id params the real UI supplies).
- **T8** coach cannot read/write another coach's client's documents (403); foreign-plan submit →
  `plan_owner_mismatch`; AG questionnaire security fields stripped; report links neutralised before
  `mdToHtml`.

## Dev fixtures created (for cleanup)

- nano: `nutrition_plans` 38871 (test_jer `d4a5b2c6`, proposed), 38872 (Pin `37c8774e`, now **active**
  with 56 schedules), `box_batches` id 1 / box `WVB296810B2103C`; chat/notification rows for
  `d4a5b2c6`, `41e55ea2`, `37c8774e`. **Pin will now receive daily check-ins on dev.**
- GCN: order `07e22f6e-…` moved from `awaiting_formulation` to **`compounding`** (fast-track submit).
