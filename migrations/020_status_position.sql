-- Position for ordering status shelves like lists
ALTER TABLE game_statuses ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS game_statuses_user_status_pos_idx
  ON game_statuses (user_id, status, position ASC NULLS LAST);
