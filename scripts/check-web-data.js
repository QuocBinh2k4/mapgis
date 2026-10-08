const assert = require('node:assert/strict');

// Chạy API với chính transaction đang kiểm tra, rồi đóng pool/server thử nghiệm.
async function checkWebData(client, expectedPoints) {
    const app = require('../server');
    app.locals.pool.query = (...args) => client.query(...args);
    const server = app.listen(0, '127.0.0.1');
    try {
        await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const results = {};
        for (const route of ['ranhgioi', 'diemdulich']) {
            const response = await fetch(`${base}/api/${route}`, { signal: AbortSignal.timeout(30000) });
            assert.equal(response.status, 200, `API ${route}`);
            const body = await response.text();
            const data = JSON.parse(body);
            assert.equal(data.type, 'FeatureCollection');
            assert.ok(Array.isArray(data.features));
            results[route] = { features: data.features.length, bytes: Buffer.byteLength(body) };
        }
        assert.equal(results.diemdulich.features, expectedPoints);
        assert.ok(results.ranhgioi.features > 0);
        return results;
    } finally {
        await new Promise(resolve => server.close(resolve));
        await app.locals.pool.end();
    }
}
module.exports = { checkWebData };
