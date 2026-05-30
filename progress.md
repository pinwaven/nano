# Payment Interface Documentation Progress

## 2026-05-26

- Reviewed project structure and confirmed `src/functions/payment` is empty.
- Reviewed existing FC 3.0 examples in `src/functions/lab`, `src/functions/worker`, and `s.yaml`.
- Reviewed current store schema to identify gaps for payment and refund lifecycle tracking.
- Started Markdown-only design task for a universal payment interface.
- Created `src/functions/payment/README.md`, `src/functions/payment/payment-architecture.md`, and `src/functions/payment/payment-api.md`.
- Ran a placeholder scan and confirmed required payment/refund/callback/polling sections are present.
- Implemented `src/functions/payment` runtime with WeCom adapter, payment creation, payment callback, refund creation, refund callback, payment/refund polling, and timer refund polling.
- Added `src/schemas/migration_payment.sql`, payment deployment entries in `s.yaml` and `s-prod.yaml`, root deploy scripts, and payment behavior tests.
- Added documentation comments and key inline comments to the payment FC handler and WeCom adapter.
- Added `src/functions/payment/lib/adapters/template.js` as a fully commented template for future payment providers.
- Implemented WeChat Pay and Alipay adapters, registered both providers, added adapter tests, and updated payment deployment environment variables.
- Changed payment provider configuration to be database-owned, with institution-specific configs falling back to an admin default config.
- Added `POST /payment/providers/test` for provider config validation, optional provider-side test order creation, and guarded real-refund testing for known paid test transactions.

# Lab Service Purchase And Fulfillment Progress

## 2026-05-30

- Confirmed requested project boundaries:
  - Mini-program: `src/mini/nano-miniapp/`
  - Worker API: `src/functions/worker`
  - Lab API: `src/functions/lab`
- Split the requested work into staged, confirmable milestones:
  1. Inspect current mini-program, worker, lab, payment, order, product, and admin flows before changing behavior.
  2. Add mini-program address management for purchase and delivery activation.
  3. Add lab service list retrieval on the mini-program home page while preserving the existing detection flow.
  4. Add lab product selection by `lab_name`, including multi-select goods and address/phone selection before order creation.
  5. Add worker order creation that writes summary data to `orders` and purchase line/source data to a new `transactions` table.
  6. Connect payment and show paid orders in `admin_panel` for `superadmin` and `admin`; allow `superadmin` to add tracking numbers and ship orders.
  7. Add Aliyun express integration for scheduled status polling and express callbacks.
  8. After user receipt confirmation, start the detection flow by scanning a barcode, sampling, and calling lab order creation with barcode, `user_id`, `lab_name`, goods, and fasting status while synchronizing `transactions` and `orders` statuses.
- Next: execute stage 1 only, producing an evidence-backed implementation map without changing business behavior.

## 2026-05-30 Stage 1 Inventory

- Mini-program scope:
  - `src/mini/nano-miniapp/app.json` currently registers only `login`, `main`, `admin`, `coach`, and `superadmin` pages.
  - Store UI is embedded in `pages/main/main.js` / `pages/main/main.wxml`; it loads `/api/store-items`, loads `/api/my-orders?openid=...`, and creates a simple order through `POST /api/orders`.
  - The existing store order flow is reservation-style: one product, quantity 1, no address selection, no payment call, and no lab product selection.
  - Kino detection flow already exists separately through chip scan and `/api/kino-*` endpoints. This should remain unchanged when adding lab service purchase entry points.
- Worker API scope:
  - Existing e-commerce handlers live in `src/functions/worker/index.js`.
  - `GET /store-items`, `GET /my-orders`, `GET /orders`, `POST /orders`, and `PUT /orders/:id` already exist.
  - Current `orders` writes only `user_id`, `item_id`, `item_key`, `quantity`, `price_cny`, `price_usd`, and `status`.
  - Admin order status changes are generic and only record commissions when status becomes `delivered`.
  - No user address CRUD endpoints, no `transactions` table usage, no lab product list endpoint in worker, and no express/tracking fields are currently present.
- Lab API scope:
  - `src/functions/lab/index.js` exposes `GET /lab/providers`, `GET /lab/qcs/sample-centers`, `GET /lab/qcs/projects`, `POST /lab/order`, and `POST /lab/webhook/:labName`.
  - `POST /lab/order` already accepts `lab_name`, `user_id`, and a `payload` object. For QCS, the payload supports `goods`, `barcode`, `sample_center_id`, `sample_time`, and `empty_stomach`.
  - Lab polling and webhook ingestion already update `lab_orders` and can ingest final biomarker observations.
  - `lab_products` exists in schema and seed data, but there is no lab API endpoint yet to list active products by `lab_name`.
- Database scope:
  - `src/schemas/migration_store.sql` defines `store_items` and a minimal `orders` table.
  - `src/schemas/migration_lab_products.sql` defines seeded `lab_products` with `lab_name`, `sku`, localized names/descriptions, sample metadata, fen/cents pricing, sort order, and active flag.
  - `src/schemas/migration_lab_orders.sql` defines `lab_orders`.
  - `src/schemas/migration_payment.sql` defines `payment_providers`, `payment_orders`, `payment_refunds`, and `payment_callback_events`.
  - No `transactions`, `user_addresses`, or express tracking table/migration was found.
- Payment scope:
  - `src/functions/payment/index.js` exposes provider-neutral payment creation and callbacks.
  - `POST /payment/orders` requires `business_order_id`, `user_id`, `scene`, `subject`, positive `amount_minor`, and `Idempotency-Key`.
  - Payment callback marks `payment_orders.status = paid` and also updates `orders.status = paid` using `business_order_id`.
  - The existing payment schema expects `business_order_id` to be a UUID, which matches current `orders.id`.
- Admin panel scope:
  - `src/web/admin-panel/src/App.jsx` has a Store tab that loads `/api/store-items?all=true` and `/api/orders`.
  - Admin order UI currently shows all orders and allows direct status changes among `pending`, `confirmed`, `shipped`, `delivered`, and `cancelled`.
  - Admin role filtering is tab-based; store visibility is not yet specialized for paid lab orders or superadmin-only fulfillment actions.
  - Lab admin panel currently manages providers, patient mappings, and reports; it does not manage lab products.
- Stage 1 conclusion:
  - The next safe implementation step is Stage 2 address management, because later lab checkout, paid fulfillment, and express shipment all need a stable address model.
  - Stage 3/4 should reuse existing `lab_providers` for the service list and add a small product-list endpoint over existing `lab_products`.
  - Stage 5 should migrate `orders` from single-item store orders toward order summaries while preserving current store behavior, then add linked `transactions` rows for line items/source/status tracking.

## 2026-05-30 Stage 2 Address Management

- Added `src/schemas/migration_user_addresses.sql`:
  - Creates `user_addresses` with contact name, phone, province/city/district, detail address, optional postal code, default flag, and timestamps.
  - Adds `orders.address_id` and `orders.shipping_contact` so checkout can persist the selected delivery/contact snapshot while preserving the current store order flow.
- Added worker address APIs in `src/functions/worker/index.js`:
  - `GET /addresses?openid=...`
  - `POST /addresses`
  - `PUT /addresses/:id`
  - `DELETE /addresses/:id`
  - Default-address updates clear prior defaults for the same user.
  - `POST /orders` now accepts optional `address_id`, verifies it belongs to the user, and stores the shipping snapshot.
- Added `tests/worker-addresses.test.js` for address list/create/update/delete behavior.
- Added mini-program address management page under `src/mini/nano-miniapp/pages/address/`.
- Updated mini-program Store flow:
  - Store tab shows the current selected/default contact address.
  - Users can open address management from Store.
  - Checkout requires an address; if none exists, user is sent to add one and then returned to continue the same order.
  - Store order creation now sends `address_id`.
- Verification:
  - `node --check src/mini/nano-miniapp/pages/address/address.js`
  - `node --check src/mini/nano-miniapp/pages/main/main.js`
  - `node --check src/functions/worker/index.js`
  - `node tests/worker-addresses.test.js`
  - `node tests/lab-order.test.js`
  - `node tests/payment.test.js`
  - `node tests/worker-kino-device-registration.test.js`
- Known verification gap:
  - `node tests/worker-endpoints.test.js` targets `https://nano-dev.fros.cc/api` and failed because the remote target was unreachable from this environment.
- Next pending confirmation: Stage 3 home-page lab service list integration.
