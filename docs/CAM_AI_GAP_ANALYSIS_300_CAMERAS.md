# SAVP — Đối chiếu yêu cầu CAM_AI & Kế hoạch tối ưu cho quy mô 200–300 camera

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-10-05 | Tạo mới: quét 3 tài liệu trong `Downloads/CAM_AI` (tài liệu chức năng Smart AI Vision Platform, Mô tả màn hình, KeHoachTrienKhai_SCMPTS_Fix.xlsx) đối chiếu với `capstone-be`, `FE_SmarTracking`, `ivss-bridge`. Bổ sung phân tích tải 300 camera, các điểm nghẽn ngoài kế hoạch, và chuẩn bị tích hợp API camera của nhà cung cấp. | Toàn bộ file |
| 2026-10-05 | #10 KPI-001 hoàn thành giai đoạn 1 (LamNH tiếp quản): bảng tổng hợp theo giờ zone/xe, cron hourly + reconcile 01:00, đọc lai, bucket xe theo giờ VN. Ghi nhận lỗi FE dashboard đọc sai field vehicle stats. | Bảng 3.1 #10, mục 5.8 |

> **Nguồn đối chiếu**
> - `HẦN MỀM QUẢN LÝ CAMERA AI THÔNG MINH (1).docx` — 12 phân hệ (2.2 → 2.13)
> - `Mô tả màn hình.docx` — mô tả luồng các màn hình
> - `KeHoachTrienKhai_SCMPTS_Fix.xlsx` — 33 đầu việc (Tối ưu 1–10, Nâng cấp 11–21, Xây mới 22–33)
>
> **Phạm vi quét code:** `capstone-be/src`, `FE_SmarTracking/src`, `ivss-bridge/src` (trạng thái ngày 2026-10-05).
>
> **Ký hiệu:** ✅ Đã có · 🟡 Có một phần / chưa đạt yêu cầu quy mô · ❌ Chưa có · 🔧 Đang thực hiện (theo xlsx)

---

## 1. Tóm tắt nhanh

| Nhóm | Tổng | ✅ | 🟡 | ❌ |
| :--- | :-: | :-: | :-: | :-: |
| Xlsx — Tối ưu (1–10) | 10 | 2 | 6 | 2 |
| Xlsx — Nâng cấp (11–21) | 11 | 0 | 6 | 5 |
| Xlsx — Xây mới (22–33) | 12 | 0 | 4 | 8 |

**Kết luận chính:**

1. **Nghiệp vụ lõi camera đã có khá đủ** (zone, ANPR, gate log, IVSS presence, crowd/restricted-zone/watchlist alert, campus dashboard, heatmap theo zone, user journey, export báo cáo qua queue).
2. **Kiến trúc hiện tại được thiết kế cho 1 IVSS + vài chục camera**, chưa sẵn sàng cho 200–300 camera. Các điểm nghẽn lớn nhất **không nằm hết trong xlsx** — xem **mục 5**.
3. **Mảng chưa có:** Live view / media server, sơ đồ lắp đặt + nhóm camera, GIS/IOC, Visitor, Mobile/Push/SMS, Học vụ (điểm danh lớp học), đồng bộ SIS/HRM/eOffice, Liveness, Retention, Auto-report, Incident ticket.

---

## 2. Ước lượng tải ở quy mô 300 camera

Giả định (cần xác nhận lại khi có API nhà cung cấp):

| Thông số | Giả định | Ghi chú |
| :--- | :--- | :--- |
| Số camera | 300 (≈ 40 cổng/ANPR, 60 phòng họp/lớp, 200 hành lang/sảnh) | |
| Event nhận diện giờ cao điểm | 0.5–1 event/s/camera ở cổng & sảnh, ~0.1 ở phòng | Giờ vào ca 7h–8h |
| Tổng event cao điểm | **~100–200 event/s** | |
| Heartbeat | 300 thiết bị × 1 lần/30–60s | |
| Snapshot | 50–150 KB/event | ≈ 10–30 MB/s ghi MinIO lúc cao điểm |

**Chi phí mỗi event face với code hiện tại** ([ivss-presence-ingestion.service.ts](../src/modules/ivss/services/ivss-presence-ingestion.service.ts)):

- 3–4 lần `SELECT config_json FROM system_configs` (channel_room_map / presence_zone_map / direction_map, **không cache** — xem L617–700)
- upload snapshot đồng bộ (L229) + 1 transaction insert (L286) + resolve user/meeting + emit WebSocket

→ **≈ 6–10 query/event ⇒ 1.000–2.000 query/s chỉ riêng ingest**, toàn bộ chạy trong request HTTP của webhook, chung process với API người dùng và 18 cron job. Đây là nguyên nhân gốc cần xử lý trước mọi tính năng mới.

---

## 3. Đối chiếu xlsx `KeHoachTrienKhai_SCMPTS_Fix`

### 3.1. Nhóm Tối ưu (1–10)

| # | Công việc | Trạng thái | Hiện trạng trong code | Việc còn thiếu |
| :-: | :--- | :-: | :--- | :--- |
| 1 | Concurrency lock booking | 🟡 | `create()` kiểm `getRoomAvailability` **ngoài transaction** ([meetings.service.ts:1045](../src/modules/meetings/services/meetings.service.ts#L1045)), transaction bắt đầu ~L1145 → còn khe race. Cancel/update đã dùng `FOR UPDATE`. Không có exclusion constraint trên `room_bookings`. | Đưa check vào transaction + `pg_advisory_xact_lock(hashtext(room_id))`, **hoặc** thêm `EXCLUDE USING gist (room_id WITH =, tstzrange(start,end) WITH &&) WHERE status active` (cần `btree_gist`, migration ADD-ONLY). Khuyến nghị dùng exclusion constraint — chặn ở tầng DB, không phụ thuộc app. |
| 2 | Điểm danh qua Message Queue | ❌ | BullMQ đã có 9 queue ([queue.module.ts](../src/modules/queue/queue.module.ts)) nhưng **không có queue cho camera event**. IVSS face/occupancy, ANPR, Face Terminal đều ghi DB đồng bộ trong webhook. | Thêm queue `camera-events` (partition theo `deviceId`), webhook chỉ validate + `addJob` + trả 202. Worker chạy process riêng (xem 5.2). **Ưu tiên số 1.** |
| 3 | Thời lượng họp & No-show → background | ✅ | Đã là cron: `no-show-check`, `early-vacancy`, `meeting-status-advance`, `auto-complete-meetings` ([scheduler.service.ts](../src/modules/scheduler/scheduler.service.ts)). | Chỉ cần distributed lock khi chạy nhiều instance (5.3). |
| 4 | Upload media qua Pre-signed URL | 🟡 | Có `presignedGetObject` (download, [storage.service.ts:324](../src/modules/storage/storage.service.ts#L324)). Upload recording vẫn qua `FileInterceptor` → BE cõng file ([recording-session.controller.ts:137](../src/modules/recording/controllers/recording-session.controller.ts#L137)). Snapshot camera cũng upload qua BE. | Thêm `presignedPutObject` + endpoint `POST /recording/upload-url` + callback xác nhận. Snapshot: lưu thẳng từ worker, không trong request. |
| 5 | Tối ưu query xuất báo cáo | 🟡 | Export đã chạy qua queue `report-export` (5 processor). Có index KPI (`1770000000000-AddKpiDashboardIndexes`). | Rà N+1 trong `*-report-data.service.ts`; dùng cursor/stream (`ExcelJS.stream.xlsx.WorkbookWriter`) cho file hàng vạn dòng. |
| 6 | Cache danh sách thiết bị (Redis) | 🔧🟡 | NinhHC đang làm. Chưa thấy cache trong `iot-devices.service.ts` (`findAll` L386 query DB trực tiếp). | Cache key `iot:devices:status` (hash deviceId → status/last_seen), cập nhật khi heartbeat, TTL ngắn. Heartbeat chỉ ghi DB khi **đổi trạng thái** hoặc mỗi N phút (giảm 300 UPDATE/30s). |
| 7 | ANPR bất đồng bộ + batch insert | ❌ | `vehicle-webhook.controller` → `vehicle-resolve.service` insert từng dòng trong transaction có `pg_advisory_xact_lock` theo channel. | Gộp vào queue `camera-events` (#2); worker batch insert `gate_access_logs` (ví dụ 200 dòng / 500ms). Giữ advisory lock theo channel trong worker. |
| 8 | Composite index gate logs | ✅ | Đã có `(zone_id, access_time DESC)`, `(user_id, access_time DESC)`, `plate_number`, unique nội dung (`20260721000004`, `20260725000001`). | Thêm partition theo tháng khi bảng > vài chục triệu dòng (5.6). |
| 9 | Tách service xử lý rule cảnh báo | 🟡 | Rule engine đã tách module (`alerts`, `crowd-alert`, `restricted-zone`) nhưng chạy bằng **cron polling** trong cùng process API (`crowd-alert` 1 phút, `restricted-zone-intrusion` 5 phút). | Chuyển sang **event-driven**: worker `camera-events` sau khi persist → publish `alert-evaluate` job. Độ trễ cảnh báo xâm nhập từ ≤5 phút xuống < 5s. |
| 10 | Cronjob tổng hợp KPI ban đêm | ✅ (GĐ1) | KPI-001 (LamNH): kpi_zone_hourly, kpi_vehicle_hourly, kpi_vehicle_plate_hourly + watermark; cron kpi-rollup-hourly / kpi-rollup-reconcile; zone traffic & vehicle stats đọc lai. Spec: spec/features/analytics/feat-kpi-rollup/. | GĐ2: kpi_meeting_daily cho analytics/*, security alert daily. |

### 3.2. Nhóm Nâng cấp (11–21)

| # | Công việc | Trạng thái | Hiện trạng | Việc còn thiếu |
| :-: | :--- | :-: | :--- | :--- |
| 11 | Sơ đồ lắp đặt camera (upload mặt bằng, kéo thả) | ❌ | Không có bảng/field toạ độ; FE không có màn floor plan. | Bảng `floor_plans` (zone/tòa/tầng, image) + `device_positions` (device_id, plan_id, x, y, góc nhìn). Cần duyệt mở rộng schema. |
| 12 | Nhóm camera + cảnh báo bảo trì | 🟡 | Có `zone` + gán device vào zone (UC-94), cron `device-offline-detect` mỗi phút. Không có "nhóm camera" độc lập zone, không có cảnh báo "offline quá X giờ". | Có thể dùng zone làm nhóm (tránh thêm bảng). Bổ sung rule `camera_offline` với ngưỡng giờ → security alert + notification. |
| 13 | Liveness (chống ảnh giả) | ❌ | Không có. Phụ thuộc thiết bị. | **Ưu tiên dùng liveness của thiết bị** (Face Terminal / IVSS) qua API nhà cung cấp; BE chỉ lưu cờ `is_live`/`spoof_score`. Không tự train model. |
| 14 | Multi-face trên luồng RTSP | 🟡 | IVSS (NVR AI) đã nhận diện đa khuôn mặt, bridge chỉ forward. Không có Python worker RTSP trong repo. | Với 300 camera **không nên** để BE/Python tự decode RTSP — dùng AI on-edge (camera/NVR). Cần xác nhận trong API nhà cung cấp. |
| 15 | Tracking path đa camera | 🟡 | Đã có User Journey ([user-journey.service.ts](../src/modules/gate-access/services/user-journey.service.ts)) + FE `UserJourney.jsx`, zone presence timeline (UC-119). | Hiển thị lộ trình trên sơ đồ (phụ thuộc #11/#28). Với khối lượng lớn, query theo `(user_id, event_time)` đã có index. |
| 16 | Heatmap trực quan | 🟡 | BE có zone traffic heatmap (UC-120); FE chỉ có biểu đồ bar dạng "heatmap" trong `RoomUsageAnalytics.jsx`. Bridge đã có callback NetSDK `VideoStatHeatMap` nhưng chưa dùng. | API mật độ theo grid toạ độ + render overlay trên floor plan (phụ thuộc #11). Có thể lấy heatmap trực tiếp từ IVSS. |
| 17 | Visitor Portal | ❌ | Chỉ có `guest-access` (khách dự họp online qua magic link + OTP). Không có đăng ký khách đến cơ quan, QR. | Module mới `visitors`. |
| 18 | Face khách tạm thời | 🟡 | Đã có hạ tầng đẩy ảnh xuống thiết bị (`face-provisioning`, `ivss-portrait-sync`, cron `face-sync`) + tài khoản partner tạm thời có `account_expires_at`. | Gắn với Visitor (#17): đẩy ảnh khi duyệt, xoá khi hết hạn (tận dụng job reconcile hiện có). |
| 19 | SMS | ❌ | Enum `NotificationChannel.SMS` có trong entity nhưng **không có sender**. | Provider adapter (port) + worker trong queue `notification`. |
| 20 | Mobile Push (FCM) | ❌ | Không có `device_token`, không có FCM. | Phụ thuộc #26. |
| 21 | Template báo cáo PDF/Excel đủ bộ | 🟡 | Có: meeting activity, room utilization, gate access, vehicle, security alert, user export (pdfkit + exceljs). Thiếu: chuyên cần sinh viên/cán bộ, khách, Word. | Bổ sung renderer theo mẫu khi có module Học vụ/Visitor. |

### 3.3. Nhóm Xây mới (22–33)

| # | Công việc | Trạng thái | Ghi chú |
| :-: | :--- | :-: | :--- |
| 22 | DB schema Học vụ | 🔧❌ | LamNH đang làm, chưa thấy migration/entity (`classroom/semester/student` không có trong `src`). |
| 23 | Mapping điểm danh theo ca học | ❌ | Có thể tái dùng logic attendance + `ivss.channel_room_map` (camera phòng → phòng → ca học). |
| 24 | Đồng bộ SIS/LMS | ❌ | Chờ API của trường. |
| 25 | Đồng bộ HRM/eOffice | ❌ | Hiện chỉ import Excel tài khoản. |
| 26 | Mobile app base + login | ❌ | — |
| 27 | Mobile: Alert + quét QR khách | ❌ | Phụ thuộc #17, #20, #26. |
| 28 | GIS 2D/3D | ❌ | FE đã có `three`/`@react-three/fiber` nhưng chưa có màn bản đồ; chưa có Leaflet/Mapbox. |
| 29 | Realtime plotting lên GIS | 🟡 | WebSocket đã emit `ZONE_PRESENCE_EVENT` theo room zone. Thiếu toạ độ camera (phụ thuộc #11/#28). |
| 30 | Incident ticket workflow | 🟡 | Security alert đã có `acknowledge` / `resolve` / bulk-ack / auto-resolve. Thiếu: giao việc cho bảo vệ, ghi chú xác minh, lịch sử xử lý. |
| 31 | Zone cấm + khung giờ + whitelist | 🟡 | `alert_rules` đã có `restricted_hours_json`, `allowed_person_ids_json`; logic trong `restricted-zone-intrusion.service.ts`. FE `AlertRules.jsx` có. **Thiếu:** chạy event-driven (đang cron 5 phút — không đạt "báo động tức thì"). |
| 32 | Retention policy dọn rác | 🟡 | Có config `recording_retention_days` (system config + recording config) nhưng **không có job xoá**. Snapshot camera và raw event cũng không có retention. Cần: cron xoá object MinIO + bản ghi quá hạn; MinIO lifecycle rule cho bucket snapshot (đơn giản và rẻ hơn tự quét). |
| 33 | Auto-report định kỳ + email | ❌ | Có queue export + `nodemailer`, thiếu bảng lịch gửi & job. |

---

## 4. Đối chiếu tài liệu chức năng & mô tả màn hình

### 4.1. Theo phân hệ (docx "Smart AI Vision Platform")

| Phân hệ | Đã có | Chưa có |
| :--- | :--- | :--- |
| 2.2 Quản lý thiết bị camera | Đăng ký/sửa/khoá thiết bị, RTSP (lưu credential mã hoá), gán phòng/zone, AI config per camera (UC-96), offline detect, heartbeat | Sơ đồ lắp đặt, nhóm camera riêng, **lịch ghi hình & lưu trữ**, nhập hàng loạt camera, chỉ số "còn kết nối thêm được / băng thông còn trống" |
| 2.3 Nhận diện khuôn mặt | Face Terminal + IVSS, enrollment, stranger alert, unmapped review, watchlist (UC-125), lịch sử xuất hiện (zone access log) | Liveness, **tra cứu theo ảnh/đặc điểm** (giới tính, tuổi, kính, khẩu trang), xử lý thiếu sáng (phụ thuộc thiết bị) |
| 2.4 Biển số | Đăng ký xe, webhook ANPR, resolve, biển lạ, blocklist/watchlist, lịch sử, thống kê lưu lượng (UC-114), export | Phân loại loại phương tiện từ camera (cần field từ API nhà cung cấp) |
| 2.5 Điểm danh cổng | Gate log + pairing vào/ra, lịch sử, cảnh báo không quyền | Đối chiếu lịch làm việc/lịch học (thiếu dữ liệu HRM/SIS) |
| 2.6 Hành lang/khu công cộng | Zone presence, occupancy, timeline, heatmap theo zone, crowd/restricted alert | Heatmap trên mặt bằng |
| 2.7 Phòng học | — | Toàn bộ (#22–24) |
| 2.8 Phòng họp | **Đầy đủ** (booking, duyệt, check-in/out tự động, thời lượng, tỉ lệ, PDF điểm danh) | Đồng bộ lịch từ eOffice |
| 2.9 Tích hợp eOffice/HRM/SIS/IOC | — | Toàn bộ |
| 2.10 Khách | Guest live meeting (khác nghiệp vụ) | Toàn bộ Visitor |
| 2.11 Cảnh báo an ninh | Người lạ, watchlist, xe bất thường, xâm nhập, tụ tập, kênh in-app/email | **Camera mất tín hiệu** dạng alert, SMS, mobile push, màn hình điều hành |
| 2.12 Dashboard | Campus dashboard theo role, camera status, occupancy, zone traffic | Bản đồ GIS, thống kê theo khoa/tòa nhà (thiếu cấp tòa nhà trong zone?) |
| 2.13 Báo cáo | 5 loại export PDF/Excel | Chuyên cần SV/CB, khách, Word, lịch gửi tự động |

### 4.2. Theo màn hình ("Mô tả màn hình.docx")

| Màn hình | FE hiện có | Trạng thái |
| :--- | :--- | :-: |
| Màn hình chính dạng ô chức năng + "Danh sách cài đặt" | Dashboard theo role (`systemAdmin/dashBoard.jsx`…) | 🟡 khác bố cục |
| Đăng ký thiết bị IoT (modal, RTSP khi là Camera AI) | `systemAdmin/DeviceManagement.jsx` | ✅ |
| Danh sách camera + năng lực còn lại + nhập hàng loạt + xuất | `DeviceManagement.jsx` | 🟡 thiếu import/export, thiếu chỉ số năng lực. **Lỗi quy mô:** load `getDevices({ limit: 100 })` rồi phân trang ở client (L122, L608) → **300 camera sẽ bị mất 200 dòng**. |
| **Xem trực tiếp** (cây camera, chia 1/4/9 ô, phân trang, nhóm xem, snapshot, PTZ) | Chỉ có `RealtimeRoomMonitor.jsx` (snapshot/polling) | ❌ — cần media server (5.5) |
| Kế hoạch thông minh / sự cố thiết bị / tạm ngưng cảnh báo | AI config per camera (UC-96) có ở BE | 🟡 thiếu "tạm ngưng cảnh báo theo thời gian", sự cố ổ lưu trữ/mất khung hình/trùng IP (cần API thiết bị) |
| Tra cứu thông minh theo khuôn mặt (ảnh/đặc điểm, ≤30 ngày) | `UserJourney.jsx`, `RoomAccessLogs.jsx` (tra theo người) | ❌ tra theo ảnh — nên gọi API search của NVR/thiết bị, không tự làm vector search |
| Đặt phòng 2 bước, xung đột lịch, duyệt | `BookMeeting.jsx`, `MeetingApprovals.jsx` | ✅ |
| Danh mục người (thẻ ảnh, thêm hàng loạt, tạo mẫu, "đang giám sát") + danh sách biển số + âm thanh cảnh báo | Watchlist BE (UC-125), `VehicleControlList.jsx` | 🟡 thiếu UI watchlist người dạng thẻ, âm thanh cảnh báo |
| Điểm danh cuộc họp + chi tiết người tham gia (live WS, PDF) | `MeetingAttendance.jsx`, `MeetingAttendanceAdmin.jsx` | ✅ |
| Phương tiện (nhân viên / quản lý: log live, biển lạ, đăng ký hộ) | `MyVehicles.jsx`, `ANPRManagement.jsx`, `VehicleRegistrations.jsx` | ✅ |

---

## 5. Điểm nghẽn hiệu năng ngoài xlsx (bắt buộc cho 200–300 camera)

Sắp theo mức ảnh hưởng.

### 5.1. 🔴 Không cache cấu hình channel-map
Mỗi event đọc `system_configs` 3–4 lần (đã ghi nợ TD-ZPW-1 / A.6 trong comment). Gom thành `ChannelMapConfigService` dùng chung (ivss presence, occupancy, ANPR) với cache in-memory + Redis pub/sub invalidate khi admin sửa config. **Giảm ~50% query ingest, công sức nhỏ — làm ngay.**

### 5.2. 🔴 Ingest đồng bộ, chung process với API
Thực hiện #2 + #7 + #9 theo kiến trúc:

```
Camera/NVR/API nhà cung cấp
   │ webhook / pull
   ▼
[Ingest API]  validate + dedupe (Redis SETNX eventId, TTL 5m) → BullMQ `camera-events` → 202
   ▼
[Worker process]  (chạy riêng: `node dist/worker.js`, scale N bản)
   ├─ resolve user/zone/meeting (cache)
   ├─ batch insert events / gate logs
   ├─ snapshot → MinIO (trực tiếp)
   ├─ enqueue `alert-evaluate`
   └─ publish WS qua Redis adapter
```

Tách entrypoint `worker.ts` chỉ import module ingest/alert/report/scheduler, API instance tắt `SCHEDULER_*`.

### 5.3. 🔴 Cron không có distributed lock
18 `@Cron` trong `scheduler.service.ts` chạy trong mọi instance; chỉ `checkin-alert` có Redis `NX` lock. Chạy 2 instance API ⇒ job chạy đôi (alert trùng, no-show trùng). Cách xử lý: chạy cron chỉ ở worker process **hoặc** chuyển sang BullMQ repeatable jobs (tự đảm bảo 1 lần).

### 5.4. 🟠 WebSocket không scale ngang
`events.gateway.ts` chưa có `@socket.io/redis-adapter` ⇒ chỉ chạy được 1 instance. Thêm adapter + throttle: gộp event presence/occupancy theo zone mỗi 1–2s trước khi emit (300 camera emit thẳng sẽ làm nghẽn trình duyệt dashboard).

### 5.5. 🟠 Live view cần media server riêng
Trình duyệt không xem trực tiếp RTSP; BE Node không nên proxy video. Đề xuất **MediaMTX hoặc go2rtc** (RTSP → WebRTC/HLS), on-demand (chỉ kéo luồng khi có người xem), luôn dùng **sub-stream** cho lưới 4/9/16 ô, main-stream khi phóng to. BE chỉ cấp URL có token ngắn hạn. Ưu tiên kiểm tra API nhà cung cấp có sẵn WebRTC/HLS không (khi đó không cần media server).

### 5.6. 🟠 Tăng trưởng dữ liệu
Ở 150 event/s cao điểm, `iot_device_events` + `zone_presence_events` + `gate_access_logs` có thể đạt **hàng triệu dòng/ngày**. Cần:
- Partition theo tháng (`PARTITION BY RANGE (event_time)`) cho 3 bảng trên — cần migration riêng, có review.
- Retention: raw event 30–90 ngày, snapshot theo MinIO lifecycle.
- Dashboard/heatmap đọc từ bảng tổng hợp (#10), không quét raw.

### 5.7. 🟡 DB connection pool
Chưa cấu hình `extra.max` cho TypeORM (mặc định pg = 10). Đặt theo process: API ~20, worker ~20–30; cân nhắc PgBouncer khi > 3 instance.

### 5.8. 🟡 FE
- `DeviceManagement.jsx`: chuyển sang phân trang/tìm kiếm phía server (đã có `ListIotDevicesQueryDto`).
- 36 chỗ `setInterval` polling → thay bằng WebSocket ở các màn realtime, hoặc tăng chu kỳ + dừng khi tab ẩn (`document.visibilityState`).
- Danh sách/bảng lớn (log quét, cây camera 300 node): virtualization (`react-window`).
- `systemAdmin/dashBoard.jsx:561` & `bussinessAdmin/dashBoard.jsx:416` đọc `data.buckets[].period/total_enter` trong khi BE trả `series[].bucket/enter/leave` ⇒ biểu đồ lưu lượng xe luôn rỗng.

### 5.9. 🟡 ivss-bridge
- Chỉ giữ **1 phiên login IVSS** (`ServerInstance`) — 300 camera thường trải nhiều NVR ⇒ cần multi-device (Map deviceId → session) hoặc chạy nhiều bridge.
- `NestForwarder` dùng `CompletableFuture.runAsync` (common pool), best-effort, **không retry/buffer** ⇒ BE restart là mất event. Thêm bounded executor + retry + buffer đĩa/Redis, hoặc bridge đẩy thẳng vào Redis stream.

---

## 6. Chuẩn bị cho API kết nối camera của nhà cung cấp

### 6.1. Nền tảng đã có (tận dụng)
Code đã theo mô hình **Port/Adapter**:
- `face-access/ports/face-device-provider.port.ts` + `face-device-provider.factory.ts`
- `ivss/ports/ivss-bridge.port.ts` + `ivss-bridge.factory.ts`
- `common/ports/vehicle-event-hook.ts`
- `iot/services/iot-device-events.service.ts` (raw event → normalize)

⇒ API mới nên được thêm như **một adapter mới**, không sửa nghiệp vụ.

### 6.2. Đề xuất port chung
```ts
// common/ports/camera-vendor.port.ts (đề xuất)
interface CameraVendorPort {
  listDevices(): Promise<VendorDevice[]>;              // đồng bộ danh mục camera
  getDeviceStatus(ids: string[]): Promise<VendorStatus[]>; // batch, không gọi từng con
  getLiveStreamUrl(id: string, quality: 'main' | 'sub'): Promise<string>;
  getSnapshot(id: string): Promise<Buffer | string>;
  ptz?(id: string, cmd: PtzCommand): Promise<void>;
  enrollFace?(personId: string, image: Buffer): Promise<void>;
  deleteFace?(personId: string): Promise<void>;
  searchFaces?(q: FaceSearchQuery): Promise<FaceSearchResult[]>; // tra cứu theo ảnh
  // Event: vendor → webhook của ta, normalize về CameraEvent nội bộ
}
```
Event từ vendor luôn được **normalize về 1 DTO nội bộ** (`face_recognized`, `face_stranger`, `plate_read`, `occupancy`, `device_offline`, `storage_error`…) rồi vào queue `camera-events` (5.2).

### 6.3. Checklist câu hỏi cần hỏi nhà cung cấp API
| Hạng mục | Câu hỏi | Ảnh hưởng thiết kế |
| :--- | :--- | :--- |
| Event | Push (webhook/WebSocket/MQTT) hay pull? Có batch không? Có `eventId` duy nhất để dedupe? | Ingest, idempotency |
| Bảo mật | Ký HMAC / token / mTLS cho webhook? | Guard ingest |
| Rate | Giới hạn request/s, cơ chế retry khi ta trả lỗi? | Backpressure, 202 nhanh |
| Thời gian | Timestamp theo giờ thiết bị hay server, timezone, đồng bộ NTP? | Pairing vào/ra, điểm danh |
| Định danh | Mã người/khuôn mặt do ta cấp hay vendor cấp? Mã camera/channel ổn định không? | `device_user_mappings`, channel map |
| Snapshot | Gửi base64 trong event hay URL tải sau? Thời hạn URL? | Băng thông, MinIO |
| Stream | Có WebRTC/HLS sẵn hay chỉ RTSP? Có sub-stream? | Có cần media server (5.5) |
| AI | Liveness, khẩu trang, thuộc tính (tuổi/giới/kính), loại xe, multi-face có sẵn trên thiết bị không? | #13, #14, tra cứu thông minh |
| Tìm kiếm | Có API search khuôn mặt theo ảnh/khoảng thời gian không? | Màn "Tra cứu thông minh" |
| Sức khoẻ | Heartbeat, lỗi ổ cứng, mất khung hình, trùng IP có event không? | Nhóm "sự cố" trên màn cấu hình |
| Ghi hình | Lưu trữ trên NVR hay ta tự ghi? API playback? | #32, lịch ghi hình |
| Sandbox | Có môi trường test / simulator không? | Load test trước khi go-live |

---

## 7. Lộ trình đề xuất

| Giai đoạn | Nội dung | Mục tiêu |
| :--- | :--- | :--- |
| **P0 – Ổn định (1–2 tuần)** | 5.1 cache channel-map · #1 exclusion constraint booking · 5.7 pool · FE phân trang server cho thiết bị · #6 cache trạng thái thiết bị · 5.3 cron lock | Hệ thống hiện tại chịu được 100+ camera |
| **P1 – Kiến trúc ingest (2–3 tuần)** | #2 + #7 queue `camera-events` + worker process riêng · #9 alert event-driven · 5.4 Redis adapter WS · 5.9 bridge retry/buffer · load test 200 event/s | Scale ngang, không mất event |
| **P2 – Dữ liệu (song song P1)** | #10 bảng KPI tổng hợp · 5.6 partition + #32 retention · #4 presigned upload | DB không phình, dashboard < 1s |
| **P3 – Tích hợp API vendor** | Adapter `CameraVendorPort` · live view (5.5) · tra cứu theo ảnh · sự cố thiết bị | Đáp ứng màn "Xem trực tiếp", "Tra cứu thông minh" |
| **P4 – Tính năng mới** | #11/#16/#28/#29 sơ đồ + heatmap + GIS · #17/#18 Visitor · #19/#20/#26/#27 SMS/Push/Mobile · #22–25 Học vụ & đồng bộ · #30 Incident · #33 Auto-report | Theo ưu tiên nghiệp vụ |

> **Lưu ý quy tắc dự án:** các hạng mục cần bảng/cột mới (#11, #17, #22, #30, #33, partition, exclusion constraint) phải được duyệt mở rộng schema và có TypeORM migration riêng theo nguyên tắc ADD-ONLY (CLAUDE.md mục 5.5).
