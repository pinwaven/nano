-- Nano AI Backend Database Schema
-- Optimized for Aliyun FC 3.0 and PostgreSQL (No ORM)

-- Enable extension for UUIDs if needed (optional)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    wechat_openid TEXT UNIQUE NOT NULL,
    nickname TEXT,
    avatar_url TEXT,
    gender TEXT,
    birth_date DATE,
    bio_data JSONB DEFAULT '{}'::jsonb, -- Flexible storage for height, weight, body_fat, etc.
    preferences JSONB DEFAULT '{}'::jsonb, -- AI persona, interest tags, etc.
    last_scanned_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scan Logs (Track scanner activity)
CREATE TABLE IF NOT EXISTS scans (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    scan_status TEXT NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
    scan_results JSONB, -- Raw data extracted or AI input context
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Notification History
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL,
    notification_type TEXT NOT NULL DEFAULT 'wechat',
    content TEXT NOT NULL,
    status TEXT NOT NULL, -- 'sent', 'failed'
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_users_wechat_openid ON users(wechat_openid);
CREATE INDEX idx_scans_user_id ON scans(user_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);

-- Trigger to update 'updated_at' on users
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
