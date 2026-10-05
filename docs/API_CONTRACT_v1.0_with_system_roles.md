# API CONTRACT v1.0 — Intelligent Meeting Lifecycle Management System
## Smart Room & Meeting Management Platform (SMRMPTS)

> **Tạo ngày:** 2026-06-03  
> **Database baseline:** v3.2 Compact (39 tables)  
> **Nguồn Use Case:** UseCase_List_SMRMPTS.xlsx  
> **Tổng số Use Case:** 158 UC (từ UC-01 đến UC-158)  
> **Tổng số endpoint:** 180+ endpoint  
> **Prefix base URL:** `/api/v1`

---

## CHANGELOG

| Ngày | Tóm tắt | Ghi chú |
|---|---|---|
| 2026-06-03 | Tạo mới toàn bộ API Contract v1.0 từ UseCase_List_SMRMPTS.xlsx + Database v3.2 Compact | Tạo mới |
| 2026-06-15 | Thêm IOT-011 (Feature #12) — Cập nhật thông tin thiết bị IoT/Camera (PATCH /api/v1/iot-devices/{deviceId}), permission `iot.device.update`. Tránh trùng UC-73 (đã là "Lưu raw event"). | Section 8 (sau UC-69) |
| 2026-06-15 | Sửa ví dụ request/response của IOT-011 sang **snake_case** cho khớp wire-format thật (`toIotDeviceResponse`). Ghi chú UC-67 đang camelCase chưa đồng bộ. | Section 8 (IOT-011) |
| 2026-06-15 | Thêm IOT-012 (Feature #13) — Disable/Re-enable thiết bị IoT/Camera (POST /:id/disable, /:id/enable, @HttpCode(200), no body), permission `iot.device.disable`/`iot.device.enable`. | Section 8 (sau IOT-011) |
| 2026-06-15 | Thêm IOT-013 (Feature #14) — List + Detail thiết bị IoT/Camera (GET /iot-devices, GET /:id), permission `iot.device.read`. Read-only; data snake_case, meta camelCase {page,limit,total,totalPages}. | Section 8 (sau IOT-012) |
| 2026-06-15 | Thêm IOT-014 (Feature #15) — Phát hiện camera offline bằng active TCP probe (POST /iot-devices/probe-status + cron EVERY_MINUTE), permission `iot.device.probe`. Đổi status ip_camera, audit auto_online/auto_offline. | Section 8 (sau IOT-013) |
| 2026-06-15 | Đánh dấu UC-30/108/109/110 (recording-config) = ✅ Đã implement (REC-001). | Section 5 (UC-30), Section 12 (UC-108/109/110) |
| 2026-07-26 | Đợt P0 (BE-06/01/02/03): BE-01 thêm UC-02b `POST /api/v1/auth/refresh` + sửa câu sai ở Business rules UC-02 ("không còn `sessionId`/`refreshToken`" → chỉ đúng với `sessionId`/bảng `user_sessions`, `refreshToken` vẫn dùng). BE-02 thêm UC-17b `GET /api/v1/meetings` (list, admin). BE-03 thêm UC-18b `PATCH /api/v1/meetings/{meetingId}` (chỉ title/description). Chi tiết: `spec/features/auth/feat-refresh-token/`, `spec/features/meeting/feat-list-meetings/`, `spec/features/meeting/feat-update-meeting-metadata/`. | UC-02, UC-02b (mới), UC-17b (mới), UC-18b (mới) |
| 2026-07-27 | Đợt P1 (A.2): thêm Phụ lục F — SAVP Campus Extension, mục đầu tiên `GET /api/v1/campus-dashboard/zones/{zoneId}/timeline` (ZPT-001/UC-119 theo numbering spec-kit riêng của SAVP — KHÔNG trùng UC-119 "Tạo metadata file phương tiện" của tài liệu này, hai hệ numbering độc lập). Ghi chú residual: các endpoint SAVP khác đã code (gate-access, alerts, campus-dashboard overview/traffic, restricted-zone, crowd-alert, vehicle-control) CHƯA có trong tài liệu này — nợ tài liệu từ trước đợt P1, ngoài phạm vi đợt này. | Phụ lục F (mới) |
| 2026-07-27 | Đợt P1 (BE-05): gỡ trùng route `GET /meetings/{meetingId}/attendance` — UC-81 (danh sách chung) và UC-101/UC-IMM-08 (điểm danh trong live-meeting session) từng cùng khai path này, NestJS chỉ route theo thứ tự import module. Thêm UC-81b `GET /api/v1/live-meetings/{meetingId}/attendance` cho UC-101/UC-IMM-08; đính chính ghi chú sai ở UC-101. | UC-81 (sau, mới UC-81b), UC-101 |
| 2026-07-27 | Đợt P1 (BE-08): thêm UC-07b `PATCH /api/v1/departments/{id}` (không cho sửa `departmentCode`). Chi tiết: `spec/features/account/feat-update-department/`. | UC-07 (sau, mới UC-07b) |
| 2026-07-27 | Đợt P1 (BE-07): thêm UC-146b — Notification Inbox List/Detail (chưa từng có trong tài liệu này) + mark-read mới (`PATCH .../read`, `PATCH .../read-all`) qua Redis, không đụng schema DB. Chi tiết: `spec/features/notifications/feat-notification-inbox/`. | UC-146 (sau, mới UC-146b) |
| 2026-07-27 | Đợt P1 (BE-09): thêm UC-158b `GET/PATCH /api/v1/system-configurations` (allowlist 9 key phẳng FE `SystemSettings.jsx`), khác UC-47 (endpoint chuyên biệt cũ). Chi tiết: `spec/features/administration/feat-system-configurations/`. | UC-158 (sau, mới UC-158b) |
| 2026-07-27 | Đợt P1 (BE-04): thêm UC-14b `GET /api/v1/users/export` (background job + poll, KHÔNG phải blob — hợp đồng mới với FE, Nam phải sửa `UserManagement.jsx`). Chi tiết: `spec/features/account/feat-export-user-accounts/`. | UC-14 (sau, mới UC-14b) |
| 2026-07-27 | Đợt P1 (BE-10, đóng mục không code): ghi chú tại UC-72 — stranger alert resolve đi qua `POST /security-alerts/{id}/resolve` sẵn có, KHÔNG có endpoint `PATCH /face-access/stranger-alerts/{id}/resolve` riêng (`stranger_alerts` không phải bảng thật). Chi tiết: `spec/features/face-access/feat-resolve-stranger-alert/`. | UC-72 |
| 2026-07-27 | **[BE-04, đợt sửa lại cùng ngày]** Đảo ngược UC-14b khỏi background job — trả về `200` + file XLSX trực tiếp (blob), đúng luồng FE cũ đang gọi. Chi tiết: `PLAN_THUC_THI_BE04_SUA_LAI_2026-07-27.md`, `spec/features/account/feat-export-user-accounts/`. | UC-14b |
| 2026-10-05 | Gộp `API_CONTRACT_v1.0.md` vào file này: bổ sung UC-07b, UC-14b, UC-17b, UC-18b, IOT-011..014, UC-146b, UC-158b, Phụ lục F và toàn bộ changelog cũ. Xóa file `API_CONTRACT_v1.0.md`, file này là API contract duy nhất. | Toàn bộ file |

---

## Quy ước chung

### Base URL & Auth
- **Base URL:** `/api/v1`
- **Auth:** JWT Bearer token — `Authorization: Bearer <access_token>`
- **Public endpoint:** không yêu cầu token (đã ghi `public`)
- **Internal endpoint:** chỉ service nội bộ, dùng service signature/token

### ID & Datetime
- Toàn bộ ID dùng **UUID** (v4)
- Datetime dùng **ISO-8601 có timezone** (e.g. `2026-06-03T10:00:00+07:00`)
- Database dùng `timestamptz` — không lưu naive datetime

### Response Format

**Success:**
```json
{
  "success": true,
  "message": "Mô tả kết quả",
  "data": {},
  "meta": {}
}
```

**Success (danh sách):**
```json
{
  "success": true,
  "message": "...",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

**Error:**
```json
{
  "success": false,
  "message": "Mô tả lỗi",
  "error": {
    "code": "ERROR_CODE",
    "details": {}
  },
  "timestamp": "2026-06-03T10:00:00+07:00",
  "path": "/api/v1/..."
}
```

### HTTP Status Codes

| Code | Tình huống |
|---:|---|
| `200` | Thành công (GET/PATCH/DELETE có body) |
| `201` | Tạo mới thành công |
| `202` | Accepted — xử lý bất đồng bộ qua `background_jobs` |
| `204` | Thành công không có body |
| `400` | Input sai, thiếu trường bắt buộc |
| `401` | Chưa xác thực |
| `403` | Không đủ quyền |
| `404` | Không tìm thấy |
| `409` | Conflict nghiệp vụ (trùng booking, trùng mã) |
| `422` | Validation logic thất bại |
| `429` | Rate limit |
| `500` | Lỗi server |

### Pagination Query
```
?page=1&limit=20&sortBy=created_at&sortOrder=desc
```
- Default: `page=1`, `limit=20`, max `limit=100`
- `sortBy` phải là allowlist, không inject trực tiếp

### Quy tắc v3.2 Compact
- OTP reset mật khẩu lưu **Redis/cache TTL**, không có bảng `password_reset_requests`
- Conflict scheduling tính **động** từ `meetings`, `room_bookings`, `meeting_participants`
- Thiết bị gán phòng bằng `equipments.current_room_id`, không có `equipment_assignments`
- Notification recipient lưu JSON trong `notifications.recipient_user_ids_json`
- Minutes action item lưu trong `meeting_minutes.action_items_json`
- Policy lưu ở `system_configs.config_json`
- Export dùng `background_jobs` → `media_files`

---

## Feature Index

| # | Feature | Module | Số UC |
|---:|---|---|---:|
| 1 | [Authentication & Authorization](#1-authentication--authorization) | `auth` | 4 |
| 2 | [Account Management](#2-account-management) | `accounts` | 14 |
| 3 | [Meeting Management](#3-meeting-management) | `meetings` | 17 |
| 4 | [Room Utilization Management](#4-room-utilization-management) | `utilization`, `rooms` | 13 |
| 5 | [Scheduling Management](#5-scheduling-management) | `scheduling` | 6 |
| 6 | [Room Management](#6-room-management) | `rooms` | 4 |
| 7 | [Equipment Management](#7-equipment-management) | `equipment` | 6 |
| 8 | [IoT Device Management](#8-iot-device-management) | `iot` | 10 |
| 9 | [Device User Mapping](#9-device-user-mapping) | `iot`, `attendance` | 3 |
| 10 | [Attendance & Presence Management](#10-attendance--presence-management) | `attendance`, `presence` | 13 |
| 11 | [In-Meeting Management](#11-in-meeting-management) | `live-meeting` | 12 |
| 12 | [Recording Management](#12-recording-management) | `recording` | 17 |
| 13 | [Meeting Transcription Management](#13-meeting-transcription-management) | `transcription` | 4 |
| 14 | [Minutes & Knowledge Management](#14-minutes--knowledge-management) | `minutes` | 14 |
| 15 | [Notification and Reporting](#15-notification-and-reporting) | `notifications` | 5 |
| 16 | [Analytics & Administration](#16-analytics--administration) | `analytics`, `administration` | 11 |

---

## 1. Authentication & Authorization

**Module:** `auth` | **Tables:** `users`, `audit_logs`
**System Roles:** `PUBLIC`, `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### UC-01 — Đăng nhập hệ thống

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/auth/login` |
| Permission | `public` |
| System Role | `PUBLIC` |
| Async | No |

**Request Body:**
```json
{
  "email": "user@company.com",
  "password": "string"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Đăng nhập thành công",
  "data": {
    "accessToken": "eyJ...",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "user": {
      "id": "uuid",
      "email": "user@company.com",
      "fullName": "Nguyễn Văn A",
      "avatarUrl": "https://...",
      "departmentId": "uuid",
      "employmentStatus": "active",
      "accountStatus": "active",
      "mustChangePassword": false,
      "roles": [{ "id": "uuid", "roleCode": "USER", "roleName": "Nhân viên" }],
      "permissions": ["meeting.create", "room.read"]
    }
  }
}
```

**Error Codes:**
- `400` — thiếu email/password
- `401` — sai thông tin đăng nhập, mã: `INVALID_CREDENTIALS`
- `423` — tài khoản bị khóa, mã: `ACCOUNT_LOCKED`, kèm `lockedUntil`
- `429` — quá giới hạn thử

**Business rules:**
- Tăng `users.failed_login_count` mỗi lần sai
- Nếu vượt ngưỡng → set `users.locked_until`
- Ghi `audit_logs` (action_type: `login`)
- Nếu `must_change_password = true` → trả thêm `mustChangePassword: true` trong response

---

### UC-02 — Đăng xuất hệ thống

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/auth/logout` |
| Permission | `auth:user` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request:** Header `Authorization: Bearer <token>`

**Response 200:**
```json
{
  "success": true,
  "message": "Đăng xuất thành công",
  "data": {
    "loggedOut": true,
    "loggedOutAt": "2026-06-03T10:00:00+07:00"
  }
}
```

**Business rules:**
- Blacklist access token trong Redis (TTL = thời gian còn lại của token)
- Ghi `audit_logs` (action_type: `logout`)
- Không cần body — không còn `sessionId`/bảng `user_sessions` theo v3.2 Compact (Đính chính 2026-07-26: `refreshToken` **vẫn được dùng** trong hệ thống, chỉ riêng bảng `user_sessions` là bị loại bỏ khỏi DB Compact. Đọc UC-02b bên dưới về refresh token.)

---

### UC-02b — Làm mới access token (Refresh Token)

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/auth/refresh` |
| Permission | Public (không cần `JwtAuthGuard` — access token đã hết hạn là lý do gọi endpoint này) |
| System Role | Không yêu cầu đăng nhập (public) |
| Async | No |

**Request:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Refresh token thanh cong",
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "expiresIn": 10800
  }
}
```

**Response 401 (REFRESH_TOKEN_INVALID):** sai chữ ký, hết hạn, malformed, hoặc user không tồn tại/không còn `active`.

**Response 401 (REFRESH_TOKEN_REVOKED):** `jti` của refresh token đã có trong Redis blacklist (đã dùng để rotation hoặc đã logout).

**Business rules:**
- Xác thực chữ ký refresh token bằng secret riêng (`AUTH_REFRESH_TOKEN_SECRET`, khác secret access token).
- Rotation: mỗi lần refresh phát `jti` mới cho cả access + refresh token mới; `jti` cũ bị blacklist ngay (TTL = thời gian còn lại của refresh token cũ) — chống replay.
- Vì login phát access+refresh **cùng một `jti`**, blacklist `jti` cũ khi rotation cũng khai tử access token cũ tương ứng.
- Redis không phản hồi được → fail-closed, trả 401 (ưu tiên an toàn hơn khả dụng).
- Không dùng bảng `user_sessions` (đúng DB v3.2 Compact) — trạng thái revoke hoàn toàn dựa vào Redis blacklist theo `jti`.
- Chi tiết: `spec/features/auth/feat-refresh-token/spec.md`.

---

### UC-03 — Đặt lại mật khẩu bằng OTP

**3a. Yêu cầu OTP:**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/auth/password-reset/otp` |
| Permission | `public` |
| System Role | `PUBLIC` |
| Async | Yes |

**Request Body:**
```json
{
  "email": "user@company.com"
}
```

**Response 202:**
```json
{
  "success": true,
  "message": "OTP đã được gửi tới email",
  "data": {
    "otpRequestId": "uuid-or-token-ref",
    "maskedEmail": "us***@company.com",
    "expiresInMinutes": 10,
    "resendAfterSeconds": 60
  }
}
```

- OTP hash lưu Redis với TTL 10 phút (không dùng bảng)
- Rate limit theo email + IP

**3b. Xác nhận OTP & đặt mật khẩu mới:**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/auth/password-reset/confirm` |
| Permission | `public` |
| System Role | `PUBLIC` |
| Async | No |

**Request Body:**
```json
{
  "otpRequestId": "uuid-or-token-ref",
  "email": "user@company.com",
  "otp": "123456",
  "newPassword": "NewPass@2026",
  "confirmPassword": "NewPass@2026"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "passwordChanged": true,
    "loginRequired": true,
    "changedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- `400` — OTP sai/hết hạn, mã: `OTP_INVALID` hoặc `OTP_EXPIRED`
- `422` — mật khẩu không đủ độ phức tạp
- Ghi `users.password_updated_at`, `users.must_change_password = false`
- Ghi `audit_logs` (action_type: `password_reset`)

---

### UC-04 — Đổi mật khẩu đăng nhập

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/auth/me/password` |
| Permission | `auth:user` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "currentPassword": "OldPass@2025",
  "newPassword": "NewPass@2026",
  "confirmPassword": "NewPass@2026"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "passwordChanged": true,
    "changedAt": "2026-06-03T10:00:00+07:00",
    "loginAgainRecommended": true
  }
}
```

- `401` — mật khẩu hiện tại sai
- Blacklist access token hiện tại sau khi đổi
- Ghi `audit_logs` (action_type: `password_change`)

---

## 2. Account Management

**Module:** `accounts` | **Tables:** `users`, `departments`, `roles`, `user_roles`, `permissions`, `role_permissions`, `face_profiles`, `audit_logs`, `background_jobs`
**System Roles:** `INTERNAL_USER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### UC-06 — Tạo tài khoản thủ công

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/users` |
| Permission | `account.user.create` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes (gửi email qua background_jobs) |

**Request Body:**
```json
{
  "employeeCode": "NV001",
  "fullName": "Nguyễn Văn A",
  "email": "nva@company.com",
  "phoneNumber": "0901234567",
  "departmentId": "uuid",
  "roleIds": ["uuid"],
  "positionTitle": "Nhân viên",
  "directManagerId": "uuid"
}
```

**Response 201:**
```json
{
  "success": true,
  "message": "Tạo tài khoản thành công",
  "data": {
    "id": "uuid",
    "employeeCode": "NV001",
    "email": "nva@company.com",
    "fullName": "Nguyễn Văn A",
    "accountStatus": "active",
    "mustChangePassword": true,
    "roles": [{ "id": "uuid", "roleCode": "USER", "roleName": "Nhân viên" }],
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- `409` — email/employeeCode đã tồn tại
- Sinh mật khẩu ngẫu nhiên, hash bcrypt/argon2, set `must_change_password = true`
- Tạo `background_jobs` (job_type: `send_email`) để gửi email chứa mật khẩu tạm
- Ghi `audit_logs`

---

### UC-05 — Tạo tài khoản bằng import Excel

**5a. Tải template:**

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/users/import-template` |
| Permission | `account.user.import` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?format=xlsx`

**Response 200:** Binary file `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

**5b. Upload file import:**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/users/import-jobs` |
| Permission | `account.user.import` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request:** `multipart/form-data`
- `file`: `.xlsx/.xls` (max 10MB)
- `sendCredentialEmail`: `boolean` (optional, default `true`)

**Response 202:**
```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "status": "queued",
    "preview": {
      "validRows": 45,
      "invalidRows": 3,
      "errors": [
        { "row": 5, "field": "email", "reason": "Email đã tồn tại" }
      ]
    }
  }
}
```

- `413` — file quá lớn
- `415` — sai định dạng file
- Tạo `background_jobs` (job_type: `import_accounts`)

**5c. Kiểm tra trạng thái import job:**

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/background-jobs/{jobId}` |
| Permission | `account.user.import` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

---

### UC-07 — Khởi tạo phòng ban mới

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/departments` |
| Permission | `department.create` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "departmentCode": "IT",
  "departmentName": "Phòng Công nghệ thông tin",
  "parentDepartmentId": "uuid",
  "managerUserId": "uuid",
  "description": "Mô tả phòng ban"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "departmentCode": "IT",
    "departmentName": "Phòng Công nghệ thông tin",
    "parentDepartmentId": "uuid",
    "isActive": true,
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- `409` — `departmentCode` đã tồn tại

---

### UC-07b — Cập nhật phòng ban (mới, 2026-07-27, BE-08)

> Spec: `spec/features/account/feat-update-department/`. KHÔNG cho sửa `departmentCode` (mã định danh — muốn sửa phải là UC riêng).

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/departments/{id}` |
| Permission | `department.update` |
| Async | No |

**Request Body (tất cả optional, gửi ít nhất 1 field):**
```json
{
  "departmentName": "Phòng Công nghệ thông tin (đổi tên)",
  "parentDepartmentId": "uuid",
  "managerUserId": "uuid",
  "description": "Mô tả mới",
  "isActive": true
}
```

**Response 200:** cùng shape UC-07.

**Error:** `400 EMPTY_UPDATE_PAYLOAD` (body rỗng) · `404 DEPARTMENT_NOT_FOUND` · `404 RESOURCE_NOT_FOUND` (parent/manager không tồn tại/không active) · `409 DEPARTMENT_ALREADY_EXISTS` (tên trùng phòng ban khác) · `422 VALIDATION_ERROR` (chu trình cha-con, hoặc vượt quá 5 cấp).

---

### UC-08 — Cập nhật vai trò và quyền tài khoản

| Field | Value |
|---|---|
| Method | `PUT` |
| Endpoint | `/api/v1/users/{userId}/roles` |
| Permission | `account.role.update` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "roleIds": ["uuid1", "uuid2"],
  "reason": "Thăng chức lên Team Lead"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "roles": [
      { "id": "uuid", "roleCode": "TEAM_LEAD", "roleName": "Team Lead" }
    ],
    "effectiveAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- Xóa `user_roles` cũ (set `is_active = false`) và tạo mới
- Ghi `audit_logs`

---

### UC-09 — Cập nhật thông tin tài khoản nhân sự

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/users/{userId}` |
| Permission | `account.user.update` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body (tất cả optional):**
```json
{
  "fullName": "Nguyễn Văn A",
  "employeeCode": "NV001",
  "email": "new@company.com",
  "phoneNumber": "0901234567",
  "departmentId": "uuid",
  "positionTitle": "Senior Developer",
  "directManagerId": "uuid"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employeeCode": "NV001",
    "email": "new@company.com",
    "fullName": "Nguyễn Văn A",
    "departmentId": "uuid",
    "positionTitle": "Senior Developer",
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-10 — Xóa tài khoản người dùng

| Field | Value |
|---|---|
| Method | `DELETE` |
| Endpoint | `/api/v1/users/{userId}` |
| Permission | `account.user.delete` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?confirm=true`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "userId": "uuid"
  }
}
```

- `409` — user có dữ liệu ràng buộc (meetings, bookings), phải dùng soft delete
- Blacklist token của user bị xóa

---

### UC-11 — Cập nhật trạng thái tài khoản

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/users/{userId}/status` |
| Permission | `account.user.status.update` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "accountStatus": "inactive",
  "reason": "Nhân viên nghỉ việc",
  "lockedUntil": null
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "accountStatus": "inactive",
    "securityStateChanged": true,
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- `accountStatus` enum: `active`, `inactive`, `locked`, `pending_reset`
- Ghi `audit_logs`

---

### UC-12 — Khóa tài khoản người dùng

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/users/{userId}/lock` |
| Permission | `account.user.lock` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "reason": "Vi phạm quy định bảo mật",
  "lockedUntil": "2026-07-01T00:00:00+07:00"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "accountStatus": "locked",
    "lockedUntil": "2026-07-01T00:00:00+07:00",
    "tokensRevoked": true,
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- Blacklist tất cả token còn hiệu lực của user
- Ghi `audit_logs` (severity: `warning`)

---

### UC-13 — Tìm kiếm tài khoản

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/users` |
| Permission | `account.user.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query Parameters:**
```
?q=nguyen&page=1&limit=20&sortBy=full_name&sortOrder=asc
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "employeeCode": "NV001",
      "fullName": "Nguyễn Văn A",
      "email": "nva@company.com",
      "departmentId": "uuid",
      "departmentName": "Phòng IT",
      "accountStatus": "active",
      "avatarUrl": "https://..."
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 50, "totalPages": 3 }
}
```

- `q` match full-text trên `full_name`, `email`, `employee_code` (case-insensitive)

---

### UC-14 — Lọc danh sách tài khoản

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/users` |
| Permission | `account.user.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query Parameters (kết hợp với UC-13):**
```
?departmentId=uuid&roleId=uuid&accountStatus=active&employmentStatus=active&page=1&limit=20
```

**Response 200:** (cùng format với UC-13)

---

### UC-14b — Xuất danh sách người dùng ra file Excel (2026-07-27, BE-04, sửa lại cùng ngày)

> Spec: `spec/features/account/feat-export-user-accounts/`. **[Đợt sửa lại 2026-07-27]** Đảo ngược khỏi phương án background job (dòng log cùng ngày ở trên) — trả về đúng luồng blob đồng bộ mà FE cũ vẫn đang gọi (`sysAdminServices.js:338`, `businessAdminServices.js:120` dùng `responseType: 'blob'`). Nam **vẫn cần** thêm nhánh `responseType: 'blob'` ở `request.js` cho route này (không phải "khỏi sửa gì") — nhưng không còn `{jobId}`/poll để xử lý riêng.

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/users/export` |
| Permission | `accounts.user.export` |
| Async | No — render đồng bộ trong cùng request |

**Query:** `?search=&departmentId=uuid&roleId=uuid&locked=true` (tất cả optional — khớp filter thật FE gửi trên màn `UserManagement.jsx`, không có `page`/`limit`, export lấy toàn bộ có LIMIT trần 10.000 dòng)

**Response 200:** body là bytes file XLSX (không phải JSON).
```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="danh-sach-nguoi-dung-YYYYMMDD-HHmmss.xlsx"
```

- KHÔNG tạo `background_jobs`, KHÔNG có `jobId`, KHÔNG poll `GET /api/v1/background-jobs/{jobId}`.
- File output: 1 sheet XLSX, không chứa `password_hash` hay field nhạy cảm khác. Rỗng vẫn trả `200` (file chỉ có header).
- Audit log: `entityType: 'users'` (đổi từ `background_jobs` ở đợt trước), best-effort — lỗi ghi audit không chặn việc tải file.
- **Route order:** `GET /users/export` đăng ký TRƯỚC `GET /users/{userId}` — nếu không, `:userId` sẽ nuốt `"export"` và trả `400` (parse UUID thất bại).

---

### UC-15 — Xem chi tiết hồ sơ tài khoản

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/users/{userId}` |
| Permission | `account.user.read.detail` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employeeCode": "NV001",
    "email": "nva@company.com",
    "fullName": "Nguyễn Văn A",
    "phoneNumber": "0901234567",
    "avatarUrl": "https://...",
    "positionTitle": "Senior Developer",
    "department": { "id": "uuid", "departmentName": "Phòng IT" },
    "directManager": { "id": "uuid", "fullName": "Trần Thị B" },
    "accountStatus": "active",
    "employmentStatus": "active",
    "mustChangePassword": false,
    "lastLoginAt": "2026-06-01T08:00:00+07:00",
    "roles": [{ "id": "uuid", "roleCode": "USER", "roleName": "Nhân viên" }],
    "hasFaceProfile": true,
    "createdAt": "2026-01-01T00:00:00+07:00"
  }
}
```

---

### UC-16 — Xem lịch sử hoạt động tài khoản

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/users/{userId}/audit-logs` |
| Permission | `audit.user.read` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query Parameters:**
```
?from=2026-01-01&to=2026-06-03&actionType=login&page=1&limit=20
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "createdAt": "2026-06-03T08:00:00+07:00",
      "actionType": "login",
      "entityType": "user",
      "status": "success",
      "severity": "info",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "metadata": {}
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
}
```

---

### UC-17 — Đăng ký và liên kết dữ liệu khuôn mặt

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/users/{userId}/face-profile` |
| Permission | `account.face.register` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "deviceId": "uuid",
  "devicePersonId": "person-123",
  "devicePersonCode": "NV001",
  "primaryImageFileId": "uuid",
  "consentAt": "2026-06-03T10:00:00+07:00",
  "modelVersion": "v2.1"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "faceProfileId": "uuid",
    "userId": "uuid",
    "status": "pending_review",
    "deviceMappingId": "uuid",
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- Tạo `face_profiles` với status `pending_review`
- Tạo `device_user_mappings` liên kết user với Face Server
- `409` — user đã có face profile active

---

### UC - Cập nhật thông tin cá nhân (self)

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/me/profile` |
| Permission | `profile.update.self` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "fullName": "Nguyễn Văn A",
  "phoneNumber": "0901234567",
  "avatarFileId": "uuid"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "fullName": "Nguyễn Văn A",
    "phoneNumber": "0901234567",
    "avatarUrl": "https://...",
    "email": "nva@company.com",
    "employeeCode": "NV001",
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- `email`, `employeeCode` là read-only, không được sửa qua endpoint này

---

## 3. Meeting Management

**Module:** `meetings` | **Tables:** `meetings`, `meeting_requests`, `meeting_participants`, `meeting_external_participants`, `meeting_agendas`, `meeting_recurrence_rules`, `meeting_notes`, `meeting_events`, `room_bookings`, `recording_configs`
**System Roles:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### UC-17b — Danh sách cuộc họp (admin, có phân trang/filter)

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings` |
| Permission | `meeting.read.all` (BUSINESS_ADMIN, SYSTEM_ADMIN) |
| Async | No |

**Query params:** `page` (default 1), `limit` (default 20, max 100), `sortBy` (allowlist: `created_at`, `start_time`, `title`, `status`), `sortOrder` (`asc`/`desc`), `status`, `roomId` (UUID), `organizerId` (UUID), `from`, `to` (ISO 8601, lọc theo `start_time`), `search` (theo `title`, ILIKE).

**Response 200:**
```json
{
  "success": true,
  "message": "Lay danh sach cuoc hop thanh cong",
  "data": [
    {
      "id": "uuid",
      "meetingCode": "MT-20260726-001",
      "title": "Sprint Review",
      "status": "scheduled",
      "meetingType": "normal",
      "meetingMode": "offline",
      "startTime": "2026-07-27T10:00:00.000Z",
      "endTime": "2026-07-27T11:00:00.000Z",
      "roomId": "uuid",
      "roomName": "Phong A",
      "organizerId": "uuid",
      "organizerName": "Nguyen Van A",
      "createdAt": "2026-07-20T00:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 125, "totalPages": 7 }
}
```

**Business rules:**
- Không trả `cancellationReason` hay dữ liệu nhạy cảm khác — đây là màn LIST tổng quan, không phải detail.
- `sortBy` bắt buộc qua allowlist (validation pipe `@IsIn`), không nối trực tiếp vào SQL.
- `from > to` → 400 `INVALID_DATE_RANGE`.
- Khác `GET /meetings/my-schedule` (`schedule.read.self`) — endpoint đó chỉ trả lịch của chính người gọi, không cần permission admin.
- Chi tiết: `spec/features/meeting/feat-list-meetings/spec.md`.

---

### UC-18 — Tạo cuộc họp mới thủ công

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings` |
| Permission | `meeting.create` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes (gửi email thông báo) |

**Request Body:**
```json
{
  "title": "Họp Sprint Review Q2",
  "description": "Review kết quả sprint",
  "meetingType": "normal",
  "meetingMode": "offline",
  "priority": "normal",
  "startTime": "2026-06-10T09:00:00+07:00",
  "endTime": "2026-06-10T10:30:00+07:00",
  "timezone": "Asia/Ho_Chi_Minh",
  "roomId": "uuid",
  "expectedAttendeeCount": 10,
  "visibilityLevel": "internal",
  "participantUserIds": ["uuid1", "uuid2"],
  "externalParticipants": [
    {
      "fullName": "Khách A",
      "email": "khacha@external.com",
      "organizationName": "Partner Corp"
    }
  ],
  "requireApproval": false,
  "enableRecording": false
}
```

**Response 201:**
```json
{
  "success": true,
  "message": "Tạo cuộc họp thành công",
  "data": {
    "id": "uuid",
    "meetingCode": "MTG-20260610-001",
    "title": "Họp Sprint Review Q2",
    "status": "scheduled",
    "startTime": "2026-06-10T09:00:00+07:00",
    "endTime": "2026-06-10T10:30:00+07:00",
    "room": { "id": "uuid", "roomCode": "R101", "roomName": "Phòng họp 101" },
    "bookingId": "uuid",
    "participantCount": 3,
    "notificationQueued": true,
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- Nếu `requireApproval = true` → tạo `meeting_requests` (type: `create_meeting`, status: `pending`)
- Kiểm tra conflict phòng và participant trước khi tạo
- Tạo `room_bookings` nếu có room
- `409` — phòng bị conflict
- Ghi `meeting_events` (type: `meeting_created`)

---

### UC-18b — Cập nhật thông tin cơ bản cuộc họp (title/description)

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/meetings/{meetingId}` |
| Permission | `meeting.update.own` (chỉ organizer/host của meeting đó) |
| Async | No |

**Phạm vi CỐ Ý HẸP:** chỉ `title`, `description`. Thời gian đi `PATCH /meetings/{meetingId}/time` (UC-19), phòng đi `PATCH /meetings/{meetingId}/room`, participants/agenda/recording đi endpoint chuyên trách riêng. `forbidNonWhitelisted: true` → field ngoài `title`/`description` sẽ bị từ chối (400).

**Request:**
```json
{
  "title": "Tên cuộc họp mới (tùy chọn)",
  "description": "Mô tả mới (tùy chọn)"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Cap nhat cuoc hop thanh cong",
  "data": {
    "meetingId": "uuid",
    "title": "Tên cuộc họp mới",
    "description": "Mô tả mới",
    "updatedAt": "2026-07-26T10:00:00.000Z"
  }
}
```

**Business rules:**
- Bắt buộc gửi ít nhất 1 trong 2 field — body rỗng → 400 `EMPTY_UPDATE_PAYLOAD`.
- Chỉ organizer hoặc host của meeting mới được sửa — khác thì 403.
- Meeting đã `cancelled`/`completed` → 409 `INVALID_MEETING_STATUS`.
- Field không gửi giữ nguyên giá trị cũ (partial update).
- Ghi `meeting_events` (type: `metadata_updated`).
- Chi tiết: `spec/features/meeting/feat-update-meeting-metadata/spec.md`.

---

### UC-19 — Cập nhật thời gian họp

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/meetings/{meetingId}/schedule` |
| Permission | `meeting.update` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "startTime": "2026-06-10T10:00:00+07:00",
  "endTime": "2026-06-10T11:30:00+07:00",
  "reason": "Lùi giờ 1 tiếng",
  "notifyParticipants": true
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "meetingId": "uuid",
    "startTime": "2026-06-10T10:00:00+07:00",
    "endTime": "2026-06-10T11:30:00+07:00",
    "conflictCheck": { "hasConflict": false },
    "notificationQueued": true,
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- Kiểm tra conflict phòng với thời gian mới
- Cập nhật `room_bookings.reserved_start_time`, `reserved_end_time`
- Tạo `meeting_events` (type: `time_updated`)
- `409` — conflict phòng với thời gian mới

---

### UC-20 — Cập nhật phòng họp

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/meetings/{meetingId}/room` |
| Permission | `meeting.update` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "roomId": "uuid",
  "reason": "Phòng cũ bảo trì",
  "notifyParticipants": true
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "meetingId": "uuid",
    "room": { "id": "uuid", "roomCode": "R202", "roomName": "Phòng họp 202" },
    "oldBookingId": "uuid",
    "newBookingId": "uuid",
    "notificationQueued": true,
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- Cancel booking cũ, tạo booking mới
- Kiểm tra phòng mới còn trống
- `409` — phòng mới bị conflict

---

### UC-21 — Hủy cuộc họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/cancel` |
| Permission | `meeting.cancel` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "cancellationReason": "Sự kiện thay thế đã lên lịch",
  "notifyParticipants": true,
  "channels": ["email", "in_app"]
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "meetingId": "uuid",
    "status": "cancelled",
    "bookingReleased": true,
    "notificationQueued": true,
    "cancelledAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- Update `meetings.status = 'cancelled'`, `cancellation_reason`
- Release `room_bookings` (status: `cancelled`)
- Tạo `notifications` (type: `cancellation`)
- Ghi `meeting_events` (type: `meeting_cancelled`)

---

### UC-22 — Tra cứu lịch trình cá nhân

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/me/schedule` |
| Permission | `meeting.read.self` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query Parameters:**
```
?from=2026-06-01&to=2026-06-30&view=week&status=scheduled,in_progress
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "meetingCode": "MTG-001",
      "title": "Họp Sprint",
      "status": "scheduled",
      "startTime": "2026-06-10T09:00:00+07:00",
      "endTime": "2026-06-10T10:30:00+07:00",
      "room": { "id": "uuid", "roomName": "Phòng 101" },
      "myRole": "attendee",
      "invitationStatus": "accepted"
    }
  ],
  "meta": { "total": 12 }
}
```

---

### UC-23 — Thêm thành viên nội bộ thủ công

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/participants` |
| Permission | `meeting.participant.add` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "userIds": ["uuid1", "uuid2"],
  "participantRole": "attendee",
  "isRequired": true,
  "attendanceRequired": true,
  "notifyInvited": true
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "added": [
      {
        "id": "uuid",
        "userId": "uuid",
        "fullName": "Nguyễn Văn A",
        "participantRole": "attendee",
        "invitationStatus": "pending"
      }
    ],
    "skipped": [],
    "notificationQueued": true
  }
}
```

---

### UC-24 — Import thành viên bằng Excel

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/participants/import-jobs` |
| Permission | `meeting.participant.import` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request:** `multipart/form-data`, `file`: `.xlsx`

**Response 202:**
```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "status": "queued",
    "preview": {
      "validRows": 10,
      "invalidRows": 1,
      "errors": [{ "row": 3, "reason": "Email không tồn tại trong hệ thống" }]
    }
  }
}
```

---

### UC-25 — Gỡ bỏ thành viên nội bộ

| Field | Value |
|---|---|
| Method | `DELETE` |
| Endpoint | `/api/v1/meetings/{meetingId}/participants/{participantId}` |
| Permission | `meeting.participant.remove` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "removed": true,
    "participantId": "uuid",
    "notificationQueued": true
  }
}
```

---

### UC-26 — Tạo agenda cuộc họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/agendas` |
| Permission | `meeting.agenda.create` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "agendaOrder": 1,
  "title": "Báo cáo sprint",
  "description": "Nội dung chi tiết",
  "ownerId": "uuid",
  "plannedDurationMinutes": 30
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "agendaOrder": 1,
    "title": "Báo cáo sprint",
    "status": "planned",
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-27 — Xem agenda cuộc họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/agendas` |
| Permission | `meeting.agenda.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "agendaOrder": 1,
      "title": "Báo cáo sprint",
      "description": "...",
      "owner": { "id": "uuid", "fullName": "Nguyễn Văn A" },
      "plannedDurationMinutes": 30,
      "actualDurationMinutes": null,
      "status": "planned"
    }
  ]
}
```

---

### UC-28 — Chỉnh sửa agenda

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/meetings/{meetingId}/agendas/{agendaId}` |
| Permission | `meeting.agenda.update` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body (tất cả optional):**
```json
{
  "title": "Báo cáo sprint - cập nhật",
  "description": "...",
  "agendaOrder": 2,
  "ownerId": "uuid",
  "plannedDurationMinutes": 45,
  "status": "in_progress"
}
```

**Response 200:** Full agenda object

---

### UC-29 — Xóa agenda

| Field | Value |
|---|---|
| Method | `DELETE` |
| Endpoint | `/api/v1/meetings/{meetingId}/agendas/{agendaId}` |
| Permission | `meeting.agenda.delete` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{ "success": true, "data": { "deleted": true, "agendaId": "uuid" } }
```

---

### UC-30 — Cấu hình tính năng ghi hình cho cuộc họp

> ✅ **Đã implement (REC-001)** — `spec/features/recording/feat-configure-recording`.

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/recording-config` |
| Permission | `recording.config.create` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "enableAudio": true,
  "enableVideo": true,
  "enableTranscription": false,
  "videoSourceDeviceId": "uuid",
  "audioSourceMode": "room_mix",
  "autoStart": false,
  "consentRequired": true,
  "retentionDays": 30
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "enableAudio": true,
    "enableVideo": true,
    "status": "draft",
    "configuredAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- `409` — đã có cấu hình recording cho meeting này

---

### UC-31 — Tạo chuỗi họp định kỳ

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/recurrence` |
| Permission | `meeting.create` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "title": "Weekly Standup",
  "startTime": "09:00",
  "endTime": "09:30",
  "timezone": "Asia/Ho_Chi_Minh",
  "roomId": "uuid",
  "recurrenceRule": {
    "recurrenceType": "weekly",
    "intervalValue": 1,
    "daysOfWeek": "MO,WE,FR",
    "startDate": "2026-06-09",
    "endDate": "2026-08-29",
    "timezone": "Asia/Ho_Chi_Minh"
  },
  "participantUserIds": ["uuid1"],
  "requireApproval": false
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "recurrenceRuleId": "uuid",
    "jobId": "uuid",
    "status": "queued",
    "preview": {
      "totalOccurrences": 39,
      "conflictWarnings": 2
    }
  }
}
```

---

### UC-32 — Xem chuỗi họp định kỳ

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/recurrence/{recurrenceRuleId}/occurrences` |
| Permission | `meeting.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-06-01&to=2026-08-31&page=1&limit=20`

**Response 200:** Danh sách meetings trong chuỗi

---

### UC-33 — Chỉnh sửa chuỗi họp định kỳ

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/meetings/recurrence/{recurrenceRuleId}` |
| Permission | `meeting.update` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "scope": "all",
  "title": "Weekly Standup - updated",
  "notifyParticipants": true
}
```

- `scope` enum: `all` (cả chuỗi), `this_and_future` (từ occurrence này), `this_only`

---

### UC-34 — Hủy chuỗi họp định kỳ

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/recurrence/{recurrenceRuleId}/cancel` |
| Permission | `meeting.cancel` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "scope": "all",
  "cancellationReason": "Thay thế bằng họp định kỳ mới",
  "notifyParticipants": true
}
```

---

### UC-35 — Đặt phòng họp đột xuất (Ad-hoc)

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/ad-hoc` |
| Permission | `meeting.create.adhoc` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "title": "Họp khẩn",
  "roomId": "uuid",
  "startTime": "2026-06-03T14:00:00+07:00",
  "endTime": "2026-06-03T15:00:00+07:00",
  "participantUserIds": ["uuid1", "uuid2"],
  "forceOverrideConflicts": false,
  "priority": "high"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingCode": "MTG-ADHOC-001",
    "status": "scheduled",
    "conflictWarnings": [
      { "type": "participant_conflict", "userId": "uuid", "conflictingMeetingId": "uuid" }
    ],
    "bookingId": "uuid",
    "createdAt": "2026-06-03T14:00:00+07:00"
  }
}
```

- Cảnh báo conflict participant nhưng không block (có `forceOverrideConflicts`)
- Block nếu phòng bị conflict cứng

---

## 4. Room Utilization Management

**Module:** `utilization`, `rooms` | **Tables:** `rooms`, `room_bookings`, `room_booking_usages`, `no_show_cases`, `room_events`, `system_configs`
**System Roles:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`, `INTERNAL_SERVICE`

### UC-36 — Xem tổng quan trạng thái phòng realtime

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/rooms/realtime-status` |
| Permission | `room.utilization.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?siteName=Tòa nhà A&areaName=Tầng 3`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "roomId": "uuid",
      "roomCode": "R101",
      "roomName": "Phòng họp 101",
      "currentStatus": "occupied",
      "currentBooking": {
        "meetingId": "uuid",
        "meetingTitle": "Họp Sprint",
        "hostName": "Nguyễn Văn A",
        "reservedEndTime": "2026-06-03T10:30:00+07:00"
      },
      "occupancyCount": 5,
      "noShowStatus": null,
      "lastPresenceAt": "2026-06-03T09:05:00+07:00"
    }
  ]
}
```

---

### UC-37 — Tìm kiếm phòng họp khả dụng

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/rooms` |
| Permission | `room.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:**
```
?q=&minCapacity=5&maxCapacity=20&siteName=Tòa A&status=available&hasCamera=true&startTime=2026-06-10T09:00:00+07:00&endTime=2026-06-10T11:00:00+07:00&page=1&limit=20
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "roomCode": "R101",
      "roomName": "Phòng họp 101",
      "capacity": 15,
      "roomType": "meeting_room",
      "currentStatus": "available",
      "siteName": "Tòa A",
      "areaName": "Tầng 3",
      "hasCamera": true,
      "hasMicrophone": true,
      "hasDisplay": true,
      "allowRecording": true,
      "availability": {
        "available": true,
        "conflictingBookings": []
      }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 8, "totalPages": 1 }
}
```

---

### UC-38 — Xem chi tiết trạng thái phòng

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/rooms/{roomId}/status` |
| Permission | `room.utilization.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "roomId": "uuid",
    "roomCode": "R101",
    "currentStatus": "occupied",
    "currentBooking": {
      "bookingId": "uuid",
      "meetingId": "uuid",
      "title": "Họp Sprint",
      "hostName": "Nguyễn Văn A",
      "reservedStartTime": "2026-06-03T09:00:00+07:00",
      "reservedEndTime": "2026-06-03T10:30:00+07:00"
    },
    "noShowCase": {
      "id": "uuid",
      "detectionStatus": "warning_sent",
      "warningDeadlineAt": "2026-06-03T09:20:00+07:00"
    },
    "releaseHistory": [],
    "lastPresenceAt": "2026-06-03T09:10:00+07:00",
    "occupancyCount": 5
  }
}
```

---

### UC-39 — Xem lịch sử sử dụng phòng

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/rooms/{roomId}/usage-history` |
| Permission | `room.utilization.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31&page=1&limit=20`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "bookingId": "uuid",
      "meetingId": "uuid",
      "reservedStartTime": "2026-05-10T09:00:00+07:00",
      "reservedEndTime": "2026-05-10T10:30:00+07:00",
      "actualStartTime": "2026-05-10T09:05:00+07:00",
      "actualEndTime": "2026-05-10T10:25:00+07:00",
      "usageStatus": "completed",
      "autoReleased": false
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
}
```

---

### UC-40 — Xem tỷ lệ sử dụng phòng

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/rooms/{roomId}/utilization` |
| Permission | `room.utilization.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "roomId": "uuid",
    "from": "2026-05-01",
    "to": "2026-05-31",
    "reservationUtilizationRate": 72.5,
    "roomOccupancyRate": 65.2,
    "totalBookedHours": 87.5,
    "actualUsedHours": 65.2,
    "availableWorkingHours": 120,
    "noShowCount": 5,
    "noShowRate": 8.3
  }
}
```

---

### UC-41 — Tạo trường hợp no-show

**API nội bộ (được gọi bởi scheduler/camera service):**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/no-show-cases` |
| Permission | `internal.system.noshow` |
| System Role | `INTERNAL_SERVICE` |
| Async | No |

**Request Body:**
```json
{
  "bookingId": "uuid",
  "meetingId": "uuid",
  "roomId": "uuid",
  "detectionStatus": "risk",
  "evidenceJson": {
    "occupancyCount": 0,
    "cameraConfidence": 0.95,
    "threshold": 10,
    "detectedAt": "2026-06-03T09:12:00+07:00"
  }
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "noShowCaseId": "uuid",
    "bookingId": "uuid",
    "detectionStatus": "risk",
    "detectedAt": "2026-06-03T09:12:00+07:00"
  }
}
```

---

### UC-42 — Cập nhật trường hợp no-show

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/no-show-cases/{noShowCaseId}` |
| Permission | `room.noshow.update` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "detectionStatus": "dismissed",
  "resolutionStatus": "false_positive",
  "note": "Hóa ra cuộc họp đã di chuyển sang phòng khác"
}
```

**Response 200:** Full no-show case object

---

### UC-43 — Gửi cảnh báo no-show trước khi release

**API nội bộ (được gọi bởi scheduler):**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/no-show-cases/{noShowCaseId}/warn` |
| Permission | `internal.system.noshow` |
| System Role | `INTERNAL_SERVICE` |
| Async | Yes |

**Response 202:** Tạo notification, update `warning_sent_at`

---

### UC-44 — Tự động giải phóng phòng sau no-show

**API nội bộ:**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/no-show-cases/{noShowCaseId}/auto-release` |
| Permission | `internal.system.noshow` |
| System Role | `INTERNAL_SERVICE` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "noShowCaseId": "uuid",
    "released": true,
    "releasedAt": "2026-06-03T09:25:00+07:00",
    "roomStatus": "available"
  }
}
```

---

### UC-45 — Giải phóng phòng thủ công

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/rooms/{roomId}/release` |
| Permission | `room.release` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "bookingId": "uuid",
  "releaseReason": "Host xác nhận cuộc họp không diễn ra",
  "note": "Ghi chú thêm"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "roomId": "uuid",
    "bookingId": "uuid",
    "released": true,
    "releasedAt": "2026-06-03T09:15:00+07:00",
    "releasedBy": "uuid",
    "roomStatus": "available"
  }
}
```

- Cập nhật `room_booking_usages.usage_status = 'released'`, `released_at`
- Cập nhật `rooms.current_status = 'available'`
- Ghi `room_events` (type: `room_released`)

---

### UC-46 — Phát hiện phòng trống sớm

**API nội bộ (gọi bởi camera service):**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/rooms/{roomId}/early-vacancy` |
| Permission | `internal.system.camera` |
| System Role | `INTERNAL_SERVICE` |
| Async | No |

**Request Body:**
```json
{
  "bookingId": "uuid",
  "meetingId": "uuid",
  "detectedAt": "2026-06-03T09:50:00+07:00",
  "confidence": 0.92
}
```

**Response 200:** Cập nhật `room_booking_usages.usage_status = 'early_empty'`

---

### UC-47 — Cấu hình ngưỡng no-show

| Field | Value |
|---|---|
| Method | `PUT` |
| Endpoint | `/api/v1/system-configs/no-show-threshold` |
| Permission | `admin.config.update` |
| System Role | `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "configKey": "no_show.threshold_minutes",
  "configJson": {
    "warningAfterMinutes": 10,
    "autoReleaseAfterMinutes": 20,
    "minOccupancyToCancel": 1
  },
  "versionNo": 1
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "configId": "uuid",
    "configKey": "no_show.threshold_minutes",
    "versionNo": 2,
    "isActive": true,
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-48 — Cấu hình ngưỡng phòng trống sớm

| Field | Value |
|---|---|
| Method | `PUT` |
| Endpoint | `/api/v1/system-configs/early-vacancy-threshold` |
| Permission | `admin.config.update` |
| System Role | `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "configKey": "room_utilization.early_vacancy_threshold_minutes",
  "configJson": {
    "emptyDurationBeforeRelease": 15,
    "minConfidenceScore": 0.8
  }
}
```

---

### UC-49 — Xuất báo cáo sử dụng phòng

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/rooms/usage-report/exports` |
| Permission | `report.room_usage.export` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "from": "2026-05-01",
  "to": "2026-05-31",
  "roomIds": ["uuid"],
  "format": "xlsx",
  "sections": ["utilization", "no_show", "history"],
  "delivery": "download"
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "status": "queued",
    "estimatedCompletion": "2026-06-03T10:05:00+07:00"
  }
}
```

---

## 5. Scheduling Management

**Module:** `scheduling` | **Tables:** `meetings`, `room_bookings`, `meeting_participants`, `meeting_requests`
**System Roles:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### UC-50 — Xem danh sách phòng họp đề xuất

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/scheduling/room-suggestions` |
| Permission | `scheduling.suggest.rooms` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:**
```
?startTime=2026-06-10T09:00:00+07:00&endTime=2026-06-10T11:00:00+07:00&attendeeCount=10&roomType=meeting_room&siteName=Tòa A&hasCamera=true
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "roomId": "uuid",
      "roomCode": "R101",
      "roomName": "Phòng họp 101",
      "capacity": 15,
      "score": 92.5,
      "available": true,
      "matchedFeatures": ["camera", "microphone", "display"],
      "warnings": []
    }
  ]
}
```

---

### UC-51 — Chọn khung giờ họp tối ưu

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/scheduling/time-suggestions` |
| Permission | `scheduling.suggest.times` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "participantUserIds": ["uuid1", "uuid2", "uuid3"],
  "durationMinutes": 60,
  "dateRange": { "from": "2026-06-09", "to": "2026-06-14" },
  "workingHours": { "start": "08:00", "end": "18:00" },
  "roomRequirement": { "minCapacity": 5, "hasCamera": false }
}
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "startTime": "2026-06-10T09:00:00+07:00",
      "endTime": "2026-06-10T10:00:00+07:00",
      "availableParticipants": 3,
      "totalParticipants": 3,
      "conflicts": [],
      "score": 100
    }
  ]
}
```

---

### UC-52 — Xử lý tự động xung đột đặt phòng

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/scheduling/room-conflicts/check` |
| Permission | `scheduling.conflict.room.check` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "roomId": "uuid",
  "startTime": "2026-06-10T09:00:00+07:00",
  "endTime": "2026-06-10T11:00:00+07:00",
  "meetingId": "uuid"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "hasConflict": true,
    "conflicts": [
      {
        "bookingId": "uuid",
        "meetingId": "uuid",
        "meetingTitle": "Họp khác",
        "overlapStart": "2026-06-10T09:30:00+07:00",
        "overlapEnd": "2026-06-10T10:00:00+07:00"
      }
    ],
    "suggestedRooms": [{ "roomId": "uuid", "roomName": "Phòng 202" }],
    "blocking": true
  }
}
```

---

### UC-53 — Xử lý tự động xung đột lịch participant

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/scheduling/participant-conflicts/check` |
| Permission | `scheduling.conflict.participant.check` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "participantUserIds": ["uuid1", "uuid2"],
  "startTime": "2026-06-10T09:00:00+07:00",
  "endTime": "2026-06-10T11:00:00+07:00",
  "meetingId": "uuid"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "hasConflict": true,
    "participantConflicts": [
      {
        "userId": "uuid",
        "fullName": "Nguyễn Văn A",
        "overlappingMeetings": [
          { "meetingId": "uuid", "title": "Họp khác", "startTime": "..." }
        ]
      }
    ],
    "suggestedTimes": []
  }
}
```

---

### UC-54 — Phê duyệt yêu cầu đặt phòng

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meeting-requests/{requestId}/approve` |
| Permission | `meeting_request.approve` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "decisionNote": "Đã kiểm tra, phê duyệt"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "approvalStatus": "approved",
    "meetingId": "uuid",
    "bookingId": "uuid",
    "appliedAt": "2026-06-03T10:00:00+07:00",
    "notificationQueued": true
  }
}
```

---

### UC-55 — Từ chối yêu cầu đặt phòng

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meeting-requests/{requestId}/reject` |
| Permission | `meeting_request.reject` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "rejectionReason": "Phòng đã được ưu tiên cho sự kiện khác"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "approvalStatus": "rejected",
    "decisionAt": "2026-06-03T10:00:00+07:00",
    "notificationQueued": true
  }
}
```

---

## 6. Room Management

**Module:** `rooms` | **Tables:** `rooms`, `iot_devices`, `equipments`
**System Roles:** `INTERNAL_USER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### UC-56 — Tạo phòng họp mới

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/rooms` |
| Permission | `room.create` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "roomCode": "R301",
  "roomName": "Phòng họp 301",
  "siteName": "Tòa nhà A",
  "areaName": "Tầng 3",
  "locationDescription": "Gần cầu thang máy",
  "capacity": 12,
  "roomType": "meeting_room",
  "hasCamera": true,
  "hasMicrophone": true,
  "hasDisplay": true,
  "allowRecording": true,
  "layoutJson": { "seats": [] }
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "roomCode": "R301",
    "roomName": "Phòng họp 301",
    "capacity": 12,
    "currentStatus": "available",
    "isActive": true,
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-57 — Cập nhật thông tin phòng họp

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/rooms/{roomId}` |
| Permission | `room.update` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body (tất cả optional):**
```json
{
  "roomName": "Phòng họp 301 - Updated",
  "capacity": 15,
  "siteName": "Tòa A",
  "areaName": "Tầng 3",
  "locationDescription": "...",
  "roomType": "board_room",
  "hasCamera": true,
  "hasMicrophone": true,
  "hasDisplay": true,
  "allowRecording": true,
  "isActive": true
}
```

---

### UC-58 — Xóa phòng họp (soft delete)

| Field | Value |
|---|---|
| Method | `DELETE` |
| Endpoint | `/api/v1/rooms/{roomId}` |
| Permission | `room.delete` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Query:** `?confirm=true`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "affectedFutureMeetings": 3,
    "notificationsQueued": true
  }
}
```

---

### UC-59 — Tìm kiếm phòng họp
**System Role:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

> Sử dụng chung `GET /api/v1/rooms` với UC-37. Xem query parameters tại [UC-37](#uc-37--tìm-kiếm-phòng-họp-khả-dụng).

---

### UC-60 — Gán camera nhận diện vào phòng

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/rooms/{roomId}/cameras` |
| Permission | `room.device.assign` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "deviceCode": "CAM-R301-01",
  "deviceName": "Camera IP Room 301",
  "deviceType": "ip_camera",
  "streamUrl": "rtsp://192.168.1.50/live/main",
  "ipAddress": "192.168.1.50",
  "serialNumber": "SN123456",
  "previewRequired": true
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "deviceId": "uuid",
    "roomId": "uuid",
    "status": "offline",
    "streamAvailable": false,
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

**Kiểm tra kết nối camera:**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/iot-devices/{deviceId}/connection-test` |
| Permission | `room.device.assign` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "reachable": true,
    "latencyMs": 45,
    "previewFrameFileId": "uuid"
  }
}
```

---

## 7. Equipment Management

**Module:** `equipment` | **Tables:** `equipments`, `audit_logs`
**System Roles:** `INTERNAL_USER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### UC-61 — Đăng ký thiết bị họp mới

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/equipments` |
| Permission | `equipment.create` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "equipmentCode": "EQ-TV-001",
  "equipmentName": "Smart TV 75 inch - Phòng 301",
  "equipmentType": "display",
  "serialNumber": "SN-TV-20260101",
  "brand": "Samsung",
  "model": "QN75QN90C",
  "purchaseDate": "2026-01-15",
  "specificationJson": { "resolution": "4K", "hdmiPorts": 4 }
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "equipmentCode": "EQ-TV-001",
    "equipmentName": "Smart TV 75 inch",
    "equipmentType": "display",
    "assetStatus": "available",
    "healthStatus": "healthy",
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-62 — Cập nhật trạng thái lỗi thiết bị

**62a. Báo lỗi:**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/equipments/{equipmentId}/issue-reports` |
| Permission | `equipment.issue.report` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "description": "Màn hình bị nhòe ở góc phải",
  "roomId": "uuid",
  "severity": "warning",
  "evidenceFileIds": ["uuid"]
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "equipmentId": "uuid",
    "healthStatus": "warning",
    "reportStatus": "pending_check",
    "reportedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

**62b. Cập nhật health status:**

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/equipments/{equipmentId}/health-status` |
| Permission | `equipment.status.update` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "healthStatus": "faulty",
  "note": "Cần thay linh kiện"
}
```

---

### UC-63 — Xóa thiết bị (soft delete)

| Field | Value |
|---|---|
| Method | `DELETE` |
| Endpoint | `/api/v1/equipments/{equipmentId}` |
| Permission | `equipment.delete` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?confirm=true`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "unassignedFromRoomId": "uuid"
  }
}
```

---

### UC-64 — Tìm kiếm kho thiết bị

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/equipments` |
| Permission | `equipment.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?q=&equipmentType=display&assetStatus=available&healthStatus=healthy&roomId=uuid&page=1&limit=20`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "equipmentCode": "EQ-TV-001",
      "equipmentName": "Smart TV 75 inch",
      "equipmentType": "display",
      "assetStatus": "assigned",
      "healthStatus": "healthy",
      "currentRoom": { "id": "uuid", "roomName": "Phòng 301" },
      "brand": "Samsung",
      "model": "QN75QN90C"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 30, "totalPages": 2 }
}
```

---

### UC-65 — Phân bổ thiết bị vào phòng họp

| Field | Value |
|---|---|
| Method | `PUT` |
| Endpoint | `/api/v1/equipments/{equipmentId}/room-assignment` |
| Permission | `equipment.assign` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "roomId": "uuid",
  "assignmentNote": "Lắp đặt tại tường chính phòng 301"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "equipmentId": "uuid",
    "roomId": "uuid",
    "previousRoomId": null,
    "assetStatus": "assigned",
    "assignedAt": "2026-06-03T10:00:00+07:00",
    "assignmentNote": "Lắp đặt tại tường chính phòng 301"
  }
}
```

---

### UC-66 — Kiểm tra trạng thái khả dụng thiết bị

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/equipments/{equipmentId}/availability` |
| Permission | `equipment.read.availability` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?startTime=2026-06-10T09:00:00+07:00&endTime=2026-06-10T11:00:00+07:00`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "equipmentId": "uuid",
    "assetStatus": "assigned",
    "healthStatus": "healthy",
    "currentRoom": { "id": "uuid", "roomName": "Phòng 301" },
    "availableForBooking": true,
    "blockingReason": null,
    "lastSeenAt": "2026-06-03T09:00:00+07:00"
  }
}
```

---

## 8. IoT Device Management

**Module:** `iot` | **Tables:** `iot_devices`, `iot_device_events`, `capture_sessions`, `capture_session_channels`
**System Roles:** `BUSINESS_ADMIN`, `SYSTEM_ADMIN`, `INTERNAL_SERVICE`

### UC-67 — Đăng ký thiết bị camera/IoT

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/iot-devices` |
| Permission | `iot.device.create` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "deviceCode": "FACE-DOOR-01",
  "deviceName": "Face Server - Cửa chính",
  "deviceType": "face_server",
  "roomId": "uuid",
  "ipAddress": "192.168.1.10",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "networkIdentifier": "face-server-main",
  "streamUrl": null,
  "agentVersion": "v2.3.1",
  "metadataJson": {
    "manufacturer": "Hikvision",
    "callbackToken": null
  }
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "deviceCode": "FACE-DOOR-01",
    "deviceName": "Face Server - Cửa chính",
    "deviceType": "face_server",
    "status": "offline",
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-68 — Cấu hình kết nối Face Server

| Field | Value |
|---|---|
| Method | `PUT` |
| Endpoint | `/api/v1/iot-devices/{deviceId}/face-server-config` |
| Permission | `iot.device.configure` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "ipAddress": "192.168.1.10",
  "callbackUrl": "https://backend.company.com/api/v1/internal/face-server/callbacks",
  "callbackTokenRef": "secret-ref-key",
  "generateOneTimeToken": true
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "deviceId": "uuid",
    "callbackUrl": "https://...",
    "oneTimeToken": "abc123xyz",
    "tokenExpiresAt": "2026-06-03T11:00:00+07:00",
    "configuredAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-69 — Cấu hình RTSP cho IP Room Camera

| Field | Value |
|---|---|
| Method | `PUT` |
| Endpoint | `/api/v1/iot-devices/{deviceId}/rtsp-config` |
| Permission | `iot.device.configure` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "streamUrl": "rtsp://192.168.1.50/live/main",
  "channelCount": 1,
  "codec": "H264",
  "resolution": "1920x1080",
  "fps": 25
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "deviceId": "uuid",
    "streamUrl": "rtsp://...",
    "channelCount": 1,
    "codec": "H264",
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### IOT-011 (Feature #12) — Cập nhật thông tin thiết bị IoT/Camera

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/iot-devices/{deviceId}` |
| Permission | `iot.device.update` |
| Async | No |

> Spec: `spec/features/iot/feat-update-iot-device` (IOT-011). Chỉ cập nhật trường mô tả/kết nối tổng quát. Các field ngoài allowlist bị từ chối 400 (`forbidNonWhitelisted`). Không sửa `room_id` (dùng assign-room), `stream_url` (UC-69), Face Server config (UC-68), `status`/`health_status`/`last_seen_at` (hệ thống tự quản), `device_code`/`device_type` (bất biến), `metadata_json`/`equipment_id`/`agent_version`/`firmware_version`/`mqtt_topic` (ngoài phạm vi).

> **Casing**: wire-format thực tế dùng **snake_case** (DTO input `@Expose` snake + presenter `toIotDeviceResponse()` xuất snake). Ví dụ dưới đây bám đúng code thật. (Lưu ý: ví dụ UC-67 ở trên đang minh hoạ camelCase nhưng response thật của create cũng là snake_case — UC-67 nên được đồng bộ riêng.)

**Request Body (partial — chỉ 4 trường allowlist, snake_case):**
```json
{
  "device_name": "Camera góc phòng họp A — tầng 3",
  "ip_address": "192.168.1.51",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "network_identifier": "ipcam-a3-floor3"
}
```

**Response 200 (full device, snake_case — theo `toIotDeviceResponse`):**
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
    "created_by_name": null,
    "created_at": "2026-06-03T10:00:00+07:00",
    "updated_at": "2026-06-15T09:05:00+07:00"
  }
}
```

- `409 MAC_ADDRESS_EXISTS` nếu `mac_address` mới trùng thiết bị khác.
- `404 IOT_DEVICE_NOT_FOUND` nếu không tìm thấy `{deviceId}`.
- Ghi `audit_logs` (action_type: `update`, entity_type: `iot_devices`).

---

### IOT-012 (Feature #13) — Vô hiệu hóa / Kích hoạt lại thiết bị IoT/Camera

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/iot-devices/{deviceId}/disable` · `/api/v1/iot-devices/{deviceId}/enable` |
| Permission | `iot.device.disable` (disable) · `iot.device.enable` (enable) |
| Async | No |

> Spec: `spec/features/iot/feat-disable-enable-iot-device` (IOT-012). 2 action endpoint **không body**, trả **200** (`@HttpCode(200)`). Soft theo **ADR-008**: chỉ đổi cột `status`, KHÔNG hard-delete/`deleted_at`, giữ `iot_device_events`. KHÔNG chạm `health_status`/`last_seen_at`/`room_id`/`metadata_json`. Idempotent: disable khi đã `disabled` (hoặc enable khi khác `disabled`) → 200 no-op, không ghi/audit.

**Chuyển trạng thái:** disable: bất kỳ → `disabled`. enable: `disabled` → `offline` (chờ heartbeat cập nhật `online`).

**Request Body:** (không) — `{deviceId}` qua path, `ParseUUIDPipe`.

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

> Enable trả `"status": "offline"` và `"message": "IoT device enabled successfully"`. `health_status`/`last_seen_at`/`room_id`/`metadata_json` giữ nguyên giá trị cũ (chỉ `status` đổi).

- `404 IOT_DEVICE_NOT_FOUND` nếu không tìm thấy `{deviceId}`; sai UUID → 400.
- Ghi `audit_logs` (action_type: `disable` | `enable`, entity_type: `iot_devices`, `changed_fields.status` = { old, new }).

---

### IOT-013 (Feature #14) — Liệt kê & Xem chi tiết thiết bị IoT/Camera

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/iot-devices` (list) · `/api/v1/iot-devices/{deviceId}` (detail) |
| Permission | `iot.device.read` (cả 2) |
| Async | No |

> Spec: `spec/features/iot/feat-list-iot-devices` (IOT-013). **Read-only** (không audit). List trả MỌI status (kể cả `disabled`); `status` filter để thu hẹp. Sort cố định `created_at DESC`. **`data[]` snake_case** (theo `toIotDeviceResponse`, mask `metadata_json`); **`meta` camelCase** (theo CLAUDE.md §8.4).

**List query params:**

| Param | Type | Default | Validation |
|---|---|---|---|
| `page` | int | 1 | min 1 |
| `limit` | int | 20 | min 1, **max 100** (>100 → 400) |
| `status` | enum | — | `online\|offline\|disabled\|maintenance` |
| `device_type` | enum | — | `ip_camera\|door_camera\|room_camera\|face_server\|microphone\|capture_agent\|occupancy_sensor\|display` |
| `room_id` | uuid | — | UUID v4 |
| `search` | string | — | max 200, ILIKE trên `device_name`/`device_code` |

**Response 200 (List):**
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

**Response 200 (Detail):** `{ success, message: "IoT device retrieved successfully", data: <full device snake_case theo toIotDeviceResponse> }`.

- `400 VALIDATION_ERROR` nếu page/limit/enum/uuid/search sai hoặc `limit > 100`; detail `{deviceId}` sai UUID → 400.
- `404 IOT_DEVICE_NOT_FOUND` (detail) nếu không tìm thấy thiết bị. List rỗng → 200 `data: []`, `meta.total = 0`.

---

### IOT-014 (Feature #15) — Phát hiện camera offline bằng Active Probe

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/iot-devices/probe-status` |
| Permission | `iot.device.probe` |
| HTTP code | `200` (`@HttpCode(200)`) |
| Body | (không) |
| Async | No |

> Spec: `spec/features/iot/feat-detect-offline-devices` (IOT-014). Backend **active TCP probe** tới `host:port` RTSP của từng `ip_camera` (parse `stream_url`, fallback `ip_address:554`, validate port 1–65535); mở được → `online`, timeout/refuse → `offline`. Chỉ maintain camera `status ∈ {online, offline}` (**bỏ** `disabled`/`maintenance`). Chỉ đổi cột `status`; transition mới ghi `audit_logs` (`auto_online`/`auto_offline`). Idempotent: trạng thái không đổi → không ghi.
>
> **Cron**: chạy mỗi phút (`CronExpression.EVERY_MINUTE`, name `device-offline-detect`) **cùng logic** `detectOfflineDevices`, gate `SCHEDULER_ENABLED && DEVICE_OFFLINE_DETECT_ENABLED` (actor = null). **Endpoint** dưới đây là bản chạy tay (admin), **không** gate ENV (actor = user JWT).

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

- `checked` = số camera thực sự probe (đã trừ disabled/maintenance/không-địa-chỉ). `transitions` chỉ gồm camera đổi trạng thái.
- `401 UNAUTHORIZED` nếu thiếu JWT; `403 FORBIDDEN` nếu thiếu `iot.device.probe`.
- Ghi `audit_logs` (action_type: `auto_online` | `auto_offline`, entity_type: `iot_devices`, `changed_fields.status` = { old, new }).
- **Config**: `DEVICE_OFFLINE_DETECT_ENABLED` (default true), `RTSP_PROBE_TIMEOUT_MS` (default 3000). v1 chỉ TCP-connect (không ffprobe/RTSP auth); probe song song cap 10.

---

### UC-70 — Nhận heartbeat từ Face Server

**Internal callback endpoint:**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/face-server/heartbeat` |
| Permission | `internal.device.callback` |
| System Role | `INTERNAL_SERVICE` |
| Async | No |

**Request Headers:** `X-Device-Token: <callback-token>`

**Request Body:**
```json
{
  "deviceCode": "FACE-DOOR-01",
  "eventTime": "2026-06-03T10:00:00+07:00",
  "status": "online",
  "firmwareVersion": "v2.3.1",
  "metadata": {}
}
```

**Response 202:**
```json
{ "accepted": true }
```

- Cập nhật `iot_devices.last_seen_at`, `status = 'online'`
- Lưu `iot_device_events` (event_type: `heartbeat`)

---

### UC-71 — Nhận verify event từ Face Server

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/face-server/verify-events` |
| Permission | `internal.device.callback` |
| System Role | `INTERNAL_SERVICE` |
| Async | Yes |

**Request Body:**
```json
{
  "deviceCode": "FACE-DOOR-01",
  "personId": "person-123",
  "personCode": "NV001",
  "score": 0.97,
  "eventTime": "2026-06-03T09:02:00+07:00",
  "imageRef": "frame_base64_or_url",
  "metadata": {}
}
```

**Response 202:** `{ "accepted": true, "rawEventId": "uuid" }`

- Lưu raw event vào `iot_device_events`
- Enqueue job normalize & mapping → tạo `attendance_events`

---

### UC-72 — Nhận stranger event từ Face Server

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/face-server/stranger-events` |
| Permission | `internal.device.callback` |
| System Role | `INTERNAL_SERVICE` |
| Async | Yes |

**Request Body:**
```json
{
  "deviceCode": "FACE-DOOR-01",
  "eventTime": "2026-06-03T09:05:00+07:00",
  "imageRef": "frame_url",
  "confidence": 0.89,
  "metadata": {}
}
```

**Response 202:** Tạo unknown face alert notification

> **[Ghi chú 2026-07-27, BE-10]** Stranger event từ endpoint này ĐỒNG THỜI được ghi vào bảng `security_alerts` thật (qua `AlertsService.recordAlert()`, `alertType: 'stranger'`) — xử lý ACKNOWLEDGE/RESOLVE cho stranger alert đi qua `POST /api/v1/security-alerts/{id}/acknowledge` / `POST /api/v1/security-alerts/{id}/resolve` (module `alerts`, nhóm "Trung tâm cảnh báo an ninh" SAVP — UC-122/123 theo numbering spec-kit riêng, KHÔNG phải UC-122/123 của tài liệu này nếu trùng số; toàn bộ nhóm endpoint `security-alerts` **CHƯA được đưa vào tài liệu này**, nợ tài liệu ghi ở Phụ lục F). **KHÔNG có** endpoint `PATCH /face-access/stranger-alerts/{id}/resolve` riêng — `GET /face-access/stranger-alerts` chỉ là view tổng hợp `GROUP BY` trên `iot_device_events`, không có `id` ổn định để PATCH. Chi tiết: `spec/features/face-access/feat-resolve-stranger-alert/`.

---

### UC-73 — Lưu raw event từ thiết bị camera
**System Role:** `INTERNAL_SERVICE`

> Tất cả callback endpoints (UC-70, UC-71, UC-72, UC-75) đều lưu raw payload vào `iot_device_events` trước khi xử lý. Xem chi tiết tại từng endpoint tương ứng.

---

### UC-74 — Chuẩn hóa payload sự kiện camera
**System Role:** `INTERNAL_SERVICE`

**Internal process (không phải HTTP endpoint trực tiếp):**

Sau khi nhận raw event từ UC-70/71/72, backend normalize payload:
- Map vendor-specific fields → internal format
- Tạo `attendance_events` hoặc `presence_snapshots` phù hợp
- Cập nhật `room_booking_usages`

---

### UC-75 — Nhận occupancy event từ Python Camera Service

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/camera-service/occupancy-events` |
| Permission | `internal.device.callback` |
| System Role | `INTERNAL_SERVICE` |
| Async | Yes |

**Request Body:**
```json
{
  "deviceCode": "CAM-R301-01",
  "roomId": "uuid",
  "meetingId": "uuid",
  "eventType": "occupancy_detected",
  "occupancyCount": 5,
  "confidence": 0.92,
  "eventTime": "2026-06-03T09:05:00+07:00",
  "metadata": {}
}
```

**Response 202:** `{ "accepted": true }`

- Lưu `iot_device_events`
- Tạo `presence_snapshots` (presence_status: `present`, occupancy_count: 5)
- Tạo `room_events` (event_type: `occupancy_detected`)
- Cập nhật `room_booking_usages.first_presence_at` nếu lần đầu

---

## 9. Device User Mapping

**Module:** `iot`, `attendance` | **Tables:** `device_user_mappings`, `face_profiles`
**System Roles:** `BUSINESS_ADMIN`, `SYSTEM_ADMIN`, `INTERNAL_SERVICE`

### UC-76 — Tạo mapping person với user hệ thống

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/device-user-mappings` |
| Permission | `device.user.mapping.create` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "deviceId": "uuid",
  "userId": "uuid",
  "faceProfileId": "uuid",
  "devicePersonId": "person-123",
  "devicePersonCode": "NV001",
  "devicePersonName": "Nguyễn Văn A",
  "faceRegistered": true
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "deviceId": "uuid",
    "userId": "uuid",
    "devicePersonId": "person-123",
    "syncStatus": "pending",
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-77 — Tra cứu user từ verify event

**Internal process sau khi nhận verify event (UC-71).**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/device-user-mappings/lookup` |
| Permission | `internal.system.mapping` |
| System Role | `INTERNAL_SERVICE` |
| Async | No |

**Request Body:**
```json
{
  "deviceId": "uuid",
  "devicePersonId": "person-123",
  "devicePersonCode": "NV001"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "found": true,
    "userId": "uuid",
    "fullName": "Nguyễn Văn A",
    "mappingId": "uuid"
  }
}
```

---

### UC-78 — Xử lý person chưa map được user

**Internal process:** Nếu UC-77 không tìm thấy mapping:
- Ghi log `iot_device_events` (event_type: `face_detected`, payload: `unmapped`)
- Tạo `attendance_events` (event_type: `unknown_face`)
- Gửi alert để admin xử lý thủ công

**Endpoint xem danh sách unmatched:**

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/device-user-mappings/unmatched` |
| Permission | `device.user.mapping.read` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?deviceId=uuid&page=1&limit=20`

---

## 10. Attendance & Presence Management

**Module:** `attendance`, `presence` | **Tables:** `attendance_records`, `attendance_events`, `presence_snapshots`, `face_profiles`
**System Roles:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`, `INTERNAL_SERVICE`

### UC-79 — Tạo điểm danh thủ công

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/attendance` |
| Permission | `attendance.create.manual` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "userId": "uuid",
  "checkInTime": "2026-06-10T09:05:00+07:00",
  "checkOutTime": null,
  "checkInMethod": "manual",
  "attendanceSource": "manual",
  "isPresent": true,
  "isLate": true,
  "lateMinutes": 5,
  "note": "Check-in thủ công do camera lỗi"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "userId": "uuid",
    "checkInMethod": "manual",
    "attendanceStatus": "present",
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-80 — Cập nhật trạng thái điểm danh

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/attendance-records/{recordId}` |
| Permission | `attendance.update` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "attendanceStatus": "present",
  "checkInTime": "2026-06-10T09:03:00+07:00",
  "checkOutTime": "2026-06-10T10:25:00+07:00",
  "isLate": false,
  "note": "Cập nhật sau khi xác minh từ camera"
}
```

**Response 200:** Full attendance record object

---

### UC-81 — Xem danh sách điểm danh cuộc họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/attendance` |
| Permission | `attendance.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user": { "id": "uuid", "fullName": "Nguyễn Văn A", "avatarUrl": "..." },
      "checkInMethod": "door_camera",
      "checkInTime": "2026-06-10T09:02:00+07:00",
      "checkOutTime": "2026-06-10T10:28:00+07:00",
      "attendanceStatus": "present",
      "isLate": false,
      "presenceDurationMinutes": 86,
      "confidenceScore": 0.97
    }
  ],
  "meta": { "total": 8, "presentCount": 7, "absentCount": 1 }
}
```

---

### UC-81b — Xem điểm danh trong phiên họp đang diễn ra (mới, 2026-07-27; = UC-101/UC-IMM-08)

> [P1 BE-05] Trước đợt này, `live-meeting.controller.ts` đăng ký TRÙNG path với UC-81 ở trên
> (`GET /meetings/{meetingId}/attendance`) — NestJS chỉ route tới 1 trong 2 handler tùy thứ tự
> import module, gãy âm thầm nếu đổi thứ tự. Đã tách path riêng. UC-81 (trên) là danh sách điểm
> danh chung, phân trang, không ràng buộc trạng thái phiên. UC-81b (dưới) là điểm danh TRONG một
> live-meeting session đang chạy — có audit ghi `ipAddress`/`userAgent`, trả `409` nếu meeting
> chưa `in_progress`/đã kết thúc. Spec: `spec/features/live-meeting/feat-view-participant-attendance-status/`.

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/attendance` |
| Permission | `attendance.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?q=&status=checked_in,late,absent&page=1&pageSize=20&sortBy=full_name&sortOrder=asc`

**Response 200:** cùng shape UC-81 (`participants[]` + `meta`), thêm ràng buộc: `409` nếu meeting chưa `in_progress`/đã `completed` mà chưa có bản ghi nào.

---

### UC-82 — Xem chi tiết một bản ghi điểm danh

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/attendance-records/{recordId}` |
| Permission | `attendance.read.detail` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "userId": "uuid",
    "fullName": "Nguyễn Văn A",
    "checkInMethod": "door_camera",
    "attendanceSource": "camera",
    "checkInTime": "2026-06-10T09:02:00+07:00",
    "checkOutTime": "2026-06-10T10:28:00+07:00",
    "firstDetectedAt": "2026-06-10T09:01:55+07:00",
    "lastDetectedAt": "2026-06-10T10:27:50+07:00",
    "isPresent": true,
    "isLate": false,
    "leftEarly": false,
    "presenceDurationMinutes": 86,
    "attendanceStatus": "present",
    "confidenceScore": 0.97,
    "verifiedBy": null,
    "note": null
  }
}
```

---

### UC-83 — Hủy hiệu lực bản ghi điểm danh

| Field | Value |
|---|---|
| Method | `DELETE` |
| Endpoint | `/api/v1/attendance-records/{recordId}` |
| Permission | `attendance.invalidate` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "invalidated": true,
    "recordId": "uuid",
    "attendanceStatus": "invalidated"
  }
}
```

- Soft delete (set `attendance_status = 'invalidated'`), giữ lịch sử

---

### UC-84 — Tạo điểm danh từ Face Server (cửa)

**Internal process sau UC-71:**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/attendance/face-checkin` |
| Permission | `internal.system.attendance` |
| System Role | `INTERNAL_SERVICE` |
| Async | No |

**Request Body:**
```json
{
  "userId": "uuid",
  "deviceId": "uuid",
  "roomId": "uuid",
  "meetingId": "uuid",
  "eventTime": "2026-06-10T09:02:00+07:00",
  "confidenceScore": 0.97,
  "evidenceRef": "frame_url"
}
```

**Response 201:** Tạo `attendance_records` + `attendance_events`

---

### UC-85 — Lưu sự kiện check-in từ Face Server
**System Role:** `INTERNAL_SERVICE`

> Được xử lý tự động trong flow UC-71 → UC-74 → UC-84. Lưu vào `attendance_events` (event_type: `check_in`).

---

### UC-86 — Cập nhật trạng thái hiện diện realtime
**System Role:** `INTERNAL_SERVICE`

**Internal process sau UC-75:**

- Tạo `presence_snapshots` từ occupancy event
- Push WebSocket event `room.occupancy.updated` đến dashboard subscribers

**WebSocket event format:**
```json
{
  "event": "room.occupancy.updated",
  "data": {
    "roomId": "uuid",
    "meetingId": "uuid",
    "occupancyCount": 5,
    "presenceStatus": "present",
    "timestamp": "2026-06-03T09:05:00+07:00"
  }
}
```

---

### UC-87 — Phát hiện khuôn mặt lạ
**System Role:** `INTERNAL_SERVICE`

**Internal process sau UC-72:**

- Tạo `attendance_events` (event_type: `unknown_face`)
- Tạo `notifications` (type: `unknown_face_alert`)
- Push WebSocket event đến admin dashboard

---

### UC-88 — Xem lịch sử vào/ra của người tham dự

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/attendance/{userId}/timeline` |
| Permission | `attendance.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "fullName": "Nguyễn Văn A",
    "meetingId": "uuid",
    "events": [
      { "eventType": "check_in", "eventTime": "2026-06-10T09:02:00+07:00", "sourceType": "door_camera" },
      { "eventType": "enter_room", "eventTime": "2026-06-10T09:03:00+07:00", "sourceType": "room_camera" },
      { "eventType": "leave_room", "eventTime": "2026-06-10T10:25:00+07:00", "sourceType": "room_camera" },
      { "eventType": "check_out", "eventTime": "2026-06-10T10:27:00+07:00", "sourceType": "door_camera" }
    ],
    "totalPresenceMinutes": 82
  }
}
```

---

### UC-89 — Tính tổng thời gian hiện diện thực tế

**Internal process (triggered sau khi meeting kết thúc):**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/meetings/{meetingId}/compute-presence` |
| Permission | `internal.system.attendance` |
| System Role | `INTERNAL_SERVICE` |
| Async | Yes |

**Response 202:** `{ "jobId": "uuid", "status": "queued" }`

- Tính `presence_duration_minutes` cho từng `attendance_records`
- Cập nhật `attendance_records.presence_duration_minutes`

---

### UC-90 — Xem timeline hiện diện cuộc họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/presence-timeline` |
| Permission | `attendance.presence.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "meetingId": "uuid",
    "timelineEntries": [
      {
        "timestamp": "2026-06-10T09:00:00+07:00",
        "occupancyCount": 0,
        "users": []
      },
      {
        "timestamp": "2026-06-10T09:02:00+07:00",
        "occupancyCount": 3,
        "users": [
          { "userId": "uuid", "fullName": "A", "presenceStatus": "present" }
        ]
      }
    ]
  }
}
```

---

### UC-91 — Chỉnh sửa hồ sơ điểm danh thủ công
**System Role:** `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

> Sử dụng `PATCH /api/v1/attendance-records/{recordId}` (UC-80)

---

### UC-92 — Gửi cảnh báo người chưa check-in

**Internal process (triggered bởi scheduler sau khi meeting bắt đầu):**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/meetings/{meetingId}/late-checkin-alerts` |
| Permission | `internal.system.notification` |
| System Role | `INTERNAL_SERVICE` |
| Async | Yes |

**Response 202:** Tạo `notifications` (type: `late_checkin_alert`) → push WebSocket + email

---

### UC-93 — Gửi cảnh báo khuôn mặt lạ
**System Role:** `INTERNAL_SERVICE`

> Được trigger tự động trong flow UC-72 → UC-87. Tạo `notifications` (type: `unknown_face_alert`), push WebSocket.

---

## 11. In-Meeting Management

**Module:** `live-meeting` | **Tables:** `meetings`, `meeting_events`, `meeting_notes`, `room_bookings`, `meeting_requests`
**System Roles:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`, `INTERNAL_SERVICE`

### UC-94 — Bắt đầu phiên họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/start` |
| Permission | `meeting.session.start` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "meetingId": "uuid",
    "status": "in_progress",
    "actualStartTime": "2026-06-10T09:03:00+07:00",
    "scheduledEndTime": "2026-06-10T10:30:00+07:00",
    "warningScheduledAt": "2026-06-10T10:20:00+07:00"
  }
}
```

- Cập nhật `meetings.status = 'in_progress'`, `actual_start_time`
- Cập nhật `room_bookings.status = 'active'`
- Ghi `meeting_events` (type: `meeting_started`)
- Schedule warning alert (10 phút trước end_time)

---

### UC-95 — Yêu cầu gia hạn phiên họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/extension-requests` |
| Permission | `meeting.session.extend` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "additionalMinutes": 30,
  "reason": "Cần thêm thời gian thảo luận"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "meetingId": "uuid",
    "requestType": "extend_meeting",
    "requestedEndTime": "2026-06-10T11:00:00+07:00",
    "approvalStatus": "pending",
    "conflictCheck": {
      "hasConflict": false,
      "nextBookingStartTime": null
    }
  }
}
```

---

### UC-96 — Phê duyệt/từ chối yêu cầu gia hạn

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/extension-requests/{requestId}/decide` |
| Permission | `meeting.session.extension.decide` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "decision": "approved",
  "reason": "Không có conflict"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "decision": "approved",
    "newEndTime": "2026-06-10T11:00:00+07:00",
    "decisionAt": "2026-06-10T10:28:00+07:00"
  }
}
```

---

### UC-97 — Cập nhật thời gian kết thúc sau gia hạn
**System Role:** `INTERNAL_SERVICE`

> Được xử lý tự động sau UC-96 nếu `decision = 'approved'`:
- Cập nhật `meetings.end_time`
- Cập nhật `room_bookings.reserved_end_time`
- Ghi `meeting_events` (type: `extension_approved`)
- Re-schedule warning alert

---

### UC-98 — Kết thúc phiên họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/end` |
| Permission | `meeting.session.end` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "meetingId": "uuid",
    "status": "completed",
    "actualEndTime": "2026-06-10T10:28:00+07:00",
    "duration": 85,
    "roomReleased": true
  }
}
```

- Cập nhật `meetings.status = 'completed'`, `actual_end_time`
- Cập nhật `room_bookings.status = 'completed'`
- Update `room_booking_usages.actual_end_time`, `usage_status = 'completed'`
- Trigger tính presence duration (UC-89)

---

### UC-99 — Xem timeline cuộc họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/events` |
| Permission | `meeting.events.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?page=1&limit=50&eventType=`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "eventType": "meeting_started",
      "eventTime": "2026-06-10T09:03:00+07:00",
      "actorUser": { "id": "uuid", "fullName": "Nguyễn Văn A" },
      "sourceType": "manual",
      "description": "Phiên họp bắt đầu",
      "oldValueJson": null,
      "newValueJson": { "status": "in_progress" }
    }
  ]
}
```

---

### UC-100 — Xem danh sách người đang có mặt

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/present-attendees` |
| Permission | `meeting.presence.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "meetingId": "uuid",
    "occupancyCount": 5,
    "presentUsers": [
      {
        "userId": "uuid",
        "fullName": "Nguyễn Văn A",
        "presenceStatus": "present",
        "lastDetectedAt": "2026-06-10T09:50:00+07:00",
        "source": "room_camera"
      }
    ],
    "updatedAt": "2026-06-10T09:50:30+07:00"
  }
}
```

---

### UC-101 — Xem trạng thái điểm danh người tham dự
**System Role:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

> [P1 BE-05, 2026-07-27 — đính chính] Trước đây tài liệu ghi "dùng chung endpoint UC-81" —
> KHÔNG còn đúng. `live-meeting.controller.ts` từng đăng ký TRÙNG path với UC-81
> (`GET /meetings/{meetingId}/attendance`), NestJS chỉ route tới 1 trong 2 handler tùy thứ tự
> import module. Đã tách path riêng, xem chi tiết đầy đủ ở **UC-81b** (ngay sau UC-81, section
> 10). Endpoint thật: `GET /api/v1/live-meetings/{meetingId}/attendance`.

---

### UC-102 — Thêm ghi chú trong cuộc họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/notes` |
| Permission | `meeting.note.create` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "noteType": "in_meeting",
  "content": "Quyết định: Triển khai module X vào Q3",
  "pinned": false,
  "visibilityLevel": "participants"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "noteType": "in_meeting",
    "content": "...",
    "pinned": false,
    "author": { "id": "uuid", "fullName": "Nguyễn Văn A" },
    "createdAt": "2026-06-10T09:45:00+07:00"
  }
}
```

---

### UC-103 — Xem ghi chú trong cuộc họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/notes` |
| Permission | `meeting.note.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?noteType=in_meeting&pinned=true&page=1&limit=20`

**Response 200:** Danh sách meeting notes (lọc theo visibility_level của user hiện tại)

---

### UC-104 — Tìm kiếm ghi chú trong cuộc họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/notes` |
| Permission | `meeting.note.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?q=triển khai&page=1&limit=20`

- Sử dụng Full-text search index trên `meeting_notes.content`

---

### UC-105 — Lập lịch cảnh báo thời gian còn lại
**System Role:** `INTERNAL_SERVICE`

> Internal process sau UC-94 và UC-97. Background scheduler tính `warningScheduledAt = end_time - 10 phút` và enqueue job.

---

### UC-106 — Gửi cảnh báo thời gian còn lại
**System Role:** `INTERNAL_SERVICE`

> Internal process bởi scheduler. Tạo `notifications` (type: `meeting_time_warning`), push WebSocket event.

---

### UC-107 — Gửi cảnh báo xung đột thời gian kết thúc
**System Role:** `INTERNAL_SERVICE`

> Internal process: Khi có booking kế tiếp cùng phòng, tạo `notifications` (type: `meeting_time_conflict_warning`), push WebSocket.

---

## 12. Recording Management

**Module:** `recording` | **Tables:** `recording_configs`, `recording_sessions`, `recording_segments`, `media_files`, `capture_sessions`, `capture_session_channels`
**System Roles:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`, `INTERNAL_SERVICE`

### UC-108 — Tạo cấu hình ghi âm/ghi hình
**System Role:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

> ✅ **Đã implement (REC-001)**. Xem `POST /api/v1/meetings/{meetingId}/recording-config` tại [UC-30](#uc-30--cấu-hình-tính-năng-ghi-hình-cho-cuộc-họp).

---

### UC-109 — Xem cấu hình ghi âm/ghi hình

> ✅ **Đã implement (REC-001)** — GET trả 404 `RECORDING_CONFIG_NOT_FOUND` nếu meeting chưa có config.

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/recording-config` |
| Permission | `recording.config.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "enableAudio": true,
    "enableVideo": true,
    "enableTranscription": false,
    "videoSourceDevice": { "id": "uuid", "deviceName": "Camera IP Room 301" },
    "audioSourceMode": "room_mix",
    "autoStart": false,
    "consentRequired": true,
    "retentionDays": 30,
    "status": "active",
    "configuredAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-110 — Cập nhật cấu hình ghi âm/ghi hình

> ✅ **Đã implement (REC-001)** — PATCH partial; 404 nếu chưa có; 409 `RECORDING_IN_PROGRESS` khi đang ghi.

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/meetings/{meetingId}/recording-config` |
| Permission | `recording.config.update` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:** Các field cần update (tương tự UC-30)

- `409` — không thể thay đổi channel config khi đang recording

---

### UC-111 — Bắt đầu ghi hình từ IP Room Camera

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/recording/start-video` |
| Permission | `recording.video.start` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "cameraDeviceId": "uuid",
  "outputFormat": "mp4",
  "storageProvider": "s3"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "recordingSessionId": "uuid",
    "sessionType": "video",
    "status": "recording",
    "startedAt": "2026-06-10T09:03:00+07:00",
    "cameraDeviceId": "uuid"
  }
}
```

---

### UC-112 — Bắt đầu ghi âm theo channel/seat

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/recording/start-audio` |
| Permission | `recording.audio.start` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "captureAgentDeviceId": "uuid",
  "audioSourceMode": "channel_by_zone",
  "channelMapping": [
    { "channelId": "CH01", "roomZoneLabel": "Góc A", "audioSourceType": "table_mic" }
  ]
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "recordingSessionId": "uuid",
    "captureSessionId": "uuid",
    "sessionType": "audio",
    "status": "recording",
    "channelCount": 4,
    "startedAt": "2026-06-10T09:03:00+07:00"
  }
}
```

---

### UC-113 — Tạo audio segment theo channel/seat

> Internal process trong quá trình ghi âm. Capture Agent gửi segment data:

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/recording/segments` |
| Permission | `internal.recording.segment` |
| System Role | `INTERNAL_SERVICE` |
| Async | No |

**Request Body:**
```json
{
  "recordingSessionId": "uuid",
  "captureSessionChannelId": "uuid",
  "segmentStartTime": "2026-06-10T09:05:00+07:00",
  "segmentEndTime": "2026-06-10T09:10:00+07:00",
  "startOffsetMs": 120000,
  "endOffsetMs": 420000,
  "storageKey": "meetings/uuid/audio/CH01_seg001.wav"
}
```

---

### UC-114 — Tạm dừng ghi âm/ghi hình

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/recording/{sessionId}/pause` |
| Permission | `recording.session.control` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "recordingSessionId": "uuid",
    "status": "paused",
    "pausedAt": "2026-06-10T09:30:00+07:00"
  }
}
```

---

### UC-115 — Tiếp tục ghi âm/ghi hình

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/recording/{sessionId}/resume` |
| Permission | `recording.session.control` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "recordingSessionId": "uuid",
    "status": "recording",
    "resumedAt": "2026-06-10T09:35:00+07:00"
  }
}
```

---

### UC-116 — Dừng ghi hình từ IP Room Camera

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/recording/{sessionId}/stop-video` |
| Permission | `recording.video.stop` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Response 202:**
```json
{
  "success": true,
  "data": {
    "recordingSessionId": "uuid",
    "status": "processing",
    "jobId": "uuid",
    "stoppedAt": "2026-06-10T10:28:00+07:00"
  }
}
```

- Trigger `background_jobs` (job_type: `media_processing`) để upload S3

---

### UC-117 — Dừng ghi âm

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/recording/{sessionId}/stop-audio` |
| Permission | `recording.audio.stop` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Response 202:** (tương tự UC-116)

---

### UC-118 — Đồng bộ metadata video và audio
**System Role:** `INTERNAL_SERVICE`

> Internal process sau khi cả video và audio recording hoàn tất:
- Cập nhật `recording_sessions.metadata_json` với sync offset
- Tạo `media_files` cho output file
- Update `recording_segments.status = 'synced'`

---

### UC-119 — Tạo metadata file phương tiện
**System Role:** `INTERNAL_SERVICE`

> Internal process sau khi upload file thành công:
- Tạo `media_files` với đầy đủ metadata
- Cập nhật `recording_sessions.status = 'stopped'`

---

### UC-120 — Xem danh sách file ghi âm/ghi hình

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/media-files` |
| Permission | `recording.files.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?fileType=video,audio&page=1&limit=20`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fileName": "meeting_sprint_video.mp4",
      "fileType": "video",
      "mimeType": "video/mp4",
      "fileSizeBytes": 524288000,
      "durationSeconds": 5100,
      "visibilityLevel": "internal",
      "isActive": true,
      "uploadedAt": "2026-06-10T11:00:00+07:00"
    }
  ]
}
```

---

### UC-121 — Xem chi tiết file phương tiện

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/media-files/{fileId}` |
| Permission | `recording.files.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "fileCode": "MF-001",
    "fileName": "meeting_sprint_video.mp4",
    "fileType": "video",
    "mimeType": "video/mp4",
    "storageProvider": "s3",
    "storageBucket": "company-meetings",
    "fileSizeBytes": 524288000,
    "durationSeconds": 5100,
    "checksum": "sha256:...",
    "versionNo": 1,
    "relatedEntityType": "recording_session",
    "relatedEntityId": "uuid",
    "metadataJson": { "codec": "H264", "resolution": "1920x1080" }
  }
}
```

---

### UC-122 — Phát lại file ghi âm/ghi hình

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/media-files/{fileId}/signed-url` |
| Permission | `recording.files.play` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?expiresInMinutes=60`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "fileId": "uuid",
    "signedUrl": "https://s3.amazonaws.com/...",
    "expiresAt": "2026-06-10T12:00:00+07:00"
  }
}
```

---

### UC-123 — Xóa hoặc ẩn file recording

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/media-files/{fileId}/visibility` |
| Permission | `recording.files.manage` |
| System Role | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "action": "hide",
  "reason": "Chứa thông tin nhạy cảm"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "fileId": "uuid",
    "isActive": false,
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

- `action` enum: `hide` (set `is_active = false`), `soft_delete` (set `deleted_at`)

---

### UC-124 — Thông báo lỗi ghi âm/ghi hình

> Internal process: FFmpeg/Capture Agent gửi lỗi:

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/recording/error-reports` |
| Permission | `internal.recording.error` |
| System Role | `INTERNAL_SERVICE` |
| Async | Yes |

**Request Body:**
```json
{
  "recordingSessionId": "uuid",
  "errorType": "stream_interrupted",
  "errorMessage": "RTSP connection lost",
  "severity": "error"
}
```

- Cập nhật `recording_sessions.status = 'failed'`, `error_message`
- Tạo `notifications` alert tới Admin

---

## 13. Meeting Transcription Management

**Module:** `transcription` | **Tables:** `transcripts`, `recording_sessions`, `background_jobs`, `media_files`
**System Roles:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`, `INTERNAL_SERVICE`

### UC-125 — Chuyển giọng nói thành văn bản

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/transcription-jobs` |
| Permission | `transcript.create` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "recordingSessionId": "uuid",
  "language": "vi-VN",
  "speakerMappingMode": "channel_zone",
  "forceRerun": false
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "meetingId": "uuid",
    "status": "queued",
    "transcriptStatus": "processing",
    "estimatedCompletion": "2026-06-10T11:30:00+07:00"
  }
}
```

---

### UC-126 — Xem transcript cuộc họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/transcript` |
| Permission | `transcript.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?includeSegments=true&page=1&limit=50`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "transcriptId": "uuid",
    "meetingId": "uuid",
    "status": "reviewed",
    "language": "vi-VN",
    "versionNo": 1,
    "confidenceScore": 0.89,
    "cleanedText": "Nguyễn Văn A: Bắt đầu cuộc họp...",
    "segments": [
      {
        "segmentId": "seg-001",
        "startMs": 5000,
        "endMs": 12000,
        "speakerLabel": "Speaker_1",
        "userId": "uuid",
        "channelId": "CH01",
        "roomZoneLabel": "Góc A",
        "text": "Chào mọi người, bắt đầu họp nhé.",
        "confidence": 0.95
      }
    ],
    "generatedAt": "2026-06-10T11:15:00+07:00"
  },
  "meta": { "page": 1, "limit": 50, "total": 120 }
}
```

---

### UC-127 — Chỉnh sửa transcript thủ công

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/transcripts/{transcriptId}/segments` |
| Permission | `transcript.update` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "segments": [
    {
      "segmentId": "seg-001",
      "text": "Chào mọi người, bắt đầu họp thôi.",
      "speakerUserId": "uuid",
      "speakerLabel": "Nguyễn Văn A",
      "reason": "Sửa lỗi nhận diện từ"
    }
  ],
  "revisionNote": "Chỉnh sửa lần 1 sau review"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "transcriptId": "uuid",
    "revisionNo": 2,
    "updatedSegments": ["seg-001"],
    "editedBy": "uuid",
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-128 — Bảo mật xử lý dữ liệu Speech-to-Text

**128a. Cấu hình bảo mật STT:**

| Field | Value |
|---|---|
| Method | `PUT` |
| Endpoint | `/api/v1/system-configs/transcription-security` |
| Permission | `system.config.transcription.update` |
| System Role | `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "configKey": "transcription.security",
  "configJson": {
    "retentionDays": 90,
    "encryptAtRest": true,
    "deleteRawAudioAfterTranscription": false,
    "externalProvider": "internal_only",
    "accessRules": ["host", "admin"]
  },
  "versionNo": 1
}
```

**128b. Callback từ STT provider:**

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/internal/transcription/callbacks` |
| Permission | `internal.service.transcription.callback` |
| System Role | `INTERNAL_SERVICE` |
| Async | Yes |

**Request Headers:** `X-Service-Signature: <hmac>`

**Request Body:**
```json
{
  "jobId": "uuid",
  "status": "completed",
  "encryptedPayloadRef": "s3://bucket/transcripts/job-uuid.enc",
  "checksum": "sha256:...",
  "error": null
}
```

---

## 14. Minutes & Knowledge Management

**Module:** `minutes` | **Tables:** `meeting_minutes`, `media_files`, `transcripts`
**System Roles:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### UC-129 — Tạo biên bản họp nháp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/minutes` |
| Permission | `minutes.create` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "title": "Biên bản họp Sprint Review Q2",
  "minutesContent": "# Biên bản\n## Tham dự...",
  "visibilityLevel": "participants",
  "decisionsJson": [
    { "decision": "Triển khai module X vào Q3", "responsibleUserId": "uuid" }
  ],
  "actionItemsJson": [
    {
      "title": "Setup CI/CD pipeline",
      "assigneeUserId": "uuid",
      "dueDate": "2026-06-30",
      "priority": "high"
    }
  ],
  "linkedTranscriptId": "uuid"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "title": "Biên bản họp Sprint Review Q2",
    "status": "draft",
    "versionNo": 1,
    "createdAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-130 — Xem danh sách biên bản họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/meetings/{meetingId}/minutes` |
| Permission | `minutes.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?status=published&page=1&limit=20`

**Response 200:** Danh sách `meeting_minutes` theo visibility_level của user hiện tại

---

### UC-131 — Xem chi tiết biên bản họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/minutes/{minutesId}` |
| Permission | `minutes.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "title": "Biên bản họp Sprint Review Q2",
    "status": "published",
    "versionNo": 1,
    "minutesContent": "...",
    "decisionsJson": [],
    "actionItemsJson": [],
    "attendeesSnapshotJson": [],
    "linkedTranscript": { "id": "uuid", "status": "reviewed" },
    "linkedRecordingFile": { "id": "uuid", "fileName": "meeting.mp4" },
    "issuedBy": { "id": "uuid", "fullName": "Nguyễn Văn A" },
    "issuedAt": "2026-06-10T12:00:00+07:00",
    "attachments": []
  }
}
```

---

### UC-132 — Cập nhật nội dung biên bản họp

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/minutes/{minutesId}` |
| Permission | `minutes.update` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "title": "Biên bản họp Sprint Review Q2 - Final",
  "minutesContent": "# Biên bản...",
  "decisionsJson": [],
  "actionItemsJson": [],
  "visibilityLevel": "participants"
}
```

- `409` — không thể edit biên bản đã published

---

### UC-133 — Xóa biên bản họp nháp

| Field | Value |
|---|---|
| Method | `DELETE` |
| Endpoint | `/api/v1/minutes/{minutesId}` |
| Permission | `minutes.delete` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{ "success": true, "data": { "deleted": true, "minutesId": "uuid" } }
```

- Chỉ xóa được nếu `status = 'draft'`
- Soft delete (`deleted_at`)

---

### UC-134 — Lọc biên bản theo khoảng thời gian

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/minutes` |
| Permission | `minutes.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31&status=published&page=1&limit=20`

---

### UC-135 — Tìm kiếm biên bản theo nhân sự

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/minutes` |
| Permission | `minutes.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?userId=uuid&page=1&limit=20` (tìm biên bản có userId trong participants hoặc prepared_by)

---

### UC-136 — Cấu hình quyền hiển thị biên bản

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/minutes/{minutesId}/visibility` |
| Permission | `minutes.visibility.update` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "visibilityLevel": "department"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "minutesId": "uuid",
    "visibilityLevel": "department",
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

---

### UC-137 — Ban hành biên bản họp chính thức

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/minutes/{minutesId}/publish` |
| Permission | `minutes.publish` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "notifyParticipants": true,
  "channels": ["email", "in_app"]
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "minutesId": "uuid",
    "status": "published",
    "issuedAt": "2026-06-03T10:00:00+07:00",
    "notificationQueued": true
  }
}
```

- Set `status = 'published'`, `issued_at`, `issued_by`
- Lock editing
- Trigger distribution notification

---

### UC-138 — Tải lên tệp đính kèm biên bản

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/minutes/{minutesId}/attachments` |
| Permission | `minutes.attachment.upload` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request:** `multipart/form-data`
- `file`: file đính kèm (max 50MB)

**Response 202:**
```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "status": "queued",
    "fileId": null
  }
}
```

- Upload S3, tạo `media_files` (file_type: `minutes_attachment`)

---

### UC-139 — Xem danh sách tệp đính kèm

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/minutes/{minutesId}/attachments` |
| Permission | `minutes.attachment.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fileName": "presentation.pdf",
      "fileType": "document",
      "mimeType": "application/pdf",
      "fileSizeBytes": 2097152,
      "uploadedAt": "2026-06-10T11:30:00+07:00"
    }
  ]
}
```

---

### UC-140 — Xem chi tiết tệp đính kèm

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/media-files/{fileId}` |
| Permission | `minutes.attachment.read` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

> Sử dụng chung `GET /api/v1/media-files/{fileId}` (UC-121) với thêm signed URL nếu cần.

---

### UC-141 — Liên kết recording/transcript với biên bản

| Field | Value |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/minutes/{minutesId}/links` |
| Permission | `minutes.update` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Request Body:**
```json
{
  "linkedTranscriptId": "uuid",
  "linkedRecordingFileId": "uuid"
}
```

**Response 200:** Full minutes object với links cập nhật

---

### UC-142 — Xóa tệp đính kèm khỏi biên bản

| Field | Value |
|---|---|
| Method | `DELETE` |
| Endpoint | `/api/v1/minutes/{minutesId}/attachments/{fileId}` |
| Permission | `minutes.attachment.delete` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "fileId": "uuid"
  }
}
```

- Soft delete file (`media_files.deleted_at`)

---

## 15. Notification and Reporting

**Module:** `notifications` | **Tables:** `notifications`, `background_jobs`, `media_files`
**System Roles:** `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### UC-143 — Phát hành thư mời họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/invitations` |
| Permission | `notification.invite.send` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "channels": ["email", "in_app"],
  "includeAgenda": true,
  "message": "Vui lòng tham dự đúng giờ"
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "notificationId": "uuid",
    "deliveryStatus": "queued",
    "queuedRecipientCount": 8,
    "skippedRecipientCount": 0
  }
}
```

---

### UC-144 — Gửi nhắc nhở lịch họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/reminders` |
| Permission | `notification.reminder.send` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "channels": ["email", "in_app"],
  "reminderType": "manual",
  "sendAt": null
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "notificationId": "uuid",
    "deliveryStatus": "queued",
    "scheduledSendAt": null
  }
}
```

---

### UC-145 — Phát thông báo hủy cuộc họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/cancellation-notifications` |
| Permission | `notification.cancellation.send` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "reason": "Sự kiện thay thế đã lên lịch",
  "channels": ["email", "in_app"]
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "meetingId": "uuid",
    "notificationId": "uuid",
    "queuedRecipientCount": 8
  }
}
```

---

### UC-146 — Phân phối biên bản cuộc họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/minutes/distributions` |
| Permission | `minutes.distribute` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "minutesId": "uuid",
  "recipientScope": "participants",
  "recipientUserIds": [],
  "channels": ["email", "in_app"],
  "message": "Biên bản họp đã được ban hành"
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "notificationId": "uuid",
    "queuedRecipientCount": 8,
    "minutesId": "uuid"
  }
}
```

---

### UC-146b — Hộp thư thông báo cá nhân: List / Detail / Đánh dấu đã đọc (mới, 2026-07-27)

> Không có UC gốc trong Feature Table — bổ sung bắt buộc cho FE (`spec/features/notifications/feat-notification-inbox/`). List/Detail tạo 2026-07-18; mark-read (BE-07) tái áp dụng 2026-07-27 qua Redis, KHÔNG thêm bảng/cột DB (xem spec §1.2 để biết bối cảnh quyết định Product Owner).

**`GET /api/v1/notifications`** — Permission `notification.read.self` — `?page&limit` — trả `{data: [...], meta}`, mỗi item có `isRead: boolean`.

**`GET /api/v1/notifications/{id}`** — Permission `notification.read.self` — trả chi tiết + `isRead`. `403 NOTIFICATION_ACCESS_DENIED` nếu không phải recipient; `404 NOTIFICATION_NOT_FOUND`.

**`PATCH /api/v1/notifications/read-all`** — Permission `notification.update.self` — không body, `userId` lấy từ token — đánh dấu mọi notification tới thời điểm gọi là đã đọc.

**`PATCH /api/v1/notifications/{id}/read`** — Permission `notification.update.self` — không body — đánh dấu 1 notification đã đọc (idempotent). `403 NOTIFICATION_ACCESS_DENIED` nếu không phải recipient.

**Response mark-read (200):**
```json
{ "success": true, "message": "Đã đánh dấu thông báo là đã đọc" }
```

**Lưu ý kỹ thuật:** trạng thái đã đọc lưu ở Redis (`notif:read:{userId}` SET TTL 90 ngày, `notif:readall:{userId}` mốc timestamp) — KHÔNG phải cột trên bảng `notifications`. Redis mất dữ liệu (flush) → user thấy lại thông báo cũ như chưa đọc (residual đã ghi nhận, chấp nhận).

---

### UC-147 — Xuất biên bản cuộc họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/meetings/{meetingId}/minutes/exports` |
| Permission | `minutes.export` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "minutesId": "uuid",
  "format": "pdf",
  "includeTranscript": false,
  "includeActionItems": true
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "status": "queued",
    "estimatedCompletion": "2026-06-03T10:05:00+07:00"
  }
}
```

---

## 16. Analytics & Administration

**Module:** `analytics`, `administration` | **Tables:** `audit_logs`, `system_configs`, `background_jobs`, source tables
**System Roles:** `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### UC-148 — Xem dashboard tổng quan hệ thống

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/dashboard/overview` |
| Permission | `analytics.overview.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-06-01&to=2026-06-30&departmentId=uuid&roomId=uuid`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "meetingCount": 145,
    "activeRooms": 12,
    "utilizationRate": 68.5,
    "noShowRate": 7.2,
    "onTimeRate": 85.3,
    "recordingCount": 38,
    "trend": [
      { "date": "2026-06-01", "meetingCount": 8, "utilizationRate": 70.0 }
    ]
  }
}
```

---

### UC-149 — Xem dashboard sử dụng phòng

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/rooms/dashboard` |
| Permission | `analytics.room.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-06-01&to=2026-06-30&roomId=uuid&siteName=Tòa A&groupBy=week`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "utilizationRate": 68.5,
      "totalBookedHours": 520.5,
      "actualUsedHours": 390.2
    },
    "rooms": [
      {
        "roomId": "uuid",
        "roomName": "Phòng 101",
        "utilizationRate": 75.0,
        "bookedHours": 45,
        "actualHours": 33.75
      }
    ],
    "trend": []
  }
}
```

---

### UC-150 — Xem dashboard điểm danh & hiện diện

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/attendance/dashboard` |
| Permission | `analytics.attendance.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-06-01&to=2026-06-30&departmentId=uuid&groupBy=week`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "presentRate": 88.5,
    "onTimeRate": 82.3,
    "lateCount": 45,
    "absentCount": 23,
    "presenceTrend": [],
    "topLateUsers": [
      { "userId": "uuid", "fullName": "Nguyễn Văn A", "lateCount": 5 }
    ]
  }
}
```

---

### UC-151 — Thống kê số lượng cuộc họp theo thời gian

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/meetings/count-by-period` |
| Permission | `analytics.meeting.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31&granularity=week&departmentId=uuid`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "total": 145,
    "series": [
      { "period": "2026-W18", "count": 32 },
      { "period": "2026-W19", "count": 38 }
    ]
  }
}
```

---

### UC-152 — Thống kê cuộc họp theo trạng thái

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/meetings/status-breakdown` |
| Permission | `analytics.meeting.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31&departmentId=uuid`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "items": [
      { "status": "completed", "count": 98, "percentage": 67.6 },
      { "status": "cancelled", "count": 15, "percentage": 10.3 },
      { "status": "scheduled", "count": 30, "percentage": 20.7 },
      { "status": "in_progress", "count": 2, "percentage": 1.4 }
    ]
  }
}
```

---

### UC-153 — Thống kê thời lượng trung bình cuộc họp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/meetings/average-duration` |
| Permission | `analytics.meeting.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31&mode=actual&departmentId=uuid`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "averageMinutes": 72.5,
    "medianMinutes": 60.0,
    "series": [
      { "period": "2026-W18", "averageMinutes": 68.0 }
    ]
  }
}
```

---

### UC-154 — Thống kê tỷ lệ cuộc họp bị hủy

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/meetings/cancel-rate` |
| Permission | `analytics.meeting.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31&departmentId=uuid`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "cancelledCount": 15,
    "totalMeetingCount": 145,
    "cancelRate": 10.3,
    "series": []
  }
}
```

---

### UC-155 — Thống kê tỷ lệ sử dụng phòng tổng hợp

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/rooms/utilization-rate` |
| Permission | `analytics.room.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31&roomId=uuid&groupBy=week`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "utilizationRate": 68.5,
    "bookedHours": 520.5,
    "actualUsedHours": 390.2,
    "availableHours": 760.0,
    "byRoom": [
      { "roomId": "uuid", "roomName": "Phòng 101", "utilizationRate": 75.0 }
    ]
  }
}
```

---

### UC-156 — Thống kê tỷ lệ no-show theo phòng

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/rooms/no-show-rate` |
| Permission | `analytics.room.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31&roomId=uuid&groupBy=month`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "noShowCount": 18,
    "totalBookings": 250,
    "noShowRate": 7.2,
    "byRoom": [
      { "roomId": "uuid", "roomName": "Phòng 101", "noShowCount": 5, "noShowRate": 8.0 }
    ],
    "trend": []
  }
}
```

---

### UC-157 — Thống kê tỷ lệ tham dự đúng giờ

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/analytics/attendance/on-time-rate` |
| Permission | `analytics.attendance.read` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

**Query:** `?from=2026-05-01&to=2026-05-31&departmentId=uuid&graceMinutes=5`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "onTimeCount": 385,
    "totalRequiredParticipants": 467,
    "onTimeRate": 82.4,
    "lateCount": 52,
    "absentCount": 30,
    "graceMinutes": 5,
    "trend": []
  }
}
```

---

### UC-158 — Xuất báo cáo tổng hợp hoạt động cuộc họp

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/reports/meeting-activity/exports` |
| Permission | `report.meeting_activity.export` |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | Yes |

**Request Body:**
```json
{
  "from": "2026-05-01",
  "to": "2026-05-31",
  "format": "xlsx",
  "scope": {
    "departmentId": "uuid",
    "roomId": null,
    "organizerId": null
  },
  "sections": ["overview", "rooms", "attendance", "no_show"],
  "delivery": "download"
}
```

**Response 202:**
```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "status": "queued",
    "estimatedCompletion": "2026-06-03T10:10:00+07:00",
    "delivery": "download",
    "outputFileId": null
  }
}
```

- Tạo `background_jobs` (job_type: `export_report`)
- File output → `media_files` (file_type: `export`)

---

### UC-158b — Xem/cập nhật cấu hình hệ thống (mới, 2026-07-27, BE-09)

> Spec: `spec/features/administration/feat-system-configurations/`. KHÁC với UC-47 (`/system-configs/no-show-threshold`, permission `admin.config.update`) — đây là endpoint TỔNG QUÁT theo allowlist 9 key phẳng mà `systemAdmin/SystemSettings.jsx` quản trị, KHÔNG phải endpoint chuyên biệt theo từng nhóm cấu hình. 2 kiểu endpoint cùng tồn tại, phục vụ 2 màn FE khác nhau.

**`GET /api/v1/system-configurations`** — Permission `admin.manage_config` (chỉ `SYSTEM_ADMIN`).

**Response 200:**
```json
{
  "success": true,
  "message": "Lấy cấu hình hệ thống thành công",
  "data": [
    {
      "id": "uuid",
      "key": "no_show_threshold_minutes",
      "value": "10",
      "valueType": "number",
      "configGroup": "no_show",
      "description": "Số phút chờ trước khi đánh dấu no-show",
      "isSensitive": false,
      "updatedAt": "2026-07-27T10:00:00+07:00"
    }
  ]
}
```

**`PATCH /api/v1/system-configurations`** — Permission `admin.manage_config`.

**Request Body:**
```json
{ "key": "grace_minutes", "value": "5" }
```

`key` phải nằm trong allowlist 9 key (`is_auto_release_enabled`, `no_show_threshold_minutes`, `grace_minutes`, `is_early_release_enabled`, `early_departure_threshold_minutes`, `is_host_warning_enabled`, `recording_retention_days`, `is_recording_consent_required`, `overrun_grace_minutes`); `value` LUÔN là string (kể cả boolean/number).

**Error:** `400 CONFIG_KEY_NOT_ALLOWED` (key ngoài allowlist) · `400 INVALID_CONFIG_VALUE` (sai kiểu hoặc ngoài biên min/max) · `403` (thiếu `admin.manage_config`).

**Lưu ý kỹ thuật:** `config_key` KHÔNG có unique index trên RDS thật — upsert dùng `SELECT ... FOR UPDATE` trong transaction, KHÔNG `ON CONFLICT`.

---

## Phụ lục A — Danh sách Permission Codes

| Permission Code | Mô tả |
|---|---|
| `auth:user` | Người dùng đã xác thực |
| `account.user.create` | Tạo tài khoản người dùng |
| `account.user.read` | Xem danh sách tài khoản |
| `account.user.read.detail` | Xem chi tiết tài khoản |
| `account.user.update` | Cập nhật thông tin tài khoản |
| `account.user.delete` | Xóa tài khoản |
| `account.user.import` | Import tài khoản từ Excel |
| `account.user.status.update` | Cập nhật trạng thái tài khoản |
| `account.user.lock` | Khóa tài khoản |
| `account.role.update` | Cập nhật vai trò tài khoản |
| `account.face.register` | Đăng ký khuôn mặt |
| `department.create` | Tạo phòng ban |
| `audit.user.read` | Xem lịch sử hoạt động tài khoản |
| `audit.system.read` | Xem toàn bộ audit logs |
| `profile.update.self` | Cập nhật thông tin cá nhân |
| `meeting.create` | Tạo cuộc họp |
| `meeting.create.adhoc` | Tạo cuộc họp đột xuất |
| `meeting.update` | Cập nhật cuộc họp |
| `meeting.cancel` | Hủy cuộc họp |
| `meeting.read` | Xem cuộc họp |
| `meeting.read.self` | Xem lịch cá nhân |
| `meeting.participant.add` | Thêm người tham dự |
| `meeting.participant.remove` | Gỡ người tham dự |
| `meeting.participant.import` | Import danh sách người tham dự |
| `meeting.agenda.create` | Tạo agenda |
| `meeting.agenda.read` | Xem agenda |
| `meeting.agenda.update` | Cập nhật agenda |
| `meeting.agenda.delete` | Xóa agenda |
| `meeting.note.create` | Tạo ghi chú |
| `meeting.note.read` | Xem ghi chú |
| `meeting.events.read` | Xem timeline cuộc họp |
| `meeting.presence.read` | Xem hiện diện realtime |
| `meeting.session.start` | Bắt đầu phiên họp |
| `meeting.session.end` | Kết thúc phiên họp |
| `meeting.session.extend` | Yêu cầu gia hạn |
| `meeting.session.extension.decide` | Phê duyệt/từ chối gia hạn |
| `meeting_request.approve` | Phê duyệt yêu cầu |
| `meeting_request.reject` | Từ chối yêu cầu |
| `room.create` | Tạo phòng |
| `room.update` | Cập nhật phòng |
| `room.delete` | Xóa phòng |
| `room.read` | Xem phòng |
| `room.release` | Giải phóng phòng |
| `room.device.assign` | Gán thiết bị vào phòng |
| `room.utilization.read` | Xem sử dụng phòng |
| `room.noshow.update` | Cập nhật no-show |
| `equipment.create` | Tạo thiết bị |
| `equipment.read` | Xem kho thiết bị |
| `equipment.read.availability` | Xem tình trạng thiết bị |
| `equipment.assign` | Phân bổ thiết bị |
| `equipment.delete` | Xóa thiết bị |
| `equipment.issue.report` | Báo lỗi thiết bị |
| `equipment.status.update` | Cập nhật trạng thái thiết bị |
| `iot.device.create` | Đăng ký IoT device |
| `iot.device.configure` | Cấu hình IoT device |
| `device.user.mapping.create` | Tạo device-user mapping |
| `device.user.mapping.read` | Xem device-user mapping |
| `attendance.create.manual` | Tạo điểm danh thủ công |
| `attendance.read` | Xem điểm danh |
| `attendance.read.detail` | Xem chi tiết điểm danh |
| `attendance.update` | Cập nhật điểm danh |
| `attendance.invalidate` | Hủy điểm danh |
| `attendance.presence.read` | Xem hiện diện |
| `scheduling.suggest.rooms` | Gợi ý phòng |
| `scheduling.suggest.times` | Gợi ý thời gian |
| `scheduling.conflict.room.check` | Kiểm tra xung đột phòng |
| `scheduling.conflict.participant.check` | Kiểm tra xung đột participant |
| `recording.config.create` | Tạo cấu hình recording |
| `recording.config.read` | Xem cấu hình recording |
| `recording.config.update` | Cập nhật cấu hình recording |
| `recording.video.start` | Bắt đầu ghi hình |
| `recording.video.stop` | Dừng ghi hình |
| `recording.audio.start` | Bắt đầu ghi âm |
| `recording.audio.stop` | Dừng ghi âm |
| `recording.session.control` | Điều khiển phiên recording |
| `recording.files.read` | Xem file recording |
| `recording.files.play` | Phát lại file |
| `recording.files.manage` | Quản lý file |
| `transcript.create` | Tạo transcript |
| `transcript.read` | Xem transcript |
| `transcript.update` | Chỉnh sửa transcript |
| `minutes.create` | Tạo biên bản |
| `minutes.read` | Xem biên bản |
| `minutes.update` | Cập nhật biên bản |
| `minutes.delete` | Xóa biên bản |
| `minutes.publish` | Ban hành biên bản |
| `minutes.distribute` | Phân phối biên bản |
| `minutes.export` | Xuất biên bản |
| `minutes.visibility.update` | Cập nhật quyền hiển thị |
| `minutes.attachment.upload` | Upload đính kèm |
| `minutes.attachment.read` | Xem đính kèm |
| `minutes.attachment.delete` | Xóa đính kèm |
| `notification.invite.send` | Gửi thư mời |
| `notification.reminder.send` | Gửi nhắc nhở |
| `notification.cancellation.send` | Gửi thông báo hủy |
| `report.room_usage.export` | Xuất báo cáo phòng |
| `report.meeting_activity.export` | Xuất báo cáo tổng hợp |
| `analytics.overview.read` | Xem dashboard tổng quan |
| `analytics.room.read` | Xem dashboard phòng |
| `analytics.attendance.read` | Xem dashboard điểm danh |
| `analytics.meeting.read` | Xem thống kê cuộc họp |
| `admin.config.update` | Cập nhật cấu hình hệ thống |
| `system.config.transcription.update` | Cập nhật cấu hình STT |
| `internal.system.noshow` | Internal: xử lý no-show |
| `internal.system.camera` | Internal: camera service |
| `internal.system.attendance` | Internal: tính toán điểm danh |
| `internal.system.notification` | Internal: gửi thông báo |
| `internal.system.mapping` | Internal: device-user lookup |
| `internal.recording.segment` | Internal: lưu segment |
| `internal.recording.error` | Internal: báo lỗi recording |
| `internal.service.transcription.callback` | Internal: STT callback |
| `internal.device.callback` | Internal: device callback |

---

## Phụ lục B — WebSocket Events

**Base URL WebSocket:** `wss://backend.company.com/ws`

**Auth:** `?token=<access_token>`

| Event Name | Trigger | Payload |
|---|---|---|
| `meeting.status.updated` | Khi meeting đổi status | `{ meetingId, status, timestamp }` |
| `room.status.updated` | Khi room đổi current_status | `{ roomId, status, timestamp }` |
| `room.occupancy.updated` | Khi có occupancy event | `{ roomId, occupancyCount, timestamp }` |
| `attendance.checkin` | Khi có check-in event | `{ meetingId, userId, eventType, timestamp }` |
| `attendance.unknown_face` | Khi phát hiện khuôn mặt lạ | `{ roomId, deviceId, imageRef, timestamp }` |
| `meeting.noshow.alert` | Khi phát hiện no-show | `{ meetingId, roomId, noShowCaseId, timestamp }` |
| `meeting.time.warning` | Cảnh báo sắp hết giờ | `{ meetingId, remainingMinutes, timestamp }` |
| `recording.status.updated` | Khi recording đổi status | `{ meetingId, sessionId, status, timestamp }` |
| `job.completed` | Khi background job hoàn tất | `{ jobId, jobType, status, outputFileId?, timestamp }` |

---

## Phụ lục C — Enum Values

### Meeting Status
`draft` → `pending_approval` → `scheduled` → `in_progress` → `completed` | `cancelled`

### Room Booking Status
`pending` → `approved` → `active` → `completed` | `cancelled` | `released`

### Attendance Status
`pending_review` | `present` | `absent` | `late` | `left_early` | `invalidated`

### No-Show Detection Status
`risk` → `warning_sent` → `released` | `dismissed` | `confirmed` | `resolved`

### Recording Session Status
`starting` → `recording` → `paused` → `stopped` → `processing` | `failed`

### Transcript Status
`processing` → `draft` → `reviewed` → `approved` | `failed` | `hidden`

### Meeting Minutes Status
`draft` → `published` | `archived` | `deleted`

### Background Job Status
`queued` → `running` → `completed` | `failed` | `cancelled` | `retrying`

### IoT Device Status
`online` | `offline` | `disabled` | `maintenance`

### Equipment Asset Status
`available` | `assigned` | `retired` | `lost` | `maintenance`

---

## Phụ lục D — Error Codes

| Error Code | HTTP | Mô tả |
|---|---:|---|
| `INVALID_CREDENTIALS` | 401 | Sai email/mật khẩu |
| `ACCOUNT_LOCKED` | 423 | Tài khoản bị khóa |
| `TOKEN_EXPIRED` | 401 | Token đã hết hạn |
| `TOKEN_REVOKED` | 401 | Token đã bị thu hồi |
| `PERMISSION_DENIED` | 403 | Không đủ quyền |
| `RESOURCE_NOT_FOUND` | 404 | Không tìm thấy tài nguyên |
| `DUPLICATE_ENTRY` | 409 | Trùng lặp dữ liệu |
| `ROOM_CONFLICT` | 409 | Phòng bị conflict |
| `MEETING_NOT_ACTIVE` | 409 | Cuộc họp không ở trạng thái phù hợp |
| `CANNOT_EDIT_PUBLISHED` | 409 | Không thể sửa biên bản đã ban hành |
| `OTP_INVALID` | 400 | OTP sai |
| `OTP_EXPIRED` | 410 | OTP đã hết hạn |
| `VALIDATION_ERROR` | 422 | Dữ liệu đầu vào không hợp lệ |
| `FILE_TOO_LARGE` | 413 | File quá lớn |
| `UNSUPPORTED_FILE_TYPE` | 415 | Định dạng file không được hỗ trợ |
| `RATE_LIMIT_EXCEEDED` | 429 | Quá giới hạn gọi API |
| `INTERNAL_ERROR` | 500 | Lỗi server |
| `CONFLICT_BLOCKED` | 409 | Bị chặn do xung đột lịch/phòng |

---

## Phụ lục E — Ghi chú triển khai

1. **Ghi audit_logs:** Tất cả API ghi dữ liệu hoặc thao tác bảo mật (create/update/delete/approve) phải ghi `audit_logs`.

2. **Async processing:** API có `Async = Yes` không xử lý toàn bộ logic trong HTTP request. Tạo `background_jobs`, trả `jobId`, xử lý nền qua BullMQ hoặc tương tự.

3. **Background job polling:** Client dùng `GET /api/v1/background-jobs/{jobId}` để kiểm tra trạng thái, hoặc nhận WebSocket event `job.completed`.

4. **Internal endpoints:** Chỉ dành cho service nội bộ (Python Camera Service, Face Server callback). Cần service token/signature, không public ra frontend.

5. **File upload flow:** Upload → S3 → tạo `media_files` record → trả `fileId`. Download dùng signed URL TTL ngắn.

6. **Conflict check:** Không dùng bảng `schedule_conflicts`. Tính động từ `room_bookings` và `meeting_participants` trong service layer.

7. **Pagination:** Các API list đều hỗ trợ `page`, `limit`, `sortBy`, `sortOrder` và trả `meta.total`.

8. **Realtime push:** Dùng WebSocket Gateway để push events cho dashboard, không polling.

9. **Timezone:** Tất cả datetime trong API request/response phải có timezone offset. Default `Asia/Ho_Chi_Minh` (+07:00).

---

## Phụ lục F — SAVP Campus Extension (mở rộng, ngoài 158 UC gốc)

> **Lưu ý numbering:** UC của phần mở rộng SAVP (Smart AI Vision Platform, xem `CLAUDE.md` §0/§5.5, dải UC-90 → UC-120 theo tài liệu spec-kit riêng ở `spec/features/zones/`, `spec/features/gate-access/`, `spec/features/alerts/`...) là một **hệ numbering độc lập** với UC-01 → UC-158 của tài liệu API Contract này. Trùng số (vd. UC-119) là trùng ngẫu nhiên giữa hai hệ, KHÔNG phải cùng một use case. Mục dưới đây dùng mã code riêng của spec-kit (`ZPT-001`...) để tránh nhầm lẫn.
>
> **Residual/nợ tài liệu:** Tính đến 2026-07-27, đây là entry ĐẦU TIÊN của phần SAVP trong tài liệu này. Các endpoint SAVP khác đã có code chạy thật (gate-access pairing/history, alert rules, security alerts, person/vehicle control list, campus-dashboard overview/traffic-heatmap, restricted-zone intrusion, crowd-alert) **chưa được đưa vào** Phụ lục này — nợ tài liệu tồn đọng từ các đợt trước, ngoài phạm vi đợt P1 (chỉ thêm đúng 1 mục A.2 đang sửa). Cần một đợt riêng để backfill toàn bộ.

### ZPT-001 — Xem timeline hiện diện theo khu vực (Zone Presence Timeline)

> Spec đầy đủ: `spec/features/zones/uc119-zone-presence-timeline/spec.md`. Đính chính 2026-07-27: dữ liệu nguồn là NHẬT KÝ BẮT GẶP (`appear`/`disappear`/`count`), không có `enter`/`exit` để ghép cặp tính thời lượng lưu lại — response trả `sightingCount` (số lượt bắt gặp) thay vì thời lượng.

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/campus-dashboard/zones/{zoneId}/timeline` |
| Permission | `campus_dashboard.timeline.read` |
| Async | No |

**Query:** `?from=2026-07-01T00:00:00Z&to=2026-07-02T00:00:00Z&userId={uuid?}` (`from`/`to` bắt buộc, khoảng tối đa 31 ngày; `userId` tùy chọn UUID)

**Response 200 (có userId):**
```json
{
  "success": true,
  "message": "Zone presence timeline retrieved successfully",
  "data": {
    "events": [
      { "eventTime": "2026-07-01T08:00:00.000Z", "eventType": "appear", "occupancyCount": null, "userId": "uuid" }
    ],
    "personDataAvailable": true,
    "sightingCount": 1
  }
}
```

**Response 200 (không có dữ liệu — EX1):**
```json
{
  "success": true,
  "message": "Zone presence timeline retrieved successfully",
  "data": {
    "events": [],
    "personDataAvailable": null,
    "sightingCount": null,
    "message": "Không có dữ liệu hiện diện trong khoảng thời gian này."
  }
}
```

**Error:** `404 ZONE_NOT_FOUND` (zone không tồn tại/đã xóa mềm) · `400 INVALID_TIMELINE_RANGE` (khoảng > 31 ngày) · `403` (thiếu permission).

10. **Soft delete:** Các resource quan trọng (meetings, rooms, equipments, users, minutes, media_files) dùng soft delete (`deleted_at`). Các API list mặc định lọc `deleted_at IS NULL`.
