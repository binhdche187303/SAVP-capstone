# Feature Specification: T\u1ea1o th\u1ee7 c\u00f4ng ph\u00f2ng h\u1ecdp m\u1edbi

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tao spec lan dau cho UC-RM-01 Tao thu cong phong hop moi | Toan bo file |
| 2026-06-16 | Cập nhật giải quyết các câu hỏi clarify: roomName unique, capacity, roomCode format, layoutJson, data model, unique index, roomType | Toàn bộ file |

> File này dùng làm template cho Spec Kit / Codex CLI khi chạy `$speckit-specify`.
> Mục tiêu: tạo đặc tả tính năng rõ ràng, dễ kiểm tra, dễ chuyển tiếp sang plan/tasks/implementation.
>
> Ngôn ngữ chính: Tiếng Việt.
> Tuy nhiên, các câu **Functional Requirements**, **Error Requirements**, và các requirement quan trọng nên giữ nguyên keyword EARS bằng tiếng Anh để agent nhìn rõ cấu trúc, còn toàn bộ nội dung nghiệp vụ thì viết bằng tiếng Việt:
> `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
>
> Quy tắc quan trọng:
> - Spec tập trung vào **WHAT** và **WHY**, chưa đi sâu vào **HOW**.
> - Không tự ý thêm feature ngoài tài liệu nguồn.
> - Không tự ý thêm bảng database mới nếu chưa có yêu cầu rõ ràng.
> - Nếu thiếu thông tin, ghi vào cuối phần liên quan dưới dạng `Cần làm rõ`.
> - Functional Requirements phải viết theo phong cách **EARS Requirements**.
> - Mỗi requirement phải có mã định danh rõ ràng để trace về plan, task, test case.
> - Trong requirement cuối cùng, **không viết** `Hệ thống phải...`, `Khi...`, `Nếu...` làm cấu trúc chính. Hãy dùng keyword EARS tiếng Anh.

---

# Feature Specification: Tạo thủ công phòng họp mới

- **Feature ID**: ROOM-CREATE-001
- **Feature Name**: Tạo thủ công phòng họp mới
- **Module / Domain**: rooms
- **Created Date**: 2026-06-16
- **Status**: Draft
- **Source Documents**:
  - UC-RM-01 Tạo thủ công phòng họp mới (User Story / Use Case Description)
  - Database v3.2 Compact (39 tables) - `database_v3_2_compact_39_tables.md`
  - AGENTS.md - Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md - UC-56 Tạo phòng họp mới
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này phải ưu tiên viết theo EARS.
EARS giúp requirement rõ trigger, rõ điều kiện, rõ system response, dễ trace sang plan/task/test.

### EARS Keyword Rules

| Keyword | Vai trò | Khi nào dùng |
|---|---|---|
| `THE system SHALL` | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error | Ubiquitous Requirement |
| `WHEN` | Trigger/event xảy ra tại một thời điểm | Event-driven Requirement |
| `WHILE` | Hành vi đúng trong suốt một trạng thái | State-driven Requirement |
| `WHERE` | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại | Optional Feature Requirement |
| `IF ... THEN` | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn | Unwanted Behavior Requirement |

### Quy tắc viết câu EARS trong template này

```text
[Requirement ID]: [EARS keyword bằng tiếng Anh] [Nội dung điều kiện viết bằng tiếng Việt], THE system SHALL [Nội dung phản hồi viết bằng tiếng Việt].
```

Hoặc với lỗi/ngoại lệ:

```text
[Requirement ID]: IF [Nội dung lỗi/ngoại lệ viết bằng tiếng Việt], THEN THE system SHALL [Nội dung phản hồi viết bằng tiếng Việt].
```

Ví dụ mẫu:
- **Ubiquitous**: `THE system SHALL [Nội dung viết bằng tiếng việt]`
- **Event-driven**: `WHEN [Nội dung viết bằng tiếng việt], THE system SHALL [Nội dung viết bằng tiếng việt]`
- **State-driven**: `WHILE [Nội dung viết bằng tiếng việt], THE system SHALL [Nội dung viết bằng tiếng việt]`
- **Optional**: `WHERE [Nội dung viết bằng tiếng việt], THE system SHALL [Nội dung viết bằng tiếng việt]`
- **Unwanted Behavior**: `IF [Nội dung viết bằng tiếng việt], THEN THE system SHALL [Nội dung viết bằng tiếng việt]`

Quy tắc bắt buộc:

- BẮT BUỘC viết toàn bộ nội dung nghiệp vụ bên trong và sau các từ khóa bằng tiếng Việt để người dùng dễ đọc hiểu và kiểm soát nội dung, chỉ giữ các từ khóa cấu trúc EARS bằng tiếng Anh.
- Luôn có **một system response rõ ràng** sau `SHALL`.
- Không dùng từ mơ hồ như: nhanh, tốt, tiện lợi, tối ưu, thông minh nếu không có tiêu chí đo lường.
- Không gộp quá nhiều hành vi không liên quan vào cùng một requirement.
- Không mô tả chi tiết implementation như class, function, query SQL, ORM, thuật toán nội bộ nếu chưa cần.

---

## 0. EARS Requirement Patterns

### 0.1 Ubiquitous Requirement

Dùng cho yêu cầu luôn đúng trong mọi trường hợp, không cần trigger, không cần state, không cần option.

Format chuẩn:

```text
FR-XXX: THE system SHALL [mandatory behavior].
```

Ví dụ:

```text
FR-001: THE system SHALL store the creator user ID for every meeting created in the system.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-001: THE system SHALL lưu lại `created_by` cho mỗi cuộc họp được tạo mới.
```

Không nên viết:

```text
FR-001: Hệ thống phải lưu lại thông tin người tạo cuộc họp.
```

### 0.2 Event-driven Requirement

Dùng khi hệ thống phản ứng sau một event/trigger.

Format chuẩn:

```text
FR-XXX: WHEN [trigger/event occurs], THE system SHALL [system response].
```

Ví dụ:

```text
FR-002: WHEN a user submits a meeting creation request, THE system SHALL validate room availability for the requested time range.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-002: WHEN người dùng gửi yêu cầu tạo cuộc họp, THE system SHALL kiểm tra xung đột lịch của phòng họp được chọn.
```

### 0.3 State-driven Requirement

Dùng khi hành vi phải đúng trong suốt một trạng thái cụ thể.

Format chuẩn:

```text
FR-XXX: WHILE [state/precondition is true], THE system SHALL [system response].
```

Ví dụ:

```text
FR-003: WHILE a meeting is in `in_progress` status, THE system SHALL allow the host to end the meeting.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-003: WHILE cuộc họp đang ở trạng thái `in_progress`, THE system SHALL cho phép host kết thúc cuộc họp.
```

### 0.4 Optional Feature Requirement

Dùng khi requirement chỉ áp dụng nếu hệ thống có một capability, config, module, device, integration, hoặc feature flag cụ thể.

Format chuẩn:

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], THE system SHALL [system response].
```

Ví dụ:

```text
FR-004: WHERE recording is enabled for a room, THE system SHALL allow the host to start a recording session.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-004: WHERE phòng họp có thiết bị ghi âm được cấu hình, THE system SHALL cho phép host bắt đầu recording session.
```

### 0.5 Unwanted Behavior Requirement

Dùng cho lỗi, ngoại lệ, failure, dữ liệu không hợp lệ, quyền không hợp lệ, conflict, hoặc tình huống không mong muốn.

Format chuẩn:

```text
FR-XXX: IF [unwanted condition/error/failure occurs], THEN THE system SHALL [safe system response].
```

Ví dụ:

```text
FR-005: IF a user does not have permission to create meetings, THEN THE system SHALL reject the request without creating a meeting record.
```

Ví dụ tiếng Việt kết hợp keyword EARS:

```text
FR-005: IF người dùng không có quyền tạo cuộc họp, THEN THE system SHALL từ chối yêu cầu và không tạo bản ghi cuộc họp.
```

---

## 0.6 Complex / Combined EARS Requirements

Dùng khi requirement cần kết hợp nhiều điều kiện. Chỉ dùng complex requirement khi thật sự cần; nếu câu quá dài hoặc có nhiều hành vi khác nhau, hãy tách thành nhiều requirement nhỏ.

### 0.6.1 State + Event

Dùng khi event chỉ được xử lý trong một state cụ thể.

```text
FR-XXX: WHILE [state/precondition is true], WHEN [trigger occurs], THE system SHALL [system response].
```

Ví dụ:

```text
FR-006: WHILE a meeting is in `scheduled` status, WHEN the host starts the meeting, THE system SHALL change the meeting status to `in_progress`.
```

### 0.6.2 Optional Feature + Event

Dùng khi event chỉ áp dụng nếu optional feature/capability/config tồn tại.

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], WHEN [trigger occurs], THE system SHALL [system response].
```

Ví dụ:

```text
FR-007: WHERE room recording is enabled, WHEN the host starts recording, THE system SHALL create a recording session for the meeting.
```

### 0.6.3 Optional Feature + State

Dùng khi requirement chỉ đúng trong state cụ thể và chỉ áp dụng nếu optional feature tồn tại.

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], WHILE [state/precondition is true], THE system SHALL [system response].
```

Ví dụ:

```text
FR-008: WHERE live transcription is enabled, WHILE a meeting is in `in_progress` status, THE system SHALL collect transcript segments from the capture service.
```

### 0.6.4 Optional Feature + State + Event

Dùng khi requirement phụ thuộc cả optional feature, state, và trigger.

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], WHILE [state/precondition is true], WHEN [trigger occurs], THE system SHALL [system response].
```

Ví dụ:

```text
FR-009: WHERE room auto-release is enabled, WHILE a room booking is in `reserved` status, WHEN no participant checks in before the no-show threshold, THE system SHALL mark the booking as `no_show`.
```

### 0.6.5 State + Unwanted Behavior

Dùng khi lỗi/ngoại lệ chỉ cần xử lý trong một state cụ thể.

```text
FR-XXX: WHILE [state/precondition is true], IF [unwanted condition occurs], THEN THE system SHALL [safe system response].
```

Ví dụ:

```text
FR-010: WHILE a meeting is in `in_progress` status, IF the recording device becomes unavailable, THEN THE system SHALL keep the meeting active and record the device failure event.
```

### 0.6.6 Optional Feature + Unwanted Behavior

Dùng khi lỗi/ngoại lệ chỉ liên quan tới một optional feature/capability/config cụ thể.

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], IF [unwanted condition occurs], THEN THE system SHALL [safe system response].
```

Ví dụ:

```text
FR-011: WHERE face check-in is enabled, IF the face recognition service is unavailable, THEN THE system SHALL allow authorized manual check-in according to the attendance policy.
```

---

## 0.7 EARS Quality Checklist

Trước khi hoàn tất Functional Requirements, kiểm tra từng requirement:

- [ ] Có requirement ID rõ ràng, ví dụ `FR-001`.
- [ ] Có đúng keyword EARS phù hợp: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [ ] Có đúng một system chính: `THE system` hoặc tên component cụ thể nếu cần, ví dụ `THE auth module`.
- [ ] Có hành vi rõ ràng sau `SHALL`.
- [ ] Có thể viết test case để kiểm chứng.
- [ ] Không dùng từ mơ hồ nếu không có tiêu chí đo.
- [ ] Không trộn nhiều hành vi không liên quan trong cùng một requirement.
- [ ] Không tự thêm feature, bảng, field, integration ngoài tài liệu nguồn.

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng này thuộc module `rooms` - Room Management, cụ thể là khả năng khởi tạo không gian phòng họp mới vào hệ thống.

Khi công ty mở rộng văn phòng, tái cấu trúc không gian làm việc, hoặc cần bổ sung phòng họp mới, Business Admin cần có công cụ để đưa các không gian này vào danh mục phòng họp nội bộ. Sau khi được tạo thành công, phòng họp sẽ xuất hiện trong danh sách không gian chung và sẵn sàng tiếp nhận yêu cầu đặt lịch từ toàn bộ nhân sự trong tổ chức.

Tính năng này phục vụ giai đoạn **trước cuộc họp** (pre-meeting) trong meeting lifecycle: quản lý phòng họp là điều kiện tiên quyết để đặt lịch, kiểm tra xung đột và tổ chức cuộc họp.

Tài liệu nguồn tham khảo:
- API contract: UC-56 Tạo phòng họp mới (module `rooms`, bảng `rooms`)
- Database v3.2 Compact: bảng `rooms` - phòng họp
- AGENTS.md: Module Room Management (`/src/modules/rooms`)

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Business Admin tạo thủ công một phòng họp mới trong hệ thống với các thông tin định danh, vị trí, sức chứa và khả năng thiết bị đi kèm, nhằm đưa không gian phòng họp vào danh mục sử dụng chung ngay sau khi khởi tạo.

### 1.3 Giá trị mang lại

- **Business Admin**: có khả năng mở rộng danh mục phòng họp độc lập, không cần can thiệp kỹ thuật.
- **Quản trị hệ thống**: giảm tải thao tác tạo phòng thủ công qua database.
- **Vận hành phòng họp**: phòng mới lập tức sẵn sàng cho đặt lịch và sử dụng, tăng tính khả dụng của hệ thống.
- **Dữ liệu và báo cáo**: bổ sung phòng họp là bước nền cho thống kê sử dụng phòng sau này.

### 1.4 Giả định

- Phòng họp được tạo thủ công từng phòng một, không qua import hàng loạt.
- Business Admin đã có sẵn thông tin phòng họp cần tạo (mã phòng, tên phòng, sức chứa, v.v.).
- Hệ thống đã có sẵn danh sách equipment để liên kết nếu cần.
- `currentStatus` mặc định là `available` và `isActive` mặc định là `true` cho phòng mới tạo.

### 1.5 Clarification Decisions (Đã chốt)

- **roomName unique**: `roomName` SHALL be unique among non-deleted rooms (`deleted_at IS NULL`) using case-insensitive and trimmed comparison, regardless of `is_active`.
- **capacity validation**: Phải là số nguyên, từ 1 đến 1000. Trả lỗi 422 nếu sai.
- **roomCode format**: Bắt buộc, uppercase, length 3-80, regex `^[A-Z0-9]+(?:-[A-Z0-9]+)*$`.
- **layoutJson**: Thuộc scope feature khác, nếu gửi kèm trong request tạo phòng sẽ bị reject (422 UNSUPPORTED_FIELD).
- **Data Model**: Xác nhận bảng `rooms` đã có đủ các cột cần thiết (gồm cả các cột thiết bị và vị trí), không cần migration thêm cột.
- **Data Integrity**: Cần có DB-level partial unique index cho `roomName` để chống race condition.
- **roomType enum**: Gồm `meeting_room`, `training_room`, `board_room`, `open_space`. Mặc định là `meeting_room`.

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| **Business Admin** | Người tạo phòng họp mới thủ công | Có quyền `room.create`. Chịu trách nhiệm nhập đúng thông tin phòng. |
| **System Admin** | Có quyền tạo phòng nhưng không phải primary actor | Có quyền `room.create`. Thường can thiệp khi Business Admin không có mặt. |

### 2.2 Role & Permission Rules

- `BUSINESS_ADMIN` và `SYSTEM_ADMIN` có permission `room.create` và được phép tạo phòng họp.
- `INTERNAL_USER` và `MANAGER` không có `room.create`, không được phép tạo phòng họp.
- Permission check được thực hiện trước khi xử lý business logic.

### 2.3 Actor Constraints

- Người dùng phải được xác thực (có JWT access token hợp lệ).
- Người dùng phải có permission `room.create` thông qua role `BUSINESS_ADMIN` hoặc `SYSTEM_ADMIN`.
- Người dùng đang truy cập phân hệ Quản lý phòng họp (frontend).

## 3. Functional Requirements

> Tất cả Functional Requirements phải viết theo EARS.
> Mỗi requirement phải rõ ràng, kiểm thử được, không mơ hồ.
> Keyword EARS phải giữ bằng tiếng Anh.
> Nội dung nghiệp vụ có thể viết tiếng Việt.

### 3.1 Core Requirements

FR-001: THE system SHALL luu thong tin phong hop voi cac truong bat buoc: `roomCode`, `roomName`, `capacity`, `roomType` va `created_by` la user ID cua nguoi thuc hien yeu cau.

FR-002: THE system SHALL gan `currentStatus = 'available'` cho moi phong hop moi duoc tao.

FR-003: THE system SHALL gan `isActive = true` cho moi phong hop moi duoc tao.

FR-004: THE system SHALL ghi nhan `created_at` va `updated_at` la thoi diem hien tai (timestamptz) khi tao phong hop.

### 3.2 Event-driven Requirements

FR-005: WHEN Business Admin gui yeu cau tao phong hop voi du lieu hop le, THE system SHALL tao ban ghi moi trong bang `rooms` voi cac gia tri mac dinh theo business rule.

### 3.3 State-driven Requirements

FR-006: WHILE mot phong hop dang o trang thai `available` va `isActive = true`, THE system SHALL cho phep phong nay xuat hien trong danh sach tim kiem dat lich.

> Ghi chu: Feature nay chi tao phong moi voi cac gia tri mac dinh. Viec quan ly state transition thuoc feature khac.

### 3.4 Optional Feature Requirements

FR-007: WHERE `siteName`, `areaName`, hoac `locationDescription` duoc cung cap, THE system SHALL luu cac gia tri nay lam thong tin vi tri phong.

FR-008: WHERE `hasCamera`, `hasMicrophone`, `hasDisplay`, hoac `allowRecording` duoc cung cap, THE system SHALL luu cac gia tri boolean nay de mo ta kha nang thiet bi tich hop cua phong.

### 3.5 Unwanted Behavior Requirements

FR-009: IF `roomCode` sai format (không phải uppercase, length không thuộc 3..80, sai regex `^[A-Z0-9]+(?:-[A-Z0-9]+)*$`), THEN THE system SHALL tu choi yeu cau va tra ve loi validation `ROOM_CODE_INVALID_FORMAT` (HTTP 422).

FR-010: IF `roomCode` da ton tai trong bang `rooms` (ke ca ban ghi da bi soft delete), THEN THE system SHALL tu choi yeu cau va tra ve loi trung lap `ROOM_CODE_ALREADY_EXISTS` (HTTP 409).

FR-011: IF `roomName` da ton tai trong so cac phong chua bi xoa mem (`deleted_at IS NULL`, so sanh case-insensitive va trim), THEN THE system SHALL tu choi yeu cau va tra ve loi trung lap `ROOM_NAME_ALREADY_EXISTS` (HTTP 409).

FR-012: IF `capacity` khong phai so nguyen, hoac nam ngoai khoang 1..1000, THEN THE system SHALL tu choi yeu cau va tra ve loi validation `ROOM_CAPACITY_INVALID` (HTTP 422).

FR-012b: IF `roomType` khong thuoc enum (`meeting_room`, `training_room`, `board_room`, `open_space`), THEN THE system SHALL tu choi yeu cau va tra ve loi validation `INVALID_ROOM_TYPE` (HTTP 422).

FR-012c: IF request body chua field ngoai contract (vi du `layoutJson`), THEN THE system SHALL tu choi yeu cau va tra ve loi validation `UNSUPPORTED_FIELD` (HTTP 422).

### 3.6 Workflow Requirements

Khong ap dung -- feature nay la thao tac dong bo don gian, khong co workflow nhieu buoc.

### 3.7 Authorization Requirements

FR-013: IF the user is not authenticated, THEN THE system SHALL reject access to this feature.

FR-014: IF the user does not have `room.create` permission, THEN THE system SHALL reject the request without modifying any data.

FR-015: WHEN the user performs a protected action (tao phong), THE system SHALL verify authorization before processing business logic.

### 3.8 Data & State Requirements

FR-016: WHEN valid data is submitted, THE system SHALL persist the data voi `currentStatus = 'available'`, `isActive = true`, va gan `created_at`, `updated_at` la thoi diem hien tai.

FR-017: IF a required persistence operation fails, THEN THE system SHALL rollback the affected business operation va khong tao ban ghi phong.

### 3.9 Notification / Audit Requirements

FR-018: WHEN Business Admin tao phong hop thanh cong, THE system SHALL ghi audit log voi `action_type = 'create'`, `entity_type = 'room'`, `entity_id` la ID phong moi, va `new_value_json` chua thong tin phong vua tao.

FR-019: IF thao tac ghi audit log that bai, THEN THE system SHALL khong rollback viec tao phong, nhung ghi log loi vao he thong logging.

> Ghi chu: Feature nay khong yeu cau gui notification khi tao phong vi day la thao tac quan tri noi bo.

### 3.10 Integration / Device Requirements

Khong ap dung trong feature nay vi tao phong hop khong phu thuoc vao integration/device ben ngoai.

### 3.11 Complex / Combined Requirements

Khong ap dung trong feature nay vi tao phong hop la thao tac dong bo, don gian, khong co state machine phuc tap.

### 3.12 Requirement Notes

- Tat ca cac yeu cau FR trong spec nay deu la synchronous -- khong tao `background_jobs`.
- Khong yeu cau xu ly notification, khong kiem tra conflict booking, khong tao meeting trong feature nay.
- Viec kiem tra unique `roomName` duoc enforce o service-level va nen them partial unique index de chan race condition o cap DB.

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguon / Use Case lien quan | Ghi chu |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-RM-01 / UC-56 | Core -- luu thong tin phong |
| FR-002 | Ubiquitous | UC-RM-01 / Business Rule BR3 | Gan currentStatus mac dinh |
| FR-003 | Ubiquitous | UC-RM-01 / Business Rule BR4 | Gan isActive mac dinh |
| FR-004 | Ubiquitous | UC-RM-01 | Ghi timestamp |
| FR-005 | Event-driven | UC-RM-01 / Normal Flow step 7 | Xu ly tao phong |
| FR-006 | State-driven | UC-RM-01 / Postconditions | Phong available xuat hien trong danh sach |
| FR-007 | Optional Feature | UC-56 Request Body | Luu thong tin vi tri neu co |
| FR-008 | Optional Feature | UC-56 Request Body | Luu kha nang thiet bi neu co |
| FR-009 | Unwanted Behavior | UC-RM-01 | Validate roomCode format |
| FR-010 | Unwanted Behavior | UC-RM-01 / Exception E3 | Check duplicate roomCode |
| FR-011 | Unwanted Behavior | UC-RM-01 / Exception E4 | Check duplicate roomName |
| FR-012 | Unwanted Behavior | UC-RM-01 / Exception E2 | Validate capacity |
| FR-012b| Unwanted Behavior | UC-RM-01 / Exception E6 | Validate roomType |
| FR-012c| Unwanted Behavior | UC-RM-01 | Validate unsupported fields |
| FR-013 | Authorization | UC-RM-01 / Exception E5 | Unauthenticated |
| FR-014 | Authorization | UC-RM-01 / Exception E5 | Missing permission |
| FR-015 | Authorization | UC-RM-01 | Check auth truoc xu ly |
| FR-016 | Data & State | UC-RM-01 / Postconditions | Persist voi gia tri mac dinh |
| FR-017 | Data & State | UC-RM-01 / Reliability | Rollback neu persist loi |
| FR-018 | Audit | UC-RM-01 / Business Rule BR9 | Audit log khi tao phong |
| FR-019 | Audit | UC-RM-01 | Xu ly loi audit log khong anh huong tao phong |

## 4. Non-functional Requirements

> Non-functional Requirements cũng nên dùng `THE system SHALL` hoặc EARS conditional pattern nếu có điều kiện rõ ràng.

### 4.1 Performance

```text
NFR-001: THE system SHALL respond toi request tao phong hop trong vong 3 giay duoi tai binh thuong.
NFR-002: THE system SHALL ho tro it nhat 10 request tao phong dong thoi ma khong lam anh huong toi tinh nhat quan du lieu.
NFR-003: WHEN the request volume exceeds the supported threshold, THE system SHALL return a controlled error or throttling response according to project policy.
```

### 4.2 Security

```text
NFR-004: THE system SHALL require authentication before allowing access to protected feature data.
NFR-005: THE system SHALL enforce authorization for every operation that modifies business data.
NFR-006: THE system SHALL NOT expose unnecessary sensitive data in API responses.
NFR-007: IF a request contains invalid or expired credentials, THEN THE system SHALL reject the request.
```

### 4.3 Reliability & Consistency

```text
NFR-008: THE system SHALL prevent partial updates khi thao tac tao phong gap loi o buoc persist du lieu.
NFR-009: THE system SHALL dam bao rang neu viec tao phong thanh cong, ban ghi trong bang `rooms` co day du cac truong bat buoc va gia tri mac dinh.
NFR-010: IF the database connection fails during room creation, THEN THE system SHALL return an error and not create a partial record.
```

### 4.4 Usability

```text
NFR-011: THE system SHALL tra ve thong bao loi ro rang bang tieng Viet cho cac loi validation va business rule.
NFR-012: THE system SHALL dung field name va response format thong nhat theo convention cua du an (success/error format, pagination, error code).
```

### 4.5 Observability

```text
NFR-013: THE system SHALL log important processing errors for this feature.
NFR-014: THE system SHALL record audit logs for actions that affect important business data.
NFR-015: WHEN an integration or device error occurs, THE system SHALL record enough diagnostic information for troubleshooting.
```

### 4.6 Maintainability

```text
NFR-016: THE system SHALL keep business logic separated by the appropriate module/domain boundary.
NFR-017: THE system SHALL provide test cases for success flows, validation failures, authorization failures, and major business rule failures.
```

---

## 5. Data Model

> Phần này mô tả dữ liệu ở mức nghiệp vụ.
> Không tự ý thêm bảng mới nếu database baseline chưa có.
> Nếu cần bảng/cột mới, phải ghi rõ là đề xuất và đưa vào `Cần làm rõ`.

### 5.1 Entity liên quan
### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `rooms` | Bảng chính lưu thông tin phòng họp được tạo | Bắt buộc. Feature này tạo bản ghi trong bảng này. |
| `audit_logs` | Ghi nhật ký kiểm toán cho hành động tạo phòng | Bắt buộc ghi audit log khi tạo thành công. |
| `equipments` | Thiết bị phòng - optional | Không tạo mới equipment trong feature này. |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `roomCode` | string (max 80) | Có | Mã phòng, định danh kỹ thuật ổn định. | Length 3..80, Regex `^[A-Z0-9]+(?:-[A-Z0-9]+)*$`, uppercase. Unique. |
| `roomName` | string (max 255) | Có | Tên phòng hiển thị cho người dùng. | Unique among `deleted_at IS NULL` (case-insensitive, trimmed). |
| `siteName` | string (max 255) | Không | Tòa nhà/cơ sở. | -- |
| `areaName` | string (max 255) | Không | Tầng/khu vực. | -- |
| `locationDescription` | text | Không | Mô tả vị trí phòng chi tiết. | -- |
| `capacity` | integer | Có | Sức chứa tối đa (số người). | Phải là số nguyên, khoảng 1..1000. |
| `roomType` | string (max 50) | Không | Loại phòng. | Enum: `meeting_room`, `training_room`, `board_room`, `open_space`. Default: `meeting_room`. |
| `hasCamera` | boolean | Không | Phòng có camera tích hợp. Mặc định false. | -- |
| `hasMicrophone` | boolean | Không | Phòng có microphone tích hợp. Mặc định false. | -- |
| `hasDisplay` | boolean | Không | Phòng có màn hình hiển thị tích hợp. Mặc định false. | -- |
| `allowRecording` | boolean | Không | Cho phép ghi âm/ghi hình. Mặc định false. | -- |

*(Lưu ý: `layoutJson` không thuộc request body của tính năng này. Nếu truyền lên sẽ bị reject).*

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `id` | uuid | ID phòng họp mới tạo. |
| `roomCode` | string | Mã phòng vừa tạo. |
| `roomName` | string | Tên phòng vừa tạo. |
| `capacity` | integer | Sức chứa phòng. |
| `currentStatus` | string | `"available"` - trạng thái mặc định. |
| `isActive` | boolean | `true` - phòng được kích hoạt mặc định. |
| `createdAt` | timestamptz | Thời điểm tạo phòng. |

### 5.4 State / Status Model

| Status | Ý nghĩa | Ghi chú |
|---|---|---|
| `available` | Phòng sẵn sàng cho đặt lịch. | Chỉ có trạng thái này. Feature không xử lý chuyển trạng thái. |

### 5.5 Data Constraints

- Bảng `rooms` đã có sẵn các cột cần thiết, không cần migration thêm cột.
- `room_code` UNIQUE (DB constraint).
- `room_name` phải unique trong phạm vi các phòng chưa bị soft-delete. Đề xuất tạo partial unique index:
  ```sql
  CREATE UNIQUE INDEX ux_rooms_room_name_not_deleted
  ON rooms (lower(btrim(room_name)))
  WHERE deleted_at IS NULL;
  ```
  Nếu có unique violation từ DB, map lỗi thành `ROOM_NAME_ALREADY_EXISTS` (HTTP 409).
- `capacity` integer, từ 1 đến 1000.
- `created_by` và `updated_by` là FK tới `users.id` (nullable, ghi user ID người tạo).
- Soft delete (`deleted_at`) được hỗ trợ.


### 5.6 Data Lifecycle

- **Tạo**: Khi Business Admin gửi yêu cầu POST `/api/v1/rooms` với dữ liệu hợp lệ.
- **Cập nhật**: Feature này không xử lý update. Thuộc UC-RM-02 (Cập nhật phòng họp).
- **Xóa mềm**: Feature này không xử lý delete. Thuộc feature khác.
- **Sử dụng cho báo cáo/audit**: Dữ liệu phòng được dùng cho module `analytics` sau này. Audit log ghi lại khi tạo phòng.

### 5.7 Data-related EARS Requirements

FR-DATA-001: WHEN a new room is created, THE system SHALL persist day du cac truong bat buoc bao gom `room_code`, `room_name`, `capacity`, `room_type`, `current_status`, `is_active`, `created_by`, `created_at`, `updated_at`.

FR-DATA-002: IF `roomCode` da ton tai trong bang `rooms`, THEN THE system SHALL reject the request va tra ve ma loi `ROOM_CODE_ALREADY_EXISTS` (HTTP 409).

FR-DATA-003: IF `roomName` da ton tai trong so cac phong `deleted_at IS NULL`, THEN THE system SHALL reject the request va tra ve ma loi `ROOM_NAME_ALREADY_EXISTS` (HTTP 409).

FR-DATA-004: IF `capacity` khong phai so nguyen thuoc khoang 1..1000, THEN THE system SHALL reject the request va tra ve loi validation `ROOM_CAPACITY_INVALID`.


---

## 6. Error Handling

> Error requirements nên dùng `IF ... THEN THE system SHALL ...` để đúng EARS Unwanted Behavior Pattern.

### 6.1 Validation Errors

ERR-001: IF `roomCode` is missing, THEN THE system SHALL reject the request va tra ve loi validation `ROOM_CODE_REQUIRED` (HTTP 400).

ERR-001b: IF `roomCode` sai format/length, THEN THE system SHALL reject the request va tra ve loi validation `ROOM_CODE_INVALID_FORMAT` (HTTP 422).

ERR-002: IF `roomName` is missing, THEN THE system SHALL reject the request va tra ve loi validation `ROOM_NAME_REQUIRED` (HTTP 400).

ERR-003: IF `capacity` is missing, THEN THE system SHALL reject the request va tra ve loi validation `ROOM_CAPACITY_INVALID` (HTTP 400).

ERR-004: IF `capacity` khong phai so nguyen, hoac ngoai khoang 1..1000, THEN THE system SHALL reject the request va tra ve loi validation `ROOM_CAPACITY_INVALID` (HTTP 422).

ERR-005: IF `roomType` khong nam trong enum cho phep, THEN THE system SHALL reject the request va tra ve loi validation `INVALID_ROOM_TYPE` (HTTP 422).

ERR-005b: IF request gui len field nam ngoai API contract (nhu `layoutJson`), THEN THE system SHALL reject the request va tra ve loi validation `UNSUPPORTED_FIELD` (HTTP 422).

### 6.2 Authentication / Authorization Errors

ERR-006: IF the user is not authenticated, THEN THE system SHALL tra ve loi xac thuc (HTTP 401).

ERR-007: IF the user does not have `room.create` permission, THEN THE system SHALL tra ve loi phan quyen (HTTP 403).

### 6.3 Business Rule Errors

ERR-008: IF `roomCode` da ton tai, THEN THE system SHALL tra ve loi trung lap (HTTP 409) voi ma loi `ROOM_CODE_ALREADY_EXISTS`.

ERR-009: IF `roomName` da ton tai trong so phong `deleted_at IS NULL` (ca active va inactive), THEN THE system SHALL tra ve loi trung lap (HTTP 409) voi ma loi `ROOM_NAME_ALREADY_EXISTS` (bao gom ca truong hop DB tra ve unique constraint violation).

### 6.4 Conflict Errors

Khong ap dung -- tao phong hop khong kiem tra conflict booking/lich.

### 6.5 Integration / Device / External Service Errors

Khong ap dung -- tao phong khong phu thuoc vao integration/device ben ngoai.

### 6.6 Error Response Expectations

Response lỗi nên có tối thiểu:

| Field | Mô tả |
|---|---|
| `statusCode` | HTTP status code hoặc mã lỗi tương ứng |
| `message` | Thông báo lỗi có thể hiển thị/diễn giải |
| `error` | Loại lỗi ngắn gọn |
| `code` | Mã lỗi nội bộ nếu dự án có convention |
| `details` | Chi tiết lỗi validation/business nếu cần |
| `timestamp` | Thời điểm xảy ra lỗi |
| `path` | API path nếu áp dụng |

---

## 7. Acceptance Criteria
## 7. Acceptance Criteria

> Acceptance Criteria phải kiểm thử được.
> Ưu tiên format Given / When / Then.
> Acceptance Criteria không bắt buộc là EARS, nhưng phải trace được về FR/ERR/NFR.

### 7.1 Happy Path

AC-001:
Given Business Admin có quyền `room.create`,
When Business Admin gửi yêu cầu POST `/api/v1/rooms` với dữ liệu hợp lệ (roomCode, roomName, capacity hợp lệ trong khoảng 1..1000, roomType thuộc enum),
Then the system tạo bản ghi phòng mới trong bảng `rooms` với `currentStatus = "available"` và `isActive = true`,
And the system trả về HTTP 201 với response body chứa: id, roomCode (đã uppercase), roomName, capacity, currentStatus, isActive, createdAt,
And the system ghi audit log cho hành động tạo phòng.

### 7.2 Validation Cases

AC-002:
Given dữ liệu request thiếu `roomCode`,
When Business Admin gửi yêu cầu POST `/api/v1/rooms`,
Then the system rejects the request và trả về HTTP 400 với mã `ROOM_CODE_REQUIRED`.

AC-002b:
Given `roomCode` sai định dạng (chứa khoảng trắng, chữ thường, ký tự đặc biệt) hoặc sai độ dài,
When Business Admin gửi yêu cầu POST `/api/v1/rooms`,
Then the system rejects the request và trả về HTTP 422 với mã `ROOM_CODE_INVALID_FORMAT`.

AC-003:
Given dữ liệu request thiếu `roomName`,
When Business Admin gửi yêu cầu POST `/api/v1/rooms`,
Then the system rejects the request và trả về HTTP 400 với mã `ROOM_NAME_REQUIRED`.

AC-004:
Given dữ liệu request thiếu `capacity`,
When Business Admin gửi yêu cầu POST `/api/v1/rooms`,
Then the system rejects the request và trả về HTTP 400 với mã `ROOM_CAPACITY_INVALID`.

AC-005:
Given `capacity` = 0, số âm, số thập phân, chuỗi hoặc > 1000,
When Business Admin gửi yêu cầu POST `/api/v1/rooms`,
Then the system rejects the request và trả về HTTP 422 với mã `ROOM_CAPACITY_INVALID`.

AC-006:
Given `roomType` không nằm trong enum cho phép,
When Business Admin gửi yêu cầu POST `/api/v1/rooms`,
Then the system rejects the request và trả về HTTP 422 với mã `INVALID_ROOM_TYPE`.

AC-006b:
Given request body chứa field ngoài hợp đồng (ví dụ: `layoutJson`),
When Business Admin gửi yêu cầu POST `/api/v1/rooms`,
Then the system rejects the request và trả về HTTP 422 với mã `UNSUPPORTED_FIELD`.

### 7.3 Authorization Cases

AC-007:
Given user chưa đăng nhập,
When user gửi yêu cầu POST `/api/v1/rooms`,
Then the system rejects the request và trả về HTTP 401.

AC-008:
Given user đã đăng nhập nhưng không có permission `room.create`,
When user gửi yêu cầu POST `/api/v1/rooms`,
Then the system rejects the request và không tạo bản ghi phòng, trả về HTTP 403.

### 7.4 Business Rule Cases

AC-009:
Given `roomCode` đã tồn tại trong bảng `rooms`,
When Business Admin gửi yêu cầu POST `/api/v1/rooms` với roomCode đó,
Then the system rejects the request và trả về HTTP 409 với mã lỗi `ROOM_CODE_ALREADY_EXISTS`.

AC-010:
Given `roomName` đã tồn tại cho một phòng `is_active=false` nhưng `deleted_at IS NULL` (cùng tên, bỏ qua viết hoa/thường và khoảng trắng 2 đầu),
When Business Admin gửi yêu cầu POST `/api/v1/rooms` với roomName đó,
Then the system rejects the request và trả về HTTP 409 với mã lỗi `ROOM_NAME_ALREADY_EXISTS` (bắt được cả lỗi race condition từ unique index của DB).

AC-010b:
Given `roomName` đã tồn tại cho một phòng bị soft-delete (`deleted_at IS NOT NULL`),
When Business Admin gửi yêu cầu POST `/api/v1/rooms` với roomName đó (và roomCode mới),
Then the system chấp nhận yêu cầu và tạo phòng thành công (HTTP 201).

### 7.5 Audit / Notification Cases

AC-011:
Given phòng họp được tạo thành công,
When the system completes the operation,
Then the system ghi audit log với: action_type = "create", entity_type = "room", entity_id = id phòng mới, new_value_json chứa thông tin phòng.

### 7.6 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-003, FR-005, FR-016, FR-018 | Tạo phòng thành công với dữ liệu hợp lệ |
| AC-002 | FR-009, ERR-001 | Thiếu roomCode |
| AC-002b| FR-009, ERR-001b| Sai định dạng roomCode |
| AC-003 | FR-011, ERR-002 | Thiếu roomName |
| AC-004 | FR-012, ERR-003 | Thiếu capacity |
| AC-005 | FR-012, ERR-004 | capacity không hợp lệ (0, âm, >1000) |
| AC-006 | FR-012b, ERR-005| roomType không hợp lệ |
| AC-006b| FR-012c, ERR-005b| Unsupported field (layoutJson) |
| AC-007 | FR-013, ERR-006 | Chưa xác thực |
| AC-008 | FR-014, ERR-007 | Không có quyền room.create |
| AC-009 | FR-009, ERR-008 | Trùng roomCode |
| AC-010 | FR-010, ERR-009 | Trùng roomName |
| AC-011 | FR-018 | Audit log khi tạo thành công |

## 8. Out of Scope

> Phần này rất quan trọng để agent không tự mở rộng feature.

Các nội dung sau **không thuộc phạm vi** của feature này:

- [Nội dung không làm 1]
- [Nội dung không làm 2]
- [Nội dung không làm 3]
- [Phần integration chưa triển khai nếu có]
- [Phần AI/automation/reporting nâng cao nếu chưa được yêu cầu]

### 8.1 Không triển khai trong feature này

- [Không implement API/logic nào]
- [Không xử lý module nào]
- [Không thêm bảng/cột nào]
- [Không tạo luồng nghiệp vụ nào]

### 8.2 Có thể xem xét ở feature khác

- [Ý tưởng hoặc phạm vi có thể tách sang feature khác]
- [Các enhancement sau này]
- [Các tích hợp phụ thuộc vào thiết bị/service khác]

### 8.3 Out-of-scope EARS Guardrails

Có thể viết thêm guardrail bằng EARS để agent không tự mở rộng:

```text
OOS-001: THE system SHALL NOT implement [out-of-scope feature] as part of this feature.
OOS-002: THE system SHALL NOT create new database tables or fields unless explicitly approved in this specification.
OOS-003: WHERE [future/optional module] is mentioned for context only, THE system SHALL NOT implement that module in this feature.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [ ] Spec đã có đủ 8 thành phần chính.
- [ ] Functional Requirements đã viết theo EARS.
- [ ] Requirement sử dụng keyword EARS bằng tiếng Anh: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [ ] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [ ] Đã cân nhắc Complex / Combined EARS Requirements nếu feature có nhiều điều kiện.
- [ ] Mỗi requirement có mã ID rõ ràng.
- [ ] Requirement có thể kiểm thử được.
- [ ] Không mô tả quá sâu implementation.
- [ ] Không tự ý thêm feature ngoài tài liệu nguồn.
- [ ] Không tự ý thêm database table/field mới nếu chưa có căn cứ.
- [ ] Error handling đã bao gồm validation, authentication, authorization, business rule, conflict, integration/device failure nếu liên quan.
- [ ] Error requirements đã ưu tiên format `IF ... THEN THE system SHALL ...`.
- [ ] Acceptance Criteria dùng Given / When / Then.
- [ ] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [ ] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [ ] Các phần thiếu thông tin đã được đưa vào `Cần làm rõ`.