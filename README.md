# MapGIS — dữ liệu Neon và bản đồ web

Yêu cầu Node.js 22 trở lên và PostgreSQL/Neon có PostGIS. Web và các script dùng cùng `DATABASE_URL` từ môi trường hoặc `.env`, không lưu mật khẩu trong mã nguồn. Biến môi trường triển khai được ưu tiên hơn `.env`.

```powershell
npm install
Copy-Item .env.example .env
# Điền DATABASE_URL lấy từ Neon > Connect vào .env.
```

Nếu đã có `.env` thì chỉnh file hiện có, không ghi đè. Trên Vercel, thêm `DATABASE_URL` trong Environment Variables rồi redeploy. `.env` không được đưa lên Git. Đường dẫn kết nối phải có SSL, ví dụ `?sslmode=verify-full`.

All destination images and user submitted photos use the same Public Vercel Blob store. Neon stores destination image URLs in `hinh_anh_url` and user photo URLs with uploader and destination IDs. The user photo API still requires sign in and restricts access to the uploader or an administrator. Create one Public Blob store for the Vercel project, enable Production/Preview, and set `BLOB_READ_WRITE_TOKEN`. For local development, link the Development environment and run `vercel env pull`, or add this token to `.env`.

## Tài khoản Google và trang admin

Trang `/account` cho phép đăng ký/đăng nhập Google, cập nhật tên và quản lý điểm đến đã lưu. Trang `/admin` quản lý người dùng, quyền truy cập, phiên đăng nhập, điểm du lịch và nhật ký thay đổi. Mã đăng nhập đã được tích hợp; cần điền `GOOGLE_CLIENT_ID`, `APP_ORIGIN` và `ADMIN_EMAILS` để sử dụng tài khoản Google thật.

Giao diện hỗ trợ máy tính và điện thoại, kể cả khi xoay ngang. Trên điện thoại, nút **Điểm đến** mở bảng danh sách có nút đóng; dữ liệu admin hiển thị thành thẻ. Nút **Lớp bản đồ** ở góc dưới trái cho phép chọn Đường phố/Vệ tinh/Địa hình. Chú thích ở sát góc dưới phải, phía trên nguồn bản đồ; bảng lớp mở trên màn hình hẹp sẽ tạm ẩn các điều khiển phía sau để tránh chồng lấn.

```powershell
npm run db:init
npm start
```

Migration trong `sql/users-admin.sql` tạo thêm bảng tài khoản trên cùng database Neon và bổ sung trường quản trị vào `diem_du_lich`. Xem [hướng dẫn cấu hình Google, cấp quyền admin và mô hình database](docs/accounts.md).

## Lịch trình và bộ sưu tập

Mở `/journeys` từ menu hoặc từ popup điểm đến. Bộ sưu tập có hai trạng thái **Muốn đi** và **Đã đi**; chuyển trạng thái trong danh sách điểm đến. Mục **Bộ sưu tập** trên bản đồ cũng lọc được hai danh sách này.

Lịch trình hỗ trợ 1–30 ngày, kéo thả điểm trong hoặc giữa các ngày, nút lên/xuống và chuyển ngày trên điện thoại. Nhấn **Lưu lịch trình** để đồng bộ với tài khoản; khi sửa cùng lúc trên nhiều thiết bị, API báo xung đột để tránh ghi đè. Mỗi ngày tối đa 30 điểm, mỗi lịch trình tối đa 150 điểm.

**Chia sẻ bằng link** lưu bản hiện tại và tạo link chỉ xem, không cần đăng nhập. Ai có link đều có thể xem tên lịch trình và các điểm đến; không hiển thị thông tin tài khoản. **Ngừng chia sẻ** vô hiệu hóa link cũ. **Xuất PDF** mở hộp thoại in, chọn **Lưu dưới dạng PDF**; bản in giữ tiếng Việt và thứ tự ngày/điểm đến.

Hai mẫu **3 ngày Hà Giang** và **2 ngày Hội An** tạo bản nháp bằng các điểm thực có trong database, thông báo các điểm chưa có để bổ sung. Các ngày do ứng dụng sắp xếp để tham khảo, chưa tính thời gian di chuyển. Nguồn điểm gợi ý: [Vietnam Tourism — Hà Giang](https://www.vietnam.travel/things-to-do/ha-giang-loop), [Vietnam Tourism — Hội An](https://www.vietnam.travel/places-to-go/central-vietnam/hoi-an).

Chạy `npm run db:init` khi cập nhật: migration `sql/journeys.sql` chuyển yêu thích cũ sang **Muốn đi** và tạo bảng `user_itineraries`. Kiểm tra bằng `npm run journeys:test` và `npm run favorites:test`.

## Trang chi tiết điểm đến

Mỗi điểm có URL riêng `/diem-den/<slug>` (ví dụ `/diem-den/chua-cau`), mở từ popup bản đồ, bộ sưu tập hoặc lịch trình. Slug được lưu trong database, tự xử lý trùng tên và giữ nguyên khi đổi tên điểm đến. URL `/diem-den/id/<id>` chuyển hướng 308 tới slug để các link theo ID vẫn sử dụng được. Điểm đang ẩn trả HTTP 404 và không có trong sitemap.

Trang trả HTML từ server với câu chuyện, thư viện tối đa 8 ảnh (chú thích và tác giả), giờ mở cửa, giá vé, mùa đẹp nhất, cách di chuyển và lưu ý văn hóa. Có canonical, Open Graph, JSON-LD `TouristAttraction`, `/sitemap.xml` và `/robots.txt`. Cấu hình `APP_ORIGIN` thành domain HTTPS thực tế trước khi triển khai để canonical và sitemap trỏ đúng website; có thể gửi sitemap trong Google Search Console. Các thành phần này hỗ trợ Google đọc nội dung, không đảm bảo được lập chỉ mục hay hiển thị rich result.

**Điểm gần đây** lấy tối đa 6 điểm trong bán kính 30 km, sắp theo khoảng cách đường chim bay bằng PostGIS. **Có thể bạn cũng thích** chọn tối đa 6 điểm cùng loại hình, ưu tiên cùng tỉnh, loại điểm hiện tại và các điểm đã gợi ý gần đây. Gợi ý dùng dữ liệu điểm đến, không phụ thuộc tài khoản.

Vào `/admin` → **Sửa điểm du lịch** → **Nội dung trang chi tiết** để biên tập. Gallery: mỗi dòng `URL | chú thích | tác giả/nguồn`; nguồn tham khảo: mỗi dòng `URL | tên nguồn`. Để trống các thông tin chưa có; trang hiển thị **Đang cập nhật** thay vì tự suy đoán giờ hoặc giá. Nội dung được kiểm tra độ dài và URL, escape trước khi xuất HTML và lưu cùng nhật ký quản trị.

```powershell
npm run db:init
npm run destinations:seed
npm run destinations:test
```

`db:init` áp dụng `sql/destinations.sql` và tạo slug cho dữ liệu cũ. Import sau này tự tạo slug cho điểm mới, giữ nội dung đã biên tập khi refresh OSM. `destinations:seed` bổ sung giờ/phí từ các tag OpenStreetMap đã có, ghi rõ **chưa xác minh**, và thêm câu chuyện/gallery tư liệu cho Chùa Cầu Hội An nếu mục tương ứng còn trống. Nội dung mẫu tham khảo [Trung tâm Quản lý Bảo tồn Di sản Văn hóa Hội An](https://hoianheritage.danang.gov.vn/vi/di-san-van-hoa/Cau/Chua-Cau-134.html); ảnh Wikimedia có ghi năm chụp, tác giả, link nguồn và giấy phép CC BY-SA 4.0. Chạy lại seed không thay nội dung đã điền.

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
