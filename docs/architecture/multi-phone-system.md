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

## 6. Files

**Nano:**
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
