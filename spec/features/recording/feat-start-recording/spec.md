---
name: feat-start-recording
description: Bắt đầu ghi hình IP camera qua ffmpeg (RTSP→mp4 local), tạo recording_session. Phase #23b. Không stop/media_files/audio.
category: recording
---

# Feature Specification: Bắt đầu ghi hình từ IP Camera (Start Video Recording)

- **Feature ID**: REC-002 (UC-111 · phase #23b)
- **Feature Name**: Bắt đầu ghi hình từ IP Room Camera
- **Module / Domain**: recording (+ common util, config)
- **Created Date**: 2026-06-15
- **Status**: Draft (đã chốt clarifications)
- **Source Documents**:
  - `CLAUDE.md` (SEC-01 không log secret; ARCH-02 inline/queue; 11.x camera/RTSP; DATA-01)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-111 start-video)
  - `spec/features/recording/feat-configure-recording` (REC-001)
  - `spec/features/iot/feat-store-rtsp-credentials` (IOT-015 — decryptSecret)
  - `src/modules/recording/entities/recording-session.entity.ts`
  - `src/modules/storage/storage.service.ts`, `src/modules/iot/services/iot-devices.service.ts` (rtsp_config)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo spec REC-002: start-video qua ffmpeg spawn, RecordingProcessManager singleton, tạo recording_session, decrypt RTSP cred (IOT-015), ENV FFMPEG_PATH/RECORDING_STORAGE_PATH. | Toàn bộ file (bản đầu tiên) |
| 2026-06-15 | Chốt NC-1..5: camera=body.cameraDeviceId (link config nếu có); **grace-window ~2s** (race exit/timeout → recording HOẶC failed+`RECORDING_START_FAILED`); nhận+bỏ qua outputFormat/storageProvider; controller module recording; **HTTP 201**. Mục 11 → đã chốt. | Mục 3, 4, 8, 11 |
| 2026-06-15 | Fix args ffmpeg → **VIDEO-ONLY** (`-map 0:v:0`): camera RTSP thật phát kèm audio pcm_alaw (G.711) không tương thích container mp4 khi `-c copy` → ffmpeg lỗi header, thoát ngay → `RECORDING_START_FAILED`. Ghi kèm audio (transcode aac) là tương lai, ngoài scope #23b. | Mục 4.1, FR-REC-002-008, D-2 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh

REC-001 đã cho cấu hình recording; IOT-015 đã lưu mật khẩu RTSP mã hóa. REC-002 (phase #23b) hiện thực **ghi hình thật**: backend chủ động chạy **ffmpeg** kết nối RTSP của IP camera, ghi ra file `mp4` local, và tạo bản ghi `recording_session` (status `recording`). Đây là lần đầu dự án **spawn child process** (chưa từng dùng `child_process`) và ffmpeg (chưa có lib/wrapper).

### 1.2 Mục tiêu

- Endpoint `POST /api/v1/live-meetings/:meetingId/recording/start-video` (UC-111).
- Util ffmpeg `spawn(FFMPEG_PATH, args)` ghi RTSP→mp4; **KHÔNG log url/args/password**.
- `RecordingProcessManager` (singleton) quản lý `Map<sessionId, ChildProcess>`, theo dõi `exit`/`error` → đánh dấu session `failed` nếu thoát ngoài ý muốn.
- Tạo `recording_session` (video/ip_camera/recording), giải mã RTSP credential (IOT-015) **chỉ trong bộ nhớ** để dựng URL cho ffmpeg.

### 1.3 Giá trị mang lại
- Hoàn tất luồng "bấm ghi" cho IP camera (capstone demo được).
- Hạ tầng process-manager + ffmpeg tái dùng cho stop (#24)/audio (UC-112).

### 1.4 Out-of-scope
- **Stop recording (#24)**, tạo `media_files` (ở #24 khi chốt file).
- **start-audio / capture-agent đa kênh** (UC-112), `capture_sessions`/`recording_segments`.
- Transcode/segment/transcription, S3/MinIO upload, pause/resume.
- Recording config-driven auto-start (REC-001 `auto_start`) — start ở đây là thủ công.
- Đổi schema/migration (dùng `recording_sessions` có sẵn) — DATA-01.

---

## 2. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| recording_sessions | [recording-session.entity.ts](../../../../src/modules/recording/entities/recording-session.entity.ts): cột `meeting_id`(NN), `room_id`?, `recording_config_id`?, `session_type`(enum audio/video/mixed), `source_type`(enum ip_camera/capture_agent/manual_upload/external), `capture_session_id`?, `device_id`?, `started_at`(NN), `stopped_at`?, `paused_duration_seconds`(def 0), `status`(enum starting/recording/paused/stopped/failed/processing, def starting), `started_by`?, `stopped_by`?, `error_message`?, `storage_provider`?, `storage_path`?, `file_size_bytes`?(bigint), `duration_seconds`?, `checksum`?, `metadata_json`?(jsonb). FK meeting CASCADE; room/config/capture/device/users SET NULL. |
| StorageService | [storage.service.ts](../../../../src/modules/storage/storage.service.ts): **chỉ `saveFile({buffer})` (writeFileSync)** — KHÔNG có ghi theo path/stream. ⇒ ffmpeg ghi **trực tiếp** vào dir `RECORDING_STORAGE_PATH` (tự quản path), KHÔNG qua StorageService. `STORAGE_LOCAL_PATH` mặc định `./uploads`. |
| rtsp_config keys (IOT-005/015) | `metadata_json.rtsp_config` = `{ rtsp_enabled, rtsp_protocol, rtsp_host, rtsp_port, rtsp_path, rtsp_username, stream_profile, rtsp_password_configured, rtsp_password_encrypted?, configured_at }`. |
| child_process | **CHƯA dùng** trong `src/` (spawn hoàn toàn mới). Provider Nest mặc định **singleton** ⇒ `RecordingProcessManager` giữ Map an toàn trong 1 instance. |
| UC-111 | `POST /api/v1/live-meetings/{meetingId}/recording/start-video` · perm `recording.video.start` · body `{cameraDeviceId, outputFormat, storageProvider}` → `{recordingSessionId, sessionType:"video", status:"recording", startedAt, cameraDeviceId}`. |
| live-meeting module | [live-meeting.module.ts](../../../../src/modules/live-meeting/live-meeting.module.ts) **TỒN TẠI nhưng rỗng** (`@Module({})`, không controller/route). ⇒ route `live-meetings/...` chưa có. D1 đặt controller trong module **recording** (route path độc lập module — hợp lệ); xem [NC-4]. |
| ENV | [env.validation.ts](../../../../src/config/env.validation.ts): section "Q. Recording Capture" đã có `RTSP_CRED_KEY`. **CHƯA có** `FFMPEG_PATH`/`RECORDING_STORAGE_PATH` (dù `.env` local đã có `FFMPEG_PATH=D:\ffmpeg\bin\ffmpeg.exe`). |
| decryptSecret | [secret-crypto.util.ts](../../../../src/common/utils/secret-crypto.util.ts) (IOT-015) — consumer tại đây để giải mã `rtsp_password_encrypted`. |

### 2.1 Actor & Roles
ADMIN/MANAGER có `recording.video.start`. Guard mock như IOT/REC trước (`JwtAuthGuard` + `MockPermissionsGuard` + `@Permissions`).

### 2.2 Entity liên quan
`recording_sessions` (tạo), `meetings`/`iot_devices` (đọc, qua dataSource.manager). KHÔNG `media_files`/`capture_*` ở phase này.

---

## 3. Endpoint
| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/:meetingId/recording/start-video` |
| Permission | `recording.video.start` |
| Auth | `JwtAuthGuard` + `MockPermissionsGuard` |
| HTTP | 201 (tạo session) — xem [NC-5] (contract ghi 200) |
| Body | `{ cameraDeviceId: uuid }` (outputFormat/storageProvider bỏ qua — ép mp4/local, [NC-3]) |

**Response:**
```json
{
  "success": true,
  "message": "Video recording started",
  "data": {
    "recordingSessionId": "uuid",
    "sessionType": "video",
    "status": "recording",
    "startedAt": "2026-06-15T10:00:00+07:00",
    "cameraDeviceId": "uuid"
  }
}
```

---

## 4. Flow

```text
POST .../recording/start-video
1. JwtAuthGuard → userId. 401/403 nếu thiếu auth/quyền. ParseUUIDPipe meetingId; ValidationPipe body (cameraDeviceId uuid bắt buộc).
2. Meeting tồn tại? (raw query) Không → 404 MEETING_NOT_FOUND.
3. Camera = body.cameraDeviceId ([NC-1]): load iot_devices; không có → 404 IOT_DEVICE_NOT_FOUND; không phải ip_camera → 400 INVALID_VIDEO_SOURCE_DEVICE.
4. Đọc device.metadata_json.rtsp_config; thiếu rtsp_config (hoặc thiếu host/path) → 400 RTSP_NOT_CONFIGURED.
5. 409 nếu meeting đã có recording_session active (status ∈ {starting,recording,paused}, stopped_at NULL).
6. Dựng RTSP URL (chỉ trong biến cục bộ): nếu có rtsp_username + rtsp_password_encrypted → decryptSecret → rtsp://user:pass@host:port/path; else rtsp://host:port/path. KHÔNG log/lưu URL.
7. storagePath = RECORDING_STORAGE_PATH/<sessionId>.mp4 (mkdir recursive nếu chưa có). Tạo recording_session trước (lấy id) hoặc sinh uuid trước.
8. Tạo recording_session: session_type=video, source_type=ip_camera, status=recording, device_id=camera, meeting_id, started_by=userId, started_at=now(), storage_provider='local', storage_path. save.
9. Spawn ffmpeg qua RecordingProcessManager.start(sessionId, url, storagePath); lưu pid vào metadata_json.
10. **Grace-window ~2s**: race giữa (a) ffmpeg exit/error sớm và (b) timeout 2s.
    - process còn sống sau 2s → 201 { status:'recording' }.
    - process chết trong 2s → session status=failed + error_message (che) → ném 500 `RECORDING_START_FAILED` (không lộ password).
11. (Async, sau khi đã trả 201) manager vẫn lắng nghe exit/error suốt phiên: nếu thoát ngoài ý muốn (chưa stop chủ động ở #24) → update session status=failed + error_message (đã che).
```

### 4.1 ffmpeg util
```text
args = ['-rtsp_transport','tcp','-i', <url>, '-map','0:v:0', '-c','copy',
        '-movflags','+frag_keyframe+empty_moov','-f','mp4', <storagePath>]
spawn(FFMPEG_PATH, args, { windowsHide: true })
- VIDEO-ONLY: `-map 0:v:0` chỉ lấy luồng video đầu, loại audio. Camera RTSP có thể
  kèm audio pcm_alaw (G.711) không tương thích mp4 khi `-c copy` → ffmpeg thoát ngay.
  Ghi kèm audio (transcode aac) là tương lai, ngoài scope #23b.
- KHÔNG log url/args/password. Khi cần log lỗi → che url bằng '***'.
- giữ N (vd 20) dòng cuối stderr (ĐÃ che credential) để chẩn lỗi → error_message.
```

### 4.2 RecordingProcessManager (singleton provider)
```text
- procs: Map<sessionId, ChildProcess>
- start(sessionId, url, outPath): spawn → procs.set; gắn 'error'/'exit'.
- on 'exit'(code): nếu KHÔNG phải do stop chủ động (#24) → markFailed(sessionId, tailStderr).
- on 'error'(err): markFailed (che).
- markFailed: update recording_sessions.status='failed', error_message (che), stopped_at=now (nếu phù hợp). procs.delete.
- has(sessionId)/get(sessionId) cho #24 dùng.
```

---

## 5. Functional Requirements (EARS)

```text
FR-REC-002-001: THE system SHALL cung cấp POST /api/v1/live-meetings/:meetingId/recording/start-video tạo phiên ghi hình video từ ip_camera.
FR-REC-002-002: IF meeting không tồn tại, THEN 404 MEETING_NOT_FOUND.
FR-REC-002-003: WHEN body.cameraDeviceId trỏ device không tồn tại → 404 IOT_DEVICE_NOT_FOUND; không phải ip_camera → 400 INVALID_VIDEO_SOURCE_DEVICE.
FR-REC-002-004: IF device thiếu rtsp_config (hoặc thiếu host/path), THEN 400 RTSP_NOT_CONFIGURED.
FR-REC-002-005: IF meeting đã có recording_session active (starting/recording/paused), THEN 409 RECORDING_ALREADY_ACTIVE.
FR-REC-002-006: WHEN có rtsp_username + rtsp_password_encrypted, THE system SHALL decryptSecret và dựng rtsp://user:pass@host:port/path CHỈ trong biến cục bộ; SHALL NOT log/persist URL hay password.
FR-REC-002-007: WHEN hợp lệ, THE system SHALL tạo recording_session (session_type=video, source_type=ip_camera, status=recording, device_id, meeting_id, started_by=JWT, started_at=now, storage_provider='local', storage_path=<RECORDING_STORAGE_PATH>/<id>.mp4) và spawn ffmpeg.
FR-REC-002-008: THE system SHALL spawn ffmpeg với `-rtsp_transport tcp -i <url> -map 0:v:0 -c copy -movflags +frag_keyframe+empty_moov -f mp4 <out>` (VIDEO-ONLY: `-map 0:v:0` loại audio để tránh pcm_alaw không tương thích mp4); SHALL tạo thư mục lưu nếu chưa có.
FR-REC-002-009: WHEN tiến trình ffmpeg thoát/lỗi ngoài ý muốn (chưa stop chủ động), THE system SHALL cập nhật session status=failed + error_message (đã che credential).
FR-REC-002-010: THE system SHALL trả 201 { recordingSessionId, sessionType:'video', status:'recording', startedAt, cameraDeviceId }.
```

## 6. Non-functional (EARS)
```text
NFR-REC-002-001 (SEC-01): THE system SHALL NOT log/persist RTSP password hay URL chứa credential (console/file/db/audit/error_message) — luôn che '***'.
NFR-REC-002-002 (ARCH-02): Process ffmpeg chạy INLINE trong tiến trình API (chấp nhận scale capstone). NOTE: production nên tách recorder service/worker riêng + giám sát.
NFR-REC-002-003 (Robustness): RecordingProcessManager SHALL gắn handler exit/error cho mọi process; SHALL NOT để promise treo; không rò process (markFailed + delete khi exit).
NFR-REC-002-004 (Persistence): Dùng recording_sessions có sẵn (TypeORM); KHÔNG migration/đổi schema (DATA-01). ffmpeg ghi vào RECORDING_STORAGE_PATH (ngoài StorageService vì chỉ hỗ trợ buffer).
NFR-REC-002-005 (Config): FFMPEG_PATH (default 'ffmpeg'), RECORDING_STORAGE_PATH (default './storage/recordings') qua Joi.
NFR-REC-002-006 (Validation): body validate route-level (cameraDeviceId uuid; whitelist).
NFR-REC-002-007 (SEC tradeoff): RTSP credential được truyền qua **ffmpeg CLI args** (`-i rtsp://user:pass@...`) nên CÓ THỂ hiện trong process list của OS (vd `ps`/Task Manager). Chấp nhận ở scale capstone; password được url-encode và KHÔNG log/lưu (chỉ trên args tiến trình). NOTE production: truyền credential qua cơ chế an toàn hơn (env tạm/credential file/`-rtsp_flags` hoặc recorder service riêng) thay vì inline args.
```

## 7. Acceptance Criteria
```text
AC-REC-002-001 (happy): Given meeting + ip_camera có rtsp_config; When start-video; Then 201, recording_session status='recording' tạo, ffmpeg spawn (mock), response đúng.
AC-REC-002-002: Given meeting không tồn tại; When start-video; Then 404 MEETING_NOT_FOUND.
AC-REC-002-003: Given cameraDeviceId không phải ip_camera; Then 400 INVALID_VIDEO_SOURCE_DEVICE.
AC-REC-002-004: Given device thiếu rtsp_config; Then 400 RTSP_NOT_CONFIGURED.
AC-REC-002-005: Given meeting đã có session active; When start-video; Then 409 RECORDING_ALREADY_ACTIVE.
AC-REC-002-006: Given camera có username+password_encrypted; When start; Then URL truyền cho spawn chứa cred nhưng KHÔNG xuất hiện trong log/DB/response.
AC-REC-002-007: Given ffmpeg exit code != 0 ngay sau spawn; Then session→failed + error_message (che), không lộ password.
AC-REC-002-008: authorization thiếu quyền → 403.
```

## 8. Edge / Error Cases
```text
EC-REC-002-001: meetingId/cameraDeviceId sai UUID → 400.
EC-REC-002-002: FFMPEG_PATH sai/không chạy được → spawn 'error' → session=failed (không 500 treo request; đã tạo session rồi trả 201 hoặc xử lý theo [NC-2]).
EC-REC-002-003: RECORDING_STORAGE_PATH không ghi được → lỗi mkdir/spawn → session=failed.
EC-REC-002-004: rtsp_password_encrypted hỏng/giải mã lỗi → KHÔNG lộ chi tiết; báo lỗi chung (500/424) — xem [NC-2].
```

### 8.1 Error Code Map
| HTTP | Code |
|---|---|
| 400 | VALIDATION_ERROR / INVALID_VIDEO_SOURCE_DEVICE / RTSP_NOT_CONFIGURED |
| 401 | UNAUTHORIZED |
| 403 | FORBIDDEN |
| 404 | MEETING_NOT_FOUND / IOT_DEVICE_NOT_FOUND |
| 409 | RECORDING_ALREADY_ACTIVE |
| 500 | RECORDING_START_FAILED (ffmpeg chết trong grace-window) / INTERNAL_SERVER_ERROR |

---

## 9. Traceability
| Req | Nguồn |
|---|---|
| FR-001..005 | UC-111; D1/D4; guard |
| FR-006 | IOT-015 decrypt; SEC-01 |
| FR-007..009 | D2/D3/D5; recording_sessions |
| FR-010 | UC-111 response |
| NFR-001/002/003 | SEC-01; ARCH-02; robustness |

---

## 10. Quyết định đã chốt (Resolved Clarifications)
| # | Quyết định |
|---|---|
| D-1 | Endpoint `POST /live-meetings/:meetingId/recording/start-video`, perm `recording.video.start` (seed ADMIN/MANAGER). Controller trong module **recording**. |
| D-2 | ffmpeg util spawn FFMPEG_PATH, args `-rtsp_transport tcp -i <url> -map 0:v:0 -c copy -movflags +frag_keyframe+empty_moov -f mp4 <out>` (VIDEO-ONLY: `-map 0:v:0` loại audio pcm_alaw không tương thích mp4); che url/args/password; giữ N dòng stderr (đã che). |
| D-3 | `RecordingProcessManager` singleton: Map<sessionId, ChildProcess>; exit/error → session=failed (che); lưu pid vào metadata_json. |
| D-4 | Service start: 404 meeting → camera (NC-1) → rtsp_config + decrypt (thiếu→400 RTSP_NOT_CONFIGURED) → 409 active → build URL in-memory → tạo session (video/ip_camera/recording/local) → spawn → trả. |
| D-5 | ENV `RECORDING_STORAGE_PATH` (default `./storage/recordings`) + `FFMPEG_PATH` (default 'ffmpeg'), section Q; mkdir recursive. |
| D-6 | decryptSecret (IOT-015) dùng nội bộ; URL có password chỉ trong biến cục bộ truyền spawn — không lưu/không log. |

## 11. Quyết định bổ sung đã chốt (vòng 2)

| # | Quyết định |
|---|---|
| **NC-1 → chốt** | Camera = **body.cameraDeviceId** (đúng contract; không bắt buộc REC-001). Link `recording_config.videoSourceDeviceId` nếu có (best-effort, không chặn). |
| **NC-2 → chốt** | **Grace-window ~2s**: spawn rồi race exit/timeout. Sống sau 2s → 201 `recording`. Chết trong 2s → session `failed` + ném **500 `RECORDING_START_FAILED`** (che password). |
| **NC-3 → chốt** | Body nhận `outputFormat`/`storageProvider` nhưng **bỏ qua** (ép mp4 + local). Chỉ `cameraDeviceId` được validate/dùng. |
| **NC-4 → chốt** | Controller đặt trong module **recording** (gần service/entity). `LiveMeetingModule` rỗng để nguyên. |
| **NC-5 → chốt** | **HTTP 201** (tạo resource), khác contract ghi 200 — ưu tiên REST + nhất quán REC-001. |

---

> Trạng thái: **CHỜ REVIEW**. Chỉ là spec — chưa plan/tasks/code. Dừng chờ Thiếu Chủ.
