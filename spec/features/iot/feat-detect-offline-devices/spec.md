---
name: feat-detect-offline-devices
description: Phát hiện camera online/offline bằng active TCP probe tới RTSP (cron + endpoint chạy tay). Chỉ đổi status, soft theo ADR-008.
category: iot
---

# Feature Specification: Phát hiện thiết bị offline bằng Active Probe (Detect Offline Devices)

- **Feature ID**: IOT-014
- **Feature Name**: Phát hiện camera offline bằng active probe
- **Feature Table Ref**: #15 — Phát hiện camera offline bằng active probe
- **Module / Domain**: iot
- **Created Date**: 2026-06-15
- **Status**: Draft (đã chốt clarifications)
- **Source Documents**:
  - `CLAUDE.md` (Sections 11.1, 11.5, 11.7; ARCH-02 inline/queue)
  - `spec/global/constitution.md` (SEC-01/02, ARCH-02/03, DATA-01)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (Section 8 — IoT Device Management)
  - `docs/ARCHITECTURE_DECISIONS.md` (ADR-008: status-based device lifecycle)
  - `src/modules/iot/services/iot-devices.service.ts` (checkAvailability — gap RTSP probe)
  - `src/modules/scheduler/scheduler.service.ts` (cron convention), `src/config/env.validation.ts` (Joi)
  - Spec liên quan: `feat-disable-enable-iot-device` (IOT-012, audit/status), `feat-check-camera-availability` (IOT-005), `feat-receive-face-server-heartbeat` (IOT-006)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo spec IOT-014: active TCP probe RTSP (cron mỗi phút + endpoint chạy tay), maintain online↔offline cho ip_camera; mở rộng audit action auto_online/auto_offline; ENV mới. | Toàn bộ file (bản đầu tiên) |
| 2026-06-15 | Chốt NC-1..5: ENV `DEVICE_OFFLINE_DETECT_CRON` (default `'* * * * *'`); cap `PROBE_CONCURRENCY=10` hằng số; `@Cron` ở SchedulerService delegate `detectOfflineDevices`; permission `iot.device.probe` (ADMIN/MANAGER); cron gate `SCHEDULER_ENABLED && DEVICE_OFFLINE_DETECT_ENABLED`, endpoint không gate. Mục 11 → đã chốt. | Mục 3.1, 11 |
| 2026-06-15 | ĐẢO NC-1: cron CỐ ĐỊNH `CronExpression.EVERY_MINUTE`, **bỏ** env `DEVICE_OFFLINE_DETECT_CRON`. Parse host:port validate port nguyên 1–65535 (sai → skip). | Mục 3.1, 11 (NC-1), Out-of-scope ENV |

---

## 1. Giới thiệu

### 1.1 Bối cảnh

Hiện tại backend chỉ biết camera "sống/chết" một cách **bị động**:
- **Face Server (door_camera/face_server)**: tự gọi heartbeat về backend (IOT-006); backend suy ra online/offline qua **heartbeat-staleness** (so `last_seen_at` với hiện tại) — reactive, phù hợp vì Face Server chủ động gọi.
- **IP Room Camera (ip_camera)**: **KHÔNG** tự gọi về (chỉ phát luồng RTSP). Endpoint `checkAvailability` (IOT-005) cho nhánh ip_camera chỉ kiểm `rtsp_config` đã cấu hình hay chưa (`check_type = 'rtsp_config_readiness'`, `runtime_verified = false`) — **không** thật sự kết nối tới camera. ⇒ Backend KHÔNG biết camera RTSP có thực sự online hay không.

**IOT-014 lấp đúng gap này**: backend **chủ động** ("active probe") định kỳ thử **kết nối TCP** tới địa chỉ RTSP của từng camera. Kết nối được → `online`; timeout/refuse → `offline`. Đây là cơ chế **proactive** do backend khởi xướng, khác hẳn heartbeat-staleness.

### 1.2 Mục tiêu

Duy trì trạng thái `status` (`online`↔`offline`) của các `ip_camera` sát thực tế bằng active TCP probe:
- **Cron** ~mỗi phút (tắt được qua ENV) quét toàn bộ ip_camera đủ điều kiện.
- **Endpoint chạy tay** `POST /api/v1/iot-devices/probe-status` để admin kích hoạt một lượt probe ngay.
- Mỗi probe: TCP-connect tới `host:port` (parse từ `stream_url`, fallback `ip_address:554`) với timeout ngắn; mở được → online, không → offline.
- Chỉ đổi **`status`**; transition (đổi thật) mới ghi `audit_logs` (`auto_online`/`auto_offline`). Idempotent: cùng trạng thái → không ghi.

### 1.3 Giá trị mang lại

- **Cho quản trị viên/dashboard**: thấy camera RTSP thực sự online/offline theo thời gian gần thực, không chỉ "đã cấu hình RTSP hay chưa".
- **Cho hệ thống**: nền tảng để các UC sau (no-show, presence) tin cậy `status` của camera.

### 1.4 Out-of-scope

- **ffprobe / giải mã stream / RTSP OPTIONS / kiểm RTSP auth** — v1 chỉ **TCP-connect** (mở được cổng RTSP coi là online). Probe sâu hơn = future.
- **Face Server proactive cron** — Face Server vẫn dùng heartbeat-staleness reactive như hiện có (proactive cho Face Server = ĐỢT 2).
- **Anti-flap / debounce** (cần N lần fail liên tiếp mới flip) — v1 flip ngay sau 1 probe; anti-flap = future.
- **Notification/alert** khi camera offline — UC riêng.
- **Lịch probe riêng từng camera**, queue/worker phân tán — v1 inline (xem NFR ARCH-02).
- Đụng `disabled`/`maintenance` device; đổi `health_status`/`room_id`/`metadata_json`/`last_seen_at`/`device_code`/`device_type`; sửa entity/schema.

---

## 2. System Context

### 2.1 Kết quả VERIFY (đã rà code)

| Hạng mục | Phát hiện (file:line) |
|---|---|
| Gap probe ip_camera | [iot-devices.service.ts](../../../../src/modules/iot/services/iot-devices.service.ts) nhánh `IP_CAMERA` (~L775+): `check_type = 'rtsp_config_readiness'`, `runtime_verified = false` — CHỈ kiểm `device.streamUrl`/`rtsp_config` tồn tại, **KHÔNG** kết nối thật. ⇒ IOT-014 lấp gap này. |
| Face Server reactive | Cùng file, nhánh `FACE_SERVER` (~L744+): heartbeat-staleness (so `lastSeenAt` ≤ 5 phút) — **giữ nguyên, không đụng**. |
| `stream_url` format | [iot-devices.service.ts:669](../../../../src/modules/iot/services/iot-devices.service.ts) `configureRtsp` build `\`${protocol}://${host}:${port}${path}\`` — **không credential**. Parse host:port bằng `new URL(streamUrl)` (rtsp scheme) hoặc regex `rtsp://([^:/]+):?(\d+)?`. |
| Scheduler wiring | [scheduler.module.ts](../../../../src/modules/scheduler/scheduler.module.ts): `ScheduleModule.forRoot()` import tại **SchedulerModule** (1 lần, app-wide discovery). Cron gom tại [scheduler.service.ts](../../../../src/modules/scheduler/scheduler.service.ts) (convention tập trung), dùng `@Cron(CronExpression.*, { name })`, gate bằng `SCHEDULER_ENABLED` + cờ riêng từng job. |
| ENV (Joi) | [env.validation.ts](../../../../src/config/env.validation.ts): `Joi.object({...})`, có section riêng (vd "K. Scheduler"). Boolean `Joi.boolean().default(...)`, số `Joi.number().integer().default(...)`. Thêm biến mới ở section phù hợp. |
| Audit union | [iot-audit.repository.ts:81](../../../../src/modules/iot/repositories/iot-audit.repository.ts): `logDeviceStatusChange({ action: 'disable' | 'enable', ... })` → **mở rộng** thêm `'auto_offline' | 'auto_online'`. |
| TCP probe | Node core `net` (`net.createConnection({host,port})` + `socket.setTimeout(ms)`), xử lý `connect`/`timeout`/`error`, luôn `destroy()` socket — KHÔNG dùng lib ngoài. |

### 2.2 Actor & Roles

| Actor | Vai trò | Quyền |
|---|---|---|
| System (Cron) | Tự động probe định kỳ | Không cần JWT; chạy nội bộ (actor = null khi audit) |
| Người dùng có `iot.device.probe` | Kích hoạt probe thủ công | Gọi `POST /iot-devices/probe-status` |
| System (probe engine) | TCP-connect, đổi status, ghi audit | — |

### 2.3 Entity / Bảng liên quan

| Entity / Table | Vai trò |
|---|---|
| `iot_devices` | Đọc danh sách ip_camera + cập nhật `status` |
| `audit_logs` | Ghi transition (`action_type = 'auto_online' | 'auto_offline'`) |

> Chỉ đổi cột `status`. KHÔNG đụng `health_status`/`room_id`/`metadata_json`/`last_seen_at`/`device_code`/`device_type`.

### 2.4 Phạm vi thiết bị probe

- **Chỉ** `device_type = ip_camera`.
- Trạng thái **được probe**: `online`, `offline` (maintain 2 chiều).
- **Bỏ qua**: `disabled`, `maintenance` (không probe, không đổi).
- Bỏ qua camera **không có địa chỉ** (thiếu cả `stream_url` và `ip_address`).

---

## 3. Trigger / Endpoint

### 3.1 Cron (tự động)

| Field | Value |
|---|---|
| Vị trí | `SchedulerService` (convention tập trung) — `@Cron(CronExpression.EVERY_MINUTE, { name: 'device-offline-detect' })`, delegate `IotDevicesService.detectOfflineDevices(null)` |
| Gate | `SCHEDULER_ENABLED` **và** `DEVICE_OFFLINE_DETECT_ENABLED` (default true). Một trong hai false → skip. |
| Actor | null (system) |

### 3.2 Endpoint (chạy tay)

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/iot-devices/probe-status` |
| Auth | `JwtAuthGuard` + `MockPermissionsGuard` |
| Permission | `iot.device.probe` |
| HTTP code | `@HttpCode(200)` (POST mặc định 201) |
| Body | (không) |
| Async | No (inline, xem NFR ARCH-02) |

> Route `probe-status` là **static segment** (1 đoạn), không trùng `@Post()` (create) hay `@Post(':id/assign-room')`. Đặt khai báo trước các route động cùng method để chắc chắn không bị nuốt.

**Response 200:**
```json
{
  "success": true,
  "message": "Device status probe completed",
  "data": {
    "checked": 12,
    "online_count": 9,
    "offline_count": 3,
    "transitions": [
      { "id": "uuid", "from": "online", "to": "offline" },
      { "id": "uuid", "from": "offline", "to": "online" }
    ]
  }
}
```

> `checked` = số camera thực sự được probe (đã trừ disabled/maintenance/không-địa-chỉ). `transitions` chỉ gồm camera **đổi** trạng thái.

---

## 4. Probe & Detection Flow

```text
[Một lượt probe — dùng chung cho Cron và Endpoint]
1. (Cron) nếu SCHEDULER_ENABLED=false hoặc DEVICE_OFFLINE_DETECT_ENABLED=false → skip, return.
2. Lấy camera: SELECT iot_devices WHERE device_type='ip_camera' AND status IN ('online','offline').
   (Bỏ disabled/maintenance.)
3. Với mỗi camera, xác định địa chỉ probe:
   - parse host:port từ stream_url (rtsp://host:port/path).
   - nếu thiếu port → 554.
   - nếu thiếu stream_url → dùng ip_address:554.
   - nếu thiếu cả stream_url lẫn ip_address → SKIP camera đó (không tính vào checked).
4. Probe song song có giới hạn (cap đồng thời ~10): mỗi probe = net TCP-connect tới host:port,
   socket.setTimeout(RTSP_PROBE_TIMEOUT_MS).
   - 'connect' → result = online; destroy socket.
   - 'timeout' | 'error' (refuse/unreachable) → result = offline; destroy socket.
5. So sánh result với status hiện tại:
   - giống → KHÔNG đổi, KHÔNG audit (idempotent).
   - khác → cập nhật iot_devices.status = result; ghi audit_logs
     (action_type = 'auto_online' nếu →online / 'auto_offline' nếu →offline,
      changed_fields.status = { old, new }, user_id = actor|null).
6. Tổng hợp: checked = số camera đã probe (mục 3 không skip); online_count/offline_count theo result;
   transitions = [{id, from, to}] các camera đổi trạng thái.
7. (Endpoint) trả 200 với data tổng hợp. (Cron) log tóm tắt, không trả.
```

- **Mỗi transition** nên nằm trong transaction (update status + audit) — IF audit fail THEN rollback transition đó; các camera khác không bị ảnh hưởng.
- Timeout/error của 1 camera KHÔNG làm hỏng cả lượt (mỗi probe độc lập, lỗi → coi offline).

---

## 5. Functional Requirements (EARS)

### 5.1 Core — Probe & Detection

```text
FR-IOT-014-001: THE system SHALL chọn để probe các thiết bị có device_type='ip_camera' và status ∈ {online, offline}; SHALL bỏ qua disabled/maintenance.
FR-IOT-014-002: THE system SHALL xác định địa chỉ probe theo thứ tự: host:port từ stream_url → (thiếu port) port 554 → (thiếu stream_url) ip_address:554; SHALL validate port là số nguyên trong [1, 65535]; IF thiếu cả stream_url và ip_address, HOẶC port không hợp lệ, THEN SHALL bỏ qua thiết bị đó (không tính vào checked).
FR-IOT-014-003: THE system SHALL probe bằng TCP-connect tới host:port với timeout = RTSP_PROBE_TIMEOUT_MS; WHEN kết nối thành công → kết quả 'online'; WHEN timeout/refuse/error → kết quả 'offline'.
FR-IOT-014-004: WHEN kết quả probe KHÁC status hiện tại, THE system SHALL cập nhật iot_devices.status = kết quả và ghi audit transition.
FR-IOT-014-005: IF kết quả probe TRÙNG status hiện tại, THEN THE system SHALL KHÔNG cập nhật DB và KHÔNG ghi audit (idempotent).
FR-IOT-014-006: THE system SHALL chỉ đổi cột status; SHALL NOT chạm health_status/room_id/metadata_json/last_seen_at/device_code/device_type.
FR-IOT-014-007: THE system SHALL v1 chỉ TCP-connect (KHÔNG ffprobe/RTSP OPTIONS/auth check).
```

### 5.2 Trigger

```text
FR-IOT-014-008: THE system SHALL chạy probe định kỳ qua cron (~mỗi phút); IF SCHEDULER_ENABLED=false hoặc DEVICE_OFFLINE_DETECT_ENABLED=false THEN SHALL skip lượt cron đó.
FR-IOT-014-009: THE system SHALL cung cấp endpoint POST /api/v1/iot-devices/probe-status (không body, @HttpCode 200) để kích hoạt một lượt probe thủ công, trả { checked, online_count, offline_count, transitions }.
```

### 5.3 Concurrency & Resilience

```text
FR-IOT-014-010: THE system SHALL probe song song có giới hạn đồng thời (cap ~10) thay vì tuần tự toàn bộ.
FR-IOT-014-011: IF một probe đơn lẻ timeout/error, THEN THE system SHALL coi thiết bị đó offline và TIẾP TỤC các thiết bị còn lại (lỗi 1 camera không làm hỏng cả lượt).
```

### 5.4 Authorization (SEC-02)

```text
FR-IOT-014-012: IF request endpoint không có JWT hợp lệ, THEN THE system SHALL trả 401.
FR-IOT-014-013: IF người dùng không có quyền iot.device.probe, THEN THE system SHALL trả 403.
FR-IOT-014-014: WHEN probe do cron chạy, THE system SHALL dùng actor = null cho audit; WHEN do endpoint, THE system SHALL dùng user_id từ JWT (sub).
```

### 5.5 Audit

```text
FR-IOT-014-015: WHEN có transition, THE system SHALL ghi audit_logs qua logDeviceStatusChange với action_type ∈ {'auto_online','auto_offline'}, entity_type='iot_devices', entity_id=<device id>, changed_fields.status={old,new}.
FR-IOT-014-016: THE system SHALL đảm bảo cập nhật status + audit cho mỗi transition nằm trong cùng transaction; IF audit fail THEN rollback transition đó (không ảnh hưởng camera khác).
FR-IOT-014-017: THE system SHALL NOT ghi secret/credential ra audit hay log (SEC-01); địa chỉ probe (host:port) không chứa credential vì stream_url lưu không kèm user:pass.
```

---

## 6. Non-functional Requirements (EARS)

```text
NFR-IOT-014-001 (ARCH-02 inline): THE system SHALL thực thi probe INLINE (không queue/worker) — chấp nhận ở scale capstone. NOTE: nếu fleet camera lớn, SHALL chuyển sang background queue/worker (ARCH-02) ở phiên bản sau.
NFR-IOT-014-002 (Event-loop): THE system SHALL dùng TCP-connect bất đồng bộ với timeout (net + setTimeout); SHALL NOT chặn/treo event-loop; mỗi socket SHALL được destroy sau connect/timeout/error (không rò file descriptor).
NFR-IOT-014-003 (SEC fleet-only): THE system SHALL chỉ probe các thiết bị đã đăng ký trong iot_devices (host:port suy ra từ bản ghi DB); SHALL NOT probe địa chỉ tùy ý từ input người dùng (endpoint KHÔNG nhận body/địa chỉ).
NFR-IOT-014-004 (Idempotent): Probe ra cùng trạng thái SHALL không tạo transition/audit; gọi lặp lại an toàn.
NFR-IOT-014-005 (Performance): Một lượt probe với cap đồng thời ~10 và timeout ~3s SHALL hoàn tất trong thời gian hợp lý cho fleet nhỏ (capstone).
NFR-IOT-014-006 (Persistence): THE system SHALL dùng TypeORM; KHÔNG Prisma; KHÔNG sửa schema/entity (DATA-01).
NFR-IOT-014-007 (Observability): THE system SHALL log tóm tắt mỗi lượt cron (checked/online/offline/transitions count); SHALL NOT log credential.
```

---

## 7. Acceptance Criteria

```text
AC-IOT-014-001 (online→offline):
- Given camera ip_camera status='online', host:port không kết nối được (timeout),
- When chạy probe,
- Then status='offline', ghi 1 audit action_type='auto_offline', xuất hiện trong transitions {from:'online',to:'offline'}.

AC-IOT-014-002 (offline→online):
- Given camera status='offline', TCP-connect thành công,
- When probe,
- Then status='online', audit 'auto_online'.

AC-IOT-014-003 (idempotent no-op):
- Given camera status='online' và probe thành công (vẫn online),
- When probe,
- Then KHÔNG đổi DB, KHÔNG audit, không nằm trong transitions.

AC-IOT-014-004 (bỏ disabled/maintenance):
- Given camera status='disabled' (hoặc 'maintenance'),
- When probe,
- Then KHÔNG probe, KHÔNG đổi, không tính vào checked.

AC-IOT-014-005 (thiếu địa chỉ → skip):
- Given camera ip_camera không có stream_url lẫn ip_address,
- When probe,
- Then bỏ qua, không tính vào checked, không lỗi cả lượt.

AC-IOT-014-006 (endpoint manual):
- Given người dùng có iot.device.probe,
- When POST /api/v1/iot-devices/probe-status,
- Then 200 với { checked, online_count, offline_count, transitions }.

AC-IOT-014-007 (cron gate):
- Given DEVICE_OFFLINE_DETECT_ENABLED=false,
- When cron tick,
- Then skip, không probe, không đổi gì.

AC-IOT-014-008 (authorization):
- Given người dùng thiếu iot.device.probe,
- When gọi endpoint,
- Then 403.
```

---

## 8. Edge / Error Cases (EARS)

```text
EC-IOT-014-001: IF stream_url không parse được host, THEN fallback ip_address:554; nếu vẫn không có → skip thiết bị (EC như AC-005).
EC-IOT-014-002: IF stream_url có host nhưng thiếu port, THEN dùng port 554.
EC-IOT-014-003: IF một probe timeout, THEN thiết bị đó = offline (không throw ra ngoài lượt).
EC-IOT-014-004: IF lỗi DB khi ghi 1 transition, THEN rollback transition đó; các thiết bị khác vẫn xử lý; lượt probe vẫn trả tổng hợp phần thành công.
EC-IOT-014-005: IF không có camera ip_camera nào đủ điều kiện, THEN trả { checked:0, online_count:0, offline_count:0, transitions:[] } (endpoint) / log no-op (cron).
EC-IOT-014-006: IF endpoint gửi kèm body, THEN body bị bỏ qua (không định nghĩa DTO body).
```

### 8.1 Error Code Map (endpoint)

| HTTP | Error Code | Kịch bản |
|---|---|---|
| 401 | `UNAUTHORIZED` | Thiếu/sai JWT |
| 403 | `FORBIDDEN` | Thiếu quyền `iot.device.probe` |
| 200 | — | Probe hoàn tất (kể cả 0 camera) |
| 500 | `INTERNAL_SERVER_ERROR` | Lỗi hệ thống ngoài dự kiến (không phải lỗi probe đơn lẻ) |

---

## 9. Traceability

| Requirement | EARS Pattern | Nguồn / Ràng buộc |
|---|---|---|
| FR-IOT-014-001..007 | Event / State / Unwanted | Feature #15; lấp gap checkAvailability ip_camera |
| FR-IOT-014-008..009 | Event | Trigger cron + endpoint |
| FR-IOT-014-010..011 | Unwanted | Concurrency/resilience |
| FR-IOT-014-012..014 | Unwanted / Event | Constitution SEC-02 |
| FR-IOT-014-015..017 | Event / Unwanted | IOT-012 audit pattern; SEC-01 |
| NFR-IOT-014-001 | — | Constitution ARCH-02 |
| NFR-IOT-014-002..007 | — | Event-loop / SEC / idempotent / DATA-01 |

---

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| D-1 | **Cơ chế**: TCP-connect tới host:port RTSP, đợi timeout. Mở được → online; timeout/refuse → offline. v1 **chỉ TCP-connect** (không ffprobe/RTSP OPTIONS). |
| D-2 | **Hai chiều**: maintain online↔offline cho camera ∈ {online, offline}. **Bỏ qua** disabled/maintenance. |
| D-3 | **Phạm vi**: chỉ `ip_camera`. Face Server giữ heartbeat-staleness reactive (proactive = đợt 2). |
| D-4 | **Địa chỉ**: parse host:port từ `stream_url`; thiếu → `ip_address:554`; thiếu cả hai → skip. |
| D-5 | **Trigger**: (a) Cron ~mỗi phút, skip nếu `DEVICE_OFFLINE_DETECT_ENABLED=false`; (b) `POST /api/v1/iot-devices/probe-status` (`JwtAuthGuard`+`MockPermissionsGuard`+`@Permissions('iot.device.probe')`+`@HttpCode(200)`, không body) → `{ checked, online_count, offline_count, transitions:[{id,from,to}] }`. |
| D-6 | **Concurrency**: probe song song cap ~10; mỗi probe timeout = `RTSP_PROBE_TIMEOUT_MS`. |
| D-7 | **ENV (Joi)**: `DEVICE_OFFLINE_DETECT_ENABLED` (default true), `RTSP_PROBE_TIMEOUT_MS` (default 3000). |
| D-8 | **Audit**: mở rộng `logDeviceStatusChange` union thêm `'auto_offline'|'auto_online'`; `changed_fields.status {old,new}`; userId = actor(manual)|null(cron); không secret; idempotent (cùng trạng thái → không transition/audit). |
| D-9 | **v1: 1 probe = flip ngay** (không debounce). Anti-flap = future. |
| D-10 | **ARCH-02**: probe inline chấp nhận ở scale capstone (note chuyển queue nếu fleet lớn). Chỉ đổi `status`; KHÔNG đụng health/room/metadata/last_seen/code/type; KHÔNG sửa entity/schema. |
| D-11 | **Out-of-scope**: ffprobe/decode, RTSP auth, Face Server proactive cron, notification, anti-flap, lịch probe riêng từng camera. |

---

## 11. Quyết định bổ sung đã chốt (vòng 2)

| # | Quyết định |
|---|---|
| **NC-1 → chốt (đảo)** | **Cron CỐ ĐỊNH** `@Cron(CronExpression.EVERY_MINUTE, { name: 'device-offline-detect' })`. **BỎ** env `DEVICE_OFFLINE_DETECT_CRON` (nhất quán cách `@Cron` hiện dùng `CronExpression` constants). Giữ `DEVICE_OFFLINE_DETECT_ENABLED` + `RTSP_PROBE_TIMEOUT_MS`. |
| **NC-2 → chốt** | **Cap concurrency = hằng số `PROBE_CONCURRENCY = 10`** trong service (KHÔNG đưa vào ENV). |
| **NC-3 → chốt** | **`@Cron` tại `SchedulerService`** → delegate `IotDevicesService.detectOfflineDevices(null)`; `SchedulerModule` import `IotModule`. |
| **NC-4 → chốt** | **Permission `iot.device.probe`** (gán `ADMIN`, `MANAGER`). |
| **NC-5 → chốt** | **Cron gate = `SCHEDULER_ENABLED && DEVICE_OFFLINE_DETECT_ENABLED`**; **Endpoint KHÔNG gate** (admin gọi là chạy). |

---

> Trạng thái: **CHỜ REVIEW**. Chỉ là spec — chưa có tasks.md, chưa code. `plan.md` đã được tạo. Dừng chờ Thiếu Chủ review.
