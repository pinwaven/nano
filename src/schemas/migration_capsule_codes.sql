-- One QR code per capsule, printed on the 27 mm foil lid of each of a plan's 56 capsules
-- (28 days × AM/PM). The user scans a capsule in the app before taking it; the server confirms it
-- is theirs, today's, and for the current slot — or blocks it. The outside-of-box WVB code is
-- unchanged and still claims the box (which starts the cycle).
--
-- Keyed by plan + (day_index, slot), not by date: codes are minted (lazily, when the supplier
-- prints the sheet) before the box is claimed, and start_date only becomes real at claim time.
-- The plan id survives activation (_activateProposedPlan / _commitAgFormulation update the row
-- in place), so a code minted on a proposed/approved plan still resolves after the scan.
--
-- code is random (WVC + 10 Crockford base32), never sequential: one scanned foil must not let
-- anyone enumerate the other 55.

CREATE TABLE IF NOT EXISTS capsule_codes (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    plan_id INTEGER NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
    day_index SMALLINT NOT NULL CHECK (day_index BETWEEN 1 AND 28),
    slot TEXT NOT NULL CHECK (slot IN ('AM', 'PM')),
    taken_at TIMESTAMPTZ,
    taken_by TEXT,                      -- user_id of whoever scanned: the owner, or their coach (managed customers)
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (plan_id, day_index, slot)
);
