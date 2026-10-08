const fs = require('fs');
const path = require('path');
const { createClient } = require('./db');
const { ensureSchema } = require('./schema');
const directory = path.join(__dirname, '..', 'data', 'boundaries');

function prepareBoundaries(data) {
    if (data.type !== 'FeatureCollection' || !data.features?.length) throw new Error('Cần FeatureCollection ranh giới không rỗng.');
    const seen = new Set();
    return data.features.map(feature => {
        const p = feature.properties || {};
        const code = String(p.ma_tinh || '').trim();
        if (!code || code.length > 10 || !p.ten_tinh || seen.has(code)) throw new Error(`Thiếu/trùng mã hoặc tên tỉnh: ${code}`);
        seen.add(code);
        if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) throw new Error(`Tỉnh ${code}: cần Polygon/MultiPolygon WGS84.`);
        function checkCoordinates(value) {
            if (!Array.isArray(value) || !value.length) throw new Error(`Tỉnh ${code}: geometry rỗng.`);
            if (typeof value[0] === 'number') {
                if (!Number.isFinite(value[0]) || !Number.isFinite(value[1]) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error(`Tỉnh ${code}: tọa độ không thuộc WGS84.`);
            } else value.forEach(checkCoordinates);
        }
        checkCoordinates(feature.geometry.coordinates);
        return { code, name: p.ten_tinh, geometry: feature.geometry, population: p.dan_so ?? null, area: p.dien_tich ?? null };
    });
}
async function stageBoundaries(client, records) {
    await client.query(`CREATE TEMP TABLE boundary_stage ON COMMIT DROP AS
        SELECT x.code, x.name, x.population, x.area,
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(x.geometry::text),4326)),3)) AS geom
        FROM jsonb_to_recordset($1::jsonb) AS x(code text,name text,population integer,area double precision,geometry jsonb)`, [JSON.stringify(records)]);
    const invalid = (await client.query(`SELECT code FROM boundary_stage WHERE geom IS NULL OR ST_IsEmpty(geom) OR NOT ST_IsValid(geom)`)).rows;
    if (invalid.length) throw new Error(`Ranh giới không hợp lệ: ${invalid.map(r => r.code).join(', ')}`);
}
async function main() {
    const apply = process.argv.includes('--apply');
    const records = prepareBoundaries(JSON.parse(fs.readFileSync(path.join(directory, 'provinces.geojson'), 'utf8')));
    const client = createClient();
    try {
        await client.connect(); await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('mapgis-tourism-import'))");
        await ensureSchema(client);
        await stageBoundaries(client, records);
        const existing = (await client.query('SELECT * FROM ranh_gioi_tinh ORDER BY ma_tinh')).rows;
        const obsolete = existing.filter(r => !records.some(p => p.code === r.ma_tinh));
        if (obsolete.length) throw new Error(`Mã tỉnh hiện tại khác nguồn: ${obsolete.map(r => r.ma_tinh).join(', ')}. Cần chuyển đổi mã trước khi nhập; không trộn hai bộ ranh giới.`);
        const report = { mode: apply ? 'apply' : 'preview', before: existing.length, downloaded: records.length,
            inserted: records.filter(r => !existing.some(p => p.ma_tinh === r.code)).length,
            updated: records.filter(r => existing.some(p => p.ma_tinh === r.code)).length };
        if (apply) fs.writeFileSync(path.join(directory, `backup-${Date.now()}.json`), JSON.stringify({ ranh_gioi_tinh: existing, diem_du_lich: (await client.query('SELECT id,ma_tinh FROM diem_du_lich')).rows }));
        await client.query(`INSERT INTO ranh_gioi_tinh(ma_tinh,ten_tinh,dien_tich,dan_so,geom)
            SELECT code,name,COALESCE(area,ST_Area(geom::geography)/1000000),population,geom FROM boundary_stage
            ON CONFLICT(ma_tinh) DO UPDATE SET ten_tinh=EXCLUDED.ten_tinh,geom=EXCLUDED.geom,
                dien_tich=EXCLUDED.dien_tich,dan_so=COALESCE(EXCLUDED.dan_so,ranh_gioi_tinh.dan_so)`);
        // Nếu ranh giới thay đổi, ghép lại tỉnh cho các điểm theo geometry mới trong cùng transaction.
        await client.query(`CREATE TEMP TABLE boundary_parts ON COMMIT DROP AS
            SELECT ma_tinh,ST_Subdivide(ST_Transform(geom,4326),256) AS geom FROM ranh_gioi_tinh;
            CREATE INDEX ON boundary_parts USING gist(geom); ANALYZE boundary_parts`);
        await client.query(`UPDATE diem_du_lich d SET ma_tinh=(
            SELECT p.ma_tinh FROM boundary_parts p
            WHERE p.geom && ST_Transform(d.geom,4326) AND ST_Covers(p.geom,ST_Transform(d.geom,4326)) ORDER BY p.ma_tinh LIMIT 1
        ) WHERE d.geom IS NOT NULL`);
        if ((await client.query("SELECT to_regclass('du_lieu_du_lich_osm') AS t")).rows[0].t) {
            await client.query(`UPDATE du_lieu_du_lich_osm s SET ma_tinh=d.ma_tinh FROM diem_du_lich d WHERE d.id=s.diem_du_lich_id`);
        }
        await client.query(apply ? 'COMMIT' : 'ROLLBACK');
        fs.writeFileSync(path.join(directory, apply ? 'import-report.json' : 'preview-report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { await client.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepareBoundaries, stageBoundaries };
