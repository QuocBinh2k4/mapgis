const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createClient } = require('./db');

async function main() {
    const directory = path.join(__dirname, '..', 'data', 'tourism');
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'import-report.json'), 'utf8'));
    const firstBackup = fs.readdirSync(directory).filter(name => name.startsWith('backup-before-import-')).sort()[0];
    const backup = JSON.parse(fs.readFileSync(path.join(directory, firstBackup), 'utf8'));
    const client = createClient();
    try {
        await client.connect();
        const counts = (await client.query(`SELECT count(*)::int AS total,
            count(*) FILTER (WHERE nguon_du_lieu='OpenStreetMap')::int AS imported,
            count(DISTINCT ma_tinh)::int AS provinces FROM diem_du_lich`)).rows[0];
        assert.equal(counts.total, report.after, 'Saved total does not match import report');
        assert.equal(counts.provinces, 34, 'Expected coverage of existing 34 province boundaries');
        const invalid = (await client.query(`SELECT count(*)::int AS n FROM diem_du_lich d
            LEFT JOIN ranh_gioi_tinh p ON p.ma_tinh=d.ma_tinh LEFT JOIN danh_muc_loai l ON l.id=d.loai_id
            WHERE d.nguon_du_lieu='OpenStreetMap' AND (
                p.ma_tinh IS NULL OR l.id IS NULL OR d.geom IS NULL OR ST_SRID(d.geom)<>4326
                OR GeometryType(d.geom)<>'POINT' OR NOT ST_IsValid(d.geom)
                OR NOT EXISTS (SELECT 1 FROM du_lieu_du_lich_osm s WHERE s.osm_key=d.nguon_id AND s.diem_du_lich_id=d.id))`)).rows[0].n;
        assert.equal(invalid, 0, 'Invalid geometry, source reference, province or category');
        const duplicateSources = (await client.query(`SELECT nguon_id FROM diem_du_lich
            WHERE nguon_du_lieu='OpenStreetMap' GROUP BY nguon_id HAVING count(*)>1`)).rows;
        assert.equal(duplicateSources.length, 0, 'Duplicate OSM source IDs');
        for (const original of backup.diem_du_lich) {
            const current = (await client.query('SELECT * FROM diem_du_lich WHERE id=$1', [original.id])).rows[0];
            assert.ok(current, `Original row ${original.id} missing`);
            for (const [key, value] of Object.entries(original)) assert.deepEqual(current[key], value, `Original row ${original.id}, column ${key} was changed`);
        }
        const staging = (await client.query('SELECT trang_thai,count(*)::int AS count FROM du_lieu_du_lich_osm GROUP BY trang_thai ORDER BY trang_thai')).rows;
        console.log(JSON.stringify({ status: 'PASS', checks: ['original records preserved', '34 provinces covered', 'valid WGS84 point geometry', 'category/province foreign keys', 'source linkage', 'unique OSM IDs', 'report totals'], counts, staging }, null, 2));
    } finally { await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
