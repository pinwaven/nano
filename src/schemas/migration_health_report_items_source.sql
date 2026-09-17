-- @requires: migration_health_report_items.sql
--
-- Contract version 3 (CLAUDE.md §39): where a printed row came from, and what the agent thinks
-- an unmapped one might be.
--
-- source_ref — "s0.t0.r3" (section 0, table 0, row 3) or "s2.p1" (section 2, pair 1) into the
-- document's `structured` block. Lets the miniapp show the user the row a value was read from,
-- and lets lib/repromotion.js re-read the cell — with its column context — when the catalog
-- grows, without re-reading the file.
--
-- suggested_key / suggested_confidence — the agent's guess at a catalog key for an UNMAPPED row.
-- Stored for review and for re-promotion, NEVER promoted automatically and never rendered as the
-- catalog marker's name: a wrong key is a plausible number in the wrong marker of a person's
-- twin, and nothing downstream can tell. This column is the one place a model's guess about a
-- key exists in the record, and it stays a guess.
ALTER TABLE health_report_items
    ADD COLUMN IF NOT EXISTS source_ref           TEXT,
    ADD COLUMN IF NOT EXISTS suggested_key        TEXT,
    ADD COLUMN IF NOT EXISTS suggested_confidence NUMERIC(4,3);
