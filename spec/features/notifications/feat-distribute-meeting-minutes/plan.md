# Implementation Plan: Distribute Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo plan cho feat-distribute-meeting-minutes (UC-146) | Toàn bộ file |

## 1. Feature Summary
Thêm route `POST /meetings/:meetingId/minutes/distributions` + method `distributeMeetingMinutes()` trong `MeetingNotificationsService`. Đọc thêm `MeetingMinutesEntity` (chỉ đọc `status`/`preparedBy`/`meetingId`) — không sửa module `minutes`.

## 2. Technical Context

### 2.1 Tech Stack
Không thêm dependency, không thêm bảng.

### 2.2 Existing Codebase Analysis
| Thành phần | Vị trí | Vai trò |
| :--- | :--- | :--- |
| Ownership pattern `preparedBy OR meeting.hostId OR Admin` | `minutes/services/minutes.service.ts` (method `issueMinutes`, tái khẳng định ở `feat-share-meeting-minutes/plan.md`) | Copy logic tương đương, viết độc lập trong `MeetingNotificationsService` (không import `MinutesService`) |
| `MeetingMinutesEntity` | `minutes/entities/meeting-minutes.entity.ts` | Import entity vào `TypeOrmModule.forFeature` của `NotificationsModule` |
| `AuthzReadRepository` | `auth/repositories/authz-read.repository.ts` | Tính `isAdmin`, đã dùng ở UC-143..145 |

### 2.3 Patterns to Follow
Giống UC-143..145. Riêng permission code KHÔNG theo convention `meeting.minutes.xxx` — dùng đúng `minutes.distribute` như đã chốt trong `docs/API_CONTRACT_v1.0_with_system_roles.md` (ưu tiên contract theo CLAUDE.md mục 1).

## 3. Scope Confirmation

### 3.1 In Scope
1 endpoint, 1 method service mới, 1 permission mới `minutes.distribute`, thêm `MeetingMinutesEntity` vào `NotificationsModule`.

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-02, SEC-03 | PASS |
| ARCH-01 (service boundary) | PASS — chỉ import entity, không import `MinutesModule` |
| DATA-01 | N/A — không ghi bảng business record mới |
| ENG-01 | Áp dụng |

### 3.4 Complexity Tracking
Trung bình — cần validate 2 entity (`meeting` + `minutes`) và 2 nhánh `recipientScope` khác hành vi lỗi (participants: không fail nếu thiếu email; custom: skip user không hợp lệ, không fail cứng cả request).

## 4. Data Model Impact
0 bảng mới, 0 cột mới. 1 permission mới `minutes.distribute` (`module_code=minutes`).

## 5. API / Contract Plan
`POST /api/v1/meetings/:meetingId/minutes/distributions` — `202`. Request/response khớp `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-146.
Error: `400`, `401`, `403 FORBIDDEN/NOT_MINUTES_OWNER`, `404 MEETING_NOT_FOUND/MINUTES_NOT_FOUND`, `409 MINUTES_NOT_PUBLISHED`.

## 6. Authorization Plan

### 6.1 Permission Design
`minutes.distribute` — `module_code=minutes`, `action_code=distribute`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('minutes.distribute')`.
2. `isAdmin` qua `AuthzReadRepository`.
3. `isOwner = minutes.preparedBy === actorUserId || meeting.hostId === actorUserId`.
4. Cho phép NẾU `isAdmin OR isOwner`; ngược lại `403 NOT_MINUTES_OWNER`.

## 7. Business Logic Plan

### 7.1 Flow — `distributeMeetingMinutes`
```text
1. SELECT meetings WHERE id = :meetingId AND deleted_at IS NULL
   IF không tồn tại -> 404 MEETING_NOT_FOUND
2. SELECT meeting_minutes WHERE id = :dto.minutesId AND meeting_id = :meetingId AND deleted_at IS NULL
   IF không tồn tại -> 404 MINUTES_NOT_FOUND
3. isAdmin/isOwner check (mục 6.2) -> 403 NOT_MINUTES_OWNER nếu không thỏa
4. IF minutes.status !== 'published' -> 409 MINUTES_NOT_PUBLISHED
5. IF dto.recipientScope === 'custom':
     IF !dto.recipientUserIds?.length -> 400 VALIDATION_ERROR
     users = SELECT users WHERE id IN (:recipientUserIds) AND account_status='active' AND deleted_at IS NULL
     recipientUserIds = users.map(u=>u.id); skippedRecipientCount = dto.recipientUserIds.length - users.length
     externalEmails = []
   ELSE (participants, mặc định):
     participants = SELECT meeting_participants WHERE meeting_id = meeting.id
     externalParticipants = SELECT meeting_external_participants WHERE meeting_id = meeting.id
     recipientUserIds = dedup(participants.map(p=>p.userId))
     externalEmails = externalParticipants.map(e=>e.email).filter(Boolean)
     skippedRecipientCount = 0
6. content = 'Biên bản họp đã được ban hành.' + (dto.message ? ` ${dto.message}` : '')
7. notificationId = null; queuedRecipientCount = 0
   IF 'in_app' in dto.channels AND recipientUserIds.length > 0:
     n = await notificationsService.createNotification({ notificationType: MINUTES_DISTRIBUTION,
       channel: IN_APP, subject: `Biên bản họp: ${meeting.title}`, content,
       relatedEntityType: 'meeting_minutes', relatedEntityId: dto.minutesId,
       recipientScope: 'user_list', recipientUserIds, createdBy: actorUserId })
     notificationId = n.id
   IF 'email' in dto.channels:
     emailMap = resolveUserEmails(recipientUserIds)
     toEmails = [...emailMap.values(), ...externalEmails]
     IF toEmails.length > 0:
       result = await notificationsService.enqueueEmailNotification({ notificationType: MINUTES_DISTRIBUTION,
         channel: EMAIL, subject: `Biên bản họp: ${meeting.title}`, content, toEmails,
         relatedEntityType: 'meeting_minutes', relatedEntityId: dto.minutesId,
         recipientScope: 'user_list', createdBy: actorUserId })
       notificationId = notificationId ?? result.notification.id
     queuedRecipientCount = toEmails.length
   ELSE:
     queuedRecipientCount = recipientUserIds.length
8. auditLogsService.logAction({ actionType: 'meeting_minutes_distributed', entityType: 'meeting_minutes',
     entityId: dto.minutesId, metadataJson: { recipientScope: dto.recipientScope, channels: dto.channels,
     queuedRecipientCount, skippedRecipientCount } })
9. Trả 202 { notificationId, queuedRecipientCount, minutesId: dto.minutesId }
```

### 7.2 Key Business Rules Implemented
Chỉ `preparedBy`/host/Admin distribute được; chỉ khi `status=published`; `custom` scope skip user không hợp lệ thay vì fail cứng; không tạo `meeting_minutes_shares`.

## 8. Validation Plan

### 8.1 Input Validation (DTO)
`DistributeMeetingMinutesDto`:
- `minutesId: string` — `@IsUUID('4')`.
- `recipientScope?: 'participants' | 'custom'` — `@IsOptional() @IsIn(['participants','custom'])`, default `'participants'`.
- `recipientUserIds?: string[]` — `@IsOptional() @IsArray() @IsUUID('4', { each: true })`.
- `channels` — giống UC-143.
- `message?: string` — `@IsOptional() @IsString() @MaxLength(1000)`.

### 8.2 Business Validation (Service)
Theo thứ tự mục 7.1.

## 9. Error Handling Plan

| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Meeting không tồn tại | `NotFoundException` | `MEETING_NOT_FOUND` |
| Minutes không tồn tại/không thuộc meeting | `NotFoundException` | `MINUTES_NOT_FOUND` |
| Không phải Owner/Admin | `ForbiddenException` | `NOT_MINUTES_OWNER` |
| Minutes chưa `published` | `ConflictException` | `MINUTES_NOT_PUBLISHED` |
| `recipientScope=custom` thiếu `recipientUserIds` | `BadRequestException` | `VALIDATION_ERROR` |

## 10. Testing Strategy

### 10.1 Unit Tests — Service
Happy path `participants` scope, happy path `custom` scope (đủ + thiếu 1 user active), Admin bypass ownership, not-owner (403), minutes draft (409), minutes không thuộc meeting (404), `custom` thiếu `recipientUserIds` (400).

### 10.2 Unit Tests — Controller
Route trả đúng response shape.

## 11. Implementation Phases

### Phase 1: Data Model
Thêm `MeetingMinutesEntity` vào `TypeOrmModule.forFeature` của `NotificationsModule`.

### Phase 2: DTO
`DistributeMeetingMinutesDto`.

### Phase 3: Service Logic
`MeetingNotificationsService.distributeMeetingMinutes()`.

### Phase 4: Controller Endpoint
Thêm route vào `NotificationsController`.

### Phase 5: Seed & Tests
Migration seed `minutes.distribute` (role `EMPLOYEE`, module_code=`minutes`). Unit test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Nhầm permission `module_code` — đặt `notifications` thay vì `minutes` (vì controller nằm ở module `notifications`) | Ghi rõ trong plan.md mục 4: `module_code=minutes` theo đúng domain dữ liệu, KHÔNG theo vị trí file controller — kiểm tra lại giá trị cột `module_code` trong bảng `permissions` khi filter danh sách quyền theo module `minutes` ở FE/admin UI |
| Nhầm `recipientScope=custom` áp dụng luôn rule "fail cứng nếu có user invalid" giống `feat-share-meeting-minutes` (share = fail cứng) | Ghi rõ trong spec.md mục 1.5 lý do khác biệt có chủ đích; test riêng khẳng định request vẫn `202` khi có user invalid trong danh sách custom |
| Quên `minutesId` phải validate thuộc đúng `meetingId` (dễ quên vì `minutesId` nằm trong body, không phải path) | Test riêng AC-008 (`minutesId` thuộc meeting khác → 404) |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.5.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`.
