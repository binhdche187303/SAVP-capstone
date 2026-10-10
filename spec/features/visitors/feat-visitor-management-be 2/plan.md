# Backend Quản lý khách đến làm việc (2.10) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay lớp dữ liệu giả của phân hệ Khách bằng BE thật (module `visitors`), gồm vòng đời lượt khách, nhận diện qua IVSS và FaceGate, thông báo, tác vụ nền, và nối FE.

**Architecture:** Module NestJS `visitors` mới với 5 bảng riêng. Mỗi khách có một tài khoản ẩn trong `users` để đi qua đường nhận diện sẵn có. Chuyển trạng thái nằm trong một file thuần chép từ FE; mọi thay đổi trạng thái trong DB là cập nhật có điều kiện. `ivss` và `face-access` gọi sang `visitors` qua cổng nối đặt ở `src/common/ports/`.

**Tech Stack:** NestJS 11, TypeORM 1.0 (truy vấn SQL tham số qua `DataSource`), PostgreSQL, Redis (ioredis), BullMQ, `@nestjs/schedule`, Jest.

**Spec:** `spec/features/visitors/feat-visitor-management-be/spec.md` (VIS-BE-001). Nghiệp vụ gốc: `spec/features/visitor-reports/feat-visitor-report-ui-mockup/spec.md` §4.1, §12.

**Mức chi tiết của plan này:** mỗi task ghi file, chữ ký hàm, DDL, quy tắc và danh sách ca test có kỳ vọng cụ thể. Code đầy đủ chỉ có sẵn cho phần chép từ FE (máy trạng thái và bộ test). Phần còn lại người làm viết theo hợp đồng ở task, test trước.

## Global Constraints

- **Không commit, không push** khi LamNH chưa yêu cầu. Mỗi task kết thúc bằng "Điểm dừng": chạy test của task, báo file đã đổi. Không thêm dòng `Co-Authored-By`.
- Làm trên nhánh `feat/visitors-be` tách từ `main` của BE (repo đang ở `chore/demo-seed`; hỏi LamNH trước khi đổi nhánh nếu cây làm việc còn thay đổi chưa lưu).
- Hiến pháp dự án: SQL chỉ dùng tham số (SEC-03); mọi endpoint ghi có JWT trừ 3 endpoint công khai ở spec §7.1 (SEC-02); xóa mềm (DATA-01); không đọc/ghi bảng của module khác bằng SQL trực tiếp, đi qua service của module đó (ARCH-01); thao tác quá 2 giây đi qua hàng đợi (ARCH-02); thao tác ghi phải lặp lại an toàn (ARCH-03); lỗi không lộ chi tiết nội bộ (ENG-03).
- Phản hồi thành công `{ success: true, message, data, meta }`; lỗi `{ success: false, message, error: { code, details } }`. Controller tự gắn `new ValidationPipe({ whitelist: true, transform: true })`.
- **Mọi phép tính theo "ngày" dùng múi `Asia/Ho_Chi_Minh` tường minh** (`AT TIME ZONE 'Asia/Ho_Chi_Minh'` trong SQL, hoặc cộng 7 giờ trong code). Máy chủ production chạy UTC.
- Giá trị mặc định: ngưỡng khớp `0.80`; đệm quyền ra vào `30` phút; lượt tối đa `7` ngày; leo thang quá giờ sau `30` phút; giữ ảnh `30` ngày; mã lượt `VS-YYMMDD-NNNN`.
- Tên trạng thái, thao tác, loại sự kiện, mã lý do giữ đúng chuỗi của FE (`must_leave`, `close_manual`, `access_revoked`…).
- Không ghi ảnh, số giấy tờ, điện thoại của khách vào log hay `audit_logs` (SEC-01).
- Lệnh test: unit `npx jest <đường dẫn>`; DB và e2e `RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json <đường dẫn> --runInBand` trên DB dev cục bộ (`localhost:5433`). Bộ jest đầy đủ của repo vốn có khoảng 250 ca hỏng sẵn trên `main`; so với số nền trước khi làm, không coi đó là hồi quy.
- Migration đặt tên `YYYYMMDDNNNNNN-<Tên>.ts`, viết SQL tay, có `down`, chạy lại được (`IF NOT EXISTS`). Dải số của plan này: `20261012000001`–`20261012000009`.

## Review Focus

1. **Hai người cùng bấm một thao tác** (duyệt, check-out) trong cùng tích tắc: chỉ một lần chuyển trạng thái, một bộ sự kiện, người thứ hai nhận 409. (Task 6)
2. **Sự kiện IVSS của người không phải khách** (gần như toàn bộ lưu lượng): hook thoát ngay, không thêm truy vấn nặng, không bao giờ ném lỗi vào webhook. (Task 10)
3. **Thiết bị FaceGate lỗi hoặc treo khi đang duyệt**: thao tác duyệt vẫn thành công; cron đối soát tự đẩy lại. (Task 11, 13)
4. **Cùng một người đăng ký nhiều lần** (cùng CCCD hoặc cùng điện thoại, có thể đồng thời): một dòng `visitors`, một tài khoản ẩn; lượt chồng thời gian không được duyệt. (Task 4, 6)
5. **Ranh giới ngày theo giờ Việt Nam trên máy chủ UTC**: lượt còn "đang ở trong" lúc 23:59 giờ Việt Nam chưa bị chuyển "chưa ghi nhận giờ ra"; lúc 00:00 thì có. (Task 3, 13)

---

## File Structure

```
src/common/ports/visitor-face-event-hook.ts          cổng nối ivss/face-access → visitors
src/common/utils/non-staff-department.util.ts        gom PARTNER + VISITOR
src/database/migrations/20261012000001..9-*.ts
src/modules/visitors/
  visitors.module.ts
  constants/   visit-status.constant.ts · visitor-error.constant.ts · visitor-permission.constant.ts
  domain/      visit-state-machine.ts (+ .spec) · visit-validators.ts (+ .spec)
  entities/    visitor · visitor-visit · visitor-visit-zone · visitor-visit-event
  dto/         public-registration · create-visit · list-visits.query · approve · reason · extend · close-manual · stats.query
  config/      visitor-config.service.ts
  guards/      public-rate-limit.guard.ts
  services/    visit-code · visitor-identity · visit · visit-query · visitor-face-lifecycle
               · visitor-facegate · visitor-gate · visitor-notifier · visitor-sweep
  presenters/  visit-view.presenter.ts          VisitView đúng dạng FE đang đọc
  controllers/ public-visitor · visits · visitor-desk · my-visitors
test/visitors/ fixtures.ts · *.e2e-spec.ts
```

Sửa ở module khác: `accounts` (UsersService, FaceProfileService, 5 file loại PARTNER), `auth` (1 guard), `ivss` (1 lời gọi), `face-access` (1 nhánh + tìm thiết bị theo khu), `alerts` (3 dòng), `notifications` (enum), `mail` (4 mẫu), `scheduler` (3 cron), `dev` (1 endpoint), `app.module.ts`, `config/env.validation.ts`.

---

# M1 — Nền (4,5 ngày)

### Task 1: Migration bảng, đơn vị VISITOR, quyền

**Files:**
- Create: `src/database/migrations/20261012000001-CreateVisitorTables.ts`, `20261012000002-SeedVisitorDepartment.ts`, `20261012000003-SeedVisitorPermissions.ts`
- Test: `test/visitors/visitor-schema.e2e-spec.ts`

**Interfaces:**
- Produces: bảng `visitors`, `visitor_visits`, `visitor_visit_zones`, `visitor_visit_events`, `visitor_visit_code_counters` đúng spec §4; đơn vị `department_code='VISITOR'` với id cố định `8d4f3a2b-5c7b-4a3f-8e9d-2b3c4d5e6f70`; 5 mã quyền và phân vai ở spec §7.3.

- [ ] **Step 1: Viết test DB (đỏ).** Các ca:
  - sau `migration:run`, 5 bảng tồn tại với đúng cột NOT NULL của spec §4;
  - chèn hai `visitors` cùng `id_number` → lỗi 23505; cùng `phone_number` khi cả hai không có `id_number` → 23505; cùng điện thoại nhưng khác `id_number` → được;
  - `visitor_visits` với `scheduled_to <= scheduled_from` → lỗi CHECK;
  - `visit_code` trùng → 23505;
  - đơn vị VISITOR tồn tại; quyền `visitor.desk.use` gắn với GUARD, `visitor.visit.manage` không gắn với GUARD, `visitor.host.self` gắn với EMPLOYEE và TEACHER;
  - `migration:revert` ba lần rồi `migration:run` lại không lỗi.
- [ ] **Step 2: Chạy, xác nhận đỏ.** `RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json test/visitors/visitor-schema --runInBand` → FAIL (bảng chưa có).
- [ ] **Step 3: Viết 3 migration.** Mẫu DDL và seed: `20261006000001-CreateAcademicTables.ts`, `20260811000001-SeedPartnerDepartment.ts`, `20260825000001-SeedBiometricDeletePermission.ts` (`module_code='visitors'`).
- [ ] **Step 4: Chạy migration và test, xác nhận xanh.**
- [ ] **Step 5: Điểm dừng.**

### Task 2: Khung module, entity, cờ bật, cấu hình

**Files:**
- Create: `src/modules/visitors/visitors.module.ts`, 4 file `entities/*.entity.ts`, `constants/*.ts`, `config/visitor-config.service.ts`
- Modify: `src/app.module.ts` (đăng ký có điều kiện theo `VISITORS_ENABLED`, cùng cách `loadDevModule` ở dòng 59), `src/config/env.validation.ts` (thêm `VISITORS_ENABLED`, `SCHEDULER_VISITOR_ENABLED`, `VISITOR_FACEGATE_ENABLED`, đều `Joi.boolean().default(false)`)
- Test: `src/modules/visitors/config/visitor-config.service.spec.ts`

**Interfaces:**
- Produces: `VisitorConfigService.get(): Promise<VisitorConfig>` với `VisitorConfig = { faceMatchThreshold, accessBufferMinutes, maxVisitDays, overstayEscalateMinutes, approverMode, defaultZoneCodes, purposes, photoRetentionDays, publicRateLimit, notifyHostEmail, publicHostSearchEnabled }`; đọc `system_configs` nhóm `visitor`, nhớ đệm 30 giây, thiếu khóa nào dùng mặc định của spec §6.

- [ ] **Step 1: Test (đỏ):** không có dòng cấu hình → trả đúng 11 giá trị mặc định; có `visitor.face_match_threshold = 0.9` → trả 0.9, các khóa khác vẫn mặc định; giá trị sai kiểu (chuỗi "abc" cho ngưỡng) → dùng mặc định và ghi cảnh báo; lỗi DB → dùng mặc định, không ném.
- [ ] **Step 2–4:** chạy đỏ → viết → chạy xanh. Mẫu đọc cấu hình: `guest-access/config/guest-access-config.service.ts`.
- [ ] **Step 5:** `npx tsc --noEmit -p tsconfig.json` sạch; khởi động app với `VISITORS_ENABLED=false` và `true` đều lên được.
- [ ] **Step 6: Điểm dừng.**

### Task 3: Máy trạng thái lượt khách (chép từ FE)

**Files:**
- Create: `src/modules/visitors/domain/visit-state-machine.ts`
- Test: `src/modules/visitors/domain/visit-state-machine.spec.ts`

**Interfaces:**
- Consumes: nguồn chép `SAVP-capstone-FE/src/mocks/visitorReport/visitStateMachine.js` và `visitStateMachine.test.js`.
- Produces (kiểu TypeScript): `VisitStatus`, `VisitAction`, `TERMINAL_STATUSES`, `canTransition(status, action)`, `nextStatus(status, action)` (ném `VisitTransitionError`), `availableActions(status)`, `canExtend(visit, newValidTo)`, `isOverstay(visit, now)`, `overstayLevel(visit, now, escalateMinutes)`, `isOnSite(visit)`, `shouldExpire(visit, now)`, `shouldMarkExitUnrecorded(visit, now)`, `defaultAccessWindow(from, to, bufferMinutes)`, `evaluateGateAttempt(visit, { at, zoneId, score }, threshold)`.
- Khác bản FE ở hai chỗ: ngưỡng và số phút là tham số (đến từ cấu hình); `shouldMarkExitUnrecorded` so ngày theo giờ Việt Nam bằng phép cộng 7 giờ, không dùng giờ máy.

- [ ] **Step 1: Chép 33 ca test của FE sang `.spec.ts`**, đổi import; thêm 3 ca cho múi giờ: lượt có `validTo = 2026-10-08T10:00:00Z`: tại `2026-10-08T16:59:00Z` (23:59 giờ VN) → false; tại `2026-10-08T17:00:00Z` (00:00 hôm sau giờ VN) → true; đặt `process.env.TZ='UTC'` ở đầu file để chứng minh không phụ thuộc giờ máy.
- [ ] **Step 2: Chạy, đỏ.** `npx jest src/modules/visitors/domain/visit-state-machine.spec.ts` → `Cannot find module`.
- [ ] **Step 3: Chép và chuyển kiểu file máy trạng thái.**
- [ ] **Step 4: Chạy, xanh.** Expected: 36 tests passed.
- [ ] **Step 5: Điểm dừng.**

### Task 4: Mã lượt, định danh khách, tài khoản ẩn

**Files:**
- Create: `services/visit-code.service.ts`, `services/visitor-identity.service.ts`, `src/common/utils/non-staff-department.util.ts`
- Modify: `src/modules/accounts/services/users.service.ts` (thêm `createVisitorShadowUser`), `src/modules/accounts/accounts.module.ts` (export `UsersService` nếu chưa), và 6 file đang loại PARTNER: `auth/guards/partner-account-restriction.guard.ts`, `accounts/dto/create-user.dto.ts`, `accounts/controllers/departments.controller.ts`, `accounts/services/users.service.ts`, `accounts/services/partner-account-import.service.ts`, `accounts/services/departments.service.ts`
- Test: `services/visit-code.service.spec.ts`, `services/visitor-identity.service.spec.ts`, `src/common/utils/non-staff-department.util.spec.ts`, `test/visitors/visitor-identity.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `VisitCodeService.next(manager: EntityManager, scheduledFrom: Date): Promise<string>` — `VS-YYMMDD-NNNN` theo ngày Việt Nam của `scheduledFrom`.
  - `UsersService.createVisitorShadowUser(manager, { visitorId, fullName }): Promise<{ userId: string }>` — đúng mô tả spec §4.6.
  - `VisitorIdentityService.resolve(manager, input: { fullName, idNumber?, phone, email?, organization? }): Promise<{ visitorId, userId, created: boolean }>` — tìm theo `id_number` rồi `phone`; không có thì tạo `visitors` + tài khoản ẩn trong cùng transaction; có thì cập nhật họ tên, email, đơn vị công tác mới nhất.
  - `isNonStaffDepartment(departmentId, dataSource): Promise<boolean>` và `resolveNonStaffDepartmentIds(dataSource): Promise<string[]>` (PARTNER + VISITOR, nhớ đệm).

- [ ] **Step 1: Test (đỏ).**
  - Mã lượt: lượt đầu của ngày → `…-0001`; hai lời gọi song song cùng ngày (2 kết nối) → `0001` và `0002`, không trùng; `scheduledFrom = 2026-10-08T17:30:00Z` → mã mang ngày `261009` (giờ VN).
  - Định danh: cùng `idNumber` hai lần → cùng `visitorId`, `created` lần hai là false; không `idNumber`, cùng `phone` → cùng người; hai lời gọi đồng thời cùng CCCD → một dòng (bắt 23505 rồi đọc lại); điện thoại được chuẩn hóa (`+84912…` và `0912…` là một).
  - Tài khoản ẩn: `account_status='active'`, đơn vị VISITOR, không role; `LoginService` với email của tài khoản ẩn và mật khẩu bất kỳ → thất bại.
  - Hồi quy loại trừ: danh sách người dùng, danh sách đơn vị, bộ chọn người của 6 file trên không trả tài khoản/đơn vị VISITOR (mỗi file một ca, đặt cạnh ca PARTNER sẵn có).
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng M1.** Chạy `npx jest src/modules/visitors src/modules/accounts src/common/utils` và so với số nền.

---

# M2 — Đăng ký và quản lý lượt khách (6,5 ngày)

### Task 5: Giới hạn tần suất và ba endpoint công khai

**Files:**
- Create: `guards/public-rate-limit.guard.ts`, `controllers/public-visitor.controller.ts`, `dto/public-registration.dto.ts`, `domain/visit-validators.ts`, `presenters/visit-view.presenter.ts`
- Modify: `src/modules/mail/templates/builders.ts` (thêm `buildVisitorRegistrationReceivedEmail`), `src/modules/notifications/entities/notification.entity.ts` (enum `VISITOR_*`)
- Test: `guards/public-rate-limit.guard.spec.ts`, `domain/visit-validators.spec.ts`, `test/visitors/public-visitor.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `@PublicRateLimit('register' | 'lookup' | 'hosts')` + `PublicRateLimitGuard`: khóa Redis `visitor:rl:<bucket>:<ip>`, `INCR` + `EXPIRE` lần đầu; vượt → 429 `RATE_LIMITED` với header `Retry-After`. IP lấy từ `X-Forwarded-For` phần tử đầu, rồi `req.ip`. Redis lỗi → cho qua và ghi cảnh báo.
  - `validateVisitPayload(payload, channel, now, config)` trả mã lỗi + thông điệp tiếng Việt **trùng từng chữ** với bảng ở plan mockup Task 4 (FE đang so chuỗi).
  - `POST /public/visitor-registrations` → 201 `VisitView`; `GET /public/visitor-registrations/:code` → `PublicVisitView`; `GET /public/visitor-hosts?q=`; `GET /public/visitor-hosts/:id`.
  - `toVisitView(row, ctx)` và `toPublicVisitView(row)` — danh sách trường ở spec §7.

- [ ] **Step 1: Test (đỏ).**
  - Guard: 5 lần đăng ký trong 600 giây qua, lần 6 → 429 có `Retry-After`; IP khác không bị ảnh hưởng; Redis ném lỗi → qua.
  - Kiểm đầu vào: 10 ca lỗi của FE (thiếu tên, điện thoại sai, email sai, người gặp không tồn tại, thiếu mục đích, bắt đầu ở quá khứ, kết thúc không sau bắt đầu, dài hơn 7 ngày, thiếu ảnh, thiếu đồng ý) với đúng thông điệp.
  - e2e: đăng ký hợp lệ → 201, `status='pending_approval'`, mã đúng mẫu, có sự kiện `registered` và `email_sent`, có một dòng `notifications` loại `visitor_pending_approval` cho người được gặp; ảnh lớn hơn 2 MB → 413 hoặc 400 `PHOTO_TOO_LARGE`; ảnh không phải JPEG/PNG → 400; người gặp thuộc đơn vị PARTNER/VISITOR hoặc đã nghỉ → 400.
  - Tra cứu: mã đúng → không có `idNumber`, `phone`, `email`, `photo`, ghi chú sự kiện; mã sai → 404 "Không tìm thấy lượt đăng ký với mã này"; mã viết thường vẫn tìm được.
  - Tìm người gặp: `q` 1 ký tự → mảng rỗng; tối đa 10; chỉ `id, fullName, departmentId, departmentName`; cờ `publicHostSearchEnabled=false` → 403.
- [ ] **Step 2–4:** đỏ → viết → xanh. Ảnh: `decode-base64-image.util.ts` → `FaceProfileService.enrollPortrait(shadowUserId, file, null)` (hồ sơ ở `pending_review`) và lưu `photo_file_id`. Email qua `NotificationsService.enqueueEmailNotification`.
- [ ] **Step 5: Điểm dừng.**

### Task 6: `VisitService` — các thao tác ghi

**Files:**
- Create: `services/visit.service.ts`, các DTO thao tác
- Test: `services/visit.service.spec.ts`, `test/visitors/visit-actions.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 3 (máy trạng thái), Task 4 (định danh, mã lượt), `AuditLogsService`.
- Produces — mỗi hàm nhận `actor: { userId, permissions }` và trả `VisitView`:
  `createInternal(dto, channel, actor)`, `approve(id, { access? }, actor)`, `reject(id, { reason }, actor)`, `cancel(id, actor)`, `revoke(id, { reason }, actor)`, `extend(id, { validTo }, actor)`, `attachPhoto(id, { photo }, actor)`, `checkInManual(id, { note }, actor)`, `checkOut(id, { zoneId? }, actor)`, `closeManually(id, { reason, exitAt?, note? }, actor)`; và cho hệ thống gọi: `systemCheckIn(visitId, { at, zoneId, score, deviceEventId })`, `systemCheckOut(visitId, { at, zoneId, deviceEventId })`, `recordGateEvent(visitId, type, { zoneId, score, note, deviceEventId })`, `touchLastSeen(visitId, at, zoneId)`.
- Hàm nội bộ dùng chung: `transition(manager, id, expectedStatuses, action, patch)` thực hiện `UPDATE … WHERE id = $1 AND status = ANY($2) RETURNING *`; 0 dòng → ném `ConflictException({ code: 'VISIT_STATE_CONFLICT' })`.

- [ ] **Step 1: Test (đỏ).** Bảng "Hành vi từng thao tác" của plan mockup Task 4 và bổ sung §12, mỗi dòng một ca: trạng thái sau, sự kiện được thêm, thông báo được gọi. Thêm:
  - tranh chấp: hai `approve` đồng thời trên cùng lượt (2 kết nối) → một thành công, một 409; bảng sự kiện chỉ có một `approved`;
  - BR-V17: duyệt lượt thứ hai của cùng khách chồng khung hiệu lực → 409 `VISIT_OVERLAP`; không chồng → được;
  - BR-V18: người được gặp duyệt lượt của người khác → 403; người có `visitor.visit.manage` → được; `approver_mode='manager_only'` thì người được gặp cũng bị 403;
  - thu hồi khi `checked_in` → `must_leave`, có `revoked_at`, có sự kiện `host_notified` và `security_notified`; khi `approved` → `revoked`;
  - đóng thủ công: 4 thông điệp lỗi của FE; `left_unrecorded` → `checked_out`, `manual_exit=true`; `not_found` → `exit_unrecorded`, `not_found=true`;
  - gia hạn đưa `overstay_notified_at` và `overstay_escalated_at` về NULL;
  - mọi thao tác ghi `audit_logs` và metadata không chứa ảnh, số giấy tờ, điện thoại.
- [ ] **Step 2–4:** đỏ → viết → xanh. Lời gọi thông báo và thiết bị đi qua interface (`VisitorNotifier`, `VisitorFaceLifecycle`) tiêm vào, ở task này dùng bản giả; bản thật ở Task 9, 11, 12.
- [ ] **Step 5: Điểm dừng.**

### Task 7: `VisitQueryService` — danh sách, quầy lễ tân, thống kê

**Files:**
- Create: `services/visit-query.service.ts`, `dto/list-visits.query.dto.ts`, `dto/stats.query.dto.ts`, `test/visitors/fixtures.ts`
- Test: `test/visitors/visit-query.e2e-spec.ts`, `presenters/visit-view.presenter.spec.ts`

**Interfaces:**
- Produces: `list(params, actor)` → `{ items, total, counts }`; `detail(id, actor)`; `related(id, actor)`; `lookups()`; `deskToday(now)` → `{ kpis: { expected, arrived, onSite, overstay }, items, alerts, attention }`; `myVisits(userId)` → `{ pending, upcoming, past }`; `stats({ from, to, departmentId, groupBy })`; `computeKpis(filter)` (xuất để báo cáo khách dùng chung).
- Định nghĩa số liệu giữ đúng plan mockup Task 4 và §12: `expected` không tính `rejected`/`cancelled`; `onSite` gồm `must_leave`; `attention` theo thứ tự `must_leave, overstay, exit_unrecorded (7 ngày), manual_review, no_photo`; "hôm nay" theo giờ Việt Nam.

- [ ] **Step 1: Viết fixture** dựng 1 khách × đủ 10 trạng thái hôm nay + 20 lượt quá khứ có số liệu biết trước (id tiền tố `fa11ed00-` để dọn).
- [ ] **Step 2: Test (đỏ).** `counts` cộng lại bằng `total` khi không lọc trạng thái; lọc `status='closed'` trả đúng 5 trạng thái đóng; `q` không dấu và không phân biệt hoa thường khớp tên có dấu (dùng `unaccent` nếu extension có sẵn, không thì hàm chuẩn hóa ở cột sinh sẵn — kiểm tra bằng `SELECT * FROM pg_extension`); lọc ngày cả hai đầu theo giờ VN; KPI quầy lễ tân đúng số của fixture; `attention` đúng thứ tự và đúng 5 loại; thống kê: `byDepartment` cộng lại bằng `totalVisits`; `VisitView` có đủ mọi khóa FE đọc (so với danh sách khóa cố định trong test).
- [ ] **Step 3–4:** viết → xanh. Mỗi truy vấn kèm `EXPLAIN` trong ghi chú PR để thấy dùng chỉ mục.
- [ ] **Step 5: Điểm dừng.**

### Task 8: Controller nội bộ và phân quyền

**Files:**
- Create: `controllers/visits.controller.ts`, `controllers/visitor-desk.controller.ts`, `controllers/my-visitors.controller.ts`
- Test: `test/visitors/visitor-rbac.e2e-spec.ts`

- [ ] **Step 1: Test (đỏ).** Ma trận quyền của spec §7.3: với mỗi endpoint của spec §7.2 và mỗi role (SYSTEM_ADMIN, BUSINESS_ADMIN, GUARD, MANAGER, EMPLOYEE), kỳ vọng 2xx hoặc 403 đúng bảng; không token → 401; người được gặp xem được chi tiết lượt của mình nhưng 403 với lượt của người khác.
- [ ] **Step 2–4:** viết controller (guard `JwtAuthGuard, PermissionsGuard`, `@RequirePermissions`), khai Swagger cho từng endpoint (ENG-02) → xanh.
- [ ] **Step 5: Điểm dừng M2.** Chạy toàn bộ `test/visitors` và `src/modules/visitors`.

---

# M3 — Nhận diện và thông báo (7 ngày)

### Task 9: Vòng đời khuôn mặt trên IVSS

**Files:**
- Modify: `src/modules/accounts/services/face-profile.service.ts` (thêm `setProfileStatus(userId, status, actorId)` và `deletePortrait(userId)`)
- Create: `services/visitor-face-lifecycle.service.ts`
- Test: `face-profile.service.spec.ts` (bổ sung), `services/visitor-face-lifecycle.service.spec.ts`

**Interfaces:**
- Produces: `VisitorFaceLifecycleService.sync(visitorId): Promise<'active' | 'revoked' | 'none'>` — hồ sơ `active` khi khách có ít nhất một lượt `approved`/`checked_in`/`must_leave` và có ảnh; ngược lại `revoked`. Gọi sau mọi thao tác đổi trạng thái (thay bản giả của Task 6).

- [ ] **Step 1: Test (đỏ).** Bảng spec §8.1 cột IVSS, mỗi dòng một ca; thêm: khách có hai lượt, một đóng một còn duyệt → vẫn `active`; khách chưa có ảnh → `none`, không ném; `setProfileStatus` từ chối trạng thái không hợp lệ.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5:** kiểm tay trên DB dev: duyệt một lượt, sau một chu kỳ `ivss-portrait-reconcile` có dòng `device_user_mappings` nguồn `portrait` cho tài khoản ẩn (cần `SCHEDULER_IVSS_PORTRAIT_ENABLED` và bridge IVSS; không có bridge thì ghi rõ "chưa kiểm được" trong báo cáo).
- [ ] **Step 6: Điểm dừng.**

### Task 10: Móc sự kiện IVSS và `VisitorGateService`

**Files:**
- Create: `src/common/ports/visitor-face-event-hook.ts`, `services/visitor-gate.service.ts`
- Modify: `src/modules/ivss/services/ivss-presence-ingestion.service.ts` (tiêm token tùy chọn; một lời gọi sau khi có `sourceEventId`, khoảng dòng 346), `src/modules/ivss/ivss.module.ts`, `src/common/common.module.ts` (bản no-op mặc định), `src/modules/alerts/services/alerts.service.ts` (3 dòng mức mặc định)
- Test: `services/visitor-gate.service.spec.ts`, `ivss-presence-ingestion.service.spec.ts` (bổ sung), `test/visitors/visitor-ivss-flow.e2e-spec.ts`

**Interfaces:**
- Produces:

```ts
export interface VisitorIvssFaceEvent {
  userId: string; zoneId: string | null; direction: 'enter' | 'leave' | 'seen';
  eventTime: Date; similarity: number | null; sourceEventId: string | null; deviceId: string | null;
}
export interface VisitorFaceGateVerify {
  visitId: string; deviceId: string; zoneId: string | null; direction: 'in' | 'out'; verifyTime: Date;
}
export interface VisitorFaceEventHook {
  onIvssFaceEvent(evt: VisitorIvssFaceEvent): Promise<void>;
  onFaceGateVerify(evt: VisitorFaceGateVerify): Promise<void>;
}
export const VISITOR_FACE_EVENT_HOOK = Symbol('VISITOR_FACE_EVENT_HOOK');
```

- [ ] **Step 1: Test (đỏ).**
  - `VisitorGateService`: 5 dòng của bảng spec §8.2, mỗi dòng một ca với kỳ vọng về trạng thái lượt, sự kiện, lời gọi `writeGateLog`, lời gọi `recordAlert`, thông báo; thêm: `userId` không phải khách → không gọi gì thêm sau một lần tra (lần hai trong 60 giây không tra DB); độ tương đồng dưới ngưỡng → `manual_review`, không check-in; lượt `approved` nhưng ngoài khung → `access_denied` + cảnh báo; khách có hai lượt đã duyệt khác ngày → chọn lượt có khung chứa `eventTime`; `writeGateLog` trả `duplicate` → không ném, không tạo sự kiện thứ hai.
  - Ingest: hook ném lỗi → `onFaceEvent` vẫn hoàn tất và sự kiện vẫn được lưu; hook không được gọi khi `userId` null.
  - e2e: dựng khách đã duyệt + ánh xạ `portrait` → gửi sự kiện IVSS giả qua endpoint webhook nội bộ với kênh đã map vào khu `gate` hướng `enter` → lượt `checked_in`, `gate_access_logs` có 1 dòng `enter` mang `user_id` của tài khoản ẩn; gửi tiếp hướng `leave` → `checked_out` và dòng `leave`.
- [ ] **Step 2–4:** đỏ → viết → xanh. Lời gọi trong ingest: `void this.visitorHook.onIvssFaceEvent({...}).catch(log)`.
- [ ] **Step 5: Đo.** Chạy 1 000 sự kiện giả của người không phải khách qua `onFaceEvent` trước và sau thay đổi; chênh lệch thời gian trung bình dưới 5%.
- [ ] **Step 6: Điểm dừng.**

### Task 11: FaceGate theo khu vực

**Files:**
- Create: `services/visitor-facegate.service.ts`
- Modify: `src/modules/face-access/services/face-attendance.service.ts` (nhánh đầu `onVerify`, quanh dòng 306 nơi đọc `metadata_json`), `src/modules/face-access/face-access.module.ts`
- Test: `services/visitor-facegate.service.spec.ts`, `face-attendance.service.spec.ts` (bổ sung)

**Interfaces:**
- Consumes: `FaceDeviceProviderFactory`, `FaceProfileService.getPortraitBytes(userId)`.
- Produces: `provision(visitId)`, `deprovision(visitId)`, `reprovision(visitId)` (gia hạn), `reconcile(): Promise<{ provisioned, removed, failed }>`. `uname` = 32 ký tự hex đầu của `sha256('visitor:' + visitId)` (cùng lý do giới hạn độ dài ở `face-provisioning.service.ts:59`). Thiết bị tìm bằng `iot_devices WHERE zone_id = ANY($zoneIds) AND device_type = 'face_server'`. Ánh xạ ghi `device_user_mappings` với `metadata_json = { source: 'visitor', visitId }`.

- [ ] **Step 1: Test (đỏ)** với provider giả: bảng spec §8.1 cột FaceGate; cờ `VISITOR_FACEGATE_ENABLED=false` → mọi hàm thoát ngay; khu không có thiết bị → bỏ qua, không lỗi; `addPerson` ném `FaceDeviceError('timeout')` → ánh xạ `sync_status='failed'`, hàm không ném, `reconcile` lần sau đẩy lại; gọi `provision` hai lần → một ánh xạ; `onVerify` với ánh xạ nguồn `visitor` → gọi `onFaceGateVerify`, **không** chạy luồng điểm danh họp; ánh xạ nguồn khác → hành vi cũ không đổi (ca hồi quy sẵn có vẫn xanh).
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng.** Ghi rõ trong báo cáo: chưa thử trên thiết bị thật (spec R1).

### Task 12: Thông báo, email, realtime

**Files:**
- Create: `services/visitor-notifier.service.ts`
- Modify: `src/modules/mail/templates/builders.ts` (thêm `buildVisitorApprovedEmail`, `buildVisitorRejectedEmail`, `buildVisitorInviteEmail`), `controllers/my-visitors.controller.ts` (thông báo của tôi)
- Test: `services/visitor-notifier.service.spec.ts`, `src/modules/mail/templates/builders.spec.ts` (bổ sung)

**Interfaces:**
- Produces: `notifyHost(visit, type)` với `type ∈ visitor_pending_approval | visitor_registered | visitor_arrived | visitor_left | visitor_overstay | visitor_must_leave` → `NotificationsService.createNotification` (trong ứng dụng, `recipientUserIds=[hostUserId]`, `relatedEntityType='visitor_visit'`) + email cho người được gặp khi `notifyHostEmail`; `emailVisitor(visit, 'received' | 'approved' | 'rejected' | 'invite')`; `alertSecurity(visit, 'visitor_overstay' | 'visitor_must_leave' | 'visitor_zone_violation', zoneId)` → `AlertsService.recordAlert` với `dedupeKey = visit.id`.
- `GET /visitors/my-notifications` đọc bảng `notifications` các loại `visitor_*` của người gọi, trạng thái đã đọc qua `NotificationReadStateService`.

- [ ] **Step 1: Test (đỏ).** Mỗi loại: đúng người nhận, đúng nội dung tiếng Việt như mockup, không chứa số giấy tờ/điện thoại; khách không có email → không xếp hàng email, không lỗi; email duyệt có mã lượt và đường dẫn `<APP_URL>/visitor/status/<mã>`; `alertSecurity` gọi `recordAlert` với đúng loại và khóa; lỗi gửi thông báo không làm hỏng thao tác nghiệp vụ.
- [ ] **Step 2–4:** đỏ → viết → xanh; thay bản giả ở Task 6.
- [ ] **Step 5: Điểm dừng M3.**

---

# M4 — Tác vụ nền (2 ngày)

### Task 13: Quét định kỳ

**Files:**
- Create: `services/visitor-sweep.service.ts`
- Modify: `src/modules/scheduler/scheduler.service.ts` và `scheduler.module.ts` (3 cron, cờ `SCHEDULER_VISITOR_ENABLED`)
- Test: `services/visitor-sweep.service.spec.ts`, `test/visitors/visitor-sweep.e2e-spec.ts`

**Interfaces:**
- Produces: `runSweep(now): Promise<{ expired, overstayNotified, overstayEscalated, exitUnrecorded, skipped }>`, `runFaceReconcile()`, `runPhotoRetention(now)`. Mỗi hàm lấy khóa `visitor:cron:<tên>` bằng `SET NX EX 55`; không lấy được → `{ skipped: true }`.

- [ ] **Step 1: Test (đỏ)** với `now` truyền vào: lượt `approved` quá `valid_to` → `expired` + sự kiện + `sync` khuôn mặt; lượt `checked_in` quá giờ 1 phút → thông báo mức 1 đúng một lần dù chạy 3 lần; quá 30 phút → mức 2 đúng một lần, có cảnh báo `visitor_overstay`; lượt còn ở trong: 23:59 giờ VN không đổi, 00:00 hôm sau → `exit_unrecorded`; lượt nhiều ngày còn hiệu lực không bị đổi; `must_leave` tính từ ngày `revoked_at`; hai lời gọi `runSweep` song song → một chạy, một `skipped`; lỗi ở một lượt không chặn lượt sau; dọn ảnh: lượt cuối đóng 31 ngày trước → ảnh và hồ sơ khuôn mặt bị xóa, lịch sử lượt còn; 29 ngày → giữ.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng.**

### Task 14: Endpoint giả lập cho màn hình cổng

**Files:**
- Modify: `src/modules/dev/dev.controller.ts`, `dev.module.ts`
- Test: `test/visitors/dev-mock-visitor-scan.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /dev/mock-visitor-scan` `{ code, zoneId, direction: 'in'|'out', scenario: 'normal'|'low_score'|'outside_window' }` → `{ outcome, reason, score, at, visit }` đúng dạng FE đang đọc. Bên trong dựng một `VisitorIvssFaceEvent` (độ tương đồng 0.93 hoặc 0.71; `outside_window` dùng `eventTime = valid_to + 2h`) và gọi `VisitorGateService`, đi cùng đường với sự kiện thật.

- [ ] **Step 1: Test (đỏ):** 5 ca của test FE "VisitorGate" (cho vào, ngoài khung giờ, độ khớp thấp, đã thu hồi rồi ra, mã sai) cho kết quả trùng; `NODE_ENV=production` → route không tồn tại (404).
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng M4.**

---

# M5 — Nối FE và nghiệm thu (2 ngày)

### Task 15: FE gọi API thật cho phân hệ Khách

**Repo:** `SAVP-capstone-FE`, nhánh `feat/visitors-be-integration` từ `main`.

**Files:**
- Modify: `src/config/featureFlags.js` (tách cờ: `VISITOR_MOCK_ENABLED` đọc `REACT_APP_VISITOR_MOCK`, `REPORT_MOCK_ENABLED` đọc `REACT_APP_REPORT_MOCK`; cả hai mặc định theo `REACT_APP_VISITOR_REPORT_MOCK` cũ), `src/service/visitorService.js`, `src/utils/request.js` (thêm `/public/visitor-` vào `isPublicEndpoint`), `src/routers/index.js` và `src/config/navigationRegistry.js` (mục menu theo mã quyền thay cho menu tĩnh), `src/pages/shared/visitors/MyVisitors.jsx` (bỏ `host-me`), `src/components/visitor/VisitorAvatar.jsx` (ảnh là URL), `src/pages/public/VisitorGate.jsx` (gọi `/dev/mock-visitor-scan`, ẩn route khi không phải bản dev), `src/constants/alertType.js` (3 loại cảnh báo khách)
- Test: cập nhật `src/service/mockFlagOff.test.jsx`; giữ 187 ca hiện có xanh

- [ ] **Step 1: Test (đỏ)** trong `mockFlagOff.test.jsx`: với cờ khách tắt, `scanAtGate` gọi `POST /dev/mock-visitor-scan`; `getMyVisits` không gửi `host-me`; cờ báo cáo vẫn bật thì `reportCenterService` vẫn dùng dữ liệu giả.
- [ ] **Step 2–4:** đỏ → sửa → xanh; `CI=true npx react-scripts test --watchAll=false` và `npm run build`.
- [ ] **Step 5: Điểm dừng.**

### Task 16: Nghiệm thu đầu-cuối và tài liệu

- [ ] **Step 1:** BE cục bộ với `VISITORS_ENABLED=true`, `SCHEDULER_VISITOR_ENABLED=true`; FE với `REACT_APP_VISITOR_MOCK=false`. Đi kịch bản demo bước 1–6 của `SAVP-capstone-FE/docs/demo-visitor-report.md`; ghi kết quả từng bước.
- [ ] **Step 2:** Chạy toàn bộ `test/visitors`, `src/modules/visitors`; chạy jest đầy đủ và so với số nền ghi ở đầu plan; đo độ phủ `npx jest src/modules/visitors --coverage` đạt ≥ 80% cho `domain/` và `services/`.
- [ ] **Step 3:** Tự rà theo danh sách của hiến pháp (SEC, ARCH, ENG) và ghi kết quả.
- [ ] **Step 4:** Viết `spec/features/visitors/feat-visitor-management-be/quickstart.md`: cờ env, thứ tự bật, cấu hình `ivss.channel_presence_zone_map` và `channel_direction_map` cho camera cổng, cách quay lui, những gì chưa kiểm được trên thiết bị thật.
- [ ] **Step 5:** Cập nhật `Checklist_PhanMem_CameraAI_v2.xlsx` STT 52–57 nếu LamNH yêu cầu.
- [ ] **Step 6: Điểm dừng cuối.** Báo: số test, độ phủ, kết quả kịch bản, danh sách điều chưa kiểm chứng. Hỏi LamNH về commit.

---

## Tổng hợp ước lượng

| Mốc | Task | Ngày công |
|---|---|---|
| M1 Nền | 1–4 | 4,5 |
| M2 Đăng ký và quản lý | 5–8 | 6,5 |
| M3 Nhận diện và thông báo | 9–12 | 7 |
| M4 Tác vụ nền | 13–14 | 2 |
| M5 Nối FE, nghiệm thu | 15–16 | 2 |
| **Tổng** | | **22** |

Sau M2 đã có thể tắt dữ liệu giả cho các màn đăng ký, quản lý, lịch sử, thống kê với check-in tay. M3 mới đem lại check-in tự động bằng camera.

**Phụ thuộc sang plan Báo cáo:** báo cáo loại `visitor` cần Task 1 và Task 7 (`computeKpis`) của plan này.
