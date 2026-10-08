// Lập kế hoạch trong bộ nhớ để không gửi một truy vấn Neon cho từng điểm.
function distanceMeters(a, b) {
    const radians = n => n * Math.PI / 180;
    const lat = radians(b.lat - a.lat), lon = radians(b.lon - a.lon);
    const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lon / 2) ** 2;
    return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function planTourism(rows, existing, normalize) {
    const sources = new Map(existing.filter(r => r.nguon_du_lieu === 'OpenStreetMap' && r.nguon_id).map(r => [r.nguon_id, r.id]));
    const nearby = new Map();
    function add(name, province, point) {
        const key = JSON.stringify([name, province]);
        if (!nearby.has(key)) nearby.set(key, []);
        nearby.get(key).push(point);
    }
    for (const row of existing) {
        if (row.lon != null && row.lat != null) add(normalize(row.ten_dia_diem), row.ma_tinh, { id: row.id, lon: row.lon, lat: row.lat });
    }
    return rows.map(row => {
        if (!row.ma_tinh) return { row, status: 'unmatched_province', target: null };
        if (sources.has(row.source_key)) return { row, status: 'existing_source', target: sources.get(row.source_key) };
        const point = { lon: row.longitude, lat: row.latitude };
        const candidates = nearby.get(JSON.stringify([row.normalized, row.ma_tinh])) || [];
        const duplicate = candidates.find(p => distanceMeters(p, point) <= 250);
        if (duplicate) return { row, status: 'duplicate', target: duplicate.id ?? duplicate.source_key };
        add(row.normalized, row.ma_tinh, { ...point, source_key: row.source_key });
        return { row, status: 'inserted', target: row.source_key };
    });
}
module.exports = { distanceMeters, planTourism };
