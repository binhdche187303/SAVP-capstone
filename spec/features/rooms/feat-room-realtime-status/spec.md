---
name: feat-room-realtime-status
description: Read-only realtime room status — UC-36 overview list + UC-38 detail. Module rooms. Phase #30. No-show defer #31.
category: rooms
---

# Feature Specification: Trạng thái phòng realtime (Realtime Room Status)

- **Feature ID**: RMS-001 (UC-36 + UC-38 · phase #30)
- **Feature Name**: Xem trạng thái phòng realtime (overview + detail)
- **Module / Domain**: rooms
- **Created Date**: 2026-06-16
- **Status**: Draft (RECON xong, quyết định đã LOCK)
- **Source Documents**:
  - `spec/global/constitution.md` (SEC-02 auth; SEC-03 parameterize; DATA-01 soft-delete; ARCH-01 service boundary)
  - `CLAUDE.md` / `AGENTS.md` (§8.4 pagination/response; §22.6 rooms; DATA-01 không migration)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-36 realtime-status — 1498-1531; UC-38 room status — 1579-1614; WS table — 5316-5318)
  - `spec/features/presence/feat-occupancy-ingest` (OCC-001 / #29 — writer của current_status + room_events)
  - `src/modules/rooms/entities/*`, `src/modules/meetings/entities/meeting.entity.ts`, `src/modules/accounts/entities/user.entity.ts`
  - `src/modules/websocket/websocket.service.ts`

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo spec RMS-001 (UC-36/38): GET realtime-status (list) + GET :roomId/status (detail), read-only module rooms. LOCK NC-A..D: lastPresence từ room_events.event_time(occupancy>0); WS #30 không emit + patch #29 phát room.status.updated; occupancyCount latest room_events (null nếu chưa có event); perm room.utilization.read (seed defer). No-show defer #31. | Toàn bộ file (bản đầu tiên) |
| 2026-06-16 | Review fixes: (A) **KHÔNG có global interceptor** → giữ manual envelope `{success,message,data}`; (B) #29 emit room.status.updated **chỉ khi status thật sự đổi** (`IS DISTINCT FROM 'occupied' RETURNING id`); (C) `site_name`/`area_name` là **cột string** (giữ filter trực tiếp); (D) note currentStatus có thể **lag** (occupied sau khi trống tới #33); (E) #29 có **17 test** giữ xanh; (F) error code inline `ROOM_NOT_FOUND` (pattern repo); (G) UC-38 **không** có roomName. | Mục 4, 6, 7, 8, 10, 13 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
#29 (OCC-001) đã ingest occupancy → ghi `room_events.occupancy_count`, cập nhật `room_booking_usages`, và flip `rooms.current_status='occupied'`. Hiện **chưa có API đọc** trạng thái phòng cho FE/dashboard. #30 cung cấp 2 endpoint **read-only**: tổng quan nhiều phòng (UC-36) và chi tiết 1 phòng (UC-38).

### 1.2 Mục tiêu
- `GET /api/v1/rooms/realtime-status` — danh sách trạng thái phòng (lọc theo site/area).
- `GET /api/v1/rooms/:roomId/status` — chi tiết 1 phòng.
- Đọc từ nguồn có sẵn: `rooms`(status), `room_events`(occupancy/lastPresence), `room_bookings`+`meetings`+`users`(currentBooking). KHÔNG migration.
- Patch #29: phát thêm `room.status.updated` khi flip `current_status` (NC-B).

### 1.3 Giá trị mang lại
- Dashboard realtime trạng thái phòng (kết hợp WS `room.occupancy.updated` + `room.status.updated`).

### 1.4 Out-of-scope (defer — KHÔNG implement ở #30)
- **No-show detection / case** (UC-41/42 = **#31**): `noShowStatus`/`noShowCase` trả **null**; `releaseHistory` trả **`[]`** (placeholder).
- **Release logic / auto-release** (#33).
- **State-machine transitions** khác ngoài `→occupied` của #29 (các transition khác + WS tương ứng ở ticket sau).
- Seed role→permission thực (DevOps team-wide — NC-D defer).
- Đổi schema/migration (DATA-01).

---

## 2. UC summaries

| UC | Scope (≤15 từ) | Actor | In | Out |
|---|---|---|---|---|
| **UC-36** [API_CONTRACT:1498-1531](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md) | Xem tổng quan trạng thái nhiều phòng realtime | User có `room.utilization.read` | query `siteName?`,`areaName?` | array room-status |
| **UC-38** [API_CONTRACT:1579-1614](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md) | Xem chi tiết trạng thái 1 phòng | nt | path `roomId` | 1 room-status (full) |

---

## 3. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| rooms (status + filter) | [room.entity.ts](../../../../src/modules/rooms/entities/room.entity.ts): `current_status` enum `available/occupied/reserved/maintenance/inactive` (source-of-truth); `room_code`, `room_name`, `site_name`?(:39), `area_name`?(:42), `capacity`; `@DeleteDateColumn deleted_at`(:97). **KHÔNG có `current_headcount`**. ⇒ filter `siteName`→`site_name`, `areaName`→`area_name` (exact match; nullable). |
| room_events (occupancy/lastPresence) | [room-event.entity.ts:50](../../../../src/modules/rooms/entities/room-event.entity.ts): `room_id`(NN), `occupancy_count`(int?), `event_time`, `source_type`. ⇒ occupancyCount + lastPresenceAt lấy từ đây. |
| room_bookings (currentBooking) | [room-booking.entity.ts:38-59](../../../../src/modules/rooms/entities/room-booking.entity.ts): `meeting_id`(NN), `room_id`(NN), `reserved_start_time`, `reserved_end_time`, `status` enum (active = `approved/active`). |
| meetings/users | [meeting.entity.ts:59,64,67](../../../../src/modules/meetings/entities/meeting.entity.ts): `title`, `organizer_id`(NN), `host_id`?. [user.entity.ts:55](../../../../src/modules/accounts/entities/user.entity.ts): `full_name`. ⇒ hostName = `full_name` của `COALESCE(host_id, organizer_id)`. |
| no_show_cases | [no-show-case.entity.ts:43-57](../../../../src/modules/rooms/entities/no-show-case.entity.ts): `detection_status`, `warning_deadline_at`. ⇒ nguồn cho `noShowCase` — **defer #31** (trả null ở #30). |
| rooms module | [rooms.module.ts](../../../../src/modules/rooms/rooms.module.ts): forFeature [Room, RoomBooking, RoomBookingUsage, NoShowCase, RoomEvent] + Accounts + Meetings. **CHƯA có controller/service** → #30 là controller+service đầu tiên. |
| WS | [websocket.service.ts:27,50](../../../../src/modules/websocket/websocket.service.ts): `emitToRoom`/`broadcast`. Contract WS [API_CONTRACT:5316-5318]: `room.status.updated {roomId,status,timestamp}` (chưa ai phát) + `room.occupancy.updated` (#29 đã phát). |
| #29 writer | [occupancy-ingest.service.ts](../../../../src/modules/presence/services/occupancy-ingest.service.ts): flip `current_status='occupied'` + emit `room.occupancy.updated`. ⇒ NC-B: thêm emit `room.status.updated` tại đây. |

---

## 4. Endpoints

> **Envelope (A — verified)**: dự án **KHÔNG có** global TransformInterceptor (main.ts/app.module rỗng interceptor). Controller trả **manual** `{ success: true, message, data }` — đúng pattern recording/iot. Service trả raw (array list / object detail); controller bọc envelope. KHÔNG double-wrap.

### 4.1 UC-36 — `GET /api/v1/rooms/realtime-status`
| Field | Value |
|---|---|
| Auth | `JwtAuthGuard` + `MockPermissionsGuard` (no-op, pattern recording/iot) |
| Permission | `room.utilization.read` |
| Query | `siteName?` (string), `areaName?` (string) |
| Filter | `deleted_at IS NULL` + (siteName → `site_name = :siteName`) + (areaName → `area_name = :areaName`) |
| HTTP | 200 |

**Response 200** (field-for-field UC-36):
```json
{
  "success": true,
  "message": "Room realtime status retrieved",
  "data": [
    {
      "roomId": "uuid",
      "roomCode": "R101",
      "roomName": "Phòng họp 101",
      "currentStatus": "occupied",
      "currentBooking": {
        "meetingId": "uuid",
        "meetingTitle": "Họp Sprint",
        "hostName": "Nguyễn Văn A",
        "reservedEndTime": "2026-06-03T10:30:00+07:00"
      },
      "occupancyCount": 5,
      "noShowStatus": null,
      "lastPresenceAt": "2026-06-03T09:05:00+07:00"
    }
  ]
}
```
- UC-36 item có `roomName`. `currentBooking` (UC-36 shape): `meetingId, meetingTitle, hostName, reservedEndTime`.
- `currentBooking` = null nếu không có booking active. `occupancyCount` = null nếu phòng chưa có room_events (NC-C). `noShowStatus` = **null** (defer #31).

### 4.2 UC-38 — `GET /api/v1/rooms/:roomId/status`
| Field | Value |
|---|---|
| Auth | `JwtAuthGuard` + `MockPermissionsGuard` |
| Permission | `room.utilization.read` |
| Param | `roomId` UUID (route-level `ParseUUIDPipe`) |
| 404 | room không tồn tại / `deleted_at` IS NOT NULL → `ROOM_NOT_FOUND` |
| HTTP | 200 |

**Response 200** (field-for-field UC-38):
```json
{
  "success": true,
  "message": "Room status retrieved",
  "data": {
    "roomId": "uuid",
    "roomCode": "R101",
    "currentStatus": "occupied",
    "currentBooking": {
      "bookingId": "uuid",
      "meetingId": "uuid",
      "title": "Họp Sprint",
      "hostName": "Nguyễn Văn A",
      "reservedStartTime": "2026-06-03T09:00:00+07:00",
      "reservedEndTime": "2026-06-03T10:30:00+07:00"
    },
    "noShowCase": null,
    "releaseHistory": [],
    "lastPresenceAt": "2026-06-03T09:10:00+07:00",
    "occupancyCount": 5
  }
}
```
- **(G — verified)** UC-38 detail **KHÔNG có `roomName`** (chỉ `roomCode`); UC-36 list MỚI có `roomName`. `currentBooking` (UC-38 shape, khác UC-36): `bookingId, meetingId, title, hostName, reservedStartTime, reservedEndTime`.
- `noShowCase` = **null**, `releaseHistory` = **`[]`** (defer #31/#33). `currentBooking`/`occupancyCount`/`lastPresenceAt` = null nếu không có.

### 4.3 Route order
`@Get('rooms/realtime-status')` PHẢI khai báo **TRƯỚC** `@Get('rooms/:roomId/status')` để `realtime-status` không bị nuốt bởi param route. (Path khác segment cuối nên thực tế không đụng, nhưng giữ thứ tự an toàn.)

---

## 5. Data-source query approach (per output field)

```text
# Source-of-truth + soft-delete  (C — verified: site_name/area_name là cột varchar, filter trực tiếp)
currentStatus  = rooms.current_status   (WHERE deleted_at IS NULL)
roomCode/Name  = rooms.room_code / room_name

# occupancyCount (NC-C): latest room_events; null nếu KHÔNG có event nào
  SELECT occupancy_count FROM room_events
  WHERE room_id = $1 AND occupancy_count IS NOT NULL
  ORDER BY event_time DESC LIMIT 1;          -- không có → null (KHÔNG phải 0)

# lastPresenceAt (NC-A): single source, KHÔNG branch theo booking
  SELECT event_time FROM room_events
  WHERE room_id = $1 AND occupancy_count > 0
  ORDER BY event_time DESC LIMIT 1;          -- không có → null

# currentBooking: booking active tại now()
  SELECT b.id AS booking_id, b.meeting_id, m.title, u.full_name AS host_name,
         b.reserved_start_time, b.reserved_end_time
  FROM room_bookings b
  JOIN meetings m ON m.id = b.meeting_id
  LEFT JOIN users u ON u.id = COALESCE(m.host_id, m.organizer_id)
  WHERE b.room_id = $1
    AND b.reserved_start_time <= now() AND b.reserved_end_time >= now()
    AND b.status IN ('approved','active')
  ORDER BY b.reserved_start_time ASC LIMIT 1;  -- overlap → đầu theo thời gian; không có → null

# noShowStatus / noShowCase / releaseHistory  → defer #31/#33 (null / [])
```

### 5.1 Tránh N+1 cho UC-36 (list)
KHÔNG loop per-room query. Dùng **LATERAL subquery** (Postgres) hoặc batch:
```sql
SELECT r.id, r.room_code, r.room_name, r.current_status,
       oc.occupancy_count, lp.event_time AS last_presence_at,
       cb.booking_id, cb.meeting_id, cb.title, cb.host_name, cb.reserved_start_time, cb.reserved_end_time
FROM rooms r
LEFT JOIN LATERAL (
  SELECT occupancy_count FROM room_events
  WHERE room_id = r.id AND occupancy_count IS NOT NULL
  ORDER BY event_time DESC LIMIT 1) oc ON true
LEFT JOIN LATERAL (
  SELECT event_time FROM room_events
  WHERE room_id = r.id AND occupancy_count > 0
  ORDER BY event_time DESC LIMIT 1) lp ON true
LEFT JOIN LATERAL (
  SELECT b.id AS booking_id, b.meeting_id, m.title,
         u.full_name AS host_name, b.reserved_start_time, b.reserved_end_time
  FROM room_bookings b JOIN meetings m ON m.id = b.meeting_id
  LEFT JOIN users u ON u.id = COALESCE(m.host_id, m.organizer_id)
  WHERE b.room_id = r.id AND b.reserved_start_time <= now() AND b.reserved_end_time >= now()
    AND b.status IN ('approved','active')
  ORDER BY b.reserved_start_time ASC LIMIT 1) cb ON true
WHERE r.deleted_at IS NULL
  AND ($1::text IS NULL OR r.site_name = $1)
  AND ($2::text IS NULL OR r.area_name = $2)
ORDER BY r.room_code;
```
SEC-03: tất cả tham số bind ($1/$2/room_id), KHÔNG nối chuỗi.

---

## 6. Business Rules (LOCKED)

```text
BR-1 (NC-A lastPresenceAt): latest room_events.event_time WHERE occupancy_count > 0; null nếu không có. KHÔNG branch theo booking.
BR-2 (NC-C occupancyCount): latest room_events.occupancy_count; **null nếu phòng KHÔNG có room_events** (unknown, KHÔNG phải 0). Recency thể hiện qua lastPresenceAt.
BR-3 (currentBooking): active = status IN ('approved','active') & now() trong [reserved_start, reserved_end]; overlap → đầu theo thời gian; null nếu không có.
BR-4 (no-show defer): noShowStatus/noShowCase = null; releaseHistory = []. (#31/#33).
BR-5 (soft-delete): list + detail loại room có deleted_at (DATA-01). Detail soft-deleted → 404 ROOM_NOT_FOUND.
BR-6 (currentStatus): đọc thẳng rooms.current_status (source-of-truth do #29/writer cập nhật). #30 KHÔNG suy diễn lại status từ occupancy.
BR-6a (D — status lag): current_status CÓ THỂ còn 'occupied' SAU khi phòng đã trống — transition count==0 → release/available defer **#33**. #30 đọc source-of-truth as-is, KHÔNG re-derive. FE/tester lưu ý status có thể trễ tới khi #33 xong.
BR-7 (filter): siteName→site_name exact; areaName→area_name exact; thiếu query → không filter trường đó.
```

## 7. WebSocket (NC-B — patch #29, #30 KHÔNG emit)

```text
- #30 là READ-ONLY → KHÔNG emit gì (reader không đổi state) → tránh double-emit.
- PATCH #29 (occupancy-ingest.service.ts): đổi UPDATE rooms thành CÓ ĐIỀU KIỆN + RETURNING:
    UPDATE rooms SET current_status='occupied'
    WHERE id = $1 AND current_status IS DISTINCT FROM 'occupied'
    RETURNING id;
  → emit room.status.updated { roomId, status:'occupied', timestamp } CHỈ KHI có row trả về
    (status THẬT SỰ đổi). Best-effort try/catch, CẠNH emit room.occupancy.updated hiện có.
  → occupancy lặp khi đã 'occupied' → KHÔNG có row → KHÔNG emit status.updated (vẫn emit occupancy.updated).
- CHỈ transition →occupied phát (by design #30); transition khác (available/reserved/...) ở ticket sau.
- Lỗi WS KHÔNG ảnh hưởng 202/DB. Chạy lại **toàn bộ 17 test #29** (no-regression).
- FE: subscribe room.occupancy.updated (count) + room.status.updated (status); GET #30 cho snapshot đầy đủ.
```

---

## 8. Functional Requirements (EARS)

```text
FR-RMS-001-001: THE system SHALL cung cấp GET /api/v1/rooms/realtime-status trả danh sách room-status (loại deleted_at), filter siteName/areaName.
FR-RMS-001-002: THE system SHALL cung cấp GET /api/v1/rooms/:roomId/status trả chi tiết 1 phòng; IF không tồn tại/soft-deleted → 404 ROOM_NOT_FOUND.
FR-RMS-001-003: THE response SHALL khớp field-for-field UC-36/UC-38 (roomId, roomCode, roomName?, currentStatus, currentBooking{...}, occupancyCount, noShowStatus/noShowCase, lastPresenceAt, releaseHistory[]).
FR-RMS-001-004: occupancyCount SHALL = latest room_events.occupancy_count; null nếu phòng không có room_events.
FR-RMS-001-005: lastPresenceAt SHALL = latest room_events.event_time WHERE occupancy_count > 0; null nếu không có.
FR-RMS-001-006: currentBooking SHALL = booking active (approved/active, now trong khoảng); null nếu không có; hostName = full_name của COALESCE(host_id, organizer_id).
FR-RMS-001-007: noShowStatus/noShowCase SHALL = null; releaseHistory SHALL = [] (defer #31/#33).
FR-RMS-001-008: List SHALL tránh N+1 (LATERAL/batch), KHÔNG loop per-room.
FR-RMS-001-009: Mọi endpoint SHALL gate bằng JwtAuthGuard + @Permissions('room.utilization.read').
FR-RMS-001-010 (NC-B): #29 occupancy-ingest SHALL cập nhật current_status='occupied' CÓ ĐIỀU KIỆN (`IS DISTINCT FROM 'occupied' RETURNING id`) và SHALL emit room.status.updated {roomId,status,timestamp} (best-effort) **CHỈ KHI status thật sự đổi** (có row trả về); occupancy lặp khi đã occupied → KHÔNG emit status.updated. #30 KHÔNG emit.
FR-RMS-001-011 (envelope): Controller SHALL trả manual `{success, message, data}` (KHÔNG có global interceptor); service trả raw (array/object).
FR-RMS-001-012 (error codes): Dùng inline `{code}` theo pattern repo — `ROOM_NOT_FOUND` (404); roomId sai uuid → 400 (ParseUUIDPipe mặc định Nest); thiếu quyền → 403 (guard).
```

## 9. Non-functional (EARS / Constitution)

```text
NFR-RMS-001-001 (SEC-02): Endpoint auth-gated (JWT) + permission room.utilization.read.
NFR-RMS-001-002 (SEC-03): Mọi query parameterize (bind $1.. / QueryBuilder); KHÔNG nối chuỗi user input.
NFR-RMS-001-003 (DATA-01): Loại room soft-deleted; KHÔNG migration/đổi schema.
NFR-RMS-001-004 (Perf): List 1-2 round-trip (LATERAL), KHÔNG N+1.
NFR-RMS-001-005 (Read-only): #30 SHALL NOT ghi DB / SHALL NOT emit WS.
NFR-RMS-001-006 (Route): /rooms/realtime-status khai trước /rooms/:roomId/status (không bị param nuốt).
NFR-RMS-001-007 (No global pipe): dùng @UsePipes route-level (ParseUUIDPipe cho roomId); KHÔNG phụ thuộc global ValidationPipe.
```

## 10. Acceptance Criteria

```text
AC-RMS-001-001 (list): Given nhiều phòng; When GET realtime-status; Then 200 array, mỗi item đúng field UC-36, loại deleted.
AC-RMS-001-002 (list filter): Given ?siteName=X&areaName=Y; Then chỉ phòng khớp site/area.
AC-RMS-001-003 (detail found): Given roomId hợp lệ; Then 200 đúng field UC-38.
AC-RMS-001-004 (detail 404): Given roomId không tồn tại/soft-deleted; Then 404 ROOM_NOT_FOUND.
AC-RMS-001-005 (occupancyCount null): Given phòng KHÔNG có room_events; Then occupancyCount=null (KHÔNG 0).
AC-RMS-001-006 (occupancyCount value): Given có room_events; Then occupancyCount = count mới nhất.
AC-RMS-001-007 (lastPresenceAt null): Given không có room_events occupancy>0; Then lastPresenceAt=null.
AC-RMS-001-008 (currentBooking present): Given booking active; Then currentBooking đầy đủ (bookingId/meetingId/title/hostName/reserved*).
AC-RMS-001-009 (currentBooking absent): Given không booking active; Then currentBooking=null.
AC-RMS-001-010 (no-show defer): noShowStatus/noShowCase=null; releaseHistory=[].
AC-RMS-001-011 (perm): thiếu quyền → 403; roomId sai uuid → 400.
AC-RMS-001-012 (#29 emit conditional): Given phòng đang 'available', occupancy count>0 lần đầu; When #29 ingest; Then UPDATE trả row → emit room.status.updated('occupied') best-effort. Given phòng ĐÃ 'occupied', occupancy event lặp; When ingest; Then UPDATE KHÔNG trả row → KHÔNG emit room.status.updated (vẫn emit room.occupancy.updated). Lỗi WS KHÔNG ảnh hưởng 202; **toàn bộ 17 test #29 xanh**.
```

## 11. Error Code Map
| HTTP | Code |
|---|---|
| 200 | (ok) |
| 400 | VALIDATION_ERROR (roomId sai uuid) |
| 401 | UNAUTHORIZED |
| 403 | FORBIDDEN |
| 404 | ROOM_NOT_FOUND |

---

## 12. Constitution / CLAUDE compliance
- **SEC-02**: GET nhưng perm-gated (`room.utilization.read`) + JWT. ✅
- **SEC-03**: raw SQL trên `dataSource.manager` (nhất quán #29) **parameterized** ($1/$2/roomId) hoặc QueryBuilder. ✅
- **DATA-01**: soft-delete filter (`deleted_at IS NULL`); KHÔNG hard-delete, KHÔNG migration. ✅
- **ARCH-01**: #30 đọc DB của domain rooms (cùng module) — KHÔNG cross-service DB access trái phép. ✅
- **No migration / no new column**: dùng cột có sẵn. ✅

---

## 13. Test Plan (Jest — MOCK dataSource, KHÔNG DB/camera thật)

```text
room-status.service.spec (mock dataSource.manager.query router theo SQL):
- list: nhiều phòng → array đúng field; loại deleted (WHERE deleted_at IS NULL trong SQL).
- list filter: siteName/areaName truyền → SQL bind đúng tham số.
- list occupancyCount null: phòng không có room_events → null.
- detail found: 200 đúng field UC-38.
- detail 404: query rỗng → ROOM_NOT_FOUND.
- occupancyCount: có event → giá trị; không event → null.
- lastPresenceAt: occupancy>0 có → value; không → null.
- currentBooking: present (join trả booking) / absent (null).
- soft-deleted excluded: assert SQL chứa 'deleted_at IS NULL'.

room-camera/occupancy-ingest #29 patch spec (cập nhật):
- UPDATE rooms có điều kiện RETURNING id → CÓ row (status đổi) → emit 'room.status.updated' {roomId,status,timestamp} (cạnh room.occupancy.updated).
- occupancy lặp khi đã 'occupied' → UPDATE KHÔNG trả row → KHÔNG emit status.updated.
- WS lỗi → vẫn 202 (best-effort).
- **Toàn bộ 17 test #29 vẫn xanh** (no-regression).

controller spec (mock service): list/detail passthrough + 404.
```

---

> Trạng thái: **CHỜ REVIEW spec** (quyết định đã LOCK; no-show/release defer). Chưa plan/tasks/code.
