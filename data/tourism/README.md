# Dữ liệu du lịch Việt Nam

Dữ liệu được tải từ OpenStreetMap contributors qua Overpass API. Giấy phép: [ODbL 1.0](https://www.openstreetmap.org/copyright). Thời điểm dữ liệu và truy vấn đầy đủ được lưu trong `source.json` và `overpass-query.txt`.

## Phạm vi và độ chính xác

- Lấy đối tượng có tên, gồm điểm thu hút du lịch, di tích, nơi thờ tự, bảo tàng, khu vui chơi, thắng cảnh, đỉnh núi, hang động, bãi biển, thác nước và khu bảo tồn theo các thẻ OSM trong truy vấn.
- Đây là dữ liệu cộng đồng, không phải danh mục toàn bộ điểm du lịch hoặc hồ sơ xếp hạng di tích chính thức. Việc phân loại tự động cần kiểm duyệt; không phải mọi nơi thờ tự hoặc đỉnh núi đều phục vụ du lịch.
- Ưu tiên `name:vi`, sau đó `name`. Chỉ nhập điểm có tên và tọa độ hợp lệ.
- Tọa độ node là tọa độ gốc; way/relation dùng tâm hộp bao, có thể không trùng cổng vào. Phương pháp nằm trong `thong_tin_nguon.coordinate_method`.
- Mã tỉnh lấy bằng kiểm tra điểm nằm trong ranh giới PostgreSQL đang có, không dùng tên tỉnh cũ từ OSM. Không sửa bộ ranh giới hiện tại.
- Điểm không nằm trong ranh giới được giữ tại bảng `du_lieu_du_lich_osm` với trạng thái `unmatched_province`, đồng thời xuất ra `unmatched-provinces.json`; không đoán tỉnh để nhập vào bảng chính.
- Các đối tượng cùng tên chuẩn hóa, cùng tỉnh và cách nhau tối đa 250 m được xem là có khả năng trùng. Ưu tiên relation, way, node; lưu mọi mã nguồn trong bảng nguồn để xem lại. Quy tắc này có thể gộp hai điểm khác nhau rất gần nhau.
- Hai điểm có sẵn và các trường của chúng được giữ nguyên. Các mã nguồn đã nhập được bỏ qua khi chạy lại; không tự ghi đè thông tin đã chỉnh sửa và không tự xóa điểm vắng trong lần tải sau.

## Các bảng lưu dữ liệu

- `diem_du_lich`: dữ liệu sử dụng trên bản đồ; bổ sung `nguon_du_lieu`, `nguon_id`, `nguon_url`, `ngay_nhap_du_lieu`, `thong_tin_nguon`.
- `du_lieu_du_lich_osm`: bản ghi gốc, mã OSM, liên kết điểm chính, tỉnh, trạng thái và thời điểm tải.
- `danh_muc_loai`: các nhóm `DI_TICH`, `DANH_LAM`, `TAM_LINH`, `KHU_DU_LICH`, `BAO_TANG`.

## Chạy lại

Chạy từ thư mục dự án với Node.js có hỗ trợ `fetch`:

```powershell
npm run data:download
npm run data:preview
npm run data:import
npm run data:verify
```

Kết nối mặc định sử dụng cấu hình có sẵn trong `server.js` mà không sao chép mật khẩu. Có thể thay bằng biến môi trường `DATABASE_URL` hoặc các biến PostgreSQL `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT`. Có thể chọn endpoint khác bằng `OVERPASS_URL`.

`data:preview` chỉ dùng bảng tạm trong transaction và rollback, không sửa dữ liệu chính. `data:import` sao lưu các bản ghi hiện tại sang `backup-before-import-*.json`, nhập trong một transaction, kiểm tra khóa ngoại/tọa độ trước khi commit. Các bản sao lưu này chứa dữ liệu của bảng điểm đến và danh mục, không thay thế bản sao lưu đầy đủ PostgreSQL.

`import-report.json` là báo cáo lần nhập gần nhất; `preview-report.json` là báo cáo xem trước. Dữ liệu nguồn đầy đủ nằm trong `osm-vietnam.json`.

## Tra cứu bằng SQL

```sql
SELECT p.ten_tinh, l.ten_loai, count(*) AS so_diem
FROM diem_du_lich d
JOIN ranh_gioi_tinh p ON p.ma_tinh = d.ma_tinh
JOIN danh_muc_loai l ON l.id = d.loai_id
GROUP BY p.ten_tinh, l.ten_loai
ORDER BY p.ten_tinh, l.ten_loai;

SELECT ten_dia_diem, dia_chi, nguon_url, ST_X(geom) AS kinh_do, ST_Y(geom) AS vi_do
FROM diem_du_lich
WHERE ma_tinh = '101'; -- Mã tỉnh Hà Nội trong cơ sở dữ liệu hiện tại

SELECT osm_key, du_lieu_goc->'tags'->>'name' AS ten, trang_thai
FROM du_lieu_du_lich_osm
WHERE trang_thai = 'unmatched_province';
```

Website có ghi nguồn OpenStreetMap cho dữ liệu điểm đến, bộ lọc đủ 5 nhóm, gom cụm dấu ghim và phân trang danh sách để xử lý tập dữ liệu lớn.
