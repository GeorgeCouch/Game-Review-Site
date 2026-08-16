-- Phase 4: Likes on reviews

CREATE TABLE IF NOT EXISTS likes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, review_id)
);

CREATE INDEX IF NOT EXISTS likes_review_idx ON likes (review_id);
CREATE INDEX IF NOT EXISTS likes_user_idx ON likes (user_id);
