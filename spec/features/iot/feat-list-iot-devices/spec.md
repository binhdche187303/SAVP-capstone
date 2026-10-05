---
name: feat-list-iot-devices
description: Liệt kê (list + filter + phân trang) và xem chi tiết thiết bị IoT/camera. Read-only, snake_case.
category: iot
---

# Feature Specification: Liệt kê & Xem chi tiết thiết bị IoT/Camera (List + Detail IoT Devices)

- **Feature ID**: IOT-013
- **Feature Name**: Liệt kê & xem chi tiết thiết bị IoT/camera
- **Feature Table Ref**: #14 — List + Detail thiết bị IoT/Camera
- **Module / Domain**: iot
- **Created Date**: 2026-06-15
- **Status**: Draft (đã chốt clarifications)
- **Source Documents**:
  - `CLAUDE.md` (Sections 8.1 response format, 8.4 pagination, 11.1)
  - `spec/global/constitution.md` (SEC-02/03, ARCH-03, DATA-01, API consistency)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (Section 8 — IoT Device Management)
  - `src/modules/iot/entities/iot-device.entity.ts` (IoTDeviceEntity, IoTDeviceType, IoTDeviceStatus)
  - `src/modules/iot/dto/iot-device-response.dto.ts` (toIotDeviceResponse)
  - Spec liên quan: `feat-update-iot-device` (IOT-011), `feat-disable-enable-iot-device` (IOT-012), `feat-register-camera-device` (IOT-001)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo spec IOT-013: GET list (filter + phân trang) + GET detail. Read-only, snake_case. Ghi kết quả verify phân trang (chưa có convention code) + [NC] casing meta. | Toàn bộ file (bản đầu tiên) |
| 2026-06-15 | Chốt NC-1..3: `meta` **camelCase** (`totalPages`) theo CLAUDE.md §8.4, `data[]` snake_case; `limit>100`→400; sort cố định `created_at DESC` (không sortBy/sortOrder v1). Mục 11 → đã chốt. | §2.1, §3.1, FR-005, AC-001/004, EC-004/006, Mục 11 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh

Sau khi thiết bị được đăng ký (IOT-001), cập nhật (IOT-011), gán phòng (IOT-002), disable/enable (IOT-012), quản trị viên cần một màn hình tra cứu: liệt kê toàn bộ thiết bị IoT/camera (có lọc theo trạng thái, loại, phòng, từ khóa) và xem chi tiết một thiết bị. Đây là 2 endpoint **read-only** phục vụ dashboard/quản lý.

### 1.2 Mục tiêu

Cung cấp 2 endpoint cho người dùng có quyền `iot.device.read`:
- **List**: `GET /api/v1/iot-devices` — danh sách phân trang, lọc theo `status`/`device_type`/`room_id`/`search`, sắp xếp `created_at DESC`.
- **Detail**: `GET /api/v1/iot-devices/:id` — chi tiết một thiết bị.

Đảm bảo:
- Trả về **mọi** thiết bị bất kể `status` (kể cả `disabled`); `status` filter chỉ để thu hẹp khi cần.
- Response `data` snake_case theo `toIotDeviceResponse` (mask secret trong `metadata_json`).
- Read-only: KHÔNG ghi DB, KHÔNG audit.

### 1.3 Giá trị mang lại

- **Cho quản trị viên**: tra cứu nhanh tình trạng/định danh thiết bị, lọc theo phòng/loại/trạng thái.
- **Cho frontend**: nguồn dữ liệu cho bảng quản lý thiết bị + trang chi tiết.

### 1.4 Out-of-scope

- **Bulk operations** (xóa/disable hàng loạt) — không thuộc UC đọc.
- **Export** (CSV/Excel) — qua `background_jobs` + `media_files` ở UC riêng.
- **Nhúng `iot_device_events`** vào detail — danh sách event có endpoint riêng (`GET /iot-devices/:id/events`).
- **Realtime/WebSocket** cập nhật danh sách — ngoài phạm vi.
- **Cursor/keyset pagination** — chỉ offset (`page`/`limit`) ở UC này.
- **Full-text search** — `search` chỉ ILIKE trên `device_name`/`device_code`, không full-text/fuzzy.
- Tạo/sửa/đổi trạng thái thiết bị (đó là IOT-001/011/012).

---

## 2. System Context

### 2.1 Kết quả VERIFY convention phân trang (đã rà code)

| Hạng mục | Phát hiện |
|---|---|
| Pagination DTO/util dùng chung | **KHÔNG có** (`src/common` không có `PaginationQueryDto`/util phân trang). |
| List endpoint offset (`page`/`limit` + tổng trang) hiện hữu | **KHÔNG có** trong code. `MyScheduleQueryDto` (meetings) là **date-range**, không phân trang offset. `users`/`audit-logs` controller không có list phân trang. |
| Shape `total_pages`/`totalPages` trong code | **KHÔNG xuất hiện** ở `src/` (grep rỗng). |
| Convention tài liệu | `CLAUDE.md §8.1` quy định success format `{ success, message, data, meta }`; `§8.4` quy định query `?page=1&limit=20&sortBy=&sortOrder=`, default `page=1`/`limit=20`, **max `limit=100`**, và `meta: { page, limit, total, totalPages }` (**camelCase**). |
| Validate `@Query()` route-level | Pattern thật: `@Query() dto: XxxQueryDto` + route-level `ValidationPipe({ transform: true })` (vd meetings controller). |

⇒ **Đã chốt (NC-1)**: dùng wrapper `CLAUDE.md §8.1` (`{ success, message, data, meta }`) với `meta: { page, limit, total, totalPages }` (**camelCase** theo CLAUDE.md §8.4). Riêng **các item trong `data` giữ snake_case** theo `toIotDeviceResponse` (wire-format module iot). Tức: `meta` camelCase, `data[]` snake_case.

### 2.2 Actor & Roles

| Actor | Vai trò | Quyền |
|---|---|---|
| Người dùng có `iot.device.read` | Tra cứu thiết bị | Gọi list + detail |
| System | Máy chủ xử lý | Validate query/param, truy vấn, trả response (read-only) |

### 2.3 Role & Permission Rules

- Cả 2 endpoint yêu cầu JWT (`JwtAuthGuard`) + permission `iot.device.read` (1 quyền dùng chung cho list và detail).
- Guard quyền dùng pattern mock như IOT-011/012 (`MockPermissionsGuard` + `@Permissions(...)`).

### 2.4 Entity liên quan

| Entity / Table | Vai trò |
|---|---|
| `iot_devices` | Bảng nguồn (đọc qua `IoTDeviceEntity`) |

> Read-only — KHÔNG ghi `audit_logs`.

### 2.5 Bộ lọc (list)

| Query field | Cột entity | Kiểu | Ghi chú |
|---|---|---|---|
| `status` | `status` | enum | `online\|offline\|disabled\|maintenance` (lọc; mặc định không lọc → trả mọi status) |
| `device_type` | `deviceType` | enum | `ip_camera\|door_camera\|room_camera\|face_server\|microphone\|capture_agent\|occupancy_sensor\|display` |
| `room_id` | `roomId` | uuid | lọc theo phòng được gán |
| `search` | `deviceName` / `deviceCode` | string | ILIKE `%search%` trên device_name HOẶC device_code (max 200) |

---

## 3. Endpoints

### 3.1 List

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/iot-devices` |
| Auth | `JwtAuthGuard` |
| Permission | `iot.device.read` |
| Async | No |

**Query params (`ListIotDevicesQueryDto`):**

| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | int | No | `1` | min 1 |
| `limit` | int | No | `20` | min 1, max 100 |
| `status` | enum | No | — | thuộc IoTDeviceStatus |
| `device_type` | enum | No | — | thuộc IoTDeviceType |
| `room_id` | uuid | No | — | UUID v4 |
| `search` | string | No | — | max 200, ILIKE device_name/device_code |

**Response 200:**
```json
{
  "success": true,
  "message": "IoT devices retrieved successfully",
  "data": [
    {
      "id": "uuid",
      "device_name": "Camera góc phòng họp A",
      "device_code": "IPCAM-A3-01",
      "device_type": "ip_camera",
      "room_id": "uuid|null",
      "ip_address": "192.168.1.51",
      "mac_address": "AA:BB:CC:DD:EE:FF",
      "status": "online",
      "health_status": "healthy",
      "last_seen_at": "2026-06-15T09:00:00+07:00",
      "metadata_json": { "manufacturer": "Hikvision" },
      "created_by_name": null,
      "created_at": "2026-06-03T10:00:00+07:00",
      "updated_at": "2026-06-15T09:05:00+07:00"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

### 3.2 Detail

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/iot-devices/:id` |
| Auth | `JwtAuthGuard` |
| Permission | `iot.device.read` |
| Async | No |

**Path param:** `id` (uuid, `ParseUUIDPipe`).

**Response 200:**
```json
{
  "success": true,
  "message": "IoT device retrieved successfully",
  "data": { "id": "uuid", "device_name": "...", "device_code": "...", "...": "... (full device snake_case theo toIotDeviceResponse)" }
}
```

> `metadata_json` được mask secret bởi `maskSensitiveMetadata` ở cả list và detail.

---

## 4. Validation Flow

```text
[List]  GET /api/v1/iot-devices
1. JwtAuthGuard. Thiếu/sai → 401.
2. PermissionsGuard iot.device.read. Thiếu → 403.
3. ValidationPipe (transform) validate ListIotDevicesQueryDto:
   - page/limit ép số; sai kiểu/min/max → 400; limit > 100 → 400.
   - status/device_type sai enum → 400; room_id sai UUID → 400; search > 200 → 400.
4. Query iot_devices với điều kiện lọc (AND các filter có mặt); ORDER BY created_at DESC;
   OFFSET (page-1)*limit LIMIT limit. Đếm total (cùng điều kiện lọc, không phân trang).
5. Map mỗi row qua toIotDeviceResponse (mask metadata). totalPages = ceil(total/limit).
6. Trả 200 { data, meta }.

[Detail]  GET /api/v1/iot-devices/:id
1. JwtAuthGuard → 401. 2. Permission iot.device.read → 403.
3. ParseUUIDPipe :id. Sai UUID → 400.
4. findOne theo id. Không có → 404 (IOT_DEVICE_NOT_FOUND).
5. Trả 200 toIotDeviceResponse(device).
```

---

## 5. Functional Requirements (EARS)

### 5.1 Core — List

```text
FR-IOT-013-001: THE system SHALL cung cấp endpoint GET /api/v1/iot-devices trả về danh sách thiết bị phân trang.
FR-IOT-013-002: THE system SHALL trả về MỌI thiết bị bất kể status (bao gồm disabled) khi không có filter status; filter status (nếu có) SHALL thu hẹp kết quả theo đúng giá trị.
FR-IOT-013-003: WHEN query có device_type / room_id / search, THE system SHALL áp các điều kiện lọc đó (kết hợp AND). search SHALL khớp ILIKE %search% trên device_name HOẶC device_code.
FR-IOT-013-004: THE system SHALL sắp xếp danh sách theo created_at DESC.
FR-IOT-013-005: THE system SHALL phân trang theo page/limit (default page=1, limit=20, max limit=100) và trả meta { page, limit, total, totalPages } (camelCase) với total = tổng bản ghi khớp filter (không phụ thuộc phân trang), totalPages = ceil(total/limit).
```

### 5.2 Core — Detail

```text
FR-IOT-013-006: THE system SHALL cung cấp endpoint GET /api/v1/iot-devices/:id trả về chi tiết một thiết bị qua toIotDeviceResponse.
FR-IOT-013-007: IF không tìm thấy thiết bị theo :id, THEN THE system SHALL trả 404 (IOT_DEVICE_NOT_FOUND).
```

### 5.3 Data & Presentation

```text
FR-IOT-013-008: THE system SHALL trả data dạng snake_case theo toIotDeviceResponse ở cả list và detail.
FR-IOT-013-009: THE system SHALL mask các key nhạy cảm trong metadata_json (maskSensitiveMetadata) ở cả list và detail (SEC-01).
```

### 5.4 Read-only

```text
FR-IOT-013-010: THE system SHALL NOT ghi/đổi bất kỳ dữ liệu nào (read-only); SHALL NOT ghi audit_logs cho 2 endpoint này.
```

### 5.5 Authorization (SEC-02)

```text
FR-IOT-013-011: IF request không có JWT hợp lệ, THEN THE system SHALL trả 401 (UNAUTHORIZED).
FR-IOT-013-012: IF người dùng không có quyền iot.device.read, THEN THE system SHALL trả 403 (FORBIDDEN).
```

---

## 6. Non-functional Requirements (EARS)

```text
NFR-IOT-013-001 (Performance): THE system SHALL phản hồi list (limit ≤ 100) < 500ms ở điều kiện bình thường.
NFR-IOT-013-002 (Security): THE system SHALL validate toàn bộ query/param bằng class-validator (SEC-03); KHÔNG truyền giá trị thô vào SQL — dùng parameter binding (chống injection cho search).
NFR-IOT-013-003 (Consistency): Response SHALL theo format { success, message, data, meta } (list) và { success, message, data } (detail); error theo format chuẩn dự án.
NFR-IOT-013-004 (Persistence): THE system SHALL dùng TypeORM (query builder/repository); KHÔNG Prisma; KHÔNG sửa schema/entity.
NFR-IOT-013-005 (Security): THE system SHALL NOT trả secret thô trong metadata_json (mask).
NFR-IOT-013-006 (Observability): THE system SHALL ghi error log (ẩn với client) cho lỗi 500.
```

---

## 7. Acceptance Criteria

```text
AC-IOT-013-001 (list default):
- Given có 42 thiết bị, người dùng có iot.device.read,
- When GET /api/v1/iot-devices,
- Then 200, data có ≤ 20 phần tử (sort created_at DESC), meta = { page:1, limit:20, total:42, totalPages:3 }.

AC-IOT-013-002 (status filter hiển thị disabled):
- Given có thiết bị status='disabled',
- When GET /api/v1/iot-devices?status=disabled,
- Then 200, chỉ trả thiết bị disabled; (không filter → disabled vẫn xuất hiện trong danh sách).

AC-IOT-013-003 (search):
- Given thiết bị device_name chứa "phòng A" và device_code "IPCAM-A3-01",
- When GET ...?search=ipcam-a3,
- Then 200, trả thiết bị khớp ILIKE trên device_code (không phân biệt hoa thường).

AC-IOT-013-004 (pagination page 2):
- Given 42 thiết bị, limit=20,
- When GET ...?page=2&limit=20,
- Then 200, data là 20 phần tử tiếp theo, meta.page=2, meta.total=42, meta.totalPages=3.

AC-IOT-013-005 (detail happy):
- Given thiết bị tồn tại,
- When GET /api/v1/iot-devices/:id,
- Then 200, data = full device snake_case.

AC-IOT-013-006 (detail not found):
- Given :id không tồn tại,
- When GET /api/v1/iot-devices/:id,
- Then 404 IOT_DEVICE_NOT_FOUND.
```

---

## 8. Edge / Error Cases (EARS)

```text
EC-IOT-013-001: IF page/limit không phải số nguyên hợp lệ (hoặc < 1), THEN trả 400 (VALIDATION_ERROR).
EC-IOT-013-002: IF limit > 100, THEN trả 400 (VALIDATION_ERROR).
EC-IOT-013-003: IF status/device_type sai enum, hoặc room_id sai UUID, hoặc search > 200 ký tự, THEN trả 400 (VALIDATION_ERROR).
EC-IOT-013-004: IF page vượt quá số trang (vd page=99 khi chỉ 3 trang), THEN trả 200 với data rỗng và meta.total/totalPages vẫn đúng theo filter.
EC-IOT-013-005: IF :id (detail) sai định dạng UUID, THEN trả 400 (VALIDATION_ERROR).
EC-IOT-013-006: IF không có thiết bị nào khớp filter, THEN trả 200 với data rỗng và meta.total=0, totalPages=0.
```

### 8.1 Error Code Map

| HTTP | Error Code | Kịch bản |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Sai page/limit/enum/uuid/search; limit>100; :id sai UUID |
| 401 | `UNAUTHORIZED` | Thiếu/sai/hết hạn JWT |
| 403 | `FORBIDDEN` | Thiếu quyền `iot.device.read` |
| 404 | `IOT_DEVICE_NOT_FOUND` | Detail: không thấy thiết bị theo :id |
| 500 | `INTERNAL_SERVER_ERROR` | Lỗi hệ thống/DB |

---

## 9. Traceability

| Requirement | EARS Pattern | Nguồn / Ràng buộc |
|---|---|---|
| FR-IOT-013-001..005 | Ubiquitous / Event | Feature #14; CLAUDE.md §8.4 |
| FR-IOT-013-006..007 | Ubiquitous / Unwanted | Feature #14 |
| FR-IOT-013-008..009 | Ubiquitous | toIotDeviceResponse; SEC-01 |
| FR-IOT-013-010 | Unwanted | Read-only |
| FR-IOT-013-011..012 | Unwanted | Constitution SEC-02 |
| NFR-IOT-013-001..006 | — | Constitution NFR; SEC-03; CLAUDE.md §8.1 |

---

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| D-1 | **2 endpoint GET**: `GET /api/v1/iot-devices` (list) + `GET /api/v1/iot-devices/:id` (detail). **1 quyền** `iot.device.read` cho cả 2; guard mock. |
| D-2 | **List query** `ListIotDevicesQueryDto` = `{ page, limit, status?, device_type?, room_id?, search? }`; `search` ILIKE trên `device_name`/`device_code`; sort `created_at DESC`; trả **mọi status** kể cả `disabled`; `status` filter để thu hẹp. |
| D-3 | **Detail**: `toIotDeviceResponse`; 404 `IOT_DEVICE_NOT_FOUND`. |
| D-4 | **Response `data` snake_case**; **read-only, KHÔNG audit**. |
| D-5 | **`:id` `ParseUUIDPipe`**; query validate **route-level** (`ValidationPipe transform`). |
| D-6 | **Out-of-scope**: bulk, export, events-in-detail, realtime, cursor pagination, full-text search. |

---

## 11. Quyết định bổ sung đã chốt (vòng 2)

| # | Quyết định |
|---|---|
| **NC-1 → chốt** | **`meta` camelCase** theo CLAUDE.md §8.4: `meta: { page, limit, total, totalPages }`, đặt trong wrapper `{ success, message, data, meta }`. **`data[]` giữ snake_case** theo `toIotDeviceResponse`. (meta camelCase + data snake_case — có chủ ý.) |
| **NC-2 → chốt** | **`limit > 100` → 400** (`@Max(100)`); không clamp. |
| **NC-3 → chốt** | **Sort cố định `created_at DESC`**; KHÔNG mở `sortBy`/`sortOrder` ở v1 (scope-limit, có thể bổ sung sau). |

---

> Trạng thái: **CHỜ REVIEW**. Chỉ là spec — chưa có plan.md/tasks.md, chưa code. Dừng chờ Thiếu Chủ review.
