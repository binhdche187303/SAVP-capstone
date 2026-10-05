# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-04 | Khởi tạo đặc tả tính năng Tạo tài khoản thủ công (manual-employee-account) từ UC-06 + Database v3.2 Compact + API_CONTRACT_v1.0_with_system_roles.md | Toàn bộ tài liệu |

# Feature Specification: UC-06 — Tạo tài khoản thủ công (Manual Employee Account)

- **Feature ID**: ACCT-CREATE-006
- **Feature Name**: Tạo tài khoản thủ công (Manual Employee Account Creation)
- **Module / Domain**: accounts (Quản lý tài khoản & Phân quyền)
- **Created Date**: 2026-06-04
- **Status**: Draft — Clarified
- **Source Documents**:
  - UC-06 — Tạo tài khoản thủ công (UseCase_List_SMRMPTS.xlsx)
  - [API_CONTRACT_v1.0_with_system_roles.md](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md) (mục UC-06)
  - [AGENTS.md](../../../../AGENTS.md) (Database v3.2 Compact, Business Rules, Permission naming)
  - Database v3.2 Compact (39 bảng) — entities: `users`, `departments`, `roles`, `user_roles`, `audit_logs`, `notifications`, `background_jobs`

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng này thuộc module `accounts`. Tổ chức cần quản lý tài khoản nhân viên nội bộ tập trung. Manager/Admin có trách nhiệm tạo tài khoản cho nhân viên mới hoặc nhân viên chưa có tài khoản trong hệ thống. Việc tạo tài khoản thủ công cho phép người quản lý nhập thông tin cơ bản, hệ thống tự động sinh mật khẩu tạm thời an toàn, gửi thông tin đăng nhập qua email, và đặt tài khoản ở trạng thái sẵn sàng sử dụng ngay.

Tính năng này là một phần của **meeting lifecycle** ở giai đoạn quản lý người dùng (user provisioning) — đảm bảo mọi nhân viên có tài khoản hợp lệ để tham gia vào quy trình đặt phòng, tạo họp, điểm danh và các hoạt động khác trong hệ thống.

Không bao gồm import Excel/bulk account, self-registration, public register, hay quản lý role/permission/department. Tất cả dữ liệu department và role được sử dụng từ dữ liệu đã có trong hệ thống.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Manager/Admin đã đăng nhập và có quyền `account.user.create`** thực hiện **Tạo thủ công một tài khoản nhân viên nội bộ mới** với thông tin họ tên, email, phòng ban, vai trò, nhằm **cấp quyền truy cập hệ thống cho nhân viên một cách an toàn, có kiểm soát và có truy vết**.

### 1.3 Giá trị mang lại

- **Cho Manager/Admin**: Chủ động tạo tài khoản nhân viên mới ngay trong hệ thống mà không cần can thiệp kỹ thuật.
- **Cho nhân viên**: Nhận được thông tin đăng nhập an toàn qua email, sẵn sàng sử dụng hệ thống ngay.
- **Cho bảo mật**: Mật khẩu tạm thời được sinh tự động đủ mạnh, hash trước khi lưu, không lưu raw ở bất cứ đâu, tài khoản bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
- **Cho audit/truy vết**: Mọi hành động tạo tài khoản đều được ghi vào `audit_logs` với đầy đủ thông tin người thực hiện, thời gian, hành động.

### 1.4 Giả định

- Manager/Admin đã đăng nhập thành công và có JWT Access Token hợp lệ.
- Hệ thống đã có dữ liệu phòng ban (`departments`) và vai trò (`roles`) hợp lệ.
- Email system sẵn sàng nhận và gửi email (qua `background_jobs` queue).
- Temporary password được hash bằng bcrypt (tương thích với `users.password_hash`).
- `users.username` được set mặc định bằng `lower(email)`; nếu unique constraint violation xảy ra, trả 409.
- `users.employee_code` là optional, nếu cung cấp phải unique (app check + DB unique constraint).
- Permission `account.user.create` đã được định nghĩa trong bảng `permissions` và gán cho role phù hợp.
- API sử dụng async-only email delivery: không gọi SMTP/Email Service trực tiếp trong request handler; chỉ tạo background_jobs record.
- Tạo tài khoản + gán role + tạo email queue + audit log chạy trong single DB transaction.
- `departments` có unique constraint hoặc application-level check cho case-insensitive email.
- `users.email` có DB-level unique constraint (final protection).
- `users.employee_code` có DB-level unique constraint nếu optional index đã được tạo; implementation thêm index nếu chưa có.
- Email validation dùng practical/basic regex, không full RFC 5322.

### 1.5 Cần làm rõ (Resolved)

Các điểm cần làm rõ đã được giải quyết qua phiên Clarification 2026-06-04. Xem chi tiết tại **1.6 Nhật ký Làm rõ**.

### 1.6 Nhật ký Làm rõ (Clarifications)

#### Session 2026-06-04

- **Q1-Email Integration**: Async-only. Backend tạo `background_jobs` (job_type: `send_email`) trong cùng DB transaction. Không gọi SMTP/Email Service trực tiếp. Thành công chỉ khi user + roles + email queue record đều được tạo.
- **Q2-Transaction Boundary**: Single DB transaction cho tạo user → gán roles → tạo email queue → ghi audit log. Nếu email queue không tạo được → rollback toàn bộ, trả lỗi. Email không được direct-send bên trong transaction.
- **Q3-Concurrent Duplicate Email**: Dùng cả application-level pre-check (SELECT) + DB unique constraint. DB constraint là final protection. Nếu constraint violation → map sang 409 với error code `ACCOUNT_EMAIL_ALREADY_EXISTS`. Không retry.
- **Q4-Email Validation**: Dùng practical/basic email validation (không RFC 5322). Trimmed + lowercase trước khi validate và persist.
- **Q5-EmployeeCode Uniqueness**: Optional. Nếu cung cấp, phải unique. Dùng cả application pre-check + DB unique constraint. Duplicate → 409 với error code `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS`.
- **Q6-Username Generation**: Set `username = lower(email)`. Không dùng prefix trước @. Nếu unique constraint violation → 409 với error code `ACCOUNT_USERNAME_ALREADY_EXISTS`.
- **Q7-Phone Number Validation**: Optional. Nếu cung cấp: trim, tối đa 30 ký tự, chỉ cho phép digits, spaces, plus, hyphen, parentheses. Invalid format → 400.
- **Q8-DirectManagerId**: Nếu không tồn tại → 404. Nếu tồn tại nhưng inactive/deleted/resigned → 422. Không enforce same-department manager rule.
- **Q9-Email Credential Content**: Email gồm: employee full name, login email/username, temporary password, yêu cầu đổi mật khẩu lần đầu, security notice. KHÔNG gồm: password hash, role IDs, JWT tokens, sensitive internal metadata.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| **Manager/Admin (Authenticated Account Manager)** | Người tạo tài khoản nhân viên thủ công | Nhập thông tin nhân viên, submit request, kiểm tra kết quả |
| **Employee (Recipient)** | Người nhận tài khoản mới | Nhận email credential, đăng nhập lần đầu bằng mật khẩu tạm, đổi mật khẩu |
| **Email System (Background Worker)** | Hệ thống queue email (background_jobs worker) | Đọc job từ `background_jobs`, gửi email chứa credential tới employee |
| **Hệ thống xác thực (Auth Guard)** | Actor nội bộ kiểm tra JWT và permission | Xác minh JWT, kiểm tra `account.user.create` permission |

### 2.2 Role & Permission Rules

- Chỉ Manager/Admin có permission `account.user.create` mới được phép gọi API tạo tài khoản.
  - Endpoint: `POST /api/v1/users`
  - Permission required: `account.user.create`
- Người tạo có thể gán bất kỳ role nào (đang active) cho tài khoản mới, không bị giới hạn bởi department scope của người tạo (trong v1).
- Người tạo có thể chọn bất kỳ department nào (đang active, chưa soft delete) cho tài khoản mới.
- Permission check được thực hiện trước tất cả business logic.

### 2.3 Actor Constraints

- Manager/Admin phải đang đăng nhập (JWT Access Token hợp lệ).
- Manager/Admin phải có permission `account.user.create` được gán qua role của họ.
- Employee (người được tạo) chưa có tài khoản trong hệ thống — kiểm tra email unique (app + DB level).
- Email System (Background Worker) phải đang hoạt động để xử lý job từ `background_jobs` queue.
- Department phải tồn tại, `is_active = true`, và chưa bị soft delete (`deleted_at IS NULL`).
- Mỗi role trong `roleIds` phải tồn tại, `is_active = true`.
--- 

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)

- `FR-ACCT-001`: THE system SHALL yêu cầu Manager/Admin có JWT Access Token hợp lệ trước khi cho phép truy cập API tạo tài khoản.
- `FR-ACCT-002`: THE system SHALL kiểm tra người dùng có permission `account.user.create` trước khi xử lý bất kỳ business logic nào.
- `FR-ACCT-003`: THE system SHALL hash temporary password bằng bcrypt/argon2 trước khi lưu vào `users.password_hash`.
- `FR-ACCT-004`: THE system SHALL set `users.must_change_password = true` cho mọi tài khoản mới được tạo qua tính năng này.
- `FR-ACCT-005`: THE system SHALL set `users.account_status = active` cho mọi tài khoản mới.
- `FR-ACCT-006`: THE system SHALL set `users.employment_status = active` cho mọi tài khoản mới.
- `FR-ACCT-007`: THE system SHALL NOT trả về temporary password hoặc password hash trong API response.
- `FR-ACCT-008`: THE system SHALL NOT lưu temporary password dưới dạng plain text trong database, log, audit log, hoặc bất kỳ persistent storage nào.
- `FR-ACCT-009`: THE system SHALL đảm bảo `users.email` là unique (application-level pre-check + DB unique constraint), so sánh case-insensitive.

### 3.2 Event-driven Requirements

- `FR-ACCT-010`: WHEN Manager/Admin gửi request `POST /api/v1/users` với dữ liệu hợp lệ, THE system SHALL thực hiện tuần tự: kiểm tra JWT -> kiểm tra permission -> validate body -> trim+lowercase email -> kiểm tra email unique (app pre-check) -> kiểm tra department -> kiểm tra roles -> kiểm tra employeeCode unique (nếu có) -> sinh temporary password -> hash password -> tạo user -> gán roles -> tạo background_job email queue -> ghi audit log (cùng transaction) -> commit -> trả về 201.
- `FR-ACCT-011`: WHEN request body hợp lệ và email chưa tồn tại, THE system SHALL kiểm tra `departmentId` có tồn tại, `is_active = true`, và `deleted_at IS NULL`.
- `FR-ACCT-012`: WHEN department hợp lệ, THE system SHALL kiểm tra từng roleId trong `roleIds` có tồn tại và `is_active = true`.
- `FR-ACCT-013`: WHEN tất cả kiểm tra hợp lệ, THE system SHALL sinh temporary password an toàn đáp ứng policy: tối thiểu 12 ký tự, có chữ hoa, chữ thường, chữ số và ký tự đặc biệt.
- `FR-ACCT-014`: WHEN user được tạo thành công trong DB, THE system SHALL gán tất cả role từ `roleIds` vào bảng `user_roles` với `assigned_by` là ID người tạo.
- `FR-ACCT-015`: WHEN user và roles đã được gán thành công, THE system SHALL tạo bản ghi `background_jobs` (job_type: `send_email`) trong cùng DB transaction với user creation để gửi credential email đến địa chỉ email của nhân viên. Async-only, không gọi SMTP trực tiếp.
- `FR-ACCT-016`: WHEN user creation + email queue hoàn tất trong cùng transaction, THE system SHALL ghi một bản ghi `audit_logs` với action `ACCOUNT_CREATE`, entity_type = `users`, entity_id = user.id, và các thông tin liên quan. Tuyệt đối không chứa temporary password hoặc password hash.
- `FR-ACCT-017`: WHEN request có `email`, THE system SHALL set `users.username = lower(email)`. Không dùng prefix trước @.
- `FR-ACCT-018`: THE system SHALL trim và lowercase email trước khi validation và trước khi persist vào DB.

### 3.3 State-driven Requirements

- `FR-ACCT-019`: WHILE tài khoản mới đang ở trạng thái `active` với `must_change_password = true`, THE system SHALL từ chối mọi API nghiệp vụ (trừ `/auth/change-password`, `/auth/me`, `/auth/logout`) cho đến khi người dùng đổi mật khẩu thành công.
- `FR-ACCT-020`: WHILE department đang `is_active = false` hoặc đã bị soft delete (`deleted_at IS NOT NULL`), THE system SHALL từ chối gán department đó cho tài khoản mới.
- `FR-ACCT-021`: WHILE role đang `is_active = false`, THE system SHALL từ chối gán role đó cho tài khoản mới.
- `FR-ACCT-022`: WHILE directManagerId tồn tại nhưng manager user `account_status = inactive` hoặc `employment_status = resigned` hoặc `deleted_at IS NOT NULL`, THE system SHALL từ chối request và trả về HTTP 422.

### 3.4 Optional Feature Requirements

- `FR-ACCT-023`: WHERE request có cung cấp `employeeCode`, THE system SHALL kiểm tra employeeCode unique (application pre-check + DB unique constraint). Nếu trùng, trả 409 `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS`.
- `FR-ACCT-024`: WHERE request có cung cấp `directManagerId`, THE system SHALL kiểm tra manager user tồn tại và `account_status = active`. Nếu không tồn tại, trả 404. Nếu inactive/resigned/deleted, trả 422.
- `FR-ACCT-025`: WHERE request có cung cấp `phoneNumber`, THE system SHALL trim, validate format (chỉ digits, spaces, plus, hyphen, parentheses, tối đa 30 ký tự), trả 400 nếu invalid.
- `FR-ACCT-026`: WHERE request có cung cấp `username`, THE system SHALL bỏ qua — username luôn là `lower(email)` cho feature này.

### 3.5 Unwanted Behavior Requirements

- `FR-ACCT-027`: IF request không có JWT hoặc JWT không hợp lệ/hết hạn, THEN THE system SHALL từ chối request và trả về HTTP 401.
- `FR-ACCT-028`: IF người dùng có JWT hợp lệ nhưng không có permission `account.user.create`, THEN THE system SHALL từ chối request và trả về HTTP 403.
- `FR-ACCT-029`: IF request body thiếu một hoặc nhiều trường bắt buộc (`fullName`, `email`, `departmentId`, `roleIds`), THEN THE system SHALL từ chối request và trả về HTTP 400 kèm field-level validation errors (E1).
- `FR-ACCT-030`: IF `email` không đúng định dạng email cơ bản (practical validation), THEN THE system SHALL từ chối request và trả về HTTP 400 (E1).
- `FR-ACCT-031`: IF `email` đã tồn tại (app pre-check HOẶC DB unique constraint violation race condition), THEN THE system SHALL trả về HTTP 409 với mã lỗi `ACCOUNT_EMAIL_ALREADY_EXISTS` (E2). Không retry.
- `FR-ACCT-032`: IF `departmentId` không tồn tại trong bảng `departments`, THEN THE system SHALL trả về HTTP 404 (E3a).
- `FR-ACCT-033`: IF `departmentId` tồn tại nhưng `is_active = false` hoặc `deleted_at IS NOT NULL`, THEN THE system SHALL trả về HTTP 422 với mã lỗi `DEPARTMENT_INACTIVE_OR_DELETED` (E3b).
- `FR-ACCT-034`: IF bất kỳ `roleId` nào không tồn tại trong bảng `roles`, THEN THE system SHALL trả về HTTP 404 với mã lỗi `ROLE_NOT_FOUND` (E4a).
- `FR-ACCT-035`: IF bất kỳ `roleId` nào tồn tại nhưng `is_active = false`, THEN THE system SHALL trả về HTTP 422 với mã lỗi `ROLE_INACTIVE` (E4b).
- `FR-ACCT-036`: IF `roleIds` là mảng rỗng, THEN THE system SHALL trả về HTTP 422 với mã lỗi `ROLE_IDS_EMPTY` (BR5).
- `FR-ACCT-037`: IF quá trình tạo `background_jobs` thất bại trong transaction, THEN THE system SHALL rollback toàn bộ transaction (user, roles, audit) và trả về HTTP 500 (E7, BR10).
- `FR-ACCT-038`: IF quá trình ghi `audit_logs` thất bại, THEN THE system SHALL ghi lỗi vào application logs và vẫn giữ kết quả tạo tài khoản (non-blocking audit, E8).
- `FR-ACCT-039`: IF `employeeCode` được cung cấp nhưng đã tồn tại, THEN THE system SHALL trả về HTTP 409 với mã lỗi `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS`.
- `FR-ACCT-040`: IF `phoneNumber` được cung cấp nhưng chứa ký tự không hợp lệ, THEN THE system SHALL trả về HTTP 400.
- `FR-ACCT-041`: IF `username` (lower(email)) bị unique constraint violation ở DB, THEN THE system SHALL map sang HTTP 409 với mã lỗi `ACCOUNT_USERNAME_ALREADY_EXISTS`.

### 3.6 Complex / Combined Requirements

- `FR-ACCT-042`: WHILE tài khoản đang được tạo trong single DB transaction, WHEN bất kỳ bước nào thất bại, THEN THE system SHALL rollback toàn bộ transaction (E7).
- `FR-ACCT-043`: WHERE email queue không thể được tạo, WHILE transaction chưa commit, THEN THE system SHALL rollback toàn bộ. Không direct-send email.

### 3.7 Authorization Requirements

- `FR-ACCT-044`: IF người dùng không có JWT hợp lệ, THEN THE system SHALL trả về HTTP 401.
- `FR-ACCT-045`: IF người dùng không có permission `account.user.create`, THEN THE system SHALL trả về HTTP 403.
- `FR-ACCT-046`: WHEN người dùng tạo tài khoản, THE system SHALL lấy `userId` từ JWT để ghi `created_by`, `assigned_by`, `requested_by`, và `user_id` của audit.

### 3.8 Data & State Requirements

- `FR-ACCT-047`: WHEN user được tạo thành công, THE system SHALL persist: `id`, `email` (lowercase, trimmed), `username` (lower(email)), `password_hash`, `full_name`, `department_id`, `account_status = active`, `employment_status = active`, `must_change_password = true`, `created_by`, `created_at`.
- `FR-ACCT-048`: WHEN user được tạo, THE system SHALL ghi `created_by` từ JWT.
- `FR-ACCT-049`: IF request chứa field không hợp lệ/không tồn tại trong DTO, THEN THE system SHALL trả về HTTP 400.

### 3.9 Notification / Audit / Email Content Requirements

- `FR-ACCT-050`: WHEN user + email queue tạo thành công, THE system SHALL tạo `audit_logs` với `action_type = ACCOUNT_CREATE`, `entity_type = users`, `entity_id = ID user`, `user_id = ID người tạo`, `new_value_json` (không password hash/temp password), `ip_address`, `user_agent`, `request_id`, `severity = info`.
- `FR-ACCT-051`: IF audit log thất bại, THEN THE system SHALL ghi lỗi vào app logs, không rollback user (non-blocking audit, v1 default).
- `FR-ACCT-052`: THE system SHALL NOT chứa temporary password hoặc password hash trong `audit_logs`.
- `FR-ACCT-053`: WHERE `background_jobs` tạo thành công, THE system SHALL ghi `input_json` với nội dung credential email: employee full name, login email/username, temporary password, yêu cầu đổi mật khẩu lần đầu, security notice. KHÔNG gồm: password hash, role IDs, JWT tokens, sensitive internal metadata.
- `FR-ACCT-054`: WHERE `background_jobs` không thể tạo (lỗi DB), THEN THE system SHALL rollback toàn bộ transaction.

### 3.10 Requirement Notes

- `roleIds` không được rỗng (BR5). Mọi tài khoản phải có >=1 role.
- Temporary password chỉ tồn tại trong runtime để hash+lưu và gửi trong email. Không lưu raw ở bất cứ đâu.
- Email credential delivery là async-only qua `background_jobs`. Không gọi SMTP trong request handler.
- Single DB transaction: tạo user -> gán roles -> tạo email queue -> audit log. Fail -> rollback.
- Username luôn = `lower(email)`. Feature này không chấp nhận custom username.
- EmployeeCode là optional; nếu cung cấp phải unique (app + DB enforcement).
- PhoneNumber optional; nếu cung cấp: validate format basic, max 30 ký tự.
- DirectManagerId optional; nếu cung cấp: validate tồn tại (404) và active (422). Không enforce same-department.
- Email validation: practical/basic, không RFC 5322. Trim + lowercase trước validate.

### 3.11 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case | Ghi chú |
|---|---|---|---|
| FR-ACCT-001 | Ubiquitous | UC-06 Auth step | JWT required |
| FR-ACCT-002 | Ubiquitous | UC-06 Permission | account.user.create |
| FR-ACCT-003 | Ubiquitous | AGENTS.md Database rule | Hash password |
| FR-ACCT-004 | Ubiquitous | UC-06 must_change_password | BR8 |
| FR-ACCT-005 | Ubiquitous | UC-06 account_status | BR9 |
| FR-ACCT-006 | Ubiquitous | UC-06 employment_status | Default active |
| FR-ACCT-007 | Ubiquitous | UC-06 Response safety | BR12 |
| FR-ACCT-008 | Ubiquitous | UC-06 No raw password | BR7 |
| FR-ACCT-009 | Ubiquitous | UC-06 Email unique | BR1 |
| FR-ACCT-010 | Event-driven | UC-06 Normal Flow | Main flow |
| FR-ACCT-011 | Event-driven | UC-06 Department check | BR3 |
| FR-ACCT-012 | Event-driven | UC-06 Role check | BR4 |
| FR-ACCT-013 | Event-driven | UC-06 Password gen | BR6 |
| FR-ACCT-014 | Event-driven | UC-06 Role assign | Normal flow |
| FR-ACCT-015 | Event-driven | UC-06 Email queue | Clarified: async-only, single tx |
| FR-ACCT-016 | Event-driven | UC-06 Audit log | BR11 |
| FR-ACCT-017 | Event-driven | UC-06 Username | Clarified: lower(email) |
| FR-ACCT-018 | Ubiquitous | UC-06 Email normalize | Clarified: trim+lowercase |
| FR-ACCT-019 | State-driven | must_change_password guard | BR |
| FR-ACCT-020 | State-driven | E3b Inactive dept | BR3 |
| FR-ACCT-021 | State-driven | E4b Inactive role | BR4 |
| FR-ACCT-022 | State-driven | Manager inactive | Clarified Q8 |
| FR-ACCT-023 | Optional | employeeCode | Clarified Q5 |
| FR-ACCT-024 | Optional | directManagerId | Clarified Q8 |
| FR-ACCT-025 | Optional | phoneNumber | Clarified Q7 |
| FR-ACCT-026 | Optional | username override | Clarified Q6: force lower(email) |
| FR-ACCT-027 | Unwanted | E5 No auth | 401 |
| FR-ACCT-028 | Unwanted | E6 No permission | 403 |
| FR-ACCT-029 | Unwanted | E1 Missing fields | 400 |
| FR-ACCT-030 | Unwanted | E1 Invalid email | Clarified Q4: practical |
| FR-ACCT-031 | Unwanted | E2 Duplicate email | Clarified Q3: app+DB, 409 |
| FR-ACCT-032 | Unwanted | E3a Dept not found | 404 |
| FR-ACCT-033 | Unwanted | E3b Dept inactive | 422 |
| FR-ACCT-034 | Unwanted | E4a Role not found | 404 |
| FR-ACCT-035 | Unwanted | E4b Role inactive | 422 |
| FR-ACCT-036 | Unwanted | BR5 Empty roleIds | 422 |
| FR-ACCT-037 | Unwanted | E7 Email queue fail | Clarified Q1+Q2: rollback |
| FR-ACCT-038 | Unwanted | E8 Audit fail | Non-blocking |
| FR-ACCT-039 | Unwanted | EmployeeCode dup | Clarified Q5: 409 |
| FR-ACCT-040 | Unwanted | Phone invalid | Clarified Q7: 400 |
| FR-ACCT-041 | Unwanted | Username collision | Clarified Q6: 409 |
| FR-ACCT-042 | Complex | E7 Single tx rollback | Clarified Q2 |
| FR-ACCT-043 | Complex | E7 No direct email | Clarified Q1 |
| FR-ACCT-044 | Authorization | Auth check | 401 |
| FR-ACCT-045 | Authorization | Permission check | 403 |
| FR-ACCT-046 | Authorization | Audit user tracking | JWT userId |
| FR-ACCT-047 | Data | Required fields | lower(email) username |
| FR-ACCT-048 | Data | created_by | JWT userId |
| FR-ACCT-049 | Data | Invalid fields | 400 |
| FR-ACCT-050 | Notif/Audit | Audit log | ACCOUNT_CREATE |
| FR-ACCT-051 | Notif/Audit | Audit fail | Non-blocking |
| FR-ACCT-052 | Notif/Audit | No password in audit | Security |
| FR-ACCT-053 | Integration | Email content | Clarified Q9 |
| FR-ACCT-054 | Integration | Email queue fail | Rollback |

--- 

## 4. Non-functional Requirements

### 4.1 Performance

- `NFR-ACCT-001`: THE system SHALL respond to `POST /api/v1/users` within 5 seconds under normal load (bao gồm DB writes + background_jobs creation).
- `NFR-ACCT-002`: THE system SHALL support at least 5 concurrent account creation requests without degradation.

### 4.2 Security

- `NFR-ACCT-003`: THE system SHALL require JWT Bearer token authentication.
- `NFR-ACCT-004`: THE system SHALL enforce `account.user.create` permission via PermissionGuard.
- `NFR-ACCT-005`: THE system SHALL NOT expose `password_hash`, `temporaryPassword`, or any sensitive data in API response.
- `NFR-ACCT-006`: THE system SHALL hash temporary password bằng bcrypt (cost factor >= 10) hoặc argon2.
- `NFR-ACCT-007`: IF request body chứa raw password từ client, THEN THE system SHALL reject request.

### 4.3 Reliability & Consistency

- `NFR-ACCT-008`: THE system SHALL dùng single DB transaction để đảm bảo atomicity: tạo user -> gán roles -> tạo background_job -> ghi audit log. Fail bất kỳ bước nào -> rollback toàn bộ.
- `NFR-ACCT-009`: THE system SHALL NOT tạo user nếu email credential không thể queue (background_jobs creation fail).
- `NFR-ACCT-010`: THE system SHALL enforce unique constraint trên `users.email` ở cả application level (pre-check SELECT) và DB level (unique constraint/index). DB constraint là final protection cho race condition.

### 4.4 Usability

- `NFR-ACCT-011`: THE system SHALL return clear, user-friendly error messages.
- `NFR-ACCT-012`: THE system SHALL return field-level validation errors (`details`) khi request body không hợp lệ.

### 4.5 Observability

- `NFR-ACCT-013`: THE system SHALL log mọi lỗi xử lý (requestId, userId, action) nhưng không log password/token.
- `NFR-ACCT-014`: THE system SHALL record audit log cho mọi hành động tạo tài khoản thành công.
- `NFR-ACCT-015`: WHEN audit log writing fails, THE system SHALL record the failure trong app logs với severity `error`.

### 4.6 Maintainability

- `NFR-ACCT-016`: THE system SHALL keep account creation logic trong module `accounts`.
- `NFR-ACCT-017`: THE system SHALL cung cấp unit test cho: success flow, validation failures, auth failures, duplicate email, duplicate employeeCode, username collision, invalid dept, invalid roles, phone validation, directManagerId errors, email queue failure.

--- 

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `users` | Tạo tài khoản nhân viên mới | Bảng chính |
| `departments` | Kiểm tra department hợp lệ | Chỉ đọc |
| `roles` | Kiểm tra roles hợp lệ | Chỉ đọc |
| `user_roles` | Gán role cho user mới | Tạo N bản ghi |
| `audit_logs` | Ghi log hành động | 1 bản ghi |
| `background_jobs` | Queue gửi email credential | 1 bản ghi, job_type: `send_email` |
| `notifications` | (Optional) Notification in-app | Không bắt buộc v1 |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `fullName` | string (max 255) | Có | Họ và tên nhân viên | Required, maxLength 255 |
| `email` | string (max 255) | Có | Email định danh tài khoản | Required, email format (practical), maxLength 255. Trim + lowercase trước validate |
| `departmentId` | UUID | Có | ID phòng ban | Required, phải tồn tại, active, không soft delete |
| `roleIds` | UUID[] | Có | Danh sách role IDs | Required, min 1 phần tử, mỗi role phải tồn tại + active |
| `employeeCode` | string (max 50) | Không | Mã nhân viên | Optional. Nếu có: unique (app+DB), maxLength 50 |
| `username` | string (max 100) | Không | Luôn được set = lower(email). Request không ảnh hưởng | Bỏ qua từ request |
| `phoneNumber` | string (max 30) | Không | Số điện thoại | Optional. Trim. Cho phép: digits, spaces, plus, hyphen, parentheses. Max 30. |
| `positionTitle` | string (max 150) | Không | Chức danh | Optional |
| `directManagerId` | UUID | Không | ID người quản lý trực tiếp | Optional. Nếu có: tồn tại (404), active/không resigned/không deleted (422) |

### 5.3 Dữ liệu đầu ra (API Response - 201 Created)

| Field | Type | Mô tả |
|---|---:|---|
| `id` | UUID | ID tài khoản mới |
| `employeeCode` | string/null | Mã nhân viên (nếu có) |
| `email` | string | Email tài khoản (lowercase, trimmed) |
| `fullName` | string | Họ và tên |
| `accountStatus` | string | `"active"` |
| `mustChangePassword` | boolean | `true` |
| `roles` | object[] | Danh sách role: `{ id, roleCode, roleName }` |
| `createdAt` | ISO-8601 | Thời điểm tạo |

**Lưu ý**: Response KHÔNG chứa `passwordHash`, `temporaryPassword`, hoặc bất kỳ thông tin nhạy cảm nào.

### 5.4 State / Status Model

| Entity | Status field | Giá trị khi tạo | Ghi chú |
|---|---|---|---|
| `users.account_status` | string | `"active"` | BR9 |
| `users.employment_status` | string | `"active"` | Default active |
| `users.must_change_password` | boolean | `true` | BR8 |

### 5.5 Data Constraints

- `users.email`: unique (app-level case-insensitive + DB unique constraint/index). Lowercase trước persist.
- `users.username`: unique (DB). Set = lower(email).
- `users.employee_code`: unique nếu có giá trị (DB unique constraint, nullable).
- `users.password_hash`: luôn lưu bcrypt/argon2 hash, không plain text.
- `users.department_id`: FK -> `departments.id`, ON DELETE SET NULL.
- `user_roles.user_id`: FK -> `users.id`, ON DELETE CASCADE.
- `user_roles.role_id`: FK -> `roles.id`, ON DELETE CASCADE.
- `roleIds`: tối thiểu 1 phần tử (BR5).
- `audit_logs`: không chứa temporary password hoặc password hash.
- `phoneNumber`: chỉ digits, spaces, plus, hyphen, parentheses.
- `email`: trim + lowercase trước persist.

### 5.6 Data Lifecycle

- **Tạo**: Khi Manager/Admin submit request tạo tài khoản thành công.
- **Cập nhật**: Không áp dụng — feature này chỉ tạo mới.
- **Xóa mềm**: Soft delete `users.deleted_at` (feature riêng).
- **Audit**: `audit_logs` tạo ngay khi tạo account thành công.

### 5.7 Data-related EARS Requirements

- `FR-DATA-001`: WHEN user được tạo, THE system SHALL persist `id`, `email` (lowercase), `username` (lower(email)), `password_hash`, `full_name`, `department_id`, `account_status = active`, `employment_status = active`, `must_change_password = true`, `created_by`, `created_at`.
- `FR-DATA-002`: WHEN user được tạo, THE system SHALL tạo N bản ghi `user_roles` với `user_id`, `role_id`, `assigned_by`, `assigned_at`, `is_active = true`.
- `FR-DATA-003`: IF `departmentId` không tồn tại, THEN THE system SHALL reject request.
- `FR-DATA-004`: IF `email` đã tồn tại (app hoặc DB), THEN THE system SHALL reject với HTTP 409 `ACCOUNT_EMAIL_ALREADY_EXISTS`.
- `FR-DATA-005`: IF `employeeCode` đã tồn tại (app hoặc DB), THEN THE system SHALL reject với HTTP 409 `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS`.

--- 

## 6. Error Handling

### 6.1 Validation Errors (E1)

- `ERR-ACCT-001`: IF `fullName` missing/empty, THEN 400 `VALIDATION_ERROR`.
- `ERR-ACCT-002`: IF `email` missing/empty/invalid format (practical), THEN 400 `VALIDATION_ERROR`.
- `ERR-ACCT-003`: IF `departmentId` missing/invalid UUID, THEN 400 `VALIDATION_ERROR`.
- `ERR-ACCT-004`: IF `roleIds` missing/not array/empty, THEN:
  - Missing/not array: 400 `VALIDATION_ERROR`.
  - Empty array ([]): 422 `ROLE_IDS_EMPTY`.
- `ERR-ACCT-005`: IF `fullName` > 255, THEN 400 `VALIDATION_ERROR`.
- `ERR-ACCT-006`: IF `email` > 255, THEN 400 `VALIDATION_ERROR`.
- `ERR-ACCT-007`: IF `employeeCode` > 50, THEN 400.
- `ERR-ACCT-008`: IF `phoneNumber` chứa ký tự không hợp lệ hoặc > 30 ký tự, THEN 400.

### 6.2 Authentication / Authorization Errors

- `ERR-ACCT-009`: IF không JWT/JWT invalid/expired, THEN 401 Unauthorized (E5).
- `ERR-ACCT-010`: IF authenticated nhưng không có permission `account.user.create`, THEN 403 Forbidden (E6).

### 6.3 Business Rule Errors

- `ERR-ACCT-011`: IF `email` đã tồn tại (app pre-check hoặc DB constraint violation), THEN 409 `ACCOUNT_EMAIL_ALREADY_EXISTS` (E2).
- `ERR-ACCT-012`: IF `departmentId` không tồn tại, THEN 404 `DEPARTMENT_NOT_FOUND` (E3a).
- `ERR-ACCT-013`: IF department inactive/deleted, THEN 422 `DEPARTMENT_INACTIVE_OR_DELETED` (E3b).
- `ERR-ACCT-014`: IF `roleId` không tồn tại, THEN 404 `ROLE_NOT_FOUND` (E4a).
- `ERR-ACCT-015`: IF role inactive, THEN 422 `ROLE_INACTIVE` (E4b).
- `ERR-ACCT-016`: IF `employeeCode` đã tồn tại (app hoặc DB), THEN 409 `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS`.
- `ERR-ACCT-017`: IF `username` (lower(email)) unique constraint violation, THEN 409 `ACCOUNT_USERNAME_ALREADY_EXISTS`.
- `ERR-ACCT-018`: IF `directManagerId` không tồn tại, THEN 404 `MANAGER_NOT_FOUND`.
- `ERR-ACCT-019`: IF `directManagerId` inactive/resigned/deleted, THEN 422 `MANAGER_INACTIVE_OR_UNAVAILABLE`.

### 6.4 System Errors

- `ERR-ACCT-020`: IF background_jobs creation thất bại trong transaction, THEN rollback toàn bộ, 500 (E7).
- `ERR-ACCT-021`: IF audit_logs ghi thất bại, THEN log lỗi, vẫn trả 201 (non-blocking audit, E8).
- `ERR-ACCT-022`: IF lỗi hệ thống không xác định, THEN rollback (nếu đang mở transaction), 500.

### 6.5 Error Response Expectations

| Field | Mô tả |
|---|---|
| `success` | `false` |
| `message` | Thông báo lỗi tiếng Việt |
| `error.code` | Mã lỗi nội bộ (`ACCOUNT_EMAIL_ALREADY_EXISTS`, `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS`, `ACCOUNT_USERNAME_ALREADY_EXISTS`, `DEPARTMENT_NOT_FOUND`, `DEPARTMENT_INACTIVE_OR_DELETED`, `ROLE_NOT_FOUND`, `ROLE_INACTIVE`, `ROLE_IDS_EMPTY`, `MANAGER_NOT_FOUND`, `MANAGER_INACTIVE_OR_UNAVAILABLE`, `VALIDATION_ERROR`) |
| `error.details` | Field-level validation errors (nếu 400) |
| `timestamp` | ISO 8601 |
| `path` | API path |

--- 

## 7. Acceptance Criteria

### 7.1 Happy Path

- **AC-001: Tạo tài khoản thành công**:
  Given Manager/Admin có JWT hợp lệ và permission `account.user.create`, department hợp lệ, roles hợp lệ, email chưa tồn tại.
  When gửi request `POST /api/v1/users` với `fullName = "Nguyen Van A"`, `email = " NVA@Company.COM "`, `departmentId = <uuid>`, `roleIds = ["<uuid>"]`.
  Then:
  1. Xác thực JWT + permission - thành công.
  2. Body validation - hợp lệ.
  3. Email được trim + lowercase thành `"nva@company.com"`.
  4. Email unique check - chưa tồn tại.
  5. Department check - tồn tại, active.
  6. Roles check - tồn tại, active.
  7. Sinh temporary password (>=12 ký tự, complexity).
  8. Hash password bằng bcrypt.
  9. Tạo user với `username = "nva@company.com"`, `account_status = "active"`, `must_change_password = true`.
  10. Gán roles vào `user_roles`, `assigned_by = userId` người tạo.
  11. Tạo `background_jobs` (job_type: `send_email`) chứa credential email payload (cùng transaction).
  12. Ghi `audit_logs` action `ACCOUNT_CREATE` (cùng transaction).
  13. Commit transaction.
  14. Trả về HTTP 201 với dữ liệu user an toàn (không password).

- **AC-002: Username tự động = lower(email)**:
  Given email = `"NVA@Company.COM"`.
  When request thành công.
  Then `users.username` = `"nva@company.com"`.

### 7.2 Validation Cases

- **AC-003: Thiếu fullName**: Given request thiếu `fullName`. When gửi request. Then 400 + field error.
- **AC-004: Email sai định dạng**: Given email `"invalid"`. When gửi. Then 400.
- **AC-005: roleIds rỗng**: Given `roleIds = []`. When gửi. Then 422 `ROLE_IDS_EMPTY`.
- **AC-006: phoneNumber invalid**: Given `phoneNumber = "abc123!@#"`. When gửi. Then 400.

### 7.3 Authorization Cases

- **AC-007: Không có JWT**: Request không có Authorization header. Then 401.
- **AC-008: Thiếu permission**: JWT hợp lệ nhưng không có `account.user.create`. Then 403.

### 7.4 Business Rule Cases

- **AC-009: Email đã tồn tại (app check)**: Email `"nva@company.com"` đã tồn tại. Gửi request với email đó. Then 409 `ACCOUNT_EMAIL_ALREADY_EXISTS`.
- **AC-010: Email đã tồn tại (case-insensitive)**: Email `"nva@company.com"` đã tồn tại. Gửi với `"NVA@COMPANY.COM"`. Then 409.
- **AC-011: Email đã tồn tại (race condition - DB constraint)**: 2 request đồng thời với cùng email. App check cả 2 đều pass. Request thứ 2 fail DB constraint. Then 409 `ACCOUNT_EMAIL_ALREADY_EXISTS` (không 500).
- **AC-012: Department không tồn tại**: UUID không có trong DB. Then 404.
- **AC-013: Department inactive**: `is_active = false`. Then 422.
- **AC-014: Role không tồn tại**: RoleId không có trong DB. Then 404.
- **AC-015: Role inactive**: `is_active = false`. Then 422.
- **AC-016: EmployeeCode duplicate**: employeeCode đã tồn tại. Then 409 `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS`.
- **AC-017: Username collision (DB level)**: lower(email) trùng với username khác. Then 409 `ACCOUNT_USERNAME_ALREADY_EXISTS`.
- **AC-018: DirectManagerId không tồn tại**: UUID không có. Then 404 `MANAGER_NOT_FOUND`.
- **AC-019: DirectManagerId inactive**: manager inactive/resigned/deleted. Then 422 `MANAGER_INACTIVE_OR_UNAVAILABLE`.

### 7.5 Transaction & Email Cases

- **AC-020: Rollback khi email queue thất bại**: Không thể tạo `background_jobs`. Then rollback toàn bộ transaction. User không tồn tại. Trả về 500. Không trả "Thành công".
- **AC-021: Audit log được ghi**: User + email queue tạo thành công. Check `audit_logs` -> có `action_type = "ACCOUNT_CREATE"`. Không chứa password hash hay temporary password.

### 7.6 Security Cases

- **AC-022: Response không chứa sensitive data**: Response 201 không có `passwordHash`, `password_hash`, `temporaryPassword`, `tempPassword`, `secret`, `credential`, hoặc bất kỳ field nào chứa password.

### 7.7 Acceptance Criteria Traceability

| AC ID | Requirement | Test scenario |
|---|---|---|
| AC-001 | FR-ACCT-010..018 | Happy path end-to-end, email trim+lowercase, single tx |
| AC-002 | FR-ACCT-017 | Username = lower(email) |
| AC-003 | FR-ACCT-029, ERR-ACCT-001 | Missing field |
| AC-004 | FR-ACCT-030, ERR-ACCT-002 | Invalid email |
| AC-005 | FR-ACCT-036, ERR-ACCT-004 | Empty roleIds |
| AC-006 | FR-ACCT-040, ERR-ACCT-008 | Invalid phone |
| AC-007 | FR-ACCT-027, ERR-ACCT-009 | No JWT |
| AC-008 | FR-ACCT-028, ERR-ACCT-010 | No permission |
| AC-009 | FR-ACCT-031, ERR-ACCT-011 | Duplicate email exact |
| AC-010 | FR-ACCT-031, ERR-ACCT-011 | Duplicate email case-insensitive |
| AC-011 | FR-ACCT-031, NFR-ACCT-010 | Race condition DB constraint -> 409 |
| AC-012 | FR-ACCT-032, ERR-ACCT-012 | Dept not found |
| AC-013 | FR-ACCT-033, ERR-ACCT-013 | Dept inactive |
| AC-014 | FR-ACCT-034, ERR-ACCT-014 | Role not found |
| AC-015 | FR-ACCT-035, ERR-ACCT-015 | Role inactive |
| AC-016 | FR-ACCT-039, ERR-ACCT-016 | EmployeeCode duplicate |
| AC-017 | FR-ACCT-041, ERR-ACCT-017 | Username collision |
| AC-018 | FR-ACCT-024, ERR-ACCT-018 | Manager not found |
| AC-019 | FR-ACCT-022, FR-ACCT-024, ERR-ACCT-019 | Manager inactive |
| AC-020 | FR-ACCT-037, FR-ACCT-042, ERR-ACCT-020 | Email queue fail -> rollback |
| AC-021 | FR-ACCT-050, 052 | Audit log exists, no password |
| AC-022 | FR-ACCT-007, NFR-ACCT-005 | Response no sensitive data |

--- 

## 8. Out of Scope

- Không import Excel/bulk account (UC-05 riêng).
- Không self-registration/public register.
- Không quản lý role/permission/department CRUD.
- Không xóa/cập nhật/kích hoạt/vô hiệu hóa tài khoản.
- Không reset mật khẩu cho tài khoản đã tồn tại.
- Không gửi email notification loại khác ngoài credential email.
- Không trả raw temporary password trong API response.
- Không lưu raw temporary password trong DB, log, audit, response.
- Không tạo bảng mới ngoài 39 bảng Database v3.2 Compact.
- Không tích hợp AI, vector database, embedding pipeline.

### 8.1 Không triển khai trong feature này

- Không thêm bảng database mới, không thêm cột mới.
- Không tạo API update/delete/list/search account.
- Không tạo UI feature.
- Không tích hợp SMS notification.
- Không hỗ trợ multi-language.
- Không custom username từ request.

### 8.2 Có thể xem xét ở feature khác

- Import Excel (UC-05) - bulk account.
- Quản lý tài khoản - update/activate/deactivate/delete.
- Quản lý role & permission - CRUD.
- Quản lý department - CRUD.
- Email notification cho sự kiện khác.

### 8.3 Out-of-scope EARS Guardrails

- `OOS-001`: THE system SHALL NOT tạo bảng database mới.
- `OOS-002`: THE system SHALL NOT import Excel/bulk account.
- `OOS-003`: THE system SHALL NOT cho phép self-registration.
- `OOS-004`: THE system SHALL NOT trả password/AWS trong response.
- `OOS-005`: THE system SHALL NOT lưu temporary password plain text.
- `OOS-006`: THE system SHALL NOT tích hợp AI/vector/embedding.
- `OOS-007`: THE system SHALL NOT chấp nhận custom username từ request.
- `OOS-008`: THE system SHALL NOT gọi SMTP/Email Service trực tiếp trong request handler.

--- 

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Keyword EARS bằng tiếng Anh: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [x] Đã có Complex / Combined EARS Requirements.
- [x] Mỗi requirement có ID rõ ràng (`FR-ACCT-XXX`, `ERR-ACCT-XXX`, `NFR-ACCT-XXX`).
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm validation, auth, business rule, conflict, system errors.
- [x] Error requirements đã ưu tiên format `IF ... THEN THE system SHALL ...`.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [x] [NEEDS CLARIFICATION] đã được resolve toàn bộ (9 clarified, 0 pending).
