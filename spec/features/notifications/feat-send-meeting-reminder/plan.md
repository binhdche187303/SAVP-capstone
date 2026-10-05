# Implementation Plan: Send Meeting Reminder

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo plan cho feat-send-meeting-reminder (UC-144) | Toàn bộ file |

## 1. Feature Summary
Thêm route `POST /meetings/:meetingId/reminders` vào `NotificationsController` (đã tạo ở `feat-send-meeting-invitation`), method mới `sendMeetingReminder()` trong `MeetingNotificationsService` (cùng service với UC-143). Tái sử dụng gần như toàn bộ hạ tầng của UC-143, chỉ khác: `notificationType=reminder`, có thêm nhánh `scheduled` (chỉ ghi row, không enqueue).

## 2. Technical Context

### 2.1 Tech Stack
Không thêm dependency. Không thêm bảng.

### 2.2 Existing Codebase Analysis
| Thành phần | Vị trí | Vai trò |
| :--- | :--- | :--- |
| `MeetingNotificationsService` | `notifications/services/meeting-notifications.service.ts` (đã tạo ở UC-143) | Thêm method `sendMeetingReminder()` |
| `NotificationsController` | `notifications/notifications.controller.ts` (đã tạo ở UC-143) | Thêm route `POST :meetingId/reminders` |
| `NotificationsService.createNotification()` | `notifications/notifications.service.ts` | Tái sử dụng nguyên trạng cho nhánh `scheduled` (tạo row `draft` với `scheduledSendAt`) |
| `SchedulerService.sendReminders()` | `scheduler/scheduler.service.ts:238-245` | KHÔNG sửa trong feature này — chỉ ghi chú liên hệ ở spec.md mục 8 |

### 2.3 Patterns to Follow
Giống hệt `feat-send-meeting-invitation/plan.md` mục 2.3.

## 3. Scope Confirmation

### 3.1 In Scope
1 endpoint `POST /meetings/:meetingId/reminders`, method service mới, 1 permission mới `notification.reminder.send`.

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-02, SEC-03 | PASS (giống UC-143) |
| ARCH-02 (async cho >2s) | PASS — nhánh `manual` qua BullMQ, nhánh `scheduled` chỉ ghi DB (nhanh, đồng bộ, không cần async) |
| ARCH-03 (idempotency) | N/A — mỗi lần gọi là 1 hành động chủ động độc lập, không có khái niệm "gọi lại = no-op" |
| ENG-01 | Áp dụng |

### 3.4 Complexity Tracking
Thấp — tái sử dụng gần như toàn bộ hạ tầng UC-143. Điểm khác biệt duy nhất cần cẩn trọng: KHÔNG được vô tình enqueue BullMQ job cho nhánh `scheduled` (dễ nhầm vì code rất giống nhánh `manual`).

## 4. Data Model Impact
0 bảng mới, 0 cột mới. 1 permission mới.

## 5. API / Contract Plan
`POST /api/v1/meetings/:meetingId/reminders` — trả `202`. Request/Response khớp `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-144.
Error: `400`, `401`, `403 FORBIDDEN/NOT_MEETING_OWNER`, `404 MEETING_NOT_FOUND`, `409 MEETING_NOT_UPCOMING/REMINDER_AFTER_MEETING_START`.

## 6. Authorization Plan
`notification.reminder.send` — flow giống hệt UC-143 mục 6.2.

## 7. Business Logic Plan

### 7.1 Flow — `sendMeetingReminder`
```text
1-2. Giống bước 1-2 của sendMeetingInvitation (load meeting, ownership-or-admin)
3. IF meeting.status !== 'scheduled' OR meeting.startTime <= NOW() -> 409 MEETING_NOT_UPCOMING
4. IF dto.reminderType === 'scheduled':
     IF !dto.sendAt OR sendAt <= NOW() -> 400 VALIDATION_ERROR
     IF sendAt > meeting.startTime -> 409 REMINDER_AFTER_MEETING_START
     notification = await notificationsService.createNotification({
       notificationType: REMINDER, channel: dto.channels.includes('email') ? EMAIL : IN_APP,
       // Lưu ý: createNotification chỉ nhận 1 channel — nếu dto.channels có cả 2,
       // gọi createNotification() 2 lần (1 cho email, 1 cho in_app), cả 2 đều deliveryStatus=draft
       subject: `Nhắc lịch họp: ${meeting.title}`, content, relatedEntityType:'meeting',
       relatedEntityId: meetingId, recipientScope:'user_list', recipientUserIds: internalUserIds,
       scheduledSendAt: dto.sendAt, createdBy: actorUserId,
     })
     auditLogsService.logAction({ actionType: 'meeting_reminder_scheduled', ... })
     Trả 202 { notificationId: notification.id, deliveryStatus: 'draft', scheduledSendAt: dto.sendAt }
5. ELSE (manual, mặc định):
     // Giống hệt bước 6-9 của sendMeetingInvitation, đổi notificationType=REMINDER, subject khác
     auditLogsService.logAction({ actionType: 'meeting_reminder_sent', ... })
     Trả 202 { notificationId, deliveryStatus: 'queued', scheduledSendAt: null }
```

### 7.2 Key Business Rules Implemented
Chỉ meeting `scheduled` + tương lai mới nhắc được; `scheduled` type chỉ ghi row, không dispatch; `sendAt` phải trước `startTime`.

## 8. Validation Plan

### 8.1 Input Validation (DTO)
`SendMeetingReminderDto`:
- `channels` — giống UC-143.
- `reminderType: 'manual' | 'scheduled'` — `@IsIn(['manual','scheduled'])`, default `'manual'` nếu không truyền.
- `sendAt?: string` — `@IsOptional() @IsISO8601()`; validate bắt buộc khi `reminderType==='scheduled'` ở tầng service (cross-field validation, không dùng decorator class-validator đơn thuần).

### 8.2 Business Validation (Service)
Theo thứ tự mục 7.1.

## 9. Error Handling Plan

| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Meeting không tồn tại | `NotFoundException` | `MEETING_NOT_FOUND` |
| Không phải Owner/Admin | `ForbiddenException` | `NOT_MEETING_OWNER` |
| Meeting không upcoming | `ConflictException` | `MEETING_NOT_UPCOMING` |
| `sendAt` thiếu/không hợp lệ khi `scheduled` | `BadRequestException` | `VALIDATION_ERROR` |
| `sendAt` sau `startTime` | `ConflictException` | `REMINDER_AFTER_MEETING_START` |

## 10. Testing Strategy

### 10.1 Unit Tests — Service
Happy path `manual`, happy path `scheduled` (đúng `scheduledSendAt`, KHÔNG gọi `queueService.addJob`), meeting không upcoming (409), `sendAt` quá khứ (400), `sendAt` sau `startTime` (409), not-owner (403).

### 10.2 Unit Tests — Controller
Route trả đúng response shape cho cả 2 `reminderType`.

## 11. Implementation Phases

### Phase 1: DTO
`SendMeetingReminderDto`.

### Phase 2: Service Logic
`MeetingNotificationsService.sendMeetingReminder()`.

### Phase 3: Controller Endpoint
Thêm route vào `NotificationsController` đã có.

### Phase 4: Seed & Tests
Migration seed `notification.reminder.send` (role code `EMPLOYEE`, không `INTERNAL_USER`). Unit test service + controller.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Nhầm nhánh `scheduled` vẫn enqueue BullMQ job (gửi email ngay dù đặt lịch tương lai) | Test riêng khẳng định `scheduled` KHÔNG gọi `queueService.addJob`/`enqueueEmailNotification`, chỉ gọi `createNotification` (mock `QueueService`, assert `addJob` không được gọi) |
| `createNotification()` hiện tại chỉ nhận 1 `channel` duy nhất (không phải mảng) — cần gọi 2 lần nếu `channels` có cả `email` và `in_app` cho nhánh `scheduled` | Ghi rõ trong pseudo-code mục 7.1 bước 4; test riêng xác nhận tạo đúng 2 row khi `channels=['email','in_app']` |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.4.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`.
