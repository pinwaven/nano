# Waven data map — nano + GCN (DEV databases)

Two PostgreSQL 14 databases on one PolarDB cluster. Both are **development** data: real product
flows, but test users, test orders and synthetic biomarkers mixed with real ones. Every timestamp
is `TIMESTAMPTZ`; the business timezone is Asia/Shanghai (UTC+8) — use
`AT TIME ZONE 'Asia/Shanghai'` when bucketing by day. Cross-database joins are impossible in SQL:
query each side and join in your own analysis using the keys below.

## What each database owns

| `database: "nano"` — Waven Nano (nano_db_dev) | `database: "gcn"` — GCN commerce (gcn_db_dev) |
|---|---|
| End-user identity & auth: `users` (PK `user_id`, 8-char hex TEXT), `user_phones`, `channels`, `users.roles TEXT[]` (`user`/`coach`/`admin`/`superadmin`) | Partners & stores: `partners`, `partner_types`, `partner_bindings`, `referral_tree`, `referral_codes` |
| Kino biomarker tests: `biomarkers`, `kino_devices`, `kino_chips`, `kino_chip_batches`, `kino_chip_models` | Catalog: `products`, `skus`, `packages`, `package_items`, `product_ai_profiles` |
| Digital twin: `health_twin` (rolling wearable summary), `health_events` (raw wearable/lab ingestion), `health_reports`, `health_documents`, `food_sensitivity_panels`/`_results`, `questionnaire_responses`, `user_memory_facts` | Orders: `orders`, `order_items`, `order_item_custom_formulations`, `order_item_viva_subscriptions`, `order_payment_receipts`, `shipping_addresses` |
| Plans & Dots: `health_plans`, `health_plan_templates`, `nutrition_plans`, `nutrition_schedules`, `dots` (the formulary), `boxes`, `box_batches`, `viva_ag_formulations` | Inventory: `partner_inventory`, `stock_movements`, `inventory_holds`, `vmi_replenishment_orders`, `sku_supply_prices` |
| Chat: `chat_messages`, `notifications`, `chat_generate_events` | Money: `ledger`, `settlement_events`, `settlement_allocations`, `commission_reports`, `partner_commission_rules`, `staff_commission_ledger`, `store_staff` |
| Coaches/CRM: `coaches`, coach notes/groups tables, `coach_*` | Codes & reviews: `sku_activation_codes`, `formulation_reviews`, `experts`, `expert_tasks` |
| Viva AG & extraction queues: `viva_ag_jobs`, `doc_extraction_jobs`, `viva_subscription_plans`, `viva_subscription_codes`, `persona_subscription_grants` | Sectors (formerly "channels"): `sectors`, `sector_settlement_rules`, `sector_dividend_tiers` |
| Nano's own partner program (legacy — GCN now owns tiers/referrals/commissions): `partners`, `partner_commissions`, `partner_payouts` | Chain/audit: `chain_records`, `chain_write_queue`, `inbox_messages` |

Use `waven_list_tables` for the full list — both schemas have well over 100 relations.

## Cross-database join keys

| GCN column | nano column | Notes |
|---|---|---|
| `users.nano_user_id` | `users.user_id` | The consumer identity bridge (GCN migration 0059). NULL for GCN-native accounts that never logged in via nano SSO. |
| `order_item_custom_formulations.nano_user_id` | `users.user_id` | Who a custom Dots formulation was compounded for. |
| `order_item_custom_formulations.nano_nutrition_plan_id` | `nutrition_plans.id` | The exact recipe that was compounded. `intended_nano_plan_id` is only what the buyer was looking at — advisory, never a link. |
| `order_item_custom_formulations.nano_ag_formulation_id` | `viva_ag_formulations.id` | Expert-reviewed (Viva AG) formula behind an order. |
| `order_item_custom_formulations.nano_label_code` | `nutrition_plans.label_code` | The `WVB…` code printed on the box. |
| `order_item_viva_subscriptions.nano_user_id` / `nano_code` | `users.user_id` / `viva_subscription_codes.code` | Viva / Viva AG subscription purchases. |
| `partners.nano_partner_id` | `partners.id` | GCN partner row provisioned from a nano partner. |
| `sectors.owner_nano_channel_id` | `channels.key_name` | e.g. `'aeviva'`; NULL for open marketplace sectors. |
| `commission_reports.nano_partner_id` | `partners.id` | |

Nano's `users.external_id` is the WeChat openid (with `external_app = 'wechat'`); GCN's `users`
has its own `phone`-based identity plus `nano_user_id`. Match by `nano_user_id` first, phone only
as a fallback (a user can hold several phones: nano `user_phones`).

## GCN naming traps

- **There is no `stores` table.** A store is a `partners` row with `partner_type IN ('store', 'silver_store', 'gold_store', 'platinum_store')`. A consumer's bound store is in `partner_bindings` (`binding_type = 'consumer_store'`).
- **There is no `commissions` table.** Commission data is spread across `commission_reports`, `partner_commission_rules`, `staff_commission_ledger`, `settlement_allocations` and `ledger`.
- **`channels` was renamed `sectors`** (migration 0003); columns named `sector_id` used to be `channel_id`. Do not confuse GCN sectors with nano `channels`.
- Order lifecycle: `orders.status` is TEXT with a CHECK constraint (`pending_payment → paid → awaiting_formulation → expert_review → compounding → processing → shipped → completed`, plus `cancelled`/`refunded`). Read the CHECK via `waven_describe_table` — statuses are never enums.
- `skus` carry the product-flavour flags (`is_custom_formulation`, `is_ag_formulation_bundle`, `viva_subscription_plan_key`, `redeems_for_sku_id`, `wholesale_only`, `metadata.max_distinct_dots`). A redeem-code purchase creates a real `orders` row just like a direct purchase.
- Money columns are `NUMERIC`; amounts are CNY.

## Nano naming traps

- **Biomarkers: `biomarkers.data->'validated'` is the truth.** `data->'actual'` is the raw reader value and can be out of range; the stored BioAge was computed from `validated`. Never analyse `actual` as if it were the measurement.
- `biomarkers` is a mixed bag keyed by `test_type`: `'kino_chip'` (a real Kino scan — the only type with a `bioage_profile`), `'lab_import'` (an imported lab panel), plus `body_composition`, `health_photo`, `food_photo`, `health_checkup_report`, `glucose_reading`, `bp_reading`… Filter on `test_type` before analysing `data`. `data->'bioage_profile'->'SubAges'` has exactly four keys: `CellularAge`, `MetabolicAge`, `MicroVascularAge`, `ResilienceAge`; `BioAge` and `ChronoAge` sit beside them.
- **Dots are referenced by `dots.key_name`** (`DOT-N1` … `DOT-N18`), never by `dots.id` — ids were reused when the formulary was replaced. `nutrition_plans.proposed_recipe` and `nutrition_schedules.recipe` are keyed on `key_name`. `health_plan_templates.recommended_dot_ids` holds key_names despite its name.
- `nutrition_plans.status`: `pending` (async formulation in flight) → `proposed` (a chat-tool proposal, purchasable, no schedules) → `approved` (expert-approved, no schedules yet) → `active` (user scanned the box; 56 `nutrition_schedules` rows exist) → `superseded`. Only `active` means the user is physically taking capsules.
- `chat_messages.persona_type` (`'nano'` | `'viva'`) scopes conversation history per assistant persona; `source = 'viva_ag'` marks Viva AG replies; `role` is written as `user` / `ai` / `coach` by the app (the original CHECK said `user`/`assistant` — verify with `SELECT DISTINCT role`).
- `users.channel_id` → `channels.id`; `channels.config->>'persona_type'` decides nano vs viva. **`coaches` has no `channel_id`** — a coach's channel is `users.channel_id` of the linked `coaches.user_id`.
- `users.bio_data` is JSONB from onboarding (height, weight, `health_conditions`); `health_twin` is one row per user with rolling wearable averages; `health_events` is the raw per-sync log (`category` = `sleep` / `activity` / `vitals` / `body_composition` / `lab_result`).
- `notifications` is read destructively by the app (`status` flips to `sent`) — it is a delivery queue, not an audit log; use `chat_messages` for history.
- Wearables: `users.wearable_brand` is `'halo'` / `'v8'` (also legacy `'x3'`, `'colmi'`, `'aizo'`).
- The DB `users.phone` column is a cache of the primary row in `user_phones`.

## Practical tips

- Start with `waven_describe_table` on `users` in both databases and on nano `biomarkers`.
- JSONB columns: `data->'validated'->>'hsCRP'` returns text; cast with `::numeric`.
- Estimated row counts come from `pg_class.reltuples`; use `SELECT count(*)` for exact numbers on small tables.
- Every statement runs in a READ ONLY transaction with a 15 s default timeout (max 60 s) and a 200-row default cap (max 2000) — aggregate in SQL rather than pulling raw rows.
