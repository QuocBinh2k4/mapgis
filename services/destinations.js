const { api, ApiError } = require('./auth');
const { safeUrl, assignSlug } = require('./destination-content');

const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const columns=`d.id,d.slug,d.ten_dia_diem,d.mo_ta_ngan,d.dia_chi,d.hinh_anh_url,d.chi_tiet,d.ma_tinh,d.loai_id,d.updated_at,
    p.ten_tinh,l.ten_loai,l.ma_loai,ST_X(d.geom) AS lng,ST_Y(d.geom) AS lat`;
const joins='FROM diem_du_lich d LEFT JOIN ranh_gioi_tinh p ON p.ma_tinh=d.ma_tinh LEFT JOIN danh_muc_loai l ON l.id=d.loai_id';
function gallery(place) {
    const items=Array.isArray(place.chi_tiet?.gallery)?place.chi_tiet.gallery:[];
    const image=safeUrl(place.hinh_anh_url), result=[],used=new Set();
    for(const item of [...items,...(image?[{url:image,caption:place.ten_dia_diem}]:[])]) {
        const url=safeUrl(item?.url);
        if(url && !used.has(url)){used.add(url);result.push({url,caption:String(item.caption || place.ten_dia_diem),credit:String(item.credit || '')});}
    }
    return result.slice(0,8);
}
function description(place) {
    return String(place.chi_tiet?.story || place.mo_ta_ngan || `Khám phá ${place.ten_dia_diem}${place.ten_tinh?' tại '+place.ten_tinh:''} cùng Việt Nam Ơi.`).replace(/\s+/g,' ').trim().slice(0,170);
}
function cards(items,empty) {
    if(!items.length)return `<p class="muted">${escape(empty)}</p>`;
    return `<div class="related-grid">${items.map(p=>{
        const image=gallery(p)[0],distance=p.distance_m==null?'':` · ${(p.distance_m/1000).toLocaleString('vi-VN',{maximumFractionDigits:1})} km`;
        return `<a class="related-card" href="/diem-den/${escape(p.slug)}">${image?`<img src="${escape(image.url)}" alt="${escape(p.ten_dia_diem)}" loading="lazy" width="480" height="300">`:'<span class="related-placeholder" aria-hidden="true">✦</span>'}<div><small>${escape(p.ten_loai || 'Khám phá')}</small><h3>${escape(p.ten_dia_diem)}</h3><p>${escape(p.ten_tinh || 'Việt Nam')}${escape(distance)}</p></div></a>`;
    }).join('')}</div>`;
}
function renderDestination(place,nearby,recommended,origin) {
    const content=place.chi_tiet || {}, images=gallery(place), canonical=`${origin}/diem-den/${place.slug}`;
    const summary=description(place);
    const sources=(Array.isArray(content.sources)?content.sources:[]).filter(s=>safeUrl(s?.url));
    const facts=[['Giờ mở cửa',content.opening_hours],['Giá vé',content.ticket_price],['Mùa đẹp nhất',content.best_season]];
    const schema={'@context':'https://schema.org','@type':'TouristAttraction',name:place.ten_dia_diem,description:summary,url:canonical,
        ...(images.length?{image:images.map(i=>i.url)}:{}),...(place.dia_chi?{address:place.dia_chi}:{}),
        ...(place.lat!=null && place.lng!=null?{geo:{'@type':'GeoCoordinates',latitude:place.lat,longitude:place.lng}}:{})};
    const json=JSON.stringify(schema).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
    return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escape(place.ten_dia_diem)} — Việt Nam Ơi</title><meta name="description" content="${escape(summary)}"><link rel="canonical" href="${escape(canonical)}">
<meta property="og:type" content="website"><meta property="og:locale" content="vi_VN"><meta property="og:title" content="${escape(place.ten_dia_diem)} — Việt Nam Ơi"><meta property="og:description" content="${escape(summary)}"><meta property="og:url" content="${escape(canonical)}">${images.length?`<meta property="og:image" content="${escape(images[0].url)}">`:''}
<meta name="twitter:card" content="${images.length?'summary_large_image':'summary'}"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/accounts.css"><link rel="stylesheet" href="/css/destination.css"><script type="application/ld+json">${json}</script></head>
<body class="destination-page"><a class="skip-link" href="#destination-story">Đến câu chuyện điểm đến</a>
<header class="site-header"><a class="brand" href="/"><span class="brand-icon" aria-hidden="true">✦</span><span><strong>Việt Nam Ơi<span class="brand-dot">.</span></strong><small>Mỗi điểm đến, một câu chuyện</small></span></a><nav aria-label="Điều hướng"><a class="nav-link" href="/">Bản đồ</a><a class="nav-link" href="/journeys">Lịch trình</a><a class="nav-link" href="/account" id="auth-link">Đăng nhập</a></nav></header>
<main class="destination-main"><nav class="breadcrumbs" aria-label="Đường dẫn"><a href="/">Khám phá Việt Nam</a><span aria-hidden="true">/</span><span>${escape(place.ten_tinh || 'Điểm đến')}</span></nav>
<section class="destination-heading"><span class="eyebrow">${escape(place.ten_loai || 'ĐIỂM ĐẾN')}</span><h1>${escape(place.ten_dia_diem)}</h1><p>${escape(place.dia_chi || place.ten_tinh || 'Việt Nam')}</p><div class="destination-actions"><a class="primary-button" href="/?place=${place.id}">Xem bản đồ & chỉ đường</a><a class="secondary-button" href="/journeys?place=${place.id}">Lưu bộ sưu tập / thêm lịch trình</a><button type="button" id="share-destination" class="secondary-button">Chia sẻ điểm đến</button></div><p id="destination-status" role="status" aria-live="polite"></p><input id="destination-share-url" aria-label="Link chia sẻ điểm đến" value="${escape(canonical)}" readonly hidden></section>
<section class="destination-gallery" aria-label="Thư viện ảnh">${images.length?`${images.map((img,i)=>`<figure ${i?'hidden':''} data-gallery-slide><img src="${escape(img.url)}" alt="${escape(img.caption)}" width="1200" height="750" ${i?'loading="lazy"':'fetchpriority="high"'}><figcaption>${escape(img.caption)}${img.credit?` <span>· ${escape(img.credit)}</span>`:''}</figcaption></figure>`).join('')}<div class="gallery-controls" ${images.length<2?'hidden':''}><button type="button" id="gallery-prev" class="secondary-button" aria-label="Ảnh trước">←</button><span id="gallery-position" role="status" aria-live="polite">1 / ${images.length}</span><button type="button" id="gallery-next" class="secondary-button" aria-label="Ảnh tiếp theo">→</button></div>`:'<div class="gallery-empty"><span aria-hidden="true">✦</span><p>Thư viện ảnh đang được cập nhật.</p></div>'}</section>
<section class="community-photos" id="community-photos" data-tourism-id="${place.id}" aria-labelledby="community-photos-title"><h2 id="community-photos-title">Ảnh địa điểm do người dùng đăng</h2><p class="muted">Ảnh riêng tư: chỉ người đăng và quản trị viên được xem.</p><p id="community-photo-status" class="notice" role="status" aria-live="polite"></p><div id="community-photo-login"><a class="secondary-button" href="/account?return=${encodeURIComponent(`/diem-den/${place.slug}`)}">Đăng nhập để gửi ảnh</a></div><form id="community-photo-form" class="community-photo-form" hidden><label>Ảnh địa điểm<input id="community-photo-file" type="file" accept="image/jpeg,image/png,image/webp" required></label><label>Ghi chú (không bắt buộc)<input id="community-photo-caption" maxlength="500" placeholder="Điều muốn chia sẻ về bức ảnh"></label><button type="submit" class="primary-button">Gửi ảnh riêng tư</button></form><div id="community-photo-grid" class="related-grid" aria-live="polite"></div></section>
<div class="destination-layout"><article class="destination-story" id="destination-story"><span class="eyebrow">MỖI ĐIỂM ĐẾN, MỘT CÂU CHUYỆN</span><h2>Câu chuyện nơi đây</h2><p class="destination-prose">${escape(content.story || place.mo_ta_ngan || 'Câu chuyện của điểm đến đang được biên tập. Hãy lưu lại để khám phá trong hành trình tiếp theo.')}</p>
<section class="practical-section"><h2>Cách di chuyển</h2><p class="destination-prose">${escape(content.transport || 'Hướng dẫn di chuyển đang được cập nhật. Mở bản đồ và chọn “Chỉ đường đến đây” để tìm tuyến từ vị trí của bạn.')}</p><a href="/?place=${place.id}">Tìm đường trên bản đồ →</a></section>
<section class="practical-section"><h2>Lưu ý văn hóa</h2><p class="destination-prose">${escape(content.cultural_notes || 'Thông tin riêng cho điểm đến đang được cập nhật. Khi tham quan, hãy giữ vệ sinh, tôn trọng không gian chung và tuân thủ hướng dẫn tại chỗ.')}</p></section>
<section class="practical-section"><h2>Gợi ý tham quan</h2><p class="destination-prose">${escape(content.tips || 'Chọn thời gian phù hợp, kiểm tra thông tin trước chuyến đi và chuẩn bị nước uống, trang phục thoải mái.')}</p></section>
${sources.length?`<section class="destination-sources"><h2>Nguồn tham khảo</h2><ul>${sources.map(s=>`<li><a href="${escape(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${escape(s.label || new URL(s.url).hostname)}</a></li>`).join('')}</ul></section>`:''}</article>
<aside class="destination-facts" aria-label="Thông tin tham quan"><h2>Chuẩn bị chuyến đi</h2>${facts.map(([label,value])=>`<section><h3>${label}</h3><p class="destination-prose">${escape(value || 'Đang cập nhật')}</p></section>`).join('')}<p class="muted">Giờ mở cửa và giá vé có thể thay đổi. Kiểm tra với điểm đến trước chuyến đi.</p></aside></div>
<section class="destination-related"><h2>Điểm gần đây</h2><p class="muted">Trong bán kính 30 km · Khoảng cách đường chim bay</p>${cards(nearby,'Chưa có điểm khác trong bán kính 30 km.')}</section>
<section class="destination-related"><h2>Có thể bạn cũng thích</h2><p class="muted">Cùng loại hình trải nghiệm, ưu tiên trong cùng tỉnh.</p>${cards(recommended,'Chưa có điểm gợi ý cùng loại hình.')}</section></main>
<footer class="destination-footer">Việt Nam Ơi · Mỗi điểm đến, một câu chuyện. <a href="/">Tiếp tục khám phá →</a></footer><script src="/js/auth.js"></script><script src="/js/destination.js"></script></body></html>`;
}
function errorPage(title,message) {
    return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)} — Việt Nam Ơi</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/destination.css"></head><body class="destination-page"><main class="destination-main"><h1>${escape(title)}</h1><p>${escape(message)}</p><a href="/">Quay về bản đồ</a></main></body></html>`;
}
function registerDestinations(app,pool,options={}) {
    const origin=new URL(options.origin || process.env.APP_ORIGIN || 'http://localhost:3000').origin;
    async function load(slug) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length>120) throw new ApiError('Không tìm thấy điểm đến.',404);
        const place=(await pool.query(`SELECT ${columns} ${joins} WHERE d.slug=$1 AND d.deleted_at IS NULL`,[slug])).rows[0];
        if(!place)throw new ApiError('Không tìm thấy điểm đến.',404);
        const nearby=place.lat==null || place.lng==null?[]:(await pool.query(`SELECT ${columns},
            ST_Distance(d.geom::geography,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS distance_m ${joins}
            WHERE d.id<>$3 AND d.deleted_at IS NULL AND d.slug IS NOT NULL AND d.geom IS NOT NULL
                AND ST_DWithin(d.geom::geography,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,30000)
            ORDER BY distance_m,d.id LIMIT 6`,[place.lng,place.lat,place.id])).rows;
        const recommended=place.loai_id==null?[]:(await pool.query(`SELECT ${columns} ${joins}
            WHERE d.loai_id=$1 AND d.id<>$2 AND NOT(d.id=ANY($3::int[])) AND d.deleted_at IS NULL AND d.slug IS NOT NULL
            ORDER BY CASE WHEN d.ma_tinh=$4 THEN 0 ELSE 1 END,d.id LIMIT 6`,[place.loai_id,place.id,nearby.map(p=>p.id),place.ma_tinh])).rows;
        return {place,nearby,recommended};
    }
    app.get('/api/destinations/:slug',api(async(req,res)=>res.json(await load(req.params.slug))));
    app.get('/diem-den/id/:id',async(req,res)=>{
        try {
            const id=Number(req.params.id);
            if(!Number.isSafeInteger(id) || id<1)return res.status(404).send(errorPage('Không tìm thấy điểm đến','Hãy chọn một điểm khác trên bản đồ.'));
            const place=(await pool.query('SELECT id,slug,ten_dia_diem FROM diem_du_lich WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];
            if(!place)return res.status(404).send(errorPage('Không tìm thấy điểm đến','Hãy chọn một điểm khác trên bản đồ.'));
            const slug=place.slug || await assignSlug(pool,place.id,place.ten_dia_diem);
            res.redirect(308,`/diem-den/${slug}`);
        }catch(error){console.error('Destination redirect:',error.message);res.status(503).send(errorPage('Chưa tải được điểm đến','Vui lòng thử lại sau.'));}
    });
    app.get('/diem-den/:slug',async(req,res)=>{
        try { const {place,nearby,recommended}=await load(req.params.slug);res.send(renderDestination(place,nearby,recommended,origin)); }
        catch(error) {if(!error.status)console.error('Destination page:',error.message);res.status(error.status || 503).send(errorPage(error.status===404?'Không tìm thấy điểm đến':'Chưa tải được điểm đến',error.status===404?'Điểm đến không tồn tại hoặc đã được ẩn. Hãy chọn một điểm khác trên bản đồ.':'Vui lòng thử lại sau.'));}
    });
    app.get('/robots.txt',(req,res)=>res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /account\nDisallow: /journeys\nSitemap: ${origin}/sitemap.xml\n`));
    app.get('/sitemap.xml',api(async(req,res)=>{
        const rows=(await pool.query('SELECT slug,updated_at FROM diem_du_lich WHERE deleted_at IS NULL AND slug IS NOT NULL ORDER BY id')).rows;
        const entries=[`<url><loc>${escape(origin)}/</loc></url>`,...rows.map(row=>`<url><loc>${escape(origin)}/diem-den/${escape(row.slug)}</loc><lastmod>${new Date(row.updated_at).toISOString()}</lastmod></url>`)];
        res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`);
    }));
}
module.exports={registerDestinations,renderDestination,gallery,escape};
