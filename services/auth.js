const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client();
class ApiError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
function cookies(req) {
    const result = {};
    for (const entry of (req.headers.cookie || '').split(';')) {
        const index = entry.indexOf('=');
        if (index < 0) continue;
        try { result[entry.slice(0,index).trim()] = decodeURIComponent(entry.slice(index+1).trim()); } catch {}
    }
    return result;
}
function safeEqual(a,b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length > 300 || b.length > 300) return false;
    const left = Buffer.from(a), right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left,right);
}
function publicUser(row) {
    const { id,email,display_name,picture_url,role,status,created_at,updated_at,last_login_at,version } = row;
    return { id,email,display_name,picture_url,role,status,created_at,updated_at,last_login_at,version };
}
function api(handler) {
    return async (req,res) => {
        try { await handler(req,res); }
        catch (error) {
            if (!error.status) console.error('Account/admin API:', error.code || error.message);
            res.status(error.status || 500).json({ error: error.status ? error.message : 'Không thể xử lý yêu cầu. Vui lòng thử lại.' });
        }
    };
}
function registerAuth(app, pool, options = {}) {
    const clientId = options.clientId ?? process.env.GOOGLE_CLIENT_ID ?? '';
    const origin = new URL(options.origin || process.env.APP_ORIGIN || 'http://localhost:3000').origin;
    const secure = origin.startsWith('https:');
    const cookieOptions = { httpOnly:true, secure, sameSite:'lax', path:'/' };
    const sessionCookie = secure ? '__Host-mapgis_session' : 'mapgis_session';
    const challengeCookie = secure ? '__Host-mapgis_login' : 'mapgis_login';
    const admins = new Set((options.adminEmails ?? process.env.ADMIN_EMAILS ?? '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
    const verifyCredential = options.verifyCredential || (async credential => {
        const ticket = await googleClient.verifyIdToken({ idToken:credential, audience:clientId });
        return ticket.getPayload();
    });
    app.use(['/api/auth','/api/me','/api/admin'],(req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });
    function checkOrigin(req) {
        if (req.headers.origin !== origin) throw new ApiError('Nguồn gửi yêu cầu không hợp lệ. Kiểm tra APP_ORIGIN.',403);
    }
    async function loadSession(req) {
        const token = cookies(req)[sessionCookie];
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
        const row = (await pool.query(`SELECT u.*,s.csrf_token,s.token_hash FROM app_sessions s JOIN app_users u ON u.id=s.user_id
            WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active'`,[hash(token)])).rows[0];
        return row || null;
    }
    async function requireUser(req, write = false) {
        const user = await loadSession(req);
        if (!user) throw new ApiError('Vui lòng đăng nhập để tiếp tục.',401);
        if (write) {
            checkOrigin(req);
            if (!safeEqual(req.headers['x-csrf-token'],user.csrf_token)) throw new ApiError('Phiên xác nhận không hợp lệ. Hãy tải lại trang.',403);
        }
        req.account = user;
        return user;
    }
    async function requireAdmin(req, write = false) {
        const user = await requireUser(req,write);
        if (user.role !== 'admin') throw new ApiError('Tài khoản chưa có quyền quản trị.',403);
        return user;
    }
    app.get('/api/auth/config', api(async(req,res)=>{
        if (!clientId) return res.json({configured:false,clientId:null});
        const token=randomToken(), csrfToken=randomToken(), nonce=randomToken();
        await pool.query("DELETE FROM app_login_challenges WHERE expires_at<now()");
        await pool.query(`INSERT INTO app_login_challenges(token_hash,csrf_hash,nonce_hash,expires_at) VALUES($1,$2,$3,now()+interval '20 minutes')`,[hash(token),hash(csrfToken),hash(nonce)]);
        res.cookie(challengeCookie,token,{...cookieOptions,maxAge:20*60*1000});
        res.json({configured:true,clientId,csrfToken,nonce});
    }));
    app.post('/api/auth/google', api(async(req,res)=>{
        checkOrigin(req);
        if (!clientId) throw new ApiError('Đăng nhập Google chưa được cấu hình.',503);
        const credential = req.body?.credential;
        if (typeof credential!=='string' || credential.length>12000) throw new ApiError('Thông tin đăng nhập Google không hợp lệ.');
        const challenge = cookies(req)[challengeCookie];
        const csrf = req.headers['x-csrf-token'];
        if (!challenge || typeof csrf !== 'string') throw new ApiError('Phiên đăng nhập đã hết hạn. Hãy tải lại trang.',403);
        const saved = (await pool.query('SELECT nonce_hash FROM app_login_challenges WHERE token_hash=$1 AND csrf_hash=$2 AND expires_at>now()',[hash(challenge),hash(csrf)])).rows[0];
        if (!saved) throw new ApiError('Phiên đăng nhập đã hết hạn. Hãy tải lại trang.',403);
        let payload;
        try { payload = await verifyCredential(credential); }
        catch { throw new ApiError('Không xác minh được tài khoản Google. Hãy đăng nhập lại.',401); }
        if (typeof payload?.sub!=='string' || !payload.sub || payload.sub.length>255 || typeof payload.email!=='string' || !payload.email || payload.email.length>320 || payload.email_verified!==true || !safeEqual(hash(payload.nonce || ''),saved.nonce_hash)) throw new ApiError('Tài khoản Google hoặc phiên xác minh không hợp lệ.',401);
        const email = payload.email.toLowerCase();
        const authoritative = email.endsWith('@gmail.com') || !!payload.hd;
        const role = admins.has(email) && authoritative ? 'admin' : 'user';
        const client=await pool.connect();
        try {
            await client.query('BEGIN');
            const consumed=(await client.query('DELETE FROM app_login_challenges WHERE token_hash=$1 AND csrf_hash=$2 AND nonce_hash=$3 AND expires_at>now() RETURNING token_hash',[hash(challenge),hash(csrf),hash(payload.nonce)])).rows;
            if (!consumed.length) throw new ApiError('Phiên đăng nhập đã được sử dụng. Hãy tải lại trang.',403);
            const name=String(payload.name || email).slice(0,120);
            const picture=/^https:\/\//i.test(payload.picture || '') ? payload.picture : null;
            const user=(await client.query(`INSERT INTO app_users(id,google_sub,email,email_verified,google_name,display_name,picture_url,role,last_login_at)
                VALUES($1,$2,$3,true,$4,$5,$6,$7,now()) ON CONFLICT(google_sub) DO UPDATE SET
                email=EXCLUDED.email,email_verified=true,google_name=EXCLUDED.google_name,picture_url=EXCLUDED.picture_url,last_login_at=now(),updated_at=now()
                RETURNING *`,[crypto.randomUUID(),payload.sub,email,String(payload.name || email).slice(0,200),name,picture,role])).rows[0];
            if (user.status!=='active') throw new ApiError('Tài khoản đang bị khóa hoặc lưu trữ. Hãy liên hệ quản trị viên.',403);
            const token=randomToken(), csrfToken=randomToken();
            const previous=cookies(req)[sessionCookie];
            if (previous) await client.query('DELETE FROM app_sessions WHERE token_hash=$1',[hash(previous)]);
            await client.query('DELETE FROM app_sessions WHERE expires_at<now()');
            await client.query("INSERT INTO app_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[hash(token),user.id,csrfToken]);
            await client.query('COMMIT');
            res.cookie(sessionCookie,token,{...cookieOptions,maxAge:7*24*60*60*1000});
            res.clearCookie(challengeCookie,cookieOptions);
            res.json({user:publicUser(user),csrfToken});
        } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
        finally { client.release(); }
    }));
    app.get('/api/auth/me',api(async(req,res)=>{
        const user=await loadSession(req);
        res.json({user:user ? publicUser(user) : null,csrfToken:user?.csrf_token || null});
    }));
    app.post('/api/auth/logout',api(async(req,res)=>{
        const user=await requireUser(req,true);
        await pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[user.token_hash]);
        res.clearCookie(sessionCookie,cookieOptions); res.json({ok:true});
    }));
    app.patch('/api/me/profile',api(async(req,res)=>{
        const user=await requireUser(req,true);
        const name=String(req.body?.display_name || '').trim();
        if (!name || name.length>120) throw new ApiError('Tên hiển thị phải có từ 1 đến 120 ký tự.');
        const updated=(await pool.query('UPDATE app_users SET display_name=$1,updated_at=now(),version=version+1 WHERE id=$2 RETURNING *',[name,user.id])).rows[0];
        res.json({user:publicUser(updated)});
    }));
    app.get('/api/me/favorites',api(async(req,res)=>{
        const user=await requireUser(req);
        const rows=(await pool.query(`SELECT d.id,d.ten_dia_diem,p.ten_tinh,f.created_at FROM user_favorites f
            JOIN diem_du_lich d ON d.id=f.tourism_id LEFT JOIN ranh_gioi_tinh p ON p.ma_tinh=d.ma_tinh
            WHERE f.user_id=$1 AND d.deleted_at IS NULL ORDER BY f.created_at DESC`,[user.id])).rows;
        res.json({items:rows});
    }));
    for (const method of ['put','delete']) app[method]('/api/me/favorites/:id',api(async(req,res)=>{
        const user=await requireUser(req,true);
        const id=Number(req.params.id);
        if (!Number.isSafeInteger(id) || id<1) throw new ApiError('Mã điểm du lịch không hợp lệ.');
        if (method==='put') {
            const inserted=(await pool.query(`INSERT INTO user_favorites(user_id,tourism_id) SELECT $1,id FROM diem_du_lich
                WHERE id=$2 AND deleted_at IS NULL ON CONFLICT DO NOTHING RETURNING tourism_id`,[user.id,id])).rows;
            if (!inserted.length && !(await pool.query('SELECT id FROM diem_du_lich WHERE id=$1 AND deleted_at IS NULL',[id])).rows.length) throw new ApiError('Không tìm thấy điểm du lịch.',404);
        } else await pool.query('DELETE FROM user_favorites WHERE user_id=$1 AND tourism_id=$2',[user.id,id]);
        res.json({saved:method==='put'});
    }));
    return {requireUser,requireAdmin,api,ApiError,publicUser};
}
module.exports = {registerAuth,api,ApiError,hash,publicUser,safeEqual};
