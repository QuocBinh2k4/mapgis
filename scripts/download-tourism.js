const fs = require('fs');
const path = require('path');

const query = `[out:json][timeout:180];
area["ISO3166-1"="VN"]["admin_level"="2"]->.vn;
(
 nwr(area.vn)["name"]["historic"~"^(archaeological_site|battlefield|castle|fort|manor|memorial|monument|ruins|city_gate|temple|tomb|building|heritage)$"];
 nwr(area.vn)["name"]["tourism"~"^(attraction|viewpoint|museum|theme_park|zoo|aquarium|gallery)$"];
 nwr(area.vn)["name"]["amenity"="place_of_worship"];
 nwr(area.vn)["name"]["natural"~"^(peak|cave_entrance|beach)$"];
 nwr(area.vn)["name"]["waterway"="waterfall"];
 nwr(area.vn)["name"]["leisure"~"^(resort|nature_reserve)$"];
 nwr(area.vn)["name"]["boundary"="national_park"];
);
out center tags;`;

async function main() {
    const directory = path.join(__dirname, '..', 'data', 'tourism');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'overpass-query.txt'), query);
    const endpoints = process.env.OVERPASS_URL
        ? [process.env.OVERPASS_URL]
        : ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
    let lastError;
    for (const endpoint of endpoints) {
        try {
            console.log(`Downloading named tourism POIs from ${endpoint}`);
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'MapGIS-Vietnam-Tourism/1.0 (one-time educational POI import; OpenStreetMap attribution retained)'
                },
                body: new URLSearchParams({ data: query }),
                signal: AbortSignal.timeout(240000)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.remark || !Array.isArray(data.elements) || !data.elements.length) {
                throw new Error(data.remark || 'Empty or invalid Overpass response');
            }
            fs.writeFileSync(path.join(directory, 'osm-vietnam.json'), JSON.stringify(data));
            const metadata = {
                source: 'OpenStreetMap contributors',
                license: 'ODbL 1.0',
                licenseUrl: 'https://www.openstreetmap.org/copyright',
                endpoint,
                downloadedAt: new Date().toISOString(),
                osmTimestamp: data.osm3s?.timestamp_osm_base,
                count: data.elements.length,
                query
            };
            fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify(metadata, null, 2));
            console.log(JSON.stringify(metadata, null, 2));
            return;
        } catch (error) {
            lastError = error;
            console.error(`${endpoint}: ${error.message}`);
        }
    }
    throw lastError;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
