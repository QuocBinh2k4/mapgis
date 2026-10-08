const { ApiError } = require('./auth');
function pagination(query) {
    const page=Number(query.page || 1), limit=Number(query.limit || 25);
    if (!Number.isSafeInteger(page) || page<1 || page>100000 || !Number.isSafeInteger(limit) || limit<1 || limit>100) throw new ApiError('Phân trang không hợp lệ.');
    return {page,limit,offset:(page-1)*limit};
}
function uuid(value) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new ApiError('Mã người dùng không hợp lệ.');
    return value;
}
function positiveId(value) {
    const id=Number(value);
    if (!Number.isSafeInteger(id) || id<1) throw new ApiError('Mã điểm du lịch không hợp lệ.');
    return id;
}
function tourismInput(body) {
    const name=typeof body?.ten_dia_diem==='string' ? body.ten_dia_diem.trim() : '';
    if (!name || name.length>255) throw new ApiError('Tên điểm du lịch phải có từ 1 đến 255 ký tự.');
    const lat=body.lat, lng=body.lng, category=body.loai_id;
    if (typeof lat!=='number' || typeof lng!=='number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) throw new ApiError('Vĩ độ hoặc kinh độ không hợp lệ.');
    if (!Number.isSafeInteger(category) || category<1) throw new ApiError('Hãy chọn loại hình du lịch.');
    const optional=(key,max)=>{
        const value=body[key];
        if (value==null || value==='') return null;
        if (typeof value!=='string' || value.length>max) throw new ApiError(`Trường ${key} không hợp lệ hoặc quá dài.`);
        return value.trim() || null;
    };
    const image=optional('hinh_anh_url',2048);
    if (image) {
        let url; try { url=new URL(image); } catch { throw new ApiError('Đường dẫn ảnh không hợp lệ.'); }
        if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new ApiError('Ảnh phải dùng đường dẫn HTTP hoặc HTTPS.');
    }
    return {name,lat,lng,category,address:optional('dia_chi',2000),description:optional('mo_ta_ngan',500),image};
}
const tourismColumns = `d.id,d.ten_dia_diem,d.loai_id,d.ma_tinh,d.dia_chi,d.mo_ta_ngan,d.hinh_anh_url,
    d.deleted_at,d.updated_at,d.version,ST_X(ST_Transform(d.geom,4326)) AS lng,ST_Y(ST_Transform(d.geom,4326)) AS lat,p.ten_tinh,l.ten_loai`;
function registerAdmin(app,pool,auth) {
    const {api,requireAdmin,publicUser}=auth;
    async function mutation(req,action,resourceType,resourceId,callback) {
        const actor=await requireAdmin(req,true);
        const client=await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL lock_timeout='5s'");
            await client.query("SELECT pg_advisory_xact_lock(hashtext('mapgis-admin-write'))");
            const current=(await client.query("SELECT id FROM app_users WHERE id=$1 AND role='admin' AND status='active' FOR SHARE",[actor.id])).rows[0];
            if (!current) throw new ApiError('Quyền quản trị đã thay đổi. Hãy tải lại trang.',403);
            const result=await callback(client,actor);
            await client.query(`INSERT INTO admin_audit_logs(actor_id,action,resource_type,resource_id,changes) VALUES($1,$2,$3,$4,$5::jsonb)`,
                [actor.id,action,resourceType,String(result.resourceId || resourceId),JSON.stringify(result.changes || {})]);
            await client.query('COMMIT'); return result.data;
        } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
        finally { client.release(); }
    }
    app.get('/api/admin/stats',api(async(req,res)=>{
        await requireAdmin(req);
        const data=(await pool.query(`SELECT
            (SELECT count(*)::int FROM app_users) AS users,
            (SELECT count(*)::int FROM app_users WHERE status='active') AS active_users,
            (SELECT count(*)::int FROM diem_du_lich WHERE deleted_at IS NULL) AS tourism,
            (SELECT count(*)::int FROM diem_du_lich WHERE deleted_at IS NOT NULL) AS archived_tourism,
            (SELECT count(*)::int FROM user_favorites) AS favorites`)).rows[0];
        res.json(data);
    }));
    app.get('/api/admin/options',api(async(req,res)=>{
        await requireAdmin(req);
        const [provinces,categories]=await Promise.all([pool.query('SELECT ma_tinh,ten_tinh FROM ranh_gioi_tinh ORDER BY ten_tinh'),pool.query('SELECT id,ma_loai,ten_loai FROM danh_muc_loai ORDER BY ten_loai')]);
        res.json({provinces:provinces.rows,categories:categories.rows});
    }));
    app.get('/api/admin/users',api(async(req,res)=>{
        await requireAdmin(req);
        const {page,limit,offset}=pagination(req.query);
        const search=String(req.query.q || '').trim().slice(0,120);
        const status=String(req.query.status || 'all');
        if (!['all','active','blocked','archived'].includes(status)) throw new ApiError('Trạng thái không hợp lệ.');
        const where="WHERE ($1='' OR u.email ILIKE '%'||$1||'%' OR u.display_name ILIKE '%'||$1||'%') AND ($2='all' OR u.status=$2)";
        const params=[search,status];
        const [items,total]=await Promise.all([
            pool.query(`SELECT u.id,u.email,u.display_name,u.picture_url,u.role,u.status,u.created_at,u.updated_at,u.last_login_at,u.version,
                (SELECT count(*)::int FROM user_favorites f WHERE f.user_id=u.id) AS favorites_count FROM app_users u ${where}
                ORDER BY u.created_at DESC,u.id LIMIT $3 OFFSET $4`,[...params,limit,offset]),
            pool.query(`SELECT count(*)::int AS total FROM app_users u ${where}`,params)
        ]);
        res.json({items:items.rows,total:total.rows[0].total,page,limit});
    }));
    app.get('/api/admin/users/:id',api(async(req,res)=>{
        await requireAdmin(req);
        const id=uuid(req.params.id), user=(await pool.query('SELECT * FROM app_users WHERE id=$1',[id])).rows[0];
        if (!user) throw new ApiError('Không tìm thấy người dùng.',404);
        const favorites=(await pool.query(`SELECT d.id,d.ten_dia_diem,d.deleted_at,p.ten_tinh,f.created_at FROM user_favorites f
            JOIN diem_du_lich d ON d.id=f.tourism_id LEFT JOIN ranh_gioi_tinh p ON p.ma_tinh=d.ma_tinh WHERE f.user_id=$1 ORDER BY f.created_at DESC`,[id])).rows;
        res.json({user:publicUser(user),favorites});
    }));
    app.patch('/api/admin/users/:id',api(async(req,res)=>{
        const id=uuid(req.params.id);
        const {role,status,version}=req.body || {};
        const name=typeof req.body?.display_name==='string' ? req.body.display_name.trim() : '';
        if (!name || name.length>120 || !['user','admin'].includes(role) || !['active','blocked','archived'].includes(status) || !Number.isSafeInteger(version)) throw new ApiError('Tên, vai trò, trạng thái hoặc phiên bản tài khoản không hợp lệ.');
        const data=await mutation(req,'update_user','user',id,async(client,actor)=>{
            const current=(await client.query('SELECT * FROM app_users WHERE id=$1 FOR UPDATE',[id])).rows[0];
            if (!current) throw new ApiError('Không tìm thấy người dùng.',404);
            if (current.version!==version) throw new ApiError('Tài khoản đã được cập nhật ở nơi khác. Hãy tải lại danh sách.',409);
            if (id===actor.id && (role!==current.role || status!==current.status)) throw new ApiError('Không thể đổi quyền hoặc khóa tài khoản quản trị đang đăng nhập.');
            if (current.role==='admin' && current.status==='active' && (role!=='admin' || status!=='active')) {
                const count=(await client.query("SELECT count(*)::int AS n FROM app_users WHERE role='admin' AND status='active'")).rows[0].n;
                if (count<=1) throw new ApiError('Cần giữ ít nhất một quản trị viên đang hoạt động.');
            }
            const updated=(await client.query('UPDATE app_users SET display_name=$1,role=$2,status=$3,updated_at=now(),version=version+1 WHERE id=$4 RETURNING *',[name,role,status,id])).rows[0];
            if (status!=='active' || role!==current.role) await client.query('DELETE FROM app_sessions WHERE user_id=$1',[id]);
            return {data:{user:publicUser(updated)},changes:{before:{display_name:current.display_name,role:current.role,status:current.status},after:{display_name:name,role,status}}};
        }); res.json(data);
    }));
    app.post('/api/admin/users/:id/revoke-sessions',api(async(req,res)=>{
        const id=uuid(req.params.id);
        const data=await mutation(req,'revoke_sessions','user',id,async client=>{
            if (!(await client.query('SELECT id FROM app_users WHERE id=$1',[id])).rows.length) throw new ApiError('Không tìm thấy người dùng.',404);
            await client.query('DELETE FROM app_sessions WHERE user_id=$1',[id]);
            return {data:{ok:true}};
        }); res.json(data);
    }));
    app.delete('/api/admin/users/:id/favorites/:placeId',api(async(req,res)=>{
        const id=uuid(req.params.id), place=positiveId(req.params.placeId);
        const data=await mutation(req,'remove_favorite','user',id,async client=>{
            await client.query('DELETE FROM user_favorites WHERE user_id=$1 AND tourism_id=$2',[id,place]);
            return {data:{ok:true},changes:{tourism_id:place}};
        }); res.json(data);
    }));
    app.get('/api/admin/tourism',api(async(req,res)=>{
        await requireAdmin(req);
        const {page,limit,offset}=pagination(req.query), search=String(req.query.q || '').trim().slice(0,120);
        const state=String(req.query.state || 'active'), province=String(req.query.province || '');
        if (!['all','active','archived'].includes(state) || province.length>10) throw new ApiError('Bộ lọc điểm du lịch không hợp lệ.');
        const where=`WHERE ($1='' OR d.ten_dia_diem ILIKE '%'||$1||'%' OR d.dia_chi ILIKE '%'||$1||'%')
            AND ($2='all' OR ($2='active' AND d.deleted_at IS NULL) OR ($2='archived' AND d.deleted_at IS NOT NULL)) AND ($3='' OR d.ma_tinh=$3)`;
        const params=[search,state,province];
        const [items,total]=await Promise.all([
            pool.query(`SELECT ${tourismColumns} FROM diem_du_lich d LEFT JOIN ranh_gioi_tinh p ON p.ma_tinh=d.ma_tinh LEFT JOIN danh_muc_loai l ON l.id=d.loai_id ${where} ORDER BY d.id DESC LIMIT $4 OFFSET $5`,[...params,limit,offset]),
            pool.query(`SELECT count(*)::int AS total FROM diem_du_lich d ${where}`,params)
        ]); res.json({items:items.rows,total:total.rows[0].total,page,limit});
    }));
    async function resolvePlace(client,input) {
        if (!(await client.query('SELECT id FROM danh_muc_loai WHERE id=$1',[input.category])).rows.length) throw new ApiError('Loại hình không tồn tại.');
        const province=(await client.query(`SELECT ma_tinh FROM ranh_gioi_tinh WHERE geom IS NOT NULL
            AND ST_Covers(ST_Transform(geom,4326),ST_SetSRID(ST_MakePoint($1,$2),4326)) ORDER BY ma_tinh LIMIT 1`,[input.lng,input.lat])).rows[0];
        if (!province) throw new ApiError('Tọa độ nằm ngoài ranh giới tỉnh đã nhập. Hãy kiểm tra lại vị trí.');
        return province.ma_tinh;
    }
    app.post('/api/admin/tourism',api(async(req,res)=>{
        const input=tourismInput(req.body);
        const data=await mutation(req,'create_tourism','tourism','new',async(client,actor)=>{
            const province=await resolvePlace(client,input);
            const place=(await client.query(`INSERT INTO diem_du_lich(ten_dia_diem,loai_id,ma_tinh,dia_chi,mo_ta_ngan,hinh_anh_url,geom,created_by,updated_by)
                VALUES($1,$2,$3,$4,$5,$6,ST_SetSRID(ST_MakePoint($7,$8),4326),$9,$9) RETURNING id`,[input.name,input.category,province,input.address,input.description,input.image,input.lng,input.lat,actor.id])).rows[0];
            return {resourceId:place.id,data:{id:place.id},changes:{name:input.name,province}};
        }); res.status(201).json(data);
    }));
    app.patch('/api/admin/tourism/:id',api(async(req,res)=>{
        const id=positiveId(req.params.id), input=tourismInput(req.body), version=req.body?.version;
        if (!Number.isSafeInteger(version)) throw new ApiError('Thiếu phiên bản điểm du lịch. Hãy tải lại danh sách.');
        const data=await mutation(req,'update_tourism','tourism',id,async(client,actor)=>{
            const current=(await client.query('SELECT ten_dia_diem,version FROM diem_du_lich WHERE id=$1 FOR UPDATE',[id])).rows[0];
            if (!current) throw new ApiError('Không tìm thấy điểm du lịch.',404);
            if (current.version!==version) throw new ApiError('Điểm du lịch đã được cập nhật ở nơi khác. Hãy tải lại danh sách.',409);
            const province=await resolvePlace(client,input);
            await client.query(`UPDATE diem_du_lich SET ten_dia_diem=$1,loai_id=$2,ma_tinh=$3,dia_chi=$4,mo_ta_ngan=$5,hinh_anh_url=$6,
                geom=ST_SetSRID(ST_MakePoint($7,$8),4326),updated_by=$9,updated_at=now(),version=version+1 WHERE id=$10`,[input.name,input.category,province,input.address,input.description,input.image,input.lng,input.lat,actor.id,id]);
            return {data:{id},changes:{before:{name:current.ten_dia_diem},after:{name:input.name,province}}};
        }); res.json(data);
    }));
    app.patch('/api/admin/tourism/:id/visibility',api(async(req,res)=>{
        const id=positiveId(req.params.id), {archived,version}=req.body || {};
        if (typeof archived!=='boolean' || !Number.isSafeInteger(version)) throw new ApiError('Trạng thái hiển thị không hợp lệ.');
        const data=await mutation(req,archived ? 'archive_tourism' : 'restore_tourism','tourism',id,async(client,actor)=>{
            const updated=(await client.query(`UPDATE diem_du_lich SET deleted_at=CASE WHEN $1 THEN now() ELSE NULL END,
                updated_by=$2,updated_at=now(),version=version+1 WHERE id=$3 AND version=$4 RETURNING id`,[archived,actor.id,id,version])).rows;
            if (!updated.length) throw new ApiError('Điểm du lịch không tồn tại hoặc đã được cập nhật. Hãy tải lại danh sách.',409);
            return {data:{id,archived},changes:{archived}};
        }); res.json(data);
    }));
    app.get('/api/admin/audit',api(async(req,res)=>{
        await requireAdmin(req);
        const {page,limit,offset}=pagination(req.query);
        const [items,total]=await Promise.all([pool.query(`SELECT a.id,a.action,a.resource_type,a.resource_id,a.changes,a.created_at,COALESCE(u.display_name,'Chủ database (CLI)') AS actor_name
            FROM admin_audit_logs a LEFT JOIN app_users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT $1 OFFSET $2`,[limit,offset]),pool.query('SELECT count(*)::int AS total FROM admin_audit_logs')]);
        res.json({items:items.rows,total:total.rows[0].total,page,limit});
    }));
}
module.exports = {registerAdmin,tourismInput,pagination};
