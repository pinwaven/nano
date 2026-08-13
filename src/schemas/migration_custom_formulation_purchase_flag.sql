-- Set by GCN (via POST /api/formulation-purchase-confirmed, GCN-service-token gated) the moment
-- a user's first custom-formulation order is confirmed paid. Nano has no visibility into GCN's
-- orders table otherwise — this one nullable timestamp is the entire cross-repo signal needed to
-- gate the "your formula was just refreshed, reorder?" notification (see handlers/dots.js's
-- handleNutritionTopupEvent) without querying GCN synchronously from a background job.
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_formulation_purchased_at TIMESTAMPTZ;
