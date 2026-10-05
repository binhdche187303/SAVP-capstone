# Feature Specification: Gửi nhắc nhở lịch họp (Send Meeting Reminder)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo spec cho UC-144 | Toàn bộ file |

> Nguồn gốc: **UC-144** trong `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 15 (dòng 4717-4745).

## 1. Context & Goal

### 1.1 Bối cảnh
Đã xác nhận đọc code: `SchedulerService.sendReminders()` (`src/modules/scheduler/scheduler.service.ts:238-245`) là 1 cron job **đã tồn tại nhưng chỉ log, chưa implement** — comment gốc trong code: `"TODO: Gọi NotificationsService.sendScheduledReminders() khi implement."`. Đây là phần **tự động, theo lịch** (auto reminder trước giờ họp X phút, toàn hệ thống).

UC-144 trong phạm vi tài liệu này chỉ cover phần **thủ công** (`POST /meetings/{meetingId}/reminders`, do Host/Organizer/Admin chủ động gọi cho 1 meeting cụ thể) — theo đúng nguồn gốc UC trong `API_CONTRACT_v1.0_with_system_roles.md`. Phần cron tự động toàn hệ thống (`sendReminders()`) là 1 TODO **đã tồn tại từ trước, độc lập** — feature này **không** implement lại toàn bộ cron logic, nhưng thiết kế DTO/entity theo cách để cron job tương lai có thể tái sử dụng cùng 1 con đường ghi dữ liệu (`scheduledSendAt` trên `notifications`) nếu Product Owner sau này quyết định nối 2 luồng lại.

### 1.2 Mục tiêu
Cung cấp `POST /api/v1/meetings/{meetingId}/reminders` cho phép Host/Organizer/Admin gửi nhắc lịch họp ngay lập tức (`reminderType=manual`) tới toàn bộ participant hiện tại, hoặc đặt lịch gửi vào 1 thời điểm tương lai (`sendAt`) — trường hợp sau chỉ **tạo bản ghi `notifications` với `scheduledSendAt` đã set và `deliveryStatus=draft`**, việc thực sự dispatch tại đúng thời điểm là trách nhiệm của dispatcher riêng (xem mục 8 Out of Scope).

### 1.3 Giá trị mang lại
- Cho Host công cụ chủ động nhắc participant thay vì chỉ phụ thuộc cron toàn hệ thống (vốn đang là TODO, chưa chạy).
- Chuẩn bị sẵn field `scheduledSendAt` đúng schema, để khi cron `sendReminders()` được implement sau này, chỉ cần query `notifications WHERE notification_type='reminder' AND delivery_status='draft' AND scheduled_send_at <= NOW()` là dùng lại được ngay, không cần đổi schema.

### 1.4 Giả định
- `reminderType` nhận 2 giá trị: `manual` (gửi ngay, bỏ qua `sendAt` nếu có truyền) và `scheduled` (bắt buộc phải có `sendAt` hợp lệ, ở tương lai).
- Gửi cho toàn bộ participant hiện tại của meeting (internal + external) — không filter theo trạng thái tham dự/attendance.
- Không giới hạn số lần gọi — Host có thể nhắc nhiều lần cho cùng 1 meeting (idempotency không áp dụng, mỗi lần gọi là 1 hành động chủ động độc lập, giống UC-143).
- Không gửi nhắc cho meeting đã `cancelled` hoặc đã `completed`/`in_progress` — nhắc lịch chỉ có ý nghĩa khi meeting còn ở tương lai (`status=scheduled` VÀ `startTime > NOW()`).

### 1.5 Cần làm rõ — quyết định trong phạm vi tài liệu này
- **`sendAt` trong quá khứ?** Trả lỗi `400 VALIDATION_ERROR` (không cho đặt lịch nhắc trong quá khứ — vô nghĩa).
- **`reminderType=scheduled` nhưng thiếu `sendAt`?** Trả lỗi `400 VALIDATION_ERROR`.
- **`sendAt` sau `meeting.startTime`?** Trả lỗi `409 REMINDER_AFTER_MEETING_START` — nhắc lịch sau khi họp đã bắt đầu không có ý nghĩa nghiệp vụ.

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Host (`meetings.host_id`)/Organizer (`meetings.organizer_id`), Business Admin, System Admin.
- **Secondary Actor**: Participant internal/external (nhận thông báo).

### 2.2 Role & Permission Rules
- Permission mới: `notification.reminder.send` (`module_code=notifications`, `action_code=reminder.send`).
- Role mặc định: `EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (role code đúng — KHÔNG `INTERNAL_USER`, xem ghi chú tương tự tại `feat-send-meeting-invitation/spec.md` mục 2.2).

### 2.3 Actor Constraints
Giống hệt `feat-send-meeting-invitation` mục 2.3 (ownership-or-admin).

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép Host/Organizer/Admin gửi nhắc lịch họp ngay (`manual`) hoặc đặt lịch gửi trong tương lai (`scheduled`) cho 1 meeting.

### 3.2 Event-driven Requirements
- **FR-002**: WHEN `POST /meetings/:meetingId/reminders` được gọi, THE system SHALL kiểm tra tuần tự: (1) meeting tồn tại + chưa xóa mềm, (2) ownership-or-admin, (3) `meeting.status = scheduled` AND `meeting.startTime > NOW()`, (4) nếu `reminderType=scheduled` thì `sendAt` hợp lệ (tương lai, trước `startTime`).
- **FR-003**: WHEN `reminderType=manual` (hoặc không truyền `sendAt`), THE system SHALL gửi ngay — hành vi giống hệt `feat-send-meeting-invitation` (IN_APP qua `createNotification`, EMAIL qua `enqueueEmailNotification`), chỉ khác `notificationType=reminder` và nội dung.
- **FR-004**: WHEN `reminderType=scheduled` với `sendAt` hợp lệ, THE system SHALL tạo 1 bản ghi `notifications` (`notificationType=reminder`, `deliveryStatus=draft`, `scheduledSendAt=sendAt`) nhưng KHÔNG enqueue BullMQ job ngay (job thực sự dispatch tại `sendAt` là out of scope, xem mục 8).
- **FR-005**: WHEN gửi/đặt lịch thành công, THE system SHALL trả `202` với `{ notificationId, deliveryStatus, scheduledSendAt }` đúng theo contract.
- **FR-006**: WHEN thành công, THE system SHALL ghi 1 bản ghi `audit_logs` (`action_type = meeting_reminder_sent` hoặc `meeting_reminder_scheduled` tùy `reminderType`).

### 3.3 State-driven Requirements
- **FR-007**: WHILE `meeting.status != scheduled` HOẶC `meeting.startTime <= NOW()`, THE system SHALL từ chối, trả `409 MEETING_NOT_UPCOMING`.

### 3.4 Unwanted Behavior Requirements
- **FR-008**: IF meeting không tồn tại/đã xóa mềm, THEN `404 MEETING_NOT_FOUND`.
- **FR-009**: IF người gọi không thỏa ownership-or-admin, THEN `403 NOT_MEETING_OWNER`.
- **FR-010**: IF người gọi không có permission `notification.reminder.send`, THEN `403 FORBIDDEN`.
- **FR-011**: IF `reminderType=scheduled` mà thiếu/`sendAt` không hợp lệ (không phải ISO datetime, hoặc trong quá khứ), THEN `400 VALIDATION_ERROR`.
- **FR-012**: IF `sendAt` sau `meeting.startTime`, THEN `409 REMINDER_AFTER_MEETING_START`.
- **FR-013**: IF `channels` rỗng/không hợp lệ, THEN `400 VALIDATION_ERROR`.

### 3.5 Complex / Combined Requirements
- **FR-014**: IF meeting tồn tại AND `status=scheduled` AND `startTime` tương lai AND (ownership thỏa HOẶC Admin) AND input hợp lệ, THEN THE system SHALL xử lý theo đúng `reminderType`, ghi audit, trả `202`.

### 3.6 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-005 | `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-144 |
| FR-004 | Thiết kế nối tiếp `SchedulerService.sendReminders()` TODO hiện có (mục 1.1) |
| FR-007, FR-012 | Suy luận nghiệp vụ (mục 1.4/1.5) |

## 4. Non-functional Requirements

### 4.1 Performance
`manual` trả `202` ngay (bất đồng bộ qua BullMQ, giống UC-143). `scheduled` chỉ ghi 1 row DB, còn nhanh hơn.

### 4.2 Security
JWT + `notification.reminder.send` + ownership-or-admin bắt buộc.

### 4.3 Reliability & Consistency
Nhất quán "notification failure không rollback business action" — nhưng ở đây bản thân action CHÍNH LÀ tạo notification, nên nếu `enqueueEmailNotification` lỗi enqueue, response vẫn trả `202` (đã có `deliveryStatus=failed` ghi trong DB, client tự biết qua field này — không giả vờ thành công ở tầng HTTP status nhưng trung thực ở tầng `deliveryStatus`).

### 4.5 Observability
Log `meetingId`, `actorUserId`, `reminderType`, `sendAt` (nếu có).

### 4.6 Maintainability
Method mới `sendMeetingReminder()` trong `MeetingNotificationsService` (cùng service với UC-143, UC-145 — nhóm chung "gửi thông báo liên quan meeting").

## 5. Data Model

### 5.1 Entity liên quan
Giống `feat-send-meeting-invitation` mục 5.1 — thêm không có bảng mới.

### 5.2 Dữ liệu đầu vào
`POST /api/v1/meetings/:meetingId/reminders`:
```jsonc
{
  "channels": ["email", "in_app"],
  "reminderType": "manual",   // "manual" | "scheduled"
  "sendAt": null                // bắt buộc nếu reminderType="scheduled", ISO-8601
}
```

### 5.3 Dữ liệu đầu ra
```jsonc
{
  "success": true,
  "data": {
    "notificationId": "uuid",
    "deliveryStatus": "queued",   // "queued" nếu manual, "draft" nếu scheduled
    "scheduledSendAt": null
  }
}
```

### 5.4 State / Status Model
`notifications.deliveryStatus`: `manual` → `draft → queued → sent/failed` (nhất quán luồng hiện có). `scheduled` → dừng ở `draft` cho tới khi dispatcher (out of scope) xử lý.

## 6. Error Handling

| Điều kiện | HTTP | Code |
| :--- | ---: | :--- |
| `meetingId` không phải UUID | 400 | `VALIDATION_ERROR` |
| `channels` rỗng/không hợp lệ | 400 | `VALIDATION_ERROR` |
| `reminderType=scheduled` thiếu/sai `sendAt` | 400 | `VALIDATION_ERROR` |
| Không có JWT | 401 | — |
| Không có permission | 403 | `FORBIDDEN` |
| Không phải Owner/Admin | 403 | `NOT_MEETING_OWNER` |
| Meeting không tồn tại | 404 | `MEETING_NOT_FOUND` |
| Meeting không `scheduled`/đã bắt đầu | 409 | `MEETING_NOT_UPCOMING` |
| `sendAt` sau `startTime` | 409 | `REMINDER_AFTER_MEETING_START` |

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN meeting `M` `status=scheduled`, `startTime` tương lai, WHEN Host gọi `reminderType=manual`, THEN trả `202`, `deliveryStatus=queued`, tạo notification IN_APP + EMAIL cho toàn bộ participant.
- **AC-002**: GIVEN cùng meeting, WHEN Host gọi `reminderType=scheduled`, `sendAt` = 1 giờ trước `startTime`, THEN trả `202`, `deliveryStatus=draft`, `scheduledSendAt` đúng giá trị truyền vào, KHÔNG enqueue BullMQ job.

### 7.2 Authorization Cases
- **AC-003**: GIVEN participant thường gọi API, THEN `403 NOT_MEETING_OWNER`.

### 7.3 Business Rule Cases
- **AC-004**: GIVEN meeting `status=in_progress`, WHEN Host gọi API, THEN `409 MEETING_NOT_UPCOMING`.
- **AC-005**: GIVEN `reminderType=scheduled`, `sendAt` sau `meeting.startTime`, THEN `409 REMINDER_AFTER_MEETING_START`.
- **AC-006**: GIVEN `reminderType=scheduled` không truyền `sendAt`, THEN `400 VALIDATION_ERROR`.

### 7.4 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-003, FR-005 |
| AC-002 | FR-004, FR-005 |
| AC-003 | FR-009 |
| AC-004 | FR-007 |
| AC-005 | FR-012 |
| AC-006 | FR-011 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Dispatcher thực sự gửi các notification `reminder`/`draft`/`scheduledSendAt` đến hạn (implement `SchedulerService.sendReminders()` → `NotificationsService.sendScheduledReminders()`) — đây là 1 TODO **đã tồn tại từ trước** (`scheduler.service.ts:236-245`), thuộc phạm vi 1 feature riêng (auto reminder toàn hệ thống), không phải phạm vi UC-144 thủ công.
- Hủy 1 reminder đã đặt lịch (`scheduled`) trước khi tới hạn — không có endpoint DELETE trong contract UC-144.
- Nhắc theo từng participant riêng lẻ (chỉ nhắc người chưa check-in) — ngoài phạm vi contract hiện tại.

### 8.2 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT tự động dispatch notification `reminder` có `scheduledSendAt` trong tương lai — việc dispatch thuộc scheduler job riêng, chưa implement.
- **FR-OOS-002**: THE system SHALL NOT cho phép gửi reminder cho meeting đã `cancelled`/`completed`/`in_progress`.

## Assumptions
Xem mục 1.4 và 1.5.
