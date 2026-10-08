const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const { registerRouting } = require('./services/routing');

const app = express();
app.use(cors());

// Phục vụ file tĩnh (để đọc được index.html)
app.use(express.json({ limit: '16kb' }));

// Kết nối PostgreSQL
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'GisDuLich',
    password: 'Quocbinhvt2004@',
    port: 5432,
});

registerRouting(app, pool);

// KIỂM TRA KẾT NỐI DATABASE NGAY KHI KHỞI ĐỘNG
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Lỗi kết nối Cơ sở dữ liệu PostgreSQL:', err.message);
    } else {
        console.log('✅ Đã kết nối thành công với PostgreSQL!');
    }
});

// 1. Chỉ định thư mục chứa file tĩnh là 'public'
app.use(express.static(path.join(__dirname, 'public')));

// 2. Cập nhật lại đường dẫn khi người dùng truy cập trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cập nhật API lấy danh sách điểm du lịch
app.get("/api/diemdulich", async (req, res) => {
  try {
    const result = await pool.query(`
        SELECT json_build_object(
            'type', 'FeatureCollection', 
            'features', json_agg(json_build_object(
                'type', 'Feature', 
                'geometry', ST_AsGeoJSON(d.geom)::json, 
                'properties', json_build_object(
                    'id', d.id, 
                    'ten_dia_diem', d.ten_dia_diem,
                    'mo_ta_ngan', d.mo_ta_ngan,
                    'hinh_anh', d.hinh_anh_url,
                    'ten_tinh', t.ten_tinh,
                    'loai_hinh', l.ten_loai,
                    'ma_loai', l.ma_loai
                )
            ))
        ) AS geojson 
        FROM diem_du_lich d
        LEFT JOIN danh_muc_loai l ON d.loai_id = l.id
        LEFT JOIN ranh_gioi_tinh t ON d.ma_tinh = t.ma_tinh;
    `);
    
    const data = result.rows[0].geojson || { type: "FeatureCollection", features: [] };
    res.json(data);
  } catch (err) {
    console.error('Lỗi khi truy vấn điểm du lịch:', err);
    res.status(500).json({ error: "Lỗi truy vấn cơ sở dữ liệu" });
  }
});

// Cập nhật lại API ranh giới trong server.js
app.get("/api/ranhgioi", async (req, res) => {
  try {
    const result = await pool.query(`
        SELECT json_build_object(
            'type', 'FeatureCollection', 
            'features', json_agg(json_build_object(
                'type', 'Feature', 
                'geometry', ST_AsGeoJSON(geom)::json, 
                'properties', json_build_object(
                    'id', id, 
                    'ten_tinh', ten_tinh, 
                    'dien_tich', dien_tich,    
                    'dan_so', dan_so
                )
            ))
        ) AS geojson 
        FROM ranh_gioi_tinh; 
    `);
    
    const data = result.rows[0].geojson || { type: "FeatureCollection", features: [] };
    res.json(data);
  } catch (err) {
    console.error('Lỗi khi truy vấn:', err);
    res.status(500).json({ error: "Lỗi truy vấn cơ sở dữ liệu" });
  }
});

// Khởi chạy server
if (require.main === module) {
    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => console.log(`🚀 Server đang chạy trên http://localhost:${port}`));
}
module.exports = { app, pool };
