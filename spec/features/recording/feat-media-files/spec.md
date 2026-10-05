---
name: feat-media-files
description: API media_files — list (meeting), detail, playback (stream local + Range), soft-delete/hide. Phase #27 / UC-120..123.
category: recording
---

# Feature Specification: Quản lý file phương tiện (Media Files API)

- **Feature ID**: REC-006 (UC-120/121/122/123 · phase #27)
- **Feature Name**: List / Detail / Playback / Delete media_files
- **Module / Domain**: recording
- **Created Date**: 2026-06-16
- **Status**: Draft (RECON xong — còn [NEEDS CLARIFICATION], có LỆCH CONTRACT cần chốt)
- **Source Documents**:
  - `CLAUDE.md` (SEC-01; §8.4 pagination; §20 SEC; DATA-01 không migration; 10.7 recording/media)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-120 list · UC-121 detail · UC-122 signed-url · UC-123 visibility)
  - `spec/features/recording/feat-sync-metadata` (REC-005 — metadata_json.probe)
  - `src/modules/recording/entities/media-file.entity.ts`
  - `src/modules/iot/services/iot-devices.service.ts` (mẫu pagination meta)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo spec REC-006: list/detail/playback/delete media_files. RECON file:line — **phát hiện lệch contract** (UC-122 signed-url/S3 vs stream local; UC-123 PATCH visibility vs DELETE; perm play/manage vs read/delete). Còn NC-1..4. | Toàn bộ file (bản đầu tiên) |
| 2026-06-16 | Chốt NC-1..4: (1) **stream `/playback`+Range** cho v1 local (signed-url/token là follow-up, ngoài scope); (2) delete **theo contract** `PATCH /visibility {hide\|soft_delete}` (xóa file đĩa = future); (3) permission **theo contract** read/play/manage (seed ADMIN/MANAGER); (4) field list summary / detail full theo UC-120/121. Mục 10 → Resolved. | Mục 3, 10 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
REC-002..005 đã tạo `media_files` (video mp4 local, metadata_json.probe). Hiện **chưa có** API để FE liệt kê / xem chi tiết / phát lại / xóa-ẩn file. #27 bổ sung 4 endpoint đọc-quản-lý media_files cho file **local** (storage_provider=`local`, storage_key=đường dẫn file).

### 1.2 Mục tiêu
- **List** media_files theo meeting (paginated).
- **Detail** 1 media_file (gồm metadata_json.probe).
- **Playback**: phục vụ file local (stream, hỗ trợ HTTP Range) — KHÔNG có S3 ở v1.
- **Delete/Hide**: ẩn/xóa-mềm (soft-delete) media_file.

### 1.3 Giá trị mang lại
- Hoàn tất vòng đời recording (xem/tải/phát lại/dọn). Capstone demo phát video đã ghi.

### 1.4 Out-of-scope
- Upload S3/MinIO + signed URL S3 thật (v1 local; xem [NC-1]).
- Transcode/thumbnail, audio media, transcript/minutes attachment.
- Xóa **file vật lý** trên đĩa (đề xuất chỉ soft-delete DB; xem [NC-2]).
- Versioning, sharing, visibility nâng cao (department/public).
- Đổi schema/migration — dùng `media_files` (gồm `deleted_at`, `is_active`) có sẵn (DATA-01).

---

## 2. System Context (RECON, file:line) — ⚠️ LỆCH CONTRACT

| Hạng mục | Phát hiện |
|---|---|
| UC-120 list | [API_CONTRACT_v1.0_with_system_roles.md:4136-4145](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md): `GET /api/v1/meetings/{meetingId}/media-files` · perm **`recording.files.read`** · query `?fileType=video,audio&page=1&limit=20` · trả list summary `{id, fileName, fileType, mimeType, fileSizeBytes, durationSeconds, visibilityLevel, isActive, uploadedAt}`. ⇒ khớp đề xuất. |
| UC-121 detail | [:4039-4068]: `GET /api/v1/media-files/{fileId}` · perm **`recording.files.read`** · trả full `{id, fileCode, fileName, fileType, mimeType, storageProvider, storageBucket, fileSizeBytes, durationSeconds, checksum, versionNo, relatedEntityType, relatedEntityId, metadataJson}`. ⇒ khớp đề xuất (metadataJson chứa probe của REC-005). |
| UC-122 playback | [:4073-4093]: **`GET /api/v1/media-files/{fileId}/signed-url`** · perm **`recording.files.play`** · query `?expiresInMinutes=60` · trả `{fileId, signedUrl, expiresAt}`. ⚠️ Contract thiết kế **signed URL kiểu S3** — v1 **local KHÔNG có S3** ⇒ LỆCH. Đề xuất stream trực tiếp (Range). Xem **[NC-1]**. Perm contract = `recording.files.play` (KHÔNG phải `read`). |
| UC-123 delete/hide | [:4098-4127]: **`PATCH /api/v1/media-files/{fileId}/visibility`** · perm **`recording.files.manage`** · body `{action:'hide'\|'soft_delete', reason}` · `hide`→`is_active=false`, `soft_delete`→set `deleted_at`. ⚠️ KHÔNG phải `DELETE /media-files/:id`; perm `manage` (KHÔNG `delete`). Xem **[NC-2]**. |
| media_files entity | [media-file.entity.ts](../../../../src/modules/recording/entities/media-file.entity.ts): `@DeleteDateColumn deleted_at`(:117) + `is_active`(:111) ⇒ soft-delete + hide hỗ trợ sẵn. Cột trả: file_code, file_name, file_type, mime_type, storage_provider, storage_bucket, storage_key, file_url, file_size_bytes(bigint→string), checksum, duration_seconds, version_no, visibility_level, is_active, uploaded_at, metadata_json, related_entity_type/id, recording_session_id. |
| streaming pattern | **CHƯA có** `StreamableFile`/`@Res`/`res.sendFile`/Range trong repo (chỉ `fs.createReadStream` trong sha256Stream [recording-session.service.ts:490]). ⇒ playback stream là MỚI: dùng `@Res({passthrough:false})` raw + `fs.createReadStream` (Range thủ công) HOẶC `StreamableFile`. StorageService chỉ buffer ⇒ đọc trực tiếp `storage_key`. |
| pagination | [iot-devices.service.ts:294-299](../../../../src/modules/iot/services/iot-devices.service.ts): meta `{page, limit, total, totalPages: Math.ceil(total/limit)}` (CLAUDE §8.4). Mẫu áp cho list. |
| permission seed | grep `recording.files.*` → **CHƯA seed** perm nào. ⇒ cần seed mới: `recording.files.read` (+ `play`/`manage` theo contract, hoặc `delete` theo đề xuất — [NC-3]). |
| storage dir | `RECORDING_STORAGE_PATH` (REC-002, default `./storage/recordings`). storage_key = đường dẫn tuyệt đối file mp4. ⇒ playback BẮT BUỘC resolve + kiểm `storage_key` nằm TRONG `RECORDING_STORAGE_PATH` (chống path traversal dù path từ DB). |

### 2.1 Actor & Roles
User có `recording.files.read` (list/detail), `recording.files.play` (playback), `recording.files.manage` (delete/hide) — theo contract; xem [NC-3]. Guard mock như REC-002..004.

### 2.2 Entity liên quan
`media_files` (đọc + soft-delete/hide). KHÔNG bảng mới, KHÔNG migration.

---

## 3. Endpoints (đề xuất v1; lệch contract ghi rõ ở [NC])

### A. LIST — `GET /api/v1/meetings/:meetingId/media-files`
| Field | Value |
|---|---|
| Permission | `recording.files.read` |
| Query | `page` (def 1), `limit` (def 20, max 100), `fileType?` (csv: video,audio) |
| Filter | `meeting_id = :meetingId` AND `deleted_at IS NULL` (mặc định ẩn đã xóa) |
| Order | `uploaded_at DESC` |
| Response | list **summary** + meta pagination |

```json
{
  "success": true, "message": "Media files retrieved",
  "data": [{ "id":"uuid","fileName":"<id>.mp4","fileType":"video","mimeType":"video/mp4",
    "fileSizeBytes":"104857600","durationSeconds":81,"visibilityLevel":"internal","isActive":true,
    "uploadedAt":"2026-06-16T10:00:00+07:00" }],
  "meta": { "page":1,"limit":20,"total":5,"totalPages":1 }
}
```

### B. DETAIL — `GET /api/v1/media-files/:fileId`
| Field | Value |
|---|---|
| Permission | `recording.files.read` |
| 404 | không tồn tại HOẶC `deleted_at` IS NOT NULL → `MEDIA_FILE_NOT_FOUND` |
| Response | **full** (gồm `metadataJson.probe` của REC-005, checksum, storageProvider, recordingSessionId, …) |

### C. PLAYBACK — `GET /api/v1/media-files/:fileId/playback`  ⚠️ (contract: `/signed-url` — [NC-1])
| Field | Value |
|---|---|
| Permission | `recording.files.play` (contract) — [NC-3] |
| Hành vi | stream file local từ `storage_key` bằng `fs.createReadStream`; `Content-Type` = `mime_type` |
| HTTP Range | có `Range` → **206** Partial + `Content-Range` + `Accept-Ranges: bytes` + `Content-Length`(đoạn); không Range → **200** full + `Content-Length`(size) |
| 404 | row không có / `deleted_at` IS NOT NULL / file KHÔNG tồn tại trên đĩa → `MEDIA_FILE_NOT_FOUND` |
| SEC | resolve `storage_key` → BẮT BUỘC nằm TRONG `realpath(RECORDING_STORAGE_PATH)` (prefix check); ngoài → **403/404** (chống path traversal). Chỉ serve `storage_provider='local'`. |

### D. DELETE/HIDE — `PATCH /api/v1/media-files/:fileId/visibility`  ⚠️ (đề xuất user: `DELETE` — [NC-2])
| Field | Value |
|---|---|
| Permission | `recording.files.manage` (contract) — [NC-3] |
| Body | `{ action: 'hide' \| 'soft_delete', reason?: string }` |
| Hành vi | `hide` → `is_active=false`; `soft_delete` → `deleted_at=now()` (DB-only, KHÔNG xóa file đĩa — [NC-2]) |
| 404 | không tồn tại / đã `deleted_at` → `MEDIA_FILE_NOT_FOUND` |
| Idempotent | gọi lại `soft_delete` trên file đã xóa → 404 (đã loại) |
| Response | `{ fileId, isActive, updatedAt }` |

---

## 4. Flow Playback (chi tiết SEC)

```text
GET /media-files/:fileId/playback  [Range?]
1. JwtAuthGuard + perm. ParseUUIDPipe fileId.
2. Load media_files WHERE id=$1 AND deleted_at IS NULL. Không có → 404 MEDIA_FILE_NOT_FOUND.
3. storage_provider != 'local' → 404 (v1 chỉ local) / hoặc 422 (xem [NC-1]).
4. SEC path: resolved = path.resolve(storage_key); base = path.resolve(RECORDING_STORAGE_PATH).
   if !resolved.startsWith(base + sep) → 404 (path traversal / file ngoài storage dir). KHÔNG serve.
5. fs.existsSync(resolved)? Không → 404 MEDIA_FILE_NOT_FOUND (row có nhưng file mất).
6. size = fs.statSync(resolved).size. Content-Type = mime_type.
7. Range header:
   - Không có → 200, Content-Length=size, Accept-Ranges=bytes, pipe createReadStream(full).
   - Có 'bytes=start-end' → parse; range không hợp lệ → 416 Range Not Satisfiable (Content-Range bytes */size).
     hợp lệ → 206, Content-Range bytes start-end/size, Content-Length=(end-start+1),
     Accept-Ranges=bytes, pipe createReadStream(resolved, {start, end}).
8. stream 'error' → nếu chưa gửi header → 404/500; KHÔNG lộ đường dẫn nội bộ trong body.
```

---

## 5. Functional Requirements (EARS)

```text
# LIST
FR-REC-006-001: THE system SHALL cung cấp GET /api/v1/meetings/:meetingId/media-files trả danh sách media_files của meeting (deleted_at IS NULL), phân trang (page/limit), order uploaded_at DESC.
FR-REC-006-002: THE list SHALL hỗ trợ filter fileType (csv) và trả meta { page, limit, total, totalPages }.
# DETAIL
FR-REC-006-003: THE system SHALL cung cấp GET /api/v1/media-files/:fileId trả chi tiết đầy đủ (gồm metadataJson).
FR-REC-006-004: IF media_file không tồn tại HOẶC deleted_at IS NOT NULL, THEN 404 MEDIA_FILE_NOT_FOUND.
# PLAYBACK
FR-REC-006-005: THE system SHALL cung cấp endpoint playback stream file local từ storage_key (fs.createReadStream), Content-Type=mime_type.
FR-REC-006-006: WHEN có header Range hợp lệ, THE system SHALL trả 206 Partial Content (Content-Range, Accept-Ranges, Content-Length đoạn); không Range → 200 full; Range không hợp lệ → 416.
FR-REC-006-007: THE playback SHALL chỉ serve file có storage_key resolve NẰM TRONG RECORDING_STORAGE_PATH (prefix check sau path.resolve); ngoài phạm vi → KHÔNG serve (404). (Chống path traversal.)
FR-REC-006-008: IF row đã xóa mềm HOẶC file không tồn tại trên đĩa, THEN 404 MEDIA_FILE_NOT_FOUND.
# DELETE/HIDE
FR-REC-006-009: THE system SHALL cung cấp endpoint ẩn/xóa-mềm: action 'hide' → is_active=false; 'soft_delete' → deleted_at=now() (DB-only, KHÔNG xóa file đĩa).
FR-REC-006-010: IF file không tồn tại / đã deleted_at, THEN 404 MEDIA_FILE_NOT_FOUND; soft_delete idempotent (gọi lại → 404).
```

## 6. Non-functional (EARS)

```text
NFR-REC-006-001 (SEC path traversal): Playback SHALL resolve + prefix-check storage_key trong RECORDING_STORAGE_PATH; KHÔNG bao giờ stream file ngoài storage dir (dù storage_key trong DB bị bẩn).
NFR-REC-006-002 (SEC info-leak): KHÔNG trả đường dẫn nội bộ / stack trace trong body lỗi; lỗi stream → mã chung.
NFR-REC-006-003 (Soft-delete/DATA-01): Dùng deleted_at/is_active có sẵn; KHÔNG xóa cứng DB; KHÔNG migration.
NFR-REC-006-004 (Pagination): limit max 100 (CLAUDE §8.4); validate page/limit; sort cố định uploaded_at desc (allowlist).
NFR-REC-006-005 (Stream hiệu năng): playback dùng stream (KHÔNG nạp toàn file vào RAM); hỗ trợ Range để seek video.
NFR-REC-006-006 (Permission): endpoint đọc/playback/quản-lý SHALL có guard quyền tương ứng (read/play/manage — [NC-3]).
NFR-REC-006-007 (bigint): file_size_bytes trả dạng string (bigint).
```

## 7. Acceptance Criteria

```text
AC-REC-006-001 (list): Given meeting có 3 media chưa xóa + 1 đã deleted_at; When GET list; Then trả 3, order uploaded_at desc, meta.total=3, KHÔNG gồm file đã xóa.
AC-REC-006-002 (list paginate): Given limit=2; Then trả ≤2 + meta.totalPages đúng.
AC-REC-006-003 (detail): Given fileId hợp lệ; Then 200 full + metadataJson.probe.
AC-REC-006-004 (detail 404): Given fileId không tồn tại / đã xóa; Then 404 MEDIA_FILE_NOT_FOUND.
AC-REC-006-005 (playback full): Given không Range; Then 200, Content-Type=mime_type, Accept-Ranges=bytes, body = file.
AC-REC-006-006 (playback range): Given Range 'bytes=0-99'; Then 206, Content-Range 'bytes 0-99/size', Content-Length=100.
AC-REC-006-007 (playback range invalid): Given Range vượt size; Then 416.
AC-REC-006-008 (playback SEC): Given storage_key trỏ ngoài RECORDING_STORAGE_PATH (vd '../../etc/passwd'); Then KHÔNG serve → 404; KHÔNG đọc file ngoài.
AC-REC-006-009 (playback file mất): Given row OK nhưng file đĩa bị xóa; Then 404 MEDIA_FILE_NOT_FOUND.
AC-REC-006-010 (soft_delete): Given file active; When soft_delete; Then deleted_at set, list/detail sau đó KHÔNG thấy; gọi lại → 404.
AC-REC-006-011 (hide): Given file active; When hide; Then is_active=false (vẫn còn trong DB, deleted_at null).
AC-REC-006-012 (perm): thiếu quyền → 403; sai uuid → 400.
```

## 8. Edge / Error Cases

```text
EC-REC-006-001: fileId sai UUID → 400 VALIDATION_ERROR.
EC-REC-006-002: meeting không có media → list rỗng + meta.total=0 (KHÔNG 404).
EC-REC-006-003: storage_provider != 'local' (tương lai S3) → playback 422/404 ([NC-1]).
EC-REC-006-004: Range malformed ('bytes=abc') → 416 hoặc bỏ qua Range → 200 (chọn 416 cho rõ).
EC-REC-006-005: file rất lớn → stream (không buffer); Range cho seek.
EC-REC-006-006: soft_delete rồi hide (hoặc ngược) → file đã deleted → 404.
EC-REC-006-007: storage_key NULL → playback 404 (không có file để serve).
```

### 8.1 Error Code Map
| HTTP | Code |
|---|---|
| 400 | VALIDATION_ERROR |
| 401 | UNAUTHORIZED |
| 403 | FORBIDDEN |
| 404 | MEDIA_FILE_NOT_FOUND |
| 416 | RANGE_NOT_SATISFIABLE |
| 422 | UNSUPPORTED_STORAGE_PROVIDER (nếu chọn 422 cho non-local) |

---

## 9. Traceability
| Req | Nguồn |
|---|---|
| FR-001..002 | UC-120; CLAUDE §8.4 pagination |
| FR-003..004 | UC-121; media_files entity |
| FR-005..008 | UC-122 (lệch → stream local); SEC path traversal; fs stream |
| FR-009..010 | UC-123 visibility (hide/soft_delete); deleted_at/is_active |
| NFR-001/002 | CLAUDE §20 SEC |

---

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| **D-1** (NC-1) | **Playback = stream trực tiếp** `GET /media-files/:fileId/playback` + HTTP Range (v1 local). Ghi rõ **lệch UC-122** (signed-url S3). Signed-url/token tạm là **follow-up** (khi có S3/CDN), ngoài scope #27. Perm `recording.files.play` (theo contract). |
| **D-2** (NC-2) | **Delete theo contract**: `PATCH /media-files/:fileId/visibility` body `{action:'hide'\|'soft_delete', reason?}` — `hide`→`is_active=false`, `soft_delete`→`deleted_at=now()` (DB-only). Xóa **file vật lý đĩa** = future. KHÔNG dùng `DELETE`. |
| **D-3** (NC-3) | **Permission theo contract**: `recording.files.read` (list/detail), `recording.files.play` (playback), `recording.files.manage` (visibility). Seed ADMIN/MANAGER. |
| **D-4** (NC-4) | List = **summary** (UC-120: id/fileName/fileType/mimeType/fileSizeBytes/durationSeconds/visibilityLevel/isActive/uploadedAt). Detail = **full** (UC-121: +metadataJson.probe/checksum/storageProvider/recordingSessionId/…). |

---

> Trạng thái: **D-1..4 đã chốt**. plan.md + tasks.md + implement tiếp theo.
