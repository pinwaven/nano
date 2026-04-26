-- Kino chip batches: groups of disposable single-use test chips
CREATE TABLE IF NOT EXISTS kino_chip_batches (
    id SERIAL PRIMARY KEY,
    prefix TEXT UNIQUE NOT NULL,          -- e.g. KC24A  (auto-uppercased)
    model TEXT NOT NULL,                   -- e.g. K1, S2
    quantity INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Individual chips generated from a batch
CREATE TABLE IF NOT EXISTS kino_chips (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES kino_chip_batches(id) ON DELETE CASCADE,
    chip_code TEXT UNIQUE NOT NULL,        -- e.g. KC24A-0001  (this IS the QR code value)
    status TEXT DEFAULT 'available',       -- 'available', 'used', 'damaged'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kino_chips_batch_id  ON kino_chips(batch_id);
CREATE INDEX IF NOT EXISTS idx_kino_chips_chip_code ON kino_chips(chip_code);
