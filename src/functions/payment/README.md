# Payment Function Design

`src/functions/payment` is a dedicated Aliyun FC 3.0 Node.js function for universal payment integration.

The function exposes one stable payment API to Nano clients while hiding provider-specific details behind adapters. Current providers are WeCom Pay, WeChat Pay, and Alipay. Later providers can include UnionPay and credit card gateways without changing client-facing route contracts.

Provider credentials are loaded from `payment_providers.config` in the database. Each provider has an admin default row (`scope = 'admin'`, `institution_id IS NULL`) and can have institution-specific rows (`scope = 'institution'`, `institution_id = ...`) that override the default for payments created with that institution ID.

Documents in this directory:

- [payment-architecture.md](./payment-architecture.md) - architecture, provider adapter contract, lifecycle, persistence model, FC 3.0 triggers, and operational rules.
- [payment-api.md](./payment-api.md) - HTTP endpoint contracts for order creation, refund creation, callbacks, status polling, and refund polling.

Implemented runtime files:

- `index.js` - FC 3.0 handler, HTTP routes, timer refund polling.
- `lib/db.js` - Postgres pool for FC warm-container reuse.
- `lib/adapters/index.js` - provider adapter registry.
- `lib/adapters/wecom.js` - WeCom Pay adapter using the WeChat Pay API v3 protocol.
- `lib/adapters/wechat.js` - WeChat Pay adapter using API v3 or legacy v2 XML mode.
- `lib/adapters/alipay.js` - Alipay OpenAPI adapter using RSA2 gateway signing.
- `lib/adapters/template.js` - commented template for future providers.

Deployment is configured through the `payment` resources in root `s.yaml` and `s-prod.yaml`.
