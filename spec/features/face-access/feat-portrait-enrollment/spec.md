---
name: feat-portrait-enrollment
description: Enroll portrait (UC-17) — upload ảnh → media_files → face_profiles; StorageService.getFile + getPortraitBytes cho Ticket B. Face-access Pha 1 / D.
category: face-access
---

# Feature Specification: Portrait Enrollment (UC-17) + Portrait Reader

- **Feature ID**: FPE-001 (UC-17 · Face-access Pha 1 · Ticket D)
- **Module / Domain**: accounts (+ storage)
- **Created Date**: 2026-06-17
- **Status**: Draft (RECON xong)
- **Source Documents**:
  - `spec/global/constitution.md` (SEC-02 auth; SEC-03 validate input/no-traversal; DATA-01 no migration)
  - `CLAUDE.md` (§11 face; §13 DTO/upload; §22.2 accounts)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-17 — 795-832: face_profiles status pending_review)
  - `src/modules/storage/storage.service.ts`, `src/modules/accounts/entities/face-profile.entity.ts`, `src/modules/recording/entities/media-file.entity.ts`

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo spec FPE-001 (UC-17): StorageService.getFile (no-traversal); endpoint enroll portrait (FileInterceptor, validate mime/size, saveFile→media_files→face_profiles); FaceProfileService.getPortraitBytes cho Ticket B. KHÔNG migration. | Toàn bộ file (bản đầu) |
| 2026-07-29 | Chốt NC-1 (xem mục 11): status sau enroll `pending_review` → Ticket B **PHẢI chờ duyệt** (KHÔNG dùng ngay). Ban đầu nghi vấn BUG-01 (getPortraitBytes không lọc status) khi tách avatar/biometric — nhưng ĐÍNH CHÍNH cùng ngày: đã kiểm tra `git log`, xác nhận `getPortraitBytes` được vá lọc `status = 'active'` từ TRƯỚC (commit `b2c34ce`, ticket FPB-001, 2026-06-30) — không phải bug đang tồn tại, không cần method mới `getActivePortraitBytes`. Chốt NC-1 vẫn đúng ("chờ duyệt"), chỉ khác ở chỗ: hành vi này ĐÃ ĐƯỢC ĐẢM BẢO bởi `getPortraitBytes` hiện tại (FPB-001), không phải việc cần làm mới. | Mục 5, FR-FPE-001-005, mục 11 (NC-1) |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
Face-access Pha 1: Ticket B cần **bytes ảnh chân dung** của user để đẩy lên FaceGate (uploadFace). Hiện UC-17 (đăng ký khuôn mặt) **chưa được build** (chỉ có `face_profiles` entity + `users.service.hasFaceProfile` đọc). Ticket **D** build: endpoint enroll portrait + reader cho B. KHÔNG eKYC/embedding (defer).

### 1.2 Mục tiêu
- `StorageService.getFile(storageKey): Buffer` — đọc bytes file local, chống path-traversal.
- Endpoint `POST /api/v1/users/:userId/face-profile` (UC-17): upload 1 ảnh → `StorageService.saveFile` → tạo `media_files` → upsert `face_profiles`.
- `FaceProfileService.getPortraitBytes(userId): Buffer | null` — face_profiles → media_files.storage_key → getFile (Ticket B inject).

### 1.3 Out-of-scope
- eKYC / liveness / embedding (`embedding_storage_key` để trống).
- Đẩy ảnh lên thiết bị (Ticket B), face recognition (thiết bị lo).
- Đổi schema/migration (DATA-01 — bảng `media_files`/`face_profiles` có sẵn).

---

## 2. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| Upload pattern | Repo dùng `@nestjs/platform-express` `AnyFilesInterceptor`/multer (memory → `file.buffer`) ở [device-callbacks.controller.ts:26]. ⇒ portrait dùng `FileInterceptor('file', { limits:{ fileSize } })`. |
| StorageService | [storage.service.ts:41,70,82](../../../../src/modules/storage/storage.service.ts): `localPath`=STORAGE_LOCAL_PATH (def `./uploads`); `saveFile({buffer,originalName,folder,mimeType})`→`{storageKey,publicUrl,sizeBytes}`; `getStorageKey`; **KHÔNG có getFile** ⇒ thêm. StorageModule **@Global** ⇒ accounts inject trực tiếp. |
| face_profiles | [face-profile.entity.ts](../../../../src/modules/accounts/entities/face-profile.entity.ts): `user_id`(NN), `profile_code`(NN), `status`(enum active/**pending_review**/disabled/revoked), `primary_image_file_id`?, `embedding_storage_key`?, `sample_count`(def 0), `enrolled_by`?, `enrolled_at`?, `last_updated_at`?, `metadata_json`?. forFeature đã có trong accounts.module. |
| media_files | [media-file.entity.ts](../../../../src/modules/recording/entities/media-file.entity.ts): NOT NULL `file_name`/`file_type`/`mime_type`/`storage_provider`/`storage_key`; `MediaFileType.IMAGE='image'`; nullable `uploaded_by`, `file_size_bytes`(bigint→string), `related_entity_type/id`, `file_url`, `metadata_json`. ⇒ accounts INSERT raw (entity ở module recording — dùng dataSource.manager). |
| UC-17 contract | [API_CONTRACT:795-832]: `POST /users/{userId}/face-profile` · perm `account.face.register` · tạo `face_profiles` status `pending_review` · 409 nếu đã có active. |
| env | [env.validation.ts:99-101]: `STORAGE_LOCAL_PATH`, `STORAGE_MAX_FILE_SIZE`(50MB). ⇒ thêm `FACE_PORTRAIT_MAX_BYTES` (5MB) cho portrait (nhỏ hơn). |

---

## 3. StorageService.getFile (storage module)

```text
getFile(storageKey: string): Buffer
- base = path.resolve(this.localPath).
- resolved = path.resolve(this.localPath, storageKey).
- SEC-03 no-traversal: nếu !(resolved === base || resolved.startsWith(base + path.sep)) → ném Error('Invalid storage key').
- !fs.existsSync(resolved) → ném Error('File not found').
- return fs.readFileSync(resolved).
```

---

## 4. Endpoint — `POST /api/v1/users/:userId/face-profile`

| Field | Value |
|---|---|
| Auth | `JwtAuthGuard` + `MockPermissionsGuard` (no-op, pattern recording/iot) |
| Permission | `account.face.register` |
| Param | `userId` UUID (ParseUUIDPipe) |
| Body | multipart `file` (1 ảnh) — `FileInterceptor('file', { limits:{ fileSize } })` |
| Validate | mime ∈ {`image/jpeg`,`image/png`} → else 400 `INVALID_FILE_TYPE`; size ≤ FACE_PORTRAIT_MAX_BYTES → else 400 `FILE_TOO_LARGE`; thiếu file → 400 |
| HTTP | 201 |

**Flow:**
```text
1. JwtAuthGuard → enrolledBy (req.user). ParseUUIDPipe userId.
2. Validate file (tồn tại, mime, size).
3. saved = StorageService.saveFile({ buffer, originalName, folder:'face-profiles', mimeType }).
4. INSERT media_files { file_name, file_type:'image', mime_type, storage_provider:'local',
   storage_key:saved.storageKey, file_size_bytes, uploaded_by:enrolledBy,
   related_entity_type:'face_profile', related_entity_id:userId } RETURNING id.
5. upsert face_profiles theo user_id:
   - chưa có → INSERT { user_id, profile_code (sinh), status:'pending_review',
     primary_image_file_id, enrolled_by, enrolled_at:now, sample_count:1 }.
   - đã có → UPDATE primary_image_file_id, status:'pending_review', enrolled_by,
     last_updated_at:now, sample_count = sample_count+1.
6. Trả 201 envelope { success, message, data:{ faceProfileId, mediaFileId, status } }.
```

**Response:**
```json
{ "success": true, "message": "Face portrait enrolled",
  "data": { "faceProfileId": "uuid", "mediaFileId": "uuid", "status": "pending_review" } }
```

---

## 5. FaceProfileService.getPortraitBytes (cho Ticket B)

```text
getPortraitBytes(userId: string): Promise<Buffer | null>
  [ĐÍNH CHÍNH 2026-07-29 — đã vá tại FPB-001/commit `b2c34ce`, 2026-06-30, KHÔNG phải method mới]
- face = repo.findOne({ where:{ userId, status: FaceProfileStatus.ACTIVE } });
  !face || !face.primaryImageFileId → null.
  (Chỉ lấy ảnh ĐÃ DUYỆT — status khác 'active', kể cả pending_review, → null. 1 user chỉ 1 ACTIVE
  vì approve luôn revoke bản active cũ.)
- media = SELECT storage_key, storage_provider, file_url FROM media_files WHERE id=$1; none → null.
- storage_provider = 'local' → StorageService.getFile(storage_key) (đọc đĩa, lỗi → null).
- storage_provider = 'cloud_provider' → fetch(file_url) → Buffer (lỗi/không ok → null).
- provider lạ → null.
```

---

## 6. Functional Requirements (EARS)

```text
FR-FPE-001-001: StorageService SHALL cung cấp getFile(storageKey) đọc bytes; chống path-traversal (resolved phải trong localPath) — else ném; file thiếu → ném.
FR-FPE-001-002: THE system SHALL cung cấp POST /api/v1/users/:userId/face-profile (JWT + account.face.register) nhận 1 ảnh.
FR-FPE-001-003: IF mime ∉ {image/jpeg,image/png}, THEN 400 INVALID_FILE_TYPE; IF size > FACE_PORTRAIT_MAX_BYTES, THEN 400 FILE_TOO_LARGE; thiếu file → 400.
FR-FPE-001-004: WHEN hợp lệ, THE system SHALL saveFile → tạo media_files (image/local) → upsert face_profiles (primary_image_file_id, status pending_review, enrolled_*, sample_count) → 201 envelope.
FR-FPE-001-005 [ĐÍNH CHÍNH 2026-07-29]: FaceProfileService SHALL cung cấp getPortraitBytes(userId) → Buffer chỉ khi `face_profiles.status = 'active'` (đã vá tại FPB-001/commit `b2c34ce`); mọi status khác (kể cả `pending_review`) hoặc không có profile/ảnh → null. Hỗ trợ cả `local` (đọc đĩa) và `cloud_provider` (fetch Cloudinary `file_url`).
FR-FPE-001-006: Mọi query SHALL parameterized (SEC-03); KHÔNG migration (DATA-01).
```

## 7. Non-functional

```text
NFR-FPE-001-001 (SEC-02): endpoint JWT + permission account.face.register.
NFR-FPE-001-002 (SEC-03): validate file server-side (mime/size); getFile chặn traversal; storage_key xử lý server-side.
NFR-FPE-001-003 (DATA-01): dùng media_files/face_profiles có sẵn; KHÔNG migration; embedding để trống (defer eKYC).
NFR-FPE-001-004 (No global pipe): route-level @UsePipes(ParseUUIDPipe); envelope thủ công {success,message,data}.
NFR-FPE-001-005 (Config): FACE_PORTRAIT_MAX_BYTES qua Joi (1 dòng scoped); interceptor limit tương ứng.
```

## 8. Acceptance Criteria

```text
AC-FPE-001-001 (happy): Given ảnh jpeg hợp lệ; When POST; Then 201, saveFile gọi, media_files (image/local) tạo, face_profiles upsert (pending_review), envelope đúng.
AC-FPE-001-002 (mime reject): Given file application/pdf; Then 400 INVALID_FILE_TYPE; KHÔNG saveFile.
AC-FPE-001-003 (size reject): Given size > max; Then 400 FILE_TOO_LARGE.
AC-FPE-001-004 (upsert): Given user đã có face_profile; When POST lại; Then UPDATE (primary_image_file_id mới, sample_count+1), KHÔNG tạo profile trùng.
AC-FPE-001-005 (getFile ok): getFile(storageKey hợp lệ) → Buffer.
AC-FPE-001-006 (getFile traversal): getFile('../../etc/passwd') → ném; KHÔNG đọc ngoài localPath.
AC-FPE-001-007 (getFile missing): file không tồn tại → ném.
AC-FPE-001-008 (getPortraitBytes — ĐÍNH CHÍNH 2026-07-29): profile status='active' + có ảnh → Buffer; profile status='pending_review' (dù có ảnh) → null; profile status='rejected'/'disabled'/'revoked' → null; không profile / không ảnh → null. (Hành vi lọc status đã có sẵn từ FPB-001, không phải method riêng.)
```

## 9. Error Code Map
| HTTP | Code |
|---|---|
| 201 | (enrolled) |
| 400 | INVALID_FILE_TYPE / FILE_TOO_LARGE / VALIDATION_ERROR |
| 401 | UNAUTHORIZED |
| 403 | FORBIDDEN |
| 404 | USER_NOT_FOUND (nếu kiểm user — optional Pha 1) |

---

## 10. Test Plan (Jest — mock repos + StorageService)

```text
storage.service.spec (+getFile): đọc ok (mock fs.readFileSync) / traversal '../..' → ném (KHÔNG read) / file-missing → ném.
face-profile.service.spec: enrollPortrait happy (saveFile→media insert→face upsert) / mime reject / size reject / upsert (profile có sẵn → update) ; getPortraitBytes (status active + có ảnh→bytes / status pending_review→null / status rejected|disabled|revoked→null / không profile→null) — test case đã tồn tại từ FPB-001 (`face-profile.service.spec.ts`).
face-profile.controller.spec: passthrough envelope + 400 khi thiếu file.
≥80% coverage.
```

---

## 11. [NEEDS CLARIFICATION]
| # | Vấn đề | Đề xuất |
|---|---|---|
| NC-1 | status sau enroll. | **[CHỐT 2026-07-29]** `pending_review` (đúng UC-17 contract). B **PHẢI CHỜ DUYỆT** — KHÔNG dùng portrait khi còn `pending_review`. Trước đây để mở ("B có thể dùng ngay hoặc chờ duyệt — chốt ở B"); **ĐÍNH CHÍNH cùng ngày**: ban đầu nghi ngờ B dùng ngay (không lọc status, "BUG-01") khi tách avatar/biometric, nhưng `git log` xác nhận `getPortraitBytes` đã được vá lọc `status = 'active'` từ TRƯỚC (commit `b2c34ce`, FPB-001, 2026-06-30) — B thực tế ĐÃ CHỜ DUYỆT đúng, không cần sửa code, chỉ cần chốt lại câu hỏi mở này trong spec (mục 5, FR-FPE-001-005). |
| NC-2 | Kiểm user tồn tại trước enroll. | Optional Pha 1 (FK sẽ chặn nếu user sai); có thể thêm check 404 USER_NOT_FOUND sau. |
| NC-3 | Interceptor file limit vs env. | Interceptor đặt limit theo FACE_PORTRAIT_MAX_BYTES (đọc lúc decoration) + service double-check. |

---

> Trạng thái: **CHỜ REVIEW** sau khi code (STOP code-review gate). Chưa commit.
