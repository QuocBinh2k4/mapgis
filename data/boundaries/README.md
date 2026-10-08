# Ranh giới tỉnh để nhập Neon

`npm run boundaries:download` tải 34 GeoJSON tỉnh từ [vietnamese-provinces-database](https://github.com/thanglequoc/vietnamese-provinces-database/tree/master/dataset-generation-scripts/resources/gis/geojson_11Mar2026). Bộ geometry là ảnh chụp tháng 3/2026 của Bando.com.vn; mã và tên tỉnh được ghép theo tên với danh mục trong cùng commit. `matinh` gốc của Bando là mã nội bộ, **không** dùng làm mã hành chính. Commit, ngày tải, phiên bản danh mục và ghi chú giấy phép được lưu trong `source.json`. Đây không phải cam kết ranh giới pháp lý chính thức hoặc cập nhật theo thời gian thực; nguồn yêu cầu tham khảo điều khoản Bando.com.vn.

`provinces.geojson` dùng WGS84 với `[kinh độ, vĩ độ]`, `properties.ma_tinh` (chuỗi, giữ số 0 đầu) và `properties.ten_tinh`. Có thể thay file này bằng bộ GeoJSON đã kiểm duyệt có cùng cấu trúc. `dan_so` và `dien_tich` (km²) là tùy chọn; không tự tạo số dân. Nếu thiếu diện tích, importer tính diện tích từ polygon.

```powershell
npm run boundaries:download
npm run boundaries:preview
npm run boundaries:import
```

Preview chạy cả upsert trong transaction rồi rollback. Import sao lưu ranh giới và mã tỉnh của điểm hiện tại, chuẩn hóa Polygon/MultiPolygon, sửa geometry với PostGIS, kiểm tra geometry rồi upsert theo mã tỉnh. Nếu mã tỉnh hiện tại khác nguồn, script dừng để tránh trộn hai bộ mã. Khi cập nhật geometry, script ghép lại tỉnh cho điểm hiện có; điểm nằm ngoài bộ ranh giới có `ma_tinh = NULL`, cần kiểm tra riêng. Bản sao lưu JSON không thay thế backup toàn bộ PostgreSQL.
