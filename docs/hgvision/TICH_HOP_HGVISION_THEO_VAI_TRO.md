# Tích hợp HGVision theo vai trò người dùng SAVP

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-11-18 | Tạo file: rà toàn bộ trang của 7 vai trò, gắn API HGVision theo mẫu "Trang → API → Lấy/làm được gì → Ví dụ hiển thị"; chốt cho ghi phần định danh, chỉ dùng HGVision, bảo vệ xem tất cả camera | Toàn bộ file |

*Ngày 18/11/2026. Nguồn: `docs/hgvision/openapi-1.0.0.json` (77 endpoint) và mã nguồn FE/BE SAVP hiện tại.*

## Quyết định đã chốt

| # | Nội dung | Quyết định |
|---|---|---|
| 1 | SAVP có ghi dữ liệu sang HGVision không | **Có, nhưng chỉ phần định danh**: khuôn mặt, biển số, danh sách đen. Camera, ROI, vạch đếm, ghi hình vẫn do HGVision tự quản lý |
| 2 | Face ID đẩy sang đâu | **Chỉ HGVision.** Bỏ luồng đẩy sang IVSS trong `face-provisioning` |
| 3 | Bảo vệ được xem camera nào | **Tất cả camera**, được xem trực tiếp và xem lại |
| 4 | Cảnh báo đông người | **SAVP tự tính** từ vạch đếm của HGVision |

## Cách đọc

- Mỗi mục theo mẫu: **Trang → Gắn API → Lấy được / làm được → Ví dụ hiển thị**.
- Loại thao tác: **[Đọc]** chỉ lấy dữ liệu, **[Ghi]** SAVP gửi dữ liệu sang HGVision.
- Mức ưu tiên: **★ Làm ngay** · **☆ Nên làm** · **○ Tuỳ chọn** · **✔ Đã nối**.
- Mọi API đều đi qua BE SAVP. FE không gọi thẳng HGVision (`http://<IP>:8113`).
- **Quy ước định danh:** `face_ident` trên HGVision = **mã người dùng SAVP** (mã GV, mã SV, mã NV, hoặc mã khách). Nhờ vậy poller đọc `face_ident_text` là biết ngay là ai.

---

## 1. Chạy ngầm ở BE (không có trang riêng)

Phần nền cho mọi vai trò bên dưới.

### 1.1 Lấy sự kiện nhận diện — ✔ Đã nối
- **Gắn API:** [Đọc] `GET /api/history` (poller), [Đọc] `GET /api/media/images/{path}`.
- **Lấy được:** ai hoặc xe nào xuất hiện ở camera nào, lúc nào, kèm ảnh. Đây là dữ liệu đầu vào cho chuyên cần, ANPR, người lạ, truy vết.

### 1.2 Đồng bộ Face ID sang HGVision — ★ Làm ngay
- **Gắn API:**
  - [Ghi] `POST /api/identification/faces`: tạo định danh mới, gửi kèm ảnh (multipart: `face_ident`, `face_infor`, `file[]`).
  - [Ghi] `POST /api/identification/faces/{mã}/images`: thêm ảnh cho người đã có định danh.
  - [Ghi] `DELETE /api/identification/faces/{mã}`: xoá định danh khi tài khoản bị khoá, SV ra trường, hoặc khách check-out.
  - [Đọc] `GET /api/identification/faces/{mã}`: kiểm tra lại số ảnh đã lưu.
- **Làm được:** khi ảnh được duyệt, BE tự đẩy lên HGVision. HGVision trả về số ảnh `failed` (không phát hiện được khuôn mặt). SAVP lưu trạng thái đồng bộ: *Chưa đẩy / Đã đẩy / Lỗi ảnh*.
- **Thay đổi mã:** `face-provisioning` đổi đích từ IVSS sang HGVision.

### 1.3 Theo dõi camera mất tín hiệu — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/cameras/health`, gọi mỗi phút.
- **Làm được:** camera chuyển sang trạng thái mất kết nối thì tạo cảnh báo trong `device-alert` và báo cho admin và bảo vệ. Có kết nối lại thì tự đóng cảnh báo.

### 1.4 Tính số người theo khu vực — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/counting-lines/{id}/counts?from=&to=`, gọi mỗi phút.
- **Làm được:** số người hiện tại = vào − ra, tính từ mốc đầu ngày. Kết quả đưa vào `crowd-alert` để so với ngưỡng như hiện nay.

### 1.5 Cảnh báo danh sách đen thời gian thực — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/notifications`, gọi mỗi 5–10 giây.
- **Làm được:** có cảnh báo danh sách đen mới thì BE đẩy qua websocket xuống màn hình bảo vệ và admin.

---

## 2. Admin hệ thống (`/system-admin`)

### 2.1 `/system-admin` (Dashboard) — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/dashboard/overview`, `GET /api/dashboard/resources`, `GET /api/dashboard/recent-events`.
- **Lấy được:**
  - Số camera đang hoạt động trên tổng số, số sự kiện hôm nay, số người đã đăng ký mặt, số biển số đã đăng ký.
  - CPU / RAM / GPU / ổ đĩa của máy chủ AI.
  - 20 sự kiện gần nhất.
- **Ví dụ hiển thị:**
```
┌ Máy chủ AI HGVision ─────────────────────────────────────┐
│ Camera 10/12 hoạt động · Sự kiện hôm nay 1.284           │
│ CPU 42% ▓▓▓▓░░░░░░  GPU 55% ▓▓▓▓▓░░░░░                    │
│ Ổ đĩa 78% ▓▓▓▓▓▓▓▓░░ (1,4/1,8 TB) ⚠ >80% sẽ xoá bản ghi cũ │
└──────────────────────────────────────────────────────────┘
```

### 2.2 `/system-admin/devices` (Thiết bị) — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/cameras`, `GET /api/cameras/health`, `GET /api/cameras/{tên}/health`, `GET /api/cameras/{tên}/logs`.
- **Lấy được:**
  - Từng camera: IP, nhóm, trạng thái, FPS thực tế so với FPS chuẩn, độ trễ, số lần mất kết nối trong 24 giờ.
  - Camera đang bật những gì: AI, nhận diện mặt, nhận diện biển số, ghi hình.
  - Nhật ký kết nối.
- ⚠ `GET /api/cameras` có trả về `username` và `password` của camera. BE **phải bỏ hai trường này** trước khi gửi sang FE.
- **Ví dụ hiển thị:**
```
Camera          Trạng thái      FPS    Trễ    Mất KN 24h  AI  Mặt  Biển  Ghi
Cổng chính      ● Online        25/25  40ms   0           ✓   ✓    ✓     ✓
Cong 2 huong..  ● Mất tín hiệu   0/25  —      7           ✓   ✗    ✓     ✓
→ Bấm 1 dòng: biểu đồ FPS 1 giờ + "08:02 mất kết nối – 08:05 kết nối lại"
```

### 2.3 `/system-admin/camera-groups` (Nhóm camera) — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/groups`, `GET /api/groups/{nhóm}/cameras`, `GET /api/cameras/statuses`.
- **Lấy được:** các nhóm của HGVision, camera trong từng nhóm kèm trạng thái, và zone SAVP mà camera đang gắn.
- **Ví dụ hiển thị:**
```
▼ Cổng (3 camera · 2 online)                 [Mở HGVision ↗]
    Cổng chính       ● Online   25 FPS   Khu vực: Cổng A
    Cong 2 huong vao ● Offline   0 FPS   Khu vực: Cổng B
```

### 2.4 `/system-admin/camera-layout` (Xem trực tiếp) — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/cameras/statuses`, trường `live_hls_path`.
- **Lấy được:** luồng trực tiếp của từng camera. Màn hình dùng chung component với màn bảo vệ (mục 4.2).

### 2.5 `/system-admin/camera-recording` (Ghi hình) — ★ Làm ngay
- **Gắn API:**
  - [Đọc] `GET /api/dashboard/resources`, trường `disk`.
  - [Đọc] `GET /api/playback/recordings`.
  - [Đọc] `GET /api/recording/segments` + `GET /api/recording/thumb/{file}`.
  - [Đọc] `GET /api/playback/playlist` hoặc `GET /api/playback/video`, và `GET /api/playback/download`.
- **Lấy được:** dung lượng ổ; với mỗi camera là thanh 24 giờ thể hiện các khoảng có ghi hình và khoảng trống; xem lại và tải MP4.
- **Ví dụ hiển thị:**
```
Lưu trữ 1,4/1,8 TB (78%) · Giới hạn lưu trữ chỉnh trên HGVision
Cổng chính    ████████████████████████  100%
Cong 2 huong  ██████░░░░░░██████████████   71%  ⚠ trống 07:00–11:20
```

### 2.6 `/system-admin/camera-map-3d` (Bản đồ camera) — ☆ Nên làm
- **Gắn API:** [Đọc] `GET /api/cameras` (`latitude`, `longitude`) và `GET /api/cameras/statuses`.
- **Ví dụ hiển thị:** chấm 🟢 / 🔴 trên bản đồ khuôn viên. Bấm vào chấm thì mở luồng trực tiếp.

### 2.7 `/system-admin/zones` (Khu vực), tab "Camera & đếm người" — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/cameras/statuses`, `GET /api/counting-lines?camera_name=`, `GET /api/counting-lines/{id}/counts`, `GET /api/shapes`.
- **Làm được:**
  - Chọn camera và vạch đếm thuộc từng zone, ghi rõ chiều "vào zone" của mỗi vạch.
  - Đặt ngưỡng đông người.
  - Xem số người hiện tại.
- **Ví dụ hiển thị:**
```
Hội trường A · Ngưỡng 200
Sảnh A - cửa 1  Line_Cua1  IN = vào khu vực   Vào 312  Ra 180
Sảnh A - cửa 2  Line_Cua2  IN = ra khu vực    Vào  40  Ra  95
Hiện tại: 187/200 ▓▓▓▓▓▓▓▓▓░ 94%
```

### 2.8 `/system-admin/zone-traffic` (Lưu lượng khu vực) — ☆ Nên làm
- **Gắn API:** [Đọc] `GET /api/counting-lines/{id}/timeseries`, `GET /api/dashboard/traffic-flow`, `GET /api/dashboard/object-type-stats`.
- **Ví dụ hiển thị:** biểu đồ vào/ra theo giờ, ghi chú "Cao điểm 07:00–08:00: 412 lượt vào", tỉ lệ người / xe máy / ô tô.

### 2.9 `/system-admin/security-alerts` (Cảnh báo an ninh) — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/notifications`, `GET /api/media/images/{path}`, `GET /api/playback/video?start=t-30s&end=t+30s`.
- **Lấy được:** cảnh báo danh sách đen người và xe từ HGVision, kèm ảnh hiện trường, ảnh định danh, clip ±30 giây. Hiển thị chung với cảnh báo đông người và khu vực cấm do SAVP tự sinh.
- **Ví dụ hiển thị:**
```
🔴 Danh sách đen · Trần Văn B · Cổng chính · 08:12   [ảnh] [▶ Clip ±30s]
🟠 Đông người (SAVP) · Hội trường A 215/200 · 08:30
```

### 2.10 `/system-admin/person-control-list` (Danh sách đen người) — ★ Làm ngay
- **Gắn API:** [Ghi] `PATCH /api/identification/faces/{mã}` với `{is_blacklist: true/false}`; [Đọc] `GET /api/identification/faces?is_blacklist=1`.
- **Làm được:** thêm hoặc bỏ người khỏi danh sách đen ngay trên SAVP. Người chưa có định danh trên HGVision (chẳng hạn người ngoài) thì tạo mới bằng `POST /api/identification/faces` với `is_blacklist=1` và ảnh.
- **Ví dụ hiển thị:**
```
Mã          Họ tên        Ảnh trên camera   Danh sách đen
K245022256  Nguyễn Văn C  3 ảnh             [■ BẬT]
NGOAI-0007  (người ngoài) 2 ảnh             [■ BẬT]   [+ Thêm người ngoài từ ảnh]
```

### 2.11 `/system-admin/vehicle-control-list` (Danh sách đen xe) — ★ Làm ngay
- **Gắn API:** [Ghi] `POST /api/identification/license-plates` (biển mới), `PATCH /api/identification/license-plates/{biển}`; [Đọc] `GET /api/identification/license-plates?is_blacklist=1`.
- **Ví dụ hiển thị:** `51F-999.99 · Chủ: không rõ · Danh sách đen [■ BẬT]`

### 2.12 `/system-admin/vehicle-registrations` (Duyệt đăng ký xe) — ★ Làm ngay
- **Gắn API:** [Ghi] `POST /api/identification/license-plates` (`license_plate`, `ident` = mã chủ xe); [Ghi] `DELETE /api/identification/license-plates/{biển}` khi huỷ đăng ký.
- **Làm được:** duyệt xe xong thì BE đẩy biển số lên HGVision, để camera cổng nhận ra xe là của ai.
- **Ví dụ hiển thị:** `51F-123.45 · Nguyễn Văn A · Đã duyệt · Camera: ✓ Đã đồng bộ`

### 2.13 `/system-admin/anpr-management` và `gate-presence` (Xe ra vào) — ✔ Đã nối + ☆ Bổ sung
- **Gắn API:** ✔ [Đọc] `GET /api/history` (poller); ☆ [Đọc] `GET /api/counting-lines/{id}/events` (có `direction` và `lp_text`).
- **Lấy được:** biển số, loại xe, ảnh, và **chiều vào/ra chính xác** tại cổng.
- **Ví dụ hiển thị:**
```
08:14 ⬇ VÀO 51F-123.45 Xe máy Cổng 2 [ảnh]   ·  Xe đang trong khuôn viên: 342
```

### 2.14 `/system-admin/strangers` (Người lạ) — ✔ Đã nối + ☆ Bổ sung clip
- **Gắn API:** ✔ [Đọc] `GET /api/history`; ☆ [Đọc] `GET /api/playback/video`.
- **Ví dụ hiển thị:** `[ảnh] Người lạ · Sảnh A · 08:05–08:07 · [▶ Clip] [Đưa vào danh sách đen]`. Nút "Đưa vào danh sách đen" dẫn sang mục 2.10.

### 2.15 `/system-admin/camera-trace` và `user-journey` (Truy vết) — ✔ Đã nối
- **Gắn API:** [Đọc] `GET /api/history?face_ident=` hoặc `?lp_text=`; ○ [Đọc] `GET /api/counting-objects/{id}/trajectory`.
- **Ví dụ hiển thị:** `07:52 Cổng chính → 07:58 Sảnh A → 08:01 B.101 → 11:30 Cổng chính`

### 2.16 `/system-admin/room-access-logs` (Ra vào phòng) — ☆ Nên làm
- **Gắn API:** [Đọc] `GET /api/counting-lines/{id}/events`, dùng với vạch đặt ở cửa phòng.
- **Ví dụ hiển thị:** `08:01 ⬇ VÀO B.101 · Nguyễn Văn A · [ảnh]`

### 2.17 `/system-admin/reports` (Báo cáo) — ☆ Nên làm
- **Gắn API:** [Đọc] `GET /api/history/statistics`, `GET /api/dashboard/traffic-flow`, `GET /api/dashboard/detection-flow`, `GET /api/counting-lines/{id}/timeseries`.
- **Ví dụ hiển thị:** `Tuần 46: 8.920 sự kiện · 5.102 lượt nhận diện mặt · 1.877 lượt biển số`

### 2.18 `/system-admin/visitors` (Khách) — xem mục 4.4

---

## 3. Admin nghiệp vụ (`/business-admin`)

### 3.1 `/business-admin/biometric-submissions` (Duyệt ảnh khuôn mặt) — ★ Làm ngay
- **Gắn API:** [Ghi] `POST /api/identification/faces` (người mới) hoặc `POST /api/identification/faces/{mã}/images` (thêm ảnh); [Đọc] `GET /api/identification/faces/{mã}`.
- **Làm được:** bấm "Duyệt" thì ảnh được đẩy lên HGVision ngay. Nếu HGVision báo ảnh không có khuôn mặt (`failed`), SAVP hiển thị lỗi để yêu cầu người dùng gửi lại ảnh.
- **Ví dụ hiển thị:**
```
K245022256 · Nguyễn Văn A · 3 ảnh   [Duyệt] [Từ chối]
→ Sau duyệt: ✓ Đã đẩy lên camera (3/3 ảnh hợp lệ)
→ Lỗi:       ⚠ 1/3 ảnh không nhận ra khuôn mặt – yêu cầu chụp lại
```

### 3.2 `/business-admin/users` (Người dùng) — ☆ Nên làm
- **Gắn API:** [Đọc] `GET /api/identification/faces/{mã}`; [Ghi] `DELETE /api/identification/faces/{mã}` khi khoá hoặc xoá tài khoản.
- **Ví dụ hiển thị:** thêm cột **"Face ID trên camera"** có giá trị `✓ 3 ảnh` / `✗ Chưa có` / `⚠ Lỗi đồng bộ`. Kèm bộ lọc "Chưa có Face ID" để nhắc người dùng đăng ký.

### 3.3 `class-attendance`, `meeting-attendance`, `attendance-analytics` — ✔ Đã nối + ☆ Bổ sung bằng chứng
- **Gắn API:** ✔ [Đọc] `GET /api/history`; ☆ [Đọc] `GET /api/media/images/{path}`, `GET /api/playback/video`.
- **Ví dụ hiển thị:** `K245022256 · Có mặt 07:02 · B.101 · [ảnh bằng chứng] [▶ clip]`

### 3.4 `room-analytics`, `zone-traffic`, `camera-trace`, `camera-map-3d`, `reports`
Dùng chung API với các mục 2.6, 2.8, 2.15, 2.17. Chỉ khác phạm vi dữ liệu theo quyền.

---

## 4. Bảo vệ (`/guard`)

### 4.1 `/guard` (Trang chính bảo vệ) — ★ Làm ngay
- **Gắn API:**
  - [Đọc] `GET /api/cameras/statuses`.
  - [Đọc] `GET /api/notifications` (qua websocket, mục 1.5).
  - [Đọc] `GET /api/dashboard/recent-events`.
- **Lấy được:** số camera online/offline, cảnh báo mới nhất, các sự kiện gần nhất.
- **Ví dụ hiển thị:**
```
Camera 10/12 online (⚠ 2 mất tín hiệu)   Cảnh báo chưa xử lý: 3
[🔴 08:12 Danh sách đen – Cổng chính]  [Xem trực tiếp] [Xem clip]
```

### 4.2 Màn xem camera trực tiếp (trang mới `/guard/live`) — ★ Làm ngay
Màn này làm giống màn trong video HGVision.
- **Gắn API:** [Đọc] `GET /api/cameras/statuses` (`live_hls_path`), `GET /api/groups`, `GET /api/playback/playlist` để xem lại.
- **Làm được:**
  - Xem **tất cả camera**, lưới 1 / 4 / 9 / 16 ô, lọc theo nhóm.
  - Bấm vào một ô để phóng to.
  - Chuyển sang chế độ xem lại với thanh thời gian.
  - Camera mất tín hiệu hiện ô xám có chữ "Mất tín hiệu".
  - Khi có cảnh báo, ô của camera liên quan nháy đỏ.
- **Ví dụ hiển thị:**
```
Nhóm: [Tất cả ▼]   Lưới: [1] [4] [9] [16]          ● 10 online  ● 2 offline
┌────────────┬────────────┬────────────┐
│ Cổng chính │ Cổng 2     │ Sảnh A     │
│ ▶ LIVE     │ ⚠ Mất tín  │ ▶ LIVE 🔴  │  ← nháy đỏ khi có cảnh báo
├────────────┼────────────┼────────────┤
│ B.101      │ B.102      │ Bãi xe     │
└────────────┴────────────┴────────────┘
[◀ Xem lại]  ────●──────────── 08:15
```

### 4.3 `/guard/security-alerts` và `visitor-alerts` — ★ Làm ngay
- **Gắn API:** [Đọc] `GET /api/notifications`, `GET /api/media/images/{path}`, `GET /api/playback/video` (±30 giây).
- **Ví dụ hiển thị:** `🔴 Trần Văn B (danh sách đen) · Cổng chính · 08:12 · [ảnh hiện trường | ảnh đăng ký] [▶ Clip] [Đã xử lý]`

### 4.4 `/guard/visitors/desk` (Tiếp khách) — ★ Làm ngay
- **Gắn API:**
  - [Ghi] `POST /api/identification/faces`: lúc check-in, chụp mặt khách, `face_ident` = mã khách.
  - [Ghi] `DELETE /api/identification/faces/{mã khách}`: lúc check-out hoặc hết hạn thẻ.
  - [Đọc] `GET /api/history?face_ident=<mã khách>`: lộ trình của khách.
- **Làm được:** camera nhận ra khách trong thời gian khách ở trong khuôn viên. Bảo vệ thấy khách đang ở đâu. Khách ra khỏi khuôn viên thì định danh tự bị xoá.
- **Ví dụ hiển thị:**
```
Khách: Phạm Văn E · Gặp: Phòng HC · Check-in 08:00   [📷 Chụp mặt → ✓ đã gửi camera]
Vị trí gần nhất: Sảnh A lúc 08:06
[Check-out → xoá Face ID khách]
```

### 4.5 `/guard/anpr` (Xe ra vào cổng) — ✔ Đã nối + ☆ Bổ sung chiều
- **Gắn API:** giống mục 2.13. Thêm ô "Xe lạ (chưa đăng ký)" và nút "Đưa vào danh sách đen" dẫn sang mục 2.11.

---

## 5. Quản lý (`/manager`)

| Trang | Gắn API | Ví dụ hiển thị |
|---|---|---|
| `face-register` | Như mục 6.1 | Như mục 6.1 |
| `meeting-attendance`, `attendance-analytics` | ✔ `GET /api/history` + ảnh/clip | `Nguyễn Văn A · vào phòng họp 09:02 · [ảnh]` |
| `zone-traffic`, `user-journey`, `reports` | Như mục 2.8, 2.15, 2.17 | Theo phạm vi phòng ban |
| `my-vehicles` | Như mục 6.3 | Như mục 6.3 |
| `my-visitors` | Như mục 6.4 | Như mục 6.4 |

## 6. Giảng viên / Sinh viên / Nhân viên

### 6.1 `face-register` (Đăng ký khuôn mặt) — ★ Làm ngay
- **Gắn API:** gián tiếp. Ảnh đi qua bước duyệt ở mục 3.1 rồi mới được đẩy lên. Trang này [Đọc] `GET /api/identification/faces/{mã của tôi}` để hiển thị trạng thái.
- **Ví dụ hiển thị:**
```
Face ID của tôi:  ✓ Camera đã nhận diện được bạn (3 ảnh)
                  ⏳ Đang chờ duyệt
                  ⚠ Ảnh bị từ chối: không thấy rõ khuôn mặt – chụp lại
```

### 6.2 `attendance` (GV: lớp của tôi, SV: chuyên cần của tôi) — ✔ Đã nối + ☆ Bổ sung bằng chứng
- **Gắn API:** ✔ `GET /api/history`; ☆ `GET /api/media/images/{path}`.
- **Ví dụ hiển thị:**
  - SV: `Buổi 18/11 · Có mặt 07:02 · [ảnh camera chụp]`. Dùng làm bằng chứng khi khiếu nại.
  - GV: danh sách lớp, mỗi SV kèm ảnh nhỏ.

### 6.3 `my-vehicles` (Xe của tôi) — ☆ Nên làm
- **Gắn API:** gián tiếp qua mục 2.12. Trang chỉ [Đọc] trạng thái đồng bộ và [Đọc] `GET /api/history?lp_text=` để xem lần vào/ra gần nhất.
- **Ví dụ hiển thị:** `51F-123.45 · ✓ Camera cổng nhận diện · Lần cuối: VÀO cổng 2 lúc 07:45`

### 6.4 `my-visitors` (Khách của tôi) — ○ Tuỳ chọn
- **Gắn API:** [Đọc] `GET /api/history?face_ident=<mã khách>`.
- **Ví dụ hiển thị:** `Khách Phạm Văn E · đã tới Sảnh A lúc 08:06`. Khi khách đã tới, người hẹn nhận được thông báo.

### 6.5 `personal-statistics`, `user-journey` (Nhân viên) — ○ Tuỳ chọn
- **Gắn API:** [Đọc] `GET /api/history?face_ident=<mã của tôi>`.
- **Ví dụ hiển thị:** `Hôm nay: vào 07:52 · ra 17:10`

---

## 7. Quyền cần xin khi tạo client API trên HGVision

| Quyền | Loại | Dùng cho |
|---|---|---|
| `history:read` | Đọc | Poller, chuyên cần, truy vết, ANPR, người lạ |
| `cameras:read` | Đọc | Thiết bị, nhóm, xem trực tiếp, bản đồ, khu vực |
| `dashboard:read` | Đọc | Dashboard, ghi hình, lưu lượng, báo cáo |
| `counting:read` | Đọc | Đếm người, ra vào cổng/phòng |
| `notifications:read` | Đọc | Cảnh báo danh sách đen |
| `playback:read` | Đọc | Xem lại, clip ±30 giây |
| `faces:read`, `faces:write` | **Ghi** | Đồng bộ Face ID, khách, danh sách đen người |
| `plates:read`, `plates:write` | **Ghi** | Đăng ký xe, danh sách đen xe |

## 8. Những API vẫn không dùng

- **Thêm/sửa/xoá camera, bật/tắt AI hoặc ghi hình, ROI, ONVIF, encoder:** HGVision tự quản lý.
- **Tạo/sửa/xoá nhóm và vạch đếm:** người vận hành làm trên HGVision.
- **Sửa/xoá sự kiện lịch sử; đánh dấu đã đọc hoặc xoá cảnh báo:** SAVP tự quản lý trạng thái xử lý.
- **Tìm theo vector đặc trưng, đăng ký mặt hàng loạt bằng ZIP:** chưa cần. Có thể dùng ZIP cho lần đồng bộ đầu tiên toàn trường.

## 9. Thứ tự làm đề xuất

1. **BE nền:**
   - Client HGVision có cache và quyền ghi định danh.
   - Bỏ IVSS, đổi `face-provisioning` sang HGVision (mục 1.2).
   - Đồng bộ biển số (mục 2.12).
2. **Bảo vệ:** màn xem trực tiếp `/guard/live` (4.2), cảnh báo thời gian thực có clip (1.5, 4.3), tiếp khách có Face ID tạm (4.4).
3. **Trạng thái camera:** thiết bị (2.2), nhóm (2.3), cảnh báo mất tín hiệu (1.3), sức khoẻ máy chủ (2.1).
4. **Danh sách đen** người và xe (2.10, 2.11).
5. **Khu vực, đếm người, cảnh báo đông người** (2.7, 1.4), sau đó ghi hình (2.5).
6. **Nhóm ☆ / ○:** bằng chứng chuyên cần, báo cáo, lưu lượng, xe của tôi, khách của tôi.

**Điều kiện trước khi code:**
- Có IP thật của máy chủ HGVision.
- Có client API với đủ các quyền ở mục 7.
- Có vạch đếm vẽ sẵn ở các cửa.
- Có file `openapi.json` bản mới.
