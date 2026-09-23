# Multi-Phone System

A user can hold more than one verified phone number, switch which one is "primary" (used for display and as the denormalized identity cache), and log in with any of them. This was already true at the data-model level before 2026-08-19 — `user_phones` predates this work — but nothing exposed the list, nothing could remove a phone, and the cross-repo GCN identity bridge assumed a single, unchanging phone. This doc covers the full model as it stands after that work.

---

## 1. Data Model

**`user_phones`** (migration `migration_users_phone_verified_multi.sql`): `id, user_id, phone, verified_at, is_primary, created_at`. Source of truth for phone → user_id lookup and for "which phones does this account have."

- Partial unique index on `phone` (`WHERE phone IS NOT NULL AND phone != ''`) — a phone belongs to exactly one account.
- Partial unique index on `user_id WHERE is_primary` — at most one primary phone per account.
- `verified_at IS NULL` means unverified (see §4 for how those rows get created and what "unverified" actually gates).

**`users.phone` / `users.phone_verified_at`** stay as a **denormalized cache** of whichever row currently has `is_primary = true` — kept in sync by every code path that changes phones (§2, §3), never a second source of truth. Read directly by several call sites that predate `user_phones` and were never migrated to query it instead: `gcnClient.js`, `partners.phone` (a *separate* column/table, see §5), `login.js`'s WeChat-openid matching.

`normalizeCnPhone()` (`lib/phone.js`) canonicalizes bare 11-digit CN numbers to E.164 (`+86...`) before they're ever written to either table.

---

## 2. Self-Service (Miniapp)

`src/functions/worker/handlers/phone-otp.js`:

| Endpoint | Handler | Effect |
|---|---|---|
| `POST /phone-otp/send` | `handlePhoneOtpSend` | Sends a real SMS OTP via Aliyun PNVS (China numbers only, `PHONE_RE = /^1\d{10}$/`) |
| `POST /phone-otp/verify` | `handlePhoneOtpVerify` | **Login** — resolves/creates a user by phone (see §4) |
| `POST /phone-otp/bind` | `handlePhoneOtpBind` | Attaches a phone to an *already-logged-in* user. First phone ever bound becomes primary; any later one is added as a non-primary secondary — never demotes an existing primary |
| `POST /phone-otp/set-primary` | `handlePhoneSetPrimary` | Switches which already-verified phone is primary. Does not itself verify anything |
| `GET /phone-otp/list` | `handlePhoneOtpList` | Returns `[{phone, is_primary, verified_at}]`, primary first |
| `POST /phone-otp/remove` | `handlePhoneOtpRemove` | Removes a phone. Removing the primary auto-promotes the most-recently-verified remaining phone; removing the last one clears `users.phone`/`phone_verified_at` to `NULL` (a WeChat-only account is a valid state) |

All six routes are under `/phone-otp/`, which `index.js`'s bearer-auth gate explicitly exempts — they're reachable pre-login (`send`/`verify`) or trust a client-supplied `user_id` in the body (`bind`/`set-primary`/`remove`), same looseness the login flow itself already had. **`GET /phone-otp/list` is safe to expose this way** (read-only, returns nothing sensitive beyond phone numbers for a known user_id); the admin-only add endpoint below deliberately does **not** live under this prefix, for exactly this reason.

**Miniapp UI:** `pages/phones/` (list/add/set-primary/remove), reached from the main menu ("手机号管理" / "Manage Phone Numbers"). The add flow reuses the same send+verify OTP mechanics inline rather than redirecting to `pages/verify-phone/` (that page is framed as first-time forced verification, not "add another").

---

## 3. Admin Panel

`src/web/admin-panel/src/tabs/UsersTab.jsx`:

- **Phones tab** (in the tabbed user-detail drawer, `UserDetailModal` — opened by clicking a user's row, *not* the pencil-edit icon): full list with Set-Primary/Remove actions, plus an **"Add Phone"** button.
- **`PhoneAddModal`** → `POST /admin-phone-add` → `handlePhoneOtpAdminAdd` (`phone-otp.js`). Inserts an unverified phone (`verified_at = NULL`) into `user_phones` with **no OTP proof** — for staff attaching a number a user reported over the phone/in person but can't self-verify right now. Only becomes primary if the account currently has zero phones; never displaces an already-verified primary. Accepts CN 11-digit or `+`-prefixed international format, same rules as `handlePhoneAcceptUnverified`.
  - **Not** routed under `/phone-otp/`'s bearer-exemption — attaching an arbitrary unverified number to an arbitrary account with zero ownership proof needs real gating, so it's mounted at `/admin-phone-add` and gated by `requireAdminTab(adminCtx, 'users')`, the same permission every other admin user-write endpoint requires.
- **`UserModal`** (the pencil-icon "编辑用户"/Edit User modal — a separate, older component): in edit mode, its old single-value `phone` text input was replaced with a **read-only** rendering of the real `user_phones` list (same Primary/Secondary/Unverified badges) plus a "Manage in Phones tab" button that closes this modal and reopens the detail drawer straight onto the Phones tab (`UserDetailModal` gained an `initialTab` prop for this). This modal no longer sends `phone` in its save payload at all — `handlePutUser` only touches `users.phone` when the key is present in the body, so `UserModal` genuinely cannot mutate phone data anymore; that's exclusively the Phones tab's job now. **Add-mode** (creating a brand-new user) is unaffected — no `user_id` exists yet to fetch a list for, so it still uses the original single-value input.

---

## 4. Login: Any Verified Phone Works, Not Just Primary

`handlePhoneOtpVerify` resolves the account via `findUserByPhone()`, which joins through `user_phones` rather than checking `users.phone`:

```js
async function findUserByPhone(phone) {
    const { rows } = await pool.query(
        `${USER_SELECT} JOIN user_phones up ON up.user_id = u.user_id WHERE up.phone = $1 LIMIT 1`,
        [phone]
    );
    return rows[0] || null;
}
```

Any row in `user_phones` matches — primary or secondary. This is used identically by the miniapp's own phone-login screen (`pages/login/login.js`) and the web user-app's `LoginScreen.jsx`.

**Edge case:** this JOIN doesn't filter on `verified_at`, so an **admin-added unverified** secondary phone (§3) also correctly resolves to the existing account the moment someone completes a real OTP check against it at login time — it will never fork into a duplicate account. But the successful login does **not** retroactively set `verified_at` on that `user_phones` row (only `handlePhoneOtpBind` writes `verified_at`), so it keeps showing "Unverified" in the Phones tab / miniapp list afterward even though real SMS possession was just proven at login. This is a cosmetic/bookkeeping gap, not a security one — login already required completing a real OTP either way. **Not yet fixed** — candidate: have `handlePhoneOtpVerify`'s existing-user branch `UPDATE user_phones SET verified_at = NOW() WHERE ... AND verified_at IS NULL` on a successful match.

---

## 5. Cross-Repo: GCN Identity Bridge

The Aeviva storefront (sibling repo `/Users/pin/waven/gcn`) has its own, independent `users`/`user_phones` tables, resolved via nano's webview-token SSO exchange (`gcn-integration` skill; `docs/architecture/partner-system.md` for `partners.phone`, a *separate* single-value column used only for admin-provisioned store/partner records, out of scope here).

**Before this work:** `gcn/src/functions/auth/index.js`'s `handleNanoSSO` matched a GCN consumer account purely by phone (its own `user_phones` join), and stored nano's `user_id` only as a denormalized backreference — never as a lookup key. A user switching their nano primary phone would silently get a **second, blank GCN account** on their next store visit, orphaning the first account's order history/referral position/ledger.

**Fixed (2026-08-19):**

1. `handleNanoSSO` now resolves by `nano_user_id` **first** (`SELECT ... WHERE nano_user_id = $1`), falling back to the phone-based `user_phones` lookup/insert only for first-time consumers or pre-migration accounts.
2. Nano's `/exchange-webview-token` response now includes a `phones` array (`WEBVIEW_USER_SELECT` in `handlers/login.js`, alongside the pre-existing single `phone`/`phone_verified` fields) — the user's full `user_phones` list, not just the current primary.
3. On every SSO login, `handleNanoSSO` reconciles GCN's own `user_phones` for that account to match nano's list **exactly** (demote-all-then-upsert, then delete any GCN-side row no longer in nano's list) — not just an additive upsert. This is what lets GCN's own native OTP login (`handleOTPVerify`, used directly by provisioned partners) recognize any of a user's nano-verified phones, and what stops a phone removed on nano's side from lingering recognized on GCN's.
4. `users.phone` (GCN's own denormalized primary cache, baked into JWTs) is explicitly kept in sync with whichever phone nano currently reports as primary, on every login.

`partners.phone` (nano's local cache pushed to a *provisioned partner/store* record, distinct from the consumer-account phone above) is kept in sync separately: `syncPartnerPhoneFromUser(user_id, newPhone)` (`handlers/partners.js`), called from every nano call site that changes a user's primary phone — `handlePutUser` (admin edit), `handlePhoneOtpBind`/`handlePhoneSetPrimary`/`handlePhoneOtpRemove`, and `login.js`'s WeChat bind/resolve writes. Previously only partner-record edits (`handlePutPartner`/`handleDeletePartner`) touched `partners.phone`, so a login-phone change never propagated to a provisioned partner's GCN record until someone happened to re-save it in the admin panel.

---

## 6. Email as a second login identity (2026-09-15)

Everything above now has an email twin. `user_emails` (`migration_user_emails.sql`) mirrors
`user_phones` column for column; `users.email` — a column that already existed as free text — is
now the denormalized primary-email cache, and `users.email_verified_at` its `phone_verified_at`.
Handlers in `handlers/email-otp.js`, endpoint for endpoint: `POST /email-otp/{send,verify,bind,
set-primary,remove}`, `GET /email-otp/list`, and the admin-gated `POST /admin-email-add` — the
last one outside the bearer-exempt `/email-otp/` prefix for exactly the reason `/admin-phone-add`
is outside `/phone-otp/`. `handlePutUser` keeps the cache in step through `syncPrimaryEmail`, the
twin of `syncPrimaryPhone`.

**Three things differ from phones, and each is deliberate.**

1. **Nano owns the code.** PNVS generates and verifies SMS codes on Aliyun's side; DirectMail — the
   email sender (`lib/email.js`, `no-reply@mail.gcn.net`) — only delivers. `lib/email-otp.js`
   therefore generates, hashes (sha256), stores (`email_otp_codes`), rate-limits (1 per 60s and
   5 per hour per address) and verifies (5 wrong guesses burn the code; a resend invalidates the
   previous one). `/email-otp/send` never consults `users`, so its response is identical for a
   known and an unknown address. Limits are per-address only — the handlers never see a client
   IP — which bounds a mail-quota DoS, not a takeover.
2. **Channel-agnostic login, root-safe merging.** A verified email can sign up and log in under
   any channel tree; the coach invitation decides a new browser user's channel. A user in any
   tree can also bind a fresh verified address. If an address already belongs to another account,
   `resolveRootChannelKey` must resolve both accounts to the same root before they may merge;
   cross-organization merges return `channel_not_supported` so verified identity cannot move
   private data between unrelated channel trees.
3. **No backfill.** `users.email` values were typed by staff and never verified by their owner, so
   they do not become login identities; `users.email` also gets no unique index (uniqueness lives
   on `user_emails.email`). A legitimate address is attached by the user proving it, or by an
   admin via Add Email (unverified, like an admin-added phone).

The super-OTP backdoor is honoured on `/email-otp/verify` (login only, never bind) and audits with
`identifier_type = 'email'` (`migration_super_otp_audit_log_identifier_type.sql`).

### Web new-user invitation step (2026-09-23)

Phone and email login still take an existing user directly into the app. When the web client sends
`require_invite:true` and the verified identifier is unknown, `/phone-otp/verify` or
`/email-otp/verify` returns
`{invite_required:true, signup_proof}` instead of creating an unassigned account. `signup_proof`
is a signed ten-minute `signup.` token bound to the normalized identifier and login type. The web
login then asks for the six-digit coach invitation code and resubmits it with that proof, so the
consumed OTP is never replayed or resent.

`lib/signup-invite.js` accepts active invitation codes and personal referral codes. It resolves
the channel plus the inviting coach (or the referrer's coach), and account creation writes
`coach_id`, `channel_id`, `invited_by_invitation_id`/`referred_by_user_id`, the login identity,
and invitation usage in one transaction. Expired, inactive, and exhausted invitation codes are
rejected. A signup proof cannot log into an account after it has been created.

The flag keeps the miniapp's existing direct phone/email signup behavior unchanged; the new
invitation gate is a web-login policy.

**Surfaces:** miniapp login page (phone/email toggle — hidden on a brand-specific build and once
an aeviva channel is stored, `EMAIL_LOGIN_AVAILABLE` in `utils/config.js`), `pages/emails/` (a
clone of `pages/phones/`, reached from the main menu when `emailLoginAllowed`), the web user-app
`LoginScreen` (an Email tab; the refusal surfaces as a message since that app is channel-unaware
at login), and the admin panel's Emails tab + `EmailAddModal`. The miniapp's GCN store gate
accepts `phone_verified || email_verified` on the waven tree.

**GCN side.** `WEBVIEW_USER_SELECT` now also returns `email_verified`, an `emails[]` list, and
`channel.root_key_name`. GCN's `handleNanoSSO` accepts an email-verified nano user **only for a
sector whose `login_methods` lists `email`** (`migration_0117` there flips waven), mirrors the email
list into its own `user_emails`, and signs `email` into the JWT; `root_key_name` is what arms its
channel/sector guard (`channel_sector_mismatch`). GCN's own native login (`login.html` on
`waven(-dev).gcn.net`) offers an email tab through the same seam. Detail: GCN `CLAUDE.md`
§"The `waven` sector".

**Deferred, not forgotten:** `handleNanoProvisionPartner` (GCN) still resolves a partner by phone —
a nano partner record always carries one today, so an email-only *store partner* is not yet
possible. Per-IP rate limiting needs the client IP threaded from `index.js`.

---

## 7. Files

**Nano (email, 2026-09-15):**
- `src/schemas/migration_{email_otp_codes,user_emails,super_otp_audit_log_identifier_type}.sql`
- `src/functions/worker/lib/{email,email-otp,channels}.js`, `handlers/email-otp.js`
- `src/functions/worker/handlers/{users,user-merge,login}.js` (`syncPrimaryEmail`, merge demotion, `WEBVIEW_USER_SELECT`)
- `src/mini/nano-miniapp/pages/{login,emails}/`, `pages/main/main.js`, `utils/{config,phone}.js`
- `src/web/user-app/src/components/LoginScreen.jsx`, `App.jsx`, `i18n.js`
- `src/web/admin-panel/src/tabs/UsersTab.jsx`, `translations.js`
- `tests/email-otp.test.js`, `tests/email-otp-routes.test.js`

**Nano (phones):**
- `src/functions/worker/handlers/phone-otp.js` — `handlePhoneOtpList`, `handlePhoneOtpRemove`, `handlePhoneOtpAdminAdd`
- `src/functions/worker/handlers/partners.js` — `syncPartnerPhoneFromUser`
- `src/functions/worker/handlers/users.js`, `handlers/login.js` — call sites for `syncPartnerPhoneFromUser`
- `src/functions/worker/handlers/login.js` — `WEBVIEW_USER_SELECT`'s `phones` array
- `src/functions/worker/index.js` — `/phone-otp/list`, `/phone-otp/remove`, `/admin-phone-add` routes
- `src/mini/nano-miniapp/pages/phones/` — self-service miniapp page
- `src/web/admin-panel/src/tabs/UsersTab.jsx` — Phones tab, `PhoneAddModal`, `UserModal`'s read-only list + `initialTab`-aware handoff to `UserDetailModal`

**GCN** (`/Users/pin/waven/gcn`):
- `src/functions/auth/index.js` — `handleNanoSSO`

Full cross-repo contract (webview-token exchange, provisioning, admin-panel embed): `gcn-integration` skill.

---

# Appendix: the `CLAUDE.md` §33 record (moved here verbatim 2026-09-15)

The project-rules entry as it stood before being condensed; the rules that must hold are now
summarised in `CLAUDE.md`. Kept because it records decisions and live findings in the words they
were made in.

## 33. Multi-Phone System (2026-08-19)

A user can hold more than one verified phone (`user_phones`, primary/secondary via `is_primary`), switch which is primary, remove one, and log in with **any** of them — not just the primary. `users.phone`/`phone_verified_at` are a denormalized cache of whichever row is currently primary, kept in sync by every phone-changing code path (`syncPrimaryPhone` in `handlers/users.js`, `handlers/phone-otp.js`'s bind/set-primary/remove, `login.js`'s WeChat bind/resolve), never a second source of truth.

- **Self-service (miniapp):** `GET/POST /phone-otp/{list,bind,set-primary,remove}` (`handlers/phone-otp.js`), new page `pages/phones/` reached from the main menu.
- **Admin panel:** the Phones tab (in the tabbed user-detail drawer, `UserDetailModal` — click the user's row, not the pencil icon) has full list/set-primary/remove plus an **Add Phone** action (`POST /admin-phone-add` → `handlePhoneOtpAdminAdd`, attaches an unverified number with no OTP proof, for staff use). That endpoint is deliberately **not** under `/phone-otp/`'s bearer-auth exemption — it's gated by `requireAdminTab(adminCtx, 'users')` like every other admin user-write endpoint, since it lets the caller attach an arbitrary number to an arbitrary account with zero ownership proof. The older pencil-icon "编辑用户" modal (`UserModal`) now shows the real phone list read-only (with a "Manage in Phones tab" handoff) instead of its own separate, single-value phone input — it can no longer mutate phone data at all.
- **Login (`handlePhoneOtpVerify`) matches through `user_phones`, not `users.phone`** — any verified phone, primary or secondary, logs into the same account (used by both the miniapp's phone-login screen and the web user-app). This also holds for an admin-added *unverified* phone the moment someone completes a real OTP check against it at login — it resolves to the existing account rather than forking a duplicate, though the login itself doesn't retroactively set that row's `verified_at` (known, un-fixed cosmetic gap — the phone still shows "Unverified" afterward even though possession was just proven).
- **New web identities require a coach invitation.** After OTP verification, an unknown phone/email receives a short-lived signed signup proof. The browser asks for the coach code, then creates the account under the resolved channel and coach transactionally; existing users never see this step.
- **GCN identity bridge (`gcn/src/functions/auth/index.js`'s `handleNanoSSO`):** previously matched a GCN consumer account by phone alone, so switching primary phone on nano's side silently forked a second GCN account. Fixed to resolve by `nano_user_id` first (phone-match only as fallback for first-time/pre-migration accounts), and to mirror nano's **full** phone list (not just primary) into GCN's own `user_phones` on every login, reconciled exactly (stale/removed numbers dropped) — this is also what lets GCN's own native OTP login recognize any of a user's nano-verified phones. `partners.phone` (the separate, single-value cache for a *provisioned partner/store* record — unrelated to the consumer-account phone above) is now kept in sync via `syncPartnerPhoneFromUser`, called from every phone-changing call site rather than only partner-record edits.

- **Email is a second login identity (2026-09-15; all channels from 2026-09-24).** `user_emails` mirrors `user_phones`; `handlers/email-otp.js` mirrors `phone-otp.js`; DirectMail (`lib/email.js`, `no-reply@mail.gcn.net`, sender set by `DM_ACCOUNT_NAME` — empty means the code is logged, not sent) only delivers, so nano owns the code lifecycle in `lib/email-otp.js` (`email_otp_codes`, per-address rate limit, 5-attempt cap). Signup and login work in every channel tree; duplicate-account merges still require the same root channel. No backfill of legacy `users.email`. `WEBVIEW_USER_SELECT` returns `email_verified`, `emails[]` and `channel.root_key_name`, which arms GCN's channel/sector guard (`channel_sector_mismatch`).
- **GCN linkage is resolved through the channel tree, not a leaf-key set (2026-09-15).** The six `GCN_LINKED_CHANNEL_KEYS` copies are gone: the worker uses `lib/channels.js` `resolveGcnSector` (`GCN_SECTOR_FOR_ROOT_CHANNEL = {aeviva, waven}`), the admin panel `shared.jsx` `gcnSectorForChannel`, the miniapp `main.js` `GCN_STORE_HOST_FOR_CHANNEL`. The waven tree is now GCN-linked exactly like aeviva (Store tab on `waven(-dev).gcn.net`, chat catalog, partner provisioning with `sector_id: 'waven'`, admin console embed at `/waven/dashboard-admin.html`); `fetchFormulationTiers(sector)` carries the sector so a waven user sees waven's packages.

Full detail: `docs/architecture/multi-phone-system.md` (§6 for email).
