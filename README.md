# MapGIS — dữ liệu Neon và bản đồ web

Yêu cầu Node.js 22 trở lên và PostgreSQL/Neon có PostGIS. Web và các script dùng cùng `DATABASE_URL` từ môi trường hoặc `.env`, không lưu mật khẩu trong mã nguồn. Biến môi trường triển khai được ưu tiên hơn `.env`.

```powershell
npm install
Copy-Item .env.example .env
# Điền DATABASE_URL lấy từ Neon > Connect vào .env.
```

Nếu đã có `.env` thì chỉnh file hiện có, không ghi đè. Trên Vercel, thêm `DATABASE_URL` trong Environment Variables rồi redeploy. `.env` không được đưa lên Git. Đường dẫn kết nối phải có SSL, ví dụ `?sslmode=verify-full`.

## Tài khoản Google và trang admin

Trang `/account` cho phép đăng ký/đăng nhập Google, cập nhật tên và quản lý điểm đến đã lưu. Trang `/admin` quản lý người dùng, quyền truy cập, phiên đăng nhập, điểm du lịch và nhật ký thay đổi. Mã đăng nhập đã được tích hợp; cần điền `GOOGLE_CLIENT_ID`, `APP_ORIGIN` và `ADMIN_EMAILS` để sử dụng tài khoản Google thật.

Giao diện hỗ trợ máy tính và điện thoại, kể cả khi xoay ngang. Trên điện thoại, nút **Điểm đến** mở bảng danh sách có nút đóng; dữ liệu admin hiển thị thành thẻ. Nút **Lớp bản đồ** ở góc dưới trái cho phép chọn Đường phố/Vệ tinh/Địa hình. Chú thích ở sát góc dưới phải, phía trên nguồn bản đồ; bảng lớp mở trên màn hình hẹp sẽ tạm ẩn các điều khiển phía sau để tránh chồng lấn.

```powershell
npm run db:init
npm start
```

Migration trong `sql/users-admin.sql` tạo thêm bảng tài khoản trên cùng database Neon và bổ sung trường quản trị vào `diem_du_lich`. Xem [hướng dẫn cấu hình Google, cấp quyền admin và mô hình database](docs/accounts.md).

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

## Tìm đường đến điểm du lịch

Web lấy điểm đến từ Neon và mặc định tính tuyến qua Valhalla/OpenStreetMap, hỗ trợ ô tô, xe máy, xe đạp và đi bộ. Với cấu hình này, không cần nhập mạng đường vào Neon hoặc có khóa API. Xe máy dùng hồ sơ `motor_scooter`, tránh cao tốc. Điểm xuất phát và điểm đến được gửi đến dịch vụ tìm đường.

```powershell
npm run roads:verify
npm start
```

`ROUTING_PROVIDER=valhalla` là mặc định. `VALHALLA_URL` mặc định là máy demo FOSSGIS; dịch vụ công cộng giới hạn lưu lượng và không có cam kết uptime. Khi triển khai phục vụ nhiều người, đặt `VALHALLA_URL` đến dịch vụ Valhalla riêng và `ROUTING_CLIENT_ID` là tên miền website. Xem [hướng dẫn của Valhalla](https://github.com/valhalla/valhalla#demo-server) về nhận diện ứng dụng và fair use. Server giới hạn một yêu cầu mỗi giây trong từng tiến trình và cache kết quả 5 phút; giới hạn này không phải giới hạn toàn cục giữa nhiều instance Vercel.

Có thể dùng `ROUTING_PROVIDER=pgrouting` để tự tính bằng mạng đường trong PostgreSQL. Khi đó cần `roads:download` và `roads:import`, cùng PostGIS/pgRouting. Đã kiểm thử pgRouting 3.8; Neon hiện tại giới hạn 1 GB nên không chứa được mạng đường toàn quốc cùng chỉ mục. Importer kiểm tra dung lượng trước khi quét nguồn để tránh lặp lại lần nhập không đủ chỗ. Hướng dẫn nhập riêng nằm trong [data/roads/README.md](data/roads/README.md).

Trên bản đồ, mở điểm du lịch và chọn **Chỉ đường đến đây**. Chọn điểm xuất phát bằng vị trí hiện tại, bản đồ, tọa độ hoặc tên điểm du lịch trong gợi ý; chọn phương tiện rồi nhấn **Tìm đường đi**. Web hiển thị đường thực tế, khoảng cách, thời gian ước tính và các tuyến thay thế nếu có. Tên đường trong chi tiết là các đoạn của tuyến, chưa phải hướng dẫn rẽ từng giao lộ hoặc dẫn đường GPS liên tục.

`GET /api/routing/status` cho biết backend đang chọn; với Valhalla, `ready` nghĩa là dịch vụ đã cấu hình, không phải cam kết dịch vụ ngoài đang hoạt động. API `POST /api/routes` trả GeoJSON, khoảng cách, thời gian ước tính và các đoạn đường; khi dịch vụ ngoài không đáp ứng, API trả lỗi rõ ràng để thử lại. Kiểm thử mã: `npm run roads:test`; kiểm thử tuyến thật: `npm run roads:verify`.
