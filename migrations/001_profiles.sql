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
