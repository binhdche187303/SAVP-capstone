---
name: feat-occupancy-ingest
description: Ingest occupancy event từ Python Camera Service → iot_device_events + room_events + presence_snapshots + room_booking_usages + rooms.current_status. Phase #29 / UC-75.
category: presence
---

# Feature Specification: Nhận occupancy event (Occupancy Ingest)

- **Feature ID**: OCC-001 (UC-75 · phase #29)
- **Feature Name**: Nhận event đếm người từ Python Camera Service → headcount/presence
- **Module / Domain**: presence (+ iot raw event)
- **Created Date**: 2026-06-16
- **Status**: Draft (RECON xong — còn [NEEDS CLARIFICATION])
- **Source Documents**:
  - `CLAUDE.md` (SEC-01; §11.4/11.7/11.8/11.9 device callback + camera boundary; §22.7b room-camera; DATA-01 không migration)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-75 occupancy-events — 2977-3005; UC-36/38 room status; WS room.occupancy.updated — 5318)
  - `src/modules/iot/controllers/device-callbacks.controller.ts`, `short-device-callbacks.controller.ts`, `services/iot-devices.service.ts`
  - `src/modules/presence/` (module rỗng), `src/modules/rooms/entities/*`, `src/modules/iot/entities/iot-device-event.entity.ts`
  - `src/modules/websocket/events.gateway.ts`, `websocket.service.ts`

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo spec OCC-001 (UC-75): ingest occupancy → raw iot_device_events → room_events → (nếu meeting) presence_snapshots + room_booking_usages → rooms.current_status (occupied khi count>0) → 202. Auth device callback (deviceCode+callbackToken). RECON file:line. Còn NC-1..4. | Toàn bộ file (bản đầu tiên) |
| 2026-06-16 | Chốt NC-1..4 + đổi **AUTH TRƯỚC RAW** (sai auth → KHÔNG lưu raw): (1) path **`POST /api/v1/room-camera/occupancy-snapshots`** (CLAUDE §22.7b); (2) WS **phát best-effort** `room.occupancy.updated` (try/catch riêng); (3) token = `camera_service_config.callback_token_hash` per-device (mirror face, seed cho device test); (4) count==0 KHÔNG đổi status. Mục 4, 5, 6, 11 → Resolved. | Mục 4, 5, 6, 11 |
| 2026-06-16 | Vá: (a) AUTH status chỉ chặn `status=='disabled'` (offline/maintenance vẫn nhận — occupancy là bằng chứng device sống); (b) SEC redact token khỏi raw `payload_json` bằng `maskSensitiveMetadata` (key chứa token/secret/password → '***'). | Mục 4, FR-002/FR-003 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
Python Camera Service (ngoài) phân tích RTSP IP Room Camera → đếm số người trong phòng (occupancy) → **POST event** vào backend. Backend **KHÔNG** tự chạy CV (CLAUDE §11.2/§11.7). #29 hiện thực endpoint **INGEST**: nhận event, lưu raw, chuẩn hóa, ghi headcount/presence vào DB để nuôi room-status realtime (#30) và no-show/utilization (sau).

### 1.2 Mục tiêu
- Endpoint ingest occupancy (auth device callback, không JWT user).
- Lưu raw payload **trước** (iot_device_events), rồi normalize.
- LUÔN ghi `room_events` (occupancy_count); nếu có meeting/booking active → `presence_snapshots` + cập nhật `room_booking_usages`.
- count>0 → set `rooms.current_status='occupied'`.
- Trả 202 `{accepted:true}`.

### 1.3 Giá trị mang lại
- Có nguồn headcount realtime cho dashboard (#30) + dữ liệu nền no-show/utilization.

### 1.4 Out-of-scope
- Backend-side CV/đếm người (Python service làm).
- No-show evaluation / auto-release (#utilization sau) — #29 chỉ ghi presence/usage thô.
- Room status READ API (UC-36/38 = #30).
- Đổi schema/migration: dùng `iot_device_events`/`room_events`/`presence_snapshots`/`room_booking_usages`/`rooms` có sẵn (DATA-01). **KHÔNG** thêm cột `current_headcount` cho rooms (headcount suy từ occupancy_count mới nhất).

---

## 2. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| UC-75 (contract) | [API_CONTRACT_v1.0_with_system_roles.md:3062-3090](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md): `POST /api/v1/internal/camera-service/occupancy-events` · perm `internal.device.callback` · Async **202** `{accepted:true}` · body `{deviceCode, roomId, meetingId, eventType:"occupancy_detected", occupancyCount, confidence, eventTime, metadata}`. Side-effects: iot_device_events; presence_snapshots; room_events; room_booking_usages.first_presence_at. |
| Face callback path (repo) | [device-callbacks.controller.ts:5](../../../../src/modules/iot/controllers/device-callbacks.controller.ts) `@Controller('device-callbacks')` → `/api/v1/device-callbacks/face/heartbeat\|verify\|stranger`. Biến thể short: [short-device-callbacks.controller.ts:4-26](../../../../src/modules/iot/controllers/short-device-callbacks.controller.ts) `@Controller('hb')` → `/api/v1/hb/:deviceCode/:callbackToken`. ⇒ pattern repo = `device-callbacks/<vendor>/*`; contract UC-75 = `/internal/camera-service/...`; CLAUDE §22.7b = `/room-camera/*`. **3 path khác nhau → [NC-1]**. |
| Auth callback (token validate) | [iot-devices.service.ts:1002-1078](../../../../src/modules/iot/services/iot-devices.service.ts) `receiveHeartbeat`: extract callbackToken từ header `X-Callback-Token`/body/query/`params.callbackToken` → sha256 so với `device.metadataJson.face_server_config.callback_token_hash` ([:1041]). **KHÔNG có** hàm validate token độc lập (logic nhúng trong handler, gắn `face_server_config`). Token lưu **hash** trong `metadata_json` ([:719-720] `callback_token_hash`/`callback_token_last4`). ⇒ camera service cần config token riêng (vd `camera_service_config.callback_token_hash`) — **[NC-3]**. iot_devices KHÔNG có cột token (chỉ `mqtt_topic`). |
| iot_device_events (raw) | [iot-device-event.entity.ts:46-88](../../../../src/modules/iot/entities/iot-device-event.entity.ts): `device_id`(NN), `room_id`?, `meeting_id`?, `event_type`, `payload_json`(jsonb), `event_time`, `severity`, `error_message`. ⇒ lưu raw đủ. |
| room_events | [room-event.entity.ts:18-66](../../../../src/modules/rooms/entities/room-event.entity.ts): `room_id`(NN), `meeting_id`**?(nullable)**, `booking_id`?, `event_type`, `event_time`, **`occupancy_count`(int?)**, `confidence_score`, `old/new_status`, `metadata_json`. ⇒ LUÔN ghi được (kể cả KHÔNG có meeting). |
| presence_snapshots | [presence-snapshot.entity.ts:33-77](../../../../src/modules/presence/entities/presence-snapshot.entity.ts): `meeting_id`**(NN ⚠️)**, `room_id`(NN), **`occupancy_count`(int?)**, `presence_status`(present/…), `snapshot_time`(NN), `source_type`(camera/…), `confidence_score`. ⇒ chỉ insert **khi có meeting** (meeting_id NOT NULL). |
| room_booking_usages | [room-booking-usage.entity.ts:35-76](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts): `booking_id`(NN), `meeting_id`(NN), `room_id`(NN), `first_presence_at`?, `last_presence_at`?, `usage_status`(not_started/in_use/…), `occupancy_source`(camera/…). ⇒ update khi có **booking active** của room. |
| rooms | [room.entity.ts:59-65](../../../../src/modules/rooms/entities/room.entity.ts): `current_status`(enum available/**occupied**/reserved/…), `capacity`. **KHÔNG có `current_headcount`**. ⇒ set current_status; headcount suy từ occupancy_count mới nhất. |
| presence module | [presence.module.ts](../../../../src/modules/presence/presence.module.ts): **rỗng** (chỉ forFeature `PresenceSnapshotEntity` + import Accounts/Meetings/Rooms; KHÔNG controller/service). ⇒ #29 thêm controller + service ở đây. |
| WS gateway | [events.gateway.ts:24-50](../../../../src/modules/websocket/events.gateway.ts) `@WebSocketGateway` + `server: Server` (Socket.IO). [websocket.service.ts:27/50](../../../../src/modules/websocket/websocket.service.ts) `emitToRoom(room,event,data)` + `broadcast(event,data)`. ⇒ WS infra **CÓ SẴN** → có thể phát `room.occupancy.updated` — **[NC-2]**. |

### 2.1 Actor & Roles
**System-to-system** (Python Camera Service), KHÔNG user JWT. Auth = device callback token (deviceCode + callbackToken) như face callbacks.

### 2.2 Entity liên quan
`iot_device_events`(raw), `room_events`(occupancy), `presence_snapshots`(khi có meeting), `room_booking_usages`(khi có booking), `rooms`(current_status). KHÔNG bảng/cột mới.

---

## 3. Endpoint (chốt path ở [NC-1])

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | **`POST /api/v1/room-camera/occupancy-snapshots`** (CLAUDE §22.7b — D-1) |
| Auth | Device callback: `deviceCode` + `callbackToken` (header `X-Callback-Token`/body/query/path), KHÔNG JWT — [NC-3] |
| HTTP | **202** `{ "accepted": true }` |
| Body | `{ deviceCode, roomId, meetingId?, eventType, occupancyCount, confidence?, eventTime?, metadata? }` (raw nhận tại boundary) |

---

## 4. Flow (đã chốt)

```text
POST /api/v1/room-camera/occupancy-snapshots
1. AUTH (TRƯỚC RAW): resolve device theo deviceCode (404 DEVICE_NOT_FOUND); validate callbackToken
   (sha256 vs device.metadata_json.camera_service_config.callback_token_hash → 401 INVALID_CALLBACK_TOKEN);
   device.status != 'disabled' (chỉ chặn disabled → 403 DEVICE_INACTIVE; offline/maintenance vẫn nhận vì occupancy là bằng chứng device sống);
   device.room_id == body.roomId (403 DEVICE_ROOM_MISMATCH / 404 ROOM_NOT_FOUND).
   ⚠️ SAI AUTH → KHÔNG lưu raw (khác face raw-first; chốt #29 để chống spam nguồn lạ).
2. RAW (SAU AUTH): INSERT iot_device_events { device_id, room_id, meeting_id?, event_type,
   payload_json=maskSensitiveMetadata(body) (SEC-01: token→'***'), event_time } — trước business; lỗi business sau đó KHÔNG mất raw.
3. NORMALIZE: validate occupancyCount (integer >= 0, <= ngưỡng hợp lý) → 400 INVALID_OCCUPANCY_PAYLOAD (raw đã lưu);
   eventTime (parse, lệch xa server → dùng now, CLAUDE §11.9).
4. room_events (LUÔN): INSERT { room_id, meeting_id?(nullable), event_type:'occupancy_detected', event_time,
   occupancy_count, confidence_score, source_type:'camera', new_status (nếu đổi) }.
5. Resolve meeting/booking active của room tại eventTime:
   - CÓ meeting active → INSERT presence_snapshots { meeting_id, room_id, occupancy_count,
     presence_status:'present', snapshot_time=eventTime, source_type:'camera', confidence_score }.
   - CÓ booking_usage active → UPDATE room_booking_usages: first_presence_at (nếu NULL), last_presence_at=eventTime,
     usage_status→'in_use' (nếu đang not_started & count>0), occupancy_source:'camera'.
   - KHÔNG meeting/booking → bỏ qua presence_snapshots/usage (chỉ room_events) — KHÔNG lỗi.
6. STATUS: nếu occupancyCount > 0 → UPDATE rooms.current_status='occupied' (nếu đang khác). count==0 → KHÔNG đổi (để #30) — [NC-4].
7. WS (tùy [NC-2]): nếu phát → emit room.occupancy.updated { roomId, occupancyCount, timestamp }.
8. Trả 202 { accepted: true }.
```

- Bước 2 (raw) độc lập; bước 4-6 nên trong transaction (nhiều bảng).

---

## 5. Functional Requirements (EARS)

```text
FR-OCC-001-001: THE system SHALL cung cấp endpoint ingest occupancy (system-to-system) nhận body {deviceCode, roomId, meetingId?, eventType, occupancyCount, confidence?, eventTime?, metadata?}.
FR-OCC-001-002: THE system SHALL xác thực bằng deviceCode + callbackToken (KHÔNG JWT user); IF token sai → 401; device không tồn tại → 404; device.status=='disabled' → 403 (offline/maintenance vẫn nhận); device.room_id != roomId → 403.
FR-OCC-001-003: THE system SHALL lưu raw payload (đã redact token bằng maskSensitiveMetadata) vào iot_device_events SAU khi auth thành công và TRƯỚC business; auth thất bại → KHÔNG lưu raw.
FR-OCC-001-004: THE system SHALL validate occupancyCount là integer >= 0 (chặn số vô lý/âm); IF không hợp lệ → 400/422 (sau khi đã lưu raw).
FR-OCC-001-005: THE system SHALL LUÔN ghi room_events (occupancy_count, confidence, event_time, meeting_id nullable, source_type='camera').
FR-OCC-001-006: WHEN có meeting active của room tại eventTime, THE system SHALL insert presence_snapshots (present, occupancy_count, meeting_id, snapshot_time, source camera).
FR-OCC-001-007: WHEN có booking_usage active, THE system SHALL update room_booking_usages: first_presence_at (nếu NULL), last_presence_at, usage_status→in_use (nếu phù hợp), occupancy_source=camera.
FR-OCC-001-008: WHEN KHÔNG có meeting/booking active, THE system SHALL chỉ ghi room_events (KHÔNG presence_snapshots/usage) và KHÔNG lỗi.
FR-OCC-001-009: WHEN occupancyCount > 0, THE system SHALL set rooms.current_status='occupied'. WHEN count==0, KHÔNG đổi status (để #30) — [NC-4].
FR-OCC-001-010: THE system SHALL trả 202 { accepted: true }.
FR-OCC-001-011 ([NC-2]): WHEN bật WS, THE system SHALL emit room.occupancy.updated { roomId, occupancyCount, timestamp }.
```

## 6. Non-functional (EARS)

```text
NFR-OCC-001-001 (Auth-then-raw): Auth thành công → lưu iot_device_events TRƯỚC business; lỗi business KHÔNG làm mất raw. Auth thất bại → KHÔNG lưu raw (chống spam nguồn lạ).
NFR-OCC-001-002 (SEC device auth): SHALL validate device + room khớp + token; KHÔNG cho nguồn lạ POST số đếm. KHÔNG JWT user.
NFR-OCC-001-003 (SEC no-leak): SHALL NOT log token/secret/hash; message lỗi KHÔNG lộ secret.
NFR-OCC-001-004 (Input validation): occupancyCount integer >=0 + chặn ngưỡng vô lý; eventTime parse an toàn (lệch xa → now).
NFR-OCC-001-005 (Atomicity): Bước room_events + presence/usage + status SHALL trong 1 transaction; rollback nếu lỗi (raw đã lưu riêng trước đó).
NFR-OCC-001-006 (Persistence/DATA-01): Dùng bảng có sẵn; KHÔNG migration/cột mới. current_headcount suy từ occupancy_count mới nhất.
NFR-OCC-001-007 (Idempotent-ish): event trùng (cùng device+time) tạo thêm room_events là chấp nhận (event log); KHÔNG cần dedup ở #29.
```

## 7. Acceptance Criteria

```text
AC-OCC-001-001 (có meeting): Given device hợp lệ thuộc room, room đang có meeting active, count=5; When POST; Then 202, iot_device_events+room_events+presence_snapshots tạo, room_booking_usages.last_presence_at set, rooms.current_status='occupied'.
AC-OCC-001-002 (không meeting): Given room KHÔNG có meeting/booking active, count=3; When POST; Then 202, iot_device_events+room_events tạo, KHÔNG presence_snapshots/usage, rooms.current_status='occupied'.
AC-OCC-001-003 (count=0): Given count=0; When POST; Then 202, room_events tạo (count 0), KHÔNG set occupied (status giữ nguyên — [NC-4]).
AC-OCC-001-004 (count>0 first presence): Given booking_usage chưa có first_presence_at, count>0; When POST; Then first_presence_at set + usage_status='in_use'.
AC-OCC-001-005 (device sai): Given token sai → 401; deviceCode không tồn tại → 404; device.room_id != roomId → 403/404. **Auth thất bại → KHÔNG lưu raw** (D-5).
AC-OCC-001-006 (count vô lý): Given occupancyCount âm/không phải số; When POST (auth ok); Then 400 INVALID_OCCUPANCY_PAYLOAD sau khi lưu raw.
AC-OCC-001-007 (raw sau auth): Given auth ok nhưng bước presence lỗi DB; Then iot_device_events vẫn có raw; trả lỗi nhưng event không mất.
AC-OCC-001-008 (SEC): token/secret KHÔNG xuất hiện trong log/response.
```

## 8. Edge / Error Cases

```text
EC-OCC-001-001: meetingId trong body nhưng meeting đã end/không active → coi như KHÔNG meeting (chỉ room_events) hoặc dùng meeting theo body? (đề xuất: resolve active theo room+eventTime, KHÔNG tin meetingId body mù quáng).
EC-OCC-001-002: presence_snapshots.meeting_id NN → KHÔNG insert khi không có meeting (dùng room_events).
EC-OCC-001-003: eventTime thiếu/sai → dùng now().
EC-OCC-001-004: roomId không tồn tại → 404 (sau khi lưu raw nếu device ok).
EC-OCC-001-005: nhiều booking overlap (hiếm) → chọn booking active đầu tiên theo thời gian.
EC-OCC-001-006: occupancyCount > capacity → vẫn ghi (cảnh báo over-capacity ngoài scope #29).
```

### 8.1 Error Code Map
| HTTP | Code |
|---|---|
| 202 | (accepted) |
| 400/422 | INVALID_OCCUPANCY_PAYLOAD |
| 401 | INVALID_CALLBACK_TOKEN |
| 403 | DEVICE_ROOM_MISMATCH |
| 404 | DEVICE_NOT_FOUND / ROOM_NOT_FOUND |

---

## 9. Traceability
| Req | Nguồn |
|---|---|
| FR-001..002 | UC-75; CLAUDE §11.4/11.9 device callback |
| FR-003 | CLAUDE §11.4 raw-first; iot_device_events |
| FR-005..008 | UC-75 side-effects; room_events/presence_snapshots/room_booking_usages |
| FR-009 | UC-36/38 occupied; rooms.current_status |
| FR-011 | WS room.occupancy.updated (5318) |

---

## 10. RECON xác nhận (theo yêu cầu)

- **PATH**: Face Server callbacks trong repo = `/api/v1/device-callbacks/face/*` ([device-callbacks.controller.ts:5]) + short `/api/v1/hb/:deviceCode/:callbackToken` ([short-device-callbacks.controller.ts]). Contract UC-75 = `/api/v1/internal/camera-service/occupancy-events`. CLAUDE §22.7b = `/api/v1/room-camera/*`. ⇒ **3 lựa chọn**, chốt ở [NC-1]. Đề xuất: theo **contract** (`/internal/camera-service/occupancy-events`) cho đúng API đã ký, + hỗ trợ token qua header/body như face.
- **AUTH chi tiết**: validate token nhúng trong `IotDevicesService.receiveHeartbeat`/`receiveVerifyEvent` ([:1002,:1157]) — extract `X-Callback-Token`/body/query/path → sha256 vs `device.metadataJson.face_server_config.callback_token_hash` ([:1041]). **KHÔNG có hàm validate độc lập**; token là **hash** trong `metadata_json`. Camera service **chưa có** config token → cần thêm `camera_service_config.callback_token_hash` (mirror face) hoặc env shared-secret — [NC-3].
- **WS**: **CÓ** `EventsGateway` ([events.gateway.ts:24]) + `WebsocketService.emitToRoom/broadcast` ([websocket.service.ts:27,50]). ⇒ #29 **có thể** phát `room.occupancy.updated`. Chốt phát ngay hay defer #40 ở [NC-2].
- **iot_device_events ghi raw**: đề xuất presence module **register `IotDeviceEventEntity` vào `forFeature`** (+ RoomEvent/PresenceSnapshot/RoomBookingUsage/Room) và insert qua repo — tránh phụ thuộc nặng IotModule. Token validate: hoặc import `IotModule`+`IotDevicesService` (nếu thêm hàm validate camera), hoặc presence tự resolve device + so hash (mirror). Chốt ở [NC-3].

---

## 11. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| **D-1** (NC-1) | Path = **`POST /api/v1/room-camera/occupancy-snapshots`** (CLAUDE §22.7b định path room-camera cụ thể → ưu tiên hơn contract `/internal/camera-service/...`). Nhận token qua header `X-Callback-Token`/body/query/path như face. |
| **D-2** (NC-2) | **Phát WS best-effort**: `room.occupancy.updated { roomId, occupancyCount, timestamp }` qua `WebsocketService` trong **try/catch riêng** — lỗi WS KHÔNG ảnh hưởng 202/DB. |
| **D-3** (NC-3) | Token = **`device.metadata_json.camera_service_config.callback_token_hash`** per-device (mirror `face_server_config`). Chưa có endpoint cấp token cho camera → **seed thủ công** hash cho device test (SQL/metadata update). |
| **D-4** (NC-4) | `occupancyCount > 0` → set `rooms.current_status='occupied'`. `count==0` → **KHÔNG** đổi status (available/empty để #30 + utilization). |
| **D-5** (ordering) | **AUTH TRƯỚC RAW** (khác face raw-first): auth thất bại → KHÔNG lưu iot_device_events (chống spam nguồn lạ). Raw lưu ngay sau auth, trước business. |

---

> Trạng thái: **D-1..5 đã chốt**. plan.md + tasks.md + implement (module presence) tiếp theo.
