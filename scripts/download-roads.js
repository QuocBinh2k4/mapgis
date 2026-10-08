const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

async function main() {
    const directory = path.join(__dirname, '..', 'data', 'roads');
    fs.mkdirSync(directory, { recursive: true });
    const url = 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf';
    const file = path.join(directory, 'vietnam.osm.pbf');
    const checksumResponse = await fetch(`${url}.md5`, { signal: AbortSignal.timeout(30000) });
    if (!checksumResponse.ok) throw new Error(`Checksum HTTP ${checksumResponse.status}`);
    const expected = (await checksumResponse.text()).trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{32}$/i.test(expected)) throw new Error('Invalid checksum');
    const response = await fetch(url, { signal: AbortSignal.timeout(1800000) });
    if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
    const hash = crypto.createHash('md5');
    let bytes = 0, reported = 0;
    console.log(`Downloading Vietnam road source (${response.headers.get('content-length')} bytes)...`);
    const counter = new Transform({ transform(chunk, encoding, done) {
        hash.update(chunk); bytes += chunk.length;
        if (bytes - reported > 25 * 1024 * 1024) { reported = bytes; console.log(`${Math.round(bytes / 1024 / 1024)} MB downloaded`); }
        done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(`${file}.part`));
    if (hash.digest('hex') !== expected) throw new Error('Checksum mismatch; run download again');
    fs.renameSync(`${file}.part`, file);
    const source = { source: 'OpenStreetMap contributors / Geofabrik', url, license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright', downloadedAt: new Date().toISOString(), lastModified: response.headers.get('last-modified'), bytes, md5: expected };
    fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify(source, null, 2));
    console.log(JSON.stringify(source, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
