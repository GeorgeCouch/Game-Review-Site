-- Store cover image URL on reviews so we don't need to re-fetch from external APIs
ALTER TABLE games ADD COLUMN IF NOT EXISTS cover_url TEXT;
