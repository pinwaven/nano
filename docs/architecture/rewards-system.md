# Rewards System

Coaches, Channels, and Users earn commissions on every sale attributed to them. Commissions are converted into **credits** stored in a per-user ledger. Users can exchange credits for cash via a withdrawal request. Each channel sets its own credit-to-currency exchange rate.

## Hierarchy

```
Waven Platform
  └── Channel  (a company: clinic, gym, distributor)
        └── Coach  (employed or contracted by the channel)
              └── User  (attributed to the coach at signup)
```

Both coaches and channels earn independently from Waven. The channel does not fund coach payments — Waven pays both.

---

## Attribution

When a user signs up via an invite code, `users.invited_by_invitation_id` is set. This is the permanent attribution anchor.

When an order reaches `delivered`:

1. Look up `orders.user_id → users.invited_by_invitation_id → invitations`
2. `invitations.created_by` = the coach's `user_id` → **coach gets credit**
3. `invitations.channel_id` = the channel at invite-creation time → **channel gets credit**

Because the channel is snapshotted on the invitation at creation time, coach transfers between channels are handled automatically: old orders credit the old channel, new invitations (and their future orders) credit the new channel. No history table is needed.

If the coach user account is later deleted, `invitations.created_by` becomes `NULL` but `invitations.created_by_snapshot` retains the original user ID permanently. The commission service reads `created_by` first; this field becomes NULL on deletion, so commissions are no longer attributed after the coach is removed. Existing commissions already recorded are unaffected.

Users with no invitation link generate no commission.

---

## Commission Rates

### Global defaults

Stored in `commission_settings` (6 rows: 2 roles × 3 product types):

| Role | Product Type | Rate type | Default |
|---|---|---|---|
| `coach` | `chip` | flat per chip | ¥18.00 |
| `coach` | `dot` | % of order | 10% |
| `coach` | `subscription` | % of order | 15% |
| `channel` | `chip` | flat per chip | ¥8.00 |
| `channel` | `dot` | % of order | 4% |
| `channel` | `subscription` | % of order | 5% |

### Per-channel overrides

Each channel can have a `commission_config` JSONB column that overrides the global defaults. Keys:

```json
{
  "coach_chip_flat": 20,
  "coach_dot_pct": 12,
  "coach_subscription_pct": 18,
  "channel_chip_flat": 10,
  "channel_dot_pct": 5,
  "channel_subscription_pct": 6
}
```

If a key is absent the global default is used. Configured in the web admin panel → Rewards → Settings (global) or via channel detail.

### Product type mapping

| `item_key` pattern | Commission `product_type` |
|---|---|
| `kino-chip-*` | `chip` |
| `dots-*` | `dot` |
| anything else | `subscription` |

---

## Database Schema

Migration: `temp/migration_commissions.sql`

### `commission_settings`

Global default rates. One row per `(role, product_type)` combination.

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL | Primary key |
| `role` | TEXT | `coach` or `channel` |
| `product_type` | TEXT | `chip`, `dot`, or `subscription` |
| `flat_rate_cny` | NUMERIC(10,2) | Used for chip (per-unit flat rate) |
| `percentage` | NUMERIC(5,2) | Used for dot and subscription (% of price_cny) |
| `updated_at` | TIMESTAMPTZ | Last modified |

### `channels.commission_config`

JSONB column added to the existing `channels` table. `null` means use global defaults or inherit from parent channel.

### `channels.can_customize_rewards`

Boolean column added to the `channels` table (`DEFAULT FALSE`). If `TRUE`, a sub-channel can define its own commission overrides or referral rates. If `FALSE`, the sub-channel recursively inherits rewards settings from its parent channel.

### Sub-channel Rewards Inheritance & Configuration Hierarchy

When calculating commission rates, referral commission rates, or credit system configurations (exchange rates, currency) for a channel, the system uses a **recursive hierarchy lookup**:
1. **Root Channels** (where `parent_channel_id IS NULL`) always use their own overrides from `commission_config` or `config` fields. If no override exists, they fall back to global platform defaults.
2. **Sub-channels** (where `parent_channel_id IS NOT NULL`) inherit settings from their parent channel in the recursive tree **unless** they have `can_customize_rewards = TRUE`. If customization is permitted, their own overrides are evaluated first.
3. The recursive lookup walks up to a maximum depth of 10 levels.

This applies to:
- Commission configuration (`commission_config` overrides)
- Referral commission rate (`config.referral_commission_rate`)
- Credit exchange rate (`config.credit_exchange_rate`)
- Channel currency (`config.currency`)

### `coach_commissions`

One row per earning event per coach. Unique on `order_id` — prevents duplicate commission if an order is toggled through `delivered` more than once.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `coach_id` | TEXT FK | `users.user_id` of the earning coach |
| `channel_id` | INTEGER FK | Channel at the time of the order (snapshot) |
| `user_id` | TEXT FK | The buying user |
| `order_id` | UUID FK | The triggering order |
| `product_type` | TEXT | `chip`, `dot`, or `subscription` |
| `item_key` | VARCHAR | Denormalised from order |
| `quantity` | INT | Units ordered |
| `amount_cny` | NUMERIC(10,2) | Calculated commission amount |
| `status` | TEXT | `pending` → `approved` → `transferred` |
| `payout_id` | UUID | FK to `coach_payouts.id` once batched |
| `created_at` | TIMESTAMPTZ | When the order was delivered |

### `channel_commissions`

Same shape as `coach_commissions` but `channel_id` is the earner. Also unique on `order_id`.

### `coach_payouts`

One payout batch per coach per period. Approved by the **channel admin**.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `coach_id` | TEXT FK | Earning coach |
| `channel_id` | INTEGER FK | Their channel at payout time |
| `period` | VARCHAR(7) | `YYYY-MM` |
| `total_cny` | NUMERIC(10,2) | Sum of all linked commission records |
| `status` | TEXT | `draft` → `approved` → `transferred` |
| `approved_by` | TEXT FK | `user_id` of the channel admin who approved |
| `approved_at` | TIMESTAMPTZ | |
| `transferred_at` | TIMESTAMPTZ | When Waven confirmed payment |

Unique on `(coach_id, period)`.

### `channel_payouts`

Same shape as `coach_payouts` but `channel_id` is the earner. Approved by the **superadmin**.

Unique on `(channel_id, period)`.

---

## Payout Lifecycle

```
Order → delivered
  └── commission service fires
        ├── INSERT coach_commissions (status: pending)
        └── INSERT channel_commissions (status: pending)

End of month:
  Superadmin → POST /api/generate-channel-payouts { period }
    └── channel_payouts records created (draft)
        └── Superadmin approves → status: approved
            └── Waven transfers → status: transferred

  Channel admin → POST /api/generate-coach-payouts { channel_id, period }
    └── coach_payouts records created (draft)
        └── Channel admin approves → status: approved
            └── Waven transfers → status: transferred
```

Status transitions on the underlying commission rows mirror the payout status when it changes to `approved` or `transferred`.

---

## API Endpoints

All endpoints require a valid `Authorization: Bearer <token>` header.

### Commission settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/commission-settings` | List all 6 global rate rows |
| `PUT` | `/api/commission-settings/:id` | Update one rate row |

### Coach commissions

| Method | Path | Query params | Description |
|---|---|---|---|
| `GET` | `/api/coach-commissions` | `coach_id`, `channel_id`, `status` | List commission records |
| `GET` | `/api/coach-earnings` | `coach_user_id` | Coach summary: this month, available, payout history |

### Channel commissions

| Method | Path | Query params | Description |
|---|---|---|---|
| `GET` | `/api/channel-commissions` | `channel_id`, `status` | List commission records |
| `GET` | `/api/channel-rewards-summary` | `channel_id` | Channel summary: this month, per-coach breakdown, pending payouts |

### Channel Rewards Configuration

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/channels/:id/rewards-config` | Fetch effective rewards configuration for a channel. Recursively walks the channel tree and returns: `commission_config`, `source` (own/inherited/global), `source_channel_id`, `source_channel_name`, `can_customize_rewards`, `referral_commission_rate`, `credit_exchange_rate`, `currency`. |
| `PUT` | `/api/channels/:id/rewards-config` | Update a channel's rewards overrides. Body: optional `commission_config` (JSON) and `referral_commission_rate` (number). Restricted to superadmins or channel admins who either own a root channel or have been granted `can_customize_rewards` permission. |
| `PUT` | `/api/channels/:id/rewards-permission` | Grant/revoke sub-channel rewards customization permission. Body: `{ can_customize_rewards: boolean }`. Restricted to superadmins or parent channel admins with sub-channel management permissions. |

### Payouts

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/coach-payouts` | List coach payouts (`coach_id` or `channel_id` filter) |
| `GET` | `/api/channel-payouts` | List channel payouts (`channel_id` filter) |
| `POST` | `/api/generate-coach-payouts` | Body: `{ channel_id, period }`. Creates draft payouts for all coaches in channel with pending commissions |
| `POST` | `/api/generate-channel-payouts` | Body: `{ period }`. Creates draft payouts for all channels with pending commissions |
| `PUT` | `/api/coach-payouts/:id` | Body: `{ status, approved_by }`. Advance status |
| `PUT` | `/api/channel-payouts/:id` | Body: `{ status, approved_by }`. Advance status |

---

## UI Surfaces

### Web Admin Panel — Rewards tab

Superadmin-only. Three sub-tabs:

- **Settings** — inline edit global commission rates (flat or %)
- **Channel Payouts** — generate payout batches by period, approve, mark transferred
- **Coach Commissions** — read-only ledger of all coach earning events across the platform

### Miniapp Coach Panel — Earnings tab

Coach-facing view at `pages/coach/coach`. Shows:
- This month's pending earnings
- Available balance (approved, awaiting transfer)
- Full payout history with status

### Miniapp Admin Panel — Rewards tab

Channel admin view at `pages/admin/admin`. Shows:
- Channel total earnings for the current month
- Generate Coach Payouts button (generates draft payouts for current period)
- Pending coach payout list with Approve action
- Per-coach breakdown: this month and cumulative pending

---

## Commission Service

`src/functions/worker/lib/commissions.js`

The `recordOrderCommissions(orderId)` function is called from `handlePutOrder` whenever `status === 'delivered'`. It:

1. Joins `orders → users → invitations` to resolve coach and channel
2. Determines `product_type` from `item_key`
3. Looks up the applicable rate (channel override → global default)
4. Inserts into `coach_commissions` and `channel_commissions` with `ON CONFLICT (order_id) DO NOTHING`
5. **Calls `creditUser()` for each inserted row**, converting `amount_cny × exchange_rate` into credit ledger entries

`recordUserReferralCommission(orderId)` follows the same pattern for user-to-user referral commissions.

Errors are caught and logged to CloudWatch without bubbling — a failed commission record never blocks an order status update.

---

## Credit System

### Overview

Every commission event (referral, coach, channel) produces both a commission row (existing tables) and a **credit ledger entry**. The ledger is append-only — balance is always derived as `SUM(amount)`. Credits can be redeemed for cash via a withdrawal request processed by a superadmin.

### Credit library

`src/functions/worker/lib/credits.js`

| Function | Description |
|---|---|
| `creditUser(userId, cnyAmount, exchangeRate, type, referenceId, referenceType, note)` | Insert a positive ledger entry. `credits = cnyAmount × exchangeRate` |
| `debitUser(userId, credits, type, referenceId, referenceType, note)` | Insert a negative ledger entry (used on withdrawal approval) |
| `getUserBalance(userId)` | `SUM(amount)` from `credit_ledger` for one user |
| `getLedgerHistory(userId, limit, offset)` | Paginated ledger rows, newest first |
| `getChannelExchangeRate(channelId)` | Reads `channels.config.credit_exchange_rate` (default `1.0`) |
| `getChannelCurrency(channelId)` | Reads `channels.config.currency` (default `'CNY'`) |

### Exchange rate

Each channel stores its own rate in `channels.config` (JSONB):

```json
{ "credit_exchange_rate": 10.0, "currency": "CNY" }
```

`credit_exchange_rate` = credits awarded per 1 unit of the channel's currency. With a rate of `10`, a ¥5 commission → 50 credits → ¥5 cash on redemption. The rate at the time of withdrawal is snapshotted on the `credit_withdrawals` row so future rate changes do not affect pending requests.

Defaults: `credit_exchange_rate = 1.0`, `currency = 'CNY'`.

### Database schema

Migration: `src/schemas/migration_credit_system.sql`

#### `credit_ledger`

Immutable, append-only. One row per credit event.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | TEXT FK | Earning or debited user |
| `amount` | NUMERIC(12,2) | Positive = earn, negative = debit |
| `type` | TEXT | `referral_commission` \| `coach_commission` \| `channel_commission` \| `withdrawal` \| `adjustment` |
| `reference_id` | UUID | ID of the source record (commission row, withdrawal row) |
| `reference_type` | TEXT | Table name of the source |
| `note` | TEXT | Optional human-readable note |
| `created_at` | TIMESTAMPTZ | |

Balance for a user = `SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE user_id = $1`.

#### `credit_withdrawals`

One row per cash-out request.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | TEXT FK | Requesting user |
| `credits_amount` | NUMERIC(12,2) | Credits to redeem |
| `currency_amount` | NUMERIC(12,2) | Cash value = `credits_amount / exchange_rate` |
| `exchange_rate` | NUMERIC(10,4) | Snapshot of channel rate at request time |
| `currency` | TEXT | ISO currency code (e.g. `CNY`, `USD`) |
| `payment_method` | TEXT | `wechat_pay` (default) |
| `payment_account` | TEXT | WeChat ID / phone / bank account |
| `status` | TEXT | `pending` → `approved` → `completed` (or `rejected`) |
| `admin_note` | TEXT | Optional note from the reviewing admin |
| `requested_at` | TIMESTAMPTZ | |
| `processed_at` | TIMESTAMPTZ | When admin actioned the request |
| `processed_by` | TEXT | `user_id` of the admin who actioned it |

### Withdrawal lifecycle

```
User submits POST /api/credits/withdraw
  └── credit_withdrawals row created (status: pending)
        └── Superadmin reviews in Admin Panel → Rewards → Credit Withdrawals
              ├── Approve → status: approved
              │     └── debitUser() inserts negative credit_ledger entry
              │           → balance decreases immediately, locking credits
              └── Reject  → status: rejected (no ledger entry)

After external payment (WeChat Pay / bank transfer):
  Superadmin marks → status: completed
```

Approval debits the ledger immediately so the user cannot submit a second withdrawal against the same credits while the payment is being processed externally.

### API endpoints

#### User-facing

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/credits/balance` | Returns `{ balance, exchange_rate, currency }` |
| `GET` | `/api/credits/history` | Paginated ledger entries (`limit`, `offset`) |
| `POST` | `/api/credits/withdraw` | Body: `{ user_id, credits_amount, payment_method, payment_account }` |
| `GET` | `/api/credits/withdrawals` | User's own withdrawal history |

#### Admin-facing (superadmin)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/credit-withdrawals` | List all requests, filterable by `?status=` |
| `PUT` | `/api/admin/credit-withdrawals/:id` | Body: `{ status, admin_note }`. Approve triggers ledger debit. |

#### Channel config (via existing channel PATCH)

`PUT /api/channels/:id` now accepts `credit_exchange_rate` (number) and `currency` (string) in the request body. Both are merged into `channels.config` JSONB.

### UI surfaces

#### Web Admin Panel — Rewards tab → Credit Withdrawals sub-tab

Lists all `credit_withdrawals` rows. Filterable by status. Actions:
- **Approve** — debits the user's ledger and moves status to `approved`
- **Reject** — moves status to `rejected`, no ledger change
- **Mark Completed** — moves status to `completed` after external payment is confirmed

#### Web Admin Panel — Channels tab → Edit channel modal

Added **Credit Exchange Rate** and **Currency** fields. Saved into `channels.config`.

#### Miniapp — Main page menu

Credit balance is fetched on `onLoad` and refreshed on `onShow`. When `creditBalance > 0`, a tinted balance row appears at the top of the header dropdown menu. Tapping it navigates to the referral/withdrawal page.

#### Miniapp — Referral page

- Credit balance card showing current balance and approximate cash value
- Withdrawal form (bottom sheet): enter credits amount and payment account, submits `POST /api/credits/withdraw`
- Withdrawal history list with status badges (pending / approved / rejected / completed)
