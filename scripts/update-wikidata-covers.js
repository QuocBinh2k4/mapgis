const { createClient } = require('./db');

const api = 'https://www.wikidata.org/w/api.php';
const userAgent = 'MapGIS-cover-image-updater/1.0 (educational project)';
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestJson(url) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
        if (response.ok) return response.json();
        if (![429, 503].includes(response.status) || attempt === 7) throw new Error(`Wikimedia API returned HTTP ${response.status}`);
        const retryAfter = Number(response.headers.get('retry-after'));
        await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 2000 * 2 ** attempt));
    }
}

function cleanMetadata(value) {
    return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"').replace(/&#39;|&#039;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ').trim();
}

function filePage(title) {
    return `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/i, ':')}`;
}

async function wikidataImages(qids) {
    const results = new Map();
    for (const batch of chunks(qids, 40)) {
        const url = new URL(api);
        for (const [key, value] of Object.entries({ action: 'wbgetentities', ids: batch.join('|'), props: 'claims|labels', languages: 'vi|en', format: 'json' })) url.searchParams.set(key, value);
        const data = await requestJson(url);
        if (data.error) throw new Error(data.error.info || 'Wikidata API error');
        for (const [qid, entity] of Object.entries(data.entities || {})) {
            const image = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
            if (image) results.set(qid, { file: image, label: entity.labels?.vi?.value || entity.labels?.en?.value || qid });
        }
        await delay(250);
    }
    return results;
}

async function commonsImages(files) {
    const results = new Map();
    for (const batch of chunks([...new Set(files)], 40)) {
        const url = new URL('https://commons.wikimedia.org/w/api.php');
        for (const [key, value] of Object.entries({ action: 'query', titles: batch.map(file => `File:${file}`).join('|'), prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1200', format: 'json' })) url.searchParams.set(key, value);
        const data = await requestJson(url);
        for (const page of Object.values(data.query?.pages || {})) {
            const info = page.imageinfo?.[0], metadata = info?.extmetadata || {};
            if (!info || !/^image\/(jpeg|png|webp)$/i.test(info.mime || '')) continue;
            const license = cleanMetadata(metadata.LicenseShortName?.value);
            if (!license) continue;
            const artist = cleanMetadata(metadata.Attribution?.value || metadata.Artist?.value || metadata.Credit?.value).slice(0, 150);
            const attributionRequired = cleanMetadata(metadata.AttributionRequired?.value).toLowerCase() === 'true';
            const credit = [attributionRequired && artist ? artist : '', license, 'Wikimedia Commons'].filter(Boolean).join(' · ').slice(0, 240);
            results.set(page.title.replace(/^File:/, ''), {
                url: info.thumburl || info.url,
                pageUrl: filePage(page.title.replace(/^File:/, '')),
                credit,
            });
        }
        await delay(250);
    }
    return results;
}

async function commonsCategoryImage(category) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    for (const [key, value] of Object.entries({ action: 'query', generator: 'categorymembers', gcmtitle: category, gcmtype: 'file', gcmlimit: '20', prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1200', format: 'json' })) url.searchParams.set(key, value);
    const data = await requestJson(url);
    const pages = Object.values(data.query?.pages || {}).filter(page => {
        const info = page.imageinfo?.[0];
        return info && /^image\/(jpeg|png|webp)$/i.test(info.mime || '') && cleanMetadata(info.extmetadata?.LicenseShortName?.value);
    });
    if (!pages.length) return null;
    const page = pages[0], info = page.imageinfo[0], metadata = info.extmetadata || {};
    const license = cleanMetadata(metadata.LicenseShortName?.value);
    const artist = cleanMetadata(metadata.Attribution?.value || metadata.Artist?.value || metadata.Credit?.value).slice(0, 150);
    const attributionRequired = cleanMetadata(metadata.AttributionRequired?.value).toLowerCase() === 'true';
    return {
        url: info.thumburl || info.url,
        pageUrl: filePage(page.title.replace(/^File:/, '')),
        credit: [attributionRequired && artist ? artist : '', license, 'Wikimedia Commons'].filter(Boolean).join(' · ').slice(0, 240),
    };
}

async function main() {
    const apply = process.argv.includes('--apply');
    const client = createClient();
    try {
        await client.connect();
        const { rows } = await client.query(`SELECT d.id,d.ten_dia_diem,d.hinh_anh_url,d.chi_tiet,
                s.du_lieu_goc->'tags'->>'wikidata' AS qid,
                s.du_lieu_goc->'tags'->>'wikimedia_commons' AS commons_tag
            FROM diem_du_lich d
            JOIN du_lieu_du_lich_osm s ON s.diem_du_lich_id=d.id
            WHERE d.deleted_at IS NULL AND (d.hinh_anh_url IS NULL OR btrim(d.hinh_anh_url)='')
              AND (s.du_lieu_goc->'tags'->>'wikidata' ~ '^Q[0-9]+$'
                   OR s.du_lieu_goc->'tags'->>'wikimedia_commons' IS NOT NULL)
            ORDER BY d.id`);
        const qids = [...new Set(rows.map(row => row.qid).filter(qid => /^Q[0-9]+$/.test(qid || '')))];
        const wikidata = await wikidataImages(qids);
        const fileTags = rows.map(row => row.commons_tag).filter(value => /^File:/i.test(value || '')).map(value => value.replace(/^File:/i, ''));
        const commons = await commonsImages([...wikidata.values()].map(item => item.file).concat(fileTags));
        const categoryTags = [...new Set(rows.map(row => row.commons_tag).filter(value => /^Category:/i.test(value || '')))];
        const categories = new Map();
        for (const category of categoryTags) {
            categories.set(category, await commonsCategoryImage(category));
            await delay(350);
        }
        const updates = [];
        for (const row of rows) {
            const entity = wikidata.get(row.qid);
            const file = row.commons_tag?.match(/^File:(.*)$/i)?.[1];
            const category = row.commons_tag && categories.get(row.commons_tag);
            const image = (entity && commons.get(entity.file)) || (file && commons.get(file)) || category;
            if (!image) continue;
            const details = row.chi_tiet && typeof row.chi_tiet === 'object' ? { ...row.chi_tiet } : {};
            const gallery = Array.isArray(details.gallery) ? details.gallery : [];
            const existing = gallery.find(item => item?.url === image.url || item?.url === row.hinh_anh_url);
            details.gallery = [
                { url: image.url, caption: row.ten_dia_diem, credit: image.credit, source: image.pageUrl },
                ...gallery.filter(item => item?.url !== image.url && item?.url !== row.hinh_anh_url),
            ].slice(0, 8);
            if (existing?.credit) details.gallery[0].credit = existing.credit;
            updates.push({ id: row.id, url: image.url, details });
        }
        console.log(JSON.stringify({ activeMissingWithSourceLink: rows.length, wikidataIds: qids.length, wikidataImages: wikidata.size, commonsFiles: commons.size, commonsCategories: categories.size, eligible: updates.length, applied: apply }, null, 2));
        if (!apply || !updates.length) return;
        await client.query('BEGIN');
        try {
            for (const batch of chunks(updates, 200)) {
                await client.query(`UPDATE diem_du_lich d SET hinh_anh_url=x.url,chi_tiet=x.details::jsonb,updated_at=now(),version=version+1
                    FROM jsonb_to_recordset($1::jsonb) AS x(id int,url text,details jsonb)
                    WHERE d.id=x.id AND d.deleted_at IS NULL AND (d.hinh_anh_url IS NULL OR btrim(d.hinh_anh_url)='')`, [JSON.stringify(batch)]);
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        }
        console.log(`Updated ${updates.length} destination covers from exact Wikidata photo links.`);
    } finally {
        await client.end();
    }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { wikidataImages, commonsImages };
