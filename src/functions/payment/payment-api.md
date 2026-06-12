# Universal Payment API

All endpoints are served by the future `src/functions/payment` FC 3.0 function.

Base path:

```text
/payment
```

Response body uses this envelope for client-facing APIs:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

Error response:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "PAYMENT_INVALID_REQUEST",
    "message": "amount_minor must be greater than 0",
    "request_id": "req_abc"
  }
}
```

Provider callback responses may use provider-specific acknowledgement bodies when required.

## Create Payment Order

```text
POST /payment/orders
```

Creates a provider payment order and returns scene-specific client payment data.

Headers:

| Header | Required | Notes |
|---|---:|---|
| `Authorization` | Yes | Nano user/admin auth token |
| `Idempotency-Key` | Yes | Prevents duplicate provider orders |
| `Content-Type: application/json` | Yes | JSON request |

Request:

```json
{
  "business_order_id": "0e4d6b36-f03d-4d4e-a5d2-87f9eac15530",
  "user_id": "u_10001",
  "provider": "wecom",
  "institution_id": "clinic_001",
  "scene": "mini_program",
  "currency": "CNY",
  "amount_minor": 29800,
  "subject": "Kino 生物标志物检测芯片",
  "description": "1 片",
  "client_ip": "203.0.113.10",
  "openid": "wx_openid_or_wecom_user_id",
  "expires_in_seconds": 1800,
  "metadata": {
    "item_key": "kino-chip-1",
    "quantity": 1
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "payment_order": {
      "id": "pay_8c8c73f6",
      "business_order_id": "0e4d6b36-f03d-4d4e-a5d2-87f9eac15530",
      "provider": "wecom",
      "scene": "mini_program",
      "currency": "CNY",
      "amount_minor": 29800,
      "status": "pending",
      "expires_at": "2026-05-26T12:30:00+08:00"
    },
    "payment_payload": {
      "type": "mini_program",
      "appId": "wx123",
      "timeStamp": "1779768000",
      "nonceStr": "nonce",
      "package": "prepay_id=wx_pre_123",
      "signType": "RSA",
      "paySign": "signature"
    }
  },
  "error": null
}
```

Validation rules:

- `amount_minor` must be a positive integer.
- `currency` defaults to `CNY` but must be explicit in persisted records.
- `provider` must be active in `payment_providers`.
- `institution_id` is optional. When present, the payment service uses that institution's active provider config and falls back to the admin default provider config when no institution config exists.
- `scene` must be supported by the selected provider. Supported payment scenes include `mini_program`, `web`, `app`, and `qr_code`.
- `Idempotency-Key` is mandatory.

For user-scan QR code payment, set `scene` to `qr_code`. The response returns a provider QR URL for the frontend to render as an image:

```json
{
  "payment_payload": {
    "type": "qr_code",
    "qr_code_url": "weixin://wxpay/bizpayurl?pr=..."
  }
}
```

## Test Provider Config

```text
POST /payment/providers/test
```

Validates a submitted provider configuration before saving it to `payment_providers`.

Default behavior is local-only validation: it does not write to the database, does not create a payment order, and does not create a real refund. Refund capability means the adapter can locally verify that refund-required signing keys, callback verification material, and refund callback URL are present.

When an admin needs stronger verification, the endpoint can optionally call the provider:

- `test_payment: true` creates a provider-side unpaid test payment order and returns whether the provider accepted the order. The Nano database is not written, and no customer is charged unless a client actively pays the returned provider payload.
- `test_refund: true` may issue a real provider refund. It requires `allow_real_refund: true`, `refund_test.provider_trade_no`, and `refund_test.amount_minor`. Use only with a known paid test transaction.

Request:

```json
{
  "provider": "wechat",
  "merchant_id": "1900000001",
  "institution_id": "clinic_001",
  "config": {
    "appid": "wx_app_id",
    "api_base_url": "https://api.mch.weixin.qq.com",
    "notify_url": "https://example.com/payment/callbacks/wechat/payment",
    "refund_notify_url": "https://example.com/payment/callbacks/wechat/refund",
    "merchant_serial_no": "cert_serial",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
    "api_v3_key": "32-byte-api-v3-key",
    "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  },
  "test_payment": true,
  "scene": "mini_program",
  "amount_minor": 1,
  "subject": "Nano payment config test"
}
```

Legacy WeChat Pay v2-compatible configs can omit v3 serial/API-v3/public-key fields and use the AppClient material plus AppKey:

```json
{
  "provider": "wechat",
  "merchant_id": "1900000001",
  "config": {
    "appid": "wx_app_id",
    "api_base_url": "https://api.mch.weixin.qq.com",
    "notify_url": "https://example.com/payment/callbacks/wechat/payment",
    "app_key": "wechat-pay-v2-app-key",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
    "appclient_cert": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "provider": "wechat",
    "valid": true,
    "refund_supported": true,
    "checks": [
      { "key": "merchant_id", "ok": true },
      { "key": "private_key", "ok": true },
      { "key": "refund_capability", "ok": true }
    ],
    "payment_test": {
      "attempted": true,
      "ok": true,
      "status": "pending",
      "provider_trade_no": "wx_pre_123",
      "payment_payload_type": "mini_program",
      "payment_payload": {
        "type": "mini_program",
        "package": "prepay_id=wx_pre_123"
      }
    }
  },
  "error": null
}
```

For `scene: "qr_code"`, `payment_test.payment_payload.qr_code_url` is returned so the admin UI can render a QR code for manual scan testing.

Explicit refund test request:

```json
{
  "provider": "wechat",
  "merchant_id": "1900000001",
  "config": {
    "appid": "wx_app_id"
  },
  "test_refund": true,
  "allow_real_refund": true,
  "refund_test": {
    "provider_trade_no": "known_paid_provider_transaction",
    "amount_minor": 1,
    "total_amount_minor": 1,
    "reason": "payment_config_refund_test"
  }
}
```

## Get Payment Order

```text
GET /payment/orders/:id?sync_provider=false
```

Returns local payment status. When `sync_provider=true`, the server may query the provider before responding if the local status is non-terminal.

Response:

```json
{
  "success": true,
  "data": {
    "payment_order": {
      "id": "pay_8c8c73f6",
      "business_order_id": "0e4d6b36-f03d-4d4e-a5d2-87f9eac15530",
      "provider": "wecom",
      "scene": "mini_program",
      "currency": "CNY",
      "amount_minor": 29800,
      "status": "paid",
      "paid_at": "2026-05-26T12:01:33+08:00",
      "refunded_amount_minor": 0
    }
  },
  "error": null
}
```

## Query Payment by Business Order

```text
GET /payment/orders/by-business/:business_order_id
```

Returns the latest payment order for a business order. This is useful for store order pages that do not know the payment order ID.

Response:

```json
{
  "success": true,
  "data": {
    "payment_order": {
      "id": "pay_8c8c73f6",
      "business_order_id": "0e4d6b36-f03d-4d4e-a5d2-87f9eac15530",
      "provider": "wecom",
      "scene": "mini_program",
      "status": "pending"
    }
  },
  "error": null
}
```

## Close Payment Order

```text
POST /payment/orders/:id/close
```

Closes a pending payment order. This is an admin/server operation, not a normal user action.

Request:

```json
{
  "reason": "user_cancelled_checkout"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "payment_order": {
      "id": "pay_8c8c73f6",
      "status": "closed"
    }
  },
  "error": null
}
```

## Create Refund

```text
POST /payment/refunds
```

Creates a full or partial refund.

Headers:

| Header | Required | Notes |
|---|---:|---|
| `Authorization` | Yes | Admin/server auth token |
| `Idempotency-Key` | Yes | Prevents duplicate refunds |
| `Content-Type: application/json` | Yes | JSON request |

Request:

```json
{
  "payment_order_id": "pay_8c8c73f6",
  "business_order_id": "0e4d6b36-f03d-4d4e-a5d2-87f9eac15530",
  "amount_minor": 29800,
  "reason": "customer_requested_refund",
  "metadata": {
    "operator_id": "admin_001"
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "refund": {
      "id": "rf_5d5165e0",
      "payment_order_id": "pay_8c8c73f6",
      "amount_minor": 29800,
      "status": "pending",
      "next_poll_at": "2026-05-26T12:10:00+08:00"
    }
  },
  "error": null
}
```

Validation rules:

- Payment order must be `paid`, `partially_refunded`, or `refunding`.
- Sum of successful and pending refunds must not exceed paid amount.
- `Idempotency-Key` is mandatory.
- Refund creator must have refund permission.

## Get Refund

```text
GET /payment/refunds/:id?sync_provider=false
```

Returns local refund status. When `sync_provider=true`, the server may query the provider before responding if the refund is non-terminal.

Response:

```json
{
  "success": true,
  "data": {
    "refund": {
      "id": "rf_5d5165e0",
      "payment_order_id": "pay_8c8c73f6",
      "amount_minor": 29800,
      "status": "succeeded",
      "succeeded_at": "2026-05-26T12:08:20+08:00"
    }
  },
  "error": null
}
```

## List Refunds for Payment

```text
GET /payment/orders/:id/refunds
```

Response:

```json
{
  "success": true,
  "data": {
    "refunds": [
      {
        "id": "rf_5d5165e0",
        "amount_minor": 29800,
        "status": "succeeded",
        "created_at": "2026-05-26T12:05:00+08:00"
      }
    ]
  },
  "error": null
}
```

## Payment Callback

```text
POST /payment/callbacks/:provider/payment
```

Provider payment notification endpoint. This endpoint must be reachable without Nano user auth because providers cannot include Nano auth headers.

Route examples:

```text
POST /payment/callbacks/wecom/payment
POST /payment/callbacks/wechat/payment
POST /payment/callbacks/alipay/payment
```

Processing requirements:

- Use raw request body for signature verification.
- Verify provider signature before trusting any field.
- Store callback event whether processing succeeds or fails.
- Apply idempotent status transition.
- Return provider-specific success acknowledgement.

Generic success response for providers that accept JSON:

```json
{
  "code": "SUCCESS",
  "message": "OK"
}
```

## Refund Callback

```text
POST /payment/callbacks/:provider/refund
```

Provider refund notification endpoint.

Processing requirements:

- Use same raw-body and signature verification rules as payment callbacks.
- Match refund by provider refund number or local refund number.
- Apply idempotent refund status transition.
- Recalculate aggregate payment refund status.
- Return provider-specific success acknowledgement.

Generic success response:

```json
{
  "code": "SUCCESS",
  "message": "OK"
}
```

## Manual Refund Poll

```text
POST /payment/refunds/:id/poll
```

Admin/server endpoint to immediately query provider refund status and update local state.

Response:

```json
{
  "success": true,
  "data": {
    "refund": {
      "id": "rf_5d5165e0",
      "status": "succeeded",
      "last_polled_at": "2026-05-26T12:08:20+08:00"
    }
  },
  "error": null
}
```

## Cron Refund Poll

Timer trigger invokes the same refund polling service without HTTP routing.

Selection:

```sql
SELECT *
FROM payment_refunds
WHERE status IN ('created', 'pending')
  AND next_poll_at <= NOW()
ORDER BY next_poll_at ASC
LIMIT 100;
```

Each selected refund:

1. Locks the refund row.
2. Calls `adapter.queryRefund()`.
3. Applies a normalized status transition.
4. Updates `last_polled_at`.
5. Sets `next_poll_at` using backoff if the refund remains non-terminal.

## Error Codes

| Code | HTTP | Meaning |
|---|---:|---|
| `PAYMENT_INVALID_REQUEST` | 400 | Request body or query is invalid |
| `PAYMENT_UNAUTHORIZED` | 401 | Missing or invalid auth |
| `PAYMENT_FORBIDDEN` | 403 | Caller lacks permission |
| `PAYMENT_NOT_FOUND` | 404 | Payment order or refund not found |
| `PAYMENT_CONFLICT` | 409 | Idempotency or state transition conflict |
| `PAYMENT_PROVIDER_UNAVAILABLE` | 502 | Provider request failed or timed out |
| `PAYMENT_CALLBACK_INVALID_SIGNATURE` | 401 | Callback signature verification failed |
| `PAYMENT_INTERNAL_ERROR` | 500 | Unexpected server error |

## Client Polling Guidance

For checkout clients:

- Poll `GET /payment/orders/:id` every 2 seconds for the first 30 seconds.
- Then poll every 5 seconds until the payment expires.
- Stop polling once status is `paid`, `expired`, `closed`, or `failed`.
- Use `sync_provider=true` sparingly because it may call the provider and increase latency.

For refund status in admin tools:

- Prefer local status from `GET /payment/refunds/:id`.
- Use manual poll only when the operator needs immediate reconciliation.
- Cron polling is the default path for pending refunds.
