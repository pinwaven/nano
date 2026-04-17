-- Nano AI Backend Database Schema
-- Optimized for Aliyun FC 3.0 and PostgreSQL (No ORM)

-- Enable extension for UUIDs if needed (optional)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- PHMs Table
CREATE TABLE IF NOT EXISTS phms (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,   -- Short 7-char hex ID (e.g. 'a3f2c1d'), generated on insert
    external_id TEXT UNIQUE,    -- ID used by the external app (e.g. WeChat openid, WhatsApp number)
    external_app TEXT,          -- Which external app: 'wechat', 'whatsapp', 'wavenapp'
    phm_id INTEGER REFERENCES phms(id) ON DELETE SET NULL,
    nickname TEXT,
    avatar_url TEXT,
    gender TEXT,
    birth_date DATE,
    language TEXT DEFAULT 'zh',
    bio_data JSONB DEFAULT '{}'::jsonb,
    preferences JSONB DEFAULT '{}'::jsonb,
    last_scanned_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id);

-- Biomarkers Table (Time-series data for trend analysis)
CREATE TABLE IF NOT EXISTS biomarkers (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    test_type TEXT NOT NULL, -- e.g., 'body_composition', 'blood_glucose', 'heart_rate', 'kino_chip'
    data JSONB NOT NULL, -- e.g., {"actual": {...}, "estimated": {...}, "context": "..."}
    bio_age FLOAT, -- Calculated biological age
    tested_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for trend analysis
CREATE INDEX idx_biomarkers_user_id_tested_at ON biomarkers(user_id, tested_at DESC);
CREATE INDEX idx_biomarkers_test_type ON biomarkers(test_type);

-- Nutrition Plans (14-day blocks)
CREATE TABLE IF NOT EXISTS nutrition_plans (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    biomarker_scan_id INTEGER, -- Link to the analysis that generated this plan
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    goal TEXT, -- e.g., 'Energy Boost', 'Recovery', 'Sleep Quality'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Nutrition Schedules (Specific "Waven Dots" receipts for each day/time)
CREATE TABLE IF NOT EXISTS nutrition_schedules (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER REFERENCES nutrition_plans(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    scheduled_date DATE NOT NULL,
    slot_name TEXT NOT NULL, -- e.g., 'morning_cup', 'evening_cup'
    recipe JSONB NOT NULL, -- e.g., {"dots": {"vitamin_c": 5, "magnesium": 2}, "benefit": "focus"}
    is_taken BOOLEAN DEFAULT FALSE,
    taken_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for plan lookups
CREATE INDEX idx_nutrition_plans_user_id ON nutrition_plans(user_id);
CREATE INDEX idx_nutrition_schedules_user_date ON nutrition_schedules(user_id, scheduled_date);

-- Dots Table (Waven Dots individual cartridges)
CREATE TABLE IF NOT EXISTS dots (
    id INTEGER PRIMARY KEY, -- 1 to 18
    key_name TEXT UNIQUE NOT NULL, -- DOT01 to DOT18
    name TEXT NOT NULL,
    name_zh TEXT, -- Chinese Name
    is_isolate BOOLEAN DEFAULT FALSE,
    color TEXT, -- Assigned Unique Color (English)
    color_zh TEXT, -- Assigned Unique Color (Chinese)
    ingredients JSONB, -- English Payload Breakdown
    ingredients_zh JSONB, -- Chinese Payload Breakdown
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scan Logs (Track scanner activity)
CREATE TABLE IF NOT EXISTS scans (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    scan_status TEXT NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
    scan_results JSONB, -- Raw data extracted or AI input context
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Notification History
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL,
    biomarker_id INTEGER REFERENCES biomarkers(id) ON DELETE SET NULL,
    notification_type TEXT NOT NULL DEFAULT 'wechat',
    content TEXT NOT NULL,
    status TEXT NOT NULL, -- 'sent', 'failed'
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_scans_user_id ON scans(user_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_biomarker_id ON notifications(biomarker_id);

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
