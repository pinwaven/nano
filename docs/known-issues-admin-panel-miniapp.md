# Known Issues — Web Admin Panel & Miniapp

Compiled 2026-08-20 via a full read-through audit of `src/web/admin-panel/` and
`src/mini/nano-miniapp/` (cross-referenced against the worker backend they call). Every
finding below was verified by reading the actual code — file:line references are current
as of `work` @ `cddea29`. Nothing here has been fixed yet; check this file off as items are
resolved, and delete/re-verify entries if the underlying code moves.

Legend: **High** = security hole or user-facing data-loss/lockout risk. **Medium** = real
bug with a plausible trigger, contained blast radius. **Low** = cosmetic/hygiene, safe to
batch with other work.

---

## Web Admin Panel

### 1. [High] `/phone-otp/list`, `/phone-otp/set-primary`, `/phone-otp/remove` are completely unauthenticated
- `src/functions/worker/index.js:238`, `src/functions/worker/handlers/phone-otp.js:285-388`
- Admin panel call sites: `src/web/admin-panel/src/tabs/UsersTab.jsx:74,421-439`

`index.js:238` exempts every `/phone-otp/*` path from the bearer-token check (needed for
the pre-login OTP send/verify flow). But `handlePhoneOtpList`/`handlePhoneSetPrimary`/
`handlePhoneOtpRemove` take a bare `user_id` from the request body/query with **zero**
ownership or session proof — no OTP code, no token. `POST /api/phone-otp/remove
{user_id, phone}` with no `Authorization` header at all deletes any user's phone binding;
`set-primary` switches which phone is primary; `list` leaks a user's full phone list.
`handlePhoneOtpAdminAdd` (same file) is explicitly commented as deliberately placed
*outside* this prefix for exactly this reason — `remove`/`set-primary` have the identical
risk profile and were left inside it. The admin panel's new Phones tab relies on these
endpoints, so its own bearer-token gate is cosmetic here.

**Fix direction:** move `set-primary`/`remove`/`list` out of the bearer-exempt prefix
(mirroring `handlePhoneOtpAdminAdd`), or require real end-user session/OTP proof.

### 2. [High] `/health-plan-templates` CRUD has no permission gating; admin UI never sets `channel_id`
- `src/functions/worker/index.js:384-385,743-744,1041-1043,1178-1180`
- `src/functions/worker/handlers/health-plans.js:29-56`
- `src/web/admin-panel/src/tabs/HealthPlansTab.jsx:44,51-106`

Unlike `/knowledge-entries` (gated via `requireAdminTab(adminCtx, 'content')`), none of the
four `/health-plan-templates` routes check tab permission — any valid channel-admin bearer
token, regardless of `allowedTabs`, can create/edit/delete templates. Separately,
`HealthPlansTab.jsx`'s Add/Edit modal never includes a `channel_id`, so every template
created through the panel becomes global (`channel_id = null`, visible to all channels) with
no UI path to scope it and no backend check stopping a channel admin from deleting a
template other channels are actively enrolled in.

**Fix direction:** add `requireAdminTab(adminCtx, 'content')` to all four routes; add a
channel selector to the form or explicitly restrict this surface to superadmin/global-only.

### 3. [Medium-High] Coach deletion silently swallows the backend's "still has assigned users" error
- `src/web/admin-panel/src/tabs/CoachTab.jsx:118-125` (`DeleteCoachConfirm`)
- `src/functions/worker/handlers/coaches.js:439-449` (correctly returns 409 + message)
- Contrast: `src/web/admin-panel/src/tabs/UsersTab.jsx:242-251` has the equivalent guard done right

`handleDeleteCoach` returns a specific 409 when the coach still has assigned users, but
`DeleteCoachConfirm.handleDelete` catches and discards it silently — the admin just sees the
spinner clear with no explanation. `UsersTab.jsx`'s equivalent flow proactively blocks the
delete client-side with an explanatory message; the same hardening was never applied to
Coaches.

**Fix direction:** surface `err.response?.data?.error`, or add the same client-side
pre-check `UsersTab.jsx` uses.

### 4. [Medium] Dot form has no `target_dots_min`/`target_dots_max` fields
- `src/web/admin-panel/src/tabs/DotsTab.jsx:26-31,37-101`
- `src/functions/worker/handlers/dots.js:1544-1583` (write paths), `:1122-1123` (fallback)

Per-dot calibrated ranges (e.g. 1–2 for DOT-N1, 56–100 for DOT-N15) drive the formulation
engine's clamping (§28/§31 of CLAUDE.md — an earlier bug in this exact area was already
fixed once). `DotModal`'s form never references these two columns, and
`handlePostDots`/`handlePutDot` never write them — every dot added/edited via the admin
panel today leaves them `NULL` (new) or unchanged (edit), silently falling back to a generic
1–10 range. No UI path exists to correct an existing dot's range without direct SQL.

**Fix direction:** add both fields to `DotModal` and thread them through `handlePostDots`/
`handlePutDot`.

### 5. [Medium] Phones/Facts tab actions in `UserDetailModal` have no error handling
- `src/web/admin-panel/src/tabs/UsersTab.jsx:429-439` (`setPhonePrimary`, `removePhoneNumber`), `:889-893` (fact delete)

None of the three wrap their `axios` call in try/catch (unlike `UserFactModal`/
`PhoneAddModal` in the same file, which do this correctly). A failed request just throws
an unhandled rejection — no error shown, stale list stays displayed, no indication the
action failed.

**Fix direction:** wrap in try/catch, surface the error the same way the rest of the file does.

### 6. [Medium] Order status change silently fails with no admin feedback
- `src/web/admin-panel/src/tabs/StoreTab.jsx:334-355` (`OrderStatusSelect.handleChange`)

`catch { /* silent */ }` around the status-update PUT. Since the dropdown's displayed value
is driven by the parent's `status` prop (only refreshed on success), a failed update
silently reverts to the old status with zero indication — risky in a fulfillment context.

### 7. [Low-Medium] `AdminAccountsTab`'s role list fetch has no error handling at all
- `src/web/admin-panel/src/tabs/AdminAccountsTab.jsx:73-75`

`axios.get('/api/admin-channel-roles').then(...)` with no `.catch`. A failure leaves
`channelRoles` permanently `[]` for the page session — the Roles sub-tab and the Add
Account modal's role dropdown degrade silently with no retry path.

### 8. [Low] `TicketImageLightbox` presign call has no error handling
- `src/web/admin-panel/src/tabs/TicketsTab.jsx:117-124`

No `.catch` — a failed presign opens a blank black overlay with no image and no message.
The sibling `TicketImage` component in the same file (~line 90-108) handles this correctly
with an error state, so this is the same one-patched/one-not pattern as #3.

### 9. [Low, systemic] ~23 delete-confirmation modals across the panel discard the backend's error message
Identical `catch { /* silent */ }` pattern in `AcademyTab.jsx`, `ChannelTab.jsx`,
`CoachTab.jsx`, `InvitesTab.jsx`, `DotsTab.jsx`, `InventoryTab.jsx`, `KinoTab.jsx`,
`UsersTab.jsx`, `StoreTab.jsx`. Usually harmless (delete succeeds), but any backend
constraint error (FK violation, "still in use," permission denial) is invisible to the
operator. Worth one shared fix (e.g. a small `useDeleteWithError` helper) rather than 23
individual patches.

### Verified non-findings (don't re-flag)
- `UserModal`'s pencil-icon edit flow: phone field is genuinely read-only in edit mode — §33's restriction holds.
- No `.cid` (vs. `adminCtx.channelId`) bug-pattern instances found anywhere in the frontend.
- GCN embed SSO (`handlePostAdminWebviewToken`) correctly ignores client-supplied `channel_id` for channel-role admins.
- `handlePutUser`'s "only touch phone if key present" contract is correctly honored by `UserModal`.
- Partners "Rules" subtab is confirmed still disabled with its banner — no accidental re-enable.
- Persona-subscription admin surface (`PersonaSubscriptionsTab.jsx`, `AIPersonaTab.jsx`, `handlers/persona_subscriptions.js`) — checked in detail, correctly gated, no issues.

---

## Miniapp

### 10. [High] Removing a phone number has no "last phone" guard — can lock a user out of phone login
- `src/mini/nano-miniapp/pages/phones/phones.js:248-267` (`removePhone`)
- `src/mini/nano-miniapp/pages/phones/phones.wxml:25` (remove button rendered unconditionally, unlike "Set Primary" which is gated on `!item.is_primary`)
- `src/functions/worker/handlers/phone-otp.js:341-388` (`handlePhoneOtpRemove`)

A user with exactly one verified phone can remove it. The backend sets
`newPrimaryPhone = null` and clears `users.phone`/`phone_verified_at` — the user now has
zero phones on file. Per §33, phone login matches through `user_phones`; with zero rows,
phone-based login is gone entirely (both miniapp and web user-app), and the GCN identity
bridge mirrors the now-empty list, breaking phone recognition on that side too.

**Fix direction:** disable/hide Remove when `phones.length === 1`; add a matching
server-side guard in `handlePhoneOtpRemove`.

### 11. [High] Several pages' HTTP helpers resolve on *any* status code, silently masking 401/403/500 as empty-but-successful data
- Buggy (no statusCode check): `pages/main/main.js:3906-3925`, `pages/coach/coach.js:1506-1520`, `pages/superadmin/superadmin.js:747-756`, `pages/phones/phones.js:288-297`
- Correct (for contrast): `pages/admin/admin.js:1010-1028`, `utils/tool-actions.js:29,98`

At least 4 of ~5 hand-rolled `_req` implementations resolve on any HTTP response
regardless of status. Concretely:
- `coach.js:482-531` (`_loadAll`): a 401/403/500 on `/api/coach-users/:id` or
  `/api/invitations` leaves `clientsRes.data?.users` `undefined` → defaults to `[]`; no
  exception is thrown so the error toast never fires — the coach just sees an empty client
  list, indistinguishable from "this coach has zero clients."
- `superadmin.js:225-261` (`_loadAll`): identical pattern — a token issue silently renders
  an empty superadmin panel.
- `main.js:2392-2421` (`_sendMessage`): an auth/server error on `/api/chat` leaves the
  typing indicator quietly disappearing with **no error bubble** — looks like the message
  was sent and ignored.

**Fix direction:** replace the buggy `_req` copies with `admin.js`'s statusCode-checking
version (or actually use `utils/request.js`, see #12); branch on error type to toast /
redirect to login on auth failures instead of silently no-op'ing.

### 12. [Medium] `utils/request.js` — the one HTTP helper that gets error handling right — is dead code, never imported
- `src/mini/nano-miniapp/utils/request.js`

`req()`/`RequestError` correctly type 401/403 as `'auth'`, 5xx as `'server'`, network
failures as `'network'` — exactly the logic #11 needs. Nothing in the miniapp imports it;
every page hand-rolled its own `wx.request` wrapper instead (5+ near-duplicates across
`main.js`, `coach.js`, `admin.js`, `superadmin.js`, `phones.js`, `login.js`, `sync.js`),
of inconsistent quality.

**Fix direction:** migrate the buggy call sites from #11 onto this file and delete the
duplicates, or delete the file if it's genuinely superseded.

### 13. [Medium] Race condition in `openPlanDetail` — a stale async response can overwrite a newer plan's data
- `src/mini/nano-miniapp/pages/main/main.js:3179-3194`

Tapping plan A's card fires a detail fetch for A; tapping plan B's card shortly after
(before A resolves) fires a second fetch for B. If B resolves first and A resolves after,
A's `.then` still holds its own closure and unconditionally overwrites `planDetailData`
with A's data — while the overlay is still labeled/opened as plan B. No check that the
open plan id still matches the response's plan id.

**Fix direction:** capture `plan.id` before the await, compare against
`this.data.planDetailData?.id` before applying the result.

### 14. [Medium] No `wx.onBLEConnectionStateChange` listener anywhere in the wearable stack
- `src/mini/nano-miniapp/utils/wearable/ble-manager.js` (whole file), `utils/wearable/halo/index.js`, `utils/wearable/v8/index.js`

Zero uses of `wx.onBLEConnectionStateChange` in the miniapp. `BLEManager` tracks
`_connectedDeviceId` purely from its own connect/disconnect calls; in-flight commands
(`_send`/`_stream`) only resolve/reject via their own timeout (3s–25s depending on
command) or an explicit write failure. If the ring powers off, walks out of range, or the
OS drops the link mid-sync, nothing detects it proactively — a user who's already walked
away can stare at "syncing…" for up to 25s (V8's dynamic-HR stream) before it fails, and
`BLEManager` keeps reporting "connected" until something else notices.

**Fix direction:** register `wx.onBLEConnectionStateChange` in `BLEManager.connect()`,
clear `_connectedDeviceId` on unexpected disconnect, reject pending `_send`/`_stream`
promises immediately rather than waiting out the timeout.

### 15. [Low] Duplicate `onObNameInput` method definition
- `src/mini/nano-miniapp/pages/main/main.js:2513,2515`

Identical method defined twice back-to-back in the same object literal (harmless — same
body, second silently wins) — copy-paste residue, plus a similar exact-duplicate `noop() {}`
pair in the same file. Safe cleanup, no behavior change.

### Verified non-findings (don't re-flag)
- WXML comment-before-`wx:elif`/`wx:else` crash pattern (the known Android bug): swept every
  `.wxml` under `pages/`/`components/` — zero instances in our own code (only hits inside
  the third-party `node_modules/mp-html/`).
- `app.json` `requiredPrivateInfos`/permission declarations match actual sensitive API usage
  (`chooseAddress`, BLE scope, voice plugin) — no missing declarations found.
- V8 vs. Halo `_stream` timeout/partial-result behavior — consistent, no divergence.
- Bioage sub-age chart addition (`components/user-health/user-health.js`, commit `fcff535`) —
  reviewed in full, guards present, no bug found.
- Kino Simulator scan/analysis flow — statusCode checks and try/catch all correct.
- `_startPolling`/`_stopPolling` — every call site stops before starting, no stacked intervals.
- `utils/mood.js`, `utils/wearable/sync.js` — well-structured, no bugs found.

---

## Suggested triage order

1. **#1 and #10 together** — both touch the phone system and are the two genuine
   security/lockout risks; likely fixable in one pass since #10's server-side guard
   (reject removing the last phone) also narrows #1's blast radius for `remove`.
2. **#2** — permission gating is a one-line `requireAdminTab` add per route; low effort, real exposure.
3. **#11 → #12** — fixing the shared HTTP helper once (via #12) resolves most of #11's
   instances in one change rather than four separate patches.
4. Everything else can be batched as a general error-handling/hygiene pass (#3, #5, #6,
   #7, #8, #9, #13, #14, #15).
