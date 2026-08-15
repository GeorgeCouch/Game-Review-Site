-- User lists (favorites, top 10s, themed lists)
CREATE TABLE IF NOT EXISTS lists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  description TEXT DEFAULT '',
  is_ranked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS list_items (
  id SERIAL PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL,
  title VARCHAR(255),
  cover_url TEXT,
  position INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (list_id, game_id)
);

CREATE INDEX IF NOT EXISTS lists_user_idx ON lists (user_id);
CREATE INDEX IF NOT EXISTS list_items_list_idx ON list_items (list_id);
