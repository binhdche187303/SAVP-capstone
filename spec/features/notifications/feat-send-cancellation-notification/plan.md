# Implementation Plan: Send/Resend Cancellation Notification

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo plan cho feat-send-cancellation-notification (UC-145) | Toàn bộ file |

## 1. Feature Summary
Thêm route `POST /meetings/:meetingId/cancellation-notifications` + method `resendCancellationNotification()` trong `MeetingNotificationsService`. **Không sửa** `MeetingsService.cancelMeeting()` (luồng auto-notify hiện có giữ nguyên 100%, đã xác nhận hoạt động đúng).

## 2. Technical Context

### 2.1 Tech Stack
Không thêm dependency, không thêm bảng.

### 2.2 Existing Codebase Analysis
| Thành phần | Vị trí | Vai trò |
| :--- | :--- | :--- |
| `MeetingsService.cancelMeeting()` Step 5 (dòng 2257-2355) | `meetings/services/meetings.service.ts` | THAM KHẢO logic build content/resolve email — KHÔNG gọi trực tiếp (private method của service khác), viết lại tương đương trong `MeetingNotificationsService` |
| `MeetingEntity.cancellationReason` | `meetings/entities/meeting.entity.ts` | Đọc để dùng làm fallback khi `reason` không truyền |
| `MeetingNotificationsService` (đã tạo ở UC-143/144) | `notifications/services/meeting-notifications.service.ts` | Thêm method thứ 3 |

### 2.3 Patterns to Follow
Giống UC-143/144 — ownership-or-admin, DTO validate, `{success,message,data}`, `202`.

## 3. Scope Confirmation

### 3.1 In Scope
1 endpoint mới, 1 method service mới, 1 permission mới `notification.cancellation.send`. KHÔNG sửa file `meetings.service.ts`.

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-02, SEC-03 | PASS |
| ARCH-01 (service boundary) | PASS — không sửa `MeetingsModule`, chỉ đọc entity |
| ARCH-02 | PASS — email qua BullMQ |
| Regression risk | Rủi ro thấp — feature hoàn toàn cộng thêm (additive), không chạm code cũ. Kiểm chứng bằng chạy lại full test suite `meetings.service.spec.ts` sau khi hoàn tất (AC-006) |

### 3.4 Complexity Tracking
Thấp. Điểm cần cẩn trọng duy nhất: KHÔNG được vô tình import/sửa `cancelMeeting()` khi tìm cách "tái sử dụng logic" — phải viết lại độc lập trong service mới (xem mục 12 Risks).

## 4. Data Model Impact
0 bảng mới, 0 cột mới. 1 permission mới.

## 5. API / Contract Plan
`POST /api/v1/meetings/:meetingId/cancellation-notifications` — `202`. Request/response khớp `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-145.
Error: `400`, `401`, `403 FORBIDDEN/NOT_MEETING_OWNER`, `404 MEETING_NOT_FOUND`, `409 MEETING_NOT_CANCELLED`.

## 6. Authorization Plan
`notification.cancellation.send` — flow giống UC-143 mục 6.2.

## 7. Business Logic Plan

### 7.1 Flow — `resendCancellationNotification`
```text
1. SELECT meetings WHERE id = :meetingId AND deleted_at IS NULL
   IF không tồn tại -> 404 MEETING_NOT_FOUND
2. isAdmin/isOwner check -> 403 NOT_MEETING_OWNER nếu không thỏa
3. IF meeting.status !== 'cancelled' -> 409 MEETING_NOT_CANCELLED
4. reasonText = dto.reason?.trim() || meeting.cancellationReason || ''
5. SELECT meeting_participants + meeting_external_participants WHERE meeting_id = :meetingId
   internalUserIds = dedup([...participants.userId, meeting.organizerId, meeting.hostId])
6. content = `Cuộc họp "${meeting.title}" đã bị hủy.` + (reasonText ? ` Lý do: ${reasonText}` : '')
7. IF 'in_app' in dto.channels:
     await notificationsService.createNotification({ notificationType: CANCELLATION, channel: IN_APP,
       subject: `[CANCELLED] ${meeting.title}`, content, relatedEntityType:'meeting',
       relatedEntityId: meetingId, recipientScope:'user_list', recipientUserIds: internalUserIds,
       createdBy: actorUserId })
8. queuedRecipientCount = 0; notificationId = null
   IF 'email' in dto.channels:
     emailMap = resolveUserEmails(internalUserIds)
     toEmails = [...emailMap.values(), ...externalParticipants.map(e=>e.email).filter(Boolean)]
     IF toEmails.length > 0:
       result = await notificationsService.enqueueEmailNotification({ notificationType: CANCELLATION,
         channel: EMAIL, subject: `[CANCELLED] ${meeting.title}`, content, toEmails,
         relatedEntityType:'meeting', relatedEntityId: meetingId, recipientScope:'user_list',
         createdBy: actorUserId })
       notificationId = result.notification.id
     queuedRecipientCount = toEmails.length
9. auditLogsService.logAction({ actionType: 'meeting_cancellation_notification_resent',
     entityType:'meeting', entityId: meetingId,
     metadataJson: { channels: dto.channels, queuedRecipientCount, reason: reasonText } })
10. Trả 202 { meetingId, notificationId, queuedRecipientCount }
```

### 7.2 Key Business Rules Implemented
Chỉ resend được khi `status=cancelled`; participant list đọc lại tại thời điểm resend (không dùng snapshot cũ); không đụng state machine meeting.

## 8. Validation Plan

### 8.1 Input Validation (DTO)
`ResendCancellationNotificationDto`:
- `reason?: string` — `@IsOptional() @IsString() @MaxLength(1000)`.
- `channels` — giống UC-143.

### 8.2 Business Validation (Service)
Theo thứ tự mục 7.1: tồn tại → ownership-or-admin → status=cancelled.

## 9. Error Handling Plan

| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Meeting không tồn tại | `NotFoundException` | `MEETING_NOT_FOUND` |
| Không phải Owner/Admin | `ForbiddenException` | `NOT_MEETING_OWNER` |
| Meeting chưa `cancelled` | `ConflictException` | `MEETING_NOT_CANCELLED` |

## 10. Testing Strategy

### 10.1 Unit Tests — Service mới
Happy path (có/không `reason` truyền vào, fallback đúng `cancellationReason`), not-owner (403), meeting chưa cancelled (409), meeting not found (404), participant list đọc lại đúng tại thời điểm gọi (khác snapshot lúc hủy — test riêng case participant đã bị remove sau khi hủy, resend KHÔNG gửi cho người đó nữa).

### 10.2 Regression Test — KHÔNG sửa file cũ
Chạy lại nguyên `meetings.service.spec.ts` sau khi hoàn tất feature — phải pass y hệt số lượng test như trước khi bắt đầu (0 file `meetings.service.ts` bị động tới).

## 11. Implementation Phases

### Phase 1: DTO
`ResendCancellationNotificationDto`.

### Phase 2: Service Logic
`MeetingNotificationsService.resendCancellationNotification()`.

### Phase 3: Controller Endpoint
Thêm route vào `NotificationsController` đã có.

### Phase 4: Seed & Tests
Migration seed `notification.cancellation.send` (role `EMPLOYEE`). Unit test + regression test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Vô tình sửa/refactor `cancelMeeting()` khi cố "tái dùng" logic build content | Viết lại độc lập trong `MeetingNotificationsService`, KHÔNG mở file `meetings.service.ts` để sửa trong phạm vi feature này (chỉ đọc tham khảo, xem mục 2.2) |
| Nhầm dùng snapshot participant lúc hủy (nếu có lưu ở đâu đó) thay vì đọc lại participant hiện tại | Ghi rõ trong pseudo-code bước 5 "đọc lại tại thời điểm resend"; test riêng AC case participant đã bị remove |
| Trùng `action_type` audit log với luồng tự động, gây khó phân biệt khi debug | Dùng `action_type` riêng `meeting_cancellation_notification_resent` (khác với luồng tự động không ghi action riêng khi thành công, chỉ ghi `notification_failure` khi lỗi) |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.5.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`.
