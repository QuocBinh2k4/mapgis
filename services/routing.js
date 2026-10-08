const MODES = new Set(['car', 'motorcycle', 'bicycle', 'foot']);
class RouteError extends Error {
    constructor(message, status = 422) { super(message); this.status = status; }
}
function validateRequest(body) {
    const { start, destinationId, mode = 'car' } = body || {};
    if (!MODES.has(mode)) throw new RouteError('Phương tiện không hợp lệ.', 400);
    if (!start || typeof start.lat !== 'number' || typeof start.lng !== 'number' || !Number.isFinite(start.lat) || !Number.isFinite(start.lng) || Math.abs(start.lat) > 90 || Math.abs(start.lng) > 180) throw new RouteError('Điểm xuất phát phải có tọa độ hợp lệ.', 400);
    if (!Number.isSafeInteger(destinationId) || destinationId < 1) throw new RouteError('Vui lòng chọn điểm du lịch muốn đến.', 400);
    return { start, destinationId, mode };
}
function boundsFor(start, end, marginMeters) {
    const dy = marginMeters / 110000;
    const dx = marginMeters / (110000 * Math.max(.2, Math.cos(Math.max(Math.abs(start.lat), Math.abs(end.lat)) * Math.PI / 180)));
    return [Math.max(-180, Math.min(start.lng, end.lng) - dx), Math.max(-90, Math.min(start.lat, end.lat) - dy), Math.min(180, Math.max(start.lng, end.lng) + dx), Math.min(90, Math.max(start.lat, end.lat) + dy)];
}
function haversine(a, b) {
    const r = Math.PI / 180;
    const h = Math.sin((b.lat-a.lat)*r/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lng-a.lng)*r/2)**2;
    return 6371000 * 2 * Math.asin(Math.min(1,Math.sqrt(h)));
}

async function nearestEdge(client, point, mode, label) {
    const result = await client.query(`WITH p AS (SELECT ST_SetSRID(ST_MakePoint($1,$2),4326) AS geom), candidates AS (
        SELECT e.*,ST_LineLocatePoint(e.geom,p.geom) AS fraction,
            ST_Distance(e.geom::geography,p.geom::geography) AS gap
        FROM routing.edges e,p
        WHERE (e.${mode}_forward OR e.${mode}_backward)
          AND e.geom && ST_Expand(p.geom,.03)
          AND ST_DWithin(e.geom::geography,p.geom::geography,1500)
        ORDER BY e.geom <-> p.geom LIMIT 20
    ) SELECT *,ST_AsGeoJSON(ST_LineInterpolatePoint(geom,fraction))::json AS snapped
      FROM candidates ORDER BY gap,id LIMIT 1`, [point.lng,point.lat]);
    if (!result.rows.length) throw new RouteError(`${label} cách mạng đường phù hợp quá xa (trên 1,5 km). Hãy chọn vị trí gần đường hoặc đổi phương tiện.`);
    return result.rows[0];
}

async function splitEndpoints(client, startSnap, endSnap) {
    await client.query('CREATE TEMP TABLE route_splits (LIKE routing.edges INCLUDING DEFAULTS) ON COMMIT DROP');
    await client.query('ALTER TABLE route_splits ADD COLUMN original_id bigint');
    const edgeIds = [...new Set([String(startSnap.id),String(endSnap.id)])];
    const maxId = Number((await client.query('SELECT max(id) AS id FROM routing.edges')).rows[0].id);
    let nextEdge = maxId + 1;
    let nextNode = -100;
    const nodes = [];
    const cuts = new Map();
    for (const snap of [startSnap,endSnap]) {
        if (snap.fraction < 1e-8) { nodes.push(Number(snap.source)); continue; }
        if (snap.fraction > 1-1e-8) { nodes.push(Number(snap.target)); continue; }
        const list = cuts.get(String(snap.id)) || [];
        const same = list.find(cut => Math.abs(cut.fraction-snap.fraction)<1e-8);
        if (same) nodes.push(same.node);
        else { const cut = {fraction:snap.fraction,node:nextNode--}; list.push(cut); nodes.push(cut.node); }
        cuts.set(String(snap.id),list);
    }
    const replaced = [];
    const permissionColumns = [...MODES].flatMap(mode => [`${mode}_forward`,`${mode}_backward`,`${mode}_speed`]).join(',');
    for (const edgeId of edgeIds) {
        if (!cuts.has(edgeId)) continue;
        const snap = String(startSnap.id)===edgeId ? startSnap : endSnap;
        const points = [{fraction:0,node:Number(snap.source)},...cuts.get(edgeId).sort((a,b)=>a.fraction-b.fraction),{fraction:1,node:Number(snap.target)}];
        replaced.push(Number(edgeId));
        for (let i=0;i<points.length-1;i++) {
            const a=points[i], b=points[i+1];
            await client.query(`INSERT INTO route_splits (id,osm_way_id,source,target,name,highway,geom,${permissionColumns},tags,length_m,original_id)
                SELECT $1,osm_way_id,$2,$3,name,highway,ST_LineSubstring(geom,$4,$5),${permissionColumns},tags,
                    ST_Length(ST_LineSubstring(geom,$4,$5)::geography),id FROM routing.edges WHERE id=$6`,
            [nextEdge++,a.node,b.node,a.fraction,b.fraction,edgeId]);
        }
    }
    return { startNode:nodes[0],endNode:nodes[1],replaced };
}

function graphSql(mode,bounds,replaced,penalties=[]) {
    // All interpolated values below are validated enum values or numbers from our database/calculations.
    const envelope = `ST_MakeEnvelope(${bounds.join(',')},4326)`;
    const excluded = replaced.length ? `AND id NOT IN (${replaced.join(',')})` : '';
    const factor = penalties.length ? `CASE WHEN id IN (${penalties.join(',')}) THEN 2.5 ELSE 1 END` : '1';
    return `SELECT id,source,target,
        CASE WHEN ${mode}_forward THEN length_m*(${factor}) ELSE -1 END AS cost,
        CASE WHEN ${mode}_backward THEN length_m*(${factor}) ELSE -1 END AS reverse_cost
        FROM (SELECT * FROM routing.edges WHERE geom && ${envelope} ${excluded}
              UNION ALL SELECT ${['id','osm_way_id','source','target','name','highway','geom',...[...MODES].flatMap(m=>[`${m}_forward`,`${m}_backward`,`${m}_speed`]),'tags','length_m'].join(',')} FROM route_splits) e
        WHERE ${mode}_forward OR ${mode}_backward`;
}
function restrictionSql(mode) {
    return `SELECT ARRAY[
        COALESCE((SELECT s.id FROM route_splits s WHERE s.original_id=t.from_edge AND (s.source=t.via_node OR s.target=t.via_node) LIMIT 1),t.from_edge),
        COALESCE((SELECT s.id FROM route_splits s WHERE s.original_id=t.to_edge AND (s.source=t.via_node OR s.target=t.via_node) LIMIT 1),t.to_edge)
        ]::bigint[] AS path,1e15::float8 AS cost FROM routing.turns t WHERE mode='${mode}'`;
}
async function computePath(client, context, bounds, penalty=[]) {
    if (context.signal?.aborted) throw new RouteError('Đã hủy yêu cầu tìm đường.',499);
    if (context.startNode===context.endNode) return [];
    if (context.deadline && Date.now()>=context.deadline) throw new RouteError('Tính tuyến vượt quá thời gian cho phép. Vui lòng thử tuyến ngắn hơn.',503);
    if (context.deadline) await client.query(`SET LOCAL statement_timeout='${Math.max(1,Math.min(35000,context.deadline-Date.now()))}ms'`);
    const rows = (await client.query(`SELECT path_seq,node,edge,cost,agg_cost FROM pgr_trsp($1,$2,$3::bigint,$4::bigint,true) ORDER BY path_seq`,
        [graphSql(context.mode,bounds,context.replaced,penalty),restrictionSql(context.mode),context.startNode,context.endNode])).rows;
    if (!rows.length || rows.some(row=>Number(row.agg_cost)>=1e14)) return null;
    return rows.filter(row=>Number(row.edge)!==-1);
}
async function describePath(client,path,mode,snaps) {
    if (!path.length) return { distance:0,duration:0,edges:[],coordinates:[snaps[0].snapped.coordinates,snaps[1].snapped.coordinates],steps:[] };
    const edges = path.map(row=>Number(row.edge)), nodes = path.map(row=>Number(row.node));
    const rows = (await client.query(`WITH all_edges AS (
        SELECT id,source,target,name,highway,geom,length_m,${mode}_speed AS speed FROM routing.edges WHERE id=ANY($1::bigint[])
        UNION ALL SELECT id,source,target,name,highway,geom,length_m,${mode}_speed FROM route_splits WHERE id=ANY($1::bigint[])
    ) SELECT e.id,e.name,e.highway,e.length_m,e.speed,
        ST_AsGeoJSON(CASE WHEN e.source=p.node THEN e.geom ELSE ST_Reverse(e.geom) END)::json AS geometry
        FROM unnest($1::bigint[],$2::bigint[]) WITH ORDINALITY p(id,node,ord)
        JOIN all_edges e ON e.id=p.id ORDER BY p.ord`,[edges,nodes])).rows;
    const coordinates=[],steps=[];
    let distance=0,duration=0;
    for (const row of rows) {
        const line=row.geometry.coordinates;
        if (coordinates.length) {
            const last=coordinates[coordinates.length-1];
            if (Math.abs(last[0]-line[0][0])>1e-6 || Math.abs(last[1]-line[0][1])>1e-6) throw new Error('Disconnected route geometry');
        }
        coordinates.push(...(coordinates.length?line.slice(1):line));
        distance+=row.length_m;
        duration+=row.length_m/(row.speed/3.6);
        const name=row.name || 'Đường chưa có tên';
        const previous=steps[steps.length-1];
        if(previous?.name===name) previous.distance+=row.length_m;
        else steps.push({name,distance:row.length_m,coordinate:line[0]});
    }
    return {distance,duration,edges,coordinates,steps};
}
function isDistinct(candidate,routes) {
    return routes.every(route=>{
        const edgeSet=new Set(route.edges);
        const shared=candidate.edges.filter(id=>edgeSet.has(id)).length;
        return shared/Math.max(1,Math.min(route.edges.length,candidate.edges.length))<.9;
    });
}

async function route(pool,body,signal) {
    const {start,destinationId,mode}=validateRequest(body);
    const client=await pool.connect();
    let cancellation;
    const abort=()=>{ cancellation=pool.query('SELECT pg_cancel_backend($1)',[client.processID]).catch(()=>{}); };
    if(signal)signal.addEventListener('abort',abort,{once:true});
    try {
        if(signal?.aborted)throw new RouteError('Đã hủy yêu cầu tìm đường.',499);
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout='35s'");
        const available=(await client.query("SELECT to_regclass('routing.edges') AS edges,to_regclass('routing.turns') AS turns,to_regclass('routing.imports') AS imports")).rows[0];
        if(!available.edges || !available.turns || !available.imports) throw new RouteError('Dữ liệu đường chưa được nhập đầy đủ vào máy chủ.',503);
        const destination=(await client.query('SELECT id,ten_dia_diem,ST_X(ST_Transform(geom,4326)) AS lng,ST_Y(ST_Transform(geom,4326)) AS lat FROM diem_du_lich WHERE id=$1 AND geom IS NOT NULL',[destinationId])).rows[0];
        if(!destination) throw new RouteError('Không tìm thấy điểm du lịch.',404);
        const end={lat:destination.lat,lng:destination.lng};
        const startSnap=await nearestEdge(client,start,mode,'Điểm xuất phát');
        const endSnap=await nearestEdge(client,end,mode,'Điểm du lịch');
        const split=await splitEndpoints(client,startSnap,endSnap);
        const context={...split,mode,deadline:Date.now()+120000,signal};
        const direct=haversine(start,end);
        let path=null,bounds;
        for(const margin of [Math.max(5000,direct*.35),Math.max(30000,direct),2500000]) {
            bounds=boundsFor(start,end,margin);
            path=await computePath(client,context,bounds);
            if(path!==null) break;
        }
        if(path===null) throw new RouteError('Không có tuyến liên thông phù hợp với phương tiện đã chọn. Hãy đổi phương tiện hoặc điểm xuất phát.');
        let primary=await describePath(client,path,mode,[startSnap,endSnap]);
        // A route shorter than this candidate cannot leave its distance envelope.
        bounds=boundsFor(start,end,Math.max(1000,primary.distance+startSnap.gap+endSnap.gap));
        // Giữ tuyến đã tìm được nếu kiểm tra miền rộng hơn hết thời gian.
        await client.query('SAVEPOINT verify_route');
        let verified;
        try { verified=await computePath(client,context,bounds); }
        catch(error) {
            await client.query('ROLLBACK TO SAVEPOINT verify_route');
            if(error.code!=='57014' && error.status!==503) throw error;
        }
        await client.query('RELEASE SAVEPOINT verify_route');
        if(verified!=null) primary=await describePath(client,verified,mode,[startSnap,endSnap]);
        const routes=[primary];
        const penalties=new Set(primary.edges);
        if(primary.distance>20) for(let attempt=0;attempt<3 && routes.length<3;attempt++) {
            await client.query('SAVEPOINT alternative_route');
            let alternative;
            try { alternative=await computePath(client,context,bounds,[...penalties]); }
            catch(error) {
                await client.query('ROLLBACK TO SAVEPOINT alternative_route');
                if(error.code==='57014' || error.status===503) break;
                throw error;
            }
            await client.query('RELEASE SAVEPOINT alternative_route');
            if(!alternative) break;
            const candidate=await describePath(client,alternative,mode,[startSnap,endSnap]);
            if(candidate.distance>primary.distance*1.8+100) break;
            const previousSize=penalties.size;
            candidate.edges.forEach(id=>penalties.add(id));
            if(isDistinct(candidate,routes)) routes.push(candidate);
            if(penalties.size===previousSize) break;
        }
        routes.sort((a,b)=>a.distance-b.distance);
        const metadata=(await client.query('SELECT imported_at,source FROM routing.imports ORDER BY imported_at DESC LIMIT 1')).rows[0];
        await client.query('COMMIT');
        return {
            mode,destination:{id:destination.id,name:destination.ten_dia_diem,...end},
            start,source:'OpenStreetMap contributors / Geofabrik',dataDate:metadata?.source?.lastModified,
            snaps:{start:{coordinates:startSnap.snapped.coordinates,gapMeters:Math.round(startSnap.gap)},end:{coordinates:endSnap.snapped.coordinates,gapMeters:Math.round(endSnap.gap)}},
            routes:routes.map((item,index)=>({id:index+1,distanceMeters:Math.round(item.distance),durationSeconds:Math.round(item.duration),geometry:{type:'LineString',coordinates:item.coordinates},steps:item.steps.map(step=>({...step,distance:Math.round(step.distance)}))})),
            notes:['Thời gian ước tính, chưa tính giao thông trực tiếp.','Đoạn nét đứt nối điểm chọn với đường gần nhất, chưa phải tuyến di chuyển đã xác minh.']
        };
    } catch(error) {
        if(signal)signal.removeEventListener('abort',abort);
        if(cancellation)await cancellation;
        await client.query('ROLLBACK').catch(()=>{});
        if(signal?.aborted)throw new RouteError('Đã hủy yêu cầu tìm đường.',499);
        if(error.code==='57014') throw new RouteError('Tuyến đường quá phức tạp để tính trong thời gian cho phép. Hãy chọn điểm xuất phát gần hơn.',503);
        throw error;
    } finally {
        if(signal)signal.removeEventListener('abort',abort);
        if(cancellation)await cancellation;
        client.release();
    }
}
function registerRouting(app,pool) {
    const provider = process.env.ROUTING_PROVIDER || 'valhalla';
    if (!['valhalla','pgrouting'].includes(provider)) throw new Error('ROUTING_PROVIDER phải là valhalla hoặc pgrouting.');
    let active=0;
    app.get('/api/routing/status',async(req,res)=>{
        try {
            if (provider === 'valhalla') return res.json({ready:true,provider,modes:[...MODES],source:'OpenStreetMap contributors / Valhalla (FOSSGIS)'});
            const available=(await pool.query("SELECT to_regclass('routing.edges') AS edges,to_regclass('routing.turns') AS turns,to_regclass('routing.imports') AS imports")).rows[0];
            if(!available.edges || !available.turns || !available.imports) return res.json({ready:false,modes:[...MODES],error:'Dữ liệu mạng đường chưa được nhập đầy đủ.'});
            const data=(await pool.query('SELECT imported_at,source,stats FROM routing.imports ORDER BY imported_at DESC LIMIT 1')).rows[0];
            res.json({ready:!!data,provider,modes:[...MODES],...data});
        }catch(error){res.status(503).json({ready:false,error:'Chưa kết nối được dữ liệu đường.'});}
    });
    app.post('/api/routes',async(req,res)=>{
        if(active>=2) return res.status(429).json({error:'Máy chủ đang tính tuyến khác. Vui lòng thử lại sau ít giây.'});
        active++;
        const controller=new AbortController();
        res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        try {
            const data=provider==='pgrouting' ? await route(pool,req.body,controller.signal)
                : await require('./valhalla').routeValhalla(pool,req.body,controller.signal,validateRequest);
            if(!controller.signal.aborted)res.json(data);
        }
        catch(error){if(!error.status)console.error('Routing error:',error.message);if(!controller.signal.aborted)res.status(error.status||500).json({error:error.status?error.message:'Không thể tính tuyến đường. Vui lòng thử lại.'});}
        finally{active--;}
    });
}
module.exports={registerRouting,route,validateRequest,boundsFor,isDistinct,graphSql};
