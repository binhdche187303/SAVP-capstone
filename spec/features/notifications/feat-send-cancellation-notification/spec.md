# Feature Specification: Phát thông báo hủy cuộc họp (Send/Resend Cancellation Notification)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo spec cho UC-145 — sau khi xác nhận bằng đọc code thật rằng luồng auto-notify **đã tồn tại**, feature này chỉ bổ sung khả năng gửi lại (resend) thủ công | Toàn bộ file |

> Nguồn gốc: **UC-145** trong `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 15 (dòng 4749-4776).

## 1. Context & Goal

### 1.1 Bối cảnh — đã xác nhận bằng đọc code thật
Yêu cầu gốc đặt câu hỏi: *"có thể đã được trigger tự động ở meetings.controller.ts khi cancel, cần kiểm tra có đang gọi NotificationsService không, nếu không thì bổ sung"*.

Đã đọc trực tiếp `MeetingsService.cancelMeeting()` (`src/modules/meetings/services/meetings.service.ts:1977-2355`) và xác nhận: **luồng tự động ĐÃ tồn tại và ĐANG hoạt động**, nằm trong `MeetingsService` (không phải `MeetingsController`), cụ thể ở bước "Step 5 — Outside transaction" (dòng 2257-2355):
- Sau khi transaction hủy meeting commit thành công, code tự động:
  1. Gọi `notificationsService.createNotification()` với `notificationType=CANCELLATION`, `channel=IN_APP`, gửi cho toàn bộ internal participant + organizer + host.
  2. Gọi `notificationsService.enqueueEmailNotification()` gửi email cho internal participant (trừ actor) + external participant.
  3. Nếu bước enqueue lỗi, catch riêng, ghi `audit_logs` (`action_type=notification_failure`) — **không** rollback transaction hủy meeting, không throw lỗi ra client.

Do đó, phần **"bổ sung nếu chưa có" là KHÔNG CẦN** — luồng chính đã đúng thiết kế. Điều còn thiếu, đúng với UC-145 trong `API_CONTRACT_v1.0_with_system_roles.md`, là **API độc lập `POST /meetings/{meetingId}/cancellation-notifications`** — dùng để:
1. **Gửi lại (resend)** thông báo hủy cho 1 meeting đã `cancelled` — trường hợp luồng tự động thất bại (`notificationStatus='failed_to_queue'`, đã có audit log `notification_failure`), hoặc participant claim chưa nhận được thông báo.
2. Cho phép truyền `reason` khác/bổ sung so với `cancellationReason` gốc đã lưu lúc hủy (ví dụ làm rõ thêm lý do sau khi đã hủy).

### 1.2 Mục tiêu
Cung cấp `POST /api/v1/meetings/{meetingId}/cancellation-notifications` cho phép Host/Organizer/Admin gửi lại thông báo hủy cho 1 meeting **đã ở trạng thái `cancelled`**, độc lập với luồng tự động trong `cancelMeeting()` (không sửa, không thay thế luồng đó).

### 1.3 Giá trị mang lại
- Có công cụ khắc phục khi luồng tự động thất bại (BullMQ down tạm thời, mail server lỗi) mà không cần can thiệp DB thủ công.
- Không đánh đổi tính nhất quán của luồng tự động hiện có — giữ nguyên `cancelMeeting()`, không sửa 1 dòng nào trong đó.

### 1.4 Giả định
- Chỉ gọi được khi `meeting.status = cancelled` (nếu meeting chưa hủy, endpoint này không có ý nghĩa — dùng nhầm phải bị chặn rõ ràng, không tự ý hủy giúp).
- Mỗi lần gọi tạo 1 notification mới độc lập (không kiểm tra "đã gửi thành công trước đó chưa" — đây là hành động resend chủ động, không cần chặn trùng, giống UC-143/144).
- `reason` trong request là optional — nếu không truyền, dùng lại `meeting.cancellationReason` đã lưu từ lúc hủy.

### 1.5 Cần làm rõ — quyết định trong phạm vi tài liệu này
- **Vì sao không dùng chung logic `cancelMeeting()`?** Vì `cancelMeeting()` thực hiện TOÀN BỘ transaction hủy (đổi status, release room, ghi event) — không thể gọi lại an toàn cho 1 meeting đã `cancelled` (sẽ bị chặn ở `409 INVALID_MEETING_STATUS` nếu gọi lại `cancelMeeting`). Feature này tách riêng phần "chỉ gửi thông báo", tái sử dụng đúng đoạn logic notification (đọc participant, build content, gọi `NotificationsService`) nhưng KHÔNG đụng vào state machine của meeting.

## 2. Actor & Roles

### 2.1 Danh sách actor
Giống `feat-send-meeting-invitation` mục 2.1 (Host/Organizer/Admin).

### 2.2 Role & Permission Rules
- Permission mới: `notification.cancellation.send` (`module_code=notifications`, `action_code=cancellation.send`).
- Role mặc định: `EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (role code đúng — xem ghi chú lặp lại tại `feat-send-meeting-invitation/spec.md` mục 2.2, áp dụng như nhau cho mọi migration seed permission mới của module `notifications`).

### 2.3 Actor Constraints
Ownership-or-admin giống UC-143/144.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép Host/Organizer/Admin gửi lại thông báo hủy cho 1 meeting đã `cancelled`.

### 3.2 Event-driven Requirements
- **FR-002**: WHEN `POST /meetings/:meetingId/cancellation-notifications` được gọi, THE system SHALL kiểm tra tuần tự: (1) meeting tồn tại + chưa xóa mềm, (2) ownership-or-admin, (3) `meeting.status = cancelled`.
- **FR-003**: WHEN hợp lệ, THE system SHALL đọc participant hiện tại (internal + external) — LƯU Ý: participant list tại thời điểm resend có thể ĐÃ KHÁC so với lúc hủy gốc (ví dụ participant bị remove sau đó) — resend gửi theo danh sách **hiện tại**, không phải snapshot lúc hủy.
- **FR-004**: WHEN `channels` chứa `in_app`, THE system SHALL gọi `createNotification()` với `notificationType=CANCELLATION`.
- **FR-005**: WHEN `channels` chứa `email`, THE system SHALL gọi `enqueueEmailNotification()` với `notificationType=CANCELLATION`.
- **FR-006**: WHERE `reason` được truyền trong request, THE system SHALL dùng `reason` đó trong nội dung; WHERE không truyền, THE system SHALL dùng lại `meeting.cancellationReason` đã lưu.
- **FR-007**: WHEN xử lý xong, THE system SHALL trả `202` với `{ meetingId, notificationId, queuedRecipientCount }` đúng contract.
- **FR-008**: WHEN thành công, THE system SHALL ghi `audit_logs` (`action_type = meeting_cancellation_notification_resent`) — khác `action_type` với luồng tự động (`notification_failure` hoặc không ghi gì khi thành công) để phân biệt rõ đây là hành động thủ công.

### 3.3 State-driven Requirements
- **FR-009**: WHILE `meeting.status != cancelled`, THE system SHALL từ chối, trả `409 MEETING_NOT_CANCELLED`.

### 3.4 Unwanted Behavior Requirements
- **FR-010**: IF meeting không tồn tại/đã xóa mềm, THEN `404 MEETING_NOT_FOUND`.
- **FR-011**: IF người gọi không thỏa ownership-or-admin, THEN `403 NOT_MEETING_OWNER`.
- **FR-012**: IF người gọi không có permission `notification.cancellation.send`, THEN `403 FORBIDDEN`.
- **FR-013**: IF `channels` rỗng/không hợp lệ, THEN `400 VALIDATION_ERROR`.

### 3.5 Complex / Combined Requirements
- **FR-014**: IF meeting tồn tại AND `status=cancelled` AND (ownership thỏa HOẶC Admin) AND input hợp lệ, THEN THE system SHALL gửi lại thông báo theo participant hiện tại, ghi audit, trả `202`.

### 3.6 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-007 | `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-145 |
| FR-002, FR-003 | Đọc code thật `cancelMeeting()` (mục 1.1) — tái sử dụng đúng pattern, không tái sử dụng snapshot |
| FR-009 | Suy luận nghiệp vụ — resend chỉ có ý nghĩa cho meeting đã hủy |

## 4. Non-functional Requirements

### 4.2 Security
JWT + `notification.cancellation.send` + ownership-or-admin.

### 4.3 Reliability & Consistency
KHÔNG sửa `MeetingsService.cancelMeeting()` — đảm bảo 0 risk regression cho luồng hủy meeting chính đang hoạt động đúng.

### 4.6 Maintainability
Method mới `resendCancellationNotification()` trong `MeetingNotificationsService` (cùng service UC-143/144). Nội dung notification build lại tương tự logic trong `cancelMeeting()` bước 2285-2289 nhưng KHÔNG import/gọi trực tiếp method private của `MeetingsService` — viết độc lập trong `MeetingNotificationsService` vì đã tránh phụ thuộc `MeetingsModule` (xem `feat-send-meeting-invitation/plan.md` mục 12).

## 5. Data Model

### 5.1 Entity liên quan
`MeetingEntity` (đọc `status`, `cancellationReason`, `organizerId`, `hostId`, `title`), `MeetingParticipantEntity`, `MeetingExternalParticipantEntity`, `UserEntity`, `NotificationEntity` (ghi), `AuditLogEntity` (ghi). Giống UC-143.

### 5.2 Dữ liệu đầu vào
`POST /api/v1/meetings/:meetingId/cancellation-notifications`:
```jsonc
{
  "reason": "Sự kiện thay thế đã lên lịch",  // optional
  "channels": ["email", "in_app"]
}
```

### 5.3 Dữ liệu đầu ra
```jsonc
{
  "success": true,
  "data": {
    "meetingId": "uuid",
    "notificationId": "uuid",
    "queuedRecipientCount": 8
  }
}
```

## 6. Error Handling

| Điều kiện | HTTP | Code |
| :--- | ---: | :--- |
| `meetingId` không phải UUID | 400 | `VALIDATION_ERROR` |
| `channels` rỗng/không hợp lệ | 400 | `VALIDATION_ERROR` |
| Không có JWT | 401 | — |
| Không có permission | 403 | `FORBIDDEN` |
| Không phải Owner/Admin | 403 | `NOT_MEETING_OWNER` |
| Meeting không tồn tại | 404 | `MEETING_NOT_FOUND` |
| Meeting chưa `cancelled` | 409 | `MEETING_NOT_CANCELLED` |

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN meeting `M` `status=cancelled`, WHEN Host gọi API không truyền `reason`, THEN trả `202`, nội dung notification dùng lại `meeting.cancellationReason` gốc.
- **AC-002**: GIVEN meeting `M` `status=cancelled`, WHEN Host gọi API với `reason` mới, THEN nội dung notification dùng `reason` mới (không sửa `meetings.cancellation_reason` trong DB — chỉ dùng cho nội dung thông báo lần này).

### 7.2 Authorization Cases
- **AC-003**: GIVEN participant thường gọi API, THEN `403 NOT_MEETING_OWNER`.

### 7.3 Business Rule Cases
- **AC-004**: GIVEN meeting `status=scheduled` (chưa hủy), WHEN Host gọi API, THEN `409 MEETING_NOT_CANCELLED`.
- **AC-005**: GIVEN meeting không tồn tại, THEN `404 MEETING_NOT_FOUND`.

### 7.4 Regression Cases
- **AC-006**: GIVEN feature này đã implement, WHEN gọi `POST /meetings/:id/cancel` (luồng hủy chính, UC hiện có), THEN hành vi auto-notify KHÔNG đổi (vẫn gửi tự động như trước, không bị ảnh hưởng bởi endpoint mới) — verify bằng cách chạy lại test suite hiện có của `cancelMeeting` sau khi thêm feature này, không được có test nào fail thêm.

### 7.5 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-002 | FR-003..008 |
| AC-003 | FR-011 |
| AC-004 | FR-009 |
| AC-005 | FR-010 |
| AC-006 | Non-functional 4.3 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Sửa `meetings.cancellation_reason` đã lưu (endpoint chỉ dùng `reason` cho nội dung thông báo, không cập nhật DB record của meeting).
- Sửa/refactor `MeetingsService.cancelMeeting()` — giữ nguyên 100%.
- Giới hạn số lần resend tối đa — không có cap trong đợt này.

### 8.2 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT thay đổi `meetings.status` hay bất kỳ field nào khác của bảng `meetings` qua endpoint này (read-only đối với `meetings`).
- **FR-OOS-002**: THE system SHALL NOT sửa đổi logic hoặc hành vi của `MeetingsService.cancelMeeting()`.

## Assumptions
Xem mục 1.4 và 1.5.
