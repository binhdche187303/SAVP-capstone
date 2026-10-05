---
name: feat-recording-errors
description: Phát hiện & báo lỗi recording — no-data khi start (camera tắt → RECORDING_NO_VIDEO), captured=false khi stop rỗng, surface error_message. Phase #28 / UC-124.
category: recording
---

# Feature Specification: Xử lý lỗi ghi hình (Recording Error Handling)

- **Feature ID**: REC-007 (UC-124 · phase #28)
- **Feature Name**: No-data detection + báo lỗi recording rõ ràng
- **Module / Domain**: recording
- **Created Date**: 2026-06-16
- **Status**: Draft (RECON xong — còn [NEEDS CLARIFICATION])
- **Source Documents**:
  - `CLAUDE.md` (SEC-01 không log secret; ARCH-02 inline; DATA-01 không migration; §16 exception)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-124 internal error-reports — dòng 4131-4153)
  - `spec/features/recording/feat-start-recording` (REC-002 grace), `feat-stop-recording` (REC-003 empty-file), `feat-recording-status` (REC-004 getStatus)
  - `src/modules/recording/services/recording-session.service.ts`, `recording-process-manager.ts`, `utils/ffmpeg.util.ts`

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo spec REC-007: (A) no-data detection khi start (poll file>0 trong cửa sổ → 201 / RECORDING_NO_VIDEO / RECORDING_START_FAILED); (B) stop rỗng → captured=false; (C) surface error_message ở getStatus. RECON file:line. Còn NC-1..4. | Toàn bộ file (bản đầu tiên) |
| 2026-06-16 | Chốt NC-1..4: (1) **poll file>0** `probeStart` (START_PROBE_MS=5000, POLL_MS=250); (2) `RECORDING_NO_VIDEO` → **502** BadGateway; (3) **KHÔNG** endpoint internal v1 (backend tự detect); (4) getStatus **thêm** errorMessage + captured. Mục 11 → Resolved. | Mục 3, 11 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
REC-002 start dùng **grace-window 2s**: ffmpeg sống sau 2s → trả **201 recording**. Nhưng khi **camera tắt / RTSP không kết nối được**, ffmpeg **vẫn sống** (đang thử kết nối) và file output **0 byte** → backend báo 201 **sai** (thực tế không ghi được gì). Người dùng chỉ phát hiện khi stop ra file rỗng. UC-124 ("thông báo lỗi ghi âm/ghi hình") yêu cầu phát hiện & báo lỗi recording. #28 bổ sung:
- **A. No-data detection** khi start: dựa trên **file output > 0** (dấu hiệu "đã capture") trong cửa sổ giới hạn → phân biệt camera OK vs camera tắt.
- **B. Stop rỗng**: trả `captured=false` + message rõ thay vì im lặng.
- **C. Surface `error_message`** ở getStatus để client biết lý do failed.

### 1.2 Mục tiêu
- Start: thay/mở rộng grace 2s bằng **probe-window** ~`START_PROBE_MS`: process exit → `RECORDING_START_FAILED`; file>0 → **201 recording** (nhanh khi camera OK); hết cửa sổ vẫn sống & file 0 → kill + session `failed` + **`RECORDING_NO_VIDEO`** (message rõ, KHÔNG lộ url/cred).
- Stop: nhánh file rỗng → response `captured=false` + message; session vẫn `stopped` + `error_message='empty file'`.
- getStatus: thêm `error_message` (+ `captured`) cho session failed/stopped-rỗng (tùy [NC-4]).

### 1.3 Giá trị mang lại
- Phát hiện **camera tắt** ngay lúc bấm ghi (không chờ tới stop) → UX & vận hành tốt hơn.
- Thông điệp lỗi rõ ràng, an toàn (không lộ credential).

### 1.4 Out-of-scope
- Endpoint UC-124 internal `error-reports` cho **capture agent ngoài** (model v1 chạy ffmpeg inline → backend tự phát hiện; xem [NC-3]).
- Notification tới Admin (UC-124 phần notify) — có thể follow-up; #28 tập trung detect + status.
- Retry/auto-restart ffmpeg, health-check định kỳ khi đang ghi (chỉ detect lúc start + lúc stop).
- Audio recording, đổi schema/migration (dùng `recording_sessions.error_message/status` có sẵn — DATA-01).

---

## 2. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| UC-124 (contract) | [API_CONTRACT_v1.0_with_system_roles.md:4265-4288](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md): **Internal process** — `POST /api/v1/internal/recording/error-reports` · perm `internal.recording.error` · Async · body `{recordingSessionId, errorType, errorMessage, severity}` → set `recording_sessions.status='failed'`, `error_message`, tạo `notifications` Admin. ⇒ thiết kế cho **FFmpeg/Capture Agent NGOÀI** gửi lỗi vào. Model v1 chạy ffmpeg **inline** trong backend ⇒ backend **tự phát hiện** (không cần agent POST). Xem [NC-3]. |
| startVideo grace | [recording-session.service.ts:154-163](../../../../src/modules/recording/services/recording-session.service.ts): `processManager.start` → `waitForGrace(sessionId, 2000)`; `'dead'` → 500 `RECORDING_START_FAILED`; `'alive'` → 201 `recording`. **KHÔNG kiểm file>0** ⇒ camera tắt (ffmpeg sống, 0 byte) vẫn trả 201 SAI. Đây là chỗ chèn no-data detection. |
| manager liveness | [recording-process-manager.ts:61-88](../../../../src/modules/recording/services/recording-process-manager.ts): `waitForGrace` phát hiện exit qua `proc.exitCode !== null \|\| proc.killed` + event `exit`/`error`. `get(sessionId)` trả `ChildProcess` (đọc `exitCode`). `has(sessionId)` liveness. `markStopping(sessionId)` để exit không bị coi failed. `stop(sessionId)` (graceful 'q'+timeout kill). ⇒ service có thể poll `fs.statSync(outPath).size` + check `proc.exitCode` trong cửa sổ; kill khi no-data (reuse `stop()` hoặc thêm method). |
| ffmpeg args | [ffmpeg.util.ts](../../../../src/modules/recording/utils/ffmpeg.util.ts): `-movflags +frag_keyframe+empty_moov` ⇒ moov ghi SỚM khi vừa kết nối ⇒ **file > 0 nhanh** khi camera OK. Camera tắt → không kết nối → file **0 byte** kéo dài (thực nghiệm). ⇒ dùng `file size > 0` làm dấu hiệu "đã capture". |
| stopVideo empty-file | [recording-session.service.ts:243-268](../../../../src/modules/recording/services/recording-session.service.ts): file thiếu/size 0 → UPDATE session `stopped` + `error_message='empty file'`; return `{ …, fileSizeBytes:'0', mediaFileId:null }`. **KHÔNG có** field `captured`. Controller wrap message 'Video recording stopped'. ⇒ thêm `captured:false` + message rõ. |
| getStatus | [recording-session.service.ts:~440-483](../../../../src/modules/recording/services/recording-session.service.ts): SELECT **KHÔNG gồm** `error_message`; response trả status/live/duration/size/hasProcessHandle — **KHÔNG surface lý do failed**. ⇒ [NC-4] thêm `error_message` (+`captured`). |
| storage/SEC | `storage_path` không chứa cred ⇒ log path/size an toàn. URL/cred chỉ trong biến cục bộ (REC-002) — message lỗi #28 KHÔNG được chứa url/cred. |

### 2.1 Actor & Roles
Start/stop/status: user có `recording.video.start`/`.stop`/`.status` (REC-002..004). #28 KHÔNG thêm endpoint user (trừ khi chốt UC-124 internal — [NC-3]).

### 2.2 Entity liên quan
`recording_sessions` (cập nhật `status='failed'`, `error_message`). KHÔNG bảng mới, KHÔNG migration.

---

## 3. A — No-data Detection khi Start (đề xuất)

```text
startVideo (sau spawn, thay grace 2s):
- probeStart(sessionId, outPath, START_PROBE_MS=5000):
    loop (poll mỗi ~POLL_MS=250):
      1. proc đã exit (manager.get(id).exitCode != null || !manager.has(id)) → return 'exited'.
      2. file output size > 0 (fs.existsSync && statSync.size > 0) → return 'capturing'.
      3. quá START_PROBE_MS → return 'no_data'.
- 'exited'   → session đã/đang failed (manager exit-handler) → 500 RECORDING_START_FAILED (không lộ cred).
- 'capturing'→ 201 { status:'recording' } (nhanh khi camera OK, không phải chờ đủ 5s).
- 'no_data'  → kill (manager.markStopping + kill/stop) + UPDATE session status='failed',
              error_message='no video data from camera (timeout)' → 502 RECORDING_NO_VIDEO
              (message rõ "Camera không gửi dữ liệu video"; KHÔNG lộ url/cred). [NC-1][NC-2]
```

- Cửa sổ **có giới hạn** (≤ START_PROBE_MS) ⇒ request KHÔNG treo.
- Kill phải cleanup (markStopping để exit không double-mark; xóa khỏi Map).

## 4. B — Stop rỗng (captured=false)

```text
stopVideo nhánh file thiếu/size 0 (đã có):
- giữ: session 'stopped' + error_message='empty file'.
- response THÊM captured=false + message rõ ("Đã dừng nhưng không ghi được video").
- nhánh có file: captured=true (mặc định).
Controller map message theo captured.
```

## 5. C — getStatus surface error ([NC-4])

```text
getStatus: SELECT thêm error_message.
- response thêm: errorMessage (string|null), captured (bool: file_size_bytes>0 ? true : false cho session đã stopped/failed).
- live session: captured = (file hiện > 0).
```

---

## 6. Functional Requirements (EARS)

```text
# A — No-data detection
FR-REC-007-001: WHEN start-video, THE system SHALL theo dõi trong cửa sổ START_PROBE_MS: nếu file output > 0 → 'capturing'; nếu process exit → 'exited'; nếu hết cửa sổ vẫn sống & file 0 → 'no_data'.
FR-REC-007-002: WHEN 'capturing', THE system SHALL trả 201 { status:'recording' } (không chờ hết cửa sổ).
FR-REC-007-003: WHEN 'exited', THE system SHALL trả 500 RECORDING_START_FAILED (session failed; KHÔNG lộ url/cred).
FR-REC-007-004: WHEN 'no_data', THE system SHALL kill tiến trình ffmpeg (cleanup), UPDATE session status='failed' + error_message (no-data), và trả RECORDING_NO_VIDEO (HTTP theo [NC-2]) với message rõ KHÔNG lộ url/cred.
FR-REC-007-005: THE probe-window SHALL có giới hạn (≤ START_PROBE_MS) để request KHÔNG treo; kill SHALL cleanup (không rò process/Map).
# B — Stop rỗng
FR-REC-007-006: WHEN stop và file thiếu/size 0, THE system SHALL trả captured=false + message rõ; session vẫn stopped + error_message='empty file' (như REC-003).
FR-REC-007-007: WHEN stop và có file > 0, THE system SHALL trả captured=true.
# C — getStatus
FR-REC-007-008: THE getStatus SHALL trả errorMessage (+ captured) để client biết lý do failed/empty. [NC-4]
# SEC
FR-REC-007-009: Mọi message lỗi (#28) SHALL NOT chứa url/credential/path-có-cred.
```

## 7. Non-functional (EARS)

```text
NFR-REC-007-001 (No-hang): Probe-window có giới hạn cứng START_PROBE_MS; request start KHÔNG treo vô hạn dù camera tắt.
NFR-REC-007-002 (Cleanup): Kill no-data SHALL markStopping + kill + xóa Map; KHÔNG để exit-handler double-mark; không rò process.
NFR-REC-007-003 (SEC-01): error_message + response message KHÔNG lộ url/cred/secret; chỉ mô tả nghiệp vụ ("camera không gửi video").
NFR-REC-007-004 (Persistence/DATA-01): Dùng recording_sessions.status/error_message có sẵn; KHÔNG migration.
NFR-REC-007-005 (No-regression): Camera OK vẫn 201 nhanh (file>0); ffmpeg exit sớm vẫn RECORDING_START_FAILED; REC-002..006 tests không hỏng.
NFR-REC-007-006 (Backpressure/perf): Poll nhẹ (statSync mỗi ~250ms), dừng ngay khi có kết quả.
```

## 8. Acceptance Criteria

```text
AC-REC-007-001 (camera OK → 201 nhanh): Given ffmpeg sống + file>0 trong cửa sổ; When start; Then 201 recording, KHÔNG chờ hết START_PROBE_MS.
AC-REC-007-002 (camera tắt → NO_VIDEO): Given ffmpeg sống nhưng file 0 hết cửa sổ; When start; Then kill + session failed + RECORDING_NO_VIDEO, message rõ KHÔNG lộ cred.
AC-REC-007-003 (ffmpeg exit sớm → START_FAILED): Given ffmpeg exit trong cửa sổ; When start; Then 500 RECORDING_START_FAILED.
AC-REC-007-004 (no-hang): Given camera tắt; Then request trả trong ~START_PROBE_MS (không treo).
AC-REC-007-005 (stop rỗng): Given session recording nhưng file 0; When stop; Then 200 captured=false + message; session stopped + error_message='empty file'.
AC-REC-007-006 (stop có file): Given file>0; When stop; Then captured=true + media_files tạo.
AC-REC-007-007 (status surface): Given session failed có error_message; When getStatus; Then errorMessage trả về (+captured). [NC-4]
AC-REC-007-008 (SEC): error_message/message KHÔNG chứa url/cred ở mọi ca.
```

## 9. Edge / Error Cases

```text
EC-REC-007-001: file>0 ngay lập tức (camera nhanh) → 'capturing' ở vòng poll đầu.
EC-REC-007-002: ffmpeg exit đúng lúc cửa sổ kết thúc → ưu tiên 'exited' (RECORDING_START_FAILED) trước 'no_data'.
EC-REC-007-003: storage_path null/không tạo được → no_data hoặc exited → failed (không treo).
EC-REC-007-004: kill no-data nhưng process đã tự exit → cleanup idempotent (markStopping/has guard).
EC-REC-007-005: file>0 nhưng sau đó camera rớt (giữa chừng) → ngoài scope #28 (chỉ detect lúc start/stop).
```

### 9.1 Error Code Map
| HTTP | Code |
|---|---|
| 201 | (capturing — recording) |
| 200 | (stop — captured true/false) |
| 500 | RECORDING_START_FAILED (ffmpeg exit sớm) |
| 502 | RECORDING_NO_VIDEO (camera không gửi data) — [NC-2] |

---

## 10. Traceability
| Req | Nguồn |
|---|---|
| FR-001..005 | UC-124 detect; startVideo grace; manager liveness; ffmpeg frag→file>0 |
| FR-006..007 | REC-003 empty-file; captured flag |
| FR-008 | REC-004 getStatus + error_message |
| NFR-001/003 | no-hang; SEC-01 |

---

## 11. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| **D-1** (NC-1) | **Poll file>0** trong cửa sổ: `probeStart(sessionId, outPath)` lặp tới `START_PROBE_MS=5000`, mỗi `POLL_MS=250` → process exit → `'exited'`; `fs.statSync(outPath).size > 0` → `'capturing'`; hết cửa sổ → `'no_data'`. Ngưỡng "đã capture" = file size > 0. |
| **D-2** (NC-2) | `RECORDING_NO_VIDEO` → **HTTP 502** (`BadGatewayException`) — camera (upstream) không gửi video. Message: "Camera không gửi dữ liệu video (kiểm tra camera đã bật và tới được)." (KHÔNG url/cred). |
| **D-3** (NC-3) | **KHÔNG** endpoint internal `error-reports` v1 (ffmpeg inline → backend tự detect). Endpoint cho capture agent ngoài = future. |
| **D-4** (NC-4) | getStatus **thêm** `errorMessage` (string\|null) + `captured` (live: file hiện>0; else file_size_bytes>0). SELECT thêm `error_message`. |

---

> Trạng thái: **D-1..4 đã chốt**. plan.md + tasks.md + implement tiếp theo.
