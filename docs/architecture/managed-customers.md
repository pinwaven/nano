# Managed Customers (托管客户)

Last reviewed: 2026-09-23. This document covers the backend, miniapp and web coach workflows,
channel setup, release to a regular account, and verification status.

Login-less customer accounts a coach creates and operates on behalf of a B2B channel. First
client: **SuperiorMed** (`channels.key_name='superiormed'`, id 7 on dev and prod, under
`aeviva-china` → Viva persona, aeviva GCN sector). Built 2026-09-23 on top of per-user sessions
([API auth](api-auth.md)), which is what keeps one coach's customers away from everyone else.

A **managed customer** is an account type, not a role. A **staff member** in this workflow is
a regular signed-in user with the `coach` role and a linked `coaches` record; there is no
`staff` role. Do not turn the coach’s own account into a managed account.

## 1. What the channel asked for

- The channel has its own customers and does not want them using our app. Its coaches use the
  miniapp to create accounts for them, run Kino scans, formulate Dots and consult Viva about them.
- Two customer kinds in the channel: **managed** (above; the channel pays) and **regular** (normal
  users who sign in themselves).
- A managed customer can become regular when the channel admin **releases** them.
- Coaches may enter real names and phone numbers; data agreements come later, not in the pilot.

## 2. Data model — `migration_managed_customers.sql`

A managed customer is an ordinary `users` row, so every per-user table (biomarkers, nutrition
plans, facts, chat) works unchanged:

| Column | Managed customer |
|---|---|
| `account_type` | `'managed'` (else `'regular'`) — what every consumer path keys on |
| `external_id` | NULL — no WeChat login |
| `external_app` | `'managed'` |
| `user_phones` / `users.phone` | none — no OTP login, no collision with a real signup |
| `contact_phone` | the number the coach typed |
| `external_ref` | the customer's id in the channel's own system; unique per channel |
| `coach_id` / `managed_created_by_coach_id` | the creating coach |
| `birth_date`, `gender` | **required** — BioAge silently assumes age 30 without a birth date |
| `managed_released_at` / `_by` | set on release |

The channel switch is `channels.config.managed_customers = true` (read through
`effective_channel_config`, so sub-channels inherit it); the migration sets it for `superiormed`.

## 3. Endpoints — `handlers/managedCustomers.js`

- `POST /managed-customers` — coach session; body `coach_id` must be the caller's coach row
  (`lib/userAccess.js`), whose channel must have the switch on. Returns the customer.
- `PUT /managed-customers/:user` — the customer's coach edits the profile, only while managed.
- `POST /managed-customers/:user/release` — web admin panel (`users:write`), the customer's channel
  or an ancestor of it. Flips to `'regular'`; `contact_phone` becomes the account's primary phone
  **unverified** in `user_phones` if nobody holds it, so the customer's first OTP login proves it.
  Coach link and all records stay. Admin panel: user drawer → "账户类型 / Release".
- `GET /coach-users/:coach` returns `account_type`, name fields, `contact_phone`, `external_ref`
  and `managed_customers_enabled` (drives the coach panel's "+ 新建托管客户").

## 4. What a coach does for a managed customer

- **Scan**: the chat toolbox's 检测 action (`POST /kino-scan`) binds a chip to the customer; the
  reader writes the result under them. Unchanged code — it already took the client's id.
- **Formulate**: the toolbox's 配方 action (`POST /formula-dots`). Unchanged.
- **Ask Viva about them**: in the client's chat tab, sending goes to `POST /chat` with
  `speaker:'coach'` (regular clients still get a coach note via `/coach-instruction`). The turn runs
  in the customer's context — their data, facts, persona — the message is stored as a `'coach'`
  row, and `coachSpeakerBlock()` tells Viva it is answering the coach, about the customer, in the
  third person. For a managed account, `'coach'` rows are the user side of the chat history.
  Agentic turns reply asynchronously; the coach page polls `/coach-user-chat` for an `'ai'` row
  newer than `user_message_id` (285 s, like `main.js`).
- `lib/userAccess.js` `authorizeChatSpeaker`: a coach can never speak **as** a client (that would
  write into a real user's own thread), and `speaker:'coach'` is only for the coach's own managed
  customers.

## 4a. Everything in their thread speaks about them — `lib/managedVoice.js`

The coach reads a managed customer's thread, so nothing written there says 您 to the customer:

| Message | Where | How |
|---|---|---|
| Scan result line | `handlePostBiomarkers` (worker) **and** `kino/lib/deviceHandlers.js` | `scanResultMessage()` — two copies (each FC function ships its own code); a test asserts they agree |
| Formulation proposal | `handlePostFormulaDots` → async `formula_dots_generate` | `managedVoiceBlock(user)` on the system prompt; `llmContext.managed_voice` carries it to both deterministic fallbacks in `handlers/chat.js` |
| No-BioAge refusal, formulation trigger | `handlePostFormulaDots` | fixed third-person wording |
| Health advice (toolbox) | `handlePostHealthAdvice` | voice block; the trigger is stored as a `'coach'` row |
| Image / lab-report analysis | `handlePostAnalyzeImage` | voice block; trigger stored as `'coach'` |
| Coach-asked chat turn | `handlePostChat` (`speaker:'coach'`) | `managedVoiceBlock(user, {asked:true})` |

Regular users get exactly the old wording — `managedVoiceBlock` returns `''` for them.

## 5. What is switched off for them

- **Viva paywall**: `hasActiveVivaAccess` is true while managed (the channel pays). Callers must
  SELECT `account_type`; without it the row reads as regular and fails closed.
- **Proactive messaging**: every dispatcher scan excludes `account_type='managed'` (they never
  heartbeat either, so `last_active_at` already did).
- **Account merges**: `mergeUsers` refuses a managed account; `findMatchCandidate` never proposes one.
- **Login**: no `external_id`, no `user_phones` row, no email — there is nothing to log in with.

## 6. Known gaps / next steps

- Coach reminders (`POST /reminders`) for a managed customer create notifications nobody reads.
- End-to-end successful code redemption, order creation and box activation still need a recorded
  live verification with a linked coach and an available code; the earlier dev probe stopped at
  `redeemer_not_linked`.
- Production migration/deployment and the uploaded miniapp version were not verified in the
  2026-09-23 review. Passing offline tests or merging to `work` does not establish rollout status.

## 7. Payment — prepaid redeem codes (decided 2026-09-23)

SuperiorMed buys Dots codes wholesale on the GCN storefront, the same codes any store stocks
(dots-formulation skill, "Packages, orders, redeem codes"; lifecycle doc §28e). A coach spends one
per managed customer from the client's chat tab (**兑换码下单**): code + shipping (prefilled with the
customer's name and contact phone, and the last address used — usually the clinic's).

- `POST /formulation-redeem {openid: customer, code, shipping_*}` from the coach's session.
  `index.js` sets `_redeemer_user_id` from the session (never the body) when the caller is not the
  customer; `handlePostFormulationRedeem` refuses that for a non-managed account
  (`redeem_for_managed_only`), attaches the customer's live proposal when none is given, and
  forwards `redeemer_nano_user_id` to GCN.
- GCN (`handleNanoFormulationCodeRedeem`): a customer with no GCN account → the coach's GCN account
  is the **buyer**; the formulation row stays the customer's (`ocf.nano_user_id`), so fast-track,
  in-flight and the order listing work unchanged. **The coach must have opened the store once**
  (that links their GCN account); otherwise `redeemer_not_linked` and nothing is written.
- Still no nano code table, still no price in nano — both rules of the dots-formulation skill hold.
- After redeem it is the normal fast-track: GCN notifies back and nano auto-submits the proposal.
- **The box arrives at the clinic; the coach activates it** — **扫码激活盒子** in the client's chat tab
  calls the same `POST /box-claim` the customer's own app would, with the customer's openid. The
  server's `not_your_box` refusal is what stops a box made for someone else.
- Live-verified on dev up to GCN: the redeem reaches the new branch and stops at
  `redeemer_not_linked` for a coach who never opened the store. A full redeem needs a coach linked
  to GCN plus a held code (GCN dev has 7) — the happy path is covered by GCN unit tests.


## 8. Enable a channel and its staff

1. Apply [migration_managed_customers.sql](../../src/schemas/migration_managed_customers.sql)
   to dev through `npm run migrate:dev`. It adds the account fields and enables SuperiorMed
   by `key_name`, without overwriting an explicit existing `managed_customers` setting.
2. Put the staff user's `users.channel_id` in the intended channel. Channel membership is
   derived from the user: **`coaches` has no `channel_id` column**.
3. Create/link their coach record through `POST /api/coaches {user_id}`. This also grants
   `coach` in `users.roles`; adding only the role is insufficient because requests need a coach id.
   Reuse an existing linked coach record when one exists.
4. Have the staff member log out and back in. Login refreshes the miniapp's cached user, channel,
   coach and signed session. Open the coach panel → **我的客户**.
5. Confirm `GET /api/coach-users/:coach` returns `managed_customers_enabled: true` and the
   **+ 新建托管客户** button appears. The effective channel setting inherits through parent channels.

Dev fixture verified on 2026-09-23: **轻逍**, user `c40d46a4`, coach `62`, channel
`superiormed` (`7`), roles `user` + `coach`, regular account type. The user's test phone ends
in **7931**; it remains a staff login identity, not a managed customer's contact number.
This fixture is dev-only and is not a production provisioning record.

## 9. Coach workflow and form behavior

1. Sign into the dev miniapp or user webapp as an enabled channel's coach. Open
   **教练面板 → 我的客户** (web: channel/logo header menu → **教练面板**).
2. Tap **+ 新建托管客户**. Supply a name (surname/given name or display name), birth date
   and sex. A customer reference can also serve as the display-name fallback at the API level.
3. Optionally add a contact phone and the customer's identifier in the clinic's system.
   Save; the list reloads and the customer has the **托管** badge.
4. Open the customer to use their health data and chat toolbox. **编辑资料** opens the same
   form populated from that customer. Chat asks Viva about this customer; it does not impersonate them.
5. A channel admin can later release the customer from the web admin panel's user drawer.
   The coach cannot release a customer through the managed-customer form.

The web panel uses the same coach controller, translations, forms and API contracts. Its
browser adapters provide date/select controls, file selection and QR scanning with manual-code
fallback. See [Web Coach Panel](web-coach-panel.md) for source synchronization, browser
limitations and verification status. Web VERSION `0923-1` was verified locally and deployed to the dev webapp on 2026-09-23.
Production deployment remains separate.

### Fields and validation

| Field | Behavior |
|---|---|
| `last_name`, `first_name` | Optional individually; concatenated in that order as the creation-time display-name fallback |
| `nickname` | Display name; falls back to name, then `external_ref`; creation fails if all are empty |
| `birth_date` | Required on creation, `YYYY-MM-DD`, must parse as a date and must not be in the future |
| `gender` | Required on creation; `male` or `female` |
| `contact_phone` | Optional mainland China mobile number; backend accepts an optional `86`/`+86` prefix and normalizes to `+86…`; never creates an OTP identity while managed |
| `external_ref` | Optional; unique within the channel when non-null, including after release |
| `language` | API accepts `zh` or `en`; defaults/falls back to `zh` |

Edit accepts only the editable profile fields; it cannot change channel, roles or coach linkage.
Date and sex cannot be cleared when included in an edit. A released customer's edit returns
`not_a_managed_customer` because this endpoint only updates managed accounts.

### Layout (miniapp VERSION `0923-9`)

The create/edit sheet has 20px inset content, surname and given name side by side, 46px-high
inputs and date/sex selectors, visible selector prompts, and fixed cancel/save buttons with
safe-area padding. Only the body scrolls, keeping the actions accessible on smaller screens.
Styles are scoped to `.mc-form-panel` so other coach overlays retain their layout.

The original sheet used unstyled `form-row` wrappers: fields touched the edges, spacing was
missing and pickers looked like bare text. The September 23 fix adds the missing form layout.
Chinese and English selector prompts live in the coach page's `T[lang].mc` translations.

## 10. API and release details

All endpoint paths in §3 are relative to `/api`. Clients use their signed per-user session;
see [API auth](api-auth.md). Authorization runs in `lib/userAccess.js` before routing to the
handler; do not expose the handler directly without that gate. Creation checks the caller's
coach id and effective channel setting. Profile editing is role- and target-authorized by the
shared gate; coach access follows the customer's `users.coach_id`. The shared gate also retains
its admin/superadmin rules. Coach-spoken chat has the stricter own-managed-customer check.

Creation returns `{success:true, customer:{…}}`. Typical failures:

| Error | Meaning |
|---|---|
| `managed_customers_not_enabled` | The coach's channel has no enabled effective setting |
| `coach_not_found` | No linked coach record matches the request |
| `name_required`, `birth_date_required`, `gender_required` | Missing/invalid core profile field |
| `invalid_phone` | Contact number is not a supported China mobile number |
| `external_ref_in_use` | Another account in the channel already has this customer identifier |
| `coach_id_not_caller`, `not_your_user` | Session does not own the named coach or cannot access the target user |

Release uses a database transaction and locks the user row. A channel admin needs `users:write`
and the customer must be in their channel or a descendant; superadmin retains its normal access.
The user id, coach link and health records stay intact, and release stamps who did it and when.

- If the contact phone is available, it becomes an **unverified** primary login phone and is
  cleared from `contact_phone`. The customer proves ownership through OTP login.
- If another account owns the number, release still succeeds with `phone_moved:false` and
  `phone_note:'phone_in_use'`. The contact number stays; release does not transfer the other
  account's login identity.
- If no contact phone exists, release does not create a login method. A regular account type
  alone does not guarantee that the customer can sign in.
- This feature supplies no reverse “make managed again” endpoint.

## 11. Verification and troubleshooting

### Recorded verification, 2026-09-23

- After merging `origin/jp1` into `work`, `npm test` passed **1,057 tests**. This was before the
  later layout-only change, not an end-to-end production test.
- The updated form was checked through [the WeChat automator helper](../../tools/wechat-automator/README.md)
  with the dev staff fixture above. The coach endpoint enabled the create button. On a 390px-wide
  simulator, fields were inset 20px, controls measured 46px high, and the 633px form body scrolled
  inside a 524px viewport above the footer. A visual check confirmed the light-theme layout.
- No managed customer was created by that layout verification. Real-device keyboard behavior
  and the revised layout on Android remain to be checked after compiling/previewing `0923-9`.
- Syntax and whitespace checks passed for the layout patch. It did not require backend deployment.

Relevant offline coverage:

| Test file | Coverage |
|---|---|
| [managed-customers.test.js](../../tests/managed-customers.test.js) | Core validation, creation, channel gating, admin release/phone collision and mocked redemption forwarding |
| [worker-auth-gate.test.js](../../tests/worker-auth-gate.test.js) | Shared session gate and coach-spoken chat authorization |
| [managed-voice.test.js](../../tests/managed-voice.test.js) | Managed/regular wording and consistency of worker/Kino scan messages |

For a targeted rerun: `node --test tests/managed-customers.test.js tests/managed-voice.test.js tests/worker-auth-gate.test.js`.
Run `npm test` before deployment. Database tests use stubs; they do not prove live migration state.

| Symptom | Check |
|---|---|
| No coach panel after granting the role | Log out/in; confirm both `users.roles` and linked `coaches.user_id` |
| No create button | Check the logged-in account/channel and `managed_customers_enabled` from the coach-users response |
| New customer absent from the list | Check save response and `users.coach_id`; do not confuse the staff's `user_id` with their numeric coach id |
| Form still touches the screen edges | Confirm miniapp VERSION `0923-9` or later; recompile/reload the preview |
| Automator times out or restores another account | Use the documented helper recovery; storage survives relaunch, so verify the active user before testing |
| Released customer cannot log in | Check `phone_moved`/`phone_note` and whether a login identity actually exists |

## 12. Code map

| Responsibility | Source |
|---|---|
| Schema and initial channel setting | [migration_managed_customers.sql](../../src/schemas/migration_managed_customers.sql) |
| Create, edit, release, validation | [managedCustomers.js](../../src/functions/worker/handlers/managedCustomers.js) |
| Session/target authorization | [userAccess.js](../../src/functions/worker/lib/userAccess.js) |
| Coach list data and enablement flag | [coaches.js](../../src/functions/worker/handlers/coaches.js) |
| Coach form and client workflow | [coach.js](../../src/mini/nano-miniapp/pages/coach/coach.js), [coach.wxml](../../src/mini/nano-miniapp/pages/coach/coach.wxml), [coach.wxss](../../src/mini/nano-miniapp/pages/coach/coach.wxss) |
| Wording for managed accounts | [managedVoice.js](../../src/functions/worker/lib/managedVoice.js) |
| Admin release UI | [UsersTab.jsx](../../src/web/admin-panel/src/tabs/UsersTab.jsx) |

Keep this document and CLAUDE.md §49 aligned when changing the account lifecycle or access rules.
