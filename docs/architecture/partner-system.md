# Partner System

Aeviva's multi-level partner/distributor program. Partners are independent business operators who enroll at one of three tiers, recruit other partners (earning referral commissions), and sell Waven products at wholesale prices (earning a margin). Waven pays all commissions directly — there is no pass-through between partners.

Source spec: `temp/aeviva-partner-system.pdf` (MP-2026-05-001)

---

## Partner Tiers

| Tier key | Display name | Entry fee |
|---|---|---|
| `light_entrepreneur` | Light Entrepreneur / 轻创合伙人 | ¥9,800 |
| `leader_partner` | Leader Partner / 领袖合伙人 | ¥49,800 |
| `operations_center` | Operations Center / 运营中心 | ¥300,000 |

---

## Income Streams

### 1. Referral Commission

When partner A directly recruits partner B, A earns a one-time commission on B's entry fee. The rate depends on both tiers (upline tier × new partner tier):

| Upline → New | light | leader | ops_center |
|---|---|---|---|
| light | 25% | 20% | 10% |
| leader | 40% | 25% | 20% |
| ops_center | 50% | 30% | 25% |

Recorded as `source_type = 'referral'` in `partner_commissions`.

### 2. Sales Margin (Product Discount Rate)

Partners purchase products at a discount and sell at retail, keeping the margin. The margin rate by tier:

| Tier | Product margin | Training margin |
|---|---|---|
| light | 30% | 10% |
| leader | 40% | 30% |
| ops_center | 50% | 50% |

In Phase 1 there is no automated order integration. Sales commissions are entered manually via `POST /api/partner-commissions` (`source_type = 'sales'` or `'wholesale_margin'`).

### 3. Team Continuous Income

On any recorded sale, up to two upline levels each earn a flat percentage of the sale amount:

- Level 1 upline: 2% (configurable)
- Level 2 upline: 2% (configurable)

Recorded as `source_type = 'team_primary'` and `'team_secondary'`.

> **Excluded:** Kino chip / biological age test commissions are explicitly out of scope for the partner program.

---

## Commission Rules — Live Configuration

All rates are stored in the database (not hardcoded) and editable from the admin panel without a redeploy.

**Table:** `partner_commission_config` (singleton — always `id = 1`)

| Column | Type | Description |
|---|---|---|
| `referral_rates` | JSONB | 3×3 matrix `{uplineTier: {newTier: rate}}` |
| `product_discount_rates` | JSONB | `{tier: rate}` — selling partner margin |
| `training_discount_rates` | JSONB | `{tier: rate}` — training sales margin |
| `team_primary_rate` | NUMERIC(5,4) | Level-1 upline % of sale |
| `team_secondary_rate` | NUMERIC(5,4) | Level-2 upline % of sale |
| `updated_at` | TIMESTAMPTZ | Last save |

**Commission logic module:** `src/functions/worker/lib/partnerCommissions.js`

`getCommissionConfig()` fetches the live config row from the DB on each call. All calculation functions call it before computing amounts, so rule changes take effect immediately on the next transaction — no redeploy needed.

---

## Database Schema

Migrations: `src/schemas/migration_partners.sql`, `src/schemas/migration_partner_commission_config.sql`

### `partners`

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL | Primary key |
| `user_id` | TEXT FK | Links to `users.user_id` (optional — partner may not have a miniapp account) |
| `channel_id` | INTEGER FK | Channel this partner belongs to |
| `tier` | TEXT | `light_entrepreneur`, `leader_partner`, `operations_center` |
| `entry_fee_paid` | NUMERIC(12,2) | Actual entry fee paid (base for referral commission) |
| `real_name` | TEXT | Legal name |
| `phone` | TEXT | Contact number |
| `contracted_at` | TIMESTAMPTZ | Contract date |
| `referred_by_partner_id` | INTEGER FK → `partners(id)` | Direct upline (self-referential) |
| `status` | TEXT | `pending` → `active` → `inactive` |
| `notes` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### `partner_commissions`

Ledger of every earning event. One row per commission.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `partner_id` | INTEGER FK | The partner earning this commission |
| `source_type` | TEXT | `referral`, `sales`, `team_primary`, `team_secondary`, `wholesale_margin` |
| `source_partner_id` | INTEGER FK | The partner whose action triggered this earning (e.g. the new recruit, the seller) |
| `amount_cny` | NUMERIC(12,2) | Commission amount |
| `rate` | NUMERIC(5,4) | Rate applied (for reference) |
| `base_amount` | NUMERIC(12,2) | Amount the rate was applied to |
| `description` | TEXT | Human-readable note |
| `status` | TEXT | `pending` → `approved` → `transferred` |
| `payout_id` | UUID FK | Set when batched into a payout |
| `created_at` | TIMESTAMPTZ | |

### `partner_payouts`

Monthly payout batches. One row per partner per period.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `partner_id` | INTEGER FK | |
| `period` | VARCHAR(7) | `YYYY-MM` |
| `total_cny` | NUMERIC(12,2) | Sum of all linked commission rows |
| `status` | TEXT | `draft` → `approved` → `transferred` |
| `approved_by` | TEXT FK | `users.user_id` of the approving admin |
| `approved_at` / `transferred_at` | TIMESTAMPTZ | |
| `notes` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

Unique constraint on `(partner_id, period)` — re-generating a payout for the same period updates the total instead of creating a duplicate.

---

## Payout Lifecycle

```
New partner enrolled (POST /api/partners, referred_by_partner_id set)
  └── recordReferralCommission() fires
        └── INSERT partner_commissions (source_type='referral', status='pending')

Sales entered manually (POST /api/partner-commissions, source_type='sales')
  └── recordSalesCommission() fires
        ├── INSERT commission for seller (source_type='sales')
        ├── INSERT commission for level-1 upline (source_type='team_primary')
        └── INSERT commission for level-2 upline (source_type='team_secondary')

End of month:
  Superadmin → POST /api/generate-partner-payouts { period, channel_id? }
    └── partner_payouts rows created/updated (status='draft')
        └── partner_commissions.payout_id linked
            └── Superadmin approves → status='approved'
                └── commission rows → status='approved'
                    └── Waven transfers → status='transferred'
                        └── commission rows → status='transferred'
```

---

## API Endpoints

All endpoints require `Authorization: Bearer <token>`.

### Partners

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/partners` | List all partners; channel-scoped for non-superadmin. Includes upline name, channel name, aggregated earnings. |
| `GET` | `/api/partners/:id` | Partner detail with commission and payout history |
| `POST` | `/api/partners` | Register new partner. Auto-fires referral commission if `referred_by_partner_id` is set. |
| `PUT` | `/api/partners/:id` | Update tier, status, notes, contact details |
| `DELETE` | `/api/partners/:id` | Soft-delete: sets `status='inactive'` |
| `GET` | `/api/partner-tree/:id` | 2-level downline tree (root → children → grandchildren) |

### Commissions

| Method | Path | Query params | Description |
|---|---|---|---|
| `GET` | `/api/partner-commissions` | `partner_id`, `source_type`, `status`, `from`, `to` | Filterable commission ledger |
| `POST` | `/api/partner-commissions` | — | Manual commission entry |

### Payouts

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/partner-payouts` | List payouts (`partner_id`, `status`, `channel_id` filters) |
| `POST` | `/api/generate-partner-payouts` | Body: `{ period, channel_id? }`. Aggregates pending commissions into draft payouts. |
| `PUT` | `/api/partner-payouts/:id` | Body: `{ status, notes }`. Advance draft → approved → transferred. |

### Commission Rules Config

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/partner-commission-config` | Returns current live commission rules |
| `PUT` | `/api/partner-commission-config` | Saves updated rules to DB. Takes effect immediately — no redeploy needed. |

---

## Admin Panel

**Tab:** Partners (web admin panel, superadmin only)

**Sub-tabs:**

- **Partners** — paginated table with tier badge, status, channel, upline, cumulative earnings. Add / Edit partner modal. Deactivate action.
- **Commissions** — full ledger with source type badge, rate, base amount, status. Manual "Add Commission" form.
- **Payouts** — payout batches per partner/period. Generate by period, approve, mark transferred.
- **Commission Rules** — live editor for all rate tables:
  - Referral matrix (3×3 grid of % inputs)
  - Product discount rates per tier
  - Training discount rates per tier
  - Team level-1 and level-2 rates
  - Save button — writes directly to `partner_commission_config`, takes effect on the next commission calculation.

---

## Phase 1 Limitations

The following are deferred to a future phase:

- **Miniapp partner dashboard** — partners currently have no self-service view
- **Automated sales commission** — no integration with the store order system; all sales commissions are manual entries
- **Wholesale margin automation** — manual entry via commission form
