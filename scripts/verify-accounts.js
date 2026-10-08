const assert = require('node:assert/strict');
const app = require('../server');

async function main() {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const requiredTables = ['app_users','app_sessions','app_login_challenges','user_favorites','admin_audit_logs'];
        const tables = (await app.locals.pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1)",[requiredTables])).rows;
        assert.equal(tables.length, requiredTables.length, 'Thiếu bảng tài khoản; chạy npm run db:init.');
        for (const route of ['/','/account','/admin','/js/auth.js','/js/favorites.js','/js/map-layers.js','/js/account.js','/js/admin.js','/css/accounts.css']) {
            const response = await fetch(base + route);
            assert.equal(response.status, 200, route);
            assert.ok((await response.text()).length > 100, route);
        }
        for (const route of ['/api/admin/users','/api/admin/tourism','/api/admin/audit','/api/me/favorites']) {
            const response = await fetch(base + route);
            assert.equal(response.status, 401, route);
            assert.equal(response.headers.get('cache-control'), 'no-store', route);
            assert.equal(response.headers.get('access-control-allow-origin'), null, route);
        }
        const me = await (await fetch(base + '/api/auth/me')).json();
        assert.equal(me.user, null);
        const config = await (await fetch(base + '/api/auth/config')).json();
        const [places,provinces] = await Promise.all(['/api/diemdulich','/api/ranhgioi'].map(async route => {
            const response = await fetch(base + route); assert.equal(response.status, 200, route);
            return response.json();
        }));
        const counts = (await app.locals.pool.query(`SELECT
            (SELECT count(*)::int FROM app_users) AS users,
            (SELECT count(*)::int FROM diem_du_lich WHERE geom IS NOT NULL AND deleted_at IS NULL) AS visible_tourism,
            (SELECT count(*)::int FROM ranh_gioi_tinh WHERE geom IS NOT NULL) AS provinces`)).rows[0];
        assert.equal(places.features.length, counts.visible_tourism);
        assert.equal(provinces.features.length, counts.provinces);
        console.log(JSON.stringify({status:'PASS',googleConfigured:config.configured,counts},null,2));
    } finally {
        await new Promise(resolve => server.close(resolve));
        await app.locals.pool.end();
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
