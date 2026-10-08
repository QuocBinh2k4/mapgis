const test = require('node:test');
const assert = require('node:assert/strict');
const { decodePolyline, convertTrip } = require('../services/valhalla');

test('decode polyline6 preserves longitude/latitude order and rejects truncated data', () => {
    // Hai tọa độ [0,0] và [0.000001,0.000001].
    assert.deepEqual(decodePolyline('??AA'), [[0,0],[.000001,.000001]]);
    assert.throws(()=>decodePolyline('A'), {status:502});
});
test('Valhalla kilometres become metres, and malformed geometry cannot become a route', () => {
    const trip={summary:{length:1.2,time:300},legs:[{shape:{type:'LineString',coordinates:[[105,21],[105.01,21]]},maneuvers:[{street_names:['Đường A'],length:1.2,begin_shape_index:0}]}]};
    const route=convertTrip(trip,1);
    assert.equal(route.distanceMeters,1200);
    assert.equal(route.durationSeconds,300);
    assert.equal(route.steps[0].distance,1200);
    assert.deepEqual(route.geometry.coordinates[0],[105,21]);
    assert.throws(()=>convertTrip({...trip,summary:{length:NaN,time:300}},1),{status:502});
    assert.throws(()=>convertTrip({...trip,legs:[{shape:{coordinates:[[105,21],[1000,21]]}}]},1),{status:502});
});
