const fs = require('fs');
const path = require('path');
const { createClient } = require('./db');
const { ensureSchema } = require('./schema');
const { planTourism } = require('./tourism-plan');

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
    const validate = process.argv.includes('--validate');
    const apply = validate || process.argv.includes('--apply');
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
        await ensureSchema(client);
        if ((validate || (!apply && process.argv.includes('--with-boundaries'))) && fs.existsSync(path.join(directory, '..', 'boundaries', 'provinces.geojson'))) {
            const { prepareBoundaries, stageBoundaries } = require('./import-boundaries');
            const boundaries = prepareBoundaries(JSON.parse(fs.readFileSync(path.join(directory, '..', 'boundaries', 'provinces.geojson'), 'utf8')));
            const oldCodes = (await client.query('SELECT ma_tinh FROM ranh_gioi_tinh')).rows;
            if (oldCodes.some(p => !boundaries.some(b => b.code === p.ma_tinh))) throw new Error('Mã tỉnh khác bộ nguồn. Cần chuyển đổi mã trước khi xem trước.');
            await stageBoundaries(client, boundaries);
            await client.query(`INSERT INTO ranh_gioi_tinh(ma_tinh,ten_tinh,geom) SELECT code,name,geom FROM boundary_stage
                ON CONFLICT(ma_tinh) DO UPDATE SET ten_tinh=EXCLUDED.ten_tinh,geom=EXCLUDED.geom`);
        }
        const readyProvinces = Number((await client.query('SELECT count(*) AS n FROM ranh_gioi_tinh WHERE geom IS NOT NULL')).rows[0].n);
        if (!readyProvinces) throw new Error('Chưa có ranh giới tỉnh. Chạy npm run boundaries:download rồi npm run boundaries:import trước.');
        const before = (await client.query('SELECT * FROM diem_du_lich ORDER BY id')).rows;
        const previousCategories = (await client.query('SELECT * FROM danh_muc_loai ORDER BY id')).rows;
        if (apply && !validate) {
            const backupName = `backup-before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            fs.writeFileSync(path.join(directory, backupName), JSON.stringify({ createdAt: new Date().toISOString(), diem_du_lich: before, danh_muc_loai: previousCategories }, null, 2));
        }
        await migrate(client); // Preview cũng kiểm tra schema, mọi thay đổi sẽ rollback.
        await stage(client, records);
        const mapped = (await client.query("SELECT *,ST_AsText(geom) AS point FROM tourism_mapped ORDER BY CASE WHEN source_key LIKE 'relation/%' THEN 0 WHEN source_key LIKE 'way/%' THEN 1 ELSE 2 END,source_key")).rows;
        console.log(`Province matching complete. Processing ${mapped.length} records (${apply ? 'apply' : 'preview'})...`);
        const categoryIds = Object.fromEntries((await client.query('SELECT id,ma_loai FROM danh_muc_loai')).rows.map(row => [row.ma_loai, row.id]));
        const report = {
            mode: validate ? 'validate-rollback' : apply ? 'apply' : 'preview', source, startedAt: new Date().toISOString(),
            before: before.length, downloaded: raw.elements.length, valid: records.length,
            inserted: 0, existingSource: 0, duplicates: 0, unmatchedProvince: 0,
            invalid: rejected.length, classification: categories,
            notes: ['Only named OSM features matching the saved query.', 'Not an exhaustive or official tourism/heritage register.', 'Way/relation coordinates are bounding-box centers, not exact entrances.', 'Province assignment uses existing database boundaries; unmatched records are retained in staging only.']
        };
        const unmatched = [];
        const existing = (await client.query('SELECT id,ten_dia_diem,ma_tinh,nguon_du_lieu,nguon_id,ST_X(ST_Transform(geom,4326)) AS lon,ST_Y(ST_Transform(geom,4326)) AS lat FROM diem_du_lich ORDER BY id')).rows;
        const decisions = planTourism(mapped, existing, normalize);
        const refresh = process.argv.includes('--refresh');
        report.updated = 0;
        const targets = new Map();
        const toSave = [];
        for (const decision of decisions) {
            const { row, status } = decision;
            if (status === 'unmatched_province') {
                report.unmatchedProvince++;
                unmatched.push({ key: row.source_key, name: row.name, lat: row.latitude, lon: row.longitude, category: row.category, reason: status });
            } else if (status === 'duplicate') report.duplicates++;
            else if (status === 'existing_source') { report.existingSource++; if (refresh) report.updated++; }
            else report.inserted++;
            if (status === 'inserted' || (refresh && status === 'existing_source')) {
                toSave.push({ ...row, category_id: categoryIds[row.category], metadata: {
                    tags: row.raw.tags, coordinate_method: row.coordinate_method, category_method: 'osm_tags',
                    verification: 'unverified', license: 'ODbL-1.0', osm_timestamp: source.osmTimestamp, normalized_name: row.normalized
                } });
            }
        }
        if (apply) {
            for (let offset = 0; offset < toSave.length; offset += 500) {
                const saved = await client.query(`INSERT INTO diem_du_lich
                    (ten_dia_diem,loai_id,ma_tinh,dia_chi,mo_ta_ngan,hinh_anh_url,geom,nguon_du_lieu,nguon_id,nguon_url,ngay_nhap_du_lieu,thong_tin_nguon)
                    SELECT x.name,x.category_id,x.ma_tinh,x.address,x.description,x.image,ST_GeomFromText(x.point,4326),
                        'OpenStreetMap',x.source_key,'https://www.openstreetmap.org/'||x.source_key,now(),x.metadata
                    FROM jsonb_to_recordset($1::jsonb) AS x(name text,category_id integer,ma_tinh text,address text,description text,image text,point text,source_key text,metadata jsonb)
                    ON CONFLICT(nguon_du_lieu,nguon_id) WHERE nguon_du_lieu IS NOT NULL AND nguon_id IS NOT NULL
                    DO UPDATE SET ten_dia_diem=EXCLUDED.ten_dia_diem,loai_id=EXCLUDED.loai_id,ma_tinh=EXCLUDED.ma_tinh,
                        dia_chi=EXCLUDED.dia_chi,mo_ta_ngan=EXCLUDED.mo_ta_ngan,hinh_anh_url=EXCLUDED.hinh_anh_url,
                        geom=EXCLUDED.geom,ngay_nhap_du_lieu=EXCLUDED.ngay_nhap_du_lieu,thong_tin_nguon=EXCLUDED.thong_tin_nguon
                    RETURNING id,nguon_id`, [JSON.stringify(toSave.slice(offset, offset + 500))]);
                for (const row of saved.rows) targets.set(row.nguon_id, row.id);
            }
            const sourceRows = decisions.map(({ row, status, target }) => ({
                key: row.source_key, id: typeof target === 'string' ? targets.get(target) : target,
                province: row.ma_tinh, status, raw: row.raw
            }));
            for (let offset = 0; offset < sourceRows.length; offset += 500) {
                await client.query(`INSERT INTO du_lieu_du_lich_osm
                    (osm_key,diem_du_lich_id,ma_tinh,trang_thai,du_lieu_goc,ngay_tai,ngay_osm)
                    SELECT x.key,x.id,x.province,x.status,x.raw,$2::timestamptz,$3::timestamptz
                    FROM jsonb_to_recordset($1::jsonb) AS x(key text,id integer,province text,status text,raw jsonb)
                    ON CONFLICT(osm_key) DO UPDATE SET diem_du_lich_id=EXCLUDED.diem_du_lich_id,ma_tinh=EXCLUDED.ma_tinh,
                        trang_thai=EXCLUDED.trang_thai,du_lieu_goc=EXCLUDED.du_lieu_goc,ngay_tai=EXCLUDED.ngay_tai,ngay_osm=EXCLUDED.ngay_osm`,
                [JSON.stringify(sourceRows.slice(offset, offset + 500)), source.downloadedAt, source.osmTimestamp || null]);
            }
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
            if (validate) {
                const saved = (await client.query('SELECT id,ten_dia_diem,ma_tinh,nguon_du_lieu,nguon_id,ST_X(geom) AS lon,ST_Y(geom) AS lat FROM diem_du_lich ORDER BY id')).rows;
                const secondPlan = planTourism(mapped, saved, normalize);
                if (secondPlan.some(p => p.status === 'inserted')) throw new Error('Chạy lại vẫn tạo điểm trùng');
                report.repeatImportAddsZero = true;
                report.api = await require('./check-web-data').checkWebData(client, report.after);
            }
            await client.query(validate ? 'ROLLBACK' : 'COMMIT');
            committed = !validate;
        } else await client.query('ROLLBACK');
        report.finishedAt = new Date().toISOString();
        fs.writeFileSync(path.join(directory, validate ? 'validation-report.json' : apply ? 'import-report.json' : 'preview-report.json'), JSON.stringify(report, null, 2));
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
