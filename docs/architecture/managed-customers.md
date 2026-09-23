# Managed Customers

Login-less customer accounts a coach creates and operates on behalf of a B2B channel. First
client: **SuperiorMed** (`channels.key_name='superiormed'`, id 7 on dev and prod, under
`aeviva-china` → Viva persona, aeviva GCN sector). Built 2026-09-23 on top of per-user sessions
(`docs/architecture/api-auth.md`), which is what keeps one coach's customers away from everyone else.

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
