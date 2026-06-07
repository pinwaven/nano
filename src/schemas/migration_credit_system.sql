-- Credit ledger: immutable append-only log of all credit movements
CREATE TABLE IF NOT EXISTS credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(user_id),
    amount NUMERIC(12,2) NOT NULL,       -- positive = earn, negative = debit
    type TEXT NOT NULL,                   -- referral_commission | coach_commission | channel_commission | withdrawal | adjustment
    reference_id UUID,                    -- FK to source record (commission row, withdrawal row)
    reference_type TEXT,                  -- table name of the source
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_id ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_created_at ON credit_ledger(created_at);

-- Withdrawal requests: user requests cash payout of their credit balance
CREATE TABLE IF NOT EXISTS credit_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(user_id),
    credits_amount NUMERIC(12,2) NOT NULL,   -- credits to redeem
    currency_amount NUMERIC(12,2) NOT NULL,  -- cash value = credits / exchange_rate
    exchange_rate NUMERIC(10,4) NOT NULL,    -- snapshot of channel rate at request time
    currency TEXT NOT NULL DEFAULT 'CNY',    -- ISO currency code
    payment_method TEXT NOT NULL DEFAULT 'wechat_pay',
    payment_account TEXT,                    -- WeChat Pay openid / bank account
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | completed
    admin_note TEXT,
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processed_by TEXT                        -- admin user_id who actioned the request
);
CREATE INDEX IF NOT EXISTS idx_credit_withdrawals_user_id ON credit_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_withdrawals_status ON credit_withdrawals(status);
