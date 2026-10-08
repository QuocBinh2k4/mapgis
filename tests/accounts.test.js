const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const express=require('express');
const {createClient}=require('../scripts/db');
const {registerAuth}=require('../services/auth');
const {registerAdmin,tourismInput}=require('../services/admin');
const {registerData}=require('../services/data');
const {registerJourneys}=require('../services/journeys');
const {validateRequest}=require('../services/routing');
const {routeValhalla}=require('../services/valhalla');

test('tourism editor rejects unsafe image URLs, nonnumeric coordinates and invalid categories',()=>{
    const data={ten_dia_diem:'Điểm thử',lat:21,lng:105,loai_id:1};
    assert.equal(tourismInput(data).name,'Điểm thử');
    for(const change of [{hinh_anh_url:'javascript:alert(1)'},{hinh_anh_url:'https://name:password@example.com/a'},{lat:'21'},{lat:Infinity},{loai_id:'1'}])assert.throws(()=>tourismInput({...data,...change}),{status:400});
});

test('Google registration, sessions, CSRF, admin permissions and tourism lifecycle use an isolated rollback schema',async(t)=>{
    const client=createClient();let server;
    const schema=`accounts_test_${crypto.randomBytes(6).toString('hex')}`;
    const tables=['app_users','app_sessions','app_login_challenges','user_favorites','user_itineraries','admin_audit_logs','diem_du_lich','ranh_gioi_tinh','danh_muc_loai'];
    const names=new RegExp(`\\b(${tables.join('|')})\\b`,'g');
    const rewrite=sql=>sql.replace(names,name=>`${schema}.${name}`);
    let serial=0, base;
    const pool={query:(sql,values)=>client.query(rewrite(sql),values),connect:async()=>{
        const savepoint=`request_${++serial}`;
        return {release(){},query:async(sql,values)=>{
            if(sql==='BEGIN')return client.query(`SAVEPOINT ${savepoint}`);
            if(sql==='COMMIT')return client.query(`RELEASE SAVEPOINT ${savepoint}`);
            if(sql==='ROLLBACK'){await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);return client.query(`RELEASE SAVEPOINT ${savepoint}`);}
            return pool.query(sql,values);
        }};
    }};
    function browser() {
        const jar=new Map();
        return {jar,async request(url,method='GET',body,csrf,origin='http://localhost:3000',cookieOverride){
            const response=await fetch(base+url,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),Cookie:cookieOverride ?? [...jar].map(([key,value])=>`${key}=${value}`).join('; ')},body:body?JSON.stringify(body):undefined});
            const setCookies=response.headers.getSetCookie();
            for(const cookie of setCookies){const [entry]=cookie.split(';');const index=entry.indexOf('=');const key=entry.slice(0,index),value=entry.slice(index+1);if(value)jar.set(key,value);else jar.delete(key);}
            return {status:response.status,data:await response.json(),setCookies};
        }};
    }
    let verificationCalls=0;
    const payloads=new Map();
    async function login(person,key,email,extra={}) {
        const config=(await person.request('/api/auth/config')).data;
        payloads.set(key,{sub:key,email,name:key,email_verified:true,nonce:config.nonce,...extra});
        return person.request('/api/auth/google','POST',{credential:key,role:'admin'},config.csrfToken);
    }
    try {
        await client.connect();await client.query('BEGIN');await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`CREATE TABLE ${schema}.ranh_gioi_tinh(id serial PRIMARY KEY,ma_tinh varchar(10) UNIQUE,ten_tinh text,dien_tich float8,dan_so integer,geom geometry(MultiPolygon,4326));
            CREATE TABLE ${schema}.danh_muc_loai(id serial PRIMARY KEY,ma_loai text UNIQUE,ten_loai text);
            CREATE TABLE ${schema}.diem_du_lich(id serial PRIMARY KEY,ten_dia_diem varchar(255),loai_id integer REFERENCES ${schema}.danh_muc_loai(id),ma_tinh varchar(10) REFERENCES ${schema}.ranh_gioi_tinh(ma_tinh),dia_chi text,mo_ta_ngan text,hinh_anh_url text,geom geometry(Point,4326));
            INSERT INTO ${schema}.ranh_gioi_tinh(ma_tinh,ten_tinh,geom) VALUES('01','Tỉnh thử',ST_Multi(ST_MakeEnvelope(105,21,106,22,4326)));
            INSERT INTO ${schema}.danh_muc_loai(ma_loai,ten_loai) VALUES('DI_TICH','Di tích');
            INSERT INTO ${schema}.diem_du_lich(ten_dia_diem,loai_id,ma_tinh,geom) VALUES('Điểm có sẵn',1,'01',ST_SetSRID(ST_MakePoint(105.5,21.5),4326))`);
        await client.query(rewrite(fs.readFileSync(path.join(__dirname,'../sql/users-admin.sql'),'utf8')));
        await client.query(rewrite(fs.readFileSync(path.join(__dirname,'../sql/journeys.sql'),'utf8')));
        const app=express();app.use(express.json());
        const auth=registerAuth(app,pool,{clientId:'test.apps.googleusercontent.com',origin:'http://localhost:3000',adminEmails:'admin@gmail.com,outside@example.com',verifyCredential:async credential=>{verificationCalls++;if(!payloads.has(credential))throw Error('Invalid Google token');return payloads.get(credential);}});
        registerAdmin(app,pool,auth);registerData(app,pool);
        registerJourneys(app,pool,auth);
        server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
        const guest=browser(),member=browser(),admin=browser();let memberSession,adminSession;
        await t.test('unauthenticated visitors cannot read admin records',async()=>{
            assert.equal((await guest.request('/api/admin/users')).status,401);
            assert.equal((await guest.request('/api/admin/tourism')).status,401);
        });
        await t.test('login checks origin, CSRF, signed nonce and verified email before creating an account',async()=>{
            const config=(await guest.request('/api/auth/config')).data;
            assert.equal((await guest.request('/api/auth/google','POST',{credential:'invalid'},config.csrfToken,'https://evil.example')).status,403);
            const previous=verificationCalls;
            assert.equal((await guest.request('/api/auth/google','POST',{credential:'invalid'},'wrong-csrf')).status,403);
            assert.equal(verificationCalls,previous);
            assert.equal((await guest.request('/api/auth/google','POST',{credential:'invalid'},config.csrfToken)).status,401);
            assert.equal((await login(guest,'wrong-nonce','invalid@gmail.com',{nonce:'wrong'})).status,401);
            assert.equal((await login(guest,'unverified','invalid@gmail.com',{email_verified:false})).status,401);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM app_users')).rows[0].n,0);
        });
        await t.test('Google registration defaults to user despite a forged admin role in the request',async()=>{
            const result=await login(member,'member','member@gmail.com');assert.equal(result.status,200);
            memberSession=result.data;assert.equal(memberSession.user.role,'user');
            assert.ok(result.setCookies.some(cookie=>cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')));
            assert.ok(!('google_sub' in memberSession.user));
            assert.equal((await member.request('/api/admin/users')).status,403);
            const configured=await login(admin,'admin','admin@gmail.com');assert.equal(configured.status,200);adminSession=configured.data;assert.equal(adminSession.user.role,'admin');
            assert.equal((await admin.request('/api/admin/users')).status,200);
        });
        await t.test('favorites belong to the logged-in user and require CSRF',async()=>{
            assert.equal((await member.request('/api/me/favorites/1','PUT')).status,403);
            assert.equal((await member.request('/api/me/favorites/1','PUT',null,memberSession.csrfToken)).status,200);
            assert.equal((await member.request('/api/me/favorites/1','PUT',null,memberSession.csrfToken)).status,200);
            assert.equal((await member.request('/api/me/favorites')).data.items.length,1);
            assert.equal((await admin.request('/api/me/favorites')).data.items.length,0);
        });
        await t.test('collections migrate to want and can move to visited without duplicate favorites',async()=>{
            assert.equal((await member.request('/api/me/favorites')).data.items[0].collection,'want');
            assert.equal((await member.request('/api/me/favorites/1','PUT',{collection:'visited'},memberSession.csrfToken)).status,200);
            const saved=(await member.request('/api/me/favorites')).data.items;
            assert.equal(saved.length,1);assert.equal(saved[0].collection,'visited');
            assert.equal((await member.request('/api/me/favorites/1','PUT',{collection:'bad'},memberSession.csrfToken)).status,400);
        });
        await t.test('itineraries enforce ownership, CSRF, versions and revocable anonymous sharing',async()=>{
            const body={title:'Chuyến đi thử',days:[{places:[1]},{places:[]}]};
            assert.equal((await guest.request('/api/me/itineraries')).status,401);
            assert.equal((await member.request('/api/me/itineraries','POST',body)).status,403);
            assert.equal((await member.request('/api/me/itineraries','POST',{...body,days:[{places:[99999]}]},memberSession.csrfToken)).status,400);
            const created=await member.request('/api/me/itineraries','POST',body,memberSession.csrfToken);
            assert.equal(created.status,201);const id=created.data.item.id;
            assert.equal((await admin.request('/api/me/itineraries')).data.items.length,0);
            assert.equal((await admin.request(`/api/me/itineraries/${id}`,'PUT',{...body,version:1},adminSession.csrfToken)).status,404);
            assert.equal((await admin.request(`/api/me/itineraries/${id}/share`,'PUT',{enabled:true},adminSession.csrfToken)).status,404);
            assert.equal((await admin.request(`/api/me/itineraries/${id}`,'DELETE',null,adminSession.csrfToken)).status,404);
            const edit={title:'Đã sửa',days:[{places:[]},{places:[1]}],version:1};
            assert.equal((await member.request(`/api/me/itineraries/${id}`,'PUT',edit,memberSession.csrfToken)).status,200);
            assert.equal((await member.request(`/api/me/itineraries/${id}`,'PUT',edit,memberSession.csrfToken)).status,409);
            const shared=await member.request(`/api/me/itineraries/${id}/share`,'PUT',{enabled:true},memberSession.csrfToken);
            const token=shared.data.item.share_token;
            const publicTrip=await guest.request(`/api/shared/itineraries/${token}`);
            assert.equal(publicTrip.status,200);assert.equal(publicTrip.data.item.title,'Đã sửa');
            assert.deepEqual(publicTrip.data.item.days,edit.days);
            assert.ok(!('user_id' in publicTrip.data.item));assert.equal(publicTrip.data.places[0].id,1);
            await member.request(`/api/me/itineraries/${id}/share`,'PUT',{enabled:false},memberSession.csrfToken);
            assert.equal((await guest.request(`/api/shared/itineraries/${token}`)).status,404);
            const again=await member.request(`/api/me/itineraries/${id}/share`,'PUT',{enabled:true},memberSession.csrfToken);
            assert.notEqual(again.data.item.share_token,token);
            assert.equal((await member.request(`/api/me/itineraries/${id}`,'DELETE',null,memberSession.csrfToken)).status,200);
            assert.equal((await guest.request(`/api/shared/itineraries/${again.data.item.share_token}`)).status,404);
        });
        await t.test('session hashes, expiry, one-use login challenges and Google subjects protect account identity',async()=>{
            const token=member.jar.get('mapgis_session');
            const stored=(await pool.query('SELECT token_hash FROM app_sessions WHERE user_id=$1',[memberSession.user.id])).rows[0];
            assert.notEqual(stored.token_hash,token);assert.equal(stored.token_hash.length,64);
            await pool.query("UPDATE app_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[memberSession.user.id]);
            assert.equal((await member.request('/api/me/favorites')).status,401);
            await pool.query("UPDATE app_sessions SET expires_at=now()+interval '1 day' WHERE user_id=$1",[memberSession.user.id]);
            const separate=browser();
            const sameEmail=await login(separate,'another-sub','member@gmail.com');
            assert.notEqual(sameEmail.data.user.id,memberSession.user.id);
            assert.equal((await separate.request('/api/me/favorites')).data.items.length,0);
            const external=await login(guest,'outside','outside@example.com');assert.equal(external.data.user.role,'user');
            const config=(await separate.request('/api/auth/config')).data;
            const cookie=[...separate.jar].map(([key,value])=>`${key}=${value}`).join('; ');
            payloads.set('replay',{sub:'another-sub',email:'member@gmail.com',name:'Another name',email_verified:true,nonce:config.nonce});
            assert.equal((await separate.request('/api/auth/google','POST',{credential:'replay'},config.csrfToken)).status,200);
            assert.equal((await separate.request('/api/auth/google','POST',{credential:'replay'},config.csrfToken,'http://localhost:3000',cookie)).status,403);
        });
        let place,placeBody;
        await t.test('admin can create and edit tourism points with spatial province assignment and optimistic concurrency',async()=>{
            placeBody={ten_dia_diem:"Điểm du lịch O'Brien",loai_id:1,lat:21.55,lng:105.55,mo_ta_ngan:'Mô tả thử'};
            assert.equal((await member.request('/api/admin/tourism','POST',placeBody,memberSession.csrfToken)).status,403);
            assert.equal((await admin.request('/api/admin/tourism','POST',placeBody,'wrong')).status,403);
            const created=await admin.request('/api/admin/tourism','POST',placeBody,adminSession.csrfToken);assert.equal(created.status,201);place=created.data.id;
            const detail=(await admin.request('/api/admin/tourism?q=O%27Brien')).data.items[0];assert.equal(detail.ma_tinh,'01');assert.equal(detail.lng,105.55);
            assert.equal((await admin.request(`/api/admin/tourism/${place}`,'PATCH',{...placeBody,lat:50,lng:100,version:1},adminSession.csrfToken)).status,400);
            assert.equal((await admin.request(`/api/admin/tourism/${place}`,'PATCH',{...placeBody,ten_dia_diem:'Điểm đã sửa',version:1},adminSession.csrfToken)).status,200);
            assert.equal((await admin.request(`/api/admin/tourism/${place}`,'PATCH',{...placeBody,version:1},adminSession.csrfToken)).status,409);
        });
        await t.test('archived tourism is hidden from the map and routing, then can be restored',async()=>{
            assert.equal((await admin.request(`/api/admin/tourism/${place}/visibility`,'PATCH',{archived:true,version:2},adminSession.csrfToken)).status,200);
            assert.ok(!(await guest.request('/api/diemdulich')).data.features.some(feature=>feature.properties.id===place));
            await assert.rejects(routeValhalla(pool,{start:{lat:21.5,lng:105.5},destinationId:place,mode:'car'},null,validateRequest),{status:404});
            assert.equal((await admin.request(`/api/admin/tourism/${place}/visibility`,'PATCH',{archived:false,version:3},adminSession.csrfToken)).status,200);
            assert.ok((await guest.request('/api/diemdulich')).data.features.some(feature=>feature.properties.id===place));
        });
        await t.test('blocking an account revokes its session and preserves favorites for admin management',async()=>{
            const detail=(await admin.request(`/api/admin/users/${memberSession.user.id}`)).data;
            assert.equal(detail.favorites.length,1);
            const changed=await admin.request(`/api/admin/users/${memberSession.user.id}`,'PATCH',{display_name:'Đã khóa',role:'user',status:'blocked',version:detail.user.version},adminSession.csrfToken);assert.equal(changed.status,200);
            assert.equal((await member.request('/api/auth/me')).data.user,null);
            assert.equal((await member.request('/api/me/favorites')).status,401);
            assert.equal((await admin.request(`/api/admin/users/${memberSession.user.id}`)).data.favorites.length,1);
            assert.equal((await login(member,'member','member@gmail.com')).status,403);
        });
        await t.test('admin cannot demote their own account and all successful mutations are audited',async()=>{
            const current=(await admin.request('/api/auth/me')).data.user;
            assert.equal((await admin.request(`/api/admin/users/${current.id}`,'PATCH',{display_name:current.display_name,role:'user',status:'active',version:current.version},adminSession.csrfToken)).status,400);
            const log=(await admin.request('/api/admin/audit')).data;
            assert.ok(log.items.some(item=>item.action==='create_tourism'));
            assert.ok(log.items.some(item=>item.action==='update_user'));
            assert.equal((await admin.request('/api/auth/logout','POST',null,adminSession.csrfToken)).status,200);
            assert.equal((await admin.request('/api/admin/users')).status,401);
        });
    }finally{
        if(server)await new Promise(resolve=>server.close(resolve));
        await client.query('ROLLBACK').catch(()=>{});await client.end();
    }
});
