# HGVision scripts

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-11-19 | Test máy trường: lỗi 403 `insufficient_scope` (thiếu `plates:write`, cấp quyền + restart BE) và 400 (`is_blacklist` phải là số 0/1 — đã sửa code). Thêm biển test thứ 2 `99A99998` vào bảng dữ liệu phải xoá + script dọn. | Bảng "Dữ liệu test phải xoá"; `cleanup-plate-test.sql` |
| 2026-11-19 | Đổi biển test `TEST01` → `99A-999.99` (`99A99999`): `TEST01` bị SAVP từ chối vì sai định dạng biển số. | Mục "Đẩy biển số SAVP → HGVision" bước 5–7, bảng dữ liệu test; `cleanup-plate-test.sql` |
| 2026-11-19 | Thêm mục "Đẩy biển số SAVP → HGVision": quy tắc đồng bộ, các bước test 1 biển `TEST01` trên máy trường, danh sách dữ liệu test phải xoá + script `cleanup-plate-test.sql`. | Mục mới cuối file, file `cleanup-plate-test.sql` |
| 2026-11-18 | Sửa giả định #1: `live_hls_path` là tên luồng MediaMTX, video lấy từ `HGVISION_HLS_BASE_URL` (:8888). Thêm biến này vào mẫu `.env` máy trường. | Mục "Cấu hình BE trên máy trường", "Giả định" #1 |
| 2026-11-18 | Xóa mock HGVision (`server.mjs`, `prepare-media.mjs`, npm `hgvision:mock*`) sau khi test xong API camera cho FE. Chuyển thư mục `scripts/hgvision-mock/` → `scripts/hgvision/`, chỉ giữ `capture-real.mjs`. Thêm mục cấu hình máy trường. Mock vẫn lấy lại được từ commit `f0830a2`. | Toàn bộ file |
| 2026-11-18 | Thêm script `capture-real.mjs` (lấy JSON thật, chỉ đọc) và mục "Lấy JSON thật trên máy trường" | Mục mới cuối file |
| 2026-11-18 | Tạo mock HGVision (giả lập OpenAPI 1.0.0) để dev SAVP khi không truy cập được máy HGVision thật ở trường | Toàn bộ file |

## Cấu hình BE trên máy trường

`.env` (không commit, mỗi máy giữ riêng):

```
CAMERA_PROVIDER=hgvision          # bật poller lịch sử (cần scope history:read)
HGVISION_ENABLED=true
HGVISION_BASE_URL=http://localhost:8113
HGVISION_HLS_BASE_URL=http://localhost:8888   # MediaMTX — nguồn video live (không cần token)
HGVISION_CLIENT_ID=<tạo ở trang "Tích hợp API" của HGVision>
HGVISION_CLIENT_SECRET=<như trên>
HGVISION_WRITE_ENABLED=false      # chỉ bật khi đã thử ghi định danh trên máy thật
```

Client HGVision cần tối thiểu scope `cameras:read` (trang camera bảo vệ). Thêm `dashboard:read` để xem tài nguyên máy chủ, và `history:read` cho poller sự kiện.

Kiểm tra nhanh sau khi cấu hình: đăng nhập tài khoản quản trị hệ thống rồi gọi `GET /api/v1/hgvision/status`. Kết quả đúng là `configured: true, reachable: true` kèm danh sách scope.

## Lấy JSON thật trên máy trường (qua AnyDesk)

Script `capture-real.mjs` **chỉ đọc**: gọi khoảng 30 API GET và không ghi gì xuống HGVision. Mỗi mảng chỉ giữ 5 phần tử. `username`/`password` camera được thay bằng `***`.

```bash
# Trên máy trường, trong thư mục capstone-be (.env đã có client thật)
npm run hgvision:capture                          # → scripts/hgvision/.capture/real/
npm run hgvision:capture -- --compare real <nhãn> # so cấu trúc field giữa 2 lần lấy
```

Thư mục `.capture/` đã nằm trong gitignore và **không được commit**, vì có thể chứa tên hoặc mã người thật.

## Giả định cần kiểm lại trên server thật

1. ~~`live_hls_path` là đường dẫn tương đối trên `:8113`~~ — **đã kiểm 2026-11-18: SAI.** Máy thật trả *tên luồng MediaMTX* (vd `afcd30ac-…`, `…_sub`). `:8113/<tên>/index.m3u8` trả trang đăng nhập (307) còn `:8888/<tên>/index.m3u8` trả `#EXTM3U`, nên BE đọc từ `HGVISION_HLS_BASE_URL`. Nếu giá trị có dấu `/` thì BE vẫn coi là path trên `HGVISION_BASE_URL` như cũ. Nếu HGVision trả nội dung không phải HLS, BE trả 502 `HGVISION_LIVE_NOT_HLS`.
2. Mức `level` trong `cameras/health`: FE hiển thị `good` / `weak` / `offline`; mức khác sẽ hiện theo trạng thái online/offline.
3. Sự kiện vạch đếm: `direction` 1 = vào, −1 = ra (OpenAPI không ghi rõ).
4. POST faces với `face_ident` đã tồn tại: server thật có thể gộp ảnh vào định danh cũ thay vì trả 400.
5. `GET /api/cameras` trả cả `username`/`password` camera, nên BE đã lọc bỏ trước khi gửi xuống FE.

## Đẩy biển số SAVP → HGVision

Trang "Danh sách biển số giám sát" (`/anpr/admin/control-list`) tự đẩy sang HGVision khi `CAMERA_PROVIDER=hgvision`:

- Thêm / sửa / bật-tắt / xoá trên SAVP → thêm / sửa / xoá biển bên HGVision.
- `blocklist` → `is_blacklist: true`; `watchlist` → chỉ tạo biển. Biển có cả hai → danh sách đen.
- Biển bị tắt hết hoặc xoá hết trên SAVP → xoá bên HGVision, **chỉ khi biển do SAVP tạo**.
- Biển có sẵn trên HGVision mà SAVP chưa từng tạo → không ghi đè, không xoá, báo "Đồng bộ HGVision lỗi".
- `HGVISION_WRITE_ENABLED=false` → không gọi HGVision, dòng hiện "Chưa đồng bộ HGVision". Bật cờ rồi bấm nút đồng bộ lại (biểu tượng ↻) để đẩy.
- HGVision lỗi → SAVP vẫn lưu biển, trạng thái "Đồng bộ HGVision lỗi" (rê chuột xem lỗi).

Cần scope `plates:write` cho client trên trang "Tích hợp API" của HGVision. Đổi scope xong khởi động lại BE (token cũ được giữ khoảng 1 giờ).

### Test 1 biển trên máy trường

1. Tích `plates:write` cho client hiện tại trên HGVision.
2. `git pull` nhánh `feature/hgvision-plate-write` (BE + FE), `npm run migration:run` ở BE.
3. Đặt `HGVISION_WRITE_ENABLED=true` trong `.env`, khởi động lại BE.
4. `GET /api/v1/hgvision/status` → thấy `plates:write` trong danh sách scope.
5. Trên SAVP thêm biển `99A-999.99` (SAVP lưu chuẩn hoá `99A99999`, biển giả, không trùng xe thật), loại "Danh sách đen", lý do "TEST đồng bộ". Dòng phải hiện "Đã đồng bộ HGVision".
6. Mở trang biển số của HGVision → có `99A99999`, đánh dấu danh sách đen.
7. Trên SAVP xoá `99A99999` → HGVision không còn `99A99999`.
8. Đặt lại `HGVISION_WRITE_ENABLED=false`, khởi động lại BE.

### Dữ liệu test phải xoá sau khi test

| Ở đâu | Dữ liệu | Cách xoá |
| :--- | :--- | :--- |
| HGVision (máy trường) | Biển `99A99999` và `99A99998` (biển thứ 2 thêm lúc test máy trường 2026-11-19) | Bước 7 ở trên (xoá trên SAVP khi cờ còn bật). Nếu sót: xoá tay trên trang biển số HGVision. |
| DB SAVP (máy trường) | Dòng `vehicle_control_list` biển `99A99999`, `99A99998` (đã xoá mềm) | `scripts/hgvision/cleanup-plate-test.sql`: chạy SELECT xem trước, rồi bỏ comment dòng DELETE |
| `.env` máy trường | `HGVISION_WRITE_ENABLED=true` | Đặt lại `false` (bước 8) |

Unit test (`hgvision-plate-sync.service.spec.ts`, `vehicle-control-list.service.spec.ts`) chỉ dùng mock trong bộ nhớ, không tạo dữ liệu thật.

