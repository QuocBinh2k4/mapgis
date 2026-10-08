const COSTING = { car: 'auto', motorcycle: 'motor_scooter', bicycle: 'bicycle', foot: 'pedestrian' };
class ProviderError extends Error {
    constructor(message, status = 503) { super(message); this.status = status; }
}
const cache = new Map();
let nextRequest = 0;
function endpoint() {
    const url = new URL(process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de/');
    if (!['http:', 'https:'].includes(url.protocol)) throw new ProviderError('VALHALLA_URL không hợp lệ.');
    url.pathname = `${url.pathname.replace(/\/$/, '')}/route`;
    return url;
}
function decodePolyline(value) {
    if (typeof value !== 'string' || value.length > 5000000) throw new ProviderError('Dịch vụ trả về tuyến không hợp lệ.', 502);
    let index = 0, lat = 0, lon = 0;
    const coordinates = [];
    function delta() {
        let result = 0, shift = 0, byte;
        do {
            if (index >= value.length || shift > 30) throw new ProviderError('Hình học tuyến bị thiếu hoặc sai định dạng.', 502);
            byte = value.charCodeAt(index++) - 63;
            if (byte < 0 || byte > 63) throw new ProviderError('Hình học tuyến không hợp lệ.', 502);
            result += (byte & 31) * 2 ** shift;
            shift += 5;
        } while (byte >= 32);
        return result % 2 ? -(Math.floor(result / 2) + 1) : result / 2;
    }
    while (index < value.length) {
        lat += delta(); lon += delta();
        coordinates.push([lon / 1e6, lat / 1e6]);
    }
    return coordinates;
}
function distance(a, b) {
    const r = Math.PI / 180;
    const h = Math.sin((b[1]-a[1])*r/2)**2 + Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin((b[0]-a[0])*r/2)**2;
    return Math.round(6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1,h))));
}
function convertTrip(trip, id) {
    if (!trip?.legs?.length || !Number.isFinite(trip.summary?.length) || !Number.isFinite(trip.summary?.time) || trip.summary.length < 0 || trip.summary.time < 0) throw new ProviderError('Dịch vụ trả về tuyến không hợp lệ.', 502);
    const coordinates = [], steps = [];
    for (const leg of trip.legs) {
        const line = typeof leg.shape === 'string' ? decodePolyline(leg.shape) : leg.shape?.coordinates;
        if (!Array.isArray(line) || line.length < 2 || line.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new ProviderError('Hình học tuyến không hợp lệ.', 502);
        if (coordinates.length && distance(coordinates.at(-1), line[0]) > 2) throw new ProviderError('Tuyến trả về không liên thông.', 502);
        coordinates.push(...(coordinates.length ? line.slice(1) : line));
        for (const maneuver of leg.maneuvers || []) {
            if (!Number.isFinite(maneuver.length) || maneuver.length <= 0) continue;
            const name = maneuver.street_names?.filter(n => typeof n === 'string').join(', ') || 'Đường chưa có tên';
            steps.push({ name, distance: Math.round(maneuver.length * 1000), coordinate: line[maneuver.begin_shape_index] || line[0] });
        }
    }
    return { id, distanceMeters: Math.round(trip.summary.length * 1000), durationSeconds: Math.round(trip.summary.time), geometry: { type: 'LineString', coordinates }, steps };
}
async function routeValhalla(pool, body, signal, validateRequest) {
    const { start, destinationId, mode } = validateRequest(body);
    const destination = (await pool.query(`SELECT id,ten_dia_diem,ST_X(ST_Transform(geom,4326)) AS lng,ST_Y(ST_Transform(geom,4326)) AS lat
        FROM diem_du_lich WHERE id=$1 AND geom IS NOT NULL AND deleted_at IS NULL`, [destinationId])).rows[0];
    if (!destination) throw new ProviderError('Không tìm thấy điểm du lịch.', 404);
    const target = { id: destination.id, name: destination.ten_dia_diem, lat: destination.lat, lng: destination.lng };
    const url = endpoint();
    const key = JSON.stringify([url.href, mode, start, target]);
    const saved = cache.get(key);
    if (saved?.expires > Date.now()) return saved.data;
    // Máy demo FOSSGIS: tối đa một yêu cầu mỗi giây trong mỗi tiến trình.
    if (Date.now() < nextRequest) throw new ProviderError('Vui lòng chờ một giây trước khi tìm tuyến tiếp theo.', 429);
    nextRequest = Date.now() + 1100;
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000);
    let response, data;
    try {
        response = await fetch(url, {
            method: 'POST', signal: combined,
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'MapGIS-Vietnam/1.0', 'X-Client-Id': process.env.ROUTING_CLIENT_ID || 'mapgis-vietnam-educational' },
            body: JSON.stringify({ locations: [{ lat:start.lat,lon:start.lng,radius:1500,search_cutoff:1500 },{ lat:target.lat,lon:target.lng,radius:1500,search_cutoff:1500 }],
                costing: COSTING[mode], alternates: 2, units: 'kilometers', language: 'en-US',
                costing_options: { [COSTING[mode]]: mode === 'motorcycle' ? { exclude_highways: true } : {} } })
        });
        data = await response.json();
    } catch (error) {
        if (signal?.aborted) throw new ProviderError('Đã hủy yêu cầu tìm đường.', 499);
        throw new ProviderError('Chưa kết nối được dịch vụ tìm đường. Vui lòng thử lại sau ít phút.');
    }
    if (!response.ok || !data.trip) {
        if (data.error_code === 154) throw new ProviderError('Tuyến vượt giới hạn khoảng cách của dịch vụ. Hãy chọn điểm xuất phát gần hơn.', 422);
        if ([171,442].includes(data.error_code)) throw new ProviderError('Không tìm thấy đường phù hợp gần điểm chọn. Hãy chọn vị trí gần đường hoặc đổi phương tiện.', 422);
        throw new ProviderError('Dịch vụ tìm đường đang không sẵn sàng. Vui lòng thử lại sau ít phút.');
    }
    const trips = [data.trip, ...(data.alternates || []).map(a => a.trip || a)].slice(0, 3)
        .filter(trip => mode !== 'motorcycle' || trip.summary?.has_highway !== true);
    if (!trips.length) throw new ProviderError('Không tìm thấy tuyến xe máy tránh cao tốc phù hợp. Hãy chọn vị trí khác.', 422);
    const seen = new Set();
    const routes = trips.map(convertTrip).filter(route => {
        const shape = JSON.stringify(route.geometry.coordinates);
        if (seen.has(shape)) return false;
        seen.add(shape); return true;
    }).map((route, index) => ({ ...route, id: index + 1 }));
    routes.forEach(route => {
        const first = route.geometry.coordinates[0], last = route.geometry.coordinates.at(-1);
        route.snaps = { start:{coordinates:first,gapMeters:distance([start.lng,start.lat],first)},end:{coordinates:last,gapMeters:distance([target.lng,target.lat],last)} };
    });
    if (routes.some(r => r.snaps.start.gapMeters > 1500 || r.snaps.end.gapMeters > 1500)) throw new ProviderError('Điểm chọn cách mạng đường phù hợp hơn 1,5 km. Hãy chọn vị trí gần đường hơn.', 422);
    const result = { mode, provider:'valhalla', destination:target, start, source:'OpenStreetMap contributors / Valhalla (FOSSGIS)',
        snaps:routes[0].snaps, routes,
        notes: ['Thời gian ước tính, chưa tính giao thông trực tiếp.', 'Xe máy dùng hồ sơ motor_scooter và tránh cao tốc.', 'Tọa độ hai đầu được gửi đến dịch vụ Valhalla để tính tuyến.'] };
    cache.set(key, { data:result, expires:Date.now()+300000 });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return result;
}
module.exports = { routeValhalla, decodePolyline, convertTrip };
