# Implementation Plan: Send Meeting Invitation

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo plan cho feat-send-meeting-invitation (UC-143) | Toàn bộ file |

## 1. Feature Summary
Thêm `NotificationsController` (chưa tồn tại) + 1 endpoint `POST /meetings/:meetingId/invitations`, service mới `MeetingNotificationsService` trong module `notifications`, đọc participant hiện tại của meeting rồi gọi lại `NotificationsService.createNotification()`/`enqueueEmailNotification()` đã có sẵn.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM. Không thêm dependency mới. 1 migration seed permission.

### 2.2 Existing Codebase Analysis
| Thành phần | Vị trí | Vai trò |
| :--- | :--- | :--- |
| `NotificationsService.createNotification/enqueueEmailNotification` | `notifications/notifications.service.ts` | Tái sử dụng nguyên trạng, không sửa |
| `NotificationsModule` | `notifications/notifications.module.ts` | Cần thêm controller + service mới + `TypeOrmModule.forFeature` cho entity đọc |
| Pattern ownership-or-admin + `resolveUserEmails` | `meetings/services/meetings.service.ts:753-770, 3250-3272` | Tham khảo logic, KHÔNG import `MeetingsService` (tránh phụ thuộc chéo nặng) — copy pattern query tối thiểu cần thiết bằng repository trực tiếp |
| `MeetingEntity`, `MeetingParticipantEntity`, `MeetingExternalParticipantEntity`, `MeetingAgendaEntity` | `meetings/entities/*.entity.ts` | Import entity (không import module) vào `TypeOrmModule.forFeature` của `NotificationsModule` |
| `UserEntity` | `accounts/entities/user.entity.ts` | Đọc email — entity-only, đúng comment đã có sẵn trong `notification.entity.ts` ("KHÔNG import AccountsModule") |
| Migration mẫu | `20260717000001-FixMinutesAttachmentEmployeeRole.ts` | Copy đúng role code `EMPLOYEE` (không phải `INTERNAL_USER`) |

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`, `@HttpCode(202)`.
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('notification.invite.send')`.
- Ownership check: tự viết trong `MeetingNotificationsService` (KHÔNG gọi `meetingsService.checkUserPermission` để tránh import chéo `MeetingsModule` ↔ `NotificationsModule` — dùng `AuthzReadRepository` sẵn có ở module `auth` để lấy role của actor, so sánh `SYSTEM_ADMIN`/`BUSINESS_ADMIN`).

## 3. Scope Confirmation

### 3.1 In Scope
- 1 endpoint `POST /meetings/:meetingId/invitations`.
- `NotificationsController` mới (dùng chung cho cả 4 UC gửi-thông-báo + 3 UC đọc-thông-báo trong nhóm feature notification — controller này sẽ được các feature khác bổ sung route, xem `feat-send-meeting-reminder`, `feat-send-cancellation-notification`, `feat-distribute-meeting-minutes`, `feat-notification-inbox`).
- Service mới `MeetingNotificationsService`.
- 1 permission mới `notification.invite.send`.

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-02 (auth bắt buộc) | PASS |
| SEC-03 (input validation) | PASS — DTO validate `channels` enum, `message` maxLength |
| ARCH-01 (service boundary) | PASS — chỉ inject entity qua TypeORM, không import `MeetingsModule` |
| ARCH-02 (async cho >2s) | PASS — gửi email qua BullMQ, endpoint trả 202 ngay |
| ENG-01 (test coverage) | Áp dụng |
| ENG-03 (error không lộ stack trace) | PASS |

### 3.4 Complexity Tracking
Đây là feature ĐẦU TIÊN thêm `Controller` cho module `notifications` (trước giờ chỉ có `Service`) — điểm rủi ro chính là wiring module (`imports`/`providers`/`controllers`) và tránh circular dependency với `MeetingsModule`/`AccountsModule`. Không cần ADR riêng.

## 4. Data Model Impact
0 bảng mới, 0 cột mới. 1 permission mới (migration).

## 5. API / Contract Plan
- `POST /api/v1/meetings/:meetingId/invitations` — trả `202`.
- Request/Response: xem spec.md mục 5.2/5.3 (khớp nguyên văn `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-143).
- Error: `400`, `401`, `403 FORBIDDEN/NOT_MEETING_OWNER`, `404 MEETING_NOT_FOUND`, `409 MEETING_CANCELLED`.

## 6. Authorization Plan

### 6.1 Permission Design
`notification.invite.send` — `module_code=notifications`, `action_code=invite.send`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('notification.invite.send')`.
3. Service: `isAdmin` qua `AuthzReadRepository.getEffectiveRolesAndPermissions(actorUserId)` (roles chứa `SYSTEM_ADMIN`/`BUSINESS_ADMIN`).
4. `isOwner = meeting.organizerId === actorUserId || meeting.hostId === actorUserId`.
5. Cho phép NẾU `isAdmin OR isOwner`; ngược lại `403 NOT_MEETING_OWNER`.

## 7. Business Logic Plan

### 7.1 Flow — `sendMeetingInvitation`
```text
1. SELECT meetings WHERE id = :meetingId AND deleted_at IS NULL
   IF không tồn tại -> 404 MEETING_NOT_FOUND
2. isAdmin/isOwner check (mục 6.2) -> 403 NOT_MEETING_OWNER nếu không thỏa
3. IF meeting.status === 'cancelled' -> 409 MEETING_CANCELLED
4. SELECT meeting_participants WHERE meeting_id = :meetingId  -> internalParticipants
   SELECT meeting_external_participants WHERE meeting_id = :meetingId -> externalParticipants
5. internalUserIds = dedup([...internalParticipants.map(p=>p.userId), meeting.organizerId, meeting.hostId])
6. content = buildInvitationContent(meeting, dto.message, dto.includeAgenda
     ? await loadAgendas(meetingId) : null)
7. IF 'in_app' in dto.channels:
     await notificationsService.createNotification({
       notificationType: MEETING_INVITE, channel: IN_APP,
       subject: `Lời mời tham gia cuộc họp: ${meeting.title}`,
       content, relatedEntityType: 'meeting', relatedEntityId: meetingId,
       recipientScope: 'user_list', recipientUserIds: internalUserIds,
       createdBy: actorUserId,
     })
8. queuedRecipientCount = 0; skippedRecipientCount = 0
   IF 'email' in dto.channels:
     emailMap = resolveUserEmails(internalUserIds)  // Map<userId,email>
     toEmails = [...emailMap.values(), ...externalParticipants.map(e=>e.email).filter(Boolean)]
     skippedRecipientCount = internalUserIds.length - emailMap.size
     IF toEmails.length > 0:
       result = await notificationsService.enqueueEmailNotification({...toEmails, content, subject, ...})
       notificationId = result.notification.id
     queuedRecipientCount = toEmails.length
   ELSE:
     queuedRecipientCount = internalUserIds.length  // chỉ in_app
9. auditLogsService.logAction({ actionType: 'meeting_invitation_sent', entityType: 'meeting',
     entityId: meetingId, metadataJson: { channels: dto.channels, queuedRecipientCount } })
10. Trả 202 { notificationId, deliveryStatus: 'queued', queuedRecipientCount, skippedRecipientCount }
```

### 7.2 Key Business Rules Implemented
Chỉ Host/Organizer/Admin gọi được; chặn khi meeting `cancelled`; gửi cho toàn bộ participant hiện tại, không filter theo trạng thái phản hồi.

## 8. Validation Plan

### 8.1 Input Validation (DTO)
`SendMeetingInvitationDto`:
- `channels: NotificationChannelInput[]` — `@IsArray() @ArrayMinSize(1) @IsIn(['email','in_app'], { each: true })`.
- `includeAgenda?: boolean` — `@IsOptional() @IsBoolean()`.
- `message?: string` — `@IsOptional() @IsString() @MaxLength(1000)`.
- Path param `:meetingId` — `ParseUUIDPipe`.

### 8.2 Business Validation (Service)
Theo thứ tự mục 7.1: tồn tại → ownership-or-admin → status khác cancelled.

## 9. Error Handling Plan

| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Meeting không tồn tại | `NotFoundException` | `MEETING_NOT_FOUND` |
| Không phải Owner/Admin | `ForbiddenException` | `NOT_MEETING_OWNER` |
| Meeting `cancelled` | `ConflictException` | `MEETING_CANCELLED` |

## 10. Testing Strategy

### 10.1 Unit Tests — Service
Happy path (Host/Organizer/Admin, có/không external participant), not-owner (403), meeting cancelled (409), meeting not found (404), 0 participant (202 queuedRecipientCount=0), channels chỉ `in_app` (không gọi enqueueEmailNotification), channels chỉ `email`, `includeAgenda=true` nhúng đúng agenda vào content.

### 10.2 Unit Tests — Controller
Route trả đúng `202` + response shape; propagate lỗi 400/403/404/409 từ service.

## 11. Implementation Phases

### Phase 1: Module Scaffolding
Tạo `notifications.controller.ts`, cập nhật `notifications.module.ts` (thêm `controllers: [NotificationsController]`, `TypeOrmModule.forFeature` cho `MeetingEntity`, `MeetingParticipantEntity`, `MeetingExternalParticipantEntity`, `MeetingAgendaEntity`, `UserEntity`).

### Phase 2: DTO
`SendMeetingInvitationDto`, `SendInvitationResponseDto`.

### Phase 3: Service Logic
`MeetingNotificationsService.sendMeetingInvitation()`.

### Phase 4: Controller Endpoint
`POST meetings/:meetingId/invitations` trong `NotificationsController`.

### Phase 5: Seed & Tests
Migration seed permission `notification.invite.send` (role code đúng: `EMPLOYEE`, không phải `INTERNAL_USER`). Unit test service + controller.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Circular dependency nếu import `MeetingsModule` vào `NotificationsModule` (vì `MeetingsModule` đã import `NotificationsModule` để dùng `NotificationsService`) | Chỉ import entity qua `TypeOrmModule.forFeature`, không import `MeetingsModule`/`MinutesModule` (đã xác nhận qua comment sẵn có trong `notification.entity.ts`: "KHÔNG import AccountsModule (tránh circular)") |
| Lặp lại lỗi seed role `INTERNAL_USER` (đã xảy ra ở ≥2 migration khác trong repo) | Copy đúng theo `20260717000001-FixMinutesAttachmentEmployeeRole.ts`, dùng `EMPLOYEE` |
| `NotificationsController` là controller đầu tiên của module — dễ conflict route prefix với `MeetingsController` (cùng base `/meetings/:meetingId/...`) | Đặt `@Controller('meetings')` cho các route dạng `meetings/:meetingId/invitations` (giống cách `MeetingsController` đặt prefix rỗng + full path trong `@Post('meetings/:meetingId/...')`) — kiểm tra kỹ không trùng route khi cả 2 controller cùng match `/api/v1/meetings/*` |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.5.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`.
