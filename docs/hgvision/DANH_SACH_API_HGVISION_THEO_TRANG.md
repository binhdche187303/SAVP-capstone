# Danh sách API HGVision gắn theo từng trang SAVP

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-11-18 | Tạo file: chọn lọc API từ openapi-1.0.0.json (77 endpoint) và gắn vào từng trang SAVP theo mẫu "Trang → API → Lấy được gì → Ví dụ hiển thị" | Toàn bộ file |

*Ngày 18/11/2026. Nguồn: `docs/hgvision/openapi-1.0.0.json` (HGVision API tích hợp 1.0.0). Nguyên tắc: SAVP chỉ đọc dữ liệu từ HGVision.*

## Cách đọc tài liệu

- Mỗi mục theo mẫu: **Trang SAVP → Gắn API → Lấy được thông tin → Ví dụ hiển thị**.
- Mức ưu tiên: **★ Làm ngay** · **☆ Nên làm** · **○ Tuỳ chọn** · **✔ Đã nối** (BE đang dùng).
- Địa chỉ gốc HGVision là `http://<IP máy chủ>:8113`. Mọi API đều đi qua BE SAVP, FE không gọi thẳng HGVision.
- Camera được định danh bằng `camera_name` (tham số `camera_id` trong history/playback cũng nhận tên camera). Thời gian dùng Unix epoch.
- Từ 77 endpoint, tài liệu chọn **36 API đọc**. Phần cuối liệt kê những API không dùng và lý do.

---

## A. Tổng quan & thiết bị camera

### 1. `/system-admin` (Dashboard) — ★ Làm ngay

**Gắn API:**
- `GET /api/dashboard/overview`: một lần gọi trả về stats, số đối tượng theo loại, lưu lượng và lượt nhận diện theo giờ.
- `GET /api/dashboard/resources`: CPU, RAM, ổ đĩa, GPU của máy chủ AI.
- `GET /api/dashboard/recent-events`: 20 sự kiện gần nhất trong ngày. Ảnh tải qua `GET /api/media/images/{path}`.

**Lấy được thông tin:**
- `stats`: `total_cameras`, `active_cameras`, `today_events`, `total_faces`, `total_lp_idents`.
- `object_type_stats`: số `pedestrian`, `car`, `motorbike`, `truck`, `bus`, `bicycle`.
- `resources`: `cpu.percent`, `memory.percent/used/total`, `disk.percent/used/total`, `gpu.utilization`, `gpu.memory_percent`.
- `recent-events`: loại đối tượng, camera, tên người (`face_ident_text`), biển số (`lp_text`), ảnh, thời gian.

**Ví dụ hiển thị:**
```
┌ Máy chủ AI HGVision ──────────────────────────────────────┐
│ Camera: 10/12 hoạt động   Sự kiện hôm nay: 1.284          │
│ CPU 42%  ▓▓▓▓░░░░░░   RAM 61%  ▓▓▓▓▓▓░░░░                 │
│ GPU 55%  ▓▓▓▓▓░░░░░   Ổ đĩa 78% ▓▓▓▓▓▓▓▓░░  (1,4/1,8 TB)  │
│ ⚠ Ổ đĩa > 80% sẽ bị HGVision tự xoá bản ghi cũ            │
└───────────────────────────────────────────────────────────┘
Sự kiện gần nhất:  [ảnh] Nguyễn Văn A · Cổng chính · 08:15
                   [ảnh] 51F-123.45 · Cổng 2 · 08:14
```

### 2. `/system-admin/devices` (Quản lý thiết bị) — ★ Làm ngay

**Gắn API:**
- `GET /api/cameras`: danh sách đầy đủ camera.
- `GET /api/cameras/health`: sức khoẻ kết nối của tất cả camera.
- `GET /api/cameras/{camera_name}/health`: chi tiết một camera kèm lịch sử FPS, bitrate, độ trễ.
- `GET /api/cameras/{camera_name}/logs`: nhật ký mất/có kết nối.

**Lấy được thông tin:**
- Từ `cameras`: tên, IP, cổng, nhóm, toạ độ, `status`, bật AI / nhận diện mặt / biển số / ghi hình, ảnh đại diện.
- Từ `health`: `level`, `reasons`, `fps` so với `fps_expected`, `bitrate_kbps`, `latency_ms`, `reachable`, `disconnects_24h`, `connected_since_ms`.
- Từ `logs`: thời điểm, mức, nội dung từng lần mất hoặc có kết nối lại.

> ⚠ `GET /api/cameras` trả về cả `username` và `password` của camera. BE **phải bỏ hai trường này** trước khi gửi sang FE.

**Ví dụ hiển thị:**
```
Camera          Nhóm       Trạng thái     FPS      Trễ    Mất KN 24h  AI  Ghi
Cổng chính      Cổng       ● Online       25/25    40ms   0           ✓   ✓
Cong 2 huong..  Cổng       ● Mất tín hiệu  0/25    —      7           ✓   ✓
Phòng B.101     Toà B      ● Online       12/15    120ms  2           ✓   ✗
→ Bấm 1 dòng: biểu đồ FPS/bitrate 1 giờ + nhật ký "08:02 mất kết nối – 08:05 kết nối lại"
```

### 3. `/system-admin/camera-groups` (Nhóm camera) — ★ Làm ngay

**Gắn API:**
- `GET /api/groups`: danh sách nhóm.
- `GET /api/groups/{group_name}/cameras`: tên các camera trong nhóm.
- `GET /api/cameras/statuses`: trạng thái nhanh, dùng để polling.

**Lấy được thông tin:**
- Nhóm: `GROUP_NAME`, `DESCRIPTION`, `LATITUDE`, `LONGITUDE`, `camera_count`.
- Camera: `status`, `fps`, `using_ai`, `camera_group`.
- SAVP tự thêm cột "Khu vực SAVP" (zone đang gắn).

**Ví dụ hiển thị:**
```
▼ Cổng (3 camera · 2 online)                     [Mở HGVision ↗]
    Cổng chính       ● Online   25 FPS  AI ✓   Khu vực: Cổng A
    Cong 2 huong vao ● Offline   0 FPS  AI ✓   Khu vực: Cổng B
▶ Toà B (8 camera · 8 online)
```

### 4. `/system-admin/camera-layout` (Xem trực tiếp) — ☆ Nên làm

**Gắn API:**
- `GET /api/cameras/statuses`: trường `live_hls_path`.

**Lấy được thông tin:** đường dẫn luồng HLS trực tiếp của từng camera, kèm trạng thái để ẩn ô khi camera offline.

**Ví dụ hiển thị:**
```
┌────────────┬────────────┬────────────┐
│ Cổng chính │ Toà B.101  │ Sảnh A     │   lưới 2x2 / 3x3, phát bằng hls.js
│  ▶ LIVE    │  ▶ LIVE    │ ⚠ Mất tín  │
└────────────┴────────────┴────────────┘
```

### 5. `/system-admin/camera-map-3d` (Bản đồ camera) — ○ Tuỳ chọn

**Gắn API:**
- `GET /api/cameras`: các trường `latitude`, `longitude`.
- `GET /api/groups`: các trường `LATITUDE`, `LONGITUDE`.
- `GET /api/cameras/statuses`: trạng thái.

**Lấy được thông tin:** toạ độ từng camera và nhóm, để đặt chấm xanh/đỏ lên bản đồ khuôn viên.

**Ví dụ hiển thị:** chấm 🟢 / 🔴 trên bản đồ. Bấm vào chấm thì mở luồng live của camera đó.

### 6. `/system-admin/camera-recording` (Ghi hình) — ★ Làm ngay

**Gắn API:**
- `GET /api/dashboard/resources`: trường `disk`.
- `GET /api/playback/recordings?camera_id=&start_time=&end_time=`: các khoảng có ghi hình.
- `GET /api/recording/segments` + `GET /api/recording/thumb/{file_path}`: các đoạn đã lưu kèm ảnh thumbnail.
- `GET /api/playback/playlist` (HLS) hoặc `GET /api/playback/video` (MP4): xem lại.
- `GET /api/playback/download`: tải MP4.

**Lấy được thông tin:**
- Dung lượng ổ đã dùng / tổng.
- Với mỗi camera: danh sách `{start_ms, end_ms}`. Từ đó SAVP tính % thời gian có ghi hình và các khoảng trống.
- URL thumbnail và URL file của từng đoạn.
- Không có API cho giới hạn lưu trữ (80%, số ngày giữ). Phần này chỉ chỉnh trên giao diện HGVision.

**Ví dụ hiển thị:**
```
Lưu trữ: 1,4 / 1,8 TB (78%)   · Giới hạn lưu trữ chỉnh trên HGVision
Camera        00h      06h      12h      18h     24h   Có ghi   Trống
Cổng chính    ████████████████████████████████████    100%     —
Cong 2 huong  ██████████░░░░░░░░████████████████       71%    ⚠ 07:00–11:20
→ Bấm vào thanh lúc 08:15 → mở trình phát tại 08:15
```

---

## B. Khu vực & lưu lượng người

### 7. `/system-admin/zones` (Khu vực), tab "Camera & đếm người" — ★ Làm ngay

**Gắn API:**
- `GET /api/cameras/statuses`: để chọn camera thuộc zone.
- `GET /api/counting-lines?camera_name=`: các vạch đếm của camera.
- `GET /api/counting-lines/{line_id}/counts?from=&to=`: tổng vào/ra, dùng cho cảnh báo đông người do SAVP tự tính.
- `GET /api/shapes?camera_name=`: các vùng đã vẽ trên HGVision. Chỉ dùng để hiển thị.

**Lấy được thông tin:**
- Vạch đếm: `line_name`, toạ độ `x1, y1, x2, y2`, chiều IN (`normal_x`, `normal_y`), `in_count`, `out_count`, `object_types`.
- `counts`: `in_count`, `out_count`, `by_object_type`.
- Từ đó SAVP tính **số người hiện tại = vào − ra** (tính từ mốc reset đầu ngày).

**Ví dụ hiển thị:**
```
Khu vực: Hội trường A          Ngưỡng đông người: 200
Camera         Vạch đếm       Chiều IN của HGVision   Vào   Ra
Sảnh A - cửa 1 Line_Cua1      = vào khu vực           312   180
Sảnh A - cửa 2 Line_Cua2      = ra khỏi khu vực        40    95
Số người hiện tại: 187 / 200   ▓▓▓▓▓▓▓▓▓░ 94%   (cập nhật 08:31)
```

### 8. `/system-admin/zone-traffic` (Lưu lượng khu vực) — ☆ Nên làm

**Gắn API:**
- `GET /api/counting-lines/{line_id}/timeseries?from=&to=&bucket=`: số vào/ra theo từng khung thời gian.
- `GET /api/dashboard/traffic-flow?camera_id=&start_time=&end_time=`: lưu lượng theo loại đối tượng. Khung tự động là 1h, 3h, 6h hoặc 24h tuỳ độ dài khoảng thời gian.
- `GET /api/dashboard/object-type-stats?camera_id=`: tổng theo loại.

**Lấy được thông tin:** biểu đồ vào/ra theo giờ cho từng zone (cộng các vạch thuộc zone), giờ cao điểm, tỉ lệ người / xe máy / ô tô.

**Ví dụ hiển thị:**
```
Hội trường A – hôm nay        Cao điểm: 07:00–08:00 (412 lượt vào)
  vào ▇▇  ra ░░
  07h ▇▇▇▇▇▇▇▇ ░░
  08h ▇▇▇▇▇    ░░░
  11h ▇        ░░░░░░░
```

---

## C. An ninh & kiểm soát

### 9. `/system-admin/security-alerts` (Cảnh báo an ninh) — ★ Làm ngay

**Gắn API:**
- `GET /api/notifications?limit=`: cảnh báo danh sách đen và định danh.
- `GET /api/notifications/unread-count`: số cảnh báo chưa đọc.
- `GET /api/media/images/{path}`: ảnh hiện trường và ảnh định danh.
- `GET /api/playback/video?camera_id=&start_time=t-30s&end_time=t+30s`: clip quanh thời điểm xảy ra sự kiện.

**Lấy được thông tin:**
- `type`, `title`, `message`, `camera_id`, `ident_text`, `lp_text`, `is_blacklist`, `object_class`, `timestamp`, ảnh.
- Cảnh báo đông người không đến từ HGVision. SAVP tự sinh cảnh báo này (mục 7) và hiển thị chung danh sách.

**Ví dụ hiển thị:**
```
🔴 Danh sách đen · Trần Văn B · Cổng chính · 08:12   [ảnh] [▶ Xem clip ±30s]
🔴 Xe danh sách đen · 51F-999.99 · Cổng 2 · 07:55   [ảnh] [▶ Xem clip]
🟠 Đông người (SAVP) · Hội trường A 215/200 · 08:30
```

### 10. `/system-admin/person-control-list` (Danh sách kiểm soát người) — ☆ Nên làm

**Gắn API:**
- `GET /api/identification/faces?is_blacklist=1&search=&page=`: danh sách người bị đặt vào danh sách đen.

**Lấy được thông tin:** `face_ident` (mã định danh), `face_infor`, `face_count` (số ảnh đã đăng ký), `is_blacklist`. Dùng để **đối chiếu** danh sách đen của SAVP với danh sách đang thực sự hoạt động trên HGVision.

**Ví dụ hiển thị:**
```
Mã định danh   Thông tin        Ảnh  Trên HGVision
K245022256     Nguyễn Văn C      3    ✓ Danh sách đen
NV0012         Lê Thị D          0    ✗ Chưa có ảnh → camera không nhận ra
```

> Việc đặt hoặc bỏ danh sách đen (`PATCH`) là thao tác ghi, nên không làm trong phạm vi "chỉ đọc".

### 11. `/system-admin/vehicle-control-list` (Danh sách kiểm soát xe) — ☆ Nên làm

**Gắn API:**
- `GET /api/identification/license-plates?is_blacklist=1&search=`: danh sách biển số trong danh sách đen.

**Lấy được thông tin:** `license_plate`, `ident` (chủ xe), `lp_infor`, `is_blacklist`.

**Ví dụ hiển thị:** `51F-999.99 · Chủ: không rõ · ✓ Danh sách đen trên HGVision`

### 12. `/system-admin/anpr-management` và `/system-admin/gate-presence` (Xe ra vào cổng) — ✔ Đã nối + ☆ Bổ sung

**Gắn API:**
- ✔ `GET /api/history` (poller của BE đang dùng): sự kiện xe kèm `lp_text`, `lp_type`, ảnh.
- ☆ `GET /api/counting-lines/{line_id}/events?from=&to=`: sự kiện qua vạch ở cổng, **có `direction` (vào/ra) và `lp_text`**.

**Lấy được thông tin:** biển số, loại xe, ảnh biển và ảnh xe, thời điểm, và **chiều đi qua cổng**. Có chiều đi thì SAVP biết chắc xe vào hay ra, không phải đoán theo camera.

**Ví dụ hiển thị:**
```
08:14  ⬇ VÀO  51F-123.45  Xe máy  Cổng 2   [ảnh biển] [ảnh xe]
08:20  ⬆ RA   30A-678.90  Ô tô    Cổng 1
Xe đang trong khuôn viên: 342
```

### 13. `/system-admin/strangers` (Người lạ) — ✔ Đã nối + ☆ Bổ sung

**Gắn API:**
- ✔ `GET /api/history` (poller): sự kiện có khuôn mặt nhưng không có `face_ident_text`.
- ☆ `GET /api/media/images/{path}` + `GET /api/playback/video`: ảnh và clip.

**Lấy được thông tin:** ảnh mặt người lạ, camera, thời điểm `first_timestamp` / `last_timestamp`.

**Ví dụ hiển thị:** `[ảnh mặt] Người lạ · Sảnh A · 08:05–08:07 · [▶ Xem clip]`

### 14. `/system-admin/camera-trace` và `/system-admin/user-journey` (Truy vết) — ✔ Đã nối + ○ Bổ sung

**Gắn API:**
- ✔ `GET /api/history?face_ident=<mã>&start_time=&end_time=` hoặc `?lp_text=<biển số>`: các lần một người hoặc một xe xuất hiện trên tất cả camera.
- ○ `GET /api/counting-objects/{object_id}/trajectory`: đường đi của đối tượng trong khung hình một camera.

**Lấy được thông tin:** chuỗi (camera, thời gian, ảnh) xếp theo thời gian, đủ để dựng hành trình.

**Ví dụ hiển thị:**
```
Nguyễn Văn A – 18/11
07:52 Cổng chính → 07:58 Sảnh A → 08:01 Phòng B.101 → 11:30 Cổng chính
```

### 15. `/system-admin/room-access-logs` (Ra vào phòng) — ☆ Nên làm

**Gắn API:**
- `GET /api/counting-lines/{line_id}/events`: dùng với vạch đặt ở cửa phòng.

**Lấy được thông tin:** ai (`face_ident_text`) đi qua cửa, chiều `direction`, thời điểm, ảnh.

**Ví dụ hiển thị:** `08:01 ⬇ VÀO B.101 · Nguyễn Văn A · [ảnh]`

---

## D. Chuyên cần & nhận diện

### 16. `/teacher/attendance`, `/business-admin/class-attendance`, `meeting-attendance` — ✔ Đã nối

**Gắn API:**
- ✔ `GET /api/history`: poller lấy sự kiện có `face_ident_text`, rồi điểm danh theo camera của phòng.
- ✔ `POST /api/identification/faces/search`: tìm định danh theo ảnh. Đây là API tra cứu, không ghi dữ liệu.

**Lấy được thông tin:** ai có mặt, ở camera nào, lúc mấy giờ, kèm ảnh làm bằng chứng.

**Ví dụ hiển thị:** `K245022256 · Có mặt 07:02 · Camera B.101 · [ảnh bằng chứng]`

### 17. `face-register` và `/business-admin/biometric-submissions` (Đăng ký khuôn mặt) — ○ Cần quyết định

**Gắn API (đọc):**
- `GET /api/identification/faces/{face_ident}`: kiểm tra một người đã có bao nhiêu ảnh trên HGVision.

**Lấy được thông tin:** `face_count` và danh sách ảnh đã đăng ký.

**Ví dụ hiển thị:** `Trạng thái trên camera: ✓ Đã có 3 ảnh` hoặc `✗ Chưa đăng ký`

> Muốn đẩy ảnh đã duyệt từ SAVP sang HGVision thì phải dùng `POST /api/identification/faces` (quyền `faces:write`). Đây là thao tác **ghi**, nằm ngoài nguyên tắc "chỉ đọc", nên cần anh/chị quyết định riêng.

---

## E. Báo cáo

### 18. `/system-admin/reports` (Trung tâm báo cáo) — ☆ Nên làm

**Gắn API:**
- `GET /api/history/statistics?start_time=&end_time=`: tổng số sự kiện.
- `GET /api/dashboard/traffic-flow`: lưu lượng theo loại đối tượng.
- `GET /api/dashboard/detection-flow`: số lượt nhận diện khuôn mặt và biển số theo giờ.
- `GET /api/counting-lines/{id}/timeseries`: vào/ra theo zone.

**Lấy được thông tin:** số liệu theo ngày, tuần, tháng, dùng cho báo cáo lưu lượng, an ninh, hiệu quả nhận diện.

**Ví dụ hiển thị:**
```
Báo cáo tuần 46:  Sự kiện 8.920 · Nhận diện mặt 5.102 · Biển số 1.877
Lưu lượng người theo ngày: T2 ▇▇▇▇▇ T3 ▇▇▇▇ T4 ▇▇▇▇▇▇ ...
```

---

## F. Quyền cần xin khi tạo client API trên HGVision

| Quyền (scope) | Dùng cho mục |
|---|---|
| `cameras:read` | 2, 3, 4, 5, 7 |
| `dashboard:read` | 1, 6, 8, 18 |
| `history:read` | 12, 13, 14, 16, 18 (đang dùng) |
| `counting:read` | 7, 8, 12, 15, 18 |
| `notifications:read` | 9 |
| `faces:read` | 10, 16, 17 |
| `plates:read` | 11 |
| `playback:read` | 6, 9, 13. Hiện các API này công khai, quyền chỉ có hiệu lực khi HGVision bật phân quyền |

## G. Những API không dùng và lý do

| Nhóm API | Số lượng | Lý do |
|---|---|---|
| Thêm/sửa/xoá camera, bật/tắt AI, ghi hình, ROI, ONVIF, cấu hình encoder, quét URL phụ | 20 | Thao tác ghi. HGVision tự quản lý camera |
| Tạo/sửa/xoá nhóm, thêm/gỡ camera khỏi nhóm, xoá shape | 6 | Thao tác ghi |
| Tạo/sửa/xoá vạch đếm | 3 | Thao tác ghi. Người vận hành vẽ vạch trên HGVision |
| Đăng ký/sửa/xoá khuôn mặt, ZIP, đặt danh sách đen, trích vector đặc trưng | 12 | Thao tác ghi hoặc chuyên sâu. Xem mục 17 |
| Đăng ký/sửa/xoá biển số, đọc biển từ ảnh/ZIP | 6 | Thao tác ghi. `read-from-image` đã có ở luồng khác |
| Sửa/xoá sự kiện lịch sử, tải ZIP ảnh | 4 | Thao tác ghi hoặc không cần |
| Đánh dấu đã đọc / xoá cảnh báo | 5 | Thao tác ghi. SAVP tự quản lý trạng thái đã đọc |
| Job xuất video (`playback/export`) | 4 | ○ Chỉ cần khi xuất clip dài. `playback/video` là đủ cho ±30 giây |
| Bí danh (`/api/stats`, `/api/history/objects`) | 2 | Trùng chức năng với API chính |
| `cameras/{name}/diagnose`, `reset_main_image`, `recording/video/{file}` | 3 | ○ Tuỳ chọn. Có thể thêm nút "Kiểm tra kết nối" ở mục 2 |

## H. Lưu ý khi tích hợp

- **Thứ tự làm đề xuất:** 1 → 2 → 3 → 6 → 7 → 9 (★), sau đó tới nhóm ☆.
- **Cache ở BE:** cần cache ở BE: `statuses`/`health` 15–30 giây, `resources` 30 giây, `groups` 5 phút. Nhiều người mở trang cùng lúc cũng không làm quá tải máy chủ AI.
- **Video và ảnh:** đi qua proxy của BE, vì trình duyệt của người dùng thường không truy cập được trực tiếp `:8113` trong mạng nội bộ.
- **File OpenAPI:** file `openapi-1.0.0.json` hiện có vẫn thiếu các mục 2.4, 2.6, 2.7, 2.8 (thấy trong video bản mới). Khi có bản mới, cần rà lại bảng G.
