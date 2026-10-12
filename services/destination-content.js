const { ApiError } = require('./auth');

function slugify(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d')
        .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100).replace(/-$/,'') || 'diem-den';
}
function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try { const url=new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { return null; }
}
function contentInput(value) {
    if (value===undefined) return undefined;
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new ApiError('Thông tin chi tiết không hợp lệ.');
    const result={};
    for (const [key,max] of Object.entries({story:4000,opening_hours:600,ticket_price:600,best_season:1000,transport:2000,cultural_notes:2000,tips:2000})) {
        if (value[key]==null || value[key]==='') continue;
        if (typeof value[key]!=='string' || value[key].length>max) throw new ApiError(`Thông tin ${key} không hợp lệ hoặc quá dài.`);
        result[key]=value[key].trim();
    }
    for (const [key,max] of [['gallery',8],['sources',5]]) {
        if (value[key]===undefined) continue;
        if (!Array.isArray(value[key]) || value[key].length>max) throw new ApiError(`${key==='gallery'?'Thư viện ảnh':'Nguồn tham khảo'} tối đa ${max} mục.`);
        result[key]=value[key].map(item=>{
            const url=safeUrl(item?.url);
            if (!url) throw new ApiError('Đường dẫn phải dùng HTTP/HTTPS và không chứa thông tin đăng nhập.');
            const clean={url};
            for (const field of key==='gallery'?['caption','credit']:['label']) {
                if (item[field]!=null && (typeof item[field]!=='string' || item[field].length>250)) throw new ApiError('Chú thích ảnh hoặc nguồn quá dài.');
                clean[field]=(item[field] || '').trim();
            }
            return clean;
        });
    }
    const total=JSON.stringify(result).length;
    if(total>10500)throw new ApiError('Thông tin chi tiết quá dài. Hãy rút gọn nội dung hoặc số ảnh.');
    return result;
}
async function assignSlug(client, id, name) {
    const current=(await client.query('SELECT slug FROM diem_du_lich WHERE id=$1',[id])).rows[0];
    if(current?.slug)return current.slug;
    const base=slugify(name);
    let slug=base, attempt=0;
    while ((await client.query('SELECT id FROM diem_du_lich WHERE slug=$1 AND id<>$2',[slug,id])).rows.length) {
        slug=`${base}-${id}${attempt?'-'+attempt:''}`;attempt++;
    }
    await client.query('UPDATE diem_du_lich SET slug=$1 WHERE id=$2 AND slug IS NULL',[slug,id]);
    return slug;
}
async function backfillSlugs(client) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('mapgis-admin-write'))");
    const rows=(await client.query('SELECT id,ten_dia_diem,slug FROM diem_du_lich ORDER BY id')).rows;
    const used=new Set(rows.filter(row=>row.slug).map(row=>row.slug)), changes=[];
    for(const row of rows) {
        if(row.slug)continue;
        const base=slugify(row.ten_dia_diem);let slug=base,attempt=0;
        while(used.has(slug)){slug=`${base}-${row.id}${attempt?'-'+attempt:''}`;attempt++;}
        used.add(slug);changes.push({id:row.id,slug});
    }
    for(let i=0;i<changes.length;i+=500)await client.query(`UPDATE diem_du_lich d SET slug=x.slug
        FROM jsonb_to_recordset($1::jsonb) AS x(id int,slug text) WHERE d.id=x.id AND d.slug IS NULL`,[JSON.stringify(changes.slice(i,i+500))]);
}
module.exports={slugify,safeUrl,contentInput,assignSlug,backfillSlugs};
