# HGVision mock server (dev only)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-11-18 | Thêm script `capture-real.mjs` (lấy JSON thật, chỉ đọc) và mục "Lấy JSON thật trên máy trường" | Mục mới cuối file |
| 2026-11-18 | Tạo mock HGVision (giả lập OpenAPI 1.0.0) để dev SAVP khi không truy cập được máy HGVision thật ở trường | Toàn bộ file |

Server giả bắt chước `docs/hgvision/openapi-1.0.0.json`, chạy bằng Node thuần (không cần cài thêm gói). Dùng để code và test tích hợp HGVision trên máy dev. Khi xong thì đẩy code lên GitHub, máy ở trường pull về và chạy với HGVision thật.

## Chạy

```bash
npm run hgvision:mock:media   # (1 lần) tạo video/HLS/ảnh mẫu bằng ffmpeg; không có thì mock vẫn chạy
npm run hgvision:mock         # http://localhost:8199
```

`.env` của BE trên **máy dev**:

```
HGVISION_ENABLED=true
HGVISION_BASE_URL=http://localhost:8199
HGVISION_CLIENT_ID=cli_mock
HGVISION_CLIENT_SECRET=sk_mock
```

`.env` trên **máy trường** vẫn trỏ về HGVision thật (`http://localhost:8113` + client id/secret tạo ở trang "Tích hợp API" của HGVision). `.env` không được commit, nên mỗi máy giữ cấu hình riêng của mình.

## Mock có gì

| Nhóm | Nội dung |
|---|---|
| Camera | 8 camera, 4 nhóm. `Cong 2 huong vao` mất tín hiệu 3 phút trong mỗi 10 phút. `Phong B.101` có kết nối yếu (FPS thấp, độ trễ cao). `Phong B.102` tắt AI |
| Lịch sử | Cứ 20 giây sinh 1 sự kiện (người/xe), sinh theo thời gian nên tải lại không đổi. Khuôn mặt và biển số lấy từ danh sách định danh đã đăng ký; danh sách đen hiếm khi xuất hiện |
| Vạch đếm | 5 vạch. Lưu lượng theo giờ Việt Nam: cổng đông lúc 7h và 17h; hội trường vào nhiều buổi sáng, ra lúc 11h và 16h |
| Dashboard | Thống kê, tài nguyên máy chủ (CPU/RAM/GPU dao động, ổ đĩa cố định theo `MOCK_DISK_PERCENT`) |
| Playback | Khoảng ghi hình (camera mất tín hiệu thì có khoảng trống), các đoạn 10 phút, HLS, MP4 hỗ trợ Range. Mọi camera đều phát chung 1 video mẫu |
| Định danh | Thêm/sửa/xoá khuôn mặt, ảnh, biển số và danh sách đen. Dữ liệu ghi vào `.state/state.json` |
| Tìm khuôn mặt | Ảnh trùng từng byte với ảnh đã đăng ký → score 0.97; nếu không thì trả `MOCK_SEARCH_IDENT` (nếu có đặt) |

Quy tắc giả lập giống server thật: OAuth2 client_credentials, token 1 giờ, thiếu token → 401, thiếu quyền → 403 `insufficient_scope`. Tham số thời gian nhận cả giây lẫn mili-giây. Ảnh dưới 2KB hoặc không phải JPEG/PNG bị tính là "không có mặt" (`failed`); nếu tất cả ảnh đều hỏng thì trả 422.

Endpoint riêng của mock (server thật không có):
- `GET /__mock/state`: xem SAVP đã đẩy những gì sang.
- `POST /__mock/reset`: đưa về dữ liệu mặc định.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MOCK_PORT` | 8199 | Cổng, cố ý khác 8113 để không đụng HGVision thật |
| `MOCK_CLIENT_ID` / `MOCK_CLIENT_SECRET` | cli_mock / sk_mock | Thông tin client |
| `MOCK_SCOPES` | tất cả | Giới hạn quyền để test lỗi 403 |
| `MOCK_OFFLINE` | | Ép một số camera offline, ví dụ `Sanh A,Bai xe` |
| `MOCK_CROWD_BOOST` | 1 | Hệ số người vào hội trường, đặt 3 để cảnh báo đông người bắn sớm |
| `MOCK_DISK_PERCENT` | 78 | % ổ đĩa, đặt 92 để test cảnh báo đầy ổ |
| `MOCK_SEARCH_IDENT` | | `faces/search` luôn trả người này |
| `MOCK_PLATE` | ngẫu nhiên | `read-from-image` luôn trả biển số này |
| `MOCK_LOG` | | Đặt `1` để log từng request |

## ⚠️ Giả định cần kiểm lại trên server thật

Chạy curl trên máy trường để lấy JSON thật rồi so với mock:
1. Sự kiện vạch đếm: `direction` 1 = vào, −1 = ra (OpenAPI không ghi rõ).
2. POST faces với `face_ident` đã tồn tại → mock trả 400. Server thật có thể gộp ảnh vào định danh cũ.
3. `live_hls_path` là đường dẫn tương đối trên `:8113`.
4. Cấu trúc `notifications`, `dashboard/activity`, `counting-objects/{id}/trajectory` (OpenAPI mô tả sơ sài).
5. `GET /api/cameras` trả cả `username`/`password` camera, nên BE **phải lọc bỏ** trước khi gửi xuống FE.

## Lấy JSON thật trên máy trường (qua AnyDesk)

Script `capture-real.mjs` **chỉ đọc**: gọi khoảng 30 API GET và không ghi gì xuống HGVision. Mỗi mảng chỉ giữ 5 phần tử. `username`/`password` camera được thay bằng `***`.

```bash
# Trên máy trường, sau khi git pull, trong thư mục capstone-be (.env đã có client thật)
npm run hgvision:capture                 # → scripts/hgvision-mock/.capture/real/

# Gửi thư mục .capture/real về máy dev bằng AnyDesk File Transfer, rồi trên máy dev:
npm run hgvision:capture -- --base http://localhost:8199 --id cli_mock --secret sk_mock --label mock
npm run hgvision:capture -- --compare real mock    # liệt kê field khác nhau giữa thật và giả
```

Thư mục `.capture/` đã nằm trong gitignore và **không được commit**, vì có thể chứa tên hoặc mã người thật.
