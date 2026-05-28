# Universal Payment Architecture

## Scope

This document describes the universal payment interface for `src/functions/payment`.

Current requirements:

- Runtime: Aliyun FC 3.0, Node.js 20.
- Current providers: WeCom Pay, WeChat Pay, Alipay.
- Future providers: UnionPay, credit cards.
- Payment scenes: web payment, app payment, mini-program payment, QR code payment.
- Required capabilities: create payment order, create refund, payment callback, client/server polling, cron refund polling.
- Implementation exists in CommonJS JavaScript to match the current FC function style in this repository.

## Architecture

Use a dedicated `nano-payment` FC function with two trigger types:

- HTTP trigger for client APIs and provider callbacks.
- Timer trigger for scheduled refund polling and optional stale payment reconciliation.

The function should mirror the proven `src/functions/lab` pattern:

```text
HTTP request / Timer event
  -> FC 3.0 event decoder
  -> route or cron dispatcher
  -> payment service
  -> provider adapter
  -> database state transition
  -> normalized response
```

Provider-specific signing, request format, callback verification, and status mapping must stay inside adapters. Business state transitions, idempotency, logging, and API responses belong to the payment core.

## Proposed Files

```text
src/functions/payment/
  README.md
  payment-architecture.md
  payment-api.md
  index.js                         FC 3.0 handler, HTTP/timer dispatch
  package.json
  package-lock.json
  lib/
    db.js                          Postgres pool
    adapters/
      index.js                     adapter registry
      wecom.js                     WeCom Pay API v3 adapter
      wechat.js                    WeChat Pay API v3 adapter
      alipay.js                    Alipay OpenAPI adapter
      template.js                  future provider template

Future provider files:

src/functions/payment/lib/adapters/
  unionpay.js
  card.js
```

## Domain Model

### Payment Provider

A payment provider is an external payment channel such as `wecom`, `wechat`, `alipay`, `unionpay`, or `card`.

Each provider has one admin default merchant account and may have institution-specific merchant accounts. Configuration is database-backed in `payment_providers.config`; adapters must not read provider credentials from FC environment variables.

Provider selection rule:

1. If `institution_id` is provided on payment creation, select an active provider row for `(provider, institution_id)`.
2. If no institution row exists, fall back to the active admin default row for that provider, where `scope = 'admin'` and `institution_id IS NULL`.
3. Refunds and callbacks use the `provider_account_id` already stored on the original payment/refund record.

### Payment Order

A payment order represents Nano's intent to collect money for one business order.

One business order can have multiple payment attempts only when the previous attempt is expired, failed, or manually abandoned. At most one attempt can be active for the same business order and provider scene.

### Payment Attempt

A payment attempt is one request to one provider. It stores provider transaction identifiers, normalized status, raw provider response, and scene-specific client payload.

### Refund

A refund represents Nano's intent to return money for a successful payment. A single payment can have multiple partial refunds as long as the total refunded amount does not exceed the paid amount.

## Status Model

### Payment Status

| Status | Meaning | Terminal |
|---|---|---|
| `created` | Local record created, provider request not completed | No |
| `pending` | Provider accepted request, waiting for payment | No |
| `paid` | Provider confirms successful payment | Yes for payment collection |
| `expired` | Payment window closed before payment | Yes |
| `closed` | Merchant closed the provider order | Yes |
| `failed` | Provider rejected or failed the payment request | Yes |
| `refunding` | Payment is paid and at least one refund is pending | No |
| `refunded` | Fully refunded | Yes for net settlement |
| `partially_refunded` | Partially refunded, still has retained amount | No |

### Refund Status

| Status | Meaning | Terminal |
|---|---|---|
| `created` | Local refund request recorded | No |
| `pending` | Provider accepted refund request | No |
| `succeeded` | Provider confirms refund success | Yes |
| `failed` | Provider confirms refund failure | Yes |
| `closed` | Refund closed or cannot continue | Yes |

## Provider Adapter Contract

Every adapter must normalize provider behavior into this interface:

```ts
type PaymentProvider = 'wecom' | 'wechat' | 'alipay' | 'unionpay' | 'card';
type PaymentScene = 'web' | 'app' | 'mini_program' | 'qr_code';

interface PaymentAdapter {
  provider: PaymentProvider;

  createPayment(input: CreatePaymentInput, config: ProviderConfig): Promise<CreatePaymentResult>;
  queryPayment(input: QueryPaymentInput, config: ProviderConfig): Promise<QueryPaymentResult>;
  closePayment(input: ClosePaymentInput, config: ProviderConfig): Promise<ClosePaymentResult>;

  createRefund(input: CreateRefundInput, config: ProviderConfig): Promise<CreateRefundResult>;
  queryRefund(input: QueryRefundInput, config: ProviderConfig): Promise<QueryRefundResult>;

  verifyPaymentCallback(input: CallbackVerifyInput, config: ProviderConfig): Promise<VerifiedPaymentCallback>;
  verifyRefundCallback(input: CallbackVerifyInput, config: ProviderConfig): Promise<VerifiedRefundCallback>;
}
```

Adapters must return provider-neutral statuses and preserve the raw provider payload for audit.

## Payment Scenes

| Scene | Client | Adapter output |
|---|---|---|
| `web` | Browser H5 or PC web | Redirect URL, QR code URL, or provider checkout token |
| `app` | Native iOS/Android app | SDK payload needed by the app to invoke payment |
| `mini_program` | WeChat/WeCom mini program | Mini-program payment parameters such as nonce, timestamp, package, sign type, and pay sign |
| `qr_code` | User scans a merchant-presented QR code | `payment_payload.qr_code_url` for frontend QR rendering |

The public API should accept a `scene` value and return a scene-specific `payment_payload` object. The core service must not expose provider-native field names except inside `payment_payload`.

## Database Design

The current `orders` table is too small for full payment lifecycle tracking. Add payment-specific tables in a future migration.

### `payment_providers`

Stores provider and merchant account configuration.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `provider` | TEXT | `wecom`, `wechat`, `alipay`, `unionpay`, `card` |
| `merchant_id` | TEXT | Provider merchant account ID |
| `institution_id` | TEXT | Institution/clinic/channel owner of this merchant config. NULL means admin default |
| `scope` | TEXT | `admin` or `institution` |
| `label` | TEXT | Human-readable account name |
| `config` | JSONB | Provider credentials and non-secret config used by the adapter |
| `secret_ref` | TEXT | Optional KMS/ops reference. Not used for env fallback by adapters |
| `is_active` | BOOLEAN | Soft enable/disable |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |

Recommended constraints:

- One active admin default per provider.
- Institution rows must have `institution_id`.
- Admin default rows must have `institution_id IS NULL`.

Example WeChat/WeCom `config`:

```json
{
  "appid": "wx_app_id",
  "api_base_url": "https://api.mch.weixin.qq.com",
  "notify_url": "https://example.com/payment/callbacks/wechat/payment",
  "refund_notify_url": "https://example.com/payment/callbacks/wechat/refund",
  "merchant_serial_no": "cert_serial",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "api_v3_key": "32-byte-api-v3-key",
  "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
}
```

Legacy WeChat Pay v2-compatible `wechat` configs can use AppClient credentials without v3 fields:

```json
{
  "appid": "wx_app_id",
  "api_base_url": "https://api.mch.weixin.qq.com",
  "notify_url": "https://example.com/payment/callbacks/wechat/payment",
  "app_key": "wechat-pay-v2-app-key",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "appclient_cert": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
}
```

Example Alipay `config`:

```json
{
  "app_id": "alipay_app_id",
  "gateway_url": "https://openapi.alipay.com/gateway.do",
  "notify_url": "https://example.com/payment/callbacks/alipay/payment",
  "return_url": "https://example.com/pay/return",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "alipay_public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
}
```

### `payment_orders`

Stores local payment lifecycle state.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `business_order_id` | UUID | Links to `orders.id` or a future business order table |
| `user_id` | TEXT | Links to `users.user_id` |
| `institution_id` | TEXT | Institution used for provider selection. NULL means admin default |
| `provider` | TEXT | Provider key |
| `provider_account_id` | UUID | FK to `payment_providers.id` |
| `scene` | TEXT | `web`, `app`, `mini_program` |
| `currency` | TEXT | ISO currency code, default `CNY` |
| `amount_minor` | INTEGER | Minor units, for example cents |
| `subject` | TEXT | Product/order display name |
| `description` | TEXT | Optional detail |
| `status` | TEXT | Normalized payment status |
| `client_ip` | INET | Optional request IP |
| `idempotency_key` | TEXT | Client-supplied or server-generated idempotency key |
| `provider_trade_no` | TEXT | Provider transaction/order number |
| `provider_payload` | JSONB | Last provider response |
| `paid_at` | TIMESTAMPTZ | Provider-confirmed payment time |
| `expires_at` | TIMESTAMPTZ | Payment expiry |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |

Recommended constraints:

- Unique `(provider, provider_trade_no)` when `provider_trade_no` is not null.
- Unique `(business_order_id, idempotency_key)`.
- Index `(user_id, created_at DESC)`.
- Index `(status, expires_at)`.

### `payment_refunds`

Stores refund requests and provider refund status.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `payment_order_id` | UUID | FK to `payment_orders.id` |
| `business_order_id` | UUID | Business order reference |
| `provider` | TEXT | Provider key |
| `refund_no` | TEXT | Local refund number |
| `provider_refund_no` | TEXT | Provider refund ID |
| `amount_minor` | INTEGER | Refund amount in minor units |
| `reason` | TEXT | Refund reason |
| `status` | TEXT | Normalized refund status |
| `idempotency_key` | TEXT | Idempotency key |
| `provider_payload` | JSONB | Last provider response |
| `last_polled_at` | TIMESTAMPTZ | Cron refund polling marker |
| `next_poll_at` | TIMESTAMPTZ | Backoff schedule |
| `succeeded_at` | TIMESTAMPTZ | Provider-confirmed success time |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |

Recommended constraints:

- Unique `(payment_order_id, refund_no)`.
- Unique `(provider, provider_refund_no)` when `provider_refund_no` is not null.
- Index `(status, next_poll_at)`.

### `payment_callback_events`

Stores raw callbacks for audit and idempotent replay protection.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `provider` | TEXT | Provider key |
| `event_type` | TEXT | `payment` or `refund` |
| `event_id` | TEXT | Provider event ID if available |
| `provider_trade_no` | TEXT | Payment transaction number |
| `provider_refund_no` | TEXT | Refund transaction number |
| `headers` | JSONB | Raw callback headers |
| `raw_body` | TEXT | Raw body before parsing |
| `verified` | BOOLEAN | Signature verification result |
| `process_status` | TEXT | `received`, `processed`, `ignored`, `failed` |
| `error` | TEXT | Processing error if any |
| `created_at` | TIMESTAMPTZ | Received time |
| `processed_at` | TIMESTAMPTZ | Processing time |

Recommended constraints:

- Unique `(provider, event_id)` when `event_id` is not null.
- Index `(provider, provider_trade_no)`.
- Index `(process_status, created_at)`.

## Core Flows

### Create Payment Order

```text
Client -> POST /payment/orders
  1. Authenticate caller and resolve user.
  2. Validate amount, currency, provider, scene, business_order_id.
  3. Use idempotency_key to return an existing active result when retried.
  4. Insert `payment_orders` with `created`.
  5. Call adapter.createPayment().
  6. Update record to `pending` or `failed`.
  7. Return normalized order plus scene-specific `payment_payload`.
```

The system must not mark an order as `paid` from create-order response alone unless the provider explicitly returns a final paid state.

### Payment Callback

```text
Provider -> POST /payment/callbacks/:provider/payment
  1. Preserve raw body before JSON parsing.
  2. Load provider config by merchant ID or callback route.
  3. adapter.verifyPaymentCallback() validates signature and decrypts payload when needed.
  4. Insert `payment_callback_events`.
  5. Lock matching `payment_orders` row by provider transaction number or local order number.
  6. Apply allowed status transition.
  7. Update business order after payment becomes `paid`.
  8. Return provider-specific success acknowledgement.
```

Callbacks must be idempotent. Duplicate paid callbacks should return success without duplicating downstream effects.

### Payment Polling

```text
Client/Admin -> GET /payment/orders/:id
  1. Read local payment order.
  2. If status is non-terminal and `sync_provider=true`, call adapter.queryPayment().
  3. Apply any status transition.
  4. Return normalized payment order.
```

Polling is useful for clients that do not receive callback updates quickly. The callback remains the authoritative asynchronous path.

### Create Refund

```text
Client/Admin -> POST /payment/refunds
  1. Authenticate and authorize refund actor.
  2. Lock paid payment order.
  3. Validate refundable amount.
  4. Use idempotency_key to avoid duplicate refunds.
  5. Insert `payment_refunds` with `created`.
  6. Call adapter.createRefund().
  7. Update refund to `pending`, `succeeded`, or `failed`.
  8. Update payment aggregate status to `refunding`, `partially_refunded`, or `refunded`.
```

Refund success should be confirmed by callback or provider query when the provider only returns an accepted state.

### Refund Callback

```text
Provider -> POST /payment/callbacks/:provider/refund
  1. Verify and store callback event.
  2. Lock matching refund row.
  3. Apply refund status transition.
  4. Recalculate paid order refund totals.
  5. Return provider-specific success acknowledgement.
```

### Cron Refund Polling

```text
Timer trigger
  1. Select pending refunds where `next_poll_at <= NOW()`.
  2. For each refund, load provider config and call adapter.queryRefund().
  3. Apply status transition.
  4. Set `last_polled_at` and next backoff time for non-terminal refunds.
  5. Log provider failures and retry later without creating duplicate refund requests.
```

Recommended polling cadence:

- FC timer every 5 minutes.
- Refund backoff: 5 minutes, 15 minutes, 30 minutes, 1 hour, then every 4 hours until a configured maximum age.
- Alert when a refund remains `pending` longer than 24 hours.

## Status Transition Rules

Allowed payment transitions:

```text
created -> pending
created -> failed
pending -> paid
pending -> expired
pending -> closed
pending -> failed
paid -> refunding
refunding -> partially_refunded
refunding -> refunded
partially_refunded -> refunding
```

Disallowed transitions:

- Any non-refund transition away from `paid`.
- Any transition away from `refunded`.
- Callback attempts that would reduce state confidence, such as `paid -> pending`.

Allowed refund transitions:

```text
created -> pending
created -> failed
pending -> succeeded
pending -> failed
pending -> closed
failed -> pending
```

The `failed -> pending` transition is allowed only for an explicit retry with a new provider request or a provider query proving the original refund is still active.

## Provider Notes

The WeCom and WeChat adapters use the WeChat Pay API v3 protocol and own:

- Merchant account lookup.
- Request signing and certificate handling.
- Scene-specific payload generation for web, app, mini-program, and QR code where supported by the selected WeCom payment product.
- Callback signature verification and payload decryption.
- Mapping WeCom/WeChat payment and refund statuses into the normalized status model.
- Provider acknowledgement format for payment and refund callbacks.

The Alipay adapter uses OpenAPI gateway requests and owns:

- RSA2 signing for `alipay.trade.*` requests.
- Web page payment signed redirect URL generation.
- App payment order string generation.
- Mini-program `alipay.trade.create` flow.
- QR code `alipay.trade.precreate` flow.
- Form-encoded callback signature verification.
- Mapping Alipay trade/refund statuses into the normalized status model.

Do not leak provider-native field names into core service types except inside `provider_payload` and `payment_payload`.

## Security

- Callbacks must validate provider signatures before parsing trusted fields.
- Raw callback body must be retained for verification and audit.
- Provider secrets must not be logged.
- Logs should include local order IDs, provider, status, and request IDs, but never certificates, private keys, API secrets, or full card details.
- Client APIs should require the same authentication model as existing Nano APIs.
- Refund APIs require stronger authorization than user-facing payment creation.
- Idempotency keys are required for create payment and create refund.

## Observability

Use structured JSON logs with at least:

- `level`
- `msg`
- `provider`
- `scene`
- `payment_order_id`
- `business_order_id`
- `refund_id`
- `status`
- `provider_trade_no`
- `provider_refund_no`

Provider API call failures should also be persisted on the local row that
initiated the call:

- Payment order creation failures set `payment_orders.status = 'failed'` and store a sanitized failure object in `payment_orders.provider_payload`.
- Refund creation failures set `payment_refunds.status = 'failed'`, clear `next_poll_at`, and store a sanitized failure object in `payment_refunds.provider_payload`.
- Failure payloads may include provider error codes and response bodies, but must redact secrets, keys, certificates, authorization values, and signatures.
- `request_id`

Track operational metrics:

- Payment create success/failure rate by provider and scene.
- Callback verification failures by provider.
- Pending payment age.
- Refund pending age.
- Cron refund polling success/failure count.
- Duplicate callback count.

## FC 3.0 Deployment Shape

Future `s.yaml` resource should resemble:

```yaml
payment:
  component: fc3
  props:
    region: ${vars.region}
    functionName: nano-payment-dev
    runtime: nodejs20
    handler: index.handler
    memorySize: 256
    timeout: 120
    code: ./src/functions/payment
    environmentVariables:
      DB_HOST: "..."
      DB_NAME: "..."
      DB_USER: "..."
      DB_PASS: ${env(DB_PASS)}
      DB_SSL: "false"
      TZ: "Asia/Shanghai"
      PAYMENT_CALLBACK_BASE_URL: ${env(PAYMENT_CALLBACK_BASE_URL)}
    triggers:
      - triggerName: payment-http
        triggerType: http
        triggerConfig:
          authType: anonymous
          methods: ["GET", "POST", "OPTIONS"]
      - triggerName: payment-refund-poll
        triggerType: timer
        triggerConfig:
          payload: "refund_poll"
          cronExpression: "0 */5 * * * *"
          enable: true
```

HTTP trigger may be anonymous at FC level because provider callbacks cannot send Nano auth tokens. Application-level route authentication must still protect non-callback endpoints.

## Open Implementation Decisions

- Whether the existing `orders` table remains the business order table or gets replaced by a richer commerce order model.
- Whether provider credentials in `payment_providers.config` should be encrypted column-by-column or replaced with KMS references before production rollout.
- Whether payment success emits EventBridge events for commissions, fulfillment, or notifications.
