---
name: feat-no-show-cases
description: No-show case create (internal) + update + detection cron. UC-41/42. Module rooms. Warn/release/threshold-config defer #32/#33/#35.
category: rooms
---

# Feature Specification: No-show Case Create + Update (No-show Detection)

- **Feature ID**: NSC-001 (UC-41 + UC-42 · phase #31)
- **Feature Name**: Tạo & cập nhật trường hợp no-show + detection cron
- **Module / Domain**: rooms (+ scheduler wiring)
- **Created Date**: 2026-06-17
- **Status**: Draft (RECON xong, quyết định đã LOCK)
- **Source Documents**:
  - `spec/global/constitution.md` (SEC-01 secret; SEC-02 auth; SEC-03 parameterize; DATA-01 no migration; ARCH-01 boundary)
  - `CLAUDE.md` / `AGENTS.md` (§17 audit; §19 background jobs; conventional commits)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` (UC-41 — 1684-1722; UC-42 — 1726-1744; WS meeting.noshow.alert; perm room.noshow.update — 5238)
  - `src/modules/rooms/entities/no-show-case.entity.ts`, `room-booking.entity.ts`, `room-booking-usage.entity.ts`
  - `src/modules/scheduler/scheduler.service.ts` (checkNoShow cron skeleton)
  - `src/modules/administration/entities/system-config.entity.ts`, `src/modules/websocket/websocket.service.ts`

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo spec NSC-001 (UC-41/42): POST /internal/no-show-cases (token-gated, idempotent) + PATCH /no-show-cases/:id (JWT perm) + NoShowDetectionService.detect() wire cron checkNoShow (gated OFF). LOCK NC-1..6 + 5 review points. Warn/release/threshold-config defer #32/#33/#35. No migration. | Toàn bộ file (bản đầu tiên) |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
#29/#30 đã có occupancy + room-status. Khi phòng được đặt nhưng **không ai vào sau ngưỡng** (no-show), hệ thống cần **phát hiện + tạo no_show_cases** để (sau) cảnh báo (#32) và tự giải phóng (#33). #31 hiện thực **lõi**: tạo case (internal, gọi bởi cron/camera-service) + cập nhật case (review thủ công) + detection scan (cron, gated OFF).

### 1.2 Mục tiêu
- `POST /api/v1/internal/no-show-cases` (UC-41) — internal token-gated, **idempotent** per-booking.
- `PATCH /api/v1/no-show-cases/:id` (UC-42) — JWT + perm, transition hợp lệ.
- `NoShowDetectionService.detect()` — quét booking quá ngưỡng chưa có presence → tạo case; wire vào `@Cron checkNoShow()` có sẵn (gated `SCHEDULER_NO_SHOW_CHECK_ENABLED`, **default OFF**).
- Emit `meeting.noshow.alert` best-effort khi create.

### 1.3 Giá trị mang lại
- Có dữ liệu no_show_cases nền cho cảnh báo/giải phóng/analytics; tự động phát hiện no-show.

### 1.4 Out-of-scope (defer)
- **UC-43 warn** (`/internal/no-show-cases/:id/warn`) = **#32** (set `warning_sent_at`, notification).
- **UC-44/45 release** (auto/manual) = **#33** (set `released_at`, room available).
- **UC-47/48 threshold config admin** = **#35** (#31 đọc system_configs best-effort, default 15).
- Đổi schema/migration (DATA-01) — dùng `no_show_cases` entity as-is.

---

## 2. UC summaries

| UC | Scope (≤15 từ) | Actor | Method+Path | Perm |
|---|---|---|---|---|
| **UC-41** [API_CONTRACT:1684](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md) | Tạo no-show case (gọi bởi scheduler/camera) | **Internal** | `POST /api/v1/internal/no-show-cases` | `internal.system.noshow` (token) |
| **UC-42** [API_CONTRACT:1726](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md) | Cập nhật no-show case (review thủ công) | **User** | `PATCH /api/v1/no-show-cases/:id` | `room.noshow.update` |

---

## 3. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| no_show_cases | [no-show-case.entity.ts](../../../../src/modules/rooms/entities/no-show-case.entity.ts): `booking_id`(NN,:34), `meeting_id`(NN), `room_id`(NN), `detection_status`(enum default `risk`,:43), `detected_at`(default now), `warning_sent_at`?, `warning_deadline_at`?, `auto_release_eligible_at`?, `released_at`?, `resolved_by`?, `resolution_status`?(enum), `note`?, `evidence_json`?(jsonb). **KHÔNG có UNIQUE booking_id** → idempotency app-level. |
| detection_status enum | [:13] `risk, confirmed, warning_sent, released, dismissed, resolved`. |
| resolution_status enum | [:22] `released, kept, false_positive, manual_override`. |
| room_bookings | [room-booking.entity.ts](../../../../src/modules/rooms/entities/room-booking.entity.ts): `reserved_start_time`, `status` (active = `approved/active`). |
| room_booking_usages | [room-booking-usage.entity.ts](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts): `booking_id`, `first_presence_at`?, `usage_status`(not_started/in_use/no_show/early_empty). ⇒ no-presence = first_presence_at IS NULL. |
| scheduler cron | [scheduler.service.ts:62-68](../../../../src/modules/scheduler/scheduler.service.ts): `@Cron(EVERY_5_MINUTES,{name:'no-show-check'}) checkNoShow()` skeleton, gated `SCHEDULER_NO_SHOW_CHECK_ENABLED` (default **false**). ⇒ wire detect() vào đây. |
| system_configs | [system-config.entity.ts:24-28](../../../../src/modules/administration/entities/system-config.entity.ts): `config_key`(varchar), `config_value`(text?). ⇒ threshold key `no_show.threshold_minutes` đọc best-effort (#35 quản admin). |
| WS | [websocket.service.ts:27](../../../../src/modules/websocket/websocket.service.ts) `emitToRoom`. Contract WS: `meeting.noshow.alert {meetingId, roomId, noShowCaseId, timestamp}` "khi phát hiện no-show". |
| rooms module | [rooms.module.ts](../../../../src/modules/rooms/rooms.module.ts): forFeature [Room, RoomBooking, RoomBookingUsage, NoShowCase, RoomEvent] + Auth/Jwt/Cache (#30). ⇒ thêm NoShowController/Service/DetectionService. |

---

## 4. Endpoints

> Envelope: manual `{success, message, data}` (không global interceptor — như #30). Service trả raw.

### 4.1 UC-41 — `POST /api/v1/internal/no-show-cases`  (Internal)
| Field | Value |
|---|---|
| Auth | **Internal token** (env shared-secret qua header `X-Internal-Token`); **constant-time compare**, **fail-closed**; SEC-01 KHÔNG log/lưu token |
| Permission | `internal.system.noshow` (đại diện bằng token; KHÔNG JWT user) |
| Body | `{ bookingId(uuid), meetingId(uuid), roomId(uuid), detectionStatus?(risk\|confirmed, default risk), evidenceJson?(object) }` |
| 400 | `detectionStatus` ngoài {risk,confirmed} → `INVALID_DETECTION_STATUS` (NC-6) |
| 401/403 | token thiếu/sai → 401 (fail-closed) |
| HTTP | **201** khi insert mới; **200** khi case đã tồn tại cho booking (idempotent — NC-4) |

**Response 201/200:**
```json
{
  "success": true,
  "message": "No-show case created",
  "data": {
    "noShowCaseId": "uuid",
    "bookingId": "uuid",
    "detectionStatus": "risk",
    "detectedAt": "2026-06-17T09:12:00+07:00"
  }
}
```

### 4.2 UC-42 — `PATCH /api/v1/no-show-cases/:id`  (User)
| Field | Value |
|---|---|
| Auth | `JwtAuthGuard` + `MockPermissionsGuard` |
| Permission | `room.noshow.update` |
| Param | `id` uuid (ParseUUIDPipe) |
| Body | `{ detectionStatus?(confirmed\|dismissed\|resolved), resolutionStatus?(kept\|false_positive\|manual_override), note? }` |
| 400 | `detectionStatus` ∈ {warning_sent, released} → `INVALID_NO_SHOW_TRANSITION` (system/#32/#33 owns); enum sai → `INVALID_DETECTION_STATUS` |
| 404 | case không tồn tại → `NO_SHOW_CASE_NOT_FOUND` |
| HTTP | 200 full no-show case object |

**Response 200:** full `no_show_cases` row (id, bookingId, meetingId, roomId, detectionStatus, detectedAt, resolutionStatus, note, evidenceJson, …) + `resolved_by` = current user (nếu resolution set).

---

## 5. NoShowService.create(input) — dùng chung cron + HTTP

```text
create({bookingId, meetingId, roomId, detectionStatus='risk', evidenceJson?}):
1. Atomic dedup (NC-4 per-booking-ever) — 1 câu INSERT có điều kiện:
   INSERT INTO no_show_cases (booking_id, meeting_id, room_id, detection_status, evidence_json, detected_at)
   SELECT $1,$2,$3,$4,$5, now()
   WHERE NOT EXISTS (SELECT 1 FROM no_show_cases WHERE booking_id = $1)
   RETURNING id, booking_id, detection_status, detected_at;
   (SEC-03 parameterized.)
2. Nếu RETURNING có row → created (HTTP 201). Nếu 0 row (đã tồn tại) → SELECT case hiện có theo booking_id → return (HTTP 200, idempotent).
3. evidence_json: chỉ {occupancyCount, threshold, detectedAt,…}; SEC-01 KHÔNG chứa token/secret.
4. WS best-effort (NC-5): emitToRoom(`room:${roomId}`,'meeting.noshow.alert',{meetingId,roomId,noShowCaseId,timestamp}); lỗi WS try/catch, KHÔNG fail create.
5. trả { case, created: boolean } để controller chọn 201/200.
```

---

## 6. NoShowDetectionService.detect()  (cron-driven, gated OFF)

```text
detect():
1. threshold = đọc MỘT LẦN (NC-2):
   SELECT config_value FROM system_configs WHERE config_key='no_show.threshold_minutes';
   parse int → nếu thiếu/sai → env NO_SHOW_THRESHOLD_MINUTES → default 15.
2. Candidate query (SEC-03, bind threshold; LEFT JOIN usage — review-point 1+2):
     SELECT b.id booking_id, b.meeting_id, b.room_id
     FROM room_bookings b
     LEFT JOIN room_booking_usages u ON u.booking_id = b.id
     WHERE b.status IN ('approved','active')
       AND b.reserved_start_time + ($1 * interval '1 minute') < now()
       AND (u.first_presence_at IS NULL)       -- absent usage row OR no presence
       AND NOT EXISTS (SELECT 1 FROM no_show_cases nc WHERE nc.booking_id = b.id);
   (LEFT JOIN giữ an toàn dù usage row chưa tồn tại.)
3. for each candidate (review-point 4 — isolation):
     try { await NoShowService.create({bookingId, meetingId, roomId,
            detectionStatus:'risk', evidenceJson:{threshold, detectedAt: now}}) }
     catch (e) { log(e) + continue }    // lỗi 1 booking KHÔNG dừng cả batch
4. log tổng số case tạo.
- Wire vào scheduler.service.checkNoShow(): if (enabled) await detectionService.detect(). Gate giữ default OFF.
```

---

## 7. State machine (in-scope vs defer)

```text
Enum: risk → confirmed → warning_sent → released | dismissed | resolved

#31 OWNS:
- create → detection_status ∈ {risk(default), confirmed}  (NC-6; camera có thể gửi confirmed).
- UC-42 update (user) → detection_status target ∈ {confirmed, dismissed, resolved}
  + resolution_status ∈ {kept, false_positive, manual_override} + note; set resolved_by=user.

#31 REJECTS (→ 400 INVALID_NO_SHOW_TRANSITION):
- update set detection_status ∈ {warning_sent, released} (do #32 /warn, #33 /release ghi).
```

---

## 8. Functional Requirements (EARS)

```text
FR-NSC-001-001: THE system SHALL cung cấp POST /api/v1/internal/no-show-cases (internal token-gated) tạo no-show case.
FR-NSC-001-002: THE create SHALL idempotent per-booking — atomic INSERT ... WHERE NOT EXISTS (booking_id); nếu đã tồn tại → trả case cũ (HTTP 200), insert mới → 201.
FR-NSC-001-003: IF detectionStatus (create) ∉ {risk, confirmed}, THEN 400 INVALID_DETECTION_STATUS; default risk.
FR-NSC-001-004: IF internal token thiếu/sai, THEN 401 (constant-time compare, fail-closed); token SHALL NOT bị log/lưu (SEC-01).
FR-NSC-001-005: THE system SHALL cung cấp PATCH /api/v1/no-show-cases/:id (JWT + room.noshow.update) cập nhật case.
FR-NSC-001-006: WHEN update detection_status ∈ {warning_sent, released}, THEN 400 INVALID_NO_SHOW_TRANSITION (defer #32/#33); cho phép {confirmed, dismissed, resolved}.
FR-NSC-001-007: IF case :id không tồn tại, THEN 404 NO_SHOW_CASE_NOT_FOUND.
FR-NSC-001-008: WHEN create thành công, THE system SHALL emit meeting.noshow.alert best-effort; lỗi WS KHÔNG fail create.
FR-NSC-001-009: THE NoShowDetectionService.detect() SHALL đọc threshold (system_configs → env → default 15) và quét candidate (status active, reserved_start+threshold<now, first_presence_at NULL, chưa có case) → create từng cái, lỗi 1 booking KHÔNG dừng batch.
FR-NSC-001-010: detect() SHALL wire vào @Cron checkNoShow(); gate SCHEDULER_NO_SHOW_CHECK_ENABLED default OFF.
FR-NSC-001-011: Mọi query SHALL parameterized (SEC-03), gồm threshold bind.
```

## 9. Non-functional (Constitution)

```text
NFR-NSC-001-001 (SEC-01): Internal token từ env, constant-time compare, fail-closed; KHÔNG log/lưu token; evidence_json KHÔNG chứa secret.
NFR-NSC-001-002 (SEC-02): UC-42 JWT + room.noshow.update; UC-41 token-gated (documented public-ish internal).
NFR-NSC-001-003 (SEC-03): Tất cả SQL parameterized (bind threshold, booking_id, …).
NFR-NSC-001-004 (DATA-01): Dùng no_show_cases entity as-is; KHÔNG migration/cột mới.
NFR-NSC-001-005 (ARCH-01): no-show thuộc domain rooms; NoShowController/Service/DetectionService trong module rooms; cron wire qua scheduler import.
NFR-NSC-001-006 (Robustness): detect() isolation per-booking; create idempotent; WS best-effort.
NFR-NSC-001-007 (Idempotency): atomic insert-where-not-exists chống tạo trùng dù gọi đồng thời (cron + camera).
```

## 10. Acceptance Criteria

```text
AC-NSC-001-001 (create insert): Given booking chưa có case + token hợp lệ; When POST internal; Then 201, case tạo (detection_status=risk), evidence_json lưu.
AC-NSC-001-002 (create idempotent): Given booking ĐÃ có case; When POST internal lần 2; Then 200 + case cũ (KHÔNG tạo mới).
AC-NSC-001-003 (detectionStatus restrict): Given detectionStatus='dismissed' (create); Then 400 INVALID_DETECTION_STATUS.
AC-NSC-001-004 (token reject): Given token thiếu/sai; Then 401 (fail-closed); KHÔNG insert; token KHÔNG log.
AC-NSC-001-005 (update valid): Given case tồn tại; When PATCH {detectionStatus:'dismissed', resolutionStatus:'false_positive', note}; Then 200, cập nhật + resolved_by=user.
AC-NSC-001-006 (update illegal transition): Given PATCH {detectionStatus:'released'}; Then 400 INVALID_NO_SHOW_TRANSITION.
AC-NSC-001-007 (update 404): Given id không tồn tại; Then 404 NO_SHOW_CASE_NOT_FOUND.
AC-NSC-001-008 (detect candidates): Given booking active quá threshold, first_presence_at NULL, chưa có case; When detect(); Then create được gọi cho booking đó.
AC-NSC-001-009 (detect skip existing): Given booking đã có case; When detect(); Then KHÔNG create lại (NOT EXISTS lọc / idempotent).
AC-NSC-001-010 (threshold): Given system_configs có no_show.threshold_minutes=10; Then detect dùng 10. Given thiếu; Then default 15 (hoặc env).
AC-NSC-001-011 (detect isolation): Given create 1 booking ném lỗi; When detect(); Then booking khác vẫn xử lý (try/catch continue).
AC-NSC-001-012 (WS best-effort): Given WS emit lỗi; When create; Then vẫn 201/200 (create không fail).
AC-NSC-001-013 (cron gate): Given SCHEDULER_NO_SHOW_CHECK_ENABLED=false; When cron tick; Then detect() KHÔNG chạy.
```

## 11. Error Code Map
| HTTP | Code |
|---|---|
| 200 | (idempotent existing / update ok) |
| 201 | (created) |
| 400 | INVALID_DETECTION_STATUS / INVALID_NO_SHOW_TRANSITION / VALIDATION_ERROR |
| 401 | UNAUTHORIZED (internal token thiếu/sai) |
| 403 | FORBIDDEN (user thiếu room.noshow.update) |
| 404 | NO_SHOW_CASE_NOT_FOUND |

---

## 12. Locked decisions (NC + review points baked)
| # | Quyết định |
|---|---|
| **NC-1** | #31 = CRUD (UC-41 create + UC-42 update) + NoShowDetectionService.detect() wire cron `checkNoShow()` (gated OFF). |
| **NC-2** | Threshold: system_configs[no_show.threshold_minutes] → env NO_SHOW_THRESHOLD_MINUTES → default 15. #35 admin config. |
| **NC-3** | UC-41 internal auth: env shared-secret token header `X-Internal-Token`, constant-time, fail-closed; cron gọi service trực tiếp (không HTTP). |
| **NC-4** | Idempotency: atomic INSERT ... WHERE NOT EXISTS(booking_id) per-booking-ever; tồn tại → trả case cũ. |
| **NC-5** | WS `meeting.noshow.alert` emit ở **create (#31)** best-effort. |
| **NC-6** | create detectionStatus ∈ {risk(default), confirmed}; khác → 400. |
| **RP-1/2** | Candidate query LEFT JOIN room_booking_usages (an toàn dù usage row chưa có); first_presence_at NULL. |
| **RP-3** | Threshold bind param (SEC-03), đọc 1 lần/đợt detect. |
| **RP-4** | detect() per-booking try/catch isolation. |
| **RP-5** | create idempotent + WS best-effort không fail. |

---

## 13. Test Plan (Jest — MOCK dataSource + scheduler; KHÔNG chạy cron thật)

```text
no-show.service.spec (mock dataSource.manager.query):
- create insert → RETURNING row → created=true (201).
- create existing → RETURNING [] → SELECT case cũ → created=false (200, idempotent).
- create detectionStatus 'dismissed' → 400 INVALID_DETECTION_STATUS.
- create WS lỗi → vẫn trả case (best-effort).
- update valid {dismissed/false_positive} → UPDATE + resolved_by.
- update illegal {released} → 400 INVALID_NO_SHOW_TRANSITION.
- update 404 → NO_SHOW_CASE_NOT_FOUND.

no-show-detection.service.spec (mock dataSource + NoShowService):
- threshold: system_configs trả '10' → dùng 10; thiếu → default 15.
- candidate query → create gọi cho mỗi booking; query chứa bind threshold + NOT EXISTS.
- skip existing: NOT EXISTS lọc (query) — assert SQL.
- isolation: create ném lỗi booking 1 → booking 2 vẫn create (try/catch).

no-show.controller.spec (mock service):
- internal create: token hợp lệ → 201/200; token sai → 401 (fail-closed); token KHÔNG log.
- update: passthrough 200; 404 propagate.

scheduler wiring: checkNoShow gate OFF → detect() KHÔNG gọi; ON → gọi (mock detectionService).
```

---

> Trạng thái: **CHỜ REVIEW spec** (NC-1..6 + RP-1..5 LOCKED; warn/release/threshold-config defer). Chưa plan/tasks/code.
