# Feature Specification: Xem chi tiết tệp đính kèm biên bản họp (View Minutes Attachment Detail)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo spec cho UC-140 (Feature Table), viết sau khi implement — bổ sung tài liệu speckit theo yêu cầu, đối chiếu lại với code đã chạy thật và test đã pass | Toàn bộ file |

> Nguồn gốc: UC-140 "Xem chi tiết tệp đính kèm" (Feature Table, module Minutes & Knowledge Management). Trigger: "Người có quyền mở chi tiết file". Expected Output: "Hiển thị tên, loại, size, thời gian upload; Signed URL khi cần". Pre-condition: "File đính kèm tồn tại". Related Use Cases theo Feature Table ghi UC-106/UC-107, nhưng rà soát code (`API_CONTRACT_v1.0_with_system_roles.md` dòng 4622-4631) cho thấy UC-140 thực chất **dùng chung** endpoint với UC-121 "Xem chi tiết file phương tiện" (`GET /api/v1/media-files/:fileId`) — 2 UC id đó (UC-106/107 trong Feature Table hiện tại là "Gửi cảnh báo thời gian còn lại/xung đột", không liên quan) là dữ liệu cross-reference cũ/không khớp, feature này bám theo API_CONTRACT thay vì cross-reference sai đó.

## 1. Context & Goal

### 1.1 Bối cảnh
Sau khi `feat-attach-minutes-document` (UC-138/139/142) cho phép Host upload/xem danh sách/xóa tệp đính kèm của biên bản, người dùng cần xem **chi tiết đầy đủ của 1 file cụ thể** (tên, loại, mimetype, size, thời gian upload, và một Signed URL để mở/tải file) trước khi quyết định tải xuống — thay vì chỉ thấy tóm tắt trong danh sách.

### 1.2 Đánh giá sẵn sàng triển khai
Feature này tái sử dụng gần như toàn bộ hạ tầng đã có, không cần chờ thêm phụ thuộc:
- `GET /api/v1/media-files/:fileId` (UC-121, module `recording`) đã tồn tại và trả metadata đầy đủ của 1 `media_files` — chỉ **thiếu duy nhất 1 trường**: Signed URL để tải file.
- `StorageService.generateSignedDownloadToken()` + endpoint `GET /media-files/:fileId/secure-download?token=` đã tồn tại (dùng cho `feat-admin-avatar-review-workflow`) — tái sử dụng nguyên vẹn, không phát sinh cơ chế ký URL mới.
- Rà soát thực tế khi build (2026-07-17) phát hiện: (a) `MediaFilesService.detail()` chưa từng trả Signed URL dù spec UC-140 yêu cầu rõ, (b) `feat-attach-minutes-document`'s `listAttachments` (UC-139) chặn quá hẹp (chỉ `preparedBy`), trái với Primary Actor UC-139/UC-140 trong Feature Table (Host/Participant/Business Admin), (c) `recording.files.read` (permission bắt buộc của endpoint UC-121/UC-140 dùng chung) chưa được cấp cho `BUSINESS_ADMIN`, dù Business Admin là actor chính thức. Cả 3 gap đều được vá trong feature này.

### 1.3 Mục tiêu
- Bổ sung trường `downloadUrl` (Signed URL, thời hạn ngắn) vào response của `GET /media-files/:fileId` — không tạo endpoint mới, không đổi contract hiện có (chỉ thêm field).
- Đảm bảo đúng actor trong Feature Table (Host/Participant/Business Admin/System Admin) đều gọi được endpoint này khi file thuộc về 1 biên bản họ có quyền xem.
- Bổ sung filter `meetingId` cho `GET /meeting-minutes` (UC-MKM-02) để FE tra được `minutesId` của 1 cuộc họp cụ thể — hạ tầng cần thiết vì hệ thống chưa có `GET /meetings/:id/minutes` riêng.

### 1.4 Giả định
- File đính kèm minutes luôn có `storageProvider` là `local`/`s3`/`minio` (không phải `cloud_provider`) — do `MinutesService.addAttachment()` hiện lưu qua `StorageService` nội bộ, không qua Cloudinary. `downloadUrl` cho các trường hợp này luôn là URL có token HMAC ký, KHÔNG phải presigned S3 URL trực tiếp (dùng chung endpoint `secure-download` bất kể driver `local` hay `s3`, xem mục 1.5 về giới hạn đã biết).
- Với `media_files` có `storageProvider = cloud_provider` (VD: recording qua Cloudinary tương lai), `downloadUrl` trả thẳng `file_url` công khai đã lưu sẵn, không sinh token.
- Endpoint `GET /media-files/:fileId` dùng chung cho cả UC-121 (media file của recording/meeting nói chung) và UC-140 (file đính kèm biên bản) — không tách endpoint riêng, vì response shape giống hệt nhau và việc phân biệt chỉ nằm ở `relatedEntityType`.

### 1.5 Cần làm rõ / giới hạn đã biết
- [KNOWN GAP] Khi `STORAGE_DRIVER=s3` (MinIO), `MinutesService.addAttachment()` vẫn gán cứng `storageProvider = local` bất kể driver thật đang cấu hình — dẫn đến `resolvePlayback`/`resolveSecureDownload` (chỉ hỗ trợ `local`/`cloud_provider`) không đọc được file thật đã lưu trên MinIO. `downloadUrl` sinh ra ở feature này vẫn đúng **định dạng**, nhưng việc mở link đó sẽ lỗi trong môi trường `STORAGE_DRIVER=s3`. Đây là bug riêng, **ngoài phạm vi** feature này (thuộc `feat-attach-minutes-document`/storage layer) — đã tách thành task riêng, không sửa ở đây.
- [NEEDS CLARIFICATION] Thời hạn Signed URL (`MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS`, mặc định 600s, tái sử dụng config đã có của avatar-review) — cần Product Owner xác nhận có phù hợp cho file đính kèm biên bản (thường lớn hơn ảnh avatar) hay không.

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal User (Host/Participant của cuộc họp), Business Admin — theo đúng Feature Table UC-140.
- Secondary Actor: Cloud Storage (nguồn `file_url` khi `storageProvider = cloud_provider`).

### 2.2 Role & Permission Rules
- Permission: `recording.files.read` (đã tồn tại, module `recording`, dùng chung với UC-121). Trước 2026-07-17, chỉ seed cho `SYSTEM_ADMIN, MANAGER, EMPLOYEE` (`20260704000002-SeedCameraDomainRbacPermissions.ts`) — **thiếu `BUSINESS_ADMIN`**, dù Business Admin là Primary Actor chính thức của UC-140. Vá bằng migration `20260717000002-SeedRecordingFilesReadBusinessAdmin.ts`.
- Endpoint hiện tại **không** kiểm tra thêm resource-level ownership (không gọi `canAccessMinutes`) — bất kỳ ai có `recording.files.read` và biết `fileId` (UUID) đều xem được chi tiết. Đây là hành vi kế thừa từ UC-121 (đã có trước), **không mở rộng thêm** trong feature này — xem mục 8 (Out of Scope) về rủi ro cần cân nhắc sau.

### 2.3 Actor Constraints
- Không có ràng buộc theo trạng thái biên bản (`draft/published/archived`) ở tầng UC-140 — khác với UC-139 (list), vì UC-121 vốn thiết kế cho mọi loại `media_files` (không riêng minutes attachment), không biết về khái niệm `meeting_minutes.status`.
- Việc kiểm soát "ai được biết `fileId`" thực tế phụ thuộc vào UC-139 (list) — người không có quyền xem danh sách đính kèm của 1 biên bản (theo `canAccessMinutes`, xem `feat-attach-minutes-document` mục 2.3 đã cập nhật 2026-07-17) sẽ không có `fileId` để gọi UC-140 trong luồng bình thường qua FE.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL trả về, cho 1 `fileId` hợp lệ và active (`deletedAt IS NULL`): `id, fileCode, fileName, fileType, mimeType, storageProvider, storageBucket, fileSizeBytes, durationSeconds, checksum, versionNo, visibilityLevel, isActive, relatedEntityType, relatedEntityId, recordingSessionId, uploadedAt, metadataJson, downloadUrl`.
- **FR-002**: THE system SHALL KHÔNG thay đổi bất kỳ dữ liệu nào (`media_files`, `meeting_minutes`) khi phục vụ request xem chi tiết — read-only.

### 3.2 Event-driven Requirements
- **FR-003**: WHEN người dùng gửi `GET /api/v1/media-files/:fileId`, THE system SHALL: (1) load `media_files` theo `id`, chưa xóa mềm; (2) nếu không có → 404; (3) sinh `downloadUrl` theo quy tắc mục 3.4; (4) trả response.

### 3.3 State-driven Requirements
- **FR-004**: WHILE `media_files.storageProvider = cloud_provider`, THE system SHALL gán `downloadUrl = media_files.fileUrl` (URL công khai đã lưu sẵn), KHÔNG sinh token.
- **FR-005**: WHILE `media_files.storageProvider IN (local, s3, minio)`, THE system SHALL sinh 1 signed download token qua `StorageService.generateSignedDownloadToken(fileId, ttl)` và gán `downloadUrl = "{API_PUBLIC_BASE_URL}/api/v1/media-files/{fileId}/secure-download?token={token}"`.

### 3.4 Optional Feature Requirements
- **FR-006**: WHERE việc sinh signed token thất bại (lỗi cấu hình `MEDIA_DOWNLOAD_TOKEN_SECRET`, v.v.), THE system SHALL log warning và trả `downloadUrl = null`, KHÔNG làm fail toàn bộ request xem chi tiết (các trường metadata khác vẫn phải trả về đầy đủ).

### 3.5 Unwanted Behavior Requirements
- **FR-007**: IF `fileId` không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả 404 `MEDIA_FILE_NOT_FOUND`.
- **FR-008**: IF người gọi không có permission `recording.files.read`, THEN THE system SHALL trả 403 `FORBIDDEN` (guard cấp route, trước khi vào service).
- **FR-009**: IF `fileId` không phải UUID hợp lệ, THEN THE system SHALL trả 400 (`ParseUUIDPipe`).

### 3.6 Supporting Requirement — Tra cứu biên bản theo cuộc họp
- **FR-010**: THE system SHALL hỗ trợ filter `meetingId` (optional) trên `GET /api/v1/meeting-minutes` (UC-MKM-02) để client tra được `minutesId` của 1 cuộc họp cụ thể, làm bước tiền đề trước khi gọi UC-139 (list attachments) rồi UC-140 (detail) — vì hệ thống chưa có endpoint `GET /meetings/:id/minutes` riêng.

### 3.7 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-003 | Code hiện có (`MediaFilesService.detail`, UC-121) |
| FR-004, FR-005, FR-006 | Gap analysis 2026-07-17 — spec UC-140 yêu cầu "Signed URL khi cần" nhưng code cũ không có; tái dùng pattern `AdminAvatarReviewService.getAvatarDownloadUrl` |
| FR-007, FR-008, FR-009 | Kế thừa từ UC-121 |
| FR-010 | Gap hạ tầng phát hiện khi build FE — cần cho luồng meeting → minutes → attachments |

## 4. Non-functional Requirements

### 4.1 Performance
Không đổi so với UC-121 — 1 SELECT theo PK + 1 lần ký HMAC (rẻ, đồng bộ, không cần async).

### 4.2 Security
- Token ký bằng HMAC-SHA256 (`MEDIA_DOWNLOAD_TOKEN_SECRET`), có `mediaFileId` + hạn dùng (`ttl`), verify ở endpoint `secure-download` (đã có, không đổi).
- Không log secret/token trong log lỗi (chỉ log message lỗi khi sinh token thất bại — FR-006).
- Endpoint vẫn yêu cầu JWT hợp lệ + `recording.files.read` — Signed URL chỉ là lớp bổ sung cho việc tải file *sau khi* đã qua auth chính, không thay thế auth.

### 4.3 Reliability & Consistency
Sinh token lỗi không làm fail response chi tiết (FR-006) — ưu tiên trả được metadata hơn là chặn toàn bộ vì 1 tính năng phụ.

### 4.4 Usability
FE chỉ cần 1 lần gọi `GET /media-files/:fileId` để có đủ dữ liệu hiển thị modal chi tiết + link tải, không cần gọi thêm API khác.

### 4.5 Observability
Log warning khi sinh signed token thất bại, kèm `fileId` (không log secret).

### 4.6 Maintainability
Logic sinh `downloadUrl` đặt trong `MediaFilesService` (method private `buildSignedDownloadUrl`), không tạo service mới, không sửa `MinutesService`.

## 5. Data Model

### 5.1 Entity liên quan
`MediaFileEntity` (đọc, không thêm cột — `downloadUrl` là trường tính toán runtime, không lưu DB).

### 5.2 Dữ liệu đầu vào
`GET /api/v1/media-files/:fileId` — không có body, chỉ path param `fileId` (UUID).

Filter mới (FR-010): `GET /api/v1/meeting-minutes?meetingId=:uuid` — query param optional, cùng nhóm với `roomId/from/to/q` đã có.

### 5.3 Dữ liệu đầu ra

**Detail response (200)** — bổ sung `downloadUrl` so với trước:
```jsonc
{
  "success": true,
  "message": "Media file retrieved",
  "data": {
    "id": "uuid",
    "fileCode": "string|null",
    "fileName": "string",
    "fileType": "minutes_attachment",
    "mimeType": "application/pdf",
    "storageProvider": "local",
    "storageBucket": "string|null",
    "fileSizeBytes": "12345",
    "durationSeconds": null,
    "checksum": "string|null",
    "versionNo": 1,
    "visibilityLevel": "internal",
    "isActive": true,
    "relatedEntityType": "meeting_minutes",
    "relatedEntityId": "uuid",
    "recordingSessionId": null,
    "uploadedAt": "ISO datetime",
    "metadataJson": null,
    "downloadUrl": "http://localhost:3000/api/v1/media-files/{id}/secure-download?token=..."
  }
}
```

### 5.4 State / Status Model
Không có state riêng — chỉ đọc `is_active`/`deleted_at` đã có.

### 5.5 Data Constraints
`downloadUrl` không lưu DB, luôn tính lại mỗi request (đảm bảo token luôn còn hạn tại thời điểm trả về).

### 5.6 Data Lifecycle
Upload (`feat-attach-minutes-document`, UC-138) → List (UC-139) → **Detail (feature này, UC-140)** → Tải file qua `downloadUrl` (`secure-download`, đã có) → Xóa (UC-142, ngoài phạm vi feature này).

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-004, FR-005.

## 6. Error Handling

### 6.1 Validation Errors
`fileId` không phải UUID hợp lệ → 400 (`ParseUUIDPipe`).

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → 401.
- Thiếu `recording.files.read` → 403 `FORBIDDEN`.

### 6.3 Business Rule Errors
`fileId` không tồn tại/đã xóa mềm → 404 `MEDIA_FILE_NOT_FOUND`.

### 6.4 Conflict Errors
Không áp dụng.

### 6.5 Integration / External Service Errors
Sinh signed token thất bại → không phải lỗi HTTP, xử lý theo FR-006 (`downloadUrl = null`, log warning).

### 6.6 Error Response Expectations
Theo format chuẩn dự án (giống các spec khác trong `/spec/features/minutes`).

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN file `F` (`storageProvider = local`) tồn tại và active, WHEN gọi GET detail, THEN trả 200 với đầy đủ field + `downloadUrl` chứa `/secure-download?token=`.
- **AC-002**: GIVEN file `F` (`storageProvider = cloud_provider`, `fileUrl = "https://cdn/x.pdf"`), WHEN gọi GET detail, THEN `downloadUrl = "https://cdn/x.pdf"`, không gọi `generateSignedDownloadToken`.

### 7.2 Authorization Cases
- **AC-003**: GIVEN người gọi có role `EMPLOYEE`/`BUSINESS_ADMIN`/`MANAGER`/`SYSTEM_ADMIN` (đều có `recording.files.read` sau gap fix 2026-07-17), WHEN gọi GET detail, THEN trả 200.
- **AC-004**: GIVEN người gọi không có permission `recording.files.read`, WHEN gọi GET detail, THEN trả 403 `FORBIDDEN`.

### 7.3 Business Rule Cases
- **AC-005**: GIVEN `fileId` không tồn tại, WHEN gọi GET detail, THEN trả 404 `MEDIA_FILE_NOT_FOUND`.

### 7.4 Validation Cases
- **AC-006**: GIVEN `fileId` không phải UUID, WHEN gọi GET detail, THEN trả 400.

### 7.5 State Transition Cases
Không áp dụng (không có state).

### 7.6 Reliability Cases
- **AC-007**: GIVEN `generateSignedDownloadToken` throw lỗi, WHEN gọi GET detail, THEN vẫn trả 200 với `downloadUrl = null`, các field khác đầy đủ.

### 7.7 Supporting Cases (FR-010)
- **AC-008**: GIVEN cuộc họp `M1` có biên bản `B1`, WHEN gọi `GET /meeting-minutes?meetingId=M1.id`, THEN trả về đúng `B1` trong `data` (và không trả biên bản của cuộc họp khác).

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-001, FR-003, FR-005 |
| AC-002 | FR-004 |
| AC-003, AC-004 | FR-008 (permission gap fix) |
| AC-005 | FR-007 |
| AC-006 | FR-009 |
| AC-007 | FR-006 |
| AC-008 | FR-010 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Tách endpoint riêng cho UC-140 (vẫn dùng chung UC-121 `GET /media-files/:fileId`, đúng ghi chú trong API_CONTRACT: "Sử dụng chung GET /api/v1/media-files/{fileId} (UC-121)").
- Kiểm tra resource-level ownership theo `meeting_minutes` (VD: chặn Participant xem file của biên bản họ không liên quan) tại tầng UC-140 — endpoint này không biết về `meeting_minutes`, việc kiểm soát truy cập nằm ở tầng UC-139 (`feat-attach-minutes-document`, đã cập nhật 2026-07-17). Rủi ro: nếu người dùng đoán/rò rỉ được UUID của 1 `fileId` bất kỳ (không qua UC-139), họ vẫn xem được chi tiết miễn có `recording.files.read` — chấp nhận rủi ro này ở v1 (giống hành vi gốc của UC-121), xem 8.3.
- Sửa gap "STORAGE_DRIVER=s3 nhưng storageProvider luôn gán local" (mục 1.5) — thuộc `feat-attach-minutes-document`/storage layer, tách task riêng.
- Sửa toàn bộ các permission khác cũng bị lỗi seed role `INTERNAL_USER` (phát hiện ~24 chỗ khác ngoài phạm vi minutes) — tách task riêng, không sửa lan trong feature này.
- Xem trước nội dung file (preview PDF/ảnh) ngay trong modal — chỉ cung cấp link mở/tải, không render nội dung.

### 8.2 Có thể xem xét ở feature khác
- `feat-attach-minutes-document` (UC-139) — quyền xem danh sách attachment, đã mở rộng cùng đợt 2026-07-17.
- Feature riêng (chưa đặt tên) để thêm resource-level check cho UC-121/UC-140 nếu Product Owner xác nhận rủi ro ở 8.1 cần vá.
- Feature riêng để sửa gap S3/MinIO storage provider mismatch (mục 1.5).

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT thêm business rule ràng buộc `meeting_minutes.status`/`preparedBy` vào endpoint `GET /media-files/:fileId` trong phạm vi feature này.

## Assumptions
Xem mục 1.4.
