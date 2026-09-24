# Waven Nano — TODO

## Security

- [ ] **Read-only DB user for worker/agent in production** — the NL2SQL `query_database` tool call in `handlePostChat` executes LLM-generated SQL against PolarDB. The application DB user should be granted `SELECT`-only on user-facing tables so a prompt injection or LLM error can't mutate data. Create a read-only PolarDB account, grant `SELECT` on `biomarkers`, `nutrition_schedules`, `reminders`, `chat_messages`, `dots`, `questionnaire_*`, and set it as `DB_USER` / `DB_PASS` for the worker and agent functions. The dispatcher and worker mutation paths (INSERT/UPDATE) should use a separate write-capable account.

- [ ] **Client auth & unauthenticated takeover paths** — see the detailed section at the end of this file. Two prefix-exempt endpoints (`/qr-login/confirm`, `/phone-otp/bind`) allow account takeover with no credential; the miniapp also ships the superadmin bearer token.

## Coach Academy _(not yet implemented)_

Mandatory continuing education system for coaches, with a paid course model and title progression.

**Background:** Coaches provide health advice that complements AI; their competency and ongoing training is critical to service quality. Coaches pay for courses — this is also a revenue stream.

### Title Ladder (aligned with the 4 sub-age dimensions)

| Title | Requirement | Unlocks |
|---|---|---|
| Nano Associate | Foundation course, 0 specializations | Basic coaching tools |
| Nano Practitioner | 1 sub-age specialization + assessment | Featured in that specialty |
| Nano Specialist | 2–3 specializations + assessment | Priority user matching |
| Nano Expert | All 4 + practical review | Can mentor other coaches |
| Nano Fellow | Expert + 2 years active + peer review | Co-create courses, top referral tier |

### Specialization Tracks (maps to existing sub-age dimensions)
- Cellular Health
- Metabolic Health
- Micro-Vascular Health
- Resilience & Stress

### Payment Model
- Hybrid: Foundation course is required and paid; specialization tracks are à la carte after that.
- Reuse existing store/payment system.

### Reference Models
- **IFM** — tiered certs, mandatory CECs, annual recertification (most relevant)
- **NASM** — specialization tracks + continuing education credits
- **ACE** — multiple specialty certs simultaneously, each with own renewal clock
- **Harvard Extension** — pay-per-course, stackable certificates
- **Coursera** — peer-graded case study assessments (fits biomarker interpretation)

### Open Questions
1. Who creates/maintains course content — internal team or third-party instructors?
2. Live/physical component (workshops, webinars) or fully async?
3. Should a coach's title be visible to users in the mini-program?
4. What happens to a lapsed coach — lose system capabilities, or just the title?
5. Should channel admins see the academy status of their coaches?

### Existing Assets
- Online video courses already exist — need to be integrated into the academy structure.

---

## Security: Client Auth & Unauthenticated Takeover Paths _(found 2026-09-04; phases 1+3 on dev 2026-09-23)_

Audit triggered by the question "does the miniapp ship the superadmin bearer token?" It does — and
tracing it surfaced two account-takeover paths that need **no credential at all** and therefore
outrank it. Every item below was confirmed by reading the code, not inferred. **No code has been
changed** as of the audit. Phase 1 (below) shipped to dev on 2026-09-23 — see `CHANGELOG.md`;
prod still runs the audited code until `migrate:prod` + worker/kino/admin prod deploys.

Treat `tokenData-gh9bc7917115bid72c68c8c4693g` as permanently public: it is in git history from
`7c75c2c` (also `a3ae2ba`, `8f7eb76`, `2cd9995`) and in the git-tracked
`.claude/settings.local.json:10`.

### Priority 0 — exploitable with no credential

The auth gate at `worker/index.js:279` exempts `/qr-login/` and `/phone-otp/` **by prefix**, which
exempts far more than the two login endpoints that needed it.

- [~] **`POST /qr-login/confirm` — account takeover + full PII dump.** _2026-09-23: `status`
  now returns named columns in the OTP-login shape and is single-use (`consumed`). `confirm`
  itself stays public — the released miniapp's `pages/qrlogin` sends no Authorization header
  at all — until the miniapp sends a per-user session (phase 3)._ `handlePostQrLoginConfirm`
  (`handlers/login.js:979`) takes `{session_id, openid}` straight from the body with no ownership
  proof. `handleGetQrLoginStatus` (`handlers/login.js:951`) then returns `SELECT u.*` — the entire
  users row (`external_id`, phone, `bio_data`, roles). Chain: `init` → `confirm` with a victim's
  `user_id` → `status` = a logged-in web session as that user. `user_id` is only 4 random bytes
  (`lib/auth.js:4`) and is handed out by list endpoints. Fix: move `confirm` behind the gate,
  verify `openid` against the authenticated caller, and project the columns `status` returns.
- [~] **`POST /phone-otp/bind` — account takeover.** _2026-09-23: exact-path public set; bind /
  remove / set-primary / list / accept-unverified (and the email twins) now need a credential —
  but the shipped app bearer is still one, so this closes the no-credential path only; the
  ownership check is phase 3._ `handlers/phone-otp.js:169` takes `user_id`
  from the body, unauthenticated. OTP your own number, bind it to a victim's `user_id`, then log in
  as them via `/phone-otp/verify` (which matches through `user_phones`). The conflict branch
  (`:181-215`) calls `mergeUsers`, so it also works when the number is already owned. Siblings
  `remove` / `set-primary` / `list` / `accept-unverified` are unauthenticated too —
  `accept-unverified` writes `users.phone` with no OTP at all.
- [x] **`SUPER_OTP_ENABLED: "true"` in `s-prod.yaml:120`** _2026-09-23: code is now the
  `SUPER_OTP_CODE` env secret (new value in `.env`); decided to keep it enabled in prod._ with the code hardcoded in source as
  `761111` (`handlers/phone-otp.js:22`) — a login-as-any-phone backdoor live in production. It is a
  deliberate admin-impersonation feature, but the code must not be a source literal.
- [x] **No rate limiting on `POST /phone-otp/send`** _2026-09-23: `phone_otp_send_log`, 60 s /
  5 per hour per phone, 30 per hour per FC `sourceIp`._ — unauthenticated, costs money per call.
  `migration_phone_otp_codes_drop_attempts.sql` removed the only counter. Containers are stateless,
  so this has to be DB-backed.

### Priority 1 — the shipped superadmin token

- [~] **`src/mini/nano-miniapp/app.js:9`** hardcodes the token, _2026-09-23 (dev): per-user
  sessions replace it in the miniapp and user-app (`docs/architecture/api-auth.md`); the value stays
  accepted, logged, until `LEGACY_APP_BEARER=reject` — then rotate it._ byte-identical to `.env`'s
  `API_BEARER_TOKEN`. `worker/index.js:282` maps it to `role:'superadmin'`, `channelId:null`, with
  **no path restriction** — ~400 routes. `requirePermission`/`requireAdminTab`
  (`lib/auth.js:111-122`) both short-circuit on superadmin, so every admin gate is a no-op for it.
  Same value ships in `src/web/user-app/src/main.jsx:7-11` (`VITE_API_TOKEN`, inlined at build) and
  is the no-session fallback in `src/web/admin-panel/src/App.jsx:43-47`.
- [x] **The token is also the `ch.` HMAC key** _2026-09-23: `TOKEN_SIGNING_SECRET`
  (`_PROD` for prod); no dual-accept — channel admins log in again once._ (`lib/auth.js:34,43`) — anyone holding it can forge
  channel-admin tokens for any `cid`, any perms, any expiry. Needs a separate signing secret.
- [x] **`/admin/login` returns the raw bearer** _2026-09-23: returns an `sa.` session; the kino
  function accepts it; the admin panel's `VITE_API_TOKEN` fallback is gone from the bundle._ for superadmins
  (`handlers/admin-accounts.js:306`) instead of a signed, expiring session token.
- [x] **The gate fails open** _2026-09-23: `adminCtx` starts `anonymous`; no credential → 401._ — `worker/index.js:277` initialises `adminCtx` to `role:'superadmin'`
  and skips the entire check when `API_BEARER_TOKEN` is unset.
- [ ] **Rotation is a 6-surface change, not a one-liner.** `API_BEARER_TOKEN` is also read by
  `src/functions/kino/index.js:47`, `src/functions/media/index.js:36` and `handlers/academy.js:18`
  (worker→media self-call). Rotating naively breaks the admin panel's Hardware tab and certificate
  generation, and logs out every channel admin. Decouple those first, rotate last.

### Priority 2 — structural

- [x] **User identity is entirely self-asserted.** _2026-09-23 (dev): `lib/userAccess.js` checks
  every named user against the session (self / coaching client / same-channel admin) on an allowlist
  of the client routes. Still true for legacy-bearer requests until the cut-off._ Handlers read `openid` from the query string or
  body with no ownership check (`resolveOrUpsertUser` `handlers/chat.js:195`,
  `handleGetMyCartridges` `handlers/dots.js:72`, and ~40 more). Anyone with the shipped token can
  read or write any user's chat, biomarkers, health documents and phones.
- [~] **`GET /oss/presign` performs zero authorization** _2026-09-23: a user session may only sign
  `academy/` keys; the admin panel and legacy bearer still sign anything._ (`handlers/chat.js:3024-3039`) —
  `action=get&key=…` signs a URL for *any* object in the bucket, and the PUT branch mints a 10-year
  GET URL. Already documented as a known hole in `handlers/health_documents.js:9-22`, which routes
  around it rather than fixing it.
- [ ] **Permanent OSS capabilities shipped in the client** — `utils/config.js:30` and
  `utils/avatar-gallery.js` embed presigned URLs with `Expires` in 2036. Replace with
  CNAME-fronted public-read paths (`OSS_CNAME_DOMAIN` is already configured) or runtime presigns.

### Fix direction _(sketched, not decided)_

Three phases, ordered so the first needs **no client release** and breaks nothing:

1. **Contain (worker-only deploy).** Replace the two prefix exemptions at `worker/index.js:279`
   with an exact-path public set; fail closed instead of defaulting to superadmin; re-key the `ch.`
   HMAC off a new `TOKEN_SIGNING_SECRET` (dual-accept the old one for 24h — `ch.` tokens are
   `iat+86400`, so the window self-closes with no forced logouts); make `/admin/login` issue a
   signed superadmin token. All three clients already send the bearer on the newly-gated paths, so
   nothing breaks.
2. **De-privilege the shipped token.** A separate `APP_BEARER_TOKEN` mapping to a non-superadmin
   role with a method-aware, anchored route allowlist — following the existing `GCN_ALLOWED_PATHS` /
   `VIVA_AG_ALLOWED_PATHS` precedent in the same gate, but with `role:'app'` so
   `requirePermission` default-denies. Then rotate `API_BEARER_TOKEN`.
3. **Per-user identity.** Issue a signed `u.` session token at every login path (`handleWxLogin`,
   `handleWxAppLogin`, `handlePhoneOtpVerify`, QR login, webview-token exchange), and add **one**
   choke point in `worker/index.js` that overrides `query.openid`/`body.openid` with the token
   subject — fixing every self-scoped handler without touching them. Keying the override on token
   *type* rather than path means the GCN service token and the web admin panel need no exceptions;
   only the miniapp coach panel (which legitimately passes a client's id) needs explicit rules.

### Found 2026-09-23 while doing phase 3 (fixed on dev)

- [x] **`POST /wx-login` trusted a raw `phone` from the body** as "already verified", and the
  new-openid branch re-linked the account holding that phone to the caller's openid — any fresh
  WeChat account could take over anyone's account and lock them out. Now only `phone_code`
  (WeChat-verified) sets a phone, and the re-link requires `phone_verified_at`.
- [x] **`POST /wx-app-login` matched accounts on a raw body `phone`** — same takeover; removed
  (app openid / unionid only).

### Remaining after the cut-off

- [ ] Object-level checks inside handlers that take an `openid` plus a record id rely on the
  handler scoping the record to that openid; `userAccess` only adds `owner` checks for routes that
  name no user. Audit the rest when touching them.
- [ ] `LEGACY_APP_BEARER=reject` on prod once `legacy_app_bearer` logs reach zero, then rotate
  `API_BEARER_TOKEN` (runbook: `docs/architecture/api-auth.md` §6).

### Decisions _(settled 2026-09-23)_

1. **The miniapp's `pages/admin/` and `pages/superadmin/` are removed**, not re-secured — admins
   use the web panel (the `pages/webadmin/` web-view shell). This removes the only reason the
   shipped client needs an admin-capable credential.
2. **Rollout: force update + grace window.** Add `wx.getUpdateManager` so a new version applies
   on launch; dual-accept the legacy app bearer with a log line on every use, and remove it only
   when those logs reach zero.
3. **Super OTP stays enabled in prod**, code from the `SUPER_OTP_CODE` secret.

Driver: the Superiormed channel's coach-managed customers (no login of their own) are only
private if the server enforces coach ownership — phase 3.
