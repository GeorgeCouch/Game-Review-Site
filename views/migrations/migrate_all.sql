-- GameCouch full schema for Railway (run once on empty Postgres)

-- ========== 000_base_schema.sql ==========
-- Base schema for a fresh database (run FIRST on Railway)

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  username VARCHAR(30) UNIQUE,
  display_name VARCHAR(100),
  bio TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  game_id INTEGER,
  title TEXT,
  completed TEXT,
  rating TEXT,
  notes TEXT,
  released TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS games_user_id_idx ON games (user_id);
CREATE INDEX IF NOT EXISTS comments_review_id_idx ON comments (review_id);

-- ========== 001_profiles.sql ==========
-- Phase 1: User Profiles
-- Run this against your gamereviews database

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username VARCHAR(30) UNIQUE,
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Helpful index for case-insensitive lookups
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));

-- Optional: give existing users a temporary username based on email prefix
-- (they can change it later in Edit Profile)
UPDATE users
SET username = LOWER(REGEXP_REPLACE(SPLIT_PART(email, '@', 1), '[^a-z0-9_]', '', 'g'))
WHERE username IS NULL
  AND email IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(SPLIT_PART(email, '@', 1), '[^a-z0-9_]', '', 'g')) >= 3;

-- Make sure display_name has something
UPDATE users
SET display_name = COALESCE(display_name, username, SPLIT_PART(email, '@', 1))
WHERE display_name IS NULL;

-- ========== 002_follows.sql ==========
-- Phase 2: Follow system

CREATE TABLE IF NOT EXISTS follows (
  id SERIAL PRIMARY KEY,
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (follower_id, following_id),
  CHECK (follower_id != following_id)
);

CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows (follower_id);
CREATE INDEX IF NOT EXISTS follows_following_idx ON follows (following_id);

-- ========== 003_likes.sql ==========
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

-- ========== 004_cover_url.sql ==========
-- Store cover image URL on reviews so we don't need to re-fetch from external APIs
ALTER TABLE games ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- ========== 005_game_status.sql ==========
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

-- ========== 006_lists.sql ==========
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

-- ========== 007_twitch_username.sql ==========
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_username VARCHAR(50);

-- ========== 008_social_links.sql ==========
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_username VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS youtube_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_username VARCHAR(50);

-- ========== 009_achievements.sql ==========
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id VARCHAR(50) NOT NULL,
  unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS user_achievements_user_idx ON user_achievements (user_id);

-- ========== 010_notifications.sql ==========
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type VARCHAR(30) NOT NULL,
  entity_type VARCHAR(30),
  entity_id INTEGER,
  message TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read, created_at DESC);

-- ========== 011_xp_ledger.sql ==========
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_xp INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_title VARCHAR(80);

CREATE TABLE IF NOT EXISTS xp_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS xp_events_user_day_idx
  ON xp_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS xp_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- ========== 012_admin_moderation.sql ==========
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type VARCHAR(30) NOT NULL, -- review | user | comment
  target_id INTEGER NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'open', -- open | resolved | dismissed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at DESC);

-- ========== 013_blocks.sql ==========
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);

-- ========== 014_activities.sql ==========
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

-- ========== 015_push_subscriptions.sql ==========
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

-- ========== 016_spoilers.sql ==========
ALTER TABLE games ADD COLUMN IF NOT EXISTS has_spoilers BOOLEAN DEFAULT FALSE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS has_spoilers BOOLEAN DEFAULT FALSE;
