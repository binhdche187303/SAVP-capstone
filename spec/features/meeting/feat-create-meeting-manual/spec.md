# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-08 | Tạo spec lần đầu cho UC-MM-01 Tạo cuộc họp mới thủ công | Toàn bộ file |
| 2026-06-08 | Cập nhật flow: tạo yêu cầu chờ duyệt (pending_approval), booking pending, thêm meeting_requests | Các dòng FR-002, FR-003, FR-008, FR-011, FR-012, FR-025, FR-030, FR-031, FR-DATA, AC, State Model, Section 1.4, OOS, Traceability |
| 2026-06-08 | Chuẩn hóa permission code, sửa notification/audit/capacity/host rule, bổ sung FR-041/FR-042, transaction guardrail, làm rõ FR-037 | Toàn bộ file |
| 2026-06-08 | Consistency fixes: FR-011 view-only, FR-039 removed, AC-001 4 participants, capacity_override_confirmed, approver resolution, entity field alignment, room isActive check | Các dòng FR-011, FR-039, AC-001, FR-014, FR-020, FR-033, Section 1.5/5.8, FR-DATA-003, notification/audit fields |
| 2026-08-08 | [Xử lý xung đột phòng/giờ họp — Nhóm A] Room conflict check lúc TẠO booking chỉ tính booking `approved`/`active` là chặn; booking `pending` của người khác KHÔNG còn chặn tạo mới (nhiều request pending cùng phòng/giờ được phép tồn tại song song, Manager quyết định duyệt cái nào ở bước approve — xem `feat-review-meeting-request`). Xem `KE_HOACH_XU_LY_XUNG_DOT_PHONG_GIO_HOP_2026-08-08.md` ở root repo. | FR-005, FR-012, FR-017, Section 5.5 (Data Constraints), ERR-012, AC-007, Traceability (FR-017, FR-012) |
| 2026-08-08 | [Xử lý xung đột phòng/giờ họp — Nhóm B] Áp dụng buffer tối thiểu 15 phút (mặc định, đọc từ `system_configs.room_booking_buffer_minutes`) giữa booking mới và booking `approved`/`active` liền kề cùng phòng — back-to-back (endTime A = startTime B) không còn được coi là hợp lệ. | FR-012, FR-017, ERR-012 |
| 2026-08-08 | [Xử lý xung đột phòng/giờ họp — Nhóm D] `GET /rooms/available` (dùng bởi bước "Tìm phòng họp" trước khi tạo) trả thêm field `pendingConflicts` cho mỗi phòng — liệt kê các meeting request `pending` KHÁC đang xin cùng phòng/khung giờ (chỉ mang tính thông tin, KHÔNG loại phòng khỏi danh sách, KHÔNG áp dụng buffer — xem FR-006b mới). | FR-006, FR-006b (mới) |

> File này dùng làm đặc tả tính năng cho Spec Kit / Codex CLI khi chạy `$speckit-specify`.
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

# Feature Specification: Tạo cuộc họp mới thủ công

- **Feature ID**: MEETING-CREATE-MANUAL-001
- **Feature Name**: Tạo cuộc họp mới thủ công
- **Module / Domain**: meetings
- **Created Date**: 2026-06-08
- **Status**: Draft
- **Source Documents**:
  - UC-MM-01 Tạo cuộc họp mới thủ công (User Story / Use Case Description)
  - Database v3.2 Compact (39 tables) — `database_v3_2_compact_39_tables.md`
  - AGENTS.md — Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md (nếu có)
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

### 0.2 Event-driven Requirement

Dùng khi hệ thống phản ứng sau một event/trigger.

Format chuẩn:

```text
FR-XXX: WHEN [trigger/event occurs], THE system SHALL [system response].
```

### 0.3 State-driven Requirement

Dùng khi hành vi phải đúng trong suốt một trạng thái cụ thể.

Format chuẩn:

```text
FR-XXX: WHILE [state/precondition is true], THE system SHALL [system response].
```

### 0.4 Optional Feature Requirement

Dùng khi requirement chỉ áp dụng nếu hệ thống có một capability, config, module, device, integration, hoặc feature flag cụ thể.

Format chuẩn:

```text
FR-XXX: WHERE [optional feature/capability/configuration is included], THE system SHALL [system response].
```

### 0.5 Unwanted Behavior Requirement

Dùng cho lỗi, ngoại lệ, failure, dữ liệu không hợp lệ, quyền không hợp lệ, conflict, hoặc tình huống không mong muốn.

Format chuẩn:

```text
FR-XXX: IF [unwanted condition/error/failure occurs], THEN THE system SHALL [safe system response].
```

### 0.6 Complex / Combined EARS Requirements

Dùng khi requirement cần kết hợp nhiều điều kiện.

### 0.7 EARS Quality Checklist

Trước khi hoàn tất Functional Requirements, kiểm tra từng requirement:

- [ ] Có requirement ID rõ ràng, ví dụ `FR-001`.
- [ ] Có đúng keyword EARS phù hợp: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [ ] Có đúng một system chính: `THE system` hoặc tên component cụ thể nếu cần.
- [ ] Có hành vi rõ ràng sau `SHALL`.
- [ ] Có thể viết test case để kiểm chứng.
- [ ] Không dùng từ mơ hồ nếu không có tiêu chí đo.
- [ ] Không trộn nhiều hành vi không liên quan trong cùng một requirement.
- [ ] Không tự thêm feature, bảng, field, integration ngoài tài liệu nguồn.

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng này thuộc module **meetings** trong giai đoạn **Pre-meeting** (Tiền cuộc họp) của vòng đời cuộc họp (Meeting Lifecycle).

Đây là một trong những tính năng cốt lõi của hệ thống Intelligent Meeting Lifecycle Management System. Use case này cho phép người dùng khai báo và khởi tạo một sự kiện cuộc họp trên phần mềm. Người dùng sẽ cung cấp các thông tin nền tảng như: Tiêu đề cuộc họp, người chủ trì (Host), khung thời gian dự kiến, lựa chọn không gian phòng họp vật lý và chỉ định danh sách người tham dự.

Hệ thống sẽ đóng vai trò kiểm soát xung đột tài nguyên, ghi nhận lịch trình, "giữ chỗ" phòng họp và tự động hóa việc phát hành thư mời. Sự kiện được tạo ra từ chức năng này sẽ là cơ sở dữ liệu gốc để các thiết bị camera/IoT đối chiếu điểm danh và giám sát không gian trong giai đoạn In-meeting sau này.

Tính năng này liên quan trực tiếp tới các module: `meetings`, `meeting_requests`, `rooms`, `room_bookings`, `notifications`, `meeting_participants`, `meeting_external_participants`, `meeting_agendas`, `meeting_events`.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Internal Employee / Manager** thực hiện thao tác tạo một yêu cầu cuộc họp mới với đầy đủ thông tin (tiêu đề, thời gian, phòng họp, người tham dự) nhằm **gửi yêu cầu chờ phê duyệt, giữ chỗ phòng tạm thời (pending) và thông báo đến người phê duyệt**.

### 1.3 Giá trị mang lại

- **Cho người dùng**: Giảm thao tác thủ công khi tạo yêu cầu họp; chủ động kiểm tra xung đột lịch và sức chứa phòng trước khi gửi duyệt.
- **Cho Manager/Approver**: Nhận yêu cầu và có thể phê duyệt hoặc từ chối; đảm bảo tài nguyên phòng được quản lý tập trung.
- **Cho quản trị hệ thống**: Chuẩn hóa dữ liệu cuộc họp ngay từ khi tạo; tạo điều kiện cho các tính năng In-meeting và Post-meeting về sau.
- **Cho vận hành phòng họp**: Giữ chỗ tạm thời (pending) tránh double-booking khi chờ duyệt; chỉ khóa phòng thực sự khi được approved.
- **Cho dữ liệu/báo cáo**: Hồ sơ yêu cầu họp là nguồn dữ liệu cho audit và báo cáo về tỷ lệ duyệt/từ chối.

### 1.4 Giả định

- Người dùng đã đăng nhập thành công và có quyền tạo cuộc họp (permission `meeting.create`).
- Hệ thống đã có sẵn danh mục phòng họp (rooms) và danh bạ tài khoản nhân sự nội bộ (users).
- Thời gian được nhập theo múi giờ mặc định của hệ thống (`Asia/Ho_Chi_Minh`), không yêu cầu chọn múi giờ riêng ở giai đoạn này.
- Cuộc họp yêu cầu phê duyệt (approval) bởi Manager/Approver trước khi trở thành "Đã lên lịch" (scheduled).
- Mặc định `approval_mode` là `manual` — cần người phê duyệt duyệt thủ công.
- Hệ thống chưa hỗ trợ tạo cuộc họp định kỳ (recurrence) trong phạm vi feature này.

### 1.5 Assumptions & Clarifications

- **Approver resolution**: Người phê duyệt (approver) được xác định qua `system_configs` với key `meeting.approver_role_id` — tìm user có role tương ứng. Trong v1, dùng fallback là `room_approver_id` nếu rooms có field này, hoặc user có permission `meeting_request.approve`. Chi tiết implement sẽ được làm rõ ở phase implementation.
- Mặc định `approval_mode` là `manual` — cần người phê duyệt duyệt thủ công.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee | Người dùng nội bộ tạo yêu cầu cuộc họp cho nhu cầu công việc | Tạo yêu cầu, mời người tham dự, xem trạng thái chờ duyệt |
| Manager / Approver | Người có quyền phê duyệt yêu cầu tạo cuộc họp | Phê duyệt hoặc từ chối yêu cầu, chịu trách nhiệm về tài nguyên phòng |
| Hệ thống | Xử lý nghiệp vụ tự động: kiểm tra conflict, tạo bản ghi, gửi thông báo | Kiểm tra validation, tạo meeting + booking + request + notification |

### 2.2 Role & Permission Rules

- Người dùng có permission `meeting.create` được phép truy cập form tạo cuộc họp và gửi yêu cầu tạo.
- Creator và Host có quyền chỉnh sửa yêu cầu, hủy yêu cầu và quản lý danh sách khách mời trong khi chờ duyệt.
- Manager/Approver có permission `meeting_request.approve` được phép duyệt hoặc từ chối yêu cầu tạo cuộc họp.
- Participants thông thường chỉ có quyền xem thông tin và phản hồi tham gia (Accept/Decline).

### 2.3 Actor Constraints

- Phải đăng nhập hệ thống với tài khoản hợp lệ (không bị khóa).
- Phải có permission `meeting.create` trong hệ thống RBAC.
- Phải có ít nhất một phòng họp đang active trong hệ thống để có thể chọn phòng.

---

## 3. Functional Requirements

> Tất cả Functional Requirements phải viết theo EARS.
> Mỗi requirement phải rõ ràng, kiểm thử được, không mơ hồ.
> Keyword EARS phải giữ bằng tiếng Anh.
> Nội dung nghiệp vụ có thể viết tiếng Việt.

### 3.1 Core Requirements

```text
FR-001: THE system SHALL yêu cầu người dùng đăng nhập và có permission `meeting.create` trước khi cho phép truy cập form tạo cuộc họp.

FR-002: THE system SHALL lưu hồ sơ cuộc họp mới với trạng thái mặc định là `pending_approval` sau khi tạo thành công.

FR-003: THE system SHALL tạo một bản ghi `room_bookings` tương ứng với phòng họp được chọn và thiết lập trạng thái booking là `pending`.

FR-004: THE system SHALL ghi lại thông tin người tạo (`created_by`) và người tổ chức (`organizer_id`) cho mỗi cuộc họp được tạo mới. Nếu `host_id` không được cung cấp, hệ thống SHALL mặc định host = người tạo. Hệ thống SHALL tự động thêm host vào `meeting_participants` nếu host chưa có trong danh sách participant.
```

### 3.2 Event-driven Requirements

```text
FR-005: WHEN người dùng gửi yêu cầu tạo cuộc họp với đầy đủ thông tin hợp lệ, THE system SHALL kiểm tra sơ bộ xung đột phòng họp (kiểm tra booking `approved`/`active` khác — booking `pending` của người khác KHÔNG tính là xung đột, xem FR-012) và lịch cá nhân, ghi kết quả vào `meeting_requests.conflict_summary_json` trước khi lưu.

FR-006: WHEN người dùng chọn khung thời gian cho cuộc họp, THE system SHALL lọc danh sách phòng họp và chỉ hiển thị các phòng còn trống (available) trong khung giờ đó.

FR-006b: [Nhóm D, 2026-08-08] WHEN trả danh sách phòng qua `GET /rooms/available`, THE system SHALL đính kèm cho mỗi phòng field `pendingConflicts: [{meetingTitle, requesterName, startTime, endTime}]` — liệt kê các `room_bookings` khác đang ở trạng thái `pending` (thuộc meeting request khác) overlap với khung giờ yêu cầu tại đúng phòng đó. Đây CHỈ là cảnh báo thông tin cho người dùng biết đã có người khác đang xin cùng slot — KHÔNG loại phòng khỏi danh sách, KHÔNG áp dụng buffer (buffer chỉ áp dụng cho booking `approved`/`active`, xem FR-012). Nếu không có pending nào khác, trả mảng rỗng `[]`.

FR-007: WHEN người dùng hoàn tất việc chọn người tham dự và các thông tin khác, THE system SHALL cho phép người dùng kiểm tra lại toàn bộ thông tin trước khi xác nhận tạo.

FR-008: WHEN yêu cầu tạo cuộc họp được tạo thành công, THE system SHALL tạo bản ghi `meeting_events` với event_type là `meeting_request_created`.

FR-009: WHEN yêu cầu cuộc họp được tạo thành công, THE system SHALL kích hoạt tiến trình gửi thông báo đến Manager/Approver để thông báo có yêu cầu mới chờ duyệt.

FR-010: WHEN cuộc họp được tạo thành công và có external participants, THE system SHALL lưu thông tin khách mời ngoài vào bảng `meeting_external_participants`.
```

### 3.3 State-driven Requirements

```text
FR-011: WHILE cuộc họp đang ở trạng thái `pending_approval`, THE system SHALL cho phép host và creator xem thông tin yêu cầu. Việc chỉnh sửa và hủy yêu cầu là trách nhiệm của feature riêng (xem OOS).

FR-012: WHILE phòng họp có booking ở trạng thái `approved` hoặc `active`, THE system SHALL không cho phép tạo booking mới có thời gian trùng lắp HOẶC cách nhau ít hơn `bufferMinutes` phút (mặc định 15, đọc từ `system_configs.room_booking_buffer_minutes`, xem `feat-scheduling-room-suggestions` FR-023b) với booking hiện tại — tức là cần khoảng cách tối thiểu `bufferMinutes` phút giữa endTime của booking này và startTime của booking kia (áp dụng cả 2 chiều). Booking ở trạng thái `pending` (của một meeting request khác đang chờ duyệt) KHÔNG được tính là đang chiếm phòng và KHÔNG áp dụng buffer — nhiều request `pending` có thể cùng tồn tại cho cùng phòng/khung giờ; việc quyết định duyệt request nào thuộc trách nhiệm Manager/Approver ở bước phê duyệt (xem `feat-review-meeting-request`, FR-032/FR-033), lúc đó request được duyệt trước sẽ khiến các request pending còn lại nhận `ROOM_CONFLICT` khi được duyệt sau.

FR-013: WHILE người dùng đang ở form tạo cuộc họp, THE system SHALL duy trì tính nhất quán của dữ liệu nhập và chỉ lưu khi người dùng xác nhận.
```

### 3.4 Optional Feature Requirements

```text
FR-014: WHERE tính năng kiểm tra sức chứa (capacity check) được bật, THE system SHALL so sánh tổng số participant với `rooms.capacity`. IF số participant vượt quá capacity và request không có trường `capacity_override_confirmed = true`, THEN hệ thống SHALL từ chối tạo yêu cầu và trả về lỗi capacity. IF `capacity_override_confirmed = true`, THE system SHALL cho phép tạo yêu cầu và ghi nhận override vào audit log.

FR-015: WHERE hệ thống có cấu hình gửi email (outbox pattern), THE system SHALL tạo notification record với channel là `email` và nội dung thông báo yêu cầu mới chờ duyệt cho Manager/Approver.

FR-016: WHERE hệ thống có cấu hình gửi in-app notification, THE system SHALL tạo notification record với channel là `in_app` và nội dung thông báo yêu cầu mới chờ duyệt cho Manager/Approver.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-017: IF phòng họp được chọn đã có booking ở trạng thái `approved` hoặc `active` trùng thời gian HOẶC cách nhau ít hơn `bufferMinutes` phút (overlap có buffer, xem FR-012), THEN THE system SHALL từ chối tạo yêu cầu, không lưu bất kỳ thay đổi nào và trả về thông báo lỗi xung đột phòng. Booking `pending` của request khác không kích hoạt lỗi này (xem FR-012).

FR-018: IF thời gian kết thúc nhỏ hơn hoặc bằng thời gian bắt đầu, THEN THE system SHALL từ chối yêu cầu và yêu cầu người dùng điều chỉnh lại thời gian.

FR-019: IF thời gian bắt đầu nằm trong quá khứ (so với thời điểm hiện tại), THEN THE system SHALL từ chối yêu cầu và yêu cầu người dùng chọn thời gian trong tương lai.

FR-020: IF tổng số participant vượt quá sức chứa của phòng và capacity check được bật, THEN THE system SHALL từ chối request và trả về lỗi capacity. Người dùng có thể gửi lại request với `capacity_override_confirmed = true` để vượt qua giới hạn này.

FR-021: IF một participant nội bộ có lịch họp khác trùng với khung thời gian đang thiết lập, THEN THE system SHALL hiển thị cảnh báo "Bận" bên cạnh tên participant đó trong giao diện chọn người tham dự.

FR-022: IF người dùng không có quyền tạo cuộc họp, THEN THE system SHALL từ chối truy cập form tạo cuộc họp.

FR-023: IF dữ liệu đầu vào không hợp lệ (thiếu trường bắt buộc, sai định dạng), THEN THE system SHALL từ chối yêu cầu và trả về lỗi validation chi tiết.
```

### 3.6 Workflow Requirements

```text
FR-024: WHEN người dùng nhấn nút "Tạo cuộc họp mới", THE system SHALL hiển thị form khởi tạo cuộc họp với các trường thông tin cần nhập.

FR-025: WHEN người dùng điền đầy đủ thông tin và nhấn "Tạo cuộc họp", THE system SHALL thực hiện các bước: kiểm tra validation → kiểm tra conflict sơ bộ → tạo meeting record (status = pending_approval) → tạo meeting_requests (request_type = create_meeting, approval_status = pending) → tạo room booking (status = pending) → tạo participants → tạo notification cho approver → trả về kết quả thành công.

FR-026: WHEN quy trình tạo cuộc họp hoàn tất, THE system SHALL điều hướng người dùng về màn hình Chi tiết cuộc họp vừa tạo.
```

### 3.7 Authorization Requirements

```text
FR-027: IF the user is not authenticated, THEN THE system SHALL reject access to the create meeting form and return an authentication error.

FR-028: IF the user does not have `meeting.create` permission, THEN THE system SHALL reject the request without creating any meeting record.

FR-029: WHEN người dùng gửi yêu cầu tạo cuộc họp, THE system SHALL xác thực quyền trước khi xử lý business logic.
```

### 3.8 Data & State Requirements

```text
FR-030: WHEN dữ liệu cuộc họp hợp lệ được submit, THE system SHALL lưu meeting record với trạng thái `pending_approval`, thời gian `start_time` và `end_time`, `organizer_id`, `host_id` (mặc định là organizer_id nếu không cung cấp), `room_id`.

FR-031: WHEN cuộc họp được tạo và phòng đã được đặt, THE system SHALL tạo `room_bookings` record với trạng thái `pending`, liên kết tới `meeting_id` vừa tạo.

FR-031b: WHEN meeting record và room booking được tạo thành công, THE system SHALL tạo `meeting_requests` record với `request_type = 'create_meeting'`, `approval_status = 'pending'`, `meeting_id` trỏ tới meeting vừa tạo, và `request_payload_json` chứa snapshot toàn bộ dữ liệu đầu vào.

FR-032: WHEN participant được thêm vào cuộc họp, THE system SHALL tạo bản ghi `meeting_participants` với `invitation_status` mặc định là `pending` và `attendance_status` mặc định là `not_checked_in`.

FR-033: IF phòng họp không tồn tại hoặc không active, THEN THE system SHALL reject the request.
```

### 3.9 Notification / Audit Requirements

```text
FR-034: WHEN yêu cầu cuộc họp được tạo thành công, THE system SHALL tạo notification record với loại thông báo yêu cầu mới (meeting_request_created) cho Manager/Approver (qua `recipient_user_ids_json`).

FR-035: WHEN yêu cầu cuộc họp được tạo thành công, THE system SHALL ghi audit log với action_type `create`, entity_type `meeting_request`, ghi nhận actor (user tạo) và thời điểm tạo.

FR-036: IF notification delivery fails, THEN THE system SHALL keep the main meeting transaction result unchanged and record the delivery failure in notifications.delivery_status.
```

### 3.10 Integration / Device Requirements

```text
FR-037: WHERE yêu cầu cuộc họp có chọn phòng họp, THE system SHALL lưu trường `room_id` trong `meetings` và `room_bookings` để ghi nhận phòng được đặt.
```

### 3.11 Complex / Combined Requirements

```text
FR-038: WHILE người dùng đang ở form tạo cuộc họp, WHEN người dùng thay đổi khung thời gian, THE system SHALL cập nhật danh sách phòng khả dụng tương ứng với khung giờ mới.

(FR-039 đã gộp vào FR-021 — participant conflict warning.)

FR-040: IF có lỗi hệ thống (ví dụ database connection failure) trong quá trình tạo cuộc họp, THEN THE system SHALL rollback toàn bộ thay đổi để đảm bảo tính nhất quán dữ liệu.

FR-041: WHEN yêu cầu cuộc họp được tạo, THE system SHALL tự động sinh `meeting_code` duy nhất cho `meetings` dựa trên timestamp hoặc sequence (format ví dụ: MT-YYYYMMDD-XXX).

FR-042: WHEN room booking được tạo, THE system SHALL tự động sinh `booking_code` duy nhất cho `room_bookings` dựa trên timestamp hoặc sequence (format ví dụ: BK-YYYYMMDD-XXX).
```

### 3.12 Requirement Notes

- **Trong transaction (cùng một DB transaction):** tạo `meetings`, `meeting_requests`, `room_bookings`, `meeting_participants`, `meeting_external_participants`, `notifications` (chỉ tạo record), và `audit_logs`.
- **Ngoài transaction (sau khi commit thành công):** gửi email delivery, push WebSocket event, thực thi background job (nếu có). Các bước này không được làm rollback transaction chính.
- Nếu notification delivery thất bại, không rollback transaction chính (xem FR-036).
- `meeting_code` nên được sinh tự động dựa trên timestamp hoặc sequence (ví dụ: MT-YYYYMMDD-XXX).
- `booking_code` cũng nên được sinh tự động tương tự.

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-MM-01 (PRE1, PRE2) | Xác thực trước khi truy cập |
| FR-002 | Ubiquitous | UC-MM-01 (POST1) | Trạng thái mặc định pending_approval |
| FR-003 | Ubiquitous | UC-MM-01 (POST2, BR1) | Tạo room booking pending |
| FR-004 | Ubiquitous | UC-MM-01 | Ghi nhận người tạo |
| FR-005 | Event-driven | UC-MM-01 (Bước 8) | Conflict checking + lưu summary_json |
| FR-006 | Event-driven | UC-MM-01 (Bước 5) | Lọc phòng khả dụng |
| FR-007 | Event-driven | UC-MM-01 (Bước 7) | Review trước khi tạo |
| FR-008 | Event-driven | UC-MM-01 (Bước 9) | Ghi meeting request created event |
| FR-009 | Event-driven | UC-MM-01 (POST3, Bước 10) | Gửi thông báo cho approver |
| FR-010 | Event-driven | UC-MM-01 (Bước 6) | External participants |
| FR-011 | State-driven | UC-MM-01 (BR2) | Quyền host/creator xem thông tin khi pending_approval (edit/cancel là feature riêng) |
| FR-012 | State-driven | UC-MM-01 (BR1, E1) | Double-booking prevention (chỉ approved/active, pending không chặn) |
| FR-013 | State-driven | UC-MM-01 | Form consistency |
| FR-014 | Optional Feature | UC-MM-01 (E3) | Capacity check + override |
| FR-015 | Optional Feature | UC-MM-01 (POST3) | Email notification cho approver |
| FR-016 | Optional Feature | UC-MM-01 (POST3) | In-app notification cho approver |
| FR-017 | Unwanted Behavior | UC-MM-01 (E1) | Room conflict error (chỉ approved/active booking) |
| FR-018 | Unwanted Behavior | UC-MM-01 (E2) | Invalid time range |
| FR-019 | Unwanted Behavior | UC-MM-01 (E2) | Past time error |
| FR-020 | Unwanted Behavior | UC-MM-01 (E3) | Capacity exceeded — hard reject |
| FR-021 | Unwanted Behavior | UC-MM-01 (Other Info) | Participant conflict |
| FR-022 | Unwanted Behavior | UC-MM-01 | Authorization failure |
| FR-023 | Unwanted Behavior | UC-MM-01 | Validation failure |
| FR-024 | Workflow | UC-MM-01 (Bước 1-2) | Hiển thị form |
| FR-025 | Workflow | UC-MM-01 (Bước 8-9) | Xử lý tạo meeting |
| FR-026 | Workflow | UC-MM-01 (Bước 10) | Điều hướng sau tạo |
| FR-027 | Authorization | UC-MM-01 (PRE1) | Unauthenticated |
| FR-028 | Authorization | UC-MM-01 | Missing permission |
| FR-029 | Authorization | UC-MM-01 | Check before processing |
| FR-030 | Data & State | UC-MM-01 (Bước 9, POST1) | Lưu meeting record pending_approval |
| FR-031 | Data & State | UC-MM-01 (POST2) | Tạo room booking pending |
| FR-031b | Data & State | UC-MM-01 | Tạo meeting_requests record |
| FR-032 | Data & State | UC-MM-01 (Bước 6) | Tạo participant records |
| FR-033 | Data & State | UC-MM-01 | Phòng không tồn tại |
| FR-034 | Notification | UC-MM-01 (POST3) | Tạo notification cho approver |
| FR-035 | Notification | UC-MM-01 | Audit log |
| FR-036 | Notification | UC-MM-01 | Delivery failure handling |
| FR-037 | Data | UC-MM-01 (Description) | Lưu room_id reference |
| FR-038 | Complex | UC-MM-01 (Bước 5) | Cập nhật phòng khi đổi giờ |
| FR-039 | — | — | Đã gộp vào FR-021 |
| FR-040 | Complex | UC-MM-01 | Rollback khi lỗi |
| FR-041 | Data & State | UC-MM-01 | Tự sinh meeting_code |
| FR-042 | Data & State | UC-MM-01 | Tự sinh booking_code |

---

## 4. Non-functional Requirements

> Non-functional Requirements cũng nên dùng `THE system SHALL` hoặc EARS conditional pattern nếu có điều kiện rõ ràng.

### 4.1 Performance

```text
NFR-001: THE system SHALL hoàn tất quy trình tạo cuộc họp (từ lúc submit đến lúc trả kết quả) trong vòng 3 giây dưới tải bình thường.

NFR-002: THE system SHALL hỗ trợ ít nhất 50 yêu cầu tạo cuộc họp đồng thời mà không làm suy giảm hiệu năng.

NFR-003: WHEN số lượng yêu cầu vượt quá ngưỡng hỗ trợ, THE system SHALL trả về lỗi có kiểm soát (rate limiting) theo policy của dự án.
```

### 4.2 Security

```text
NFR-004: THE system SHALL yêu cầu xác thực (authentication) trước khi cho phép truy cập form và API tạo cuộc họp.

NFR-005: THE system SHALL thực thi phân quyền (authorization) cho mọi thao tác tạo cuộc họp.

NFR-006: THE system SHALL NOT expose mật khẩu, token, hoặc thông tin nhạy cảm trong API response.

NFR-007: IF a request contains invalid or expired credentials, THEN THE system SHALL reject the request.
```

### 4.3 Reliability & Consistency

```text
NFR-008: THE system SHALL prevent partial updates khi một business transaction (tạo meeting + booking + participants + notification) thất bại.

NFR-009: THE system SHALL duy trì tính nhất quán giữa meeting record, room booking, participant records và notification records sau khi tạo thành công.

NFR-010: IF a required persistence operation fails, THEN THE system SHALL rollback the affected business operation để đảm bảo tính toàn vẹn dữ liệu.
```

### 4.4 Usability

```text
NFR-011: THE system SHALL hiển thị thông báo lỗi rõ ràng bằng tiếng Việt cho người dùng khi có lỗi validation hoặc business conflict.

NFR-012: THE system SHALL đánh dấu (bôi đỏ) các trường nhập liệu không hợp lệ và hiển thị hướng dẫn khắc phục.
```

### 4.5 Observability

```text
NFR-013: THE system SHALL ghi log mọi lỗi xử lý quan trọng trong quy trình tạo cuộc họp.

NFR-014: THE system SHALL ghi audit log cho hành động tạo cuộc họp với entity_type là `meeting_request` (actor, action, entity_id = meeting_request_id, metadata chứa meeting_id và booking_id, timestamp).

NFR-015: WHEN xảy ra lỗi conflict hoặc validation, THE system SHALL ghi đủ thông tin để hỗ trợ troubleshooting.
```

### 4.6 Maintainability

```text
NFR-016: THE system SHALL giữ business logic tạo cuộc họp trong module `meetings`, không trộn lẫn với module khác.

NFR-017: THE system SHALL cung cấp test case cho: success flow, validation failures, authorization failures, room conflict, participant conflict, capacity warning.
```

---

## 5. Data Model

> Phần này mô tả dữ liệu ở mức nghiệp vụ.
> Không tự ý thêm bảng mới nếu database baseline chưa có.

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `meetings` | Lưu hồ sơ cuộc họp mới được tạo, status = pending_approval | Bảng lõi của vòng đời cuộc họp |
| `meeting_requests` | Lưu yêu cầu tạo cuộc họp chờ duyệt | Chứa approval_status, conflict_summary_json, request_payload_json |
| `meeting_participants` | Lưu danh sách người tham dự nội bộ | Mỗi participant là một record |
| `meeting_external_participants` | Lưu khách mời bên ngoài không có tài khoản | Email, tên, tổ chức |
| `meeting_agendas` | Lưu agenda sơ bộ được tạo kèm cuộc họp | Có thể có hoặc không |
| `meeting_events` | Lưu sự kiện "meeting_request_created" sau khi tạo | Timeline event |
| `room_bookings` | Lưu booking phòng tương ứng, status = pending | Giữ chỗ tạm thời chờ duyệt |
| `rooms` | Lưu thông tin phòng, capacity, trạng thái | Dùng để kiểm tra khả dụng |
| `users` | Lưu thông tin người tạo, host, participants, approver | Danh bạ nội bộ |
| `notifications` | Lưu thông báo gửi đến approver | Channel email/in_app |
| `audit_logs` | Ghi nhận hành động tạo yêu cầu cuộc họp | Audit trail |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| `title` | string | Có | Tiêu đề cuộc họp | 1-255 ký tự |
| `description` | string | Không | Mô tả nội dung cuộc họp | Tối đa 2000 ký tự |
| `host_id` | uuid | Không | Người chủ trì cuộc họp, mặc định là người tạo (organizer_id) nếu không cung cấp | Nếu có, phải là user hợp lệ, active |
| `start_time` | timestamptz | Có | Thời gian bắt đầu | Phải > thời điểm hiện tại |
| `end_time` | timestamptz | Có | Thời gian kết thúc | Phải > start_time |
| `room_id` | uuid | Có | Phòng họp được chọn | Phải là room active, available |
| `meeting_type` | string | Không | Loại cuộc họp | Mặc định `normal` |
| `meeting_mode` | string | Không | Hình thức họp | Mặc định `offline` |
| `expected_attendee_count` | integer | Không | Số người dự kiến | >= 1 |
| `capacity_override_confirmed` | boolean | Không | Bỏ qua kiểm tra sức chứa phòng | Mặc định `false` |
| `participant_user_ids` | array[uuid] | Có | Danh sách user ID nội bộ tham dự (không bao gồm host - host được tự động thêm) | Có thể để trống nếu không có participant nội bộ nào ngoài host |
| `external_participants` | array[object] | Không | Danh sách khách mời ngoài | Mỗi object gồm full_name, email |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---|---|
| `id` | uuid | ID cuộc họp vừa tạo |
| `meeting_code` | string | Mã cuộc họp |
| `title` | string | Tiêu đề cuộc họp |
| `status` | string | `pending_approval` |
| `approval_status` | string | `pending` (từ meeting_requests) |
| `start_time` | timestamptz | Thời gian bắt đầu |
| `end_time` | timestamptz | Thời gian kết thúc |
| `room_id` | uuid | ID phòng họp |
| `room_name` | string | Tên phòng họp |
| `organizer_id` | uuid | Người tạo |
| `host_id` | uuid | Người chủ trì |
| `participant_count` | integer | Tổng số participant |
| `booking_status` | string | `pending` |
| `created_at` | timestamptz | Thời điểm tạo |

### 5.4 State / Status Model

**Meeting status (`meetings.status`):**

| Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|
| `pending_approval` | Đang chờ duyệt | `scheduled`, `cancelled` | Approver duyệt hoặc creator hủy |
| `scheduled` | Đã lên lịch (sau khi duyệt) | `in_progress`, `cancelled` | Bắt đầu họp hoặc hủy |
| `in_progress` | Đang diễn ra | `completed`, `paused`, `cancelled` | Kết thúc, tạm dừng, hủy |
| `completed` | Đã kết thúc | — | Terminal state |
| `cancelled` | Đã hủy | — | Terminal state |

**Booking status (`room_bookings.status`):**

| Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|
| `pending` | Giữ chỗ tạm thời, chờ duyệt | `approved`, `cancelled` | Approver duyệt hoặc hủy |
| `approved` | Đã xác nhận giữ phòng | `active`, `cancelled` | Meeting bắt đầu hoặc hủy |
| `active` | Phòng đang được sử dụng | `completed`, `cancelled` | Meeting kết thúc hoặc hủy |
| `completed` | Đã sử dụng xong | — | Terminal state |
| `cancelled` | Đã hủy đặt phòng | — | Terminal state |

**Approval status (`meeting_requests.approval_status`):**

| Status | Ý nghĩa | Có thể chuyển sang |
|---|---|---|
| `pending` | Chờ xử lý | `approved`, `rejected`, `cancelled` |
| `approved` | Đã duyệt | — |
| `rejected` | Đã từ chối | — |
| `cancelled` | Người tạo đã hủy | — |

**Ghi chú**: Ở feature này, meeting được tạo với status = `pending_approval`, booking status = `pending`, request approval_status = `pending`. Việc chuyển sang `scheduled` + `approved` là trách nhiệm của feature phê duyệt (approve meeting request).

### 5.5 Data Constraints

- `meeting_code` phải là unique trong toàn hệ thống.
- Một phòng họp chỉ được có duy nhất một booking ở trạng thái `approved` hoặc `active` trong cùng một khung thời gian (không overlap). Nhiều booking `pending` (thuộc các request khác nhau) CÓ THỂ cùng tồn tại trùng khung thời gian — đây là chủ đích thiết kế (xem FR-012), không phải bug; ràng buộc "chỉ một cái được giữ phòng" chỉ áp dụng khi có booking chuyển sang `approved`.
- `meeting_participants` có unique constraint trên cặp (meeting_id, user_id).
- `meeting_requests` có unique constraint trên meeting_id cho cùng request_type (chỉ một request create_meeting cho mỗi meeting).
- `start_time` phải nhỏ hơn `end_time`.
- `start_time` không được nằm trong quá khứ (so với thời điểm tạo).

### 5.6 Data Lifecycle

- **Tạo**: Khi người dùng submit form tạo cuộc họp thành công → tạo meeting (pending_approval) + meeting_requests (pending) + room_booking (pending).
- **Cập nhật**: Có thể được cập nhật bởi host/creator trong khi chờ duyệt (tính năng riêng).
- **Hủy**: Có thể bị hủy bởi host/creator trước khi được duyệt (tính năng riêng).
- **Duyệt**: Khi approver duyệt → meeting chuyển sang scheduled, booking chuyển sang approved (tính năng riêng).
- **Xóa mềm**: Soft delete (`deleted_at`) nếu cần hủy bỏ hoàn toàn.

### 5.7 Data-related EARS Requirements

```text
FR-DATA-001: WHEN yêu cầu cuộc họp được tạo thành công, THE system SHALL lưu `meetings` với các trường: title, description, organizer_id, host_id (mặc định là organizer_id nếu không cung cấp), room_id, start_time, end_time, meeting_type, meeting_mode, status = 'pending_approval'.

FR-DATA-002: WHEN participant được thêm vào cuộc họp, THE system SHALL lưu `meeting_participants` với participant_role, invitation_status = 'pending'.

FR-DATA-003: IF room_id được chỉ định không tồn tại hoặc không active, THEN THE system SHALL reject the request.

FR-DATA-004: IF cặp (meeting_id, user_id) trong meeting_participants bị trùng, THEN THE system SHALL reject the duplicate participant addition.

FR-DATA-005: WHEN yêu cầu cuộc họp được tạo thành công, THE system SHALL tạo `room_bookings` với meeting_id, room_id, reserved_start_time, reserved_end_time, status = 'pending'.

FR-DATA-006: WHEN yêu cầu cuộc họp được tạo thành công, THE system SHALL tạo `meeting_requests` với request_type = 'create_meeting', approval_status = 'pending', meeting_id trỏ tới meeting vừa tạo.

FR-DATA-007: WHEN yêu cầu cuộc họp được tạo, THE system SHALL tự động thêm host vào `meeting_participants` với participant_role = 'host' nếu host chưa có trong danh sách participant_user_ids.
```

### 5.8 Data Clarifications

- **Approver resolution**: Cần làm rõ cách xác định approver trong phase implementation. Các lựa chọn: (a) `system_configs` key, (b) `rooms.approver_id`, (c) user có permission `meeting_request.approve`. Mặc định dùng (c) trong v1.
- **notificationType**: Giá trị enum `MEETING_REQUEST_CREATED` hiện chưa có trong `NotificationType` enum của entity. Cần thêm vào enum hoặc dùng `MEETING_INVITE` tạm thời.
- Database v3.2 Compact đã đầy đủ các bảng cần thiết cho feature này.

---

## 6. Error Handling

> Error requirements nên dùng `IF ... THEN THE system SHALL ...` để đúng EARS Unwanted Behavior Pattern.

### 6.1 Validation Errors

```text
ERR-001: IF `title` bị thiếu hoặc chỉ gồm khoảng trắng, THEN THE system SHALL reject the request và trả về lỗi validation "Tiêu đề cuộc họp không được để trống".

ERR-002: IF `start_time` không đúng định dạng thời gian (ISO 8601), THEN THE system SHALL reject the request và trả về lỗi validation.

ERR-003: IF `end_time` không đúng định dạng thời gian, THEN THE system SHALL reject the request và trả về lỗi validation.

ERR-004: IF `participant_user_ids` không phải là mảng UUID hợp lệ hoặc chứa UUID không tồn tại, THEN THE system SHALL reject the request và trả về lỗi validation.

ERR-005: IF `external_participants` chứa email không đúng định dạng, THEN THE system SHALL reject the request và trả về lỗi validation.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-006: IF the user is not authenticated, THEN THE system SHALL return an authentication error (401).

ERR-007: IF the user does not have `meeting.create` permission, THEN THE system SHALL return an authorization error (403).

ERR-008: IF the authenticated user's account is locked or inactive, THEN THE system SHALL reject the request and return an appropriate error.
```

### 6.3 Business Rule Errors

```text
ERR-009: IF `end_time` <= `start_time`, THEN THE system SHALL reject the request và trả về lỗi "Thời gian kết thúc phải sau thời gian bắt đầu".

ERR-010: IF `start_time` nằm trong quá khứ (trước thời điểm hiện tại), THEN THE system SHALL reject the request và trả về lỗi "Thời gian bắt đầu không được nằm trong quá khứ".

ERR-011: IF `room_id` không tồn tại hoặc phòng không active, THEN THE system SHALL reject the request và trả về lỗi "Phòng họp không tồn tại hoặc không khả dụng".
```

### 6.4 Conflict Errors

```text
ERR-012: IF phòng họp được chọn đã có booking khác ở trạng thái `approved`/`active` trong cùng khung thời gian, THEN THE system SHALL reject the request và trả về lỗi "Phòng họp này vừa được đặt. Vui lòng chọn một phòng khác hoặc đổi khung giờ." Booking `pending` không kích hoạt lỗi này.

ERR-013: IF người dùng chọn participant có lịch họp khác trùng thời gian, THEN THE system SHALL hiển thị cảnh báo mềm (không chặn tạo) và đánh dấu participant đó là "Bận" trong giao diện chọn.
```

### 6.5 Integration / Device / External Service Errors

(Không áp dụng cho feature này — integration với device/camera là feature riêng.)

### 6.6 Error Response Expectations

Response lỗi nên có tối thiểu:

| Field | Mô tả |
|---|---|
| `statusCode` | HTTP status code hoặc mã lỗi tương ứng |
| `message` | Thông báo lỗi có thể hiển thị/diễn giải |
| `error` | Loại lỗi ngắn gọn |
| `details` | Chi tiết lỗi validation/business nếu cần |
| `timestamp` | Thời điểm xảy ra lỗi |

---

## 7. Acceptance Criteria

> Acceptance Criteria phải kiểm thử được.
> Ưu tiên format Given / When / Then.
> Acceptance Criteria không bắt buộc là EARS, nhưng phải trace được về FR/ERR/NFR.

### 7.1 Happy Path

```text
AC-001: Tạo yêu cầu cuộc họp thành công với đầy đủ thông tin
Given người dùng đã đăng nhập và có quyền `meeting.create`,
  phòng họp A còn trống trong khung giờ 14:00-15:00,
When người dùng nhập title="Họp dự án", chọn host, chọn phòng A, chọn thời gian 14:00-15:00,
  thêm 3 participant nội bộ, 1 external participant,
  và nhấn "Tạo cuộc họp",
Then hệ thống tạo meeting record với status = "pending_approval",
  tạo meeting_requests record với approval_status = "pending",
  tạo room booking cho phòng A với status = "pending",
  tạo 4 records trong `meeting_participants` (3 participant + 1 host auto-added) và 1 record trong `meeting_external_participants`,
  tạo notification record với type thông báo cho approver,
  và trả về thông tin chi tiết yêu cầu cuộc họp.
```

### 7.2 Validation Cases

```text
AC-002: Tạo cuộc họp với tiêu đề trống
Given người dùng đã đăng nhập,
When người dùng để trống trường "Tiêu đề" và nhấn "Tạo cuộc họp",
Then the system rejects the request và trả về lỗi validation "Tiêu đề cuộc họp không được để trống".

AC-003: Tạo cuộc họp với thời gian kết thúc trước thời gian bắt đầu
Given người dùng đã đăng nhập,
When người dùng nhập start_time = 15:00, end_time = 14:00,
Then the system rejects the request và trả về lỗi "Thời gian kết thúc phải sau thời gian bắt đầu".

AC-004: Tạo cuộc họp với thời gian trong quá khứ
Given người dùng đã đăng nhập,
When người dùng nhập start_time là thời gian trong quá khứ,
Then the system rejects the request và trả về lỗi "Thời gian bắt đầu không được nằm trong quá khứ".
```

### 7.3 Authorization Cases

```text
AC-005: Người dùng chưa đăng nhập
Given người dùng chưa đăng nhập,
When người dùng truy cập API tạo cuộc họp,
Then the system returns authentication error (401).

AC-006: Người dùng không có quyền tạo cuộc họp
Given người dùng đã đăng nhập nhưng không có permission `meeting.create`,
When người dùng gửi yêu cầu tạo cuộc họp,
Then the system returns authorization error (403) và không tạo bất kỳ record nào.
```

### 7.4 Business Rule Cases

```text
AC-007: Xung đột phòng họp (room double-booking)
Given phòng họp A đã có booking `approved` hoặc `active` cho khung giờ 14:00-15:00,
When người dùng tạo cuộc họp mới với phòng A, thời gian 14:00-15:00,
Then the system rejects the request và trả về lỗi "Phòng họp này vừa được đặt. Vui lòng chọn một phòng khác hoặc đổi khung giờ."

AC-007b: Nhiều request pending cùng phòng/giờ được phép tồn tại song song
Given phòng họp A đã có một booking `pending` (thuộc request khác đang chờ duyệt) cho khung giờ 14:00-15:00, và KHÔNG có booking `approved`/`active` nào trùng giờ,
When người dùng tạo cuộc họp mới với phòng A, thời gian 14:00-15:00,
Then the system CHO PHÉP tạo request thành công (không reject), tạo thêm một `room_bookings` khác ở trạng thái `pending` cho cùng phòng/giờ. Việc chỉ một trong các request pending này được giữ phòng sẽ do Manager quyết định ở bước duyệt (xem `feat-review-meeting-request` AC-007).

AC-008: Vượt quá sức chứa phòng (capacity exceeded)
Given phòng A có capacity = 10,
  tổng số participant = 12,
  và request không có `capacity_override_confirmed`,
When người dùng nhấn "Tạo cuộc họp",
Then the system từ chối request và trả về lỗi "Số lượng người tham dự vượt quá sức chứa của phòng".

AC-008b: Vượt quá sức chứa nhưng có override
Given phòng A có capacity = 10,
  tổng số participant = 12,
  và request có `capacity_override_confirmed = true`,
When người dùng nhấn "Tạo cuộc họp",
Then the system chấp nhận request và ghi nhận capacity override vào audit log.
```

### 7.5 State Transition Cases

```text
AC-009: Trạng thái meeting sau khi tạo yêu cầu thành công
Given người dùng gửi yêu cầu tạo cuộc họp hợp lệ,
When the system completes the operation,
Then the system tạo meeting với status = "pending_approval" và ghi nhận thời gian created_at,
  đồng thời tạo meeting_requests với approval_status = "pending".

AC-010: Trạng thái room booking sau khi tạo yêu cầu thành công
Given người dùng tạo cuộc họp với phòng A,
When the system completes the operation,
Then the system tạo room booking với status = "pending" và reserved_start_time, reserved_end_time tương ứng.
```

### 7.6 Audit / Notification Cases

```text
AC-011: Ghi audit log khi tạo cuộc họp thành công
Given người dùng tạo cuộc họp thành công,
When the system completes the operation,
Then the system ghi audit log với action_type = "create", entity_type = "meeting_request", entity_id = meeting_request_id, và metadata JSON chứa meeting_id và booking_id.

AC-012: Tạo notification cho approver
Given người dùng tạo yêu cầu cuộc họp thành công,
When the system completes the operation,
Then the system tạo notification record với type thông báo yêu cầu mới,
  recipient_user_ids_json chứa user_id của approver,
  delivery_status = "queued" (hoặc tương đương).
```

### 7.7 Integration / Device Cases

(Không áp dụng — Integration với device/camera là feature riêng.)

### 7.8 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-002, FR-003, FR-004, FR-005, FR-008, FR-009, FR-010, FR-031b, FR-DATA-006, FR-DATA-007 | Tạo yêu cầu thành công với pending_approval (4 meeting_participants) |
| AC-002 | FR-023, ERR-001 | Validation title trống |
| AC-003 | FR-018, ERR-009 | Validation end_time < start_time |
| AC-004 | FR-019, ERR-010 | Validation thời gian quá khứ |
| AC-005 | FR-027, ERR-006 | Unauthenticated |
| AC-006 | FR-028, ERR-007 | Missing permission |
| AC-007 | FR-017, ERR-012 | Room double-booking (approved/active) |
| AC-007b | FR-012 | Nhiều request pending cùng phòng/giờ được phép song song |
| AC-008 | FR-020 | Capacity exceeded |
| AC-008b | FR-020, FR-014 | Capacity override |
| AC-009 | FR-002, FR-030, FR-031b | State pending_approval + request pending |
| AC-010 | FR-003, FR-031 | Booking pending |
| AC-011 | FR-035 | Audit log |
| AC-012 | FR-034 | Notification cho approver |

---

## 8. Out of Scope

> Phần này rất quan trọng để agent không tự mở rộng feature.

Các nội dung sau **không thuộc phạm vi** của feature này:

- Quy trình phê duyệt (approve/reject) yêu cầu cuộc họp — feature này chỉ tạo yêu cầu chờ duyệt (pending_approval), không xử lý hành động duyệt/từ chối.
- Tạo cuộc họp định kỳ (recurrence) — thuộc tính năng riêng với `meeting_recurrence_rules`.
- Tạo cuộc họp từ template hoặc clone cuộc họp có sẵn.
- Import danh sách participant từ file Excel/CSV.
- Tích hợp với lịch ngoài (Google Calendar, Outlook, v.v.).
- Chỉnh sửa, hủy, cập nhật cuộc họp sau khi tạo.
- Gửi email thực tế (SMTP integration) — chỉ tạo notification record, delivery do background job xử lý.
- Xử lý no-show, auto-release phòng — thuộc module `utilization`.
- Tích hợp với camera/IoT để điểm danh — thuộc module `attendance`, `presence`, `iot`.

### 8.1 Không triển khai trong feature này

- Không implement API cho các bảng đã bị loại bỏ như `schedule_conflicts`, `documents`, `meeting_action_items`.
- Không implement hành động duyệt/từ chối (approve/reject) — feature này chỉ tạo meeting_requests với approval_status = pending.
- Không implement gửi email thực tế — chỉ tạo notification record trong database.
- Không implement WebSocket push cho sự kiện tạo meeting — có thể bổ sung sau.

### 8.2 Có thể xem xét ở feature khác

- Chỉnh sửa cuộc họp (update meeting).
- Hủy cuộc họp (cancel meeting).
- Phê duyệt yêu cầu họp (approve/reject meeting request) — feature riêng.
- Tạo cuộc họp định kỳ (recurring meeting).
- Import participant từ file.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement approve/reject actions on meeting_requests as part of this feature — it only creates the request record with status = pending.

OOS-002: THE system SHALL NOT create new database tables or fields beyond the existing 39 tables in v3.2 Compact for this feature.

OOS-003: THE system SHALL NOT implement actual email delivery (SMTP integration) — only notification records in the database.

OOS-004: THE system SHALL NOT integrate with external calendar providers (Google Calendar, Outlook, etc.) in this feature.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Requirement sử dụng keyword EARS bằng tiếng Anh: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [x] Đã cân nhắc Complex / Combined EARS Requirements nếu feature có nhiều điều kiện.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới nếu chưa có căn cứ.
- [x] Error handling đã bao gồm validation, authentication, authorization, business rule, conflict.
- [x] Error requirements đã ưu tiên format `IF ... THEN THE system SHALL ...`.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [x] Các phần thiếu thông tin đã được đưa vào `Cần làm rõ`.
