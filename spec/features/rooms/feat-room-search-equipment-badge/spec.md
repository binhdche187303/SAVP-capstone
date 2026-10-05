# SPEC — ROOM-SEARCH-FAULT-BADGE-001: Hiển thị tình trạng thiết bị khi tìm phòng

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-08-14 | Tạo mới spec.md cho ROOM-SEARCH-FAULT-BADGE-001. Trạng thái [Missing]. | Toàn bộ file |

> Phạm vi: `GET /api/v1/rooms/search` (UC-ROOM-04, endpoint duy nhất mọi user đã đăng nhập dùng để tìm phòng trước khi đặt) trả thêm badge tình trạng thiết bị theo từng phòng.
> KHÔNG bao gồm: chặn đặt phòng (`spec/features/meeting/feat-room-equipment-fault-warning/`), notify/confirm/resolve thiết bị (`spec/features/equipment/feat-equipment-fault-lifecycle/`), `GET /rooms/:roomId` (admin-only, feature `ROOM-VIEW-DETAIL-001` riêng, KHÔNG đụng).
> Tài liệu này chỉ là đặc tả (spec). KHÔNG kèm code.

---

## 0. Khảo sát hiện trạng (bắt buộc đọc trước)

### 0.1. `GET /rooms/search` — endpoint đúng cho employee tìm phòng
`rooms.controller.ts:61-83` — route `search`, **không có `@RequirePermissions`**, comment dòng 57-60 xác nhận: *"UC-ROOM-04: tim kiem/liet ke danh sach phong (moi user da dang nhap, khong permission rieng)"*. Đây chính là API employee dùng để browse phòng trước khi tạo meeting.

`GET /rooms/:roomId` (route `:roomId`, dòng 271-286) yêu cầu permission `room.detail.read`, seed **chỉ** cho `SYSTEM_ADMIN, BUSINESS_ADMIN` (`20260811000003-SeedRoomDetailReadPermission.ts:34-35`, comment "D-3: CHI seed cho SYSTEM_ADMIN + BUSINESS_ADMIN, KHONG MANAGER/EMPLOYEE"). ⇒ Employee **KHÔNG gọi được** endpoint này — badge KHÔNG thể đặt ở `RoomDetailResponseDto`/`getRoomDetail()`, phải đặt ở `RoomSearchItemDto`/`RoomSearchService`.

### 0.2. `RoomSearchService` hiện tại — raw SQL, không JOIN equipment
`room-search.service.ts:78-87`:
```sql
SELECT r.id, r.room_code, r.room_name, r.site_name, r.area_name,
       r.location_description, r.capacity, r.room_type, r.current_status,
       r.has_camera, r.has_microphone, r.has_display, r.allow_recording
FROM rooms r
${whereClause}
ORDER BY r.room_code ASC
LIMIT $5 OFFSET $6
```
`RoomSearchRow` interface (dòng 6-20) và `toItem()` (113-129) map 1-1 với SELECT list — không có field thiết bị.

### 0.3. Quan hệ equipment→room 1 chiều, không `@OneToMany`
`RoomEntity` không có quan hệ TypeORM tới `EquipmentEntity` (đã verify khảo sát trước đó). Chỉ có `equipments.current_room_id` (FK, có thể null). Muốn biết "phòng X có bao nhiêu thiết bị hỏng" phải JOIN/subquery từ phía `equipments`, đúng convention dự án (không dùng eager/2-chiều relation).

---

## 1. Tổng quan Feature

| Thuộc tính | Giá trị |
| :--- | :--- |
| **Feature ID** | ROOM-SEARCH-FAULT-BADGE-001 |
| **Module** | Rooms (`src/modules/rooms`), đọc bảng `equipments` qua raw SQL (không cần entity/module mới — `RoomSearchService` đã dùng raw SQL sẵn) |
| **Primary Actor** | Bất kỳ user đã đăng nhập (không permission riêng — đúng UC-ROOM-04) |
| **Trigger** | Gọi `GET /api/v1/rooms/search` |
| **Expected Output** | Mỗi phòng trong kết quả có thêm `hasFaultyEquipment`, `faultyEquipmentCount`, `hasEquipmentWarning`. |
| **Pre-condition** | Không có — endpoint public cho user đã đăng nhập, không phụ thuộc trạng thái khác. |
| **Related** | `feat-equipment-fault-lifecycle` (nguồn dữ liệu `healthStatus`), `feat-room-equipment-fault-warning` (chặn thật sự khi đặt — badge này chỉ mang tính thông tin trước đó). |

---

## 2. Actor & Pre-condition

Không đổi so với UC-ROOM-04 hiện có — mọi user đã đăng nhập (`JwtAuthGuard` ở tầng global hoặc route, không `PermissionsGuard` riêng cho `search`).

---

## 3. Endpoint

Không có endpoint mới. **SỬA** `GET /api/v1/rooms/search` (đã có) — chỉ thêm field vào response.

---

## 4. Output — thêm field vào `RoomSearchItemDto`

| Field | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `hasFaultyEquipment` | boolean | `true` nếu phòng có ≥1 thiết bị `healthStatus ∈ {faulty,offline}` |
| `faultyEquipmentCount` | number | Số lượng thiết bị `faulty/offline` trong phòng |
| `hasEquipmentWarning` | boolean | `true` nếu phòng có ≥1 thiết bị `healthStatus = warning` (thông tin thêm, không phải điều kiện chặn ở feature khác) |

---

## 5. Main Flow

1. Client gọi `GET /api/v1/rooms/search?...` (filter hiện có: capacity/area/onlyAvailable, không đổi).
2. `RoomSearchService.search()` build SQL — **THÊM** `LEFT JOIN LATERAL` (hoặc subquery) đếm thiết bị theo `health_status`, group theo `current_room_id`.
3. Map kết quả → `RoomSearchItemDto` có thêm 3 field mới.
4. Trả `{success, message, data: RoomSearchItemDto[], meta}` — shape response không đổi, chỉ thêm field trong từng item.

---

## 6. Thiết kế SQL

```sql
SELECT r.id, r.room_code, r.room_name, r.site_name, r.area_name,
       r.location_description, r.capacity, r.room_type, r.current_status,
       r.has_camera, r.has_microphone, r.has_display, r.allow_recording,
       COALESCE(eq.faulty_count, 0) AS faulty_count,
       COALESCE(eq.warning_count, 0) AS warning_count
FROM rooms r
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE health_status IN ('faulty','offline')) AS faulty_count,
    COUNT(*) FILTER (WHERE health_status = 'warning') AS warning_count
  FROM equipments e
  WHERE e.current_room_id = r.id AND e.deleted_at IS NULL
) eq ON true
${whereClause}
ORDER BY r.room_code ASC
LIMIT $5 OFFSET $6
```
`e.deleted_at IS NULL` — loại thiết bị đã soft-delete (đúng convention `@DeleteDateColumn` của `EquipmentEntity`).

`whereClause`/`whereParams`/`countRows` query (dòng 67-93) **không đổi** — badge không phải điều kiện lọc, chỉ hiển thị. (Không thêm filter `onlyWithFaultyEquipment` — ngoài phạm vi, có thể xem xét ở feature khác nếu cần.)

---

## 7. Ngữ nghĩa & ràng buộc

### 7.1. Badge chỉ mang tính thông tin, không chặn
Feature này **không** ngăn phòng xuất hiện trong kết quả tìm kiếm, không đổi `currentStatus`/`onlyAvailable` filter hiện có. Việc chặn thật sự (không cho đặt) thuộc `feat-room-equipment-fault-warning`.

### 7.2. `warning` cũng hiển thị (khác với booking gate)
Booking gate (`feat-room-equipment-fault-warning`) chỉ chặn `faulty/offline`. Badge ở đây **hiển thị cả `warning`** (`hasEquipmentWarning`) vì mục đích là cung cấp thông tin đầy đủ cho user trước khi quyết định đặt, không cần giới hạn giống điều kiện chặn.

---

## 8. Ràng buộc trạng thái

Không có — chỉ đọc `healthStatus` hiện tại tại thời điểm query, không lưu derived state.

---

## 9. Permission / RBAC

Không đổi — endpoint `search` vẫn không yêu cầu permission riêng.

---

## 10. Audit logging

Không áp dụng — đây là read-only endpoint, không phải hành động thay đổi dữ liệu (CLAUDE.md §17 chỉ yêu cầu audit cho hành động quan trọng, không áp dụng cho GET).

---

## 11. Ranh giới feature

| Việc | Thuộc feature nào | Feature này làm? |
| :--- | :--- | :--- |
| Hiển thị badge khi tìm phòng (`GET /rooms/search`) | **ROOM-SEARCH-FAULT-BADGE-001** | ✅ |
| Chặn/yêu cầu xác nhận khi đặt phòng thật sự | `feat-room-equipment-fault-warning` | ❌ |
| `GET /rooms/:roomId` (admin detail) | `ROOM-VIEW-DETAIL-001` (đã có, không đụng) | ❌ |
| Set `healthStatus` thiết bị | `feat-equipment-fault-lifecycle` | ❌ (chỉ đọc) |

---

## 12. Điểm đã chốt

| # | Vấn đề | Chốt |
| :--- | :--- | :--- |
| C1 | Đặt badge ở `search` hay `:roomId` detail | `search` — vì đó là API employee thực sự dùng (`:roomId` chỉ SYSTEM_ADMIN/BUSINESS_ADMIN gọi được) |
| C2 | Có filter theo badge không (`onlyWithFaultyEquipment`) | KHÔNG trong phạm vi này — chỉ hiển thị, có thể xem xét sau |
| C3 | `warning` có hiển thị không | CÓ (`hasEquipmentWarning`) — khác booking gate (chỉ faulty/offline) |
| C4 | Cách JOIN | `LEFT JOIN LATERAL` subquery aggregate theo `current_room_id`, loại `deleted_at IS NOT NULL` |

---

## 13. Functional Requirements

- **FR-01**: WHEN người dùng gọi `GET /rooms/search`, THE system SHALL trả kèm `hasFaultyEquipment`, `faultyEquipmentCount`, `hasEquipmentWarning` cho mỗi phòng.
- **FR-02**: WHERE phòng có ≥1 thiết bị `healthStatus ∈ {faulty,offline}` chưa soft-delete, THE system SHALL set `hasFaultyEquipment=true` và `faultyEquipmentCount` đúng số lượng.
- **FR-03**: WHERE phòng không có thiết bị nào ở trạng thái `faulty/offline/warning`, THE system SHALL trả `hasFaultyEquipment=false, faultyEquipmentCount=0, hasEquipmentWarning=false`.
- **FR-04**: THE system SHALL loại trừ thiết bị đã soft-delete (`deleted_at IS NOT NULL`) khỏi mọi phép đếm.
- **FR-05**: THE system SHALL KHÔNG thay đổi hành vi filter/pagination hiện có của `search` (capacityMin/Max, areaName, onlyAvailable, page, limit).

## 14. Non-Functional Requirements

- **NFR-01**: Query mới KHÔNG N+1 — dùng 1 câu SQL duy nhất với `LEFT JOIN LATERAL`, không query riêng cho từng phòng.
- **NFR-02**: KHÔNG thêm bảng/cột DB mới — chỉ đọc dữ liệu `equipments` đã có.
- **NFR-03**: Response field naming theo camelCase đúng convention dự án.

## 15. Acceptance Criteria

- **AC-01**: Given phòng A có 2 thiết bị `faulty` + 1 `healthy`, When gọi `GET /rooms/search`, Then item của phòng A có `hasFaultyEquipment=true, faultyEquipmentCount=2`.
- **AC-02**: Given phòng B chỉ có thiết bị `healthy`, When gọi `GET /rooms/search`, Then item của phòng B có `hasFaultyEquipment=false, faultyEquipmentCount=0, hasEquipmentWarning=false`.
- **AC-03**: Given phòng C có 1 thiết bị `warning`, When gọi `GET /rooms/search`, Then `hasEquipmentWarning=true`, `hasFaultyEquipment=false`.
- **AC-04**: Given phòng D có 1 thiết bị `faulty` đã soft-delete (`deletedAt` khác null), When gọi `GET /rooms/search`, Then thiết bị đó KHÔNG tính vào `faultyEquipmentCount`.
- **AC-05**: Given filter `onlyAvailable=true`/`capacityMin`/`areaName` hiện có, When gọi `GET /rooms/search`, Then kết quả lọc giống hệt hành vi trước khi có feature này (chỉ thêm field, không đổi tập kết quả).

## 16. Exception / Alternative Flows

Không có nhánh lỗi mới — endpoint `search` giữ nguyên validate hiện có (`capacityMin > capacityMax` → 400, đã có).

---

## 17. [Missing] — Tóm tắt cần làm

**Trạng thái: [Missing]**.

1. SỬA raw SQL trong `RoomSearchService.search()` — thêm `LEFT JOIN LATERAL`.
2. SỬA `RoomSearchRow` interface — thêm `faulty_count`, `warning_count`.
3. SỬA `toItem()` — map sang `hasFaultyEquipment`/`faultyEquipmentCount`/`hasEquipmentWarning`.
4. SỬA `RoomSearchItemDto` — thêm 3 field.
5. Test: đủ AC-01 đến AC-05.

**Ranh giới**: KHÔNG sửa `RoomDetailResponseDto`/`getRoomDetail()`. KHÔNG đổi `whereClause`/filter hiện có. KHÔNG thêm permission. KHÔNG implement chặn đặt phòng (`feat-room-equipment-fault-warning` riêng).
