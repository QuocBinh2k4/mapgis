const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const { databaseConfig } = require('./scripts/db');
const { registerRouting } = require('./services/routing');

const app = express();
const pool = new Pool(databaseConfig());
app.locals.pool = pool;
app.use(cors());
app.use(express.json({ limit: '16kb' }));
registerRouting(app, pool);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/diemdulich', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT json_build_object('type','FeatureCollection','features',
                COALESCE(json_agg(json_build_object(
                    'type','Feature','geometry',ST_AsGeoJSON(ST_Transform(d.geom,4326))::json,
                    'properties',json_build_object(
                        'id',d.id,'ten_dia_diem',d.ten_dia_diem,'mo_ta_ngan',d.mo_ta_ngan,
                        'hinh_anh',d.hinh_anh_url,'ma_tinh',d.ma_tinh,'ten_tinh',t.ten_tinh,
                        'loai_hinh',l.ten_loai,'ma_loai',l.ma_loai
                    )
                ) ORDER BY d.id),'[]'::json)
            ) AS geojson FROM diem_du_lich d
            LEFT JOIN danh_muc_loai l ON d.loai_id=l.id
            LEFT JOIN ranh_gioi_tinh t ON d.ma_tinh=t.ma_tinh
            WHERE d.geom IS NOT NULL
        `);
        res.json(result.rows[0].geojson);
    } catch (error) {
        console.error('L?i l?y ?i?m du l?ch:', error.message);
        res.status(500).json({ error: 'Kh?ng l?y ???c ?i?m du l?ch t? c? s? d? li?u.' });
    }
});
app.get('/api/ranhgioi', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT json_build_object('type','FeatureCollection','features',
                COALESCE(json_agg(json_build_object(
                    'type','Feature','geometry',ST_AsGeoJSON(ST_Transform(geom,4326),6)::json,
                    'properties',json_build_object('id',id,'ma_tinh',ma_tinh,'ten_tinh',ten_tinh,
                        'dien_tich',dien_tich,'dan_so',dan_so)
                ) ORDER BY ma_tinh),'[]'::json)
            ) AS geojson FROM ranh_gioi_tinh WHERE geom IS NOT NULL
        `);
        res.json(result.rows[0].geojson);
    } catch (error) {
        console.error('L?i l?y ranh gi?i:', error.message);
        res.status(500).json({ error: 'Kh?ng l?y ???c ranh gi?i t?nh t? c? s? d? li?u.' });
    }
});
if (require.main === module) {
    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => console.log(`Server ?ang ch?y t?i http://localhost:${port}`));
}
module.exports = app;
