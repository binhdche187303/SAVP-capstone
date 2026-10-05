---
name: feat-sync-metadata
description: Trích metadata media bằng ffprobe (duration thật + resolution/codec/fps/bitrate) khi finalize recording; fallback wall-clock nếu ffprobe lỗi. Phase #26 / UC-119.
category: recording
---

# Feature Specification: Đồng bộ metadata file phương tiện (Media Metadata via ffprobe)

- **Feature ID**: REC-005 (UC-119 · phase #26)
- **Feature Name**: Trích & đồng bộ metadata media (ffprobe) khi finalize recording
- **Module / Domain**: recording (+ util, config)
- **Created Date**: 2026-06-16
- **Status**: Draft (RECON xong — còn [NEEDS CLARIFICATION])
- **Source Documents**:
  - `CLAUDE.md` (SEC-01 không log secret; ARCH-02 inline/queue; 10.7 recording/media; DATA-01 không migration)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-119 internal "tạo media_files với metadata"; UC-120/121 list/detail)
  - `spec/features/recording/feat-stop-recording` (REC-003 — finalizeFileToStopped), `feat-recording-status` (REC-004 — reconcile dùng chung finalize)
  - `src/modules/recording/services/recording-session.service.ts` (finalizeFileToStopped), `recording/utils/ffmpeg.util.ts`
  - `src/modules/recording/entities/media-file.entity.ts`, `src/config/env.validation.ts`

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo spec REC-005: ffprobe util trích duration/resolution/codec/fps/bitrate; tích hợp finalizeFileToStopped (ffprobe→duration thật + metadata_json, fallback wall-clock); ENV FFPROBE_PATH. RECON file:line. Còn NC-1..3. | Toàn bộ file (bản đầu tiên) |
| 2026-06-16 | Chốt NC-1..3: (1) **KHÔNG endpoint re-sync** (UC-119 internal — chỉ tích hợp finalize); (2) util `ffprobe.util.ts` riêng + **ASYNC `spawn`** (Promise, timeout 10000ms → kill+null); (3) metadata lồng key **`probe`** (+`source:'ffprobe'`), fallback KHÔNG set probe. Mục 3, 10 → Resolved. | Mục 3, 10 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
REC-003/004 đã finalize recording: `finalizeFileToStopped()` đọc size + sha256 + **duration = wall-clock** (giờ kết thúc − giờ bắt đầu − paused), tạo `media_files`, set session `stopped`. Wall-clock **không chính xác** (gồm thời gian thiết lập, lệch giờ, lag) và **thiếu** thông tin kỹ thuật (độ phân giải, codec, fps, bitrate). UC-119 ("tạo media_files với **đầy đủ metadata**") cần metadata thật từ file. `ffprobe` (đi kèm ffmpeg) trích chính xác các trường này.

### 1.2 Mục tiêu
- **ffprobe util**: chạy `ffprobe` trên file mp4 → parse JSON → trả `{ durationSeconds, width, height, videoCodec, fps, bitrate }` (**best-effort**: lỗi/timeout → `null`).
- **Tích hợp `finalizeFileToStopped`**: nếu ffprobe có `durationSeconds` → dùng **duration thật** cho `media_files.duration_seconds` + `recording_sessions.duration_seconds`; nhồi resolution/codec/fps/bitrate vào `media_files.metadata_json`. Nếu ffprobe `null` → **fallback duration wall-clock** như cũ.
- **ENV** `FFPROBE_PATH` (default `ffprobe`).

### 1.3 Giá trị mang lại
- `duration_seconds` chính xác (UC-120/121 hiển thị đúng; báo cáo/analytics tin cậy).
- Metadata kỹ thuật (resolution/codec/fps/bitrate) cho FE/playback/diagnostics.
- Hoàn thiện UC-119 (media_files "đầy đủ metadata") mà KHÔNG phá luồng stop/recover.

### 1.4 Out-of-scope
- **UC-118** (sync video+audio offset) — cần audio recording (chưa có), `recording_segments`.
- Endpoint **re-sync** metadata cho media cũ (xem [NC-1] — chỉ thêm nếu chốt).
- Transcode/thumbnail/keyframe, đọc audio stream chi tiết (chỉ lấy video stream chính + format).
- Đổi schema/migration (DATA-01) — dùng `media_files.metadata_json`/`duration_seconds` + `recording_sessions.duration_seconds` có sẵn.
- S3/MinIO, playback (UC-122), list/detail (UC-120/121 — phase khác).

---

## 2. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| UC-119 (contract) | [API_CONTRACT_v1.0_with_system_roles.md:4128-4133](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md): UC-119 "Tạo metadata file phương tiện" là **Internal process** (KHÔNG method/path/permission): "Tạo `media_files` với đầy đủ metadata; Cập nhật `recording_sessions.status='stopped'`". ⇒ ĐÚNG là `finalizeFileToStopped` hiện có ⇒ #26 enrich metadata ở internal đó, **không cần endpoint mới** (xem [NC-1]). |
| UC-120/121 (phân biệt) | [:4006-4046] UC-120 `GET /meetings/{meetingId}/media-files` (list), UC-121 `GET /media-files/{fileId}` (detail), perm `recording.files.read`, Async No — **chỉ đọc**, là phase khác (#27); #26 KHÔNG lấn (chỉ ghi metadata lúc finalize). Response 120/121 có `durationSeconds` ⇒ cần đúng. |
| UC-118 (phân biệt) | [:3989-3994] sync video+audio offset (cần audio) — out-of-scope. |
| ffprobe | `D:\ffmpeg\bin` có `ffmpeg.exe`, `ffplay.exe`, **`ffprobe.exe`** (cùng thư mục `FFMPEG_PATH`). Cú pháp: `ffprobe -v quiet -print_format json -show_format -show_streams <file>` → JSON `{ format:{ duration, bit_rate, ... }, streams:[{ codec_type, codec_name, width, height, avg_frame_rate, bit_rate, ... }] }`. |
| media_files (ghi metadata) | [media-file.entity.ts:97-121](../../../../src/modules/recording/entities/media-file.entity.ts): `duration_seconds`(int nullable), `metadata_json`(jsonb nullable). Hiện `finalizeFileToStopped` INSERT **CHƯA** set `metadata_json` (để null) và set `duration_seconds`=wall-clock. ⇒ #26 thêm `metadata_json` (merge ffprobe) + đổi nguồn `duration_seconds`. |
| finalizeFileToStopped | [recording-session.service.ts](../../../../src/modules/recording/services/recording-session.service.ts): `durationSeconds = Math.max(0, floor((stoppedAt-startedAt)/1000) - paused)` (wall-clock); INSERT media_files (… duration_seconds) + UPDATE recording_sessions (… duration_seconds). Dùng chung bởi REC-003 (stopVideo) **và** REC-004 (reconcile) ⇒ enrich ở đây ⇒ cả stop thường lẫn recover đều có duration thật. |
| ffmpeg.util | [ffmpeg.util.ts](../../../../src/modules/recording/utils/ffmpeg.util.ts): đã có `spawn` ffmpeg + `redactUrl`. ffprobe util mới đặt cùng file hoặc `ffprobe.util.ts` ([NC-2]). Dùng `spawnSync` (đồng bộ, có `timeout`/`maxBuffer`) cho đơn giản, hoặc spawn+promise. |
| ENV | [env.validation.ts:148-153](../../../../src/config/env.validation.ts) section "Q. Recording Capture": có `RTSP_CRED_KEY`, `FFMPEG_PATH`(default 'ffmpeg'), `RECORDING_STORAGE_PATH`. **CHƯA có** `FFPROBE_PATH`. |
| SEC | `storage_path` KHÔNG chứa credential (khác RTSP url) ⇒ ffprobe nhận path file, an toàn log path. KHÔNG có secret trong ffprobe args/output. |

### 2.1 Actor & Roles
Không có actor mới — #26 chạy trong internal finalize (stop thường: user có `recording.video.stop`; recover: system boot). Không endpoint mới ⇒ không permission mới (trừ khi chốt [NC-1]).

### 2.2 Entity liên quan
`media_files` (ghi `metadata_json` + `duration_seconds`), `recording_sessions` (ghi `duration_seconds`). KHÔNG bảng mới, KHÔNG migration.

---

## 3. ffprobe util (mới)

```text
probeMedia(filePath): Promise<MediaProbe | null>   // ASYNC spawn (D-2)
- args: ['-v','quiet','-print_format','json','-show_format','-show_streams', filePath]
- spawn(FFPROBE_PATH, args, { windowsHide:true }); gom stdout; on 'close'(code):
    code!=0 → resolve(null); else parse JSON.
- timeout FFPROBE_TIMEOUT_MS=10000 (hằng số): quá hạn → proc.kill() + resolve(null); clearTimeout khi close.
- lỗi spawn ('error') / exit!=0 / JSON parse lỗi / không có video stream → resolve(null) (best-effort, KHÔNG ném).
- parse:
    format.duration (giây, float) → durationSeconds = round (null nếu thiếu/'N/A').
    videoStream = streams.find(s => s.codec_type==='video').
      width, height, codec_name → videoCodec, avg_frame_rate ('30/1'→30) → fps (parseFps), bit_rate → bitrate.
- parseFps('num/den'): den=0/thiếu → null; else round(num/den, 2).
- return { durationSeconds, width, height, videoCodec, fps, bitrate } (field thiếu → null).
- KHÔNG log nội dung file; path không cred nên log path (nếu cần) an toàn.
```

### 3.1 metadata_json schema (media_files) — đề xuất ([NC-3])
```json
{
  "probe": {
    "durationSeconds": 81,
    "width": 1920,
    "height": 1080,
    "videoCodec": "h264",
    "fps": 25,
    "bitrate": 4096000,
    "source": "ffprobe"
  }
}
```
- Nếu fallback (ffprobe null): KHÔNG set `probe` (hoặc `probe: { source: "wallclock" }` — [NC-3]); metadata_json giữ field cũ (merge, không đè `orphan_stop`/`recovered`).

---

## 4. Tích hợp finalizeFileToStopped

```text
finalizeFileToStopped(params): (sửa)
1. size = fs.statSync(storagePath).size; checksum = sha256Stream(storagePath).
2. probe = probeMedia(storagePath)  // best-effort, có thể null
3. wallClock = max(0, floor((stoppedAt-startedAt)/1000) - paused).
4. durationSeconds = (probe?.durationSeconds != null && probe.durationSeconds > 0)
                     ? probe.durationSeconds : wallClock.
5. metadata = { ...baseMetadata,
                ...(recovered ? { recovered: true } : {}),
                ...(probe ? { probe: { ...probe, source: 'ffprobe' } } : {}) }.
6. TRANSACTION:
   INSERT media_files (… duration_seconds=durationSeconds, metadata_json=metadata).
   UPDATE recording_sessions (… duration_seconds=durationSeconds, metadata_json giữ như cũ).
7. trả { stoppedAt, durationSeconds, fileSizeBytes, mediaFileId } (durationSeconds giờ là ffprobe nếu có).
```

- ffprobe lỗi → `probe=null` → duration fallback wall-clock, metadata_json không có `probe` → **không phá** stop/recover (best-effort).
- `media_files.metadata_json` trước đây null → giờ có `probe` (khi ffprobe OK). `recording_sessions.metadata_json` giữ logic cũ (orphan_stop/recovered) — KHÔNG nhồi probe vào session (chỉ media_files).

---

## 5. Functional Requirements (EARS)

```text
FR-REC-005-001: THE system SHALL cung cấp util probeMedia(filePath) chạy ffprobe (`-v quiet -print_format json -show_format -show_streams`) và parse JSON.
FR-REC-005-002: WHEN ffprobe lỗi/exit!=0/timeout/parse lỗi/không có video stream, THE probeMedia SHALL trả null (best-effort, KHÔNG ném).
FR-REC-005-003: WHEN ffprobe thành công, probeMedia SHALL trả { durationSeconds (từ format.duration, làm tròn), width, height, videoCodec, fps (từ avg_frame_rate), bitrate } (field thiếu → null/undefined).
FR-REC-005-004: WHEN finalize và probe.durationSeconds hợp lệ (>0), THE system SHALL dùng nó cho media_files.duration_seconds VÀ recording_sessions.duration_seconds; ELSE fallback wall-clock.
FR-REC-005-005: WHEN probe khác null, THE system SHALL merge { probe: {...probe, source:'ffprobe'} } vào media_files.metadata_json, KHÔNG đè field hiện có (recovered/…).
FR-REC-005-006: THE system SHALL đọc FFPROBE_PATH từ env (default 'ffprobe') và áp timeout FFPROBE_TIMEOUT_MS để không treo finalize.
FR-REC-005-007: THE probeMedia SHALL NOT log credential (path file không chứa cred); SHALL NOT đọc/log nội dung file.
```

## 6. Non-functional (EARS)

```text
NFR-REC-005-001 (Best-effort/Robust): ffprobe lỗi/timeout SHALL NOT làm hỏng stop (#23) hay recover (#25); luôn fallback wall-clock; finalize không ném vì ffprobe.
NFR-REC-005-002 (No-hang): spawnSync ffprobe SHALL có timeout (FFPROBE_TIMEOUT_MS, đề xuất 10000) + maxBuffer hợp lý để không treo/không OOM.
NFR-REC-005-003 (SEC-01): KHÔNG log credential/secret. (storage_path không cred.) KHÔNG log JSON nhạy cảm.
NFR-REC-005-004 (Persistence/DATA-01): Dùng media_files.metadata_json + duration_seconds, recording_sessions.duration_seconds có sẵn; KHÔNG migration/đổi schema.
NFR-REC-005-005 (Config): FFPROBE_PATH default 'ffprobe' qua Joi (mirror FFMPEG_PATH); .env.example + .env local.
NFR-REC-005-006 (No-regression): Tích hợp KHÔNG phá REC-003/004 tests; nhánh fallback giữ hành vi cũ (duration wall-clock, metadata_json không có probe).
```

## 7. Acceptance Criteria

```text
AC-REC-005-001 (ffprobe OK): Given file mp4 hợp lệ + ffprobe trả duration/width/height/codec/fps/bitrate; When finalize; Then media_files.duration_seconds = ffprobe duration, metadata_json.probe đầy đủ (source='ffprobe'), recording_sessions.duration_seconds = ffprobe duration.
AC-REC-005-002 (ffprobe fail → fallback): Given ffprobe lỗi/timeout (probeMedia=null); When finalize; Then duration_seconds = wall-clock (như REC-003), metadata_json KHÔNG có probe, stop/recover vẫn thành công.
AC-REC-005-003 (recover có duration đúng): Given reconcile session mồ côi có file hợp lệ; When recover-as-stopped; Then duration_seconds = ffprobe (nếu OK) + metadata_json.probe + recovered=true cùng tồn tại (merge, không đè).
AC-REC-005-004 (merge metadata): Given session đã có metadata_json (orphan_stop/recovered); When finalize với probe OK; Then probe được THÊM, field cũ KHÔNG bị mất.
AC-REC-005-005 (util best-effort): Given ffprobe path sai / file hỏng; When probeMedia; Then trả null, KHÔNG ném.
AC-REC-005-006 (parse fps): Given avg_frame_rate='25/1'; Then fps=25. Given '30000/1001'; Then fps≈29.97 (làm tròn hợp lý).
```

## 8. Edge / Error Cases

```text
EC-REC-005-001: ffprobe không tồn tại (FFPROBE_PATH sai) → spawnSync error → null → fallback.
EC-REC-005-002: file 0 byte / không phải media → ffprobe exit!=0 hoặc không format.duration → null → fallback.
EC-REC-005-003: avg_frame_rate='0/0' (không xác định) → fps=null, không chia 0.
EC-REC-005-004: format.duration='N/A'/thiếu → durationSeconds=null → fallback wall-clock.
EC-REC-005-005: ffprobe chạy quá lâu (file lớn/đĩa chậm) → timeout → null → fallback (finalize không treo).
EC-REC-005-006: JSON ffprobe quá lớn vượt maxBuffer → spawnSync trả lỗi → null → fallback.
```

---

## 9. Traceability
| Req | Nguồn |
|---|---|
| FR-001..003 | ffprobe JSON (format/streams); UC-119 "đầy đủ metadata" |
| FR-004..005 | finalizeFileToStopped (duration + metadata_json); media_files entity |
| FR-006 | ENV FFPROBE_PATH; NFR no-hang |
| NFR-001/006 | REC-003/004 best-effort, không hồi quy |

---

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| **D-1** (NC-1) | **KHÔNG endpoint re-sync** — UC-119 là internal process, #26 chỉ enrich trong `finalizeFileToStopped`. Re-probe media cũ là future (ngoài scope). KHÔNG seed/permission mới. |
| **D-2** (NC-2) | Util **`recording/utils/ffprobe.util.ts`** riêng, dùng **ASYNC `spawn`** (Promise) — KHÔNG block event loop; timeout `FFPROBE_TIMEOUT_MS=10000` (hằng số) → `kill()` + `null`; clearTimeout khi 'close'. |
| **D-3** (NC-3) | Metadata lồng dưới key **`probe`**: `{ durationSeconds, width, height, videoCodec, fps, bitrate, source:'ffprobe' }`. Merge vào `media_files.metadata_json` KHÔNG đè field cũ (`orphan_stop`/`recovered`). Fallback (probe null) → KHÔNG set `probe`. Probe chỉ vào `media_files` (KHÔNG vào `recording_sessions.metadata_json`). |

---

> Trạng thái: **D-1..3 đã chốt**. plan.md + tasks.md + implement tiếp theo.
