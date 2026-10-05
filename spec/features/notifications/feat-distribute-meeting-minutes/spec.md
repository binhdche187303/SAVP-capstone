# Feature Specification: Phân phối biên bản cuộc họp (Distribute Meeting Minutes)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo spec cho UC-146 | Toàn bộ file |

> Nguồn gốc: **UC-146** trong `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 15 (dòng 4780-4810). Đặt trong module `notifications` (theo yêu cầu gốc — nhóm chung với UC-143..145) nhưng **đọc/ghi dữ liệu thuộc domain `minutes`** — feature này KHÔNG trùng với `feat-share-meeting-minutes` (cấp quyền xem vĩnh viễn) hay `feat-export-meeting-minutes` (xuất file); đây thuần túy là **gửi thông báo có nội dung biên bản**, không thay đổi quyền truy cập.

## 1. Context & Goal

### 1.1 Bối cảnh
Đã có sẵn (đọc code thật, `spec/features/minutes/feat-share-meeting-minutes/`):
- `canAccessMinutes()` (`minutes.service.ts:910-929`, nay đã `async` sau khi thêm nhánh share) — quy tắc xem biên bản.
- Ownership pattern `preparedBy OR meeting.hostId OR Admin` dùng cho `issueMinutes`/share/export.
- `MeetingMinutesEntity.status`: `draft/published/archived/deleted`.

UC-146 là hành động **gửi thông báo** (không phải cấp quyền xem) — biên bản phải đã `published` mới có nội dung chính thức để phân phối. Khác biệt rõ với `feat-share-meeting-minutes`: share = cấp quyền xem **vĩnh viễn** cho 1 người cụ thể (lưu `meeting_minutes_shares`); distribute = gửi **1 lần** thông báo (email/in-app) chứa nội dung/link biên bản cho 1 nhóm người, không cấp thêm quyền truy cập nào (người nhận vẫn phải tự thỏa `canAccessMinutes()` hiện có nếu muốn xem lại sau này — distribute không bypass access control).

### 1.2 Mục tiêu
Cung cấp `POST /api/v1/meetings/{meetingId}/minutes/distributions` cho phép Host/`preparedBy`/Admin của 1 biên bản `published` gửi thông báo phân phối tới participant của meeting (`recipientScope=participants`) hoặc tới danh sách user cụ thể (`recipientScope=custom` + `recipientUserIds`).

### 1.3 Giá trị mang lại
- Chủ động thông báo "biên bản đã sẵn sàng" thay vì participant phải tự vào kiểm tra.
- Tách bạch rõ 3 khái niệm dễ nhầm trong domain minutes: **share** (cấp quyền xem lâu dài), **export** (xuất file PDF/DOCX), **distribute** (gửi thông báo 1 lần, không đổi quyền).

### 1.4 Giả định
- Chỉ phân phối được khi `minutes.status = published` (nhất quán rule đã áp dụng cho share/export — biên bản `draft` chưa chính thức, không phân phối).
- `recipientScope`:
  - `participants` (mặc định theo contract example): gửi cho toàn bộ `meeting_participants` (internal) + `meeting_external_participants` (external) của meeting liên kết với biên bản.
  - `custom`: gửi CHỈ cho `recipientUserIds` truyền vào (phải là user nội bộ tồn tại + active) — dùng khi Host muốn phân phối cho người ngoài phạm vi participant gốc (ví dụ cấp trên).
  - Không hỗ trợ `department`/`public_internal` trong feature này (khác `visibility_level` của minutes — trường đó hiện không được đọc bởi bất kỳ logic nào, xem ghi chú trong `feat-share-meeting-minutes/spec.md` mục 1.5, giữ nguyên hiện trạng, không mở rộng).
- Distribute **KHÔNG** tự động tạo dòng `meeting_minutes_shares` — người nhận thông báo phân phối vẫn phải tự thỏa `canAccessMinutes()` (participant/host/admin/đã được share) nếu muốn xem lại chi tiết sau này qua `GET /meeting-minutes/:id`; nếu Product Owner sau này muốn "distribute = tự động cấp quyền xem luôn", đó là quyết định mở rộng riêng, ngoài phạm vi UC-146 hiện tại (nhất quán với FR-012 trong `feat-share-meeting-minutes/spec.md` — notification khi share vẫn deferred, và ở đây theo chiều ngược lại: distribute không tự ý mở rộng quyền để tránh side-effect ẩn ngoài mô tả contract).

### 1.5 Cần làm rõ — quyết định trong phạm vi tài liệu này
- **Ai được distribute?** Giống hệt ownership rule của `issueMinutes`/share: `preparedBy` HOẶC `meeting.hostId` HOẶC Admin. Participant thường không được (dù họ có quyền XEM biên bản).
- **`recipientUserIds` chứa user không active/không tồn tại?** Bỏ qua (skip), không fail cả request — tính vào `skippedRecipientCount` (tương tự cách UC-143 xử lý email không resolve được), KHÔNG trả lỗi cứng như `feat-share-meeting-minutes` (khác biệt có chủ đích: share là 1-1 grant cần chính xác tuyệt đối, distribute là gửi hàng loạt, ưu tiên "gửi được cho ai gửi được" hơn all-or-nothing).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: `meeting_minutes.preparedBy` HOẶC `meeting.hostId`, Business Admin, System Admin.
- **Secondary Actor**: Participant (nếu `recipientScope=participants`) hoặc user bất kỳ trong `recipientUserIds` (nếu `recipientScope=custom`).

### 2.2 Role & Permission Rules
- Permission: `minutes.distribute` (`module_code=minutes`, `action_code=distribute`) — dùng ĐÚNG code ngắn gọn theo `docs/API_CONTRACT_v1.0_with_system_roles.md` dòng 4786 (khác convention `meeting.minutes.xxx` của các permission minutes khác — vì đây là code đã chốt sẵn trong contract chính thức, ưu tiên contract theo thứ tự CLAUDE.md mục 1).
- Role mặc định: `EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (role code đúng — không `INTERNAL_USER`).

### 2.3 Actor Constraints
`EMPLOYEE`/`MANAGER` chỉ gọi được khi `userId === minutes.preparedBy OR userId === meeting.hostId` — giống hệt `feat-share-meeting-minutes/spec.md` mục 2.3.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép Host/`preparedBy`/Admin gửi thông báo phân phối 1 biên bản `published` tới participant hoặc danh sách user tùy chọn.

### 3.2 Event-driven Requirements
- **FR-002**: WHEN `POST /meetings/:meetingId/minutes/distributions` được gọi, THE system SHALL kiểm tra tuần tự: (1) meeting tồn tại, (2) `minutesId` trong body tồn tại + thuộc đúng `meetingId` + chưa xóa mềm, (3) ownership-or-admin, (4) `minutes.status = published`.
- **FR-003**: WHEN `recipientScope = participants`, THE system SHALL lấy recipient từ `meeting_participants` + `meeting_external_participants` của `meeting.id` (không phải của `minutesId` — 1 minutes luôn thuộc đúng 1 meeting qua `meeting_id`).
- **FR-004**: WHEN `recipientScope = custom`, THE system SHALL dùng `recipientUserIds` làm danh sách nhận, validate từng user tồn tại + `accountStatus=active`; user không hợp lệ bị skip, tính vào `skippedRecipientCount`.
- **FR-005**: WHERE `channels` chứa `in_app`, THE system SHALL gọi `createNotification()` với `notificationType=minutes_distribution`, `relatedEntityType='meeting_minutes'`, `relatedEntityId=minutesId`.
- **FR-006**: WHERE `channels` chứa `email`, THE system SHALL gọi `enqueueEmailNotification()` tương ứng.
- **FR-007**: WHERE `message` được truyền, THE system SHALL nối vào nội dung mặc định ("Biên bản họp đã được ban hành").
- **FR-008**: WHEN xử lý xong, THE system SHALL trả `202` với `{ notificationId, queuedRecipientCount, minutesId }` đúng contract.
- **FR-009**: WHEN thành công, THE system SHALL ghi `audit_logs` (`action_type = meeting_minutes_distributed`).

### 3.3 State-driven Requirements
- **FR-010**: WHILE `minutes.status != published`, THE system SHALL từ chối, trả `409 MINUTES_NOT_PUBLISHED` (nhất quán code lỗi đã dùng ở `feat-share-meeting-minutes`).

### 3.4 Unwanted Behavior Requirements
- **FR-011**: IF meeting không tồn tại, THEN `404 MEETING_NOT_FOUND`.
- **FR-012**: IF `minutesId` không tồn tại hoặc không thuộc `meetingId`, THEN `404 MINUTES_NOT_FOUND`.
- **FR-013**: IF người gọi không thỏa ownership-or-admin, THEN `403 NOT_MINUTES_OWNER`.
- **FR-014**: IF người gọi không có permission `minutes.distribute`, THEN `403 FORBIDDEN`.
- **FR-015**: IF `recipientScope=custom` mà `recipientUserIds` rỗng, THEN `400 VALIDATION_ERROR`.
- **FR-016**: IF `channels` rỗng/không hợp lệ, THEN `400 VALIDATION_ERROR`.

### 3.5 Complex / Combined Requirements
- **FR-017**: IF meeting + minutes tồn tại AND `minutes.status=published` AND (ownership thỏa HOẶC Admin) AND input hợp lệ, THEN THE system SHALL resolve recipient theo `recipientScope`, gửi thông báo theo `channels`, ghi audit, trả `202`.

### 3.6 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-008 | `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-146 |
| FR-002, FR-010, FR-013 | Pattern ownership + status-published đã dùng ở `feat-share-meeting-minutes`/`feat-issue-meeting-minutes` |
| FR-004 | Suy luận nghiệp vụ (mục 1.5) — skip thay vì fail cứng, khác chủ đích với share |

## 4. Non-functional Requirements

### 4.2 Security
JWT + `minutes.distribute` + ownership-or-admin. `recipientUserIds` (custom) không được lộ thêm thông tin ngoài phạm vi permission của actor — actor vẫn cần đúng quyền `minutes.distribute`, không cần actor tự thỏa `canAccessMinutes()` cho từng recipient (actor là preparer/host, đương nhiên đã có quyền cao nhất).

### 4.3 Reliability & Consistency
Giống UC-143..145 — lỗi enqueue không rollback, ghi nhận qua `deliveryStatus`.

### 4.6 Maintainability
Method mới `distributeMeetingMinutes()` đặt trong `MeetingNotificationsService` (cùng service nhóm UC-143..146) — đọc `MeetingMinutesEntity` qua `TypeOrmModule.forFeature` (thêm vào `NotificationsModule`, không import `MinutesModule` để tránh phụ thuộc chéo, đúng pattern đã áp dụng cho `MeetingEntity` ở UC-143).

## 5. Data Model

### 5.1 Entity liên quan
`MeetingEntity`, `MeetingMinutesEntity` (đọc `status`, `preparedBy`, `meetingId`), `MeetingParticipantEntity`, `MeetingExternalParticipantEntity`, `UserEntity`, `NotificationEntity` (ghi), `AuditLogEntity` (ghi).

### 5.2 Dữ liệu đầu vào
`POST /api/v1/meetings/:meetingId/minutes/distributions`:
```jsonc
{
  "minutesId": "uuid",
  "recipientScope": "participants",   // "participants" | "custom"
  "recipientUserIds": [],              // bắt buộc nếu recipientScope="custom"
  "channels": ["email", "in_app"],
  "message": "Biên bản họp đã được ban hành"
}
```

### 5.3 Dữ liệu đầu ra
```jsonc
{
  "success": true,
  "data": {
    "notificationId": "uuid",
    "queuedRecipientCount": 8,
    "minutesId": "uuid"
  }
}
```

## 6. Error Handling

| Điều kiện | HTTP | Code |
| :--- | ---: | :--- |
| `meetingId`/`minutesId` không phải UUID | 400 | `VALIDATION_ERROR` |
| `recipientScope=custom` thiếu `recipientUserIds` | 400 | `VALIDATION_ERROR` |
| `channels` rỗng/không hợp lệ | 400 | `VALIDATION_ERROR` |
| Không có JWT | 401 | — |
| Không có permission | 403 | `FORBIDDEN` |
| Không phải Owner/Admin | 403 | `NOT_MINUTES_OWNER` |
| Meeting không tồn tại | 404 | `MEETING_NOT_FOUND` |
| Minutes không tồn tại/không thuộc meeting | 404 | `MINUTES_NOT_FOUND` |
| Minutes chưa `published` | 409 | `MINUTES_NOT_PUBLISHED` |

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN biên bản `M` `status=published` của meeting có 5 internal + 2 external participant, WHEN Host gọi API với `recipientScope=participants`, `channels=["email","in_app"]`, THEN trả `202`, `queuedRecipientCount=7`.
- **AC-002**: GIVEN cùng biên bản, WHEN `preparedBy` gọi API với `recipientScope=custom`, `recipientUserIds=[X,Y]` (2 user active), THEN `queuedRecipientCount=2`, không liên quan gì tới participant gốc.
- **AC-003**: GIVEN Business Admin gọi API cho biên bản không phải của mình, THEN trả `202` (bypass ownership).

### 7.2 Authorization Cases
- **AC-004**: GIVEN participant thường (không phải preparedBy/host/Admin) gọi API, THEN `403 NOT_MINUTES_OWNER`.

### 7.3 Business Rule Cases
- **AC-005**: GIVEN biên bản `status=draft`, WHEN Host gọi API, THEN `409 MINUTES_NOT_PUBLISHED`.
- **AC-006**: GIVEN `recipientUserIds` chứa 1 user không active + 1 user active, WHEN gọi `recipientScope=custom`, THEN `queuedRecipientCount=1`, request vẫn `202` (không fail cứng).

### 7.4 Validation Cases
- **AC-007**: GIVEN `recipientScope=custom` không truyền `recipientUserIds`, THEN `400 VALIDATION_ERROR`.
- **AC-008**: GIVEN `minutesId` không thuộc `meetingId` truyền trên path, THEN `404 MINUTES_NOT_FOUND`.

### 7.5 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-002, AC-003 | FR-001..009 |
| AC-004 | FR-013 |
| AC-005 | FR-010 |
| AC-006 | FR-004 |
| AC-007 | FR-015 |
| AC-008 | FR-012 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Tự động tạo `meeting_minutes_shares` khi distribute (xem mục 1.4 — quyết định có chủ đích, không mở rộng quyền ngầm).
- `recipientScope=department`/`public_internal` — không có trong contract, không tự ý thêm.
- Đính kèm file PDF/DOCX biên bản trong email (đó là phạm vi `feat-export-meeting-minutes`, UC-147 — distribute chỉ gửi nội dung/link, không render file).

### 8.2 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT tạo/sửa `meeting_minutes_shares` qua endpoint này.
- **FR-OOS-002**: THE system SHALL NOT cho phép distribute khi `minutes.status != published`, kể cả Admin.
- **FR-OOS-003**: THE system SHALL NOT đính kèm file xuất (export) trong notification phân phối.

## Assumptions
Xem mục 1.4 và 1.5.
