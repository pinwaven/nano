# Rewards System

Coaches and Channels earn commissions on every sale attributed to them. Commissions are tracked in a ledger and paid out in monthly batches by Waven. No virtual currency is used — all amounts are in CNY.

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

JSONB column added to the existing `channels` table. `null` means use global defaults.

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

Errors are caught and logged to CloudWatch without bubbling — a failed commission record never blocks an order status update.
