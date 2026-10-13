const { createClient } = require('./db');
const { commonsImages } = require('./update-wikidata-covers');

const query = `SELECT ?item ?itemLabel ?image ?coord WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord.
    bd:serviceParam wikibase:cornerWest "Point(102 8)"^^geo:wktLiteral.
    bd:serviceParam wikibase:cornerEast "Point(110 24)"^^geo:wktLiteral.
  }
  ?item wdt:P18 ?image.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "vi,en". }
}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function distanceMeters(lat1, lng1, lat2, lng2) {
    const radians = value => value * Math.PI / 180;
    const dLat = radians(lat2 - lat1), dLng = radians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

function parseCoordinate(value) {
    const match = value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    return match ? { lng: Number(match[1]), lat: Number(match[2]) } : null;
}

function fileFromImageUrl(value) {
    const url = new URL(value), marker = '/wiki/Special:FilePath/';
    const index = url.pathname.indexOf(marker);
    if (index < 0) return null;
    try { return decodeURIComponent(url.pathname.slice(index + marker.length)); }
    catch { return null; }
}

async function wikidataPlaces() {
    const url = new URL('https://query.wikidata.org/sparql');
    url.searchParams.set('query', query);
    url.searchParams.set('format', 'json');
    for (let attempt = 0; attempt < 7; attempt++) {
        const response = await fetch(url, { headers: { 'User-Agent': 'MapGIS-cover-image-updater/1.0 (educational project)', Accept: 'application/sparql-results+json' } });
        if (response.ok) return (await response.json()).results.bindings;
        if (![429, 503].includes(response.status) || attempt === 6) throw new Error(`Wikidata SPARQL returned HTTP ${response.status}`);
        const retryAfter = Number(response.headers.get('retry-after'));
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 2000 * 2 ** attempt));
    }
    return [];
}

async function main() {
    const apply = process.argv.includes('--apply'), client = createClient();
    try {
        await client.connect();
        const { rows } = await client.query(`SELECT d.id,d.ten_dia_diem,d.chi_tiet,
                ST_Y(d.geom)::float AS lat,ST_X(d.geom)::float AS lng,
                COALESCE(jsonb_agg(s.du_lieu_goc->'tags') FILTER (WHERE s.du_lieu_goc IS NOT NULL),'[]'::jsonb) AS tags
            FROM diem_du_lich d LEFT JOIN du_lieu_du_lich_osm s ON s.diem_du_lich_id=d.id
            WHERE d.deleted_at IS NULL AND (d.hinh_anh_url IS NULL OR btrim(d.hinh_anh_url)='') AND d.geom IS NOT NULL
            GROUP BY d.id ORDER BY d.id`);
        const records = await wikidataPlaces(), candidates = [], placesByName = new Map();
        for (const row of rows) {
            const names = new Set([row.ten_dia_diem, ...row.tags.flatMap(tags => [tags?.['name:vi'], tags?.name, tags?.official_name, tags?.alt_name])].filter(Boolean).map(normalize));
            for (const name of names) {
                if (!placesByName.has(name)) placesByName.set(name, []);
                placesByName.get(name).push(row);
            }
        }
        for (const item of records) {
            const coordinates = parseCoordinate(item.coord.value), file = fileFromImageUrl(item.image.value);
            if (!coordinates || !file) continue;
            const label = normalize(item.itemLabel.value);
            for (const row of placesByName.get(label) || []) {
                const meters = distanceMeters(row.lat, row.lng, coordinates.lat, coordinates.lng);
                if (meters <= 250) candidates.push({ id: row.id, name: row.ten_dia_diem, label: item.itemLabel.value, qid: item.item.value.split('/').pop(), file, meters });
            }
        }
        candidates.sort((a, b) => a.meters - b.meters);
        const byPlace = new Map(), usedEntities = new Set();
        for (const candidate of candidates) {
            if (!byPlace.has(candidate.id) && !usedEntities.has(candidate.qid)) {
                byPlace.set(candidate.id, candidate);
                usedEntities.add(candidate.qid);
            }
        }
        const matches = [...byPlace.values()], commons = await commonsImages(matches.map(item => item.file));
        const byId = new Map(matches.filter(match => commons.has(match.file)).map(match => [match.id, { ...match, image: commons.get(match.file) }]));
        const rowById = new Map(rows.map(row => [row.id, row]));
        const updates = [...byId.values()].map(match => {
            const row = rowById.get(match.id), details = row.chi_tiet && typeof row.chi_tiet === 'object' ? { ...row.chi_tiet } : {};
            const gallery = Array.isArray(details.gallery) ? details.gallery : [];
            details.gallery = [{ url: match.image.url, caption: row.ten_dia_diem, credit: match.image.credit, source: match.image.pageUrl }, ...gallery.filter(item => item?.url !== match.image.url)].slice(0, 8);
            return { id: row.id, url: match.image.url, details };
        });
        console.log(JSON.stringify({ missingCoversScanned: rows.length, wikidataImageLocations: records.length, exactNameAndNearbyCandidates: matches.length, usableLicensedPhotos: updates.length, sample: updates.slice(0, 10).map(item => ({ name: rowById.get(item.id).ten_dia_diem, wikidata: byId.get(item.id).label, meters: Math.round(byId.get(item.id).meters) })), applied: apply }, null, 2));
        if (!apply || !updates.length) return;
        await client.query('BEGIN');
        try {
            for (let i = 0; i < updates.length; i += 200) {
                await client.query(`UPDATE diem_du_lich d SET hinh_anh_url=x.url,chi_tiet=x.details::jsonb,updated_at=now(),version=version+1
                    FROM jsonb_to_recordset($1::jsonb) AS x(id int,url text,details jsonb)
                    WHERE d.id=x.id AND d.deleted_at IS NULL AND (d.hinh_anh_url IS NULL OR btrim(d.hinh_anh_url)='')`, [JSON.stringify(updates.slice(i, i + 200))]);
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        }
        console.log(`Updated ${updates.length} covers using exact names and locations within 250 meters.`);
    } finally {
        await client.end();
    }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { normalize, distanceMeters, parseCoordinate, fileFromImageUrl };
