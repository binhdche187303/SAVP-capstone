---
name: feat-update-iot-device
description: Cập nhật thông tin mô tả/kết nối của một thiết bị IoT/camera đã tồn tại (chỉ device_name, ip_address, mac_address, network_identifier).
category: iot
---

# Feature Specification: Cập nhật thông tin thiết bị IoT/Camera (Update IoT Device)

- **Feature ID**: IOT-011
- **Feature Name**: Cập nhật thông tin thiết bị IoT/camera
- **Feature Table Ref**: #12 — Cập nhật thông tin thiết bị IoT/camera
- **Module / Domain**: iot
- **Created Date**: 2026-06-15
- **Status**: Draft (đã chốt clarifications)
- **Source Documents**:
  - `CLAUDE.md` (Sections 11.1, 11.8, 11.17)
  - `spec/global/constitution.md` (SEC-01..03, ARCH-03, DATA-01)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (Section 8 — IoT Device Management, UC-67/68/69; mục IOT-011 (Feature #12) cho update)
  - `docs/ARCHITECTURE_DECISIONS.md` (ADR-008: status-based device lifecycle)
  - `src/modules/iot/entities/iot-device.entity.ts` (IoTDeviceEntity)
  - Spec liên quan: `spec/features/iot/feat-register-camera-device` (IOT-001), `spec/features/iot/feat-assign-camera-to-room` (IOT-002)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo spec IOT-011: cập nhật thông tin mô tả/kết nối của thiết bị IoT đã tồn tại (PATCH). Thêm các điểm [NEEDS CLARIFICATION] chờ chốt. | Toàn bộ file (bản đầu tiên) |
| 2026-06-15 | Chốt clarifications: rút allowlist còn 4 trường (device_name, ip_address, mac_address, network_identifier); forbidNonWhitelisted=true → 400; bỏ FR soft-delete (dùng status); permission `iot.device.update`; endpoint PATCH `/api/v1/iot-devices/:id`; response full device snake_case. Cập nhật toàn bộ EARS/AC/EC, Out-of-scope, Mục 10 thành "Quyết định đã chốt". | Mục 1.2/1.4, 2.2/2.4/2.5, 3, 4, 5, 7, 8, 9, 10 |
| 2026-06-15 | Sửa nhãn tham chiếu API Contract: "UC-73 update" → "IOT-011 (Feature #12)" do UC-73 đã là "Lưu raw event". Xác nhận permission `iot.device.update` khớp convention seed (dot-notation). | Source Documents (dòng 18), Mục 10 (D-6) |

---

## 1. Giới thiệu

### 1.1 Bối cảnh

Sau khi một thiết bị camera/IoT được đăng ký (IOT-001) và gán vào phòng (IOT-002), các thông tin mô tả và định danh kết nối tổng quát của thiết bị có thể thay đổi theo thời gian: thiết bị được đổi tên cho dễ quản lý, đổi địa chỉ IP do thay đổi cấu hình mạng, hoặc cập nhật MAC/định danh mạng sau khi thay phần cứng. Hệ thống cần một endpoint cho phép quản trị viên cập nhật các trường mô tả/kết nối này trên một bản ghi `iot_devices` đã tồn tại mà **không** tạo lại thiết bị và **không** đụng tới các luồng cấu hình chuyên sâu (RTSP, Face Server) hoặc trạng thái vận hành do hệ thống tự quản.

Khác với các UC cấu hình chuyên biệt (UC-68 Face Server, UC-69 RTSP) và UC gán phòng (IOT-002), UC này chỉ chịu trách nhiệm chỉnh sửa các trường **mô tả và định danh kết nối tổng quát** của thiết bị.

### 1.2 Mục tiêu

Cho phép người dùng có quyền `iot.device.update` cập nhật các trường mô tả/kết nối của một thiết bị IoT đã tồn tại thông qua endpoint `PATCH /api/v1/iot-devices/:id`, đảm bảo:

- Chỉ cập nhật đúng 4 trường thuộc allowlist: `device_name`, `ip_address`, `mac_address`, `network_identifier`.
- Mọi trường ngoài allowlist (bất biến / hệ thống quản lý / thuộc UC khác) bị **từ chối với 400** (`forbidNonWhitelisted = true`).
- Idempotent: gửi lại cùng giá trị không tạo thay đổi dữ liệu thừa.
- Toàn vẹn dữ liệu: kiểm tra trùng lặp `mac_address` (loại trừ chính nó) trước khi ghi.
- Ghi vết audit cho mỗi lần cập nhật, không lộ secret.

### 1.3 Giá trị mang lại

- **Cho quản trị viên**: chỉnh sửa nhanh thông tin thiết bị khi hạ tầng thay đổi, không phải xóa và đăng ký lại (tránh mất `device_code`, lịch sử event).
- **Cho hệ thống**: giữ thông tin kết nối (IP/MAC/network) chính xác để routing và xác thực event hoạt động đúng.

### 1.4 Out-of-scope

Các nội dung sau **không** thuộc phạm vi IOT-011 (đã có UC/endpoint riêng, do hệ thống tự quản, hoặc được defer):

- **Gán/đổi phòng (`room_id`)**: xử lý qua IOT-002 `POST /api/v1/iot-devices/:id/assign-room`. UC này không được sửa `room_id`.
- **Cấu hình RTSP / `stream_url`**: xử lý qua UC-69 `PUT /api/v1/iot-devices/:id/rtsp-config`.
- **Cấu hình Face Server / callback token / secret**: xử lý qua UC-68 `PUT /api/v1/iot-devices/:id/face-server-config`.
- **`agent_version`, `firmware_version`**: do thiết bị tự report qua heartbeat (UC-70). KHÔNG cho sửa tay để tránh xung đột với giá trị heartbeat.
- **`mqtt_topic`**: MQTT out-of-scope ở v1 (CLAUDE.md 11.10). Không đưa vào allowlist tới khi MQTT được kích hoạt.
- **`equipment_id`** (liên kết thiết bị ↔ tài sản): **defer** sang UC riêng (tương tự assign-room), không gộp vào UC này.
- **`metadata_json`**: chứa cấu hình hệ thống/vendor — KHÔNG cho sửa qua UC này để tránh clobber/ghi đè nhầm cấu hình.
- **`status`, `health_status`, `last_seen_at`**: do hệ thống tự quản qua heartbeat/availability. KHÔNG cho sửa tay.
- **`device_code`, `device_type`**: khóa nghiệp vụ / phân loại — **bất biến**.
- Xóa thiết bị, check-health, đăng ký mới.
- MQTT/Mosquitto, IVSS, đọc RTSP stream trực tiếp, face recognition trong backend.

---

## 2. System Context

### 2.1 Actor & Roles

| Actor | Vai trò | Quyền / Trách nhiệm |
|---|---|---|
| Người dùng có permission `iot.device.update` | Người thực hiện cập nhật | Cung cấp giá trị mới hợp lệ cho các trường được phép sửa |
| System | Máy chủ xử lý | Validate input (DTO), kiểm tra tồn tại/trùng lặp, ghi DB trong transaction, ghi audit log |

### 2.2 Role & Permission Rules

- Endpoint yêu cầu xác thực JWT (`JwtAuthGuard`).
- Yêu cầu permission `iot.device.update` (dot-notation — nhất quán với convention seed permissions hiện có và API Contract: `iot.device.create`, `iot.device.configure`).
- `user_id` của người thực hiện lấy từ JWT payload (`sub`), không nhận từ body (SEC-02).

### 2.3 Entity liên quan

| Entity / Table | Vai trò |
|---|---|
| `iot_devices` | Bảng chính bị cập nhật (qua `IoTDeviceEntity`) |
| `audit_logs` | Lưu vết hành động cập nhật (`action_type = 'update'`) |

### 2.4 Trường được phép sửa (allowlist — đã chốt)

| Field (request, snake_case) | Cột entity | Kiểu | Ghi chú validation |
|---|---|---|---|
| `device_name` | `deviceName` | string | not empty, max 150 |
| `ip_address` | `ipAddress` | string\|null | IP format nếu khác null; cho phép null để xóa; không yêu cầu unique |
| `mac_address` | `macAddress` | string\|null | MAC format + normalize; nếu khác null phải unique (loại trừ chính nó); cho phép null để xóa |
| `network_identifier` | `networkIdentifier` | string\|null | max 150; cho phép null |

### 2.5 Trường KHÔNG được phép sửa qua UC này (gửi lên ⇒ 400)

`id`, `device_code`, `device_type` (bất biến); `room_id` (IOT-002); `stream_url` (UC-69); `agent_version`, `firmware_version` (heartbeat tự report); `mqtt_topic` (MQTT out-of-scope); `equipment_id` (defer UC riêng); `metadata_json` (cấu hình hệ thống, tránh clobber); `status`, `health_status`, `last_seen_at` (hệ thống tự quản); `created_at`, `updated_at` (TypeORM quản lý).

---

## 3. Endpoints

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/iot-devices/:id` |
| Auth | `JwtAuthGuard` (Bearer JWT) |
| Permission | `iot.device.update` |
| Async | No |

**Path param:** `id` (uuid, `ParseUUIDPipe`).

**Request Body (partial update — chỉ gửi trường cần đổi, chỉ thuộc allowlist):**
```json
{
  "device_name": "Camera góc phòng họp A — tầng 3",
  "ip_address": "192.168.1.51",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "network_identifier": "ipcam-a3-floor3"
}
```

**Response 200 (full device đã cập nhật, theo `toIotDeviceResponse`, snake_case):**
```json
{
  "success": true,
  "message": "IoT device updated successfully",
  "data": {
    "id": "uuid",
    "device_name": "Camera góc phòng họp A — tầng 3",
    "device_code": "IPCAM-A3-01",
    "device_type": "ip_camera",
    "room_id": "uuid|null",
    "ip_address": "192.168.1.51",
    "mac_address": "AA:BB:CC:DD:EE:FF",
    "status": "online",
    "health_status": "healthy",
    "last_seen_at": "2026-06-15T09:00:00+07:00",
    "metadata_json": { "manufacturer": "Hikvision" },
    "created_at": "2026-06-03T10:00:00+07:00",
    "updated_at": "2026-06-15T09:05:00+07:00"
  }
}
```

> Response dùng **snake_case** nhất quán với `IotDeviceResponseDto`/`toIotDeviceResponse` và spec IOT-001/002. Trường `metadata_json` trong response đã được mask secret bởi `maskSensitiveMetadata` (dù UC này không cho sửa metadata).

---

## 4. Validation Flow

```text
1. JwtAuthGuard xác thực token → lấy user_id từ JWT (sub). Thiếu/sai token → 401.
2. PermissionsGuard kiểm tra quyền iot.device.update. Thiếu quyền → 403.
3. ParseUUIDPipe validate :id. Sai UUID → 400.
4. ValidationPipe (whitelist=true, forbidNonWhitelisted=true, transform=true) validate DTO:
   - Bất kỳ field nào ngoài allowlist (device_name, ip_address, mac_address, network_identifier) → 400.
   - Sai định dạng (IP/MAC/length) → 400.
5. Load thiết bị theo :id. Không tồn tại → 404 (IOT_DEVICE_NOT_FOUND).
6. Nếu body rỗng (không có trường allowlist nào) → 400 (NO_UPDATABLE_FIELDS).
7. Nếu có mac_address khác null & khác giá trị hiện tại → normalize + kiểm tra trùng (loại trừ chính nó). Trùng → 409 (MAC_ADDRESS_EXISTS).
8. So sánh giá trị mới với giá trị hiện tại (idempotent): nếu không có thay đổi thực → 200, không ghi DB, không ghi audit mới.
9. Trong 1 transaction: cập nhật iot_devices + ghi audit_logs (action_type='update', metadata = danh sách field đã đổi).
10. Trả về 200 với device đã cập nhật (metadata_json được mask trong response).
```

---

## 5. Functional Requirements (EARS)

### 5.1 Core

```text
FR-IOT-011-001: THE system SHALL cung cấp endpoint PATCH /api/v1/iot-devices/:id để cập nhật các trường mô tả/kết nối của một thiết bị IoT đã tồn tại.
FR-IOT-011-002: THE system SHALL chỉ chấp nhận và cập nhật các trường thuộc allowlist: device_name, ip_address, mac_address, network_identifier.
FR-IOT-011-003: WHEN payload chứa bất kỳ trường nào ngoài allowlist (bao gồm device_code, device_type, room_id, stream_url, status, health_status, last_seen_at, agent_version, firmware_version, mqtt_topic, equipment_id, metadata_json), THE system SHALL từ chối request với 400 (VALIDATION_ERROR) do forbidNonWhitelisted=true.
FR-IOT-011-004: WHEN tất cả dữ liệu hợp lệ và có ít nhất một thay đổi thực, THE system SHALL ghi giá trị mới vào iot_devices và trả về 200 cùng bản ghi đã cập nhật (full device).
```

### 5.2 Idempotency (ARCH-03)

```text
FR-IOT-011-005: IF tất cả giá trị gửi lên trùng khớp với giá trị hiện tại của thiết bị, THEN THE system SHALL trả về 200 OK, KHÔNG thay đổi dữ liệu và KHÔNG ghi audit log mới.
FR-IOT-011-006: THE system SHALL đảm bảo việc gọi lặp lại cùng một request hợp lệ cho ra cùng một trạng thái tài nguyên (PATCH idempotent).
```

### 5.3 Data Integrity

```text
FR-IOT-011-007: WHEN payload chứa mac_address khác null và khác giá trị hiện tại, THE system SHALL normalize format và kiểm tra trùng lặp trên iot_devices (loại trừ chính thiết bị đang cập nhật); IF trùng THEN trả về 409 (MAC_ADDRESS_EXISTS).
FR-IOT-011-008: WHEN payload chứa ip_address khác null, THE system SHALL validate IP format nhưng SHALL NOT yêu cầu unique.
FR-IOT-011-009: WHEN payload đặt một trường allowlist (ip_address, mac_address, network_identifier) bằng null, THE system SHALL xóa giá trị tương ứng (set NULL) cho trường đó.
```

### 5.4 State / Lifecycle

```text
FR-IOT-011-010: THE system SHALL không thay đổi status/health_status/last_seen_at của thiết bị như một hệ quả của thao tác cập nhật này.
FR-IOT-011-011: THE system SHALL cho phép cập nhật thiết bị ở bất kỳ status nào (online/offline/disabled/maintenance), vì đây là các trường mô tả độc lập với trạng thái vận hành. (Vòng đời "vô hiệu hóa" thiết bị dùng status, không dùng soft-delete — xem ADR-008.)
```

### 5.5 Authorization (SEC-02)

```text
FR-IOT-011-012: IF request không có JWT hợp lệ, THEN THE system SHALL trả về 401 (UNAUTHORIZED).
FR-IOT-011-013: IF người dùng không có quyền iot.device.update, THEN THE system SHALL trả về 403 (FORBIDDEN) và không thay đổi dữ liệu.
FR-IOT-011-014: THE system SHALL lấy actor user_id từ JWT payload (sub), KHÔNG nhận từ request body.
```

### 5.6 Audit

```text
FR-IOT-011-015: WHEN một cập nhật làm thay đổi dữ liệu thành công, THE system SHALL ghi một bản ghi audit_logs với action_type='update', entity_type='iot_devices', entity_id=<device id>, user_id=<actor>, và metadata_json mô tả danh sách field đã đổi (old/new value của các trường allowlist).
FR-IOT-011-016: THE system SHALL đảm bảo cập nhật iot_devices và ghi audit_logs nằm trong cùng một database transaction; IF ghi audit thất bại THEN rollback toàn bộ.
FR-IOT-011-017: THE system SHALL không ghi secret/token/password ra audit_logs hay log (SEC-01). (Các trường allowlist hiện tại không chứa secret; metadata_json không thuộc UC này.)
```

---

## 6. Non-functional Requirements (EARS)

```text
NFR-IOT-011-001 (Performance): THE system SHALL phản hồi thao tác cập nhật < 500ms ở điều kiện mạng bình thường.
NFR-IOT-011-002 (Security): THE system SHALL NOT log secret/token/password ra console/file (SEC-01).
NFR-IOT-011-003 (Security): THE system SHALL validate toàn bộ input qua DTO class-validator tại boundary, whitelist=true & forbidNonWhitelisted=true (SEC-03).
NFR-IOT-011-004 (Consistency): Error response SHALL tuân theo format chuẩn dự án ({ success:false, message, error:{ code, details }, timestamp, path }).
NFR-IOT-011-005 (Reliability): Cập nhật nhiều trường SHALL atomic — hoặc tất cả thay đổi được ghi, hoặc không thay đổi nào được ghi.
NFR-IOT-011-006 (Persistence): THE system SHALL dùng TypeORM cho mọi truy cập DB; KHÔNG dùng Prisma; KHÔNG sửa schema/entity ngoài baseline.
NFR-IOT-011-007 (Observability): THE system SHALL ghi error log (kèm stack trace nội bộ, ẩn với client) cho lỗi 500.
```

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-IOT-011-001:
- Given một thiết bị IoT đã tồn tại và người dùng có quyền iot.device.update,
- When gửi PATCH /api/v1/iot-devices/:id với { device_name mới, ip_address mới } hợp lệ,
- Then hệ thống trả về 200 OK với full device đã cập nhật, và ghi 1 audit_logs action_type='update'.
```

### 7.2 Idempotent

```text
AC-IOT-011-002:
- Given một thiết bị có device_name = "Cam A",
- When gửi PATCH với device_name = "Cam A" (trùng giá trị hiện tại),
- Then hệ thống trả về 200 OK, không thay đổi dữ liệu và không ghi audit log mới.
```

### 7.3 MAC trùng lặp

```text
AC-IOT-011-003:
- Given thiết bị X đang dùng mac_address "00:1A:2B:3C:4D:5E",
- When cập nhật thiết bị Y với mac_address "00:1a:2b:3c:4d:5e" (khác hoa/thường),
- Then hệ thống trả về 409 MAC_ADDRESS_EXISTS và không thay đổi thiết bị Y.
```

### 7.4 Từ chối trường ngoài allowlist

```text
AC-IOT-011-004:
- Given một thiết bị có device_code = "IPCAM-01", status = "online",
- When payload gửi kèm bất kỳ trường ngoài allowlist (vd device_code, device_type, status, room_id, metadata_json, firmware_version),
- Then hệ thống trả về 400 VALIDATION_ERROR (forbidNonWhitelisted) và không thay đổi dữ liệu.
```

### 7.5 Authorization

```text
AC-IOT-011-005:
- Given người dùng không có quyền iot.device.update,
- When gọi PATCH /api/v1/iot-devices/:id,
- Then hệ thống trả về 403 Forbidden và không thay đổi dữ liệu.
```

### 7.6 Xóa giá trị bằng null

```text
AC-IOT-011-006:
- Given một thiết bị đang có ip_address = "192.168.1.51",
- When gửi PATCH với ip_address = null,
- Then hệ thống set ip_address = NULL, trả về 200 và ghi audit_logs action_type='update'.
```

---

## 8. Edge / Error Cases (EARS)

```text
EC-IOT-011-001: IF :id không đúng định dạng UUID, THEN trả về 400 (VALIDATION_ERROR).
EC-IOT-011-002: IF không tìm thấy thiết bị theo :id, THEN trả về 404 (IOT_DEVICE_NOT_FOUND).
EC-IOT-011-003: IF payload không chứa trường allowlist nào (body rỗng), THEN trả về 400 (NO_UPDATABLE_FIELDS).
EC-IOT-011-004: IF payload chứa trường ngoài allowlist, THEN trả về 400 (VALIDATION_ERROR) do forbidNonWhitelisted=true.
EC-IOT-011-005: IF ip_address sai định dạng IP, THEN trả về 400 (VALIDATION_ERROR).
EC-IOT-011-006: IF mac_address sai định dạng MAC, THEN trả về 400 (VALIDATION_ERROR).
EC-IOT-011-007: IF device_name rỗng hoặc vượt quá 150 ký tự, THEN trả về 400 (VALIDATION_ERROR).
EC-IOT-011-008: IF xảy ra lỗi DB khi ghi, THEN rollback transaction và trả về 500 (INTERNAL_SERVER_ERROR), không ghi audit một phần.
```

### 8.1 Error Code Map

| HTTP | Error Code | Kịch bản |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Sai UUID/IP/MAC/length, hoặc gửi field ngoài allowlist |
| 400 | `NO_UPDATABLE_FIELDS` | Body rỗng, không có trường allowlist nào để cập nhật |
| 401 | `UNAUTHORIZED` | Thiếu/sai/hết hạn JWT |
| 403 | `FORBIDDEN` | Thiếu quyền `iot.device.update` |
| 404 | `IOT_DEVICE_NOT_FOUND` | Không tìm thấy thiết bị theo :id |
| 409 | `MAC_ADDRESS_EXISTS` | mac_address mới trùng thiết bị khác |
| 500 | `INTERNAL_SERVER_ERROR` | Lỗi hệ thống/DB |

---

## 9. Traceability

| Requirement | EARS Pattern | Nguồn / Ràng buộc |
|---|---|---|
| FR-IOT-011-001..004 | Ubiquitous / Unwanted / Event | Feature #12; CLAUDE.md 22.7; SEC-03 (forbidNonWhitelisted) |
| FR-IOT-011-005..006 | State / Unwanted | Constitution ARCH-03 (idempotent) |
| FR-IOT-011-007..009 | Event | IOT-001 FR-005 (MAC unique); entity fields |
| FR-IOT-011-010..011 | State | Out-of-scope status; ADR-008 (status-based lifecycle) |
| FR-IOT-011-012..014 | Unwanted | Constitution SEC-02 |
| FR-IOT-011-015..017 | Event / Unwanted | IOT-002 audit pattern; SEC-01 |
| NFR-IOT-011-001..007 | — | Constitution NFR; SEC-01/03 |

---

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| D-1 | **Allowlist** rút còn 4 trường: `device_name`, `ip_address`, `mac_address`, `network_identifier`. Loại `agent_version`/`firmware_version` (heartbeat), `mqtt_topic` (MQTT out-of-scope), `equipment_id` (defer UC riêng), `metadata_json` (cấu hình hệ thống, tránh clobber). |
| D-2 | **`forbidNonWhitelisted = true`** → field ngoài allowlist hoặc field bất biến ⇒ **400**. |
| D-3 | **`device_code`, `device_type`** bất biến; `room_id`, `stream_url`, `status`/`health_status`/`last_seen_at`, `metadata_json` ngoài phạm vi. |
| D-4 | **Bỏ FR soft-delete**: `iot_devices` không có `deleted_at`; vòng đời "vô hiệu hóa" dùng `status` (online/offline/disabled/maintenance). Ghi nhận tại **ADR-008** trong `docs/ARCHITECTURE_DECISIONS.md`. |
| D-5 | **Permission**: `iot.device.update` (dot-notation, khớp convention seed permissions + API Contract). |
| D-6 | **Endpoint**: `PATCH /api/v1/iot-devices/:id`. Đã thêm mục IOT-011 (Feature #12) vào `docs/API_CONTRACT_v1.0_with_system_roles.md`. |
| D-7 | **Response**: full device, snake_case (`toIotDeviceResponse`). |
| D-8 | **mac_address** cho sửa, re-check unique loại trừ chính nó; cho phép `null` để xóa. Tương tự `ip_address`, `network_identifier` cho phép `null`. |

---

> Trạng thái: **CHỜ REVIEW**. Chỉ là spec — chưa có plan.md/tasks.md, chưa code. Sẽ dừng tại đây chờ Thiếu Chủ review.
