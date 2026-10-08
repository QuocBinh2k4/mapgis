const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createClient } = require('./db');
async function main() {
    const directory = path.join(__dirname, '..', 'data', 'tourism');
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'import-report.json'), 'utf8'));
    const client = createClient();
    try {
        await client.connect();
        const counts = (await client.query(`SELECT count(*)::int AS total,
            count(*) FILTER (WHERE nguon_du_lieu='OpenStreetMap')::int AS imported,
            count(DISTINCT ma_tinh)::int AS provinces FROM diem_du_lich`)).rows[0];
        // Admin có thể thêm điểm sau lần nhập; số lượng báo cáo là mốc tham chiếu.
        const lastImportTotal = report.after;
        const boundaries = (await client.query(`SELECT count(*)::int AS total,
            count(*) FILTER (WHERE geom IS NULL OR ST_IsEmpty(geom) OR NOT ST_IsValid(geom) OR ST_SRID(geom)<>4326)::int AS invalid FROM ranh_gioi_tinh`)).rows[0];
        assert.ok(boundaries.total > 0, 'Chưa có ranh giới tỉnh');
        assert.equal(boundaries.invalid, 0, 'Ranh giới không hợp lệ');
        const invalid = (await client.query(`SELECT count(*)::int AS n FROM diem_du_lich d
            LEFT JOIN ranh_gioi_tinh p ON p.ma_tinh=d.ma_tinh LEFT JOIN danh_muc_loai l ON l.id=d.loai_id
            WHERE d.nguon_du_lieu='OpenStreetMap' AND (
                p.ma_tinh IS NULL OR l.id IS NULL OR d.geom IS NULL OR ST_SRID(d.geom)<>4326
                OR GeometryType(d.geom)<>'POINT' OR NOT ST_IsValid(d.geom)
                OR NOT EXISTS (SELECT 1 FROM du_lieu_du_lich_osm s WHERE s.osm_key=d.nguon_id AND s.diem_du_lich_id=d.id))`)).rows[0].n;
        assert.equal(invalid, 0, 'Điểm có geometry, tỉnh, loại hoặc liên kết nguồn không hợp lệ');
        const duplicate = (await client.query(`SELECT nguon_id FROM diem_du_lich WHERE nguon_du_lieu='OpenStreetMap'
            GROUP BY nguon_id HAVING count(*)>1`)).rows;
        assert.equal(duplicate.length, 0, 'Trùng mã OSM');
        console.log(JSON.stringify({ status: 'PASS', counts, boundaries, lastImportTotal }, null, 2));
    } finally { await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
