# Feature Specification: Phát hành thư mời họp (Send Meeting Invitation)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo spec cho UC-143, phát sinh từ yêu cầu bổ sung `NotificationsController` (module `notifications` hiện chỉ có service, chưa có API layer) | Toàn bộ file |

> Nguồn gốc: **UC-143** trong `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 15 (dòng 4684-4713). Contract đã chốt method/endpoint/permission/request/response — spec này bổ sung phần business rule, actor, error handling chưa có trong contract.

## 1. Context & Goal

### 1.1 Bối cảnh
`NotificationsService` (`src/modules/notifications/notifications.service.ts`) đã có sẵn `createNotification()` và `enqueueEmailNotification()` — nhưng module `notifications` **chưa có controller nào**, chỉ có `NotificationsModule` export service cho module khác gọi nội bộ (đã xác nhận đọc code: `notifications.module.ts` chỉ export `TypeOrmModule, NotificationsService`, không có `NotificationsController`).

Hiện tại việc gửi lời mời họp (`NotificationType.MEETING_INVITE`) đã tồn tại **tự động, ngầm định**, gắn trực tiếp trong `MeetingsService`:
- Khi tạo meeting mới (`createMeeting`, `meetings.service.ts:695-715`): gửi IN_APP cho toàn bộ `participantUserIds` + host.
- Khi thêm 1 internal participant riêng lẻ (`meetings.service.ts:~2800-2818`): gửi EMAIL riêng cho user vừa được thêm.

Đây là 2 luồng **per-event, tự động, không thể gọi lại thủ công**. UC-143 bổ sung 1 endpoint **chủ động, thủ công**: Host/Organizer/Admin bấm "gửi lại thư mời" cho **toàn bộ participant hiện tại** của 1 meeting (internal + external) tại bất kỳ thời điểm nào — dùng khi cần nhắc lại người chưa phản hồi (`invitation_status = pending`), hoặc khi participant list đã đổi nhiều và muốn đồng bộ lại thông báo cho tất cả.

### 1.2 Mục tiêu
Cung cấp `POST /api/v1/meetings/{meetingId}/invitations` cho phép Host/Organizer/Admin gửi (hoặc gửi lại) thư mời cho toàn bộ participant hiện tại (internal qua `meeting_participants`, external qua `meeting_external_participants`) của 1 meeting, qua các channel được chọn (`email`, `in_app`), có thể kèm agenda và message tùy chỉnh.

### 1.3 Giá trị mang lại
- Không phải parse lại danh sách participant thủ công để gửi email nhắc — 1 API duy nhất cover toàn bộ danh sách hiện tại.
- Tách biệt rõ 2 khái niệm: "auto-notify khi có sự kiện thay đổi participant" (giữ nguyên, không đổi) và "chủ động phát hành/phát lại thư mời chính thức" (feature này).
- Trả `202 Accepted` + `background_jobs`/BullMQ — nhất quán pattern async notification đã dùng cho `cancelMeeting`/`updateMeetingTime`.

### 1.4 Giả định
- Meeting phải tồn tại, chưa bị xóa mềm (`deletedAt IS NULL`).
- Gửi lại thư mời **không giới hạn theo trạng thái meeting** — cho phép ở mọi `status` trừ `cancelled` (gửi thư mời cho meeting đã hủy là vô nghĩa, dùng nhầm phải trả lỗi rõ ràng thay vì gửi nhầm).
- Gửi cho **toàn bộ participant hiện tại** tại thời điểm gọi API (không filter theo `invitationStatus` — nếu Product Owner sau này cần filter chỉ gửi cho người `pending`, đó là thay đổi request DTO ở phase sau, hiện tại theo đúng contract UC-143 không có field này).
- `includeAgenda: true` nghĩa là nội dung email/in-app có thêm danh sách `meeting_agendas` hiện tại của meeting (đọc, không sửa).
- Không tạo record participant mới — chỉ gửi notification cho participant đã tồn tại. Thêm participant mới vẫn dùng API riêng (`POST /meetings/:id/participants/internal|external`).

### 1.5 Cần làm rõ — quyết định trong phạm vi tài liệu này (chưa Q&A trực tiếp với Product Owner)
- **Ai được gọi?** Ownership pattern giống hệt `cancelMeeting`/`updateMeetingTime` đã có trong `MeetingsService`: `organizerId === userId OR hostId === userId`, hoặc có permission bypass `meeting.invitation.send.any` (tương tự `meeting.cancel.any`) dành cho Admin. **Đề xuất**: KHÔNG tạo thêm permission `.any` riêng cho feature này để tránh nổ số permission — dùng lại rule "có permission `notification.invite.send` VÀ (là owner HOẶC là SYSTEM_ADMIN/BUSINESS_ADMIN qua role)" — nhất quán cách `MinutesService` check Admin qua `AuthzReadRepository`/role thay vì permission `.any` riêng biệt.
- **Meeting đã `cancelled` có gửi được không?** KHÔNG — trả lỗi nghiệp vụ rõ ràng (`409 MEETING_CANCELLED`) thay vì gửi thư mời cho cuộc họp không còn tồn tại về mặt lịch trình.
- **Participant rỗng (0 người)?** Trả `200`/`202` với `queuedRecipientCount: 0` — không coi là lỗi (client tự quyết định có cảnh báo UI hay không).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò Host (`meetings.host_id`) hoặc Organizer (`meetings.organizer_id`) của meeting.
- **Primary Actor**: Business Admin, System Admin (bypass ownership check).
- **Secondary Actor (hưởng lợi, không gọi API)**: Participant internal (nhận qua `meeting_participants.user_id`) và external (nhận qua `meeting_external_participants.email`).

### 2.2 Role & Permission Rules
- 1 permission mới: `notification.invite.send` (`module_code = notifications`, `action_code = invite.send`) — đúng theo `docs/API_CONTRACT_v1.0_with_system_roles.md` dòng 4690.
- Role mặc định được cấp: `EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
  > **Lưu ý bắt buộc khi viết migration seed**: dùng đúng role code thật trong DB (`EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`) — **KHÔNG dùng `INTERNAL_USER`**. Nhiều migration seed cũ trong repo (`20260702020000-SeedMeetingMinutesAttachmentPermissions.ts`, `20260717100001-SeedMeetingMinutesSharePermissions.ts`, ...) đã seed nhầm role `INTERNAL_USER` — role này **không tồn tại** trong bảng `roles` thật, khiến `INSERT ... SELECT ... WHERE role_code = 'INTERNAL_USER'` âm thầm insert 0 dòng (không lỗi, không cảnh báo). Xem `20260717000001-FixMinutesAttachmentEmployeeRole.ts` là migration đã fix lại đúng 1 lần cho case tương tự — feature này áp dụng đúng role code ngay từ đầu, không lặp lại lỗi.
- Có permission là điều kiện cần nhưng chưa đủ — service còn kiểm tra ownership (2.3).

### 2.3 Actor Constraints
- `EMPLOYEE`/`MANAGER` chỉ gọi được khi thỏa `userId === meeting.organizerId OR userId === meeting.hostId`.
- `BUSINESS_ADMIN`/`SYSTEM_ADMIN` bypass ownership.
- Participant thường (không phải Host/Organizer) gọi API này bị từ chối dù có permission `notification.invite.send` (permission cấp theo role mặc định rộng, nhưng ownership check tại tầng service mới là chốt chặn chính — nhất quán pattern `NOT_MINUTES_OWNER` của module `minutes`).

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép Host/Organizer/Admin gửi thư mời tới toàn bộ participant hiện tại (internal + external) của 1 meeting qua channel được chọn.
- **FR-002**: THE system SHALL tạo 1 bản ghi `notifications` (type=`meeting_invite`) cho mỗi lần gọi API, không tái sử dụng bản ghi cũ.

### 3.2 Event-driven Requirements
- **FR-003**: WHEN `POST /meetings/:meetingId/invitations` được gọi, THE system SHALL kiểm tra tuần tự: (1) meeting tồn tại + chưa xóa mềm, (2) ownership-or-admin, (3) `meeting.status != cancelled`, trước khi xử lý.
- **FR-004**: WHEN request hợp lệ, THE system SHALL đọc toàn bộ `meeting_participants` (internal) + `meeting_external_participants` của meeting tại thời điểm gọi.
- **FR-005**: WHERE `channels` chứa `in_app`, THE system SHALL gọi `notificationsService.createNotification()` với `channel=IN_APP`, `recipientUserIds` = toàn bộ internal participant + host + organizer (trùng thì dedup).
- **FR-006**: WHERE `channels` chứa `email`, THE system SHALL gọi `notificationsService.enqueueEmailNotification()` với `toEmails` = email của internal participant (resolve qua `users.email`) + email của external participant (`meeting_external_participants.email`).
- **FR-007**: WHERE `includeAgenda = true`, THE system SHALL nhúng danh sách `meeting_agendas` (title/order) hiện tại của meeting vào nội dung notification.
- **FR-008**: WHERE `message` được truyền, THE system SHALL nối thêm message đó vào cuối nội dung mặc định.
- **FR-009**: WHEN xử lý xong, THE system SHALL trả `202 Accepted` với `{ notificationId, deliveryStatus, queuedRecipientCount, skippedRecipientCount }` đúng theo contract.
- **FR-010**: WHEN gửi thành công, THE system SHALL ghi 1 bản ghi `audit_logs` (`action_type = meeting_invitation_sent`).

### 3.3 State-driven Requirements
- **FR-011**: WHILE `meeting.status = cancelled`, THE system SHALL từ chối request, trả `409 MEETING_CANCELLED`.

### 3.4 Unwanted Behavior Requirements
- **FR-012**: IF meeting không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả `404 MEETING_NOT_FOUND`.
- **FR-013**: IF người gọi không thỏa ownership-or-admin, THEN THE system SHALL trả `403 NOT_MEETING_OWNER`.
- **FR-014**: IF người gọi không có permission `notification.invite.send`, THEN THE system SHALL trả `403 FORBIDDEN`.
- **FR-015**: IF `channels` rỗng hoặc chứa giá trị không hợp lệ (khác `email`/`in_app`), THEN THE system SHALL trả `400 VALIDATION_ERROR`.
- **FR-016**: IF `meetingId` không phải UUID hợp lệ, THEN THE system SHALL trả `400`.

### 3.5 Complex / Combined Requirements
- **FR-017**: IF meeting tồn tại AND không `cancelled` AND (ownership thỏa HOẶC là Admin) AND `channels` hợp lệ, THEN THE system SHALL: đọc participant list, tạo notification(s) theo từng channel, ghi audit log, trả `202` — tất cả trong 1 lần gọi (không cần transaction DB phức tạp vì `createNotification`/`enqueueEmailNotification` đã tự chịu trách nhiệm ghi row + enqueue job).

### 3.6 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-002, FR-009 | `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-143 |
| FR-003, FR-013 | Pattern ownership-or-admin đã dùng ở `cancelMeeting` |
| FR-011 | Suy luận nghiệp vụ (mục 1.5) — chưa Q&A trực tiếp |

## 4. Non-functional Requirements

### 4.1 Performance
- Endpoint trả `202` ngay sau khi enqueue — không chờ email thực sự gửi xong (bất đồng bộ qua `background_jobs` + BullMQ, đúng pattern `enqueueEmailNotification`).

### 4.2 Security
- JWT + `notification.invite.send` + ownership-or-admin bắt buộc cho mọi request.
- Không lộ email của participant khác trong response (response chỉ trả `queuedRecipientCount`, không trả danh sách email).

### 4.3 Reliability & Consistency
- Nếu `enqueueEmailNotification` lỗi enqueue (BullMQ down), notification row vẫn được tạo với `deliveryStatus=failed` (đã có sẵn logic trong `NotificationsService.enqueueEmailNotification`) — API vẫn trả `202` (đã queued về mặt ý định), không rollback, đúng pattern "notification failure không được làm rollback business action chính" đã áp dụng cho `cancelMeeting` (catch riêng, ghi `audit_logs action_type=notification_failure`, không throw).

### 4.4 Observability
- Log đủ `meetingId`, `actorUserId`, `queuedRecipientCount`, kết quả enqueue.

### 4.5 Maintainability
- Business logic đặt trong service mới `MeetingNotificationsService` (`src/modules/notifications/services/meeting-notifications.service.ts`) — KHÔNG thêm vào `MeetingsService` (đã rất lớn, xem `meetings.service.ts` > 3500 dòng) để tránh phình thêm file đã quá tải; cũng KHÔNG import toàn bộ `MeetingsModule` vào `NotificationsModule` (tránh circular) — chỉ inject repository của `MeetingEntity`/`MeetingParticipantEntity`/`MeetingExternalParticipantEntity`/`MeetingAgendaEntity`/`UserEntity` qua `TypeOrmModule.forFeature` (đọc, không ghi), giống cách `MinutesModule` từng đọc `MeetingEntity` trực tiếp.

## 5. Data Model

### 5.1 Entity liên quan (đọc, không ghi trừ `NotificationEntity`)
- `MeetingEntity` — đọc `status`, `organizerId`, `hostId`, `title`, `deletedAt`.
- `MeetingParticipantEntity` — đọc `userId`.
- `MeetingExternalParticipantEntity` — đọc `email`, `fullName`.
- `MeetingAgendaEntity` (nếu `includeAgenda=true`) — đọc `title`, `orderNo`.
- `UserEntity` — đọc `email` (resolve email cho internal participant).
- `NotificationEntity` — ghi (qua `NotificationsService`).
- `AuditLogEntity` — ghi.

### 5.2 Dữ liệu đầu vào
`POST /api/v1/meetings/:meetingId/invitations`:
```jsonc
{
  "channels": ["email", "in_app"],   // bắt buộc, ít nhất 1 phần tử, giá trị ∈ {email, in_app}
  "includeAgenda": true,              // optional, default false
  "message": "Vui lòng tham dự đúng giờ" // optional, string, max 1000 ký tự
}
```

### 5.3 Dữ liệu đầu ra (theo đúng contract)
**202:**
```jsonc
{
  "success": true,
  "data": {
    "notificationId": "uuid",
    "deliveryStatus": "queued",
    "queuedRecipientCount": 8,
    "skippedRecipientCount": 0
  }
}
```
`skippedRecipientCount` = số participant internal không resolve được email hợp lệ khi `channels` chứa `email` (không tính là lỗi, chỉ báo cáo).

### 5.4 State / Status Model
Không có state machine riêng — mỗi lần gọi tạo 1 notification độc lập, không liên kết trạng thái với lần gọi trước.

### 5.5 Data Constraints
Không thêm bảng/cột mới — dùng nguyên `notifications` hiện có.

## 6. Error Handling

| Điều kiện | HTTP | Code |
| :--- | ---: | :--- |
| `meetingId` không phải UUID | 400 | `VALIDATION_ERROR` |
| `channels` rỗng/không hợp lệ | 400 | `VALIDATION_ERROR` |
| Không có JWT | 401 | — |
| Không có permission `notification.invite.send` | 403 | `FORBIDDEN` |
| Có permission nhưng không phải Owner/Admin | 403 | `NOT_MEETING_OWNER` |
| Meeting không tồn tại/đã xóa mềm | 404 | `MEETING_NOT_FOUND` |
| Meeting đã `cancelled` | 409 | `MEETING_CANCELLED` |

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN meeting `M` `status=scheduled`, host=`U`, 5 internal + 3 external participant, WHEN `U` gọi API với `channels=["email","in_app"]`, THEN trả `202`, `queuedRecipientCount=8`, tạo notification IN_APP cho 5 internal + notification EMAIL cho 8 (5 internal email resolve được + 3 external).
- **AC-002**: GIVEN Business Admin gọi API cho meeting không phải của mình, THEN trả `202` (Admin bypass ownership).
- **AC-003**: GIVEN meeting có 0 participant, WHEN Host gọi API, THEN trả `202`, `queuedRecipientCount=0`.

### 7.2 Authorization Cases
- **AC-004**: GIVEN người gọi là participant thường (không phải Host/Organizer/Admin), WHEN gọi API, THEN trả `403 NOT_MEETING_OWNER`.
- **AC-005**: GIVEN người gọi không có permission `notification.invite.send`, THEN trả `403 FORBIDDEN`.

### 7.3 Business Rule Cases
- **AC-006**: GIVEN meeting `status=cancelled`, WHEN Host gọi API, THEN trả `409 MEETING_CANCELLED`.
- **AC-007**: GIVEN meeting không tồn tại, THEN trả `404 MEETING_NOT_FOUND`.

### 7.4 Validation Cases
- **AC-008**: GIVEN body thiếu `channels`, THEN trả `400 VALIDATION_ERROR`.
- **AC-009**: GIVEN `channels=["sms"]` (giá trị không hợp lệ), THEN trả `400 VALIDATION_ERROR`.

### 7.5 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-003 | FR-001..010 |
| AC-002 | FR-003 (ownership-or-admin) |
| AC-004 | FR-013 |
| AC-005 | FR-014 |
| AC-006 | FR-011 |
| AC-007 | FR-012 |
| AC-008, AC-009 | FR-015 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Filter chỉ gửi cho participant chưa phản hồi (`invitationStatus=pending`) — contract UC-143 không có field này, không tự ý thêm.
- Thay đổi luồng auto-notify hiện có khi tạo meeting/thêm participant (giữ nguyên).
- Rate-limit chống spam gửi lại nhiều lần liên tiếp — có thể xem xét sau nếu Product Owner phản hồi cần.

### 8.2 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT tạo participant mới qua endpoint này (chỉ gửi cho participant đã tồn tại).
- **FR-OOS-002**: THE system SHALL NOT cho phép gửi thư mời cho meeting đã `cancelled`.

## Assumptions
Xem mục 1.4 và 1.5.
