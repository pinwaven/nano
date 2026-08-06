-- health_events.wearable_name: the bound device's display name (e.g. "X3B 53687"),
-- attached to every event synced from a wearable. `source` is brand-agnostic
-- ('smart_ring' for every ring brand — Halo, V8, Colmi, Aizo all share it), so
-- this is the only per-row way to trace historical data back to which physical
-- device synced it. NULL for non-wearable sources (lab_api, manual_photo, etc).

ALTER TABLE health_events ADD COLUMN IF NOT EXISTS wearable_name TEXT;
