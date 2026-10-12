# Feature Specification: Backend phân hệ Quản lý khách đến làm việc (2.10)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-10-09 | Tạo spec lần đầu sau khi mockup FE đã được LamNH bấm thử và đưa lên `main`. Bốn quyết định phạm vi chốt qua AskUserQuestion (§0.1). | Toàn bộ file |

---

- **Feature ID**: VIS-BE-001
- **Feature Name**: Backend Quản lý khách đến làm việc
- **Phân hệ tài liệu khách hàng**: 2.10 (checklist STT 52–57)
- **Module / Domain**: `visitors` (mới); chạm nhẹ `ivss`, `face-access`, `accounts`, `alerts`, `notifications`, `scheduler`
- **Created Date**: 2026-10-09
- **Status**: Draft, chờ LamNH duyệt
- **Source Documents**:
  - `spec/features/visitor-reports/feat-visitor-report-ui-mockup/spec.md` §4.1, §6.4, §12 — nghiệp vụ và hợp đồng API đã được duyệt qua mockup
  - FE `src/service/visitorService.js` — endpoint từng hàm đang chờ BE
  - FE `src/mocks/visitorReport/visitStateMachine.js` + test — bảng chuyển trạng thái chuẩn
  - `spec/global/constitution.md` — SEC-01..03, DATA-01, ARCH-01..03, ENG-01..03

---

## 0. RECON — quyết định đã chốt và dữ kiện từ codebase

### 0.1. Quyết định của LamNH (2026-10-09)

| # | Quyết định |
|---|---|
| D1 | Làm cả hai đường thiết bị: camera IVSS (nhận diện, cảnh báo) ở mọi nơi; FaceGate (đóng/mở theo khung giờ) ở nơi có thiết bị gắn với khu vực. Phần FaceGate ở cổng chỉ kiểm bằng test giả lập cho tới khi có thiết bị. |
| D2 | Khách hàng chưa trả lời các câu hỏi nghiệp vụ. Giữ giả định của mockup làm mặc định, đưa hết vào cấu hình hệ thống (§6). |
| D3 | Plan kết thúc bằng mốc nối FE (tắt dữ liệu giả cho phân hệ Khách). |
| D4 | Không thêm bước OTP email ở trang đăng ký công khai (mockup không có). Chống lạm dụng bằng giới hạn tần suất; lượt chờ duyệt chưa cấp quyền gì. |

### 0.2. Dữ kiện từ codebase (đã đọc file)

| # | Dữ kiện | Nguồn | Hệ quả thiết kế |
|---|---|---|---|
| F1 | Mọi bảng phía sau nhận diện đều khóa theo `users.id`: `device_user_mappings.user_id` NOT NULL, `zone_presence_events.user_id`, `gate_access_logs.user_id`. | `iot/entities/device-user-mapping.entity.ts`, migration `20260721000005` | Khách cần một dòng `users` ("tài khoản khách ẩn"). |
| F2 | Kho khuôn mặt thường trực IVSS tự nạp mọi user `account_status='active'` có `face_profiles.status='active'`, tự gỡ khi một trong hai điều kiện mất. Cron `ivss-portrait-reconcile` 30 giây. | `ivss/services/ivss-portrait-sync.service.ts:341-380` | Bật/tắt nhận diện khách bằng cách đổi `face_profiles.status`, không phải viết luồng đẩy mới cho IVSS. |
| F3 | `FaceProfileService.enrollPortrait()` luôn tạo hồ sơ ở `pending_review`. | `accounts/services/face-profile.service.ts:42-100` | Cần thêm hàm kích hoạt/thu hồi hồ sơ cho khách trong `accounts` (ARCH-01: không sửa bảng của module khác bằng SQL trực tiếp). |
| F4 | FaceGate nhận khung hiệu lực cho từng người: `addPerson({ uname, faceRef, validFrom, validTo, jurisdiction })`. Hiện chỉ tìm thiết bị theo `room_id`. | `face-access/ports/face-device-provider.port.ts`, `face-provisioning.service.ts:450` | Kiểm soát cứng theo thời gian làm được; cần tìm thiết bị theo `iot_devices.zone_id`. |
| F5 | Sự kiện khuôn mặt IVSS được lưu vào `iot_device_events` kèm `zone_id`; chỉ khu `corridor/lobby/parking` mới ghi `zone_presence_events`. Không nhánh nào ghi `gate_access_logs`. | `ivss-presence-ingestion.service.ts:286-436`, `zones/services/zone-presence-writer.service.ts` | Check-in/out bằng khuôn mặt ở cổng cần một điểm móc mới sau khi sự kiện được lưu. |
| F6 | `gate_access_logs` có một điểm ghi duy nhất `GateAccessLogService.writeGateLog()`, hiện chỉ ANPR gọi; tự kiểm `zone_type='gate'`, chống trùng bằng unique. | `zones/services/gate-access-log.service.ts:157` | Khách vào/ra cổng ghi qua đúng hàm này để báo cáo ra vào khuôn viên có khách. |
| F7 | Cảnh báo an ninh có một điểm ghi duy nhất `AlertsService.recordAlert({ alertType, zoneId, payloadJson, dedupeKey })`; `alert_type` là varchar, mức nghiêm trọng mặc định tra theo bảng tĩnh. | `alerts/services/alerts.service.ts:36-95` | Cảnh báo khách (quá giờ, phải rời, sai khu vực) đi vào Trung tâm cảnh báo sẵn có. |
| F8 | Thông báo: `NotificationsService.createNotification()` (trong ứng dụng, đẩy realtime) và `enqueueEmailNotification()` (hàng đợi `notification`). `notification_type` là varchar(60). | `notifications/notifications.service.ts:91,163` | Thêm loại `visitor_*` không cần migration. |
| F9 | `RateLimitGuard` là khung rỗng (`return true`). Redis có `incr/expire`. | `auth/guards/rate-limit.guard.ts`, `redis/redis.service.ts` | Viết guard giới hạn tần suất riêng cho endpoint công khai của khách. |
| F10 | Tài khoản đối tác được nhận diện bằng `departments.department_code='PARTNER'` và bị loại ở 6 file (`accounts` 5, `auth` 1). | `common/utils/partner-account.util.ts` | Tài khoản khách dùng đơn vị `VISITOR` và phải được loại ở đúng các chỗ đó. |
| F11 | Unique `UQ_device_user_mappings_active (device_id, user_id) WHERE deleted_at IS NULL`. | migration `20260721000007` | Mỗi khách chỉ có một ánh xạ sống trên một thiết bị → không cho hai lượt đã duyệt chồng thời gian của cùng một khách. |
| F12 | Role `GUARD` (bảo vệ) đã được seed. | migration `20261007000003` | Quầy lễ tân cấp cho GUARD. |
| F13 | Không có `ValidationPipe` toàn cục; controller tự gắn. Phản hồi theo dạng `{ success, message, data, meta }`. Lỗi: `{ success:false, message, error:{ code, details } }`. | `reports/controllers/*.ts`, `attendance/controllers/manual-attendance.controller.ts:38` | Controller mới tự khai `ValidationPipe({ whitelist, transform })`. |
| F14 | Có sẵn endpoint giả lập chỉ chạy khi `NODE_ENV=development` (`dev/mock-camera-face-scan`…). | `dev/dev.controller.ts` | Màn hình cổng của mockup nối vào một endpoint giả lập cùng kiểu, không phải API sản phẩm. |

## 1. Mục tiêu và tiêu chí thành công

**Mục tiêu:** thay toàn bộ lớp dữ liệu giả của phân hệ Khách bằng BE thật, giữ nguyên 8 màn đã duyệt.

**Thành công khi:**
1. Với `REACT_APP_VISITOR_REPORT_MOCK=false`, bảy màn Khách (S1–S7) chạy trên dữ liệu thật; kịch bản demo bước 1–6 đi trọn.
2. Một khách đã duyệt, có ảnh, khi camera IVSS ở khu vực cổng nhận ra trong khung hiệu lực thì lượt tự chuyển "đang trong khuôn viên", người được gặp nhận thông báo, và `gate_access_logs` có một dòng `enter`.
3. Ngoài khung giờ hoặc sai khu vực: không check-in, có sự kiện từ chối và cảnh báo an ninh.
4. Thu hồi khi khách đang ở trong: lượt thành "phải rời", vẫn được đếm, người được gặp và bảo vệ được báo, chiều ra vẫn ghi nhận.
5. Hết hiệu lực hoặc khách rời: khuôn mặt khách bị gỡ khỏi IVSS (qua reconcile) và khỏi FaceGate.
6. Mọi endpoint ghi đều yêu cầu xác thực, trừ ba endpoint công khai có lý do ghi ở §7.1 (SEC-02).
7. Test: bảng chuyển trạng thái BE vượt đúng bộ test của FE; logic nghiệp vụ đạt độ phủ ≥ 80% (ENG-01); test DB cho mọi câu SQL mới.

## 2. Phạm vi

**Trong phạm vi:** module `visitors` (bảng, API, cron, cấu hình, quyền); tài khoản khách ẩn và vòng đời khuôn mặt; điểm móc sự kiện IVSS; đẩy/gỡ FaceGate theo khu vực; thông báo trong ứng dụng, email, cảnh báo an ninh; endpoint giả lập cho màn hình cổng; nối FE cho phân hệ Khách.

**Ngoài phạm vi:** OTP email; SMS/Zalo; app mobile; đối chiếu khách với danh sách kiểm soát lúc đăng ký; ngày nghỉ lễ; thiết bị kiosk thật ở cổng; báo cáo khách dạng xuất file (thuộc spec Báo cáo).

## 3. Kiến trúc

```
FE (visitorService)                       Thiết bị
      │                                      │
      ▼                                      ▼
visitors/controllers ── public (rate limit)  ivss ingest ─▶ VISITOR_FACE_EVENT_HOOK ─┐
      │               └─ nội bộ (JWT + quyền)  face-access verify ─▶ (nguồn 'visitor') ┤
      ▼                                                                               ▼
VisitService ─ VisitStateMachine (thuần) ◀──────────────── VisitorGateService (đánh giá lượt nhận diện)
      │
      ├─ VisitorIdentityService ─▶ accounts (tài khoản khách ẩn, face profile)
      ├─ VisitorFaceGateService ─▶ face-access (FaceDeviceProviderFactory)
      ├─ VisitorNotifier ─▶ notifications, mail, alerts, websocket
      └─ zones (GateAccessLogService.writeGateLog)
scheduler ─▶ VisitorSweepService (hết hạn, leo thang quá giờ, chưa ghi nhận giờ ra, dọn ảnh)
```

- `visitors` là module mới, **không** `@Global`; cung cấp hai cổng nối qua token đặt ở `src/common/ports/` (cùng mẫu `FACE_VERIFY_HOOK`) để `ivss` và `face-access` gọi sang mà không import ngược.
- Logic chuyển trạng thái nằm trong một file thuần `visit-state-machine.ts`, chép nguyên bảng của FE.
- Chỉ đọc/ghi bảng của module khác qua service của module đó (ARCH-01). Ba chỗ phải thêm hàm ở module khác được liệt kê ở §9.

## 4. Mô hình dữ liệu

Bốn bảng mới, một đơn vị và một role seed. Mọi bảng nghiệp vụ có `deleted_at` (DATA-01), trừ bảng sự kiện (nhật ký chỉ ghi thêm).

### 4.1. `visitors` — một dòng cho một con người

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid NOT NULL UNIQUE → `users.id` | tài khoản khách ẩn |
| `full_name` | varchar(150) NOT NULL | |
| `id_number` | varchar(30) NULL | CCCD/hộ chiếu |
| `phone_number` | varchar(20) NOT NULL | chuẩn hóa `0xxxxxxxxx` |
| `email` | varchar(255) NULL | email thật của khách |
| `organization` | varchar(200) NULL | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Định danh khách: trùng `id_number` (nếu có) thì là cùng một người; không có thì theo `phone_number`. Unique một phần: `(id_number) WHERE id_number IS NOT NULL AND deleted_at IS NULL`, `(phone_number) WHERE id_number IS NULL AND deleted_at IS NULL`.

### 4.2. `visitor_visits` — một lượt khách

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `visit_code` | varchar(16) NOT NULL UNIQUE | `VS-YYMMDD-NNNN` |
| `visitor_id` | uuid NOT NULL → `visitors` | |
| `channel` | varchar(20) NOT NULL | `online` / `host_invite` / `walk_in` |
| `status` | varchar(20) NOT NULL | 10 trạng thái ở §5 |
| `host_user_id` | uuid NOT NULL → `users` | |
| `department_id` | uuid NULL → `departments` | đơn vị của người được gặp lúc tạo (BR-V10) |
| `purpose` | varchar(120) NOT NULL | |
| `companions` | smallint NOT NULL DEFAULT 0 | |
| `plate_number` | varchar(16) NULL | |
| `scheduled_from`, `scheduled_to` | timestamptz NOT NULL | |
| `valid_from`, `valid_to` | timestamptz NOT NULL | quyền ra vào |
| `check_in_at`, `check_out_at` | timestamptz NULL | |
| `face_score` | numeric(5,4) NULL | |
| `reject_reason` | text NULL | |
| `revoked_at` | timestamptz NULL | |
| `manual_exit`, `not_found` | boolean NOT NULL DEFAULT false | |
| `overstay_notified_at`, `overstay_escalated_at` | timestamptz NULL | |
| `last_seen_at` | timestamptz NULL, `last_seen_zone_id` uuid NULL → `zones` | BR-V16 |
| `consent_at` | timestamptz NULL | thời điểm đồng ý xử lý sinh trắc |
| `photo_file_id` | uuid NULL → `media_files` | ảnh đăng ký |
| `created_by`, `approved_by` | uuid NULL → `users` | NULL khi khách tự đăng ký |
| `approved_at`, `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Chỉ mục: `(status, scheduled_from)`, `(host_user_id, status)`, `(visitor_id, scheduled_from DESC)`, `(department_id, scheduled_from)`, và chỉ mục một phần `(valid_to) WHERE status IN ('approved','checked_in','must_leave')` cho cron quét.

Ràng buộc `CHECK (scheduled_to > scheduled_from AND valid_to > valid_from)`.

### 4.3. `visitor_visit_zones` — khu vực được phép

`(visit_id uuid → visitor_visits ON DELETE CASCADE, zone_id uuid → zones)`, PK cả hai cột.

### 4.4. `visitor_visit_events` — dòng thời gian (chỉ ghi thêm)

`id`, `visit_id` → `visitor_visits`, `event_type` varchar(30), `event_time` timestamptz, `zone_id` NULL, `device_event_id` NULL → `iot_device_events`, `score` numeric(5,4) NULL, `actor_user_id` NULL, `note` text NULL, `created_at`. Chỉ mục `(visit_id, event_time)` và `(event_type, event_time) WHERE event_type IN ('access_denied','manual_review')` cho bảng cảnh báo của quầy lễ tân.

19 loại sự kiện, giữ đúng tên của mockup: `registered, approved, rejected, cancelled, revoked, extended, photo_added, face_verified, manual_review, access_denied, check_in, check_out, expired, face_removed, email_sent, host_notified, security_notified, manual_close, exit_unrecorded`.

### 4.5. `visitor_visit_code_counters` — cấp mã lượt

`(day date PK, last_no integer)`. Cấp số bằng một câu `INSERT … ON CONFLICT (day) DO UPDATE SET last_no = visitor_visit_code_counters.last_no + 1 RETURNING last_no` trong cùng transaction tạo lượt.

### 4.6. Seed

- Đơn vị `department_code='VISITOR'`, tên "Khách đến làm việc" (mẫu `20260811000001-SeedPartnerDepartment`).
- Tài khoản khách ẩn: `username='visitor_<12 hex>'`, `email='<visitor id>@visitor.invalid'`, `password_hash` là chuỗi không phải bcrypt hợp lệ, `department_id` = VISITOR, `account_status='active'`, không có role. Không đăng nhập được vì mật khẩu không bao giờ khớp và email không nhận được thư đặt lại.

## 5. Máy trạng thái

Chép nguyên từ `visitStateMachine.js` của FE, gồm cả bổ sung §12 của spec mockup:

```
pending_approval ─approve▶ approved ─check_in▶ checked_in ─check_out▶ checked_out
       │ reject/cancel        │ revoke▶ revoked        │ revoke▶ must_leave ─check_out▶ checked_out
       ▼                      │ cancel▶ cancelled      │ close_manual▶ checked_out
 rejected / cancelled         └ expire▶ expired        └ mark_unrecorded▶ exit_unrecorded ─close_manual▶ checked_out
```

Hàm thuần phải có: `canTransition`, `nextStatus`, `availableActions`, `canExtend`, `isOverstay`, `overstayLevel`, `isOnSite`, `shouldExpire`, `shouldMarkExitUnrecorded`, `defaultAccessWindow`, `evaluateGateAttempt`. Bộ test của FE (`visitStateMachine.test.js`, 33 ca) được chuyển sang Jest của BE và phải xanh nguyên vẹn.

Chuyển trạng thái trong DB dùng cập nhật có điều kiện `UPDATE … SET status = $new WHERE id = $id AND status = $expected RETURNING *`; không có dòng trả về thì trả 409 `VISIT_STATE_CONFLICT`. Nhờ vậy hai người cùng bấm một thao tác không tạo hai sự kiện (ARCH-03).

## 6. Quy tắc nghiệp vụ và cấu hình

Giữ BR-V1 đến BR-V16 của spec mockup. Thêm:

| Mã | Quy tắc |
|---|---|
| BR-V17 | Không duyệt một lượt nếu cùng khách đang có lượt `approved`/`checked_in`/`must_leave` khác chồng khung hiệu lực (F11). Lỗi 409 `VISIT_OVERLAP`. |
| BR-V18 | Người được gặp chỉ duyệt, từ chối, hủy lượt của chính mình. Người có quyền `visitor.visit.manage` làm được với mọi lượt. |
| BR-V19 | Ảnh khuôn mặt và hồ sơ khuôn mặt của khách bị xóa sau `photo_retention_days` kể từ khi lượt cuối cùng của khách đóng. Lịch sử lượt vẫn giữ. |
| BR-V20 | Tìm người cần gặp ở trang công khai: tối thiểu 2 ký tự, tối đa 10 kết quả, chỉ trả họ tên và tên đơn vị, chỉ nhân sự đang hoạt động, không gồm tài khoản PARTNER/VISITOR. |

**Cấu hình** (bảng `system_configs`, nhóm `visitor`, đọc qua `VisitorConfigService` có giá trị mặc định khi chưa cấu hình):

| Khóa | Mặc định | Dùng cho |
|---|---|---|
| `visitor.face_match_threshold` | `0.80` | BR-V5 |
| `visitor.access_buffer_minutes` | `30` | BR-V3 |
| `visitor.max_visit_days` | `7` | BR-V2 |
| `visitor.overstay_escalate_minutes` | `30` | BR-V13 |
| `visitor.approver_mode` | `host_or_manager` | BR-V4; giá trị khác: `manager_only` |
| `visitor.default_zone_codes` | `[]` (rỗng = cổng chính theo `zone_type='gate'` + khu của đơn vị tiếp) | BR-V3 |
| `visitor.purposes` | 8 mục đích của mockup | danh mục |
| `visitor.photo_retention_days` | `30` | BR-V19 |
| `visitor.public_rate_limit` | `{ "register": [5, 600], "lookup": [30, 600], "hosts": [60, 600] }` (số lần, giây) | F9 |
| `visitor.notify_host_email` | `true` | BR-V7 |

## 7. Hợp đồng API

Tiền tố `/api/v1`. Tên và dạng dữ liệu bám `visitorService.js`; `VisitView` giữ đúng các trường FE đang đọc (`hostName`, `departmentName`, `zoneNames`, `overstay`, `overstayLevel`, `lastSeen`, `availableActions`, `revokedAt`, `manualExit`, `notFound`, `events[]`, `access{ validFrom, validTo, zoneIds }`, `visitor{…, photo, hasPhoto }`).

`visitor.photo` trong phản hồi là URL ký tạm của `StorageService.getSignedStorageUrl()`, không phải data URL. Chiều gửi lên vẫn nhận data URL (giải mã bằng `decode-base64-image.util.ts`), tối đa 2 MB, chỉ JPEG/PNG.

### 7.1. Công khai (không JWT — ngoại lệ SEC-02)

| Endpoint | Lý do công khai | Bảo vệ |
|---|---|---|
| `POST /public/visitor-registrations` | Khách chưa có tài khoản | Giới hạn tần suất theo IP; kiểm tra đầu vào; lượt tạo ra ở `pending_approval`, không cấp quyền |
| `GET /public/visitor-registrations/:code` | Khách tra cứu kết quả | Giới hạn tần suất; không trả số giấy tờ, điện thoại, email, ảnh, ghi chú sự kiện |
| `GET /public/visitor-hosts?q=` và `/:id` | Khách chọn người cần gặp | Giới hạn tần suất; BR-V20 |

Vượt giới hạn trả 429 `RATE_LIMITED` kèm `Retry-After`.

### 7.2. Nội bộ

| Endpoint | Quyền | Ghi chú |
|---|---|---|
| `GET /visitors/lookups` | đã đăng nhập | đơn vị, khu vực, mục đích |
| `GET /visitors/visits` | `visitor.visit.read` | lọc `status` (gồm `closed`), `from`, `to`, `departmentId`, `hostId`, `q`, `page`, `limit`; trả `{ items, total, counts }` |
| `GET /visitors/visits/:id`, `/:id/related` | `visitor.visit.read` hoặc là người được gặp của lượt | |
| `POST /visitors/visits` | `walk_in`: `visitor.desk.use`; `host_invite`: `visitor.host.self` | |
| `POST /visitors/visits/:id/approve` · `/reject` · `/cancel` | `visitor.visit.manage` hoặc BR-V18 | |
| `POST …/revoke` · `/extend` · `/close-manual` | `visitor.visit.manage` | |
| `POST …/photo` · `/check-in` · `/check-out` | `visitor.desk.use` | |
| `GET /visitors/desk/today` | `visitor.desk.use` | `{ kpis, items, alerts, attention }` |
| `GET /visitors/my-visits` · `/my-notifications`, `POST /my-notifications/read` | `visitor.host.self` | theo người đang đăng nhập (bỏ `host-me` của mockup) |
| `GET /visitors/stats` | `visitor.stats.read` | |
| `POST /dev/mock-visitor-scan` | chỉ `NODE_ENV=development` | cho màn hình cổng mô phỏng; thay `/gate/visitor-scan` của mockup |

Mọi thao tác ghi nội bộ ghi `audit_logs`.

### 7.3. Quyền (seed bằng migration, mẫu `20260825000001`)

| Mã quyền | SYSTEM_ADMIN | BUSINESS_ADMIN | GUARD | MANAGER | EMPLOYEE, TEACHER |
|---|---|---|---|---|---|
| `visitor.visit.read` | ✓ | ✓ | ✓ | | |
| `visitor.visit.manage` | ✓ | ✓ | | | |
| `visitor.desk.use` | ✓ | ✓ | ✓ | | |
| `visitor.stats.read` | ✓ | ✓ | | | |
| `visitor.host.self` | ✓ | ✓ | | ✓ | ✓ |

## 8. Tích hợp nhận diện

### 8.1. Vòng đời khuôn mặt của khách

| Thời điểm | IVSS (F2) | FaceGate (F4) |
|---|---|---|
| Đăng ký có ảnh | tạo `face_profiles` ở `pending_review` | — |
| Duyệt (hoặc bổ sung ảnh cho lượt đã duyệt) | chuyển hồ sơ sang `active` → reconcile nạp trong ≤ 30 giây | với mỗi khu vực được phép có thiết bị `face_server` gắn `zone_id`: `uploadFace` + `addPerson(validFrom, validTo)`; ghi `device_user_mappings` với `metadata_json.source='visitor'`, `visitId` |
| Gia hạn | — | `deletePerson` rồi `addPerson` với khung mới |
| Thu hồi khi chưa đến, hết hạn, hủy | hồ sơ sang `revoked` → reconcile gỡ | `deletePerson` |
| Thu hồi khi đang ở trong (`must_leave`) | giữ `active` để camera còn thấy khách (BR-V12, BR-V16) | `deletePerson` ngay (cửa không mở nữa) |
| Khách rời hoặc đóng lượt | hồ sơ sang `revoked` nếu khách không còn lượt đã duyệt nào khác | `deletePerson` |

Cron `visitor-face-reconcile` (mỗi phút) đưa trạng thái thiết bị về đúng trạng thái lượt, để lỗi thiết bị tạm thời tự lành. Mọi lời gọi thiết bị có try/catch từng dòng; lỗi không làm hỏng thao tác nghiệp vụ.

### 8.2. Sự kiện camera IVSS

Thêm cổng nối `VISITOR_FACE_EVENT_HOOK` ở `src/common/ports/visitor-face-event-hook.ts`. `IvssPresenceIngestionService.onFaceEvent` gọi nó sau khi lưu sự kiện, khi đã xác định được `userId`:

```ts
onIvssFaceEvent({ userId, zoneId, direction, eventTime, similarity, sourceEventId, deviceId }): Promise<void>
```

Lời gọi không được ném lỗi và không được làm chậm webhook (gọi `void … .catch(log)` như nhánh restricted-zone). Bản mặc định là no-op để `ivss` chạy được khi module `visitors` tắt.

`VisitorGateService` xử lý:

1. `userId` không phải tài khoản khách → thoát ngay (một truy vấn có chỉ mục; kết quả âm được nhớ đệm 60 giây).
2. Lấy lượt đang hoạt động của khách (`approved`/`checked_in`/`must_leave`) có khung hiệu lực gần `eventTime` nhất.
3. Cập nhật `last_seen_at`, `last_seen_zone_id`.
4. Theo loại khu vực và hướng:

| Tình huống | Kết quả |
|---|---|
| Khu `gate`, hướng `enter`, lượt `approved` | `evaluateGateAttempt` → check-in + `writeGateLog(enter)` + báo người được gặp; hoặc `manual_review`; hoặc `access_denied` + cảnh báo |
| Khu `gate`, hướng `leave`, lượt đang ở trong | check-out + `writeGateLog(leave)` + gỡ khuôn mặt |
| Khu khác, lượt `checked_in`, khu không thuộc danh sách được phép | sự kiện `access_denied` (`zone_not_allowed`) + cảnh báo `visitor_zone_violation` |
| Bất kỳ khu nào trừ chiều ra ở cổng, lượt `must_leave` | sự kiện `access_denied` (`access_revoked`) + cảnh báo `visitor_must_leave` |
| Hướng `seen` (camera không cấu hình hướng) ở cổng | chỉ cập nhật "lần cuối thấy" |

Hướng lấy từ `ivss.channel_direction_map` sẵn có. Sự kiện trùng trong 5 giây đã được tầng ingest loại.

### 8.3. Sự kiện FaceGate

`FaceAttendanceService.onVerify` tra ánh xạ theo `device_person_code`. Thêm một nhánh đầu hàm: ánh xạ có `metadata_json.source='visitor'` thì chuyển cho `VISITOR_FACE_EVENT_HOOK.onFaceGateVerify({ visitId, deviceId, zoneId, direction, verifyTime })` rồi thoát. Thiết bị đã tự kiểm khung giờ nên nhánh này chỉ ghi nhận check-in/out.

### 8.4. Cảnh báo an ninh

Ba loại mới qua `AlertsService.recordAlert`, `dedupeKey` = id lượt: `visitor_overstay` (medium), `visitor_must_leave` (high), `visitor_zone_violation` (high). Thêm ba dòng vào bảng mức mặc định trong `alerts.service.ts`.

## 9. Thay đổi ở module khác

| Module | Thay đổi | Lý do |
|---|---|---|
| `accounts` | `FaceProfileService.setProfileStatus(userId, status)` và `deletePortrait(userId)`; hàm tạo tài khoản khách ẩn trong `UsersService`; loại đơn vị `VISITOR` ở các chỗ đang loại `PARTNER` | F3, F10 |
| `common` | cổng nối `visitor-face-event-hook.ts`; tiện ích `isNonStaffDepartment()` gom PARTNER và VISITOR | F5, F10 |
| `ivss` | một lời gọi hook trong `onFaceEvent` | F5 |
| `face-access` | một nhánh trong `onVerify`; hàm tìm thiết bị theo `zone_id` | F4 |
| `alerts` | ba dòng mức mặc định | F7 |
| `notifications` | thêm giá trị enum `visitor_*` | F8 |
| `mail` | 4 mẫu email: đã nhận đăng ký, đã duyệt (kèm mã lượt và link tra cứu), bị từ chối, lời mời | BR-V8 |
| `scheduler` | 2 cron: `visitor-sweep`, `visitor-face-reconcile`; cờ `SCHEDULER_VISITOR_ENABLED` | §10 |
| `dev` | `mock-visitor-scan` | F14 |

## 10. Tác vụ định kỳ

| Cron | Tần suất | Việc |
|---|---|---|
| `visitor-sweep` | mỗi phút | hết hạn lượt `approved` quá `valid_to`; báo quá giờ mức 1 và mức 2; sang ngày mới (giờ Việt Nam) chuyển `exit_unrecorded` (BR-V15) |
| `visitor-face-reconcile` | mỗi phút | §8.1 |
| `visitor-photo-retention` | 02:00 hằng ngày | BR-V19 |

Mỗi cron lấy khóa Redis `SET NX EX` để chỉ một instance chạy. Mỗi lượt xử lý trong transaction riêng, lỗi một lượt không chặn lượt khác.

## 11. Bảo mật và quyền riêng tư

- Ảnh khuôn mặt và số giấy tờ là dữ liệu nhạy cảm: không ghi vào log, không đưa vào `audit_logs.metadata_json`, không trả ở endpoint công khai (SEC-01).
- `consent_at` bắt buộc với kênh `online` và `walk_in`; thiếu thì từ chối.
- Mọi SQL dùng tham số (SEC-03). Tìm kiếm `q` dùng `ILIKE` với tham số đã thoát ký tự `%` và `_`.
- Thông điệp lỗi không lộ chi tiết nội bộ (ENG-03).
- Trang công khai lộ họ tên và đơn vị của nhân sự qua ô tìm người cần gặp. Đây là quyết định cần khách hàng xác nhận; có cờ `visitor.public_host_search_enabled` (mặc định bật) để tắt, khi đó khách chỉ đăng ký được qua link mời có sẵn `?host=`.

## 12. Kiểm thử

| Tầng | Nội dung |
|---|---|
| Unit | máy trạng thái (33 ca chép từ FE); kiểm tra đầu vào; `VisitService` và `VisitorGateService` với phụ thuộc giả; giới hạn tần suất; cấp mã lượt |
| DB (`RUN_DB_TESTS=1`) | migration lên/xuống; cập nhật có điều kiện khi tranh chấp; unique định danh khách; truy vấn danh sách, quầy lễ tân, thống kê trên dữ liệu seed |
| e2e | đăng ký công khai → duyệt → sự kiện IVSS giả → check-in → check-out; phân quyền từng endpoint; 429 khi vượt giới hạn |
| Hợp đồng | với cùng kịch bản, phản hồi BE có đủ các trường FE đang đọc (so khóa với `VisitView` của mock) |

## 13. Triển khai

Cờ: `VISITORS_ENABLED` (đăng ký module và hook), `SCHEDULER_VISITOR_ENABLED`, `VISITOR_FACEGATE_ENABLED` (mặc định tắt cho tới khi có thiết bị ở cổng). Thứ tự: chạy migration → bật `VISITORS_ENABLED` → cấu hình `ivss.channel_presence_zone_map` và `channel_direction_map` cho camera cổng → bật cron → tắt cờ mock ở FE. Quay lui: tắt ba cờ; bảng mới không ảnh hưởng luồng cũ.

## 14. Rủi ro

| Mã | Rủi ro | Xử lý |
|---|---|---|
| R1 | Chưa có FaceGate ở cổng để thử thật. | Viết theo cổng nối sẵn có, test với provider giả; cờ `VISITOR_FACEGATE_ENABLED` tắt mặc định. |
| R2 | IVSS nhận ra khách chậm tới 30 giây sau khi duyệt. | Chấp nhận; ghi rõ ở màn duyệt. Khách đến ngay sau khi duyệt thì lễ tân check-in tay. |
| R3 | Tài khoản khách ẩn lọt vào danh sách nhân sự, bộ chọn người dự họp, số liệu nhân sự. | Loại ở đúng 6 file đang loại PARTNER; thêm test hồi quy cho từng chỗ. |
| R4 | Camera cổng chưa cấu hình hướng thì không phân biệt vào/ra. | Không tự check-in khi hướng là `seen`; quầy lễ tân vẫn check-in tay được. |
| R5 | Endpoint công khai bị lạm dụng. | Giới hạn tần suất theo IP, giới hạn dung lượng ảnh, lượt chờ duyệt tự hết hạn. |

## 15. Ước lượng

Một dev đã quen codebase: **khoảng 22 ngày công**, chia mốc ở plan. Tăng so với con số 14 ngày ở spec mockup vì: bổ sung §12 (phải rời, leo thang, đóng thủ công), khoảng trống F5/F6 (khuôn mặt chưa sinh nhật ký cổng), giới hạn tần suất, và mốc nối FE.
