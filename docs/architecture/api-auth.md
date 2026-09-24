# API Auth — Credentials, Per-User Sessions, and the Legacy App Bearer

How the worker (`src/functions/worker/index.js`) decides who a request is and what it may do.
Written 2026-09-23 when per-user sessions replaced the shared app bearer; the audit that led here
is `TODO.md` → "Security: Client Auth & Unauthenticated Takeover Paths".

## 1. Credentials the gate recognises

| Token | Who holds it | Becomes | Scope |
|---|---|---|---|
| `u.<payload>.<hmac>` | a signed-in miniapp / web user-app user | `role:'user'` + `adminCtx.user` | `lib/userAccess.js` route allowlist + identity checks |
| `sa.<payload>.<hmac>` | web admin panel superadmin (`/admin/login`) | `role:'superadmin'` | everything; the kino function accepts it too |
| `ch.<payload>.<hmac>` | web admin panel channel admin | `role:'channel'` | `requirePermission` per route |
| `signup.<payload>.<hmac>` | browser between successful OTP and new-account creation | no API role | accepted only by the matching phone/email verify handler for 10 minutes |
| `GCN_API_TOKEN` / `VIVA_AG_API_TOKEN` / `DOC_EXTRACT_API_TOKEN` | the three services | `role:'superadmin'` | exact-path allowlists in the gate |
| `API_BEARER_TOKEN` | **legacy** — compiled into old miniapp builds | `role:'superadmin'`, `legacyAppBearer` | everything, logged as `legacy_app_bearer`; off with `LEGACY_APP_BEARER=reject` |

`u.`/`sa.`/`ch.` are signed by `lib/auth.js` `signToken()` with **`TOKEN_SIGNING_SECRET`**
(`TOKEN_SIGNING_SECRET_PROD` on prod, deliberately different). Never with `API_BEARER_TOKEN` —
it is public (git history, old builds). Unset secret → signing throws, verifying returns null.

`signup.` is also signed by `TOKEN_SIGNING_SECRET`, but it is not a session credential and the
request gate gives it no authority. It only proves that one normalized phone or email already
passed OTP, allowing the new-user invitation step without replaying the one-time code. It is
bound to the identifier and login type, expires after ten minutes, and is refused once that
account exists.

`adminCtx` starts `role:'anonymous'`; only a recognised credential raises it. No credential on a
non-public route is 401.

## 2. Public routes

`PUBLIC_PATHS` in `index.js` — **method + path**, exact: the login steps (`/wx-login`,
`/wx-app-login`, `/phone-otp/send|verify`, `/email-otp/send|verify`, `/qr-login/init|status`,
`/admin/login`), `/channel-branding`, the user-app's `/exchange-webview-token`, and guest browsing
(`GET /store-items`, `POST /validate-invite`). A public route is still identified when it carries a
credential, but a missing or bad one never rejects it — an expired session must be able to log in.

`POST /qr-login/confirm` is public **only until `LEGACY_APP_BEARER=reject`**: released miniapp
builds send it with no Authorization header. After the cut-off it needs the confirming user's
session, and the body `openid` must be that user.

## 3. Per-user sessions

- **Issued** by the router's tail for `SESSION_ISSUING_PATHS` whenever the response carries a
  `user`: every login path, `/qr-login/status`, the browser's `/exchange-webview-token` (not GCN's
  server-side call), and the phone/email binds (a bind can merge the caller into the phone's
  existing account). Field: `session_token`.
- **Carries only `sub`** (user id), 30 days. Roles and coach rows are read from the DB on every
  request (`loadCaller`), so revoking a role takes effect at once; a merged-away account follows
  `merged_into_user_id`. Phone, email and QR login responses resolve that chain before returning
  the user or minting a session, so the client never lands on a merge loser. A DB error loading
  the caller is **503**, not 401 — clients drop their
  session on 401.
- `POST /session/refresh` — new token for the caller (clients call it when theirs is >1 day old).
- `POST /session/upgrade {user_id}` — **legacy bearer only**: lets an install signed in before
  sessions existed get one without logging in again. Dies with the legacy bearer.

## 4. What a session may do — `lib/userAccess.js`

Deny-by-default, two checks, before the router (and before the sandbox short-circuit):

1. **Route allowlist** `USER_ROUTES` — every call the miniapp and web user-app make (inventoried
   2026-09-23), nothing else. `:user` path params are checked like `openid`; `:coach` like
   `coach_id`; any other param is digits only (the router matches with `includes()`, so a free-text
   segment could land in a different handler).
2. **Identity** — every `openid` / `user_id` / `created_by` / `assigned_by` / `coach_user_id` /
   `user_ids` must be the caller, a client of one of the caller's coach rows (`users.coach_id`), or
   — for a caller with `admin` role — a user in the same channel. `coach_id` must be one of the
   caller's coach rows; `channel_id` the caller's channel. A caller with `superadmin` role may name
   anyone (the miniapp sandbox).

Route options: `owner`/`ownerCoach` (SQL resolving a record named only by id — a coach note, an
invitation, an order — to its owner, then checked as above; an ownerless record is refused),
`roles` (Kino simulator routes: admins only), `body` (keys a session may send — `PUT /users` drops
`roles`/`channel_id`/`coach_id`/`phone`/`email`, **before** claims are collected), `values`,
`query` (`GET /oss/presign` signs only `academy/` keys), `newAccountMinutes` (`DELETE /users` only
within an hour of signup).

A route admitted here passes the router's `requirePermission`/`requireAdminTab` gates
(`adminCtx.userRouteAuthorized`) — those predate sessions and were always passed by the legacy
bearer. **Adding a client call means adding its route here**, or it 403s with
`reason:'route_not_allowed'` (logged as `user_session_denied`).

## 5. Clients

- **Miniapp**: `utils/session.js`. `app.globalData.apiToken` holds the session (every request
  already sent it). Saved by `login.js` `_finishLogin`/`_finishNewUser`, the bind pages, and
  `continueAsPrevious` (the logout snapshot carries `session_token`). `app.onLaunch` →
  `restoreSession()`: stored token (refresh if >1 day), else legacy bearer + `/session/upgrade`.
  A 401 in main/coach `_req` → `handleAuthFailure()` → login page. `app._applyUpdates()` applies a
  new version as soon as WeChat has it. The native `pages/admin` and `pages/superadmin` are gone —
  admins use the web panel.
- **Web user-app**: `src/session.js` (localStorage `nano_session`). No token in the bundle any
  more; a stored user without a session starts signed out.
- **Web admin panel**: `sa.`/`ch.` from `/admin/login`; no `VITE_API_TOKEN` fallback.

## 6. Rollout / cut-off runbook

1. `npm run migrate:prod` (`migration_phone_otp_send_log.sql`), then prod worker, kino,
   admin-panel and user-app deploys. `.env` needs `TOKEN_SIGNING_SECRET_PROD` and `SUPER_OTP_CODE`.
2. Upload the miniapp build (VERSION ≥ `0923-3`) and release it.
3. Watch `legacy_app_bearer` log lines (worker, prod). They fall as installs update.
4. When they are ~zero: set `LEGACY_APP_BEARER: "reject"` in `s-prod.yaml` and deploy the worker.
   That also closes `/qr-login/confirm` and `/session/upgrade`.
5. Rotate `API_BEARER_TOKEN` (worker, kino, media, `handlers/academy.js`'s media self-call) and
   remove `LEGACY_APP_BEARER` from `utils/session.js`.
