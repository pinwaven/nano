-- Add chip_id column to scans table for efficient Kino device result lookup
ALTER TABLE scans ADD COLUMN IF NOT EXISTS chip_id TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scans_chip_id ON scans(chip_id) WHERE chip_id IS NOT NULL;
