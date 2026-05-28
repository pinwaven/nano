CREATE TABLE IF NOT EXISTS payment_providers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider       TEXT NOT NULL,
    merchant_id    TEXT NOT NULL,
    institution_id TEXT,
    scope          TEXT NOT NULL DEFAULT 'admin' CHECK (scope IN ('admin', 'institution')),
    label          TEXT,
    config         JSONB NOT NULL DEFAULT '{}'::jsonb,
    secret_ref     TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, merchant_id),
    CONSTRAINT payment_providers_scope_institution_chk CHECK (
        (scope = 'admin' AND institution_id IS NULL)
        OR (scope = 'institution' AND institution_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_providers_admin_default_uidx
    ON payment_providers (provider)
    WHERE scope = 'admin' AND institution_id IS NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS payment_providers_institution_idx
    ON payment_providers (provider, institution_id)
    WHERE scope = 'institution' AND is_active = TRUE;

CREATE TABLE IF NOT EXISTS payment_orders (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_order_id    UUID NOT NULL,
    user_id              VARCHAR(100) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    institution_id       TEXT,
    provider             TEXT NOT NULL,
    provider_account_id  UUID REFERENCES payment_providers(id),
    scene                TEXT NOT NULL CHECK (scene IN ('web', 'app', 'mini_program')),
    currency             TEXT NOT NULL DEFAULT 'CNY',
    amount_minor         INTEGER NOT NULL CHECK (amount_minor > 0),
    subject              TEXT NOT NULL,
    description          TEXT,
    status               TEXT NOT NULL DEFAULT 'created',
    client_ip            INET,
    idempotency_key      TEXT NOT NULL,
    provider_trade_no    TEXT,
    provider_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    payment_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    paid_at              TIMESTAMPTZ,
    expires_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_order_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_trade_no_uidx
    ON payment_orders (provider, provider_trade_no)
    WHERE provider_trade_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_orders_user_created_idx
    ON payment_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_orders_status_expires_idx
    ON payment_orders (status, expires_at);

CREATE TABLE IF NOT EXISTS payment_refunds (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_order_id     UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    business_order_id    UUID NOT NULL,
    provider             TEXT NOT NULL,
    provider_account_id  UUID REFERENCES payment_providers(id),
    refund_no            TEXT NOT NULL,
    provider_refund_no   TEXT,
    amount_minor         INTEGER NOT NULL CHECK (amount_minor > 0),
    reason               TEXT,
    status               TEXT NOT NULL DEFAULT 'created',
    idempotency_key      TEXT NOT NULL,
    provider_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_polled_at       TIMESTAMPTZ,
    next_poll_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    succeeded_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (payment_order_id, refund_no),
    UNIQUE (payment_order_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_provider_refund_no_uidx
    ON payment_refunds (provider, provider_refund_no)
    WHERE provider_refund_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_refunds_status_poll_idx
    ON payment_refunds (status, next_poll_at);

CREATE TABLE IF NOT EXISTS payment_callback_events (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider             TEXT NOT NULL,
    event_type           TEXT NOT NULL CHECK (event_type IN ('payment', 'refund')),
    event_id             TEXT,
    provider_trade_no    TEXT,
    provider_refund_no   TEXT,
    headers              JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_body             TEXT NOT NULL,
    verified             BOOLEAN NOT NULL DEFAULT FALSE,
    process_status       TEXT NOT NULL DEFAULT 'received',
    error                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_callback_events_provider_event_uidx
    ON payment_callback_events (provider, event_id)
    WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_callback_events_trade_idx
    ON payment_callback_events (provider, provider_trade_no);

CREATE INDEX IF NOT EXISTS payment_callback_events_status_created_idx
    ON payment_callback_events (process_status, created_at);
