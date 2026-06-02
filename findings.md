# Payment Interface Documentation Findings

## Repository Context

- `src/functions/payment` exists and is currently empty.
- Existing FC 3.0 functions use `runtime: nodejs20`, `handler: index.handler`, HTTP triggers, timer triggers, VPC config, and JSON logs.
- `src/functions/lab` is the closest architectural reference: it supports HTTP webhook ingestion and timer polling, uses an adapter registry, stores external order state, and treats timer events separately from HTTP events.
- Existing store schema has `store_items` and a simple `orders` table with `pending` status, but it does not yet model payment attempts, provider transactions, refunds, webhook events, or idempotency records.

## Design Implications

- Payment needs its own state tables instead of overloading the existing simple `orders` table.
- Provider-specific code should live behind adapters so WeCom is first-class now and WeChat Pay, Alipay, UnionPay, and cards can be added without changing route-level code.
- Callback verification and idempotency must be core requirements because payment and refund callbacks can be retried or arrive out of order.
- Refund polling should be a timer-triggered compensating flow, separate from payment status polling.
