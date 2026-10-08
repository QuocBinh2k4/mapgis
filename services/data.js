function registerData(app,pool) {
    app.get('/api/diemdulich',async(req,res)=>{
        try {
            const result=await pool.query(`SELECT json_build_object('type','FeatureCollection','features',
                COALESCE(json_agg(json_build_object('type','Feature','geometry',ST_AsGeoJSON(ST_Transform(d.geom,4326))::json,
                    'properties',json_build_object('id',d.id,'ten_dia_diem',d.ten_dia_diem,'mo_ta_ngan',d.mo_ta_ngan,
                        'hinh_anh',d.hinh_anh_url,'ma_tinh',d.ma_tinh,'ten_tinh',t.ten_tinh,'loai_hinh',l.ten_loai,'ma_loai',l.ma_loai)
                ) ORDER BY d.id),'[]'::json)) AS geojson FROM diem_du_lich d
                LEFT JOIN danh_muc_loai l ON d.loai_id=l.id LEFT JOIN ranh_gioi_tinh t ON d.ma_tinh=t.ma_tinh
                WHERE d.geom IS NOT NULL AND d.deleted_at IS NULL`);
            res.json(result.rows[0].geojson);
        }catch(error){console.error('Lỗi lấy điểm du lịch:',error.message);res.status(500).json({error:'Không lấy được điểm du lịch từ cơ sở dữ liệu.'});}
    });
    app.get('/api/ranhgioi',async(req,res)=>{
        try {
            const result=await pool.query(`SELECT json_build_object('type','FeatureCollection','features',
                COALESCE(json_agg(json_build_object('type','Feature','geometry',ST_AsGeoJSON(ST_Transform(geom,4326),6)::json,
                    'properties',json_build_object('id',id,'ma_tinh',ma_tinh,'ten_tinh',ten_tinh,'dien_tich',dien_tich,'dan_so',dan_so)
                ) ORDER BY ma_tinh),'[]'::json)) AS geojson FROM ranh_gioi_tinh WHERE geom IS NOT NULL`);
            res.json(result.rows[0].geojson);
        }catch(error){console.error('Lỗi lấy ranh giới:',error.message);res.status(500).json({error:'Không lấy được ranh giới tỉnh từ cơ sở dữ liệu.'});}
    });
}
module.exports={registerData};
