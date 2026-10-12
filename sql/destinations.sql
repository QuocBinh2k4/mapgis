ALTER TABLE diem_du_lich
    ADD COLUMN IF NOT EXISTS slug varchar(120),
    ADD COLUMN IF NOT EXISTS chi_tiet jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS diem_du_lich_slug_idx ON diem_du_lich(slug);
CREATE INDEX IF NOT EXISTS diem_du_lich_category_idx ON diem_du_lich(loai_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS diem_du_lich_geography_idx ON diem_du_lich USING gist((geom::geography)) WHERE deleted_at IS NULL;
