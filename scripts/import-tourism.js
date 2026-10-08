const fs = require('fs');
const path = require('path');
const { createClient } = require('./db');

const directory = path.join(__dirname, '..', 'data', 'tourism');
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const categories = {
    DI_TICH: 'Di tích lịch sử - Văn hóa',
    DANH_LAM: 'Danh lam thắng cảnh',
    TAM_LINH: 'Điểm đến tâm linh',
    KHU_DU_LICH: 'Khu du lịch - Vui chơi',
    BAO_TANG: 'Bảo tàng - Triển lãm'
};
function classify(tags) {
    if (tags.amenity === 'place_of_worship' || tags.historic === 'temple') return 'TAM_LINH';
    if (['museum', 'gallery'].includes(tags.tourism)) return 'BAO_TANG';
    if (tags.historic) return 'DI_TICH';
    if (tags.natural || tags.waterway === 'waterfall' || tags.boundary === 'national_park' || tags.leisure === 'nature_reserve' || tags.tourism === 'viewpoint') return 'DANH_LAM';
    if (['theme_park', 'zoo', 'aquarium'].includes(tags.tourism) || tags.leisure === 'resort') return 'KHU_DU_LICH';
    if (/khu du l[iị]ch|khu ngh[iỉ] d[uư][oỡ]ng|c[oô]ng vi[eê]n gi[aả]i tr[ií]/i.test(tags['name:vi'] || tags.name || '')) return 'KHU_DU_LICH';
    return 'DANH_LAM'; // tourism=attraction: nhãn rộng của nguồn, cần kiểm duyệt.
}
function prepare(data) {
    const rejected = [];
    const records = [];
    const keys = new Set();
    for (const item of data.elements) {
        const tags = item.tags || {};
        const name = (tags['name:vi'] || tags.name || '').trim();
        const lat = item.lat ?? item.center?.lat;
        const lon = item.lon ?? item.center?.lon;
        const key = `${item.type}/${item.id}`;
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            rejected.push({ key, reason: 'missing_name_or_coordinates' });
            continue;
        }
        if (keys.has(key)) continue;
        keys.add(key);
        const category = classify(tags);
        const description = (tags['description:vi'] || tags.description || `${categories[category]}. Dữ liệu OpenStreetMap; chưa xác minh xếp hạng hoặc tình trạng hoạt động.`).slice(0, 500);
        const address = tags['addr:full'] || [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city'], tags['addr:province']].filter(Boolean).join(', ') || null;
        const image = /^https?:\/\//i.test(tags.image || '') ? tags.image : null;
        records.push({ key, name: name.slice(0, 255), normalized: normalize(name), category, lat, lon, description, address, image, raw: item, coordinateMethod: item.type === 'node' ? 'osm_node' : 'osm_bbox_center' });
    }
    return { records, rejected };
}
async function stage(client, records) {
    await client.query(`CREATE TEMP TABLE tourism_stage (
        source_key text PRIMARY KEY, name text, normalized text, category text,
        latitude double precision, longitude double precision,
        description text, address text, image text, raw jsonb, coordinate_method text,
        geom geometry(Point,4326)
    ) ON COMMIT DROP`);
    for (let offset = 0; offset < records.length; offset += 500) {
        await client.query(`INSERT INTO tourism_stage
            SELECT x.key,x.name,x.normalized,x.category,x.lat,x.lon,x.description,x.address,x.image,x.raw,x."coordinateMethod",
                ST_SetSRID(ST_MakePoint(x.lon,x.lat),4326)
            FROM jsonb_to_recordset($1::jsonb) AS x(key text,name text,normalized text,category text,lat double precision,lon double precision,description text,address text,image text,raw jsonb,"coordinateMethod" text)`,
        [JSON.stringify(records.slice(offset, offset + 500))]);
    }
    console.log(`Staged ${records.length} records; matching province boundaries...`);
    await client.query(`CREATE TEMP TABLE tourism_provinces ON COMMIT DROP AS
        SELECT ma_tinh,ten_tinh,ST_MakeValid(ST_Transform(geom,4326)) AS geom FROM ranh_gioi_tinh WHERE geom IS NOT NULL`);
    await client.query('CREATE INDEX ON tourism_provinces USING gist(geom)');
    await client.query('ANALYZE tourism_provinces');
    // Chia đa giác lớn để tránh kiểm tra hàng trăm nghìn đỉnh cho từng điểm.
    await client.query(`CREATE TEMP TABLE tourism_province_parts ON COMMIT DROP AS
        SELECT ma_tinh,ten_tinh,ST_Subdivide(geom,256) AS geom FROM tourism_provinces`);
    await client.query('CREATE INDEX ON tourism_province_parts USING gist(geom)');
    await client.query('ANALYZE tourism_province_parts');
    await client.query(`CREATE TEMP TABLE tourism_mapped ON COMMIT DROP AS
        SELECT s.*,p.ma_tinh,p.ten_tinh FROM tourism_stage s
        LEFT JOIN LATERAL (
            SELECT p.ma_tinh,p.ten_tinh FROM tourism_province_parts p
            WHERE p.geom && s.geom AND ST_Covers(p.geom,s.geom)
            ORDER BY p.ma_tinh LIMIT 1
        ) p ON true`);
    await client.query(`CREATE TEMP TABLE tourism_seen (
        id integer, normalized text, ma_tinh text, geom geometry(Point,4326)
    ) ON COMMIT DROP`);
    const existing = (await client.query('SELECT id,ten_dia_diem,ma_tinh,ST_X(geom) AS lon,ST_Y(geom) AS lat FROM diem_du_lich WHERE geom IS NOT NULL')).rows;
    if (existing.length) await client.query(`INSERT INTO tourism_seen
        SELECT x.id,x.normalized,x.ma_tinh,ST_SetSRID(ST_MakePoint(x.lon,x.lat),4326)
        FROM jsonb_to_recordset($1::jsonb) AS x(id integer,normalized text,ma_tinh text,lon double precision,lat double precision)`,
    [JSON.stringify(existing.map(row => ({ ...row, normalized: normalize(row.ten_dia_diem) })))]);
    await client.query('CREATE INDEX ON tourism_seen(normalized,ma_tinh)');
}
async function migrate(client) {
    await client.query(`ALTER TABLE diem_du_lich
        ADD COLUMN IF NOT EXISTS nguon_du_lieu text,
        ADD COLUMN IF NOT EXISTS nguon_id text,
        ADD COLUMN IF NOT EXISTS nguon_url text,
        ADD COLUMN IF NOT EXISTS ngay_nhap_du_lieu timestamptz,
        ADD COLUMN IF NOT EXISTS thong_tin_nguon jsonb`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS diem_du_lich_source_unique
        ON diem_du_lich(nguon_du_lieu,nguon_id) WHERE nguon_du_lieu IS NOT NULL AND nguon_id IS NOT NULL`);
    await client.query(`CREATE TABLE IF NOT EXISTS du_lieu_du_lich_osm (
        osm_key text PRIMARY KEY,
        diem_du_lich_id integer REFERENCES diem_du_lich(id),
        ma_tinh varchar(10) REFERENCES ranh_gioi_tinh(ma_tinh),
        trang_thai text NOT NULL,
        du_lieu_goc jsonb NOT NULL,
        ngay_tai timestamptz NOT NULL,
        ngay_osm timestamptz,
        giay_phep text NOT NULL DEFAULT 'ODbL-1.0'
    )`);
    for (const [code, name] of Object.entries(categories)) {
        await client.query('INSERT INTO danh_muc_loai(ma_loai,ten_loai) VALUES($1,$2) ON CONFLICT(ma_loai) DO NOTHING', [code, name]);
    }
}
async function main() {
    const apply = process.argv.includes('--apply');
    const raw = JSON.parse(fs.readFileSync(path.join(directory, 'osm-vietnam.json'), 'utf8'));
    const source = JSON.parse(fs.readFileSync(path.join(directory, 'source.json'), 'utf8'));
    if (!Array.isArray(raw.elements) || !raw.elements.length || raw.remark) throw new Error('Input data missing, empty, or incomplete. Download again.');
    const { records, rejected } = prepare(raw);
    const client = createClient();
    let committed = false;
    try {
        await client.connect();
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('mapgis-tourism-import'))");
        const before = (await client.query('SELECT * FROM diem_du_lich ORDER BY id')).rows;
        const previousCategories = (await client.query('SELECT * FROM danh_muc_loai ORDER BY id')).rows;
        if (apply) {
            const backupName = `backup-before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            fs.writeFileSync(path.join(directory, backupName), JSON.stringify({ createdAt: new Date().toISOString(), diem_du_lich: before, danh_muc_loai: previousCategories }, null, 2));
            await migrate(client);
        }
        await stage(client, records);
        const mapped = (await client.query("SELECT *,ST_AsText(geom) AS point FROM tourism_mapped ORDER BY CASE WHEN source_key LIKE 'relation/%' THEN 0 WHEN source_key LIKE 'way/%' THEN 1 ELSE 2 END,source_key")).rows;
        console.log(`Province matching complete. Processing ${mapped.length} records (${apply ? 'apply' : 'preview'})...`);
        const categoryIds = Object.fromEntries((await client.query('SELECT id,ma_loai FROM danh_muc_loai')).rows.map(row => [row.ma_loai, row.id]));
        const report = {
            mode: apply ? 'apply' : 'preview', source, startedAt: new Date().toISOString(),
            before: before.length, downloaded: raw.elements.length, valid: records.length,
            inserted: 0, existingSource: 0, duplicates: 0, unmatchedProvince: 0,
            invalid: rejected.length, classification: categories,
            notes: ['Only named OSM features matching the saved query.', 'Not an exhaustive or official tourism/heritage register.', 'Way/relation coordinates are bounding-box centers, not exact entrances.', 'Province assignment uses existing database boundaries; unmatched records are retained in staging only.']
        };
        const unmatched = [];
        let previewId = -1;
        for (const row of mapped) {
            let id = null;
            let status = 'unmatched_province';
            if (row.ma_tinh) {
                if (apply) {
                    id = (await client.query("SELECT id FROM diem_du_lich WHERE nguon_du_lieu='OpenStreetMap' AND nguon_id=$1", [row.source_key])).rows[0]?.id;
                }
                if (id) {
                    report.existingSource++;
                    status = 'existing_source';
                } else {
                    const duplicate = (await client.query(`SELECT id FROM tourism_seen
                        WHERE normalized=$1 AND ma_tinh=$2
                        AND ST_DWithin(geom::geography,ST_GeomFromText($3,4326)::geography,250)
                        ORDER BY id LIMIT 1`, [row.normalized, row.ma_tinh, row.point])).rows[0];
                    if (duplicate) {
                        id = duplicate.id;
                        report.duplicates++;
                        status = 'duplicate';
                    } else {
                        const metadata = { tags: row.raw.tags, coordinate_method: row.coordinate_method, category_method: 'osm_tags', verification: 'unverified', license: 'ODbL-1.0', osm_timestamp: source.osmTimestamp, normalized_name: row.normalized };
                        if (apply) {
                            id = (await client.query(`INSERT INTO diem_du_lich
                                (ten_dia_diem,loai_id,ma_tinh,dia_chi,mo_ta_ngan,hinh_anh_url,geom,nguon_du_lieu,nguon_id,nguon_url,ngay_nhap_du_lieu,thong_tin_nguon)
                                VALUES($1,$2,$3,$4,$5,$6,ST_GeomFromText($7,4326),'OpenStreetMap',$8,$9,now(),$10::jsonb) RETURNING id`,
                            [row.name, categoryIds[row.category], row.ma_tinh, row.address, row.description, row.image, row.point, row.source_key, `https://www.openstreetmap.org/${row.source_key}`, JSON.stringify(metadata)])).rows[0].id;
                        } else id = previewId--;
                        await client.query('INSERT INTO tourism_seen VALUES($1,$2,$3,ST_GeomFromText($4,4326))', [id, row.normalized, row.ma_tinh, row.point]);
                        report.inserted++;
                        status = 'inserted';
                    }
                }
            } else {
                report.unmatchedProvince++;
                unmatched.push({ key: row.source_key, name: row.name, lat: row.latitude, lon: row.longitude, category: row.category, reason: status });
            }
            if (apply) await client.query(`INSERT INTO du_lieu_du_lich_osm
                (osm_key,diem_du_lich_id,ma_tinh,trang_thai,du_lieu_goc,ngay_tai,ngay_osm)
                VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)
                ON CONFLICT(osm_key) DO UPDATE SET diem_du_lich_id=EXCLUDED.diem_du_lich_id,
                    ma_tinh=EXCLUDED.ma_tinh,trang_thai=EXCLUDED.trang_thai,du_lieu_goc=EXCLUDED.du_lieu_goc,ngay_tai=EXCLUDED.ngay_tai,ngay_osm=EXCLUDED.ngay_osm`,
            [row.source_key, id, row.ma_tinh, status, JSON.stringify(row.raw), source.downloadedAt, source.osmTimestamp || null]);
            if ((report.inserted + report.duplicates + report.existingSource + report.unmatchedProvince) % 1000 === 0) console.log(`Processed ${report.inserted + report.duplicates + report.existingSource + report.unmatchedProvince}/${mapped.length}`);
        }
        report.byProvince = (await client.query(`SELECT p.ma_tinh,p.ten_tinh,count(m.source_key)::int AS source_records
            FROM tourism_provinces p LEFT JOIN tourism_mapped m ON m.ma_tinh=p.ma_tinh GROUP BY p.ma_tinh,p.ten_tinh ORDER BY p.ma_tinh`)).rows;
        if (apply) {
            const orphan = (await client.query(`SELECT count(*)::int AS n FROM diem_du_lich d
                LEFT JOIN ranh_gioi_tinh p ON p.ma_tinh=d.ma_tinh LEFT JOIN danh_muc_loai l ON l.id=d.loai_id
                WHERE d.nguon_du_lieu='OpenStreetMap' AND (p.ma_tinh IS NULL OR l.id IS NULL OR NOT ST_IsValid(d.geom) OR ST_SRID(d.geom)<>4326)`)).rows[0].n;
            if (orphan) throw new Error(`Validation failed: ${orphan} invalid imported records`);
            report.after = Number((await client.query('SELECT count(*) AS n FROM diem_du_lich')).rows[0].n);
            report.savedByCategory = (await client.query(`SELECT l.ma_loai,l.ten_loai,count(d.id)::int AS count FROM danh_muc_loai l LEFT JOIN diem_du_lich d ON d.loai_id=l.id GROUP BY l.id ORDER BY l.id`)).rows;
            report.savedByProvince = (await client.query(`SELECT p.ma_tinh,p.ten_tinh,count(d.id)::int AS count FROM ranh_gioi_tinh p LEFT JOIN diem_du_lich d ON d.ma_tinh=p.ma_tinh GROUP BY p.ma_tinh,p.ten_tinh ORDER BY p.ma_tinh`)).rows;
            await client.query('COMMIT');
            committed = true;
        } else await client.query('ROLLBACK');
        report.finishedAt = new Date().toISOString();
        fs.writeFileSync(path.join(directory, apply ? 'import-report.json' : 'preview-report.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(directory, 'unmatched-provinces.json'), JSON.stringify(unmatched, null, 2));
        fs.writeFileSync(path.join(directory, 'invalid-records.json'), JSON.stringify(rejected, null, 2));
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { await client.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { normalize, classify, prepare };
