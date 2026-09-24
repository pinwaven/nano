-- Custom avatars: a user uploads a photo and the worker generates a personal 4-mood set in the
-- gallery's art style (docs/architecture/avatar-gallery.md §6).
--
-- One row per generation attempt. The uploaded photo lives in OSS only for the job's lifetime —
-- source_oss_key is NULLed once the object is deleted (success, failure and rejection alike), so
-- a row never points at a face photo for longer than the job runs. mood_keys are the kept
-- outputs; the 10-year URLs the client renders are minted on read, never stored here.
CREATE TABLE IF NOT EXISTS avatar_generations (
    id             BIGSERIAL PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    -- pending (queued) | running | done | failed | rejected (the gate refused the photo)
    status         TEXT NOT NULL DEFAULT 'pending',
    -- 'avatar-uploads/<user_id>/<hex>.jpg' while the job runs; NULL after deletion.
    source_oss_key TEXT,
    -- {"engaged": "<oss key>", "relaxed": "...", "restored": "...", "stressed": "...", "thumb": "..."}
    mood_keys      JSONB,
    -- no_face | multiple_faces | not_a_photo | not_frontal | gen_failed | store_failed
    error_code     TEXT,
    -- The exact event id published to EventBridge; lets a stuck 'running' row be traced.
    event_id       TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at     TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ
);

-- One in-flight generation per user. This index, not application code, is what stops a double
-- tap (or a retried request) from spending two sets of image calls.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_avatar_generations_active
    ON avatar_generations (user_id) WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS idx_avatar_generations_user_created
    ON avatar_generations (user_id, created_at DESC);

-- The applied custom set: {"engaged": url, "relaxed": url, "restored": url, "stressed": url, "thumb": url}
-- (10-year presigned URLs, the same convention as avatar_url and the gallery manifest).
-- Only meaningful while avatar_character = 'custom'; picking a gallery character clears it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_moods JSONB;
