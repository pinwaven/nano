-- The formulation's own `WVB…` code, minted when the formula is generated.
--
-- It is the single identifier for one formulation across its whole life: the QR the user can view
-- as soon as the formula exists, the label printed on the box that is compounded from it, and the
-- code the Mini Program scans to activate the plan when the box arrives. Before this, the code was
-- minted at box-batch time (`boxes.box_code`), which is far too late to show anyone — the user
-- would have no way to see what they were about to receive, and nothing to track an order by.
--
-- Same `WVB` + 12-hex shape as boxes.box_code, and deliberately the SAME code space: the box row
-- created for a plan reuses the plan's value rather than minting its own, so a scan resolves to
-- exactly one formulation. lib/labelCode.js checks both tables when generating, because a
-- collision across them would mean a scan landing on someone else's capsules.
--
-- Minting it does NOT mean anything is claimable. A scan still resolves through `boxes` /
-- `box_batches`, which only exist once someone actually compounds a batch — so scanning the QR of
-- a formulation that was never manufactured returns 'box_not_found' rather than activating a plan
-- for capsules the user does not have.
--
-- @requires: migration_nutrition_plans_proposed.sql

ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS label_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_nutrition_plans_label_code
    ON nutrition_plans (label_code) WHERE label_code IS NOT NULL;
