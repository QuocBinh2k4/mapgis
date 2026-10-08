# Mạng đường và tìm đường đến điểm du lịch

Nguồn: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), bản trích Việt Nam của [Geofabrik](https://download.geofabrik.de/asia/vietnam.html), giấy phép ODbL 1.0. `source.json` ghi URL, ngày tải, ngày cập nhật và checksum MD5; `vietnam.osm.pbf` là dữ liệu gốc. Không lấy dữ liệu Google Maps.

## Dữ liệu PostgreSQL

- `routing.edges`: đoạn đường, mã way OSM, source/target là mã nút OSM thật, hình học WGS84, chiều dài mét, quyền đi xuôi/ngược và tốc độ ước tính cho bốn phương tiện, thẻ nguồn.
- `routing.vertices`: tọa độ các đầu đoạn/nút giao. Đường được tách tại nút dùng chung hoặc rào chắn, không nối cầu vượt/hầm chỉ vì cắt nhau trên hình vẽ.
- `routing.turns`: cặp đoạn bị cấm đi liên tiếp, phương tiện, mã relation và nút giao.
- `routing.imports`: lịch sử nhập và thống kê.
- `turn-source.json`: relation cấm rẽ gốc; `import-report.json`: kết quả nhập.

Quá trình nhập tạo bảng mới rồi đổi tên trong cùng transaction. Nếu nhập lại, bộ bảng trước được giữ dưới tên `*_backup_<mã lần nhập>`. Không ghi đè bảng điểm du lịch. Cần đủ bộ nhớ và dung lượng đĩa cho mạng đường toàn quốc cùng các bản sao giữ lại.

## Các quy tắc hiện có

- Ô tô, xe máy, xe đạp, đi bộ có quyền tiếp cận riêng; ưu tiên thẻ theo phương tiện hơn `access` chung.
- Hỗ trợ `oneway`, chiều ngược `-1`, vòng xuyến, ngoại lệ xe đạp, thẻ quyền đi theo chiều và các rào chắn thông dụng.
- Loại đường đang xây dựng, vùng đi bộ dạng diện tích, đường riêng/đòi giấy phép/quyền tiếp cận đặc biệt. Các tuyến `destination` cũng được loại theo cách thận trọng, nên có thể thiếu lối vào một số điểm.
- Không đưa xe máy/xe đạp/người đi bộ lên đường được gắn `motorway` hoặc `motorroad=yes`.
- Cấm rẽ dạng `no_*` và `only_*` qua một nút được xử lý bằng pgRouting TRSP. Với relation qua nhiều đoạn hoặc điều kiện thời gian chưa hỗ trợ, loại đường `from` khỏi phương tiện liên quan; báo cáo ghi số trường hợp bị loại. Không diễn giải chúng thành đường được phép đi.
- Cấm rẽ được lưu theo cặp ID cạnh của pgRouting. Với một số đường hai chiều phức tạp, cách này có thể hạn chế cả chiều ngược; cần mô hình cạnh có hướng mở rộng nếu muốn tinh chỉnh.
- Chưa có lịch phà, giao thông công cộng, dẫn đường GPS liên tục, dữ liệu tắc đường, giới hạn kích thước xe tải hoặc đánh giá độ khó leo núi. Mạng đường và các quyền lưu thông phụ thuộc mức độ đầy đủ của OSM.

## Cách tính tuyến

`POST /api/routes` nhận:

```json
{"start":{"lat":21.0255,"lng":105.8412},"destinationId":1897,"mode":"car"}
```

`mode`: `car`, `motorcycle`, `bicycle`, `foot`.

Điểm được chiếu lên đoạn đường cho phép trong bán kính 1,5 km; hai đầu tuyến được tách bằng các nút tạm để tính từ đúng vị trí trên đoạn. Khoảng cách từ điểm chọn đến đường được trả riêng và vẽ nét đứt, không coi là tuyến đường đã xác minh.

Chi phí chính là chiều dài đường; chạy pgRouting TRSP có xét cấm rẽ. Sau khi có tuyến ban đầu, mở rộng miền tìm kiếm theo giới hạn chiều dài tuyến đó. Tạo tối đa hai lựa chọn khác bằng tăng chi phí các cạnh đã dùng, loại tuyến trùng quá 90% số cạnh hoặc dài hơn giới hạn 1,8 lần (cộng dung sai 100 m). Đây là các tuyến thay thế tìm được, không phải danh sách tất cả đường đi hoặc cam kết K tuyến ngắn nhất tuyệt đối. TRSP cũng có giới hạn với các chuỗi ràng buộc phức tạp; giao diện dùng nhãn “Tuyến ngắn nhất tìm được”.

Thời gian = tổng chiều dài / tốc độ ước tính theo loại đường/phương tiện; không có giao thông trực tiếp, thời gian chờ hoặc lịch đóng mở. API trả GeoJSON, quãng đường, thời gian, các đoạn đường và độ lệch hai đầu. Nếu không có kết nối, trả lỗi rõ ràng thay vì vẽ đường thẳng như một tuyến hợp lệ.

`GET /api/routing/status` trả trạng thái, các phương tiện và thống kê dữ liệu đang dùng.

## Chạy dự án / cập nhật dữ liệu

```powershell
python -m pip install --target .tools/roads-python osmium psycopg[binary]
npm run roads:download
npm run roads:import
npm run roads:test
npm start
```

Kết nối PostgreSQL dùng `DATABASE_URL` hoặc các biến `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT`; nếu chưa đặt, script đọc cấu hình hiện có trong `server.js`. Máy PostgreSQL phải có PostGIS và pgRouting 4.x; importer bật extension pgRouting nếu đã cài bộ thư viện.

Trên website: chọn điểm du lịch → **Chỉ đường đến đây** → chọn vị trí hiện tại, chạm bản đồ hoặc nhập vĩ độ/kinh độ → chọn phương tiện → **Tìm đường đi** → chọn thẻ tuyến. Các lựa chọn không bắt buộc phải đủ ba tuyến nếu dữ liệu không có tuyến phù hợp.

Thư mục `data`, `scripts` và cấu hình máy chủ nằm ngoài thư mục web công khai `public`.
