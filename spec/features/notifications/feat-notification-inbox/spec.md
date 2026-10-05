# Feature Specification: Hộp thư thông báo cá nhân (Notification Inbox — List / Detail)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo spec — không có UC gốc trong Feature Table/API Contract chính thức, phát sinh từ yêu cầu bổ sung bắt buộc cho FE ("bổ sung, không có UC riêng nhưng bắt buộc cho FE") | Toàn bộ file |
| 2026-07-18 | **[QUYẾT ĐỊNH PRODUCT OWNER]** Product Owner từ chối phương án bảng mới `notification_reads` đề xuất ở bản khởi tạo, xác nhận trực tiếp: "không đồng ý tạo table mới và thấy việc theo dõi notification_read là không cần thiết". Viết lại toàn bộ feature theo hướng đơn giản hóa: bỏ hẳn khái niệm "đã đọc" (`isRead`/`readAt`), bỏ hẳn endpoint `PATCH /notifications/:id/read`, chỉ còn `GET /notifications` (list) và `GET /notifications/:id` (detail) thuần túy đọc. Code đã rollback tương ứng: xóa migration `CreateNotificationReadsTable`, xóa `NotificationReadEntity`, xóa `markAsRead()` khỏi `NotificationsService`, xóa route `PATCH .../read` khỏi `NotificationsController`. | Toàn bộ file |
| 2026-07-27 | **[ĐỢT P1, BE-07]** Tái áp dụng "đã đọc" — nhưng KHÔNG vi phạm quyết định PO ở dòng trên: KHÔNG có bảng mới, KHÔNG có cột JSON mới trên `notifications` (điều PO thực sự từ chối, xem §1.2 cập nhật). Trạng thái đọc lưu 100% ở Redis (TTL, tự rã), không phải baseline database. Thêm `isRead` vào response list/detail, thêm `PATCH /notifications/:id/read` + `PATCH /notifications/read-all`. Xem §1.2 (cập nhật), §mới "Cơ chế Redis". Chi tiết: `PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md` §3B. Nếu team coi đây là thay đổi quyết định nghiệp vụ (không chỉ kỹ thuật), cần PO xác nhận lại — ghi rõ ở residual. | §1.2, §1.3, §3 (FR mới), §5 (mới), §6, §7, §8 |
| 2026-08-08 | [Xử lý xung đột phòng/giờ họp — Nhóm E] Thêm field `payloadJson` vào response `GET /notifications` (list) và `GET /notifications/:id` (detail). **Lưu ý: đây KHÔNG phải cột mới** — `notifications.payload_json` (jsonb) đã tồn tại sẵn trong baseline entity, dùng bởi các notification type khác (meeting invite/reminder) nhưng trước giờ bị `NotificationListItemDto`/`listMyNotifications`/`getMyNotificationDetail` lọc bỏ khi trả cho FE. Không vi phạm quyết định PO ở dòng 2026-07-18 (quyết định đó chỉ về cơ chế theo dõi "đã đọc", không liên quan `payload_json`). Mục đích: cho phép FE hiển thị chi tiết xung đột phòng khi thông báo `meeting_request_rejected` có đính kèm `conflictDetails`/`suggestedAlternatives` (xem `feat-review-meeting-request` FR-036/FR-038/FR-039). Xem `KE_HOACH_XU_LY_XUNG_DOT_PHONG_GIO_HOP_2026-08-08.md` ở root repo. | §5.4 (Dữ liệu đầu ra), DTO `NotificationListItemDto` |

> Nguồn gốc: **Không có UC gốc trong `docs/API_CONTRACT_v1.0_with_system_roles.md`.** Endpoint gợi ý `GET /notifications` đã được liệt kê ở mục 22.13 ("API endpoint grouping gợi ý") của `CLAUDE.md` nhưng CHƯA có đặc tả chi tiết. Tạm đặt tên **UC-NOTI-01/02 (mới)**, chờ Product Owner gán số chính thức vào Feature Table.

## 1. Context & Goal

### 1.1 Bối cảnh
`NotificationEntity` (`src/modules/notifications/entities/notification.entity.ts`) là mô hình **broadcast** — 1 dòng đại diện cho 1 lần gửi tới **nhiều** người nhận cùng lúc (`recipient_user_ids_json: string[]`), có sẵn 1 cột tổng hợp `read_count: number` (đếm tổng số người đã đọc, không biết ai đã đọc).

### 1.2 Quyết định thiết kế — trạng thái đã đọc lưu ở Redis, KHÔNG phải bảng/cột DB mới

> **[CẬP NHẬT 2026-07-27, BE-07]** Mục này đã đổi. Lịch sử giữ nguyên bên dưới để truy vết.

Bản khởi tạo của spec này từng đề xuất thêm bảng `notification_reads` (`notification_id`, `user_id`, `read_at`) để hỗ trợ `isRead` chính xác theo từng user. **Product Owner đã từ chối phương án này** (2026-07-18): không đồng ý tạo bảng mới, và cho rằng việc theo dõi "ai đã đọc" là không cần thiết cho phạm vi hiện tại. Cột `notifications.read_count` hiện có giữ nguyên, không bị đụng tới (không đổi bởi đợt này).

**Đợt P1 (BE-07, 2026-07-27) tái áp dụng "đã đọc"** theo yêu cầu của kế hoạch trưởng nhóm (`PLAN_SUA_BE_cho_Tai_2026-07-26.md`), nhưng thiết kế tôn trọng đúng điều PO đã từ chối — KHÔNG bảng mới, KHÔNG cột JSON mới trên `notifications`. Toàn bộ trạng thái đọc nằm ở **Redis**:
- `notif:read:{userId}` — SET chứa `notificationId` đã đọc, TTL 90 ngày (refresh mỗi lần ghi).
- `notif:readall:{userId}` — string ISO timestamp mốc "đọc tất cả"; notification `created_at <= mốc` ⇒ coi như đã đọc.
- `isRead = (id ∈ SET) || (createdAt <= readAllAt)`.

Endpoint: `PATCH /notifications/:id/read` (đánh dấu 1 thông báo), `PATCH /notifications/read-all` (đánh dấu tất cả tới thời điểm hiện tại). `isRead: boolean` được thêm vào response của `GET /notifications` và `GET /notifications/:id`.

**Lưu ý về phạm vi thay đổi:** đây là sự đảo ngược MỘT PHẦN quyết định PO — PO từ chối cả "bảng mới" LẪN việc "theo dõi ai đã đọc là không cần thiết" nói chung; thiết kế này tránh được vế đầu (không đụng schema DB) nhưng vẫn triển khai đúng thứ PO nói "không cần thiết". Nếu team coi đây là thay đổi định hướng nghiệp vụ chứ không chỉ né tránh ràng buộc kỹ thuật, **cần PO xác nhận lại tường minh** trước khi seed permission lên môi trường thật (xem residual §8).

Nếu sau này Product Owner đổi ý và cần tracking đã đọc CÓ audit/không mất khi Redis flush, đó là 1 feature mới riêng biệt (cần bảng thật), không mở rộng ngầm trong feature này.

### 1.3 Mục tiêu
Cung cấp 2 endpoint đọc-chuyên-biệt cho user hiện tại (không phải endpoint quản trị):
1. `GET /api/v1/notifications` — danh sách thông báo mà user hiện tại là 1 trong các recipient, có pagination, kèm `isRead` (BE-07).
2. `GET /api/v1/notifications/:id` — chi tiết 1 thông báo (chỉ nếu user hiện tại là recipient), kèm `isRead` (BE-07).
3. `PATCH /api/v1/notifications/:id/read` — đánh dấu 1 thông báo đã đọc (BE-07, mới).
4. `PATCH /api/v1/notifications/read-all` — đánh dấu tất cả thông báo (tới thời điểm hiện tại) đã đọc (BE-07, mới).

### 1.4 Giả định
- "User hiện tại là recipient" = `notification.recipientUserIdsJson` (jsonb array) chứa `userId` hiện tại — dùng toán tử jsonb containment `@>` của PostgreSQL, tận dụng GIN index đã có sẵn `ix_notifications_recipients` (`database_v3_2_compact_39_tables.md` dòng 1193) — không cần migration index mới.
- Chỉ áp dụng cho notification có `channel IN ('in_app', 'websocket')` — notification `channel=email`/`sms` không hiển thị trong inbox (đã gửi qua kênh khác).

### 1.5 Cần làm rõ — đã giải quyết
- **[ĐÃ GIẢI QUYẾT — cập nhật 2026-07-27]** Bảng mới hay cột JSON cho tracking đã đọc? → **Vẫn không làm cả hai** (giữ nguyên phần này của quyết định PO). Trạng thái đọc dùng Redis (§1.2), không phải schema DB.
- **[ĐỀ XUẤT] Notification không tồn tại `id` nhưng user KHÔNG phải recipient?** Trả `403` thay vì `404` — nhất quán nguyên tắc "không confirm sự tồn tại của resource cho người không có quyền" đã dùng cho `MEETING_MINUTES_ACCESS_DENIED` ở module `minutes`, khác với trường hợp `id` không tồn tại thật sự (`404`).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Bất kỳ user nội bộ đã đăng nhập (Employee/Manager/Admin) — chỉ thao tác trên thông báo của chính mình.

### 2.2 Role & Permission Rules
- Permission đọc: `notification.read.self` (`module_code=notifications`, `action_code=read.self`) — đúng theo `docs/API_CONTRACT_v1.0_with_system_roles.md` dòng 5285-5287 (đã liệt kê `notification.invite.send`/`.reminder.send`/`.cancellation.send` trong Phụ lục A nhưng **thiếu** `read.self` — bổ sung ở feature này).
- **[BE-07, mới]** Permission ghi (mark-read): `notification.update.self` — role giống hệt `notification.read.self` (mọi role đăng nhập đều đánh dấu được thông báo CỦA CHÍNH MÌNH là đã đọc).
- Role mặc định: **TẤT CẢ role đăng nhập được** (`EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`) — đây là quyền đọc/ghi trạng thái đọc thông báo của chính mình, không phải quyền nghiệp vụ đặc thù, tương tự `schedule.read.self` (`meetings.controller.ts:738`).

### 2.3 Actor Constraints
- User chỉ xem được thông báo mà chính họ là recipient (`recipientUserIdsJson` chứa `userId` của họ) — không có ngoại lệ Admin-bypass (Admin muốn xem thông báo của user khác phải qua kênh khác, ví dụ `audit_logs`, không phải qua API này).

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép user xem danh sách thông báo mà họ là recipient, có phân trang.
- **FR-002**: THE system SHALL cho phép user xem chi tiết 1 thông báo mà họ là recipient.

### 3.2 Event-driven Requirements
- **FR-004**: WHEN `GET /notifications` được gọi, THE system SHALL trả danh sách `notifications` WHERE `recipient_user_ids_json @> [userId]` AND `channel IN ('in_app','websocket')`, sắp xếp `created_at DESC`.
- **FR-006**: WHEN `GET /notifications/:id` được gọi VÀ user là recipient, THE system SHALL trả chi tiết đầy đủ.

### 3.3 Unwanted Behavior Requirements
- **FR-009**: IF `id` không tồn tại trong `notifications`, THEN `404 NOTIFICATION_NOT_FOUND`.
- **FR-010**: IF `id` tồn tại nhưng user hiện tại KHÔNG phải recipient, THEN `403 NOTIFICATION_ACCESS_DENIED` (không confirm sự tồn tại — xem mục 1.5).
- **FR-011**: IF `page`/`limit` vượt giới hạn cho phép (`limit > 100`), THEN `400 VALIDATION_ERROR` (đúng convention pagination chung của CLAUDE.md mục 8.4).

### 3.5 [BE-07, mới] Mark-read Requirements
- **FR-012**: THE system SHALL cho phép user đánh dấu 1 notification (mà họ là recipient) là đã đọc qua `PATCH /notifications/:id/read`, lấy `userId` từ token — KHÔNG tin body.
- **FR-013**: THE system SHALL cho phép user đánh dấu TẤT CẢ notification (tính tới thời điểm gọi API) là đã đọc qua `PATCH /notifications/read-all`.
- **FR-014**: WHEN user gọi `PATCH /notifications/:id/read` NHIỀU LẦN cho cùng 1 `id`, THE system SHALL idempotent (không lỗi, kết quả cuối cùng giống nhau).
- **FR-015**: IF user KHÔNG phải recipient của `id`, THEN `PATCH /notifications/:id/read` SHALL trả `403 NOTIFICATION_ACCESS_DENIED` (dùng lại logic kiểm tra của `GET /notifications/:id`), KHÔNG ghi Redis.
- **FR-016**: IF Redis không khả dụng khi ĐỌC trạng thái (list/detail), THEN THE system SHALL fail-soft trả `isRead=false` cho toàn bộ, KHÔNG trả lỗi `500`.
- **FR-017**: IF Redis không khả dụng khi GHI trạng thái (mark-read/mark-all-read), THEN THE system SHALL fail-soft — log lỗi nội bộ, API vẫn trả `200` (best-effort, không rollback thao tác chính).

### 3.4 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-002 | Yêu cầu bổ sung bắt buộc cho FE (không có UC gốc) |
| FR-010 | Suy luận bảo mật, đối chiếu pattern `MEETING_MINUTES_ACCESS_DENIED` |
| FR-012→017 | Đợt P1 BE-07, `PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md` §3B |

## 4. Non-functional Requirements

### 4.1 Performance
`GET /notifications` phải dùng GIN index sẵn có (`ix_notifications_recipients`) cho điều kiện `recipient_user_ids_json @> ...` — KHÔNG full scan bảng `notifications`.

### 4.2 Security
JWT bắt buộc cho cả 2 endpoint. `userId` lấy từ token (`@CurrentUser()`), KHÔNG tin `userId` truyền từ query/body.

### 4.6 Maintainability
2 method trong `NotificationsService` (service đã có sẵn, method đọc-cho-user là mở rộng tự nhiên, KHÔNG cần service riêng): `listMyNotifications()`, `getMyNotificationDetail()`.

## 5. Data Model

### 5.1 Không có bảng/cột mới trên `notifications`
Feature này **không thêm bảng, không thêm cột** trên `notifications`. Đọc dữ liệu hiện có qua `NotificationEntity`. **[BE-07]** Trạng thái đọc lưu ở Redis — xem §5.1b.

### 5.1b [BE-07, mới] Khóa Redis
| Key | Kiểu | TTL | Mô tả |
| :--- | :--- | :--- | :--- |
| `notif:read:{userId}` | SET | 90 ngày, refresh mỗi lần `sadd` | Chứa `notificationId` đã đọc riêng lẻ |
| `notif:readall:{userId}` | STRING (ISO timestamp) | Không TTL | Mốc "đọc tất cả"; `created_at <= mốc` ⇒ đã đọc |

`isRead = (id ∈ SET notif:read:{userId}) || (createdAt <= readAllAt)`.

### 5.2 Entity liên quan
`NotificationEntity` (đọc, không ghi). `RedisService`/`NotificationReadStateService` (đọc + ghi, không phải TypeORM entity).

### 5.3 Dữ liệu đầu vào

**List** — `GET /api/v1/notifications?page=1&limit=20`

**Detail** — `GET /api/v1/notifications/:id`

### 5.4 Dữ liệu đầu ra

**List (200):**
```jsonc
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "notificationType": "meeting_invite",
      "subject": "string",
      "content": "string",
      "relatedEntityType": "meeting",
      "relatedEntityId": "uuid",
      "priority": "normal",
      "createdAt": "ISO datetime",
      "isRead": false,
      "payloadJson": null
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

**Detail (200)**: giống 1 phần tử của List (có `isRead`).

**Mark read (200):**
```jsonc
{ "success": true, "message": "Đã đánh dấu thông báo là đã đọc" }
```

**Mark all read (200):**
```jsonc
{ "success": true, "message": "Đã đánh dấu tất cả thông báo là đã đọc" }
```

### 5.5 Data Constraints
Không có ràng buộc DB mới — feature không ghi vào `notifications`. Ghi duy nhất xảy ra ở Redis (§5.1b), best-effort.

## 6. Error Handling

| Điều kiện | HTTP | Code |
| :--- | ---: | :--- |
| `id` không phải UUID | 400 | `VALIDATION_ERROR` |
| `limit > 100` | 400 | `VALIDATION_ERROR` |
| Không có JWT | 401 | — |
| `id` tồn tại nhưng không phải recipient (List detail hoặc mark-read) | 403 | `NOTIFICATION_ACCESS_DENIED` |
| `id` không tồn tại | 404 | `NOTIFICATION_NOT_FOUND` |
| Redis lỗi khi đọc `isRead` | — | fail-soft `isRead=false`, KHÔNG lỗi HTTP |
| Redis lỗi khi ghi mark-read/mark-all-read | — | fail-soft, log nội bộ, vẫn `200` |

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN user `U` là recipient của 5 notification (`channel IN in_app/websocket`), WHEN `U` gọi `GET /notifications`, THEN trả 5 phần tử, MỖI phần tử có field `isRead` (BE-07, cập nhật — trước đây spec ghi "không có field isRead").
- **AC-007b**: GIVEN user `U` gọi `GET /notifications/:id` cho 1 notification mà họ là recipient, THEN trả `200` với đầy đủ nội dung + `isRead`.
- **AC-009 [BE-07]**: GIVEN user `U` gọi `PATCH /notifications/:id/read` cho notification họ là recipient, WHEN gọi lại `GET /notifications/:id`, THEN `isRead=true`.
- **AC-010 [BE-07]**: GIVEN user `U` gọi `PATCH /notifications/read-all` lúc `T`, WHEN gọi `GET /notifications`, THEN mọi notification có `createdAt <= T` có `isRead=true`; notification tạo SAU `T` có `isRead=false`.
- **AC-011 [BE-07]**: GIVEN user `U` gọi `PATCH /notifications/:id/read` 2 LẦN liên tiếp, THEN cả 2 lần đều `200`, không lỗi (idempotent).

### 7.2 Authorization Cases
- **AC-005**: GIVEN notification `N` mà user `X` KHÔNG phải recipient, WHEN `X` gọi `GET /notifications/N`, THEN `403 NOTIFICATION_ACCESS_DENIED`.
- **AC-012 [BE-07]**: GIVEN notification `N` mà user `X` KHÔNG phải recipient, WHEN `X` gọi `PATCH /notifications/N/read`, THEN `403 NOTIFICATION_ACCESS_DENIED`, KHÔNG ghi Redis.

### 7.3 Validation / Not Found Cases
- **AC-007**: GIVEN `id` không tồn tại, WHEN gọi Detail, THEN `404 NOTIFICATION_NOT_FOUND`.
- **AC-008**: GIVEN `limit=500`, WHEN gọi List, THEN `400 VALIDATION_ERROR`.

### 7.5 [BE-07] Resilience
- **AC-013**: GIVEN Redis không kết nối được, WHEN `U` gọi `GET /notifications`, THEN vẫn `200`, mọi `isRead=false` (KHÔNG `500`).

### 7.4 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-004, FR-016 |
| AC-007b | FR-006, FR-016 |
| AC-005 | FR-010 |
| AC-007 | FR-009 |
| AC-008 | FR-011 |
| AC-009, AC-010, AC-011 | FR-012, FR-013, FR-014 |
| AC-012 | FR-015 |
| AC-013 | FR-016, FR-017 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- **Bảng mới hoặc cột JSON mới trên `notifications` để tracking đã đọc** — Product Owner đã từ chối vế này (mục 1.2), VẪN giữ nguyên ở đợt BE-07 (dùng Redis thay thế).
- Xóa/ẩn notification khỏi inbox cá nhân (soft-delete riêng cho từng user) — ngoài phạm vi.
- Push realtime qua WebSocket khi có notification mới — đã có event naming gợi ý `notification.created` trong CLAUDE.md mục 12 nhưng KHÔNG implement trong feature này.
- **[BE-07] Audit log cho hành động đánh dấu đã đọc** — không ghi `audit_logs` (tần suất cao, giá trị nghiệp vụ thấp, nhất quán với việc dữ liệu này vốn đã "mềm"/không bắt buộc chính xác tuyệt đối).
- **[BE-07] Đồng bộ đã đọc giữa nhiều thiết bị real-time** — trạng thái đọc chỉ phản ánh đúng khi client gọi lại API, không push qua WebSocket.

### 8.2 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT thêm bảng hoặc cột mới trên `notifications` để tracking trạng thái đã đọc.
- **FR-OOS-002**: THE system SHALL NOT trả về notification có `channel=email`/`sms` trong danh sách inbox.

### 8.3 [BE-07] Residuals / known-gaps
- **Mất trạng thái đã đọc khi Redis bị flush/mất dữ liệu** — chấp nhận (đã ghi trong 4 quyết định đã chốt của `PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md`). Người dùng sẽ thấy lại thông báo cũ như "chưa đọc" — không nguy hại (không mất nội dung notification, chỉ mất cờ đã đọc).
- **Không audit được ai đã đọc gì, khi nào** — nếu sau này cần compliance/audit trail cho hành vi đọc, phải quay lại phương án bảng thật (feature mới riêng, cần PO duyệt lại).
- **90 ngày TTL cho SET `notif:read:{userId}`** — notification đọc hơn 90 ngày trước, nếu KHÔNG có mốc `readAllAt` sau đó, sẽ "quay lại" trạng thái chưa đọc khi SET hết hạn (id rơi ra khỏi SET). Chấp nhận — inbox thực tế hiếm khi cần chính xác quá 90 ngày.
- **FR-OOS-003**: THE system SHALL NOT cho Admin bypass để xem thông báo của user khác qua endpoint này.

## Assumptions
Xem mục 1.4 và 1.5.
