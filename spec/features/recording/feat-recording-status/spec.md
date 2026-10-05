---
name: feat-recording-status
description: Xem trạng thái recording session (read-only, live duration/size) + crash recovery reconcile lúc boot cho session mồ côi. Phase #25.
category: recording
---

# Feature Specification: Trạng thái ghi hình & Khôi phục sau sự cố (Recording Status & Crash Recovery)

- **Feature ID**: REC-004 (phase #25)
- **Feature Name**: Recording status (read) + crash recovery reconcile
- **Module / Domain**: recording
- **Created Date**: 2026-06-16
- **Status**: Draft (RECON xong — còn [NEEDS CLARIFICATION])
- **Source Documents**:
  - `CLAUDE.md` (SEC-01 không log secret; ARCH-02 inline/queue; §12 WebSocket `recording.status.updated`; §22.11 `GET /recording-sessions/:id`; DATA-01 không migration)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-119/120/121 media-files; §5342 status enum; §5323 WS event recording.status.updated)
  - `spec/features/recording/feat-start-recording` (REC-002), `feat-stop-recording` (REC-003 — finalize logic)
  - `src/modules/recording/services/recording-process-manager.ts`, `recording-session.service.ts`
  - `src/modules/scheduler/scheduler.service.ts` (mẫu @Cron)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo spec REC-004: (A) status endpoint read-only (live duration/size); (B) crash recovery reconcile lúc boot cho session active mồ côi. RECON file:line. Còn NC-1..4 + giả định single-instance. | Toàn bộ file (bản đầu tiên) |
| 2026-06-16 | Chốt NC-1..4: (1) reconcile **hybrid** (file hợp lệ→stopped, else→failed); (2) **boot-only** (OnApplicationBootstrap, cron future); (3) permission **mới `recording.video.status`** (seed ADMIN/MANAGER); (4) status theo **`:sessionId`** trong path. Refactor: tách `finalizeFileToStopped` dùng chung REC-003/reconcile. Mục 10 → Resolved. | Mục 3, 4, 10 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
REC-002/003 đã start/stop ghi hình bằng ffmpeg, quản lý qua `RecordingProcessManager` (Map in-memory `sessionId → ChildProcess`). Hai khoảng trống:
1. **Không có cách đọc trạng thái** một phiên ghi (FE/dashboard cần biết đang `recording`/`stopped`/`failed`, thời lượng tới hiện tại, kích thước file).
2. **Map process là in-memory** → khi backend **restart/crash** trong lúc đang ghi, tiến trình ffmpeg con bị kill theo (hoặc rơi khỏi Map), nhưng row `recording_sessions` vẫn kẹt ở `recording` + `stopped_at = NULL` **mãi mãi** (zombie). Cần cơ chế **reconcile** khi boot để dọn các session mồ côi.

### 1.2 Mục tiêu
- **Phần A** — Endpoint **read-only** trả trạng thái 1 recording session: nếu đang `recording` → tính **duration tới hiện tại** (wall-clock) + **file size hiện tại** (đọc `fs.stat`, không đụng tiến trình). Nếu đã `stopped`/`failed` → trả giá trị đã chốt trong DB.
- **Phần B** — **Crash recovery reconcile** chạy lúc boot (`OnApplicationBootstrap` trong recording module): tìm session `status ∈ {starting,recording,paused}` và `stopped_at IS NULL` mà `RecordingProcessManager` **KHÔNG** còn handle → xử lý theo chính sách reconcile (xem [NC-1]).

### 1.3 Giá trị mang lại
- FE/dashboard theo dõi recording realtime (kết hợp WS `recording.status.updated` ở phase sau).
- Hệ thống tự dọn zombie session sau restart → dữ liệu nhất quán, không kẹt `recording` vĩnh viễn.

### 1.4 Out-of-scope
- Phát WebSocket `recording.status.updated` (chỉ chuẩn bị dữ liệu; emit để phase WS sau).
- Pause/resume (UC-114/115), stop-audio (UC-117), sync metadata (UC-118), playback (UC-122).
- Liệt kê media-files (UC-119/120/121 — đã có/đề riêng).
- Multi-instance ownership/heartbeat (chỉ NÊU; xem NFR single-instance).
- Đổi schema/migration (DATA-01) — dùng cột `recording_sessions` có sẵn.

---

## 2. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| Contract — status endpoint | **KHÔNG có** UC `GET recording status / session` trong `API_CONTRACT_v1.0_with_system_roles.md`. Recording UC chỉ tới UC-114..125 (pause/resume/stop/sync/list/detail/playback/delete/error/transcribe). Media đọc: **UC-119/120** [API_CONTRACT_v1.0_with_system_roles.md:4140-4142](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md) `GET /api/v1/meetings/{meetingId}/media-files` perm `recording.files.read`; **UC-121** [:4043-4045] `GET /api/v1/media-files/{fileId}` perm `recording.files.read`. ⇒ Phần A là endpoint **backend bổ sung** (không có trong contract); CLAUDE.md §22.11 gợi ý `GET /api/v1/recording-sessions/:id`. Xem [NC-3]/[NC-4]. |
| Contract — WS + enum | [API_CONTRACT_v1.0_with_system_roles.md:5504] WS event `recording.status.updated` `{meetingId, sessionId, status, timestamp}`. [:5342] enum `starting → recording → paused → stopped → processing \| failed`. |
| recording_sessions (đọc/reconcile) | [recording-session.entity.ts](../../../../src/modules/recording/entities/recording-session.entity.ts): `id`, `meeting_id`, `session_type`, `status`(enum), `started_at`(NN), `stopped_at`?, `paused_duration_seconds`(def 0), `storage_path`?, `file_size_bytes`?(bigint→string), `duration_seconds`?, `checksum`?, `error_message`?, `stopped_by`?, `metadata_json`?. Active = `status ∈ {starting,recording,paused}` & `stopped_at IS NULL`. |
| RecordingProcessManager | [recording-process-manager.ts:82-88](../../../../src/modules/recording/services/recording-process-manager.ts): `has(sessionId): boolean` đọc Map `procs` in-memory; `get()` trả ChildProcess. ⇒ reconcile dùng `has(id)===false` để nhận diện session mồ côi (không còn tiến trình trong instance hiện tại). **Map mất khi restart** ⇒ sau boot mọi session DB active đều `has=false`. |
| REC-003 finalize | [recording-session.service.ts](../../../../src/modules/recording/services/recording-session.service.ts) `stopVideo()` đã có logic: đọc `fs.stat` size, `sha256Stream`, duration wall-clock, INSERT `media_files` + UPDATE session `stopped` (transaction). ⇒ reconcile-as-stopped TÁI DÙNG được finalize này ([NC-1] phương án a). |
| Lifecycle hooks | Dự án **CHƯA dùng** `OnApplicationBootstrap`. Đã dùng `OnModuleInit` ở [storage.service.ts:33](../../../../src/modules/storage/storage.service.ts), [mail.service.ts:22](../../../../src/modules/mail/mail.service.ts). ⇒ reconcile lúc boot đặt `OnApplicationBootstrap` (chạy SAU khi toàn app khởi tạo — an toàn để query DB) là lần đầu trong repo. |
| Scheduler/@Cron | [scheduler.service.ts:46](../../../../src/modules/scheduler/scheduler.service.ts): có `@Cron(EVERY_MINUTE)` + gate `SCHEDULER_ENABLED`. `SchedulerModule` import `IotModule` (KHÔNG import RecordingModule). ⇒ nếu muốn reconcile định kỳ (ngoài boot), thêm cron — nhưng cần wiring module (xem [NC-2]). |
| Controller hiện có | [recording-session.controller.ts](../../../../src/modules/recording/controllers/recording-session.controller.ts): chỉ `POST start-video` + `POST stop-video`. Chưa có GET. |

### 2.1 Actor & Roles
- Phần A: người dùng có quyền đọc recording (perm — [NC-3]). Guard mock như REC-002/003.
- Phần B: **không có actor** (system job lúc boot); ghi `audit`? — không (nhất quán REC-003 D-6), chỉ log.

### 2.2 Entity liên quan
`recording_sessions` (đọc + reconcile-update), `media_files` (tạo nếu reconcile-as-stopped, tái dùng REC-003). KHÔNG bảng mới.

---

## 3. Phần A — Status Endpoint

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/live-meetings/:meetingId/recording/:sessionId/status` (đối xứng start/stop) — xem [NC-4] |
| Permission | `recording.video.status` (mới) **hoặc** tái dùng `recording.files.read` — [NC-3] |
| Auth | `JwtAuthGuard` + `MockPermissionsGuard` |
| HTTP | 200 |
| Body | (không) |

**Response 200:**
```json
{
  "success": true,
  "message": "Recording status retrieved",
  "data": {
    "recordingSessionId": "uuid",
    "meetingId": "uuid",
    "sessionType": "video",
    "status": "recording",
    "startedAt": "2026-06-16T10:00:00+07:00",
    "stoppedAt": null,
    "live": true,
    "durationSeconds": 125,
    "fileSizeBytes": "10485760",
    "hasProcessHandle": true
  }
}
```

- `live = (status === recording && stopped_at null)`.
- Khi `live`: `durationSeconds` = wall-clock `floor((now-started_at)/1000) - paused`; `fileSizeBytes` = `fs.statSync(storage_path).size` nếu file tồn tại (else null). **Read-only — KHÔNG đụng tiến trình ffmpeg.**
- Khi `stopped`/`failed`: trả `duration_seconds` + `file_size_bytes` đã chốt trong DB.
- `hasProcessHandle = processManager.has(sessionId)` (chẩn đoán: true nếu instance hiện tại đang giữ tiến trình).

---

## 4. Phần B — Crash Recovery Reconcile (boot)

```text
OnApplicationBootstrap (RecordingReconcileService trong recording module):
1. Query session mồ côi:
   SELECT id, meeting_id, status, storage_path, started_at, paused_duration_seconds, metadata_json
   FROM recording_sessions
   WHERE status IN ('starting','recording','paused') AND stopped_at IS NULL.
2. Với mỗi session: nếu processManager.has(id) === true → BỎ QUA (đang ghi thật trong instance này).
   (Lưu ý: ngay sau boot Map rỗng → mọi session đều has=false; chỉ khác 0 nếu reconcile chạy lại runtime.)
3. Reconcile theo chính sách [NC-1]:
   - (a) finalize-as-stopped: nếu storage_path tồn tại & size>0 → tái dùng finalize REC-003
        (size/checksum/duration/INSERT media_files/UPDATE stopped + metadata recovered=true).
   - (b) mark interrupted/failed: UPDATE status='failed' (hoặc 'stopped'), stopped_at=now,
        error_message='interrupted by restart', metadata recovered=true; KHÔNG media_files.
   - hybrid (đề xuất): có file hợp lệ → (a); file thiếu/rỗng → (b) failed.
4. Log số session reconcile (KHÔNG log path-cred — path không cred, an toàn). KHÔNG ném lỗi làm chết boot
   (mỗi session bọc try/catch; lỗi 1 session không chặn các session khác / không chặn app start).
```

### 4.1 Vì sao OnApplicationBootstrap (không phải OnModuleInit)
`OnApplicationBootstrap` chạy sau khi TẤT CẢ module khởi tạo (DataSource sẵn sàng, provider đủ) → query DB an toàn. `OnModuleInit` có thể chạy trước khi dependency khác sẵn sàng.

---

## 5. Functional Requirements (EARS)

```text
# Phần A
FR-REC-004-001: THE system SHALL cung cấp GET /api/v1/live-meetings/:meetingId/recording/:sessionId/status trả trạng thái phiên ghi.
FR-REC-004-002: IF session :sessionId không tồn tại (hoặc meeting_id != :meetingId), THEN 404 RECORDING_SESSION_NOT_FOUND.
FR-REC-004-003: WHEN session đang live (status=recording & stopped_at null), THE system SHALL tính durationSeconds wall-clock (now-started-paused, kẹp ≥0) và fileSizeBytes = fs.stat(storage_path).size nếu file tồn tại (else null) — KHÔNG đụng tiến trình.
FR-REC-004-004: WHEN session đã stopped/failed, THE system SHALL trả duration_seconds + file_size_bytes đã lưu trong DB.
FR-REC-004-005: THE system SHALL trả hasProcessHandle = processManager.has(sessionId) và là READ-ONLY (không thay đổi DB/tiến trình).

# Phần B
FR-REC-004-006: WHEN application bootstrap, THE system SHALL quét recording_sessions status ∈ {starting,recording,paused} & stopped_at IS NULL.
FR-REC-004-007: WHILE reconcile, IF processManager.has(id) === true, THEN session SHALL bị bỏ qua (đang ghi thật).
FR-REC-004-008: WHEN session mồ côi có file hợp lệ (tồn tại & size>0), THE system SHALL finalize-as-stopped (tái dùng logic REC-003: size/checksum/duration, INSERT media_files, UPDATE stopped) và đánh dấu metadata recovered=true. [NC-1]
FR-REC-004-009: WHEN session mồ côi KHÔNG có file hợp lệ, THE system SHALL UPDATE status='failed', stopped_at=now, error_message='interrupted by restart', metadata recovered=true; SHALL NOT tạo media_files. [NC-1]
FR-REC-004-010: THE reconcile SHALL bọc mỗi session trong try/catch; lỗi 1 session SHALL NOT chặn session khác hay chặn app start.
```

## 6. Non-functional (EARS)

```text
NFR-REC-004-001 (SINGLE-INSTANCE — QUAN TRỌNG): Reconcile lúc boot giả định backend chạy ĐƠN INSTANCE. Vì Map process là in-memory cục bộ, một session 'recording' không có handle ở instance này CÓ THỂ đang được instance khác ghi thật (multi-instance). Đánh failed/stopped MÙ lúc boot trong môi trường multi-instance là SAI. THE system (v1) SHALL chỉ chạy single-instance; production multi-instance SHALL bổ sung ownership/heartbeat (vd recording_sessions.instance_id + last_heartbeat_at) để reconcile an toàn — ngoài scope #25.
NFR-REC-004-002 (Boot-safety): Reconcile SHALL NOT ném lỗi làm chết quá trình bootstrap; mọi lỗi log + tiếp tục.
NFR-REC-004-003 (Read-only A): Status endpoint SHALL NOT ghi DB, SHALL NOT gửi tín hiệu tới tiến trình ffmpeg.
NFR-REC-004-004 (SEC-01): KHÔNG log credential. storage_path không chứa cred → được phép log path. KHÔNG đọc/log nội dung file.
NFR-REC-004-005 (Persistence): Dùng cột recording_sessions/media_files có sẵn (DATA-01, KHÔNG migration). file_size_bytes bigint → string.
NFR-REC-004-006 (Windows stat lag): Trên Windows, fs.stat size của file đang ghi có thể cập nhật TRỄ → durationSeconds (wall-clock) là nguồn đáng tin hơn size cho “đang ghi”; size chỉ tham khảo. Ghi rõ trong tài liệu/response semantics.
NFR-REC-004-007 (Idempotent reconcile): Chạy reconcile nhiều lần SHALL an toàn — session đã stopped/failed không bị xử lý lại (điều kiện query loại trừ stopped_at IS NOT NULL).
```

## 7. Acceptance Criteria

```text
# Phần A
AC-REC-004-001 (live): Given session 'recording' + file đang ghi; When GET status; Then 200, live=true, durationSeconds≈wall-clock, fileSizeBytes=stat size (hoặc null nếu chưa thấy file), KHÔNG đổi DB/tiến trình.
AC-REC-004-002 (stopped): Given session 'stopped' có duration/size DB; When GET status; Then 200, live=false, trả giá trị DB.
AC-REC-004-003: Given :sessionId không tồn tại / meeting mismatch; Then 404 RECORDING_SESSION_NOT_FOUND.
AC-REC-004-004: thiếu quyền → 403; sai uuid → 400.

# Phần B
AC-REC-004-005 (recover→stopped): Given DB có session 'recording' stopped_at null, manager.has=false, file size>0; When bootstrap reconcile; Then session → stopped + media_files tạo + metadata recovered=true.
AC-REC-004-006 (recover→failed): Given session 'recording' mồ côi, file thiếu/size 0; When reconcile; Then session → failed, error_message='interrupted by restart', KHÔNG media_files.
AC-REC-004-007 (skip live): Given manager.has(id)=true (đang ghi runtime); When reconcile; Then session BỎ QUA, không đổi.
AC-REC-004-008 (boot-safe): Given reconcile 1 session ném lỗi; When bootstrap; Then app vẫn start, session khác vẫn xử lý.
AC-REC-004-009 (idempotent): Given session đã stopped/failed; When reconcile chạy lại; Then không xử lý lại (query loại trừ).
```

## 8. Edge / Error Cases

```text
EC-REC-004-001: storage_path null (session chưa kịp set) → reconcile coi như không có file → failed.
EC-REC-004-002: file đang bị lock (ffmpeg vừa thoát chưa nhả) → stat/checksum lỗi → fallback failed + log; không chặn boot.
EC-REC-004-003: nhiều session mồ côi cùng meeting → xử lý từng cái độc lập.
EC-REC-004-004 (A): storage_path null hoặc file chưa xuất hiện khi GET live → fileSizeBytes=null, durationSeconds vẫn tính wall-clock.
EC-REC-004-005 (multi-instance, NGOÀI v1): session có handle ở instance B → instance A reconcile có thể đánh nhầm failed (rủi ro đã nêu NFR-001; v1 single-instance loại trừ).
```

### 8.1 Error Code Map
| HTTP | Code |
|---|---|
| 400 | VALIDATION_ERROR |
| 401 | UNAUTHORIZED |
| 403 | FORBIDDEN |
| 404 | RECORDING_SESSION_NOT_FOUND |
| 500 | INTERNAL_SERVER_ERROR (Phần A; Phần B không trả HTTP) |

---

## 9. Traceability
| Req | Nguồn |
|---|---|
| FR-001..005 | CLAUDE §22.11 GET recording-sessions/:id; WS recording.status.updated; entity cột |
| FR-006..010 | RecordingProcessManager.has (Map in-memory); REC-003 finalize; OnApplicationBootstrap |
| NFR-001 | Map in-memory ⇒ single-instance; multi-instance cần heartbeat |
| NFR-006 | Windows fs.stat lag (kinh nghiệm REC-002/003) |

---

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| **D-1** (NC-1) | Reconcile **hybrid**: file hợp lệ (`existsSync` & size>0) → finalize-as-stopped (tái dùng `finalizeFileToStopped`, metadata `recovered=true`); else → `failed` + `error_message='interrupted by restart'` + metadata `recovered=true`. |
| **D-2** (NC-2) | **Boot-only**: `OnApplicationBootstrap` trong `RecordingReconcileService`. @Cron định kỳ là future (cần wiring SchedulerModule→RecordingModule). |
| **D-3** (NC-3) | Permission **mới `recording.video.status`** (action `video_status`), seed ADMIN/MANAGER. Không tái dùng `recording.files.read` (ngữ nghĩa session ≠ file). |
| **D-4** (NC-4) | Status theo **`:sessionId`** trong path: `GET /api/v1/live-meetings/:meetingId/recording/:sessionId/status` (đối xứng REC-003). |
| **D-5** (refactor) | Tách `private finalizeFileToStopped(session, {userId, recovered})` từ `stopVideo` (nhánh có file): size + sha256Stream + duration + transaction INSERT media_files + UPDATE stopped (+metadata recovered nếu set). REC-003 và reconcile dùng chung. |

---

> Trạng thái: **D-1..5 đã chốt**. plan.md + tasks.md + implement tiếp theo.
