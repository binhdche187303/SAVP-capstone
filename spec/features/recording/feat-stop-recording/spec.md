---
name: feat-stop-recording
description: Dừng ghi hình IP camera (ffmpeg graceful stop), chốt file mp4 → tạo media_files, cập nhật recording_session stopped. Phase #24 / UC-116.
category: recording
---

# Feature Specification: Dừng ghi hình từ IP Camera (Stop Video Recording)

- **Feature ID**: REC-003 (UC-116 · phase #24)
- **Feature Name**: Dừng ghi hình từ IP Room Camera
- **Module / Domain**: recording
- **Created Date**: 2026-06-15
- **Status**: Draft (RECON xong — còn [NEEDS CLARIFICATION])
- **Source Documents**:
  - `CLAUDE.md` (SEC-01 không log secret; ARCH-02 inline/queue; 10.7 recording tách session/media; DATA-01 không migration)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-116 stop-video — dòng 3950-3972)
  - `spec/features/recording/feat-start-recording` (REC-002 — start, RecordingProcessManager)
  - `src/modules/recording/entities/recording-session.entity.ts`, `media-file.entity.ts`
  - `src/modules/recording/services/recording-process-manager.ts`

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo spec REC-003 (stop-video): tìm session active → manager.stop (graceful 'q' → đợi exit → timeout kill) → đọc size/checksum/duration → tạo media_files → session stopped. RECON file:line. Còn NC-1..5. | Toàn bộ file (bản đầu tiên) |
| 2026-06-16 | Chốt NC-1..6: route theo contract (`:sessionId` trong path) + verify meeting_id; `STOP_TIMEOUT_MS=3000` hằng số; duration wall-clock; **checksum STREAMING sha256** (createReadStream→hash); v1 đồng bộ **200**; **bỏ audit log**. Mục 10 → Resolved. | Mục 3, 4, 5, 6, 10 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
REC-002 (#23b) đã cho **bắt đầu** ghi hình: ffmpeg ghi RTSP→mp4 local, tạo `recording_session` (status `recording`), `RecordingProcessManager` giữ `Map<sessionId, ChildProcess>`. REC-003 (#24) hiện thực **dừng** ghi: dừng tiến trình ffmpeg **êm** (để file mp4 đóng đúng), chốt metadata file (size, checksum, duration), tạo bản ghi `media_files`, và chuyển `recording_session` sang `stopped`.

### 1.2 Mục tiêu
- Endpoint dừng ghi (UC-116) cho một `recording_session` đang active của meeting.
- Dừng ffmpeg **graceful**: ghi `q` vào `stdin` → đợi tiến trình tự thoát (ffmpeg ghi trailer/moov) → quá timeout mới `kill` (SIGKILL).
- Chốt file: đọc `file_size_bytes`, `checksum` (sha256), `duration_seconds` (wall-clock v1) từ file mp4 đã đóng.
- Tạo `media_files` (file_type=video, storage_provider=local) trỏ tới file; liên kết `recording_session_id` + `meeting_id`.
- Cập nhật `recording_session`: status=`stopped`, `stopped_at`, `stopped_by`, `file_size_bytes`, `duration_seconds`, `checksum`.

### 1.3 Giá trị mang lại
- Hoàn tất vòng đời ghi hình (start → stop → file chốt) — capstone demo trọn vẹn.
- Chuẩn hóa `media_files` để các phase sau (playback, report, upload S3) dùng lại.

### 1.4 Out-of-scope
- **Stop audio** (UC-117), capture-agent đa kênh, `recording_segments`.
- Upload S3/MinIO, `background_jobs media_processing` (contract async — xem [NC-5]); v1 chốt **local + đồng bộ**.
- Transcode/transcription/playback streaming.
- Pause/resume, auto-stop khi meeting end.
- Đổi schema/migration — dùng `recording_sessions` + `media_files` có sẵn (DATA-01).

---

## 2. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| UC-116 (contract) | [API_CONTRACT_v1.0_with_system_roles.md:4074-4100](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md): `POST /api/v1/live-meetings/{meetingId}/recording/{sessionId}/stop-video` · perm `recording.video.stop` · **Async: Yes** · **202** `{recordingSessionId, status:"processing", jobId, stoppedAt}` · ghi chú "Trigger background_jobs (media_processing) để upload S3". ⇒ contract thiết kế async+S3; v1 local đồng bộ → lệch response/status (xem [NC-5]). `sessionId` nằm TRONG path. |
| recording_session (cập nhật khi stop) | [recording-session.entity.ts:66-106](../../../../src/modules/recording/entities/recording-session.entity.ts): `status`(enum, set `stopped`), `stopped_at`(nullable), `stopped_by`(nullable uuid), `file_size_bytes`(bigint nullable → lưu dạng string), `duration_seconds`(int nullable), `checksum`(varchar255 nullable), `storage_path`(đã set ở REC-002). Active = status ∈ {starting,recording,paused} & `stopped_at` IS NULL. |
| media_files (INSERT 1 dòng video) | [media-file.entity.ts:37-131](../../../../src/modules/recording/entities/media-file.entity.ts). **NOT NULL** (không nullable, không default): `file_name`(varchar255), `file_type`(varchar50), `mime_type`(varchar120), `storage_provider`(varchar50), `storage_key`(text). **Default**: `version_no=1`, `visibility_level='internal'`, `is_active=true`, `uploaded_at=now()`. Nullable hữu ích: `meeting_id`, `recording_session_id`, `uploaded_by`, `file_size_bytes`(bigint→string), `checksum`, `duration_seconds`, `file_code`, `file_url`, `metadata_json`. |
| enum media_files | `MediaFileType`: audio/**video**/image/document/transcript/minutes_attachment/export/evidence. `StorageProvider`: **local**/s3/minio/cloud_provider. ⇒ INSERT video local: `file_type='video'`, `mime_type='video/mp4'`, `storage_provider='local'`, `storage_key=<storage_path>`, `file_name=<id>.mp4`. |
| RecordingProcessManager | [recording-process-manager.ts:80-92](../../../../src/modules/recording/services/recording-process-manager.ts): có `has()`, `get()`, `markStopping()` (set `stopping=true` → exit KHÔNG bị coi failed). **CHƯA có** method `stop()` đợi-exit. `markFailed()` `procs.delete(sessionId)` sau khi update. `start()` spawn mặc định (chỉ `{windowsHide:true}`) ⇒ **stdio mặc định 'pipe'** ⇒ `proc.stdin` (Writable) **sẵn có** để ghi `'q'`. `proc.on('exit')` đã guard bằng `entry.stopping`. |
| móc stop còn thiếu | Cần thêm `stop(sessionId)`: `markStopping` → `proc.stdin.write('q')` → đợi `'exit'` (timeout → `proc.kill('SIGKILL')`) → trả về (hoặc trả tail stderr). Hiện exit-handler `procs.delete` chỉ chạy ở `markFailed`; với stop êm cần đảm bảo dọn Map sau exit. |
| ffprobe | `D:\ffmpeg\bin` có `ffmpeg.exe`, `ffplay.exe`, **`ffprobe.exe`** (cùng thư mục `FFMPEG_PATH`). ⇒ ffprobe khả dụng nếu sau muốn lấy duration chính xác; **v1 dùng wall-clock** (xem [NC-3]). |
| storage | ffmpeg ghi thẳng `RECORDING_STORAGE_PATH/<sessionId>.mp4` (REC-002). `storage_path` không chứa credential ⇒ log path an toàn. `+frag_keyframe+empty_moov` ⇒ file vẫn phát được kể cả khi kill. |

### 2.1 Actor & Roles
ADMIN/MANAGER có `recording.video.stop` (seed mới). Guard mock như REC-002 (`JwtAuthGuard` + `MockPermissionsGuard` + `@Permissions`).

### 2.2 Entity liên quan
`recording_sessions` (cập nhật), `media_files` (tạo), `meetings` (đọc khi cần). KHÔNG `background_jobs`/`recording_segments`/`capture_*` ở phase này.

---

## 3. Endpoint (đề xuất — chốt ở [NC-1])
| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/:meetingId/recording/:sessionId/stop-video` (theo contract) |
| Permission | `recording.video.stop` |
| Auth | `JwtAuthGuard` + `MockPermissionsGuard` |
| HTTP | **200** (chốt đồng bộ, khác contract 202 — [NC-5]) |
| Body | (không) |

**Response (đề xuất v1, đồng bộ):**
```json
{
  "success": true,
  "message": "Video recording stopped",
  "data": {
    "recordingSessionId": "uuid",
    "status": "stopped",
    "stoppedAt": "2026-06-15T10:30:00+07:00",
    "durationSeconds": 1800,
    "fileSizeBytes": "104857600",
    "mediaFileId": "uuid"
  }
}
```

---

## 4. Flow (đề xuất)

```text
POST .../recording/:sessionId/stop-video
1. JwtAuthGuard → userId. 401/403 nếu thiếu auth/quyền. ParseUUIDPipe meetingId + sessionId.
2. Load recording_session theo :sessionId (raw/repo). Không có → 404 RECORDING_SESSION_NOT_FOUND.
   - Kiểm tra session.meeting_id === :meetingId (nếu lệch → 404, tránh nhầm meeting).
3. Nếu session.status ∉ {recording, starting, paused} (đã stopped/failed) → 409 RECORDING_NOT_ACTIVE.
4. Dừng tiến trình (graceful):
   a. processManager.has(sessionId)?
      - CÓ handle → manager.stop(sessionId): markStopping → proc.stdin.write('q\n') → đợi 'exit'
        (timeout STOP_TIMEOUT_MS, vd 5000) → quá timeout: proc.kill('SIGKILL') → đợi exit lần nữa.
      - KHÔNG handle (orphan: process do tiến trình trước/đã rơi khỏi Map) → bỏ qua bước kill,
        chốt theo file hiện có ([NC-1]/orphan). Ghi nhận metadata_json.orphan_stop=true.
   b. Sau khi exit (hoặc orphan) → đảm bảo file mp4 đã đóng (đợi exit TRƯỚC khi đọc file).
5. Chốt file (storage_path):
   - file tồn tại? đọc size (fs.statSync.size → string bigint).
   - checksum = sha256 STREAMING (createReadStream → createHash('sha256') → hex) — D-4.
   - duration_seconds = floor((stoppedAt - started_at)/1000) - paused_duration_seconds (wall-clock, D-3).
   - file KHÔNG tồn tại / size 0 → vẫn set session stopped nhưng KHÔNG tạo media_files; ghi error_message='empty file'.
6. Transaction:
   a. INSERT media_files { file_name=<sessionId>.mp4, file_type=video, mime_type='video/mp4',
      storage_provider='local', storage_key=storage_path, recording_session_id, meeting_id,
      uploaded_by=userId, file_size_bytes, checksum, duration_seconds }.
   b. UPDATE recording_sessions { status='stopped', stopped_at, stopped_by=userId,
      file_size_bytes, duration_seconds, checksum } (+ metadata_json.orphan_stop nếu orphan).
   (KHÔNG audit log — D-6.)
7. Trả 200 summary { recordingSessionId, status:'stopped', stoppedAt, durationSeconds, fileSizeBytes, mediaFileId }.
```

### 4.1 RecordingProcessManager.stop (mới — mô tả hành vi)
```text
- stop(sessionId, timeoutMs): Promise<'exited' | 'killed' | 'orphan'>
  - entry = procs.get(sessionId); nếu !entry → return 'orphan'.
  - markStopping(sessionId) (exit không bị markFailed).
  - proc.stdin?.write('q'); (ffmpeg nhận 'q' → kết thúc, ghi trailer).
  - race: proc 'exit' → 'exited'; timeout → proc.kill('SIGKILL') rồi đợi 'exit' → 'killed'.
  - finally procs.delete(sessionId).
- KHÔNG log storage_path-có-cred (path không chứa cred → an toàn); KHÔNG log url/args.
```

---

## 5. Functional Requirements (EARS)

```text
FR-REC-003-001: THE system SHALL cung cấp POST /api/v1/live-meetings/:meetingId/recording/:sessionId/stop-video để dừng một phiên ghi hình.
FR-REC-003-002: IF recording_session :sessionId không tồn tại (hoặc meeting_id không khớp :meetingId), THEN 404 RECORDING_SESSION_NOT_FOUND.
FR-REC-003-003: IF session.status không thuộc {starting, recording, paused} (đã stopped/failed), THEN 409 RECORDING_NOT_ACTIVE.
FR-REC-003-004: WHEN còn handle tiến trình (manager.has), THE system SHALL dừng ffmpeg ÊM bằng cách ghi 'q' vào stdin và ĐỢI process 'exit' TRƯỚC khi đọc file; IF quá STOP_TIMEOUT_MS (=3000), THEN SHALL kill('SIGKILL').
FR-REC-003-005: WHEN KHÔNG còn handle (orphan), THE system SHALL bỏ qua kill và chốt theo file hiện có, đánh dấu metadata_json.orphan_stop=true.
FR-REC-003-006: WHEN file tồn tại và size > 0, THE system SHALL tính file_size_bytes (fs.stat), checksum=sha256 STREAMING (createReadStream→createHash), duration_seconds (wall-clock = stopped_at - started_at - paused_duration_seconds).
FR-REC-003-007: WHEN chốt thành công, THE system SHALL tạo media_files (file_type=video, mime_type=video/mp4, storage_provider=local, storage_key=storage_path, recording_session_id, meeting_id, uploaded_by, file_size_bytes, checksum, duration_seconds) TRONG transaction.
FR-REC-003-008: WHEN chốt, THE system SHALL cập nhật recording_session: status=stopped, stopped_at=now, stopped_by=JWT user, file_size_bytes, duration_seconds, checksum.
FR-REC-003-009: IF file KHÔNG tồn tại hoặc size=0, THEN session vẫn → stopped + error_message='empty file', và SHALL NOT tạo media_files.
FR-REC-003-010: THE system SHALL trả 200 { recordingSessionId, status:'stopped', stoppedAt, durationSeconds, fileSizeBytes, mediaFileId }.
```

## 6. Non-functional (EARS)
```text
NFR-REC-003-001 (Graceful stop): THE system SHALL ưu tiên dừng êm (stdin 'q') để ffmpeg đóng container đúng; chỉ kill khi quá timeout. SHALL đợi 'exit' xong mới đọc size/checksum (tránh đọc file đang ghi dở).
NFR-REC-003-002 (SEC-01): THE system SHALL NOT log url/args/credential. storage_path không chứa cred nên được phép log/persist. error_message luôn đã che (redactUrl) khi nguồn từ stderr.
NFR-REC-003-003 (Atomicity): INSERT media_files + UPDATE recording_session SHALL nằm trong 1 transaction (QueryRunner); rollback nếu lỗi.
NFR-REC-003-004 (Persistence): Dùng recording_sessions + media_files có sẵn; KHÔNG migration/đổi schema (DATA-01). file_size_bytes là bigint → lưu/đọc dạng string.
NFR-REC-003-005 (Config): STOP_TIMEOUT_MS=3000 (hằng số trong manager); FFMPEG_PATH/RECORDING_STORAGE_PATH tái dùng REC-002.
NFR-REC-003-008 (Checksum streaming): checksum SHALL tính bằng stream (createReadStream→createHash('sha256')) để KHÔNG nạp toàn file vào RAM.
NFR-REC-003-006 (Robustness): stop SHALL không treo promise; mọi nhánh (exit/timeout/orphan/file-missing) đều kết thúc xác định và dọn Map.
NFR-REC-003-007 (Idempotency-ish): Gọi stop lần 2 trên session đã stopped → 409 RECORDING_NOT_ACTIVE (không tạo media_files trùng).
```

## 7. Acceptance Criteria
```text
AC-REC-003-001 (happy): Given session 'recording' còn handle + file mp4 > 0; When stop-video; Then ffmpeg nhận 'q' và exit, session→stopped (stopped_at/stopped_by/size/duration/checksum), 1 media_files video/local tạo, 200 summary đúng.
AC-REC-003-002: Given :sessionId không tồn tại; Then 404 RECORDING_SESSION_NOT_FOUND.
AC-REC-003-003: Given session.meeting_id != :meetingId; Then 404 RECORDING_SESSION_NOT_FOUND.
AC-REC-003-004: Given session đã 'stopped'/'failed'; Then 409 RECORDING_NOT_ACTIVE; KHÔNG tạo media_files mới.
AC-REC-003-005 (timeout→kill): Given ffmpeg không thoát sau 'q' trong STOP_TIMEOUT_MS; Then kill SIGKILL, session vẫn stopped + media_files theo file hiện có.
AC-REC-003-006 (orphan): Given session 'recording' nhưng manager.has=false; When stop; Then không kill, chốt file hiện có, metadata_json.orphan_stop=true, session→stopped.
AC-REC-003-007 (empty file): Given file thiếu/size 0; Then session→stopped + error_message='empty file', KHÔNG media_files, 200 với mediaFileId=null.
AC-REC-003-008: thiếu quyền → 403; sai uuid → 400.
```

## 8. Edge / Error Cases
```text
EC-REC-003-001: meetingId/sessionId sai UUID → 400 VALIDATION_ERROR.
EC-REC-003-002: ffmpeg đã tự chết trước khi stop (đã thành failed) → 409 RECORDING_NOT_ACTIVE (status=failed).
EC-REC-003-003: stdin đã đóng/null → fallback kill; vẫn chốt file.
EC-REC-003-004: checksum/stat ném lỗi (file lock) → đợi/ë retry ngắn hoặc bỏ checksum (set null) nhưng session vẫn stopped ([NC-4]).
EC-REC-003-005: transaction lỗi khi INSERT media_files → rollback; session KHÔNG bị set stopped (giữ recording) để thử lại; trả 500.
EC-REC-003-006: gọi stop đồng thời 2 request → request sau thấy status đã stopped → 409 (chống tạo media_files trùng).
```

### 8.1 Error Code Map
| HTTP | Code |
|---|---|
| 400 | VALIDATION_ERROR |
| 401 | UNAUTHORIZED |
| 403 | FORBIDDEN |
| 404 | RECORDING_SESSION_NOT_FOUND |
| 409 | RECORDING_NOT_ACTIVE |
| 500 | RECORDING_STOP_FAILED / INTERNAL_SERVER_ERROR |

---

## 9. Traceability
| Req | Nguồn |
|---|---|
| FR-001..003 | UC-116; recording_session active rule |
| FR-004..005 | RecordingProcessManager (stdin 'q'/kill/orphan); NFR graceful |
| FR-006 | fs.stat/sha256/wall-clock; recording_session cột size/duration/checksum |
| FR-007 | media_files entity (NOT NULL set); CLAUDE 10.7 tách session/media |
| FR-008..010 | recording_session update; UC-116 response (đã điều chỉnh v1) |
| NFR-003 | CLAUDE 14.4 transaction nhiều bảng |

---

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| **D-1** (NC-1) | Route theo **contract**: `POST /api/v1/live-meetings/:meetingId/recording/:sessionId/stop-video` — `sessionId` trong path; load session theo `:sessionId`, **verify `meeting_id === :meetingId`** (lệch → 404 RECORDING_SESSION_NOT_FOUND). |
| **D-2** (NC-2) | Dừng **graceful**: `markStopping` → `proc.stdin.write('q')` → đợi `'exit'`; quá `STOP_TIMEOUT_MS` → `proc.kill('SIGKILL')` rồi đợi exit. |
| **D-3** (NC-3) | Duration = **wall-clock**: `floor((stoppedAt - startedAt)/1000) - paused_duration_seconds`, kẹp `max(0,…)`. ffprobe là future. |
| **D-4** (NC-4) | Checksum = **sha256 STREAMING**: `createReadStream(path)` → `createHash('sha256')` → hex (không nạp toàn file vào RAM). |
| **D-5** (NC-5) | v1 **đồng bộ HTTP 200**, `status:'stopped'`, KHÔNG `jobId`/`background_jobs`/S3 (lệch contract 202 async — ghi rõ; S3 là future). |
| **D-6** (NC-6) | **KHÔNG** ghi audit log ở phase này (giảm phụ thuộc; có thể bổ sung sau). |
| **D-7** | `STOP_TIMEOUT_MS = 3000` (hằng số trong `RecordingProcessManager`). |

---

> Trạng thái: **D-1..7 đã chốt**. plan.md + tasks.md + implement tiếp theo.
