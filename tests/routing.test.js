const test = require('node:test');
const assert = require('node:assert/strict');
const {route,validateRequest,boundsFor,isDistinct} = require('../services/routing');
const {createClient} = require('../scripts/db');

test('reject invalid coordinates, destination IDs and unrecognized modes', () => {
    const valid={start:{lat:21.02,lng:105.85},destinationId:1,mode:'motorcycle'};
    assert.equal(validateRequest(valid).mode,'motorcycle');
    for(const input of [null,{...valid,mode:'car;DROP TABLE x'},{...valid,start:{lat:NaN,lng:105}},{...valid,start:{lat:91,lng:105}},{...valid,destinationId:'1'},{...valid,destinationId:-1}]) assert.throws(()=>validateRequest(input),{status:400});
});
test('route search envelope contains endpoints and detour margin', () => {
    const box=boundsFor({lat:21,lng:105},{lat:22,lng:106},10000);
    assert.ok(box[0]<105 && box[1]<21 && box[2]>106 && box[3]>22);
});
test('identical or almost identical routes are not presented as alternatives', () => {
    const route={edges:[1,2,3,4,5,6,7,8,9,10]};
    assert.equal(isDistinct(route,[route]),false);
    assert.equal(isDistinct({edges:[1,2,3,4,5,6,7,8,9,11]},[route]),false);
    assert.equal(isDistinct({edges:[1,20,21,22,10]},[route]),true);
});
test('pgRouting respects one-way edges, virtual endpoints and forbidden turns', async () => {
    const client=createClient();
    try {
        await client.connect();
        await client.query('BEGIN');
        await client.query(`CREATE TEMP TABLE routing_test_edges(id bigint,source bigint,target bigint,cost float8,reverse_cost float8) ON COMMIT DROP`);
        await client.query(`INSERT INTO routing_test_edges VALUES(1,-100,2,1,-1),(2,2,4,1,-1),(3,-100,3,2,-1),(4,3,4,2,-1)`);
        const edges='SELECT * FROM routing_test_edges';
        const empty='SELECT ARRAY[]::bigint[] AS path,0::float8 AS cost WHERE false';
        const run=async(restrictions,start=-100,end=4)=>(await client.query('SELECT edge,agg_cost FROM pgr_trsp($1,$2,$3::bigint,$4::bigint,true)',[edges,restrictions,start,end])).rows;
        assert.deepEqual((await run(empty)).filter(r=>Number(r.edge)!==-1).map(r=>Number(r.edge)),[1,2]);
        assert.deepEqual((await run('SELECT ARRAY[1,2]::bigint[] AS path,1e15::float8 AS cost')).filter(r=>Number(r.edge)!==-1).map(r=>Number(r.edge)),[3,4]);
        assert.equal((await run(empty,4,-100)).length,0);
        await client.query('ROLLBACK');
    } finally { await client.end(); }
});

test('full route splits a shared road at both endpoints and respects vehicle direction', async () => {
    const client = createClient();
    try {
        await client.connect();
        const permissions = ['car','motorcycle','bicycle','foot'].flatMap(m => [`${m}_forward boolean`,`${m}_backward boolean`,`${m}_speed float8`]).join(',');
        await client.query('BEGIN'); // Giữ một backend khi kết nối qua Neon transaction pooler.
        await client.query(`DROP TABLE IF EXISTS pg_temp.fixture_edges,pg_temp.fixture_turns,pg_temp.fixture_imports,pg_temp.fixture_destinations;
            CREATE TEMP TABLE fixture_edges(id bigint,osm_way_id bigint,source bigint,target bigint,name text,highway text,geom geometry(LineString,4326),${permissions},tags jsonb,length_m float8) ON COMMIT DROP;
            CREATE TEMP TABLE fixture_turns(from_edge bigint,to_edge bigint,via_node bigint,mode text) ON COMMIT DROP;
            CREATE TEMP TABLE fixture_imports(imported_at timestamptz,source jsonb) ON COMMIT DROP;
            CREATE TEMP TABLE fixture_destinations(id integer,ten_dia_diem text,geom geometry(Point,4326),deleted_at timestamptz) ON COMMIT DROP;
            INSERT INTO fixture_edges VALUES(1,100,1,2,'Đường thử','residential',ST_GeomFromText('LINESTRING(105 21,105.01 21)',4326),true,false,30,true,false,25,true,true,16,true,true,4.5,'{}',1000);
            INSERT INTO fixture_destinations(id,ten_dia_diem,geom) VALUES(1,'Điểm thử',ST_SetSRID(ST_MakePoint(105.0075,21),4326));
            INSERT INTO fixture_imports VALUES(now(),'{}')`);
        const rewrite = sql => sql.replaceAll('routing.edges','pg_temp.fixture_edges').replaceAll('routing.turns','pg_temp.fixture_turns').replaceAll('routing.imports','pg_temp.fixture_imports').replaceAll('diem_du_lich','pg_temp.fixture_destinations');
        const query = async (sql, values) => {
            if(sql==='BEGIN') return client.query('SAVEPOINT fixture_route');
            if(sql==='COMMIT') { await client.query('DROP TABLE route_splits'); return client.query('RELEASE SAVEPOINT fixture_route'); }
            if(sql==='ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT fixture_route'); return client.query('RELEASE SAVEPOINT fixture_route'); }
            return client.query(rewrite(sql),values?.map(value => typeof value === 'string' ? rewrite(value) : value));
        };
        const pool = { connect: async () => ({ query, release() {} }), query };
        const result = await route(pool,{start:{lat:21,lng:105.0025},destinationId:1,mode:'car'});
        assert.equal(result.routes.length,1);
        assert.ok(result.routes[0].distanceMeters > 400 && result.routes[0].distanceMeters < 600);
        assert.ok(Math.abs(result.routes[0].geometry.coordinates[0][0]-105.0025)<1e-6);
        assert.ok(Math.abs(result.routes[0].geometry.coordinates.at(-1)[0]-105.0075)<1e-6);
        await client.query("UPDATE fixture_destinations SET geom=ST_SetSRID(ST_MakePoint(105.0025,21),4326)");
        await assert.rejects(route(pool,{start:{lat:21,lng:105.0075},destinationId:1,mode:'car'}),{status:422});
        const walk=await route(pool,{start:{lat:21,lng:105.0075},destinationId:1,mode:'foot'});
        assert.ok(walk.routes[0].distanceMeters>400);
    } finally { await client.query('ROLLBACK').catch(()=>{}); await client.end(); }
});
