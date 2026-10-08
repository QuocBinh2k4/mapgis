const crypto = require('node:crypto');
const { ApiError } = require('./auth');

function itineraryInput(body) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 120) throw new ApiError('Tên lịch trình phải có từ 1 đến 120 ký tự.');
    if (!Array.isArray(body.days) || !body.days.length || body.days.length > 30) throw new ApiError('Lịch trình cần từ 1 đến 30 ngày.');
    let total = 0;
    const days = body.days.map(day => {
        if (!Array.isArray(day?.places) || day.places.length > 30) throw new ApiError('Mỗi ngày tối đa 30 điểm đến.');
        const places = day.places.map(id => {
            if (!Number.isSafeInteger(id) || id < 1) throw new ApiError('Điểm đến không hợp lệ.');
            return id;
        });
        total += places.length;
        if (new Set(places).size !== places.length) throw new ApiError('Một điểm đến chỉ được thêm một lần trong cùng ngày.');
        return { places };
    });
    if (total > 150) throw new ApiError('Lịch trình tối đa 150 điểm đến.');
    return { title, days };
}
function registerJourneys(app, pool, auth) {
    const { api, requireUser } = auth;
    const validId = id => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiError('Không tìm thấy lịch trình.',404);
        return id;
    };
    async function validatePlaces(days) {
        const ids = [...new Set(days.flatMap(day => day.places))];
        if (!ids.length) return;
        const rows = (await pool.query('SELECT id FROM diem_du_lich WHERE id=ANY($1::int[]) AND deleted_at IS NULL',[ids])).rows;
        if (rows.length !== ids.length) throw new ApiError('Một điểm đến đã bị xóa. Hãy bỏ điểm đó trước khi lưu.');
    }
    app.get('/api/me/itineraries',api(async(req,res) => {
        const user = await requireUser(req);
        res.json({items:(await pool.query('SELECT id,title,days,version,share_token,updated_at FROM user_itineraries WHERE user_id=$1 ORDER BY updated_at DESC',[user.id])).rows});
    }));
    app.post('/api/me/itineraries',api(async(req,res) => {
        const user = await requireUser(req,true), input = itineraryInput(req.body);
        await validatePlaces(input.days);
        const item = (await pool.query('INSERT INTO user_itineraries(id,user_id,title,days) VALUES($1,$2,$3,$4::jsonb) RETURNING id,title,days,version,share_token,updated_at',[crypto.randomUUID(),user.id,input.title,JSON.stringify(input.days)])).rows[0];
        res.status(201).json({item});
    }));
    app.put('/api/me/itineraries/:id',api(async(req,res) => {
        const user = await requireUser(req,true), id = validId(req.params.id), input = itineraryInput(req.body);
        if (!Number.isSafeInteger(req.body.version) || req.body.version < 1) throw new ApiError('Phiên bản lịch trình không hợp lệ.');
        await validatePlaces(input.days);
        const item = (await pool.query(`UPDATE user_itineraries SET title=$1,days=$2::jsonb,version=version+1,updated_at=now()
            WHERE id=$3 AND user_id=$4 AND version=$5 RETURNING id,title,days,version,share_token,updated_at`,[input.title,JSON.stringify(input.days),id,user.id,req.body.version])).rows[0];
        if (!item) {
            if (!(await pool.query('SELECT id FROM user_itineraries WHERE id=$1 AND user_id=$2',[id,user.id])).rows.length) throw new ApiError('Không tìm thấy lịch trình.',404);
            throw new ApiError('Lịch trình đã thay đổi ở thiết bị khác. Tải lại danh sách để nhận bản mới nhất.',409);
        }
        res.json({item});
    }));
    app.delete('/api/me/itineraries/:id',api(async(req,res) => {
        const user = await requireUser(req,true);
        const rows = (await pool.query('DELETE FROM user_itineraries WHERE id=$1 AND user_id=$2 RETURNING id',[validId(req.params.id),user.id])).rows;
        if (!rows.length) throw new ApiError('Không tìm thấy lịch trình.',404);
        res.json({ok:true});
    }));
    app.put('/api/me/itineraries/:id/share',api(async(req,res) => {
        const user = await requireUser(req,true);
        if (typeof req.body?.enabled !== 'boolean') throw new ApiError('Trạng thái chia sẻ không hợp lệ.');
        const item = (await pool.query(`UPDATE user_itineraries SET share_token=CASE WHEN $1 THEN COALESCE(share_token,$2) ELSE NULL END
            WHERE id=$3 AND user_id=$4 RETURNING id,title,days,version,share_token,updated_at`,[req.body.enabled,crypto.randomBytes(24).toString('base64url'),validId(req.params.id),user.id])).rows[0];
        if (!item) throw new ApiError('Không tìm thấy lịch trình.',404);
        res.json({item});
    }));
    app.get('/api/shared/itineraries/:token',api(async(req,res) => {
        res.set('Cache-Control','no-store');
        if (!/^[A-Za-z0-9_-]{32}$/.test(req.params.token)) throw new ApiError('Link không tồn tại hoặc đã ngừng chia sẻ.',404);
        const item = (await pool.query(`SELECT i.title,i.days FROM user_itineraries i JOIN app_users u ON u.id=i.user_id
            WHERE i.share_token=$1 AND u.status='active'`,[req.params.token])).rows[0];
        if (!item) throw new ApiError('Link không tồn tại hoặc đã ngừng chia sẻ.',404);
        const ids = [...new Set(item.days.flatMap(day => day.places))];
        const places = (await pool.query(`SELECT d.id,d.ten_dia_diem,p.ten_tinh FROM diem_du_lich d LEFT JOIN ranh_gioi_tinh p ON p.ma_tinh=d.ma_tinh
            WHERE d.id=ANY($1::int[]) AND d.deleted_at IS NULL`,[ids])).rows;
        res.json({item,places});
    }));
}
module.exports = { registerJourneys, itineraryInput };
