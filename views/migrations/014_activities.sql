CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40),
  entity_id INTEGER,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS activities_created_idx ON activities (created_at DESC);
CREATE INDEX IF NOT EXISTS activities_actor_idx ON activities (actor_id, created_at DESC);
