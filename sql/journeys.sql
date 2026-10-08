ALTER TABLE user_favorites ADD COLUMN IF NOT EXISTS collection text NOT NULL DEFAULT 'want';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='user_favorites'::regclass AND conname='favorites_collection_check') THEN
        ALTER TABLE user_favorites ADD CONSTRAINT favorites_collection_check CHECK (collection IN ('want','visited'));
    END IF;
END $$;
CREATE TABLE IF NOT EXISTS user_itineraries (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    title varchar(120) NOT NULL,
    days jsonb NOT NULL DEFAULT '[]',
    version integer NOT NULL DEFAULT 1,
    share_token text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_itineraries_owner_idx ON user_itineraries(user_id, updated_at DESC);
