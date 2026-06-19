-- Backfill bio_data.height and bio_data.weight for users who provided them during
-- onboarding (stored in biomarkers as test_type='body_composition') but whose
-- users.bio_data never received the values because save_target was 'biomarker'.
-- Uses the most recent body_composition record per user.

UPDATE users u
SET
    bio_data      = bio_data
                    || CASE WHEN (latest.data->'actual'->>'height') IS NOT NULL
                            THEN jsonb_build_object('height', (latest.data->'actual'->>'height')::numeric)
                            ELSE '{}'::jsonb END
                    || CASE WHEN (latest.data->'actual'->>'weight') IS NOT NULL
                            THEN jsonb_build_object('weight', (latest.data->'actual'->>'weight')::numeric)
                            ELSE '{}'::jsonb END,
    updated_at    = CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (user_id)
        user_id,
        data
    FROM biomarkers
    WHERE test_type = 'body_composition'
      AND (data->'actual'->>'height' IS NOT NULL OR data->'actual'->>'weight' IS NOT NULL)
    ORDER BY user_id, tested_at DESC
) latest
WHERE u.user_id = latest.user_id
  AND (u.bio_data->>'height' IS NULL OR u.bio_data->>'weight' IS NULL);
