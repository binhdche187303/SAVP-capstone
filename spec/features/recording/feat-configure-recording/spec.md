---
name: feat-configure-recording
description: CRUD cấu hình ghi âm/ghi hình theo cuộc họp trên bảng recording_configs có sẵn (meeting-scoped). Không ghi hình thật.
category: recording
---

# Feature Specification: Cấu hình ghi âm/ghi hình cho cuộc họp (Configure Meeting Recording)

- **Feature ID**: REC-001 (UC-30/108 create · UC-109 read · UC-110 update)
- **Feature Name**: Cấu hình ghi âm/ghi hình cho cuộc họp
- **Feature Table Ref**: #22 — Cấu hình recording
- **Module / Domain**: recording
- **Created Date**: 2026-06-15
- **Status**: Draft (đã chốt clarifications)
- **Source Documents**:
  - `CLAUDE.md` (Sections 4.1, 5.2, 10.7, 22.11; DATA-01, SEC-03)
  - `spec/global/constitution.md` (SEC-02/03, ARCH-03, DATA-01)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-30/108/109/110 — recording-config)
  - `src/modules/recording/entities/recording-config.entity.ts` (RecordingConfigEntity — bảng có sẵn)
  - `src/modules/recording/entities/recording-session.entity.ts` (RecordingSessionStatus — guard "đang ghi")
  - Spec mẫu: `spec/features/iot/feat-register-camera-device` (pattern CRUD/audit)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo spec REC-001: CRUD recording-config meeting-scoped, TÁI DÙNG bảng `recording_configs` có sẵn (HỦY hướng per-camera D2/D3 cũ). Không tạo bảng/migration/sửa schema. | Toàn bộ file (bản đầu tiên) |
| 2026-06-15 | Chốt NC-2..5: GET chưa có config → 404; implement guard session-active ngay (409 RECORDING_IN_PROGRESS, no-op hiện tại); videoSourceDeviceId không-ip_camera → 400 INVALID_VIDEO_SOURCE_DEVICE (không room-match); PATCH có đổi → bump configured_by + configured_at. Mục 11 → đã chốt. | Mục 4, 5, 11 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh

Bảng `recording_configs` (DB v3.2 Compact) đã tồn tại dưới dạng `RecordingConfigEntity` nhưng **chưa có controller/service** — mới chỉ schema + 1 chỗ READ trong `meetings` (my-schedule detail). REC-001 hiện thực **CRUD cơ bản** cho cấu hình recording **theo cuộc họp** (meeting-scoped, quan hệ 1:1 meeting ↔ config), khớp API Contract UC-30/109/110. Đây **chỉ là cấu hình** — việc bấm start/stop và ghi hình thật thuộc UC sau (#23+).

> Hướng per-camera ban đầu (config 1:1 ip_camera, bảng mới) đã bị **HỦY** vì `recording_configs` baseline là **meeting-centric** (`meeting_id` NOT NULL). REC-001 bám đúng bảng có sẵn.

### 1.2 Mục tiêu

Cung cấp 3 endpoint trên bảng `recording_configs` có sẵn:
- **Create**: `POST /api/v1/meetings/:meetingId/recording-config` (1:1 — 409 nếu đã có).
- **Read**: `GET /api/v1/meetings/:meetingId/recording-config`.
- **Update**: `PATCH /api/v1/meetings/:meetingId/recording-config` (partial; 409 nếu đang ghi).

Đảm bảo: validate input (SEC-03), audit create/update, KHÔNG tạo bảng/migration/sửa schema (DATA-01).

### 1.3 Giá trị mang lại

- **Cho Host/Manager**: cấu hình trước cuộc họp sẽ ghi gì (audio/video/transcription), nguồn camera, retention.
- **Cho hệ thống**: chuẩn bị `recording_configs` để UC start/stop (#23) dùng.

### 1.4 Out-of-scope

- Ghi hình/ghi âm **thật**: start/stop session, ffmpeg, queue/worker, MinIO, credential RTSP — thuộc #23+.
- Ghi vào `recording_sessions`/`recording_segments`/`media_files` — chỉ **đọc** `recording_sessions` để guard "đang ghi".
- Retention **cleanup job** (chỉ LƯU `retention_days`, chưa xóa file).
- Transcription thật.
- Cột nâng cao `policy_key`/`policy_snapshot_json`/`config_json`/`status` — v1 để default (`status='draft'`), KHÔNG expose trong CRUD cơ bản.
- KHÔNG tạo bảng mới, KHÔNG migration, KHÔNG sửa entity/schema baseline (đặc biệt KHÔNG đụng entity `meetings` của team).

---

## 2. System Context

### 2.1 Kết quả RECON (đã rà code)

| Hạng mục | Phát hiện (file:line) |
|---|---|
| Bảng/entity | [recording-config.entity.ts:26](../../../../src/modules/recording/entities/recording-config.entity.ts) `@Entity('recording_configs')` ĐÃ CÓ — **meeting-centric** (`meeting_id` NOT NULL, FK→meetings CASCADE; `video_source_device_id` nullable FK→iot_devices SET NULL; `configured_by` FK→users). KHÔNG có `@CreateDateColumn/@UpdateDateColumn`; `configured_at` default `now()` ở DB. |
| Controller/Service | **KHÔNG có** controller/service cho recording-config. [recording.module.ts](../../../../src/modules/recording/recording.module.ts) chỉ `TypeOrmModule.forFeature([4 entity])` + `exports: [TypeOrmModule]`. |
| Chỗ dùng hiện tại | [meetings.service.ts:2779](../../../../src/modules/meetings/services/meetings.service.ts) READ-only map vào `DetailRecordingConfigDto` (my-schedule). KHÔNG có write. |
| Guard "đang ghi" | [recording-session.entity.ts:28](../../../../src/modules/recording/entities/recording-session.entity.ts) `RecordingSessionStatus` = starting/recording/paused/stopped/failed/processing; có `meeting_id`, `stopped_at`. ⇒ query session active khả thi (no-op hiện tại vì #23 chưa tạo session). |
| Route collision | [meetings.controller.ts](../../../../src/modules/meetings/controllers/meetings.controller.ts) `@Controller()` có `meetings/:meetingId/{time,room,cancel,participants/internal,available-rooms}` — **KHÔNG** có `recording-config`. ⇒ route mới `meetings/:meetingId/recording-config` KHÔNG đụng. |
| API Contract | UC-30 (=UC-108 cross-ref) create `recording.config.create`; UC-109 read `recording.config.read`; UC-110 update `recording.config.update`. Body: enableAudio/enableVideo/enableTranscription/videoSourceDeviceId/audioSourceMode/autoStart/consentRequired/retentionDays. |

### 2.2 Actor & Roles

| Actor | Vai trò | Quyền |
|---|---|---|
| ADMIN / MANAGER | Cấu hình recording cho cuộc họp | `recording.config.create` / `recording.config.read` / `recording.config.update` |
| System | Validate, ghi DB, audit | — |

> Guard mock như IOT-011/012 (`JwtAuthGuard` + `MockPermissionsGuard` + `@Permissions(...)`); enforce 403 runtime là task team-wide.

### 2.3 Entity liên quan

| Entity / Table | Vai trò |
|---|---|
| `recording_configs` | Bảng chính (CRUD) |
| `meetings` | Xác minh meeting tồn tại (chỉ đọc) |
| `iot_devices` | Xác minh `videoSourceDeviceId` là ip_camera tồn tại (chỉ đọc) |
| `recording_sessions` | Đọc để guard "đang ghi" (PATCH) |
| `audit_logs` | Ghi audit create/update |

### 2.4 Field CRUD (allowlist)

| Field (camelCase API) | Cột | Kiểu | POST | PATCH | Ghi chú |
|---|---|---|---|---|---|
| `enableAudio` | enable_audio | bool | optional (def false) | optional | |
| `enableVideo` | enable_video | bool | optional (def false) | optional | |
| `enableTranscription` | enable_transcription | bool | optional (def false) | optional | |
| `videoSourceDeviceId` | video_source_device_id | uuid\|null | optional | optional | nếu khác null → phải ip_camera tồn tại |
| `audioSourceMode` | audio_source_mode | enum\|null | optional | optional | room_mix\|channel_by_zone\|single_microphone |
| `autoStart` | auto_start | bool | optional (def false) | optional | |
| `consentRequired` | consent_required | bool | optional (def true) | optional | |
| `retentionDays` | retention_days | int\|null | optional | optional | >0, ≤365 (đề xuất) |

> KHÔNG expose: `meeting_id` (lấy từ path), `configured_by`/`configured_at` (hệ thống set), `policy_*`/`config_json`/`status` (default).

---

## 3. Endpoints

### 3.1 Create — `POST /api/v1/meetings/:meetingId/recording-config`
| Field | Value |
|---|---|
| Permission | `recording.config.create` |
| HTTP | 201 |

### 3.2 Read — `GET /api/v1/meetings/:meetingId/recording-config`
| Field | Value |
|---|---|
| Permission | `recording.config.read` |
| HTTP | 200 |

### 3.3 Update — `PATCH /api/v1/meetings/:meetingId/recording-config`
| Field | Value |
|---|---|
| Permission | `recording.config.update` |
| HTTP | 200 |

**Path param:** `meetingId` (uuid, `ParseUUIDPipe`). Auth: `JwtAuthGuard` + `MockPermissionsGuard`. Body: route-level `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.

**Response (data) — camelCase theo entity** (ví dụ Read 200):
```json
{
  "success": true,
  "message": "Recording config retrieved successfully",
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "enableAudio": true,
    "enableVideo": true,
    "enableTranscription": false,
    "videoSourceDeviceId": "uuid|null",
    "audioSourceMode": "room_mix",
    "autoStart": false,
    "consentRequired": true,
    "retentionDays": 30,
    "status": "draft",
    "configuredBy": "uuid|null",
    "configuredAt": "2026-06-15T10:00:00+07:00"
  }
}
```

> Casing: contract recording-config dùng **camelCase** (UC-30/109). REC-001 trả camelCase theo entity (khác module iot snake_case — nhất quán với contract recording).

---

## 4. Validation / Flow

```text
[Create] POST /meetings/:meetingId/recording-config
1. JwtAuthGuard → userId (sub). Thiếu → 401. 2. Permission create → 403.
3. ParseUUIDPipe meetingId. Sai → 400. ValidationPipe body → 400 nếu field lạ/sai kiểu.
4. Meeting tồn tại? Không → 404 (MEETING_NOT_FOUND).
5. Đã có recording_config cho meeting? Có → 409 (RECORDING_CONFIG_EXISTS).
6. Nếu videoSourceDeviceId != null → device tồn tại & device_type=ip_camera? Không → 400/404 ([NC-4]).
7. Tạo bản ghi: gán field + meeting_id + configured_by=userId + configured_at=now() + status='draft' (default).
   Transaction { insert recording_configs + audit create }. Trả 201.

[Read] GET /meetings/:meetingId/recording-config
1-3. Auth/permission/uuid. 4. Tìm config theo meeting_id. Không có → 404 (RECORDING_CONFIG_NOT_FOUND). Có → 200.

[Update] PATCH /meetings/:meetingId/recording-config
1-3. Auth/permission(update)/uuid + ValidationPipe partial.
4. Config tồn tại? Không → 404 (RECORDING_CONFIG_NOT_FOUND).
5. Guard "đang ghi": có recording_session active (status ∈ {starting,recording,paused}, stopped_at IS NULL) cho meeting? Có → 409 (RECORDING_IN_PROGRESS). (No-op hiện tại — #23 chưa tạo session — [NC-3].)
6. videoSourceDeviceId nếu gửi != null → validate ip_camera ([NC-4]).
7. Idempotent: không field nào đổi giá trị → 200, không ghi/audit (như IOT-011).
8. Transaction { update + bump configured_by=userId & configured_at=now() + audit update }. Trả 200.
```

---

## 5. Functional Requirements (EARS)

### 5.1 Create
```text
FR-REC-001-001: THE system SHALL cung cấp POST /api/v1/meetings/:meetingId/recording-config tạo cấu hình recording cho cuộc họp.
FR-REC-001-002: IF meeting không tồn tại, THEN trả 404 (MEETING_NOT_FOUND).
FR-REC-001-003: IF meeting đã có recording_config (1:1), THEN trả 409 (RECORDING_CONFIG_EXISTS).
FR-REC-001-004: WHEN hợp lệ, THE system SHALL insert recording_configs với meeting_id=path, configured_by=JWT userId, configured_at=now(), status='draft' default, và trả 201.
```

### 5.2 Read
```text
FR-REC-001-005: THE system SHALL cung cấp GET /api/v1/meetings/:meetingId/recording-config trả config của meeting.
FR-REC-001-006: IF meeting chưa có config, THEN trả 404 (RECORDING_CONFIG_NOT_FOUND).
```

### 5.3 Update
```text
FR-REC-001-007: THE system SHALL cung cấp PATCH /api/v1/meetings/:meetingId/recording-config cập nhật từng phần.
FR-REC-001-008: IF config chưa tồn tại, THEN trả 404 (RECORDING_CONFIG_NOT_FOUND).
FR-REC-001-009: WHILE có recording_session active cho meeting (status ∈ {starting, recording, paused} AND stopped_at IS NULL), IF PATCH được gọi THEN trả 409 (RECORDING_IN_PROGRESS). Guard được implement ngay (no-op hiện tại vì #23 chưa tạo session).
FR-REC-001-010: IF không có field nào đổi giá trị thực, THEN 200, KHÔNG ghi DB, KHÔNG audit (idempotent, ARCH-03).
```

### 5.4 Data integrity / validation
```text
FR-REC-001-011: WHEN videoSourceDeviceId != null (create/update), THE system SHALL kiểm tra device tồn tại và device_type=ip_camera; IF không thỏa THEN trả 400 (INVALID_VIDEO_SOURCE_DEVICE). KHÔNG yêu cầu device thuộc phòng của meeting (room-match để sau).
FR-REC-001-012: THE system SHALL validate retentionDays là số nguyên > 0 và ≤ 365 (đề xuất); audioSourceMode ∈ enum; enable* boolean.
FR-REC-001-013: THE system SHALL chỉ ghi các cột thuộc allowlist (§2.4); KHÔNG cho client set meeting_id/configured_by/configured_at/status/policy_*/config_json.
```

### 5.5 Authorization (SEC-02)
```text
FR-REC-001-014: IF không có JWT hợp lệ, THEN 401.
FR-REC-001-015: IF thiếu permission tương ứng (create/read/update), THEN 403.
FR-REC-001-016: THE system SHALL lấy configured_by từ JWT (sub), KHÔNG nhận từ body.
```

### 5.6 Audit
```text
FR-REC-001-017: WHEN create/update thành công có thay đổi, THE system SHALL ghi audit_logs (action_type 'create'|'update', entity_type='recording_configs', entity_id=<config id>, user_id=<actor>).
FR-REC-001-018: THE system SHALL đảm bảo write + audit trong cùng transaction; IF audit fail THEN rollback.
```

---

## 6. Non-functional Requirements (EARS)

```text
NFR-REC-001-001 (SEC-03): THE system SHALL validate toàn bộ body bằng class-validator, route-level ValidationPipe whitelist + forbidNonWhitelisted (field lạ → 400).
NFR-REC-001-002 (DATA-01): THE system SHALL dùng TypeORM trên bảng recording_configs có sẵn; KHÔNG Prisma; KHÔNG tạo bảng/migration/sửa schema/entity baseline.
NFR-REC-001-003 (Architecture): RecordingConfigController + RecordingConfigService đặt trong module recording; đọc meeting/device/session qua dataSource.manager (read-only); KHÔNG import MeetingsModule/IotModule (tránh circular).
NFR-REC-001-004 (Consistency): Response { success, message, data }; error theo format chuẩn dự án.
NFR-REC-001-005 (Performance): mỗi thao tác < 500ms điều kiện bình thường.
NFR-REC-001-006 (Observability): error log cho 500, ẩn với client.
```

---

## 7. Acceptance Criteria

```text
AC-REC-001-001 (create happy): Given meeting tồn tại chưa có config, người dùng có recording.config.create; When POST với body hợp lệ; Then 201, bản ghi tạo, configured_by=userId, status='draft', audit 'create'.
AC-REC-001-002 (create 404 meeting): Given meeting không tồn tại; When POST; Then 404 MEETING_NOT_FOUND.
AC-REC-001-003 (create 409 đã có): Given meeting đã có config; When POST; Then 409 RECORDING_CONFIG_EXISTS.
AC-REC-001-004 (read happy): Given config tồn tại; When GET; Then 200 trả data camelCase.
AC-REC-001-005 (read chưa có): Given chưa có config; When GET; Then theo [NC-2] (đề xuất 404 NOT_CONFIGURED).
AC-REC-001-006 (update partial): Given config tồn tại, không session active; When PATCH { enableVideo:true }; Then 200, chỉ enable_video đổi, audit 'update'.
AC-REC-001-007 (update 404): Given chưa có config; When PATCH; Then 404 RECORDING_CONFIG_NOT_FOUND.
AC-REC-001-008 (update idempotent): Given config; When PATCH trùng giá trị; Then 200, không ghi/audit.
AC-REC-001-009 (device không phải ip_camera): Given videoSourceDeviceId trỏ device không phải ip_camera; When POST/PATCH; Then từ chối ([NC-4]).
AC-REC-001-010 (authorization): Given thiếu quyền; When gọi; Then 403.
```

---

## 8. Edge / Error Cases (EARS)

```text
EC-REC-001-001: IF meetingId sai UUID, THEN 400 (VALIDATION_ERROR).
EC-REC-001-002: IF body có field ngoài allowlist, THEN 400 (forbidNonWhitelisted).
EC-REC-001-003: IF retentionDays ≤ 0 hoặc > 365 hoặc không nguyên, THEN 400.
EC-REC-001-004: IF audioSourceMode ngoài enum, THEN 400.
EC-REC-001-005: IF videoSourceDeviceId sai UUID, THEN 400; nếu UUID nhưng device không tồn tại/không ip_camera → [NC-4].
EC-REC-001-006: IF lỗi DB, THEN rollback + 500 (INTERNAL_SERVER_ERROR).
```

### 8.1 Error Code Map

| HTTP | Code | Kịch bản |
|---|---|---|
| 400 | `VALIDATION_ERROR` | sai uuid/enum/retention/field lạ |
| 401 | `UNAUTHORIZED` | thiếu JWT |
| 403 | `FORBIDDEN` | thiếu permission |
| 404 | `MEETING_NOT_FOUND` | create: meeting không tồn tại |
| 404 | `RECORDING_CONFIG_NOT_FOUND` | read([NC-2])/update: chưa có config |
| 409 | `RECORDING_CONFIG_EXISTS` | create: meeting đã có config |
| 409 | `RECORDING_IN_PROGRESS` | update khi đang ghi ([NC-3]) |
| 500 | `INTERNAL_SERVER_ERROR` | lỗi hệ thống |

---

## 9. Traceability

| Requirement | EARS | Nguồn |
|---|---|---|
| FR-001..004 | Ubiquitous/Unwanted | UC-30/108; 1:1 meeting |
| FR-005..006 | Ubiquitous | UC-109 |
| FR-007..010 | Unwanted/State | UC-110; ARCH-03 |
| FR-011..013 | Event/Unwanted | SEC-03; allowlist |
| FR-014..016 | Unwanted | SEC-02 |
| FR-017..018 | Event | audit pattern IOT |
| NFR-001..006 | — | SEC-03/DATA-01/Architecture |

---

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| D-1 | **TÁI DÙNG** entity `recording_configs` có sẵn (meeting-centric). KHÔNG tạo bảng/migration/sửa schema. KHÔNG đụng entity `meetings`. (HỦY hướng per-camera cũ.) |
| D-2 | 3 endpoint meeting-scoped: POST (404 meeting / 409 đã có), GET, PATCH (404 chưa có / 409 đang ghi). |
| D-3 | `RecordingConfigController` + `RecordingConfigService` trong module recording; route `meetings/:meetingId/recording-config`; đọc meeting/device/session qua `dataSource.manager` (read-only); KHÔNG import MeetingsModule/IotModule. Route KHÔNG đụng meetings controller (đã verify). |
| D-4 | Field CRUD: enableAudio/enableVideo/enableTranscription/videoSourceDeviceId/audioSourceMode/autoStart/consentRequired/retentionDays. Cột nâng cao để default (status='draft'), không expose. |
| D-5 | configured_by = JWT userId; configured_at = now() lúc tạo (entity set thủ công). |
| D-6 | Validate route-level whitelist+forbidNonWhitelisted; videoSourceDeviceId → ip_camera tồn tại; audioSourceMode ∈ enum; retentionDays >0 (≤365 đề xuất). |
| D-7 | Permission `recording.config.create/read/update` (theo contract). Seed ADMIN/MANAGER. Audit create/update vào `audit_logs` (entity_type='recording_configs') — đề xuất tạo `RecordingConfigAuditRepository` raw-insert (mirror `IotAuditRepository`). |

---

## 11. Quyết định bổ sung đã chốt (vòng 2)

| # | Quyết định |
|---|---|
| **NC-1** | UC-108 chỉ là **cross-reference tới UC-30** (create) — không phải endpoint thứ 4. Đã giải quyết. |
| **NC-2 → chốt** | GET khi chưa có config → **404 `RECORDING_CONFIG_NOT_FOUND`** (nhất quán PATCH; không trả null/default). |
| **NC-3 → chốt** | **Implement guard session-active NGAY**: query `recording_sessions` WHERE meeting_id, status ∈ {starting, recording, paused}, stopped_at IS NULL → có → **409 `RECORDING_IN_PROGRESS`**. No-op hiện tại (#23 chưa tạo session) nhưng đúng về sau. |
| **NC-4 → chốt** | `videoSourceDeviceId != null` → phải là **ip_camera tồn tại**; sai → **400 `INVALID_VIDEO_SOURCE_DEVICE`**. KHÔNG room-match (để sau). |
| **NC-5 → chốt** | PATCH có thay đổi → **bump `configured_by` = JWT userId + `configured_at` = now()** (phản ánh lần sửa cuối). |

---

> Trạng thái: **CHỜ REVIEW**. Chỉ là spec — chưa có plan.md/tasks.md, chưa code. Dừng chờ Thiếu Chủ review.
