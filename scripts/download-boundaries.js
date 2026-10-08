const fs = require('fs');
const path = require('path');
const { normalize } = require('./import-tourism');
const directory = path.join(__dirname, '..', 'data', 'boundaries');
const repo = 'thanglequoc/vietnamese-provinces-database';
const folder = 'dataset-generation-scripts/resources/gis/geojson_11Mar2026';
async function getJSON(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'MapGIS-Vietnam/1.0' } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
}
async function main() {
    // Cố định commit để metadata, mã tỉnh và geometry thuộc cùng một phiên bản.
    const { sha } = await getJSON(`https://api.github.com/repos/${repo}/commits/master`);
    const base = `https://raw.githubusercontent.com/${repo}/${sha}`;
    const entries = await getJSON(`https://api.github.com/repos/${repo}/contents/${folder}?ref=${sha}`);
    const provinces = await getJSON(`${base}/json/simplified_json_generated_data_vn_units.json`);
    const metadata = await getJSON(`${base}/json/vn_provinces_metadata.json`);
    const folders = entries.filter(entry => entry.type === 'dir');
    if (folders.length !== 34 || provinces.length !== 34) throw new Error('Nguồn không đủ 34 tỉnh. Cần kiểm tra lại phiên bản.');
    const features = [];
    for (let offset = 0; offset < folders.length; offset += 4) {
        const batch = await Promise.all(folders.slice(offset, offset + 4).map(async entry => {
            const name = normalize(entry.name.replace(/^\d+_/, '')).replace(/^(tinh|thu do) /, '');
            const province = provinces.find(p => normalize(p.CodeName) === name);
            if (!province) throw new Error(`Không ghép được mã tỉnh: ${entry.name}`);
            const data = await getJSON(`${base}/${folder}/${encodeURIComponent(entry.name)}/province.geojson`);
            if (data.type !== 'FeatureCollection' || data.features?.length !== 1) throw new Error(`GeoJSON không hợp lệ: ${entry.name}`);
            return { type: 'Feature', geometry: data.features[0].geometry, properties: { ma_tinh: province.Code, ten_tinh: province.Name, source_properties: data.features[0].properties } };
        }));
        features.push(...batch);
        console.log(`Đã tải ${features.length}/34 tỉnh`);
    }
    if (new Set(features.map(f => f.properties.ma_tinh)).size !== 34) throw new Error('Trùng mã tỉnh');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'provinces.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
    fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify({
        repository: `https://github.com/${repo}`, commit: sha, downloadedAt: new Date().toISOString(),
        boundarySnapshot: 'geojson_11Mar2026 (nguồn ghi ngày tải 13/03/2026)', metadata,
        source: 'Bando.com.vn, phân phối lại qua vietnamese-provinces-database',
        licenseNote: 'Nguồn GeoJSON yêu cầu tham khảo điều khoản Bando.com.vn; không mặc định áp dụng giấy phép của mã nguồn repository.',
        count: features.length
    }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
