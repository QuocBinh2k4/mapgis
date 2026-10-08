const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const app = require('../server');
const pool = app.locals.pool;

async function main() {
    const server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const results=[];
    try {
        const status=await (await fetch(`${base}/api/routing/status`)).json();
        assert.equal(status.ready,true);
        if (status.provider !== 'valhalla') assert.ok(status.stats.edges>100000);
        const invalid=await fetch(`${base}/api/routes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:{lat:0,lng:0},destinationId:1,mode:'invalid'})});
        assert.equal(invalid.status,400);
        const targets=(await pool.query(`SELECT id,ten_dia_diem,ST_X(geom) AS lng,ST_Y(geom) AS lat
            FROM diem_du_lich WHERE ma_tinh='01'
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint(105.8523763,21.0307296),4326) LIMIT 1`)).rows;
        const target=targets[0];
        assert.ok(target, 'Cần ít nhất một điểm du lịch Hà Nội để kiểm thử');
        for(const mode of ['car','motorcycle','bicycle','foot']) {
            if(status.provider==='valhalla') await new Promise(resolve=>setTimeout(resolve,1100));
            const started=Date.now();
            const response=await fetch(`${base}/api/routes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:{lat:21.0255,lng:105.8412},destinationId:target.id,mode}),signal:AbortSignal.timeout(150000)});
            const data=await response.json();
            assert.equal(response.status,200,`${mode}: ${data.error}`);
            assert.ok(data.routes.length>=1 && data.routes.length<=3);
            data.routes.forEach(route=>{
                assert.ok(route.distanceMeters>100 && route.durationSeconds>0);
                assert.equal(route.geometry.type,'LineString');
                assert.ok(route.geometry.coordinates.length>2);
                for(const coordinate of route.geometry.coordinates) assert.ok(coordinate.every(Number.isFinite));
            });
            assert.equal(new Set(data.routes.map(r=>JSON.stringify(r.geometry))).size,data.routes.length);
            const result={mode,destination:target.ten_dia_diem,elapsedMs:Date.now()-started,routes:data.routes.map(r=>({meters:r.distanceMeters,seconds:r.durationSeconds,points:r.geometry.coordinates.length})),snaps:data.snaps};
            results.push(result);console.log(JSON.stringify(result));
        }
        if(status.provider==='valhalla') await new Promise(resolve=>setTimeout(resolve,1100));
        const far=await fetch(`${base}/api/routes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:{lat:16,lng:112},destinationId:target.id,mode:'car'})});
        assert.equal(far.status,422);
        const exposure=await fetch(`${base}/server.js`);assert.equal(exposure.status,404);
        fs.writeFileSync(path.join(__dirname,'..','data','roads','route-tests.json'),JSON.stringify({testedAt:new Date().toISOString(),status:'PASS',checks:['ready dataset','invalid input rejected','4 real vehicle routes','unique alternatives','valid geometry','off-network origin rejected','server files not public'],results},null,2));
        console.log('PASS: routing HTTP integration tests.');
    } finally {await new Promise(resolve=>server.close(resolve));await pool.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
