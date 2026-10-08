const test = require('node:test');
const assert = require('node:assert/strict');
const {validateRequest,boundsFor,isDistinct} = require('../services/routing');
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
