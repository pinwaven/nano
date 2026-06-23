-- Rename biomarkers.data->'estimated' to data->'validated'
-- The 'estimated' field held validated biomarker values (either the submitted value if it
-- passed range checks, or a model-generated replacement if it did not). 'validated' is more
-- accurate because every value — whether accepted as-is or replaced — went through the
-- BiomarkerEstimator validation gate. This rename also removes confusion in LLM contexts
-- where 'estimated' implies approximation rather than authoritative source.

UPDATE biomarkers
SET data = (data - 'estimated') || jsonb_build_object('validated', data->'estimated')
WHERE data ? 'estimated';
