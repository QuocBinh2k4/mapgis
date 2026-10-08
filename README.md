# MapGIS — dữ liệu Neon và bản đồ web

Yêu cầu Node.js 22 trở lên và PostgreSQL/Neon có PostGIS. Web và các script dùng cùng `DATABASE_URL` từ môi trường hoặc `.env`, không lưu mật khẩu trong mã nguồn. Biến môi trường triển khai được ưu tiên hơn `.env`.

```powershell
npm install
Copy-Item .env.example .env
# Điền DATABASE_URL lấy từ Neon > Connect vào .env.
```

Nếu đã có `.env` thì chỉnh file hiện có, không ghi đè. Trên Vercel, thêm `DATABASE_URL` trong Environment Variables rồi redeploy. `.env` không được đưa lên Git. Đường dẫn kết nối phải có SSL, ví dụ `?sslmode=verify-full`.

## Nhập dữ liệu lần đầu

```powershell
npm run boundaries:download
npm run data:download
npm run boundaries:preview
npm run data:preview
npm run data:validate
npm run boundaries:import
npm run data:import
npm run data:verify
npm start
```

`boundaries:import` và `data:import` tự tạo schema nếu thiếu; `db:init` là lệnh riêng khi chỉ cần tạo bảng. Bật PostGIS bằng `CREATE EXTENSION IF NOT EXISTS postgis` với tài khoản có quyền tạo extension.

`data:preview` dùng bộ ranh giới đã tải để tính kế hoạch nhập, rollback cả ranh giới tạm. `data:validate` thực hiện cả ghi điểm/nguồn và kiểm tra khóa ngoại trong transaction rồi rollback; không commit dữ liệu. Lưu ý PostgreSQL không rollback số sequence đã cấp, nên ID có thể có khoảng trống sau validate/preview.

Sau các lệnh import, mở `http://localhost:3000`. Hai API mà Leaflet sử dụng là `/api/ranhgioi` và `/api/diemdulich`, trả GeoJSON WGS84. Bảng rỗng trả `features: []`.

## Cập nhật các lần sau

```powershell
npm run boundaries:download
npm run boundaries:preview
npm run boundaries:import
npm run data:download
npm run data:preview
npm run data:import
npm run data:verify
```

`data:import` thêm các điểm mới, giữ nội dung của mã OSM đã nhập để bảo toàn chỉnh sửa thủ công. Muốn ghi đè tên, phân loại, mô tả, ảnh, tọa độ và tỉnh của các điểm OSM theo lần tải mới, thay lệnh này bằng `npm run data:refresh`. Các điểm vắng trong nguồn mới không tự bị xóa. Báo cáo nằm trong `data/boundaries` và `data/tourism`; điểm không ghép được tỉnh nằm trong `unmatched-provinces.json` và bảng `du_lieu_du_lich_osm`.

Ranh giới dùng [bộ GeoJSON 34 tỉnh](data/boundaries/README.md), điểm du lịch dùng [OpenStreetMap qua Overpass](data/tourism/README.md). Dữ liệu OSM là dữ liệu cộng đồng, cần kiểm duyệt tên, phân loại và vị trí trước khi sử dụng như danh mục du lịch chính thức.

Kiểm thử xử lý dữ liệu: `npm run data:test`. Kiểm tra nhập thật trong transaction rollback: `npm run data:validate`.
