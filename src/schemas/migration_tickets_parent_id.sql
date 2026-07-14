-- Sub-tickets: a ticket can have multiple child tickets (one level deep).
ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tickets_parent_id ON tickets(parent_id);
