---
name: feat-disable-enable-iot-device
description: Vô hiệu hóa (disable) và kích hoạt lại (enable) thiết bị IoT/camera bằng status, không hard-delete (ADR-008).
category: iot
---

# Feature Specification: Vô hiệu hóa / Kích hoạt lại thiết bị IoT/Camera (Disable / Re-enable IoT Device)

- **Feature ID**: IOT-012
- **Feature Name**: Vô hiệu hóa / kích hoạt lại thiết bị IoT/camera
- **Feature Table Ref**: #13 — Disable/Re-enable thiết bị IoT/Camera
- **Module / Domain**: iot
- **Created Date**: 2026-06-15
- **Status**: Draft (đã chốt clarifications)
- **Source Documents**:
  - `CLAUDE.md` (Sections 7.3 API route, 11.1, 11.8)
  - `spec/global/constitution.md` (SEC-01..03, ARCH-03, DATA-01)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (Section 8 — IoT Device Management; IoT Device Status `online|offline|disabled|maintenance`)
  - `docs/ARCHITECTURE_DECISIONS.md` (ADR-008: status-based device lifecycle)
  - `src/modules/iot/entities/iot-device.entity.ts` (IoTDeviceEntity, IoTDeviceStatus)
  - Spec liên quan: `spec/features/iot/feat-update-iot-device` (IOT-011), `spec/features/iot/feat-register-camera-device` (IOT-001)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo spec IOT-012: 2 endpoint disable/enable (PATCH, không body) theo các quyết định đã chốt; soft theo ADR-008. | Toàn bộ file (bản đầu tiên) |
| 2026-06-15 | Chốt NC-1..3: ĐỔI **PATCH → POST** cho cả 2 action endpoint (khớp convention action-endpoint dự án); giữ 2 permission tách; enable từ `maintenance` = no-op. Sửa response example (`health_status` giữ giá trị cũ) + note không đổi health/last_seen/room. Mục 11 → đã chốt. | Mục 1.2, 3, 4, 5 (FR-001/004), 7, 11 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh

Một thiết bị IoT/camera đã đăng ký (IOT-001) đôi khi cần được tạm ngừng sử dụng: gửi đi bảo hành, ngừng hoạt động tạm thời, hoặc nghi ngờ lỗi/bảo mật — mà **không** muốn xóa bản ghi (giữ `device_code`, lịch sử `iot_device_events`, audit). Theo **ADR-008**, vòng đời "vô hiệu hóa" của `iot_devices` được quản lý bằng cột **`status`** (không dùng soft-delete `deleted_at`, không hard-delete). IOT-012 cung cấp 2 hành động trạng thái: **disable** (đưa về `disabled`) và **enable** (kích hoạt lại về `offline`).

Khác với IOT-011 (sửa trường mô tả/kết nối), IOT-012 chỉ thay đổi **trạng thái vận hành** của thiết bị thông qua 2 hành động chuyên biệt, không nhận body.

### 1.2 Mục tiêu

Cho phép người dùng có quyền tương ứng:
- **Disable**: `POST /api/v1/iot-devices/:id/disable` → đặt `status = disabled`.
- **Enable**: `POST /api/v1/iot-devices/:id/enable` → đưa thiết bị `disabled` trở lại `offline` (chờ heartbeat/availability cập nhật `online` sau).

Đảm bảo:
- Idempotent: gọi lại hành động khi trạng thái đã đúng đích → 200 no-op, không ghi DB, không audit.
- Soft theo ADR-008: không hard-delete, không tạo `deleted_at`, giữ nguyên `iot_device_events`.
- Ghi vết audit cho mỗi lần đổi trạng thái thực; không lộ secret.
- Không chạm `health_status`, `last_seen_at`, `room_id`, `metadata_json`.

### 1.3 Giá trị mang lại

- **Cho quản trị viên**: tạm ngừng/khôi phục thiết bị an toàn, không mất lịch sử/định danh.
- **Cho hệ thống**: `status = disabled` là tín hiệu rõ ràng để các luồng khác (vd assign-room ở IOT-002 đã chặn `disabled`) bỏ qua thiết bị; khi enable lại thì vào `offline` chờ heartbeat.

### 1.4 Out-of-scope

Các nội dung sau **không** thuộc phạm vi IOT-012:

- **Hard-delete / xóa bản ghi** thiết bị; tạo cột `deleted_at` (trái ADR-008 / DATA-01).
- **Cascade xóa `iot_device_events`** hay bất kỳ dữ liệu liên quan.
- **Gỡ gán phòng (`room_id`)** khi disable — giữ nguyên gán phòng.
- **Bulk disable/enable** nhiều thiết bị trong một request.
- **Trạng thái `maintenance`** (đặt/gỡ bảo trì) — hành động riêng, không thuộc UC này.
- **Tự động phát hiện offline** qua heartbeat (do hệ thống tự quản, không phải hành động tay).
- **Lý do (reason)** khi disable/enable — không nhận body, không lưu reason ở UC này.
- Sửa trường mô tả/kết nối (đó là IOT-011); cấu hình RTSP/Face Server (UC-69/UC-68).

---

## 2. System Context

### 2.1 Actor & Roles

| Actor | Vai trò | Quyền / Trách nhiệm |
|---|---|---|
| Người dùng có `iot.device.disable` | Người vô hiệu hóa thiết bị | Gọi endpoint disable |
| Người dùng có `iot.device.enable` | Người kích hoạt lại thiết bị | Gọi endpoint enable |
| System | Máy chủ xử lý | Validate, đổi `status` trong transaction, ghi audit |

### 2.2 Role & Permission Rules

- Cả 2 endpoint yêu cầu xác thực JWT (`JwtAuthGuard`).
- **disable** yêu cầu permission `iot.device.disable`; **enable** yêu cầu `iot.device.enable` (dot-notation — nhất quán convention seed + API Contract).
- `user_id` lấy từ JWT payload (`sub`), không nhận từ body (SEC-02).
- Guard quyền dùng pattern mock như IOT-011 (`MockPermissionsGuard` + `@Permissions(...)`) — enforce runtime thật là task team-wide riêng.

### 2.3 Entity liên quan

| Entity / Table | Vai trò |
|---|---|
| `iot_devices` | Bảng chính, chỉ đổi cột `status` |
| `audit_logs` | Lưu vết đổi trạng thái (`action_type = 'disable' | 'enable'`) |

### 2.4 State Model (cột `status`)

| Status | Ý nghĩa |
|---|---|
| `online` | Thiết bị đang gửi tín hiệu (do heartbeat) |
| `offline` | Chưa/không có tín hiệu; trạng thái sau khi enable |
| `disabled` | Đã vô hiệu hóa thủ công (đích của disable) |
| `maintenance` | Bảo trì (ngoài phạm vi UC này) |

**Chuyển trạng thái của IOT-012:**

| Hành động | Từ status | Sang status | Audit |
|---|---|---|---|
| disable | `online` / `offline` / `maintenance` | `disabled` | có |
| disable | `disabled` | (không đổi) | không (no-op 200) |
| enable | `disabled` | `offline` | có |
| enable | `online` / `offline` / `maintenance` | (không đổi) | không (no-op 200) |

> Trường KHÔNG đụng ở cả 2 hành động: `health_status`, `last_seen_at`, `room_id`, `metadata_json`, `device_code`, `device_type`, các trường mô tả/kết nối.

---

## 3. Endpoints

### 3.1 Disable

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/iot-devices/:id/disable` |
| Auth | `JwtAuthGuard` (Bearer JWT) |
| Permission | `iot.device.disable` |
| Body | (không) |
| Async | No |

### 3.2 Enable

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/iot-devices/:id/enable` |
| Auth | `JwtAuthGuard` (Bearer JWT) |
| Permission | `iot.device.enable` |
| Body | (không) |
| Async | No |

**Path param (cả 2):** `id` (uuid, `ParseUUIDPipe`).

**Response 200 (full device, snake_case — theo `toIotDeviceResponse`):**
```json
{
  "success": true,
  "message": "IoT device disabled successfully",
  "data": {
    "id": "uuid",
    "device_name": "Camera góc phòng họp A",
    "device_code": "IPCAM-A3-01",
    "device_type": "ip_camera",
    "room_id": "uuid|null",
    "ip_address": "192.168.1.51",
    "mac_address": "AA:BB:CC:DD:EE:FF",
    "status": "disabled",
    "health_status": "healthy",
    "last_seen_at": "2026-06-15T09:00:00+07:00",
    "metadata_json": { "manufacturer": "Hikvision" },
    "created_by_name": null,
    "created_at": "2026-06-03T10:00:00+07:00",
    "updated_at": "2026-06-15T10:00:00+07:00"
  }
}
```
> **Lưu ý**: disable/enable **CHỈ** đổi `status`; **KHÔNG** đổi `health_status`, `last_seen_at`, `room_id`, `metadata_json` — các trường này giữ nguyên giá trị cũ (ví dụ trên `health_status` vẫn `"healthy"` từ trước khi disable). Enable trả `status: "offline"` và message `"IoT device enabled successfully"`. `metadata_json` được mask secret bởi `maskSensitiveMetadata`.

---

## 4. Validation / State Flow

```text
[Disable]  POST /api/v1/iot-devices/:id/disable
1. JwtAuthGuard → user_id từ JWT (sub). Thiếu/sai → 401.
2. PermissionsGuard kiểm tra iot.device.disable. Thiếu → 403.
3. ParseUUIDPipe validate :id. Sai UUID → 400.
4. Load device theo :id. Không tồn tại → 404 (IOT_DEVICE_NOT_FOUND).
5. Nếu status === 'disabled' → 200 no-op (không transaction, không audit), trả device hiện tại.
6. Ngược lại: trong 1 transaction → set status='disabled' → logDeviceStatusChange(action='disable', {status:{old,new}}) → commit.
7. Trả 200 full device (status='disabled').

[Enable]   POST /api/v1/iot-devices/:id/enable
1..4. Như trên nhưng permission iot.device.enable.
5. Nếu status !== 'disabled' → 200 no-op (không transaction, không audit), trả device hiện tại.
6. Nếu status === 'disabled': transaction → set status='offline' → logDeviceStatusChange(action='enable', {status:{old:'disabled',new:'offline'}}) → commit.
7. Trả 200 full device (status='offline').
```

---

## 5. Functional Requirements (EARS)

### 5.1 Core — Disable

```text
FR-IOT-012-001: THE system SHALL cung cấp endpoint POST /api/v1/iot-devices/:id/disable (không body) để vô hiệu hóa thiết bị.
FR-IOT-012-002: WHEN thiết bị có status khác 'disabled', THE system SHALL đặt status='disabled' và trả 200 cùng full device.
FR-IOT-012-003: IF thiết bị đã ở status 'disabled', THEN THE system SHALL trả 200 no-op, KHÔNG thay đổi dữ liệu và KHÔNG ghi audit log mới.
```

### 5.2 Core — Enable

```text
FR-IOT-012-004: THE system SHALL cung cấp endpoint POST /api/v1/iot-devices/:id/enable (không body) để kích hoạt lại thiết bị.
FR-IOT-012-005: WHEN thiết bị có status === 'disabled', THE system SHALL đặt status='offline' và trả 200 cùng full device.
FR-IOT-012-006: IF thiết bị có status khác 'disabled', THEN THE system SHALL trả 200 no-op, KHÔNG thay đổi dữ liệu và KHÔNG ghi audit log mới.
```

### 5.3 Lifecycle (ADR-008)

```text
FR-IOT-012-007: THE system SHALL chỉ thay đổi cột status; SHALL NOT chạm health_status, last_seen_at, room_id, metadata_json, device_code, device_type, hay các trường mô tả/kết nối.
FR-IOT-012-008: THE system SHALL NOT hard-delete bản ghi, SHALL NOT tạo/ghi cột deleted_at, và SHALL NOT xóa hay cascade iot_device_events (soft theo ADR-008).
FR-IOT-012-009: THE system SHALL giữ nguyên gán phòng (room_id) khi disable hoặc enable.
```

### 5.4 Idempotency (ARCH-03)

```text
FR-IOT-012-010: THE system SHALL đảm bảo disable và enable là idempotent: gọi lặp lại khi trạng thái đã ở đích cho ra cùng trạng thái tài nguyên, không tạo audit thừa.
```

### 5.5 Authorization (SEC-02)

```text
FR-IOT-012-011: IF request không có JWT hợp lệ, THEN THE system SHALL trả 401 (UNAUTHORIZED).
FR-IOT-012-012: IF người dùng không có quyền tương ứng (iot.device.disable cho disable, iot.device.enable cho enable), THEN THE system SHALL trả 403 (FORBIDDEN) và không thay đổi dữ liệu.
FR-IOT-012-013: THE system SHALL lấy actor user_id từ JWT payload (sub), KHÔNG nhận từ request body.
```

### 5.6 Audit

```text
FR-IOT-012-014: WHEN một disable/enable làm thay đổi status thành công, THE system SHALL ghi audit_logs qua logDeviceStatusChange với action_type ∈ {'disable','enable'}, entity_type='iot_devices', entity_id=<device id>, user_id=<actor>, metadata_json.changed_fields.status = { old, new }.
FR-IOT-012-015: THE system SHALL đảm bảo cập nhật status và ghi audit_logs nằm trong cùng một database transaction; IF ghi audit thất bại THEN rollback toàn bộ.
FR-IOT-012-016: THE system SHALL NOT ghi secret/token/password ra audit_logs hay log (SEC-01).
```

---

## 6. Non-functional Requirements (EARS)

```text
NFR-IOT-012-001 (Performance): THE system SHALL phản hồi mỗi hành động < 500ms ở điều kiện mạng bình thường.
NFR-IOT-012-002 (Security): THE system SHALL NOT log secret/token/password ra console/file (SEC-01).
NFR-IOT-012-003 (Consistency): Error response SHALL theo format chuẩn dự án ({ success:false, message, error:{ code, details }, timestamp, path }).
NFR-IOT-012-004 (Reliability): Đổi status + audit SHALL atomic — hoặc cả hai được ghi, hoặc không gì được ghi.
NFR-IOT-012-005 (Persistence): THE system SHALL dùng TypeORM; KHÔNG Prisma; KHÔNG sửa schema/entity ngoài baseline (DATA-01).
NFR-IOT-012-006 (Observability): THE system SHALL ghi error log (stack trace nội bộ, ẩn với client) cho lỗi 500.
```

---

## 7. Acceptance Criteria

```text
AC-IOT-012-001 (disable happy):
- Given thiết bị status='online' và người dùng có iot.device.disable,
- When POST /api/v1/iot-devices/:id/disable,
- Then 200, status='disabled', ghi 1 audit_logs action_type='disable'.

AC-IOT-012-002 (disable idempotent):
- Given thiết bị status='disabled',
- When POST .../disable,
- Then 200 no-op, không đổi dữ liệu, không audit mới.

AC-IOT-012-003 (enable happy):
- Given thiết bị status='disabled' và người dùng có iot.device.enable,
- When POST /api/v1/iot-devices/:id/enable,
- Then 200, status='offline', ghi 1 audit_logs action_type='enable'.

AC-IOT-012-004 (enable no-op khi không disabled):
- Given thiết bị status='online',
- When POST .../enable,
- Then 200 no-op, status vẫn 'online', không audit mới.

AC-IOT-012-005 (không chạm health/last_seen/room):
- Given thiết bị status='online', health_status='healthy', last_seen_at=T, room_id=R,
- When disable,
- Then status='disabled' nhưng health_status/last_seen_at/room_id giữ nguyên.

AC-IOT-012-006 (authorization):
- Given người dùng thiếu quyền tương ứng,
- When gọi disable hoặc enable,
- Then 403 Forbidden, không thay đổi dữ liệu.
```

---

## 8. Edge / Error Cases (EARS)

```text
EC-IOT-012-001: IF :id không đúng định dạng UUID, THEN trả 400 (VALIDATION_ERROR).
EC-IOT-012-002: IF không tìm thấy thiết bị theo :id, THEN trả 404 (IOT_DEVICE_NOT_FOUND).
EC-IOT-012-003: IF request gửi kèm body, THEN body bị bỏ qua (endpoint không định nghĩa DTO body); hành động vẫn xử lý theo trạng thái.
EC-IOT-012-004: IF lỗi DB khi ghi, THEN rollback transaction và trả 500 (INTERNAL_SERVER_ERROR), không ghi audit một phần.
```

### 8.1 Error Code Map

| HTTP | Error Code | Kịch bản |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Sai UUID `:id` |
| 401 | `UNAUTHORIZED` | Thiếu/sai/hết hạn JWT |
| 403 | `FORBIDDEN` | Thiếu quyền `iot.device.disable` / `iot.device.enable` |
| 404 | `IOT_DEVICE_NOT_FOUND` | Không tìm thấy thiết bị theo :id |
| 500 | `INTERNAL_SERVER_ERROR` | Lỗi hệ thống/DB |

---

## 9. Traceability

| Requirement | EARS Pattern | Nguồn / Ràng buộc |
|---|---|---|
| FR-IOT-012-001..003 | Ubiquitous / Event / State | Feature #13; ADR-008 |
| FR-IOT-012-004..006 | Ubiquitous / Event / State | Feature #13; ADR-008 |
| FR-IOT-012-007..009 | Unwanted / State | ADR-008; DATA-01; Out-of-scope |
| FR-IOT-012-010 | State | Constitution ARCH-03 (idempotent) |
| FR-IOT-012-011..013 | Unwanted | Constitution SEC-02 |
| FR-IOT-012-014..016 | Event / Unwanted | IOT-011 audit pattern; SEC-01 |
| NFR-IOT-012-001..006 | — | Constitution NFR; SEC-01/03; DATA-01 |

---

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| D-1 | **2 endpoint không body**: `POST /api/v1/iot-devices/:id/disable` và `POST /api/v1/iot-devices/:id/enable` (xem NC-1 vòng 2). `:id` qua `ParseUUIDPipe`. |
| D-2 | **disable**: `status → disabled`; đã `disabled` → 200 no-op (không ghi/audit); không chạm `health_status`/`last_seen_at`/`room_id`/`metadata_json`. |
| D-3 | **enable**: `disabled → offline` (+audit); status khác `disabled` → 200 no-op; không chạm `health_status`/`last_seen_at`/`room_id`. |
| D-4 | **Soft theo ADR-008**: không hard-delete, không `deleted_at`, giữ `iot_device_events`. |
| D-5 | **Audit** `logDeviceStatusChange` (action_type `disable`|`enable`, `changed_fields.status` old/new, không secret). |
| D-6 | **Permission**: `iot.device.disable` + `iot.device.enable` (2 quyền tách biệt); guard mock như IOT-011. |
| D-7 | **Response**: full device, snake_case (`toIotDeviceResponse`). |
| D-8 | **Lỗi**: 404 `IOT_DEVICE_NOT_FOUND`; sai UUID → 400. |
| D-9 | **Out-of-scope**: hard delete, cascade events, gỡ room, bulk, maintenance, offline auto-detect, reason. |

---

## 11. Quyết định bổ sung đã chốt (vòng 2)

| # | Quyết định |
|---|---|
| **NC-1 → chốt** | **HTTP method = `POST`** cho cả 2 action endpoint (`POST /:id/disable`, `POST /:id/enable`), khớp convention action-endpoint của dự án (CLAUDE.md §7.3; `POST /rooms/:id/release`, `POST /live-meetings/:id/start`). |
| **NC-2 → chốt** | **Giữ 2 permission tách biệt**: `iot.device.disable` + `iot.device.enable` (không gộp `status_change`, không tái dùng `iot.device.update`). |
| **NC-3 → chốt** | **enable từ `maintenance` = no-op 200**: enable chỉ chuyển khi đang `disabled`; `maintenance` được quản lý bởi UC bảo trì riêng. |

---

> Trạng thái: **CHỜ REVIEW**. Chỉ là spec — chưa có tasks.md, chưa code. `plan.md` đã được tạo. Dừng chờ Thiếu Chủ review.
