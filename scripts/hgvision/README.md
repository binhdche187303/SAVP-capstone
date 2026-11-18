# HGVision scripts

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
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
