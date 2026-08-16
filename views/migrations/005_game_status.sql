-- Want to Play / Playing / Played statuses
CREATE TABLE IF NOT EXISTS game_statuses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('want', 'playing', 'played')),
  title VARCHAR(255),
  cover_url TEXT,
  released DATE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS game_statuses_user_idx ON game_statuses (user_id);
CREATE INDEX IF NOT EXISTS game_statuses_status_idx ON game_statuses (user_id, status);
