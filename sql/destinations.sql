ALTER TABLE diem_du_lich
    ADD COLUMN IF NOT EXISTS slug varchar(120),
    ADD COLUMN IF NOT EXISTS chi_tiet jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS diem_du_lich_slug_idx ON diem_du_lich(slug);
CREATE INDEX IF NOT EXISTS diem_du_lich_category_idx ON diem_du_lich(loai_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS diem_du_lich_geography_idx ON diem_du_lich USING gist((geom::geography)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS place_photos (
    id bigserial PRIMARY KEY,
    tourism_id integer NOT NULL REFERENCES diem_du_lich(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    blob_url text NOT NULL,
    mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
    byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
    caption varchar(500) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS place_photos_place_idx ON place_photos(tourism_id,created_at DESC);
CREATE INDEX IF NOT EXISTS place_photos_user_idx ON place_photos(user_id,created_at DESC);
