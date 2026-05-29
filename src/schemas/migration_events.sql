CREATE TABLE IF NOT EXISTS events (
  id           SERIAL PRIMARY KEY,
  channel_id   INT REFERENCES channels(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  location     TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  end_at       TIMESTAMPTZ,
  capacity     INT,
  status       TEXT NOT NULL DEFAULT 'active',
  created_by   TEXT REFERENCES users(user_id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_signups (
  id           SERIAL PRIMARY KEY,
  event_id     INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(user_id),
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status       TEXT NOT NULL DEFAULT 'confirmed',
  UNIQUE(event_id, user_id)
);
