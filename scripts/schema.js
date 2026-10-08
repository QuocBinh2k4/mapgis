const { createClient } = require('./db');
const fs = require('fs');
const path = require('path');

async function ensureSchema(client) {
    await client.query(`CREATE EXTENSION IF NOT EXISTS postgis;
        CREATE TABLE IF NOT EXISTS ranh_gioi_tinh (
            id serial PRIMARY KEY, ma_tinh varchar(10) UNIQUE NOT NULL,
            ten_tinh varchar(255) NOT NULL, dien_tich double precision, dan_so integer,
            geom geometry(MultiPolygon,4326)
        );
        CREATE TABLE IF NOT EXISTS danh_muc_loai (
            id serial PRIMARY KEY, ma_loai varchar(50) UNIQUE NOT NULL, ten_loai varchar(255) NOT NULL
        );
        CREATE TABLE IF NOT EXISTS diem_du_lich (
            id serial PRIMARY KEY, ten_dia_diem varchar(255) NOT NULL,
            loai_id integer REFERENCES danh_muc_loai(id),
            ma_tinh varchar(10) REFERENCES ranh_gioi_tinh(ma_tinh),
            dia_chi text, mo_ta_ngan text, hinh_anh_url text, geom geometry(Point,4326)
        );
        CREATE INDEX IF NOT EXISTS ranh_gioi_tinh_geom_idx ON ranh_gioi_tinh USING gist(geom);
        CREATE INDEX IF NOT EXISTS diem_du_lich_geom_idx ON diem_du_lich USING gist(geom);`);
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'sql', 'users-admin.sql'), 'utf8'));
}
if (require.main === module) {
    (async () => {
        const client = createClient();
        try { await client.connect(); await client.query('BEGIN'); await ensureSchema(client); await client.query('COMMIT'); console.log('Đã cập nhật schema bản đồ, tài khoản và quản trị.'); }
        catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
        finally { await client.end(); }
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { ensureSchema };
