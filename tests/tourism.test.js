const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, classify, prepare } = require('../scripts/import-tourism');
const { prepareBoundaries } = require('../scripts/import-boundaries');
const { planTourism, distanceMeters } = require('../scripts/tourism-plan');

test('OSM: ưu tiên tên Việt, giữ thứ tự kinh/vĩ độ, loại tọa độ lỗi', () => {
    const result = prepare({ elements: [
        { type: 'node', id: 1, lat: 21, lon: 105, tags: { name: 'Museum', 'name:vi': 'Bảo tàng', tourism: 'museum' } },
        { type: 'way', id: 2, center: { lat: 10, lon: 106 }, tags: { name: 'Chùa', amenity: 'place_of_worship' } },
        { type: 'node', id: 3, lat: 100, lon: 105, tags: { name: 'Lỗi' } }
    ] });
    assert.equal(result.records.length, 2);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.records[0].name, 'Bảo tàng');
    assert.equal(result.records[0].lon, 105);
    assert.equal(result.records[1].coordinateMethod, 'osm_bbox_center');
    assert.equal(classify({ tourism: 'museum' }), 'BAO_TANG');
});
test('Kế hoạch nhập: mã nguồn có sẵn, trùng gần, khác tỉnh và ngoài ranh giới', () => {
    const row = (key, province, lon = 105) => ({ source_key: key, normalized: normalize('Chùa A'), ma_tinh: province, latitude: 21, longitude: lon });
    const planned = planTourism([
        row('node/1', '01'), row('way/2', '01', 105.0001), row('node/3', '22'),
        row('node/4', null), row('node/5', '01', 105.1), row('way/6', '01', 105.1001)
    ], [{ id: 10, ten_dia_diem: 'Chùa A', ma_tinh: '01', lat: 21, lon: 105, nguon_du_lieu: 'OpenStreetMap', nguon_id: 'node/1' }], normalize);
    assert.deepEqual(planned.map(p => p.status), ['existing_source', 'duplicate', 'inserted', 'unmatched_province', 'inserted', 'duplicate']);
    assert.equal(planned[1].target, 10);
    assert.equal(planned[5].target, 'node/5');
    assert.ok(distanceMeters({ lat: 21, lon: 105 }, { lat: 21, lon: 105.0001 }) < 250);
});
test('Ranh giới: giữ mã 01, chặn trùng mã và hệ tọa độ chiếu', () => {
    const feature = { type: 'Feature', properties: { ma_tinh: '01', ten_tinh: 'Hà Nội' }, geometry: { type: 'Polygon', coordinates: [[[105, 21], [106, 21], [106, 22], [105, 21]]] } };
    const data = { type: 'FeatureCollection', features: [feature] };
    assert.equal(prepareBoundaries(data)[0].code, '01');
    assert.throws(() => prepareBoundaries({ ...data, features: [feature, feature] }), /trùng/);
    assert.throws(() => prepareBoundaries({ ...data, features: [{ ...feature, geometry: { type: 'Polygon', coordinates: [[[500000, 2300000]]] } }] }), /WGS84/);
});
