# SPEC — MEET-ROOM-FAULT-WARN-001: Cảnh báo đặt phòng có thiết bị hỏng

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-08-14 | Tạo mới spec.md cho MEET-ROOM-FAULT-WARN-001. Trạng thái [Missing]. | Toàn bộ file |

> Phạm vi: khi tạo meeting (kèm room booking) qua `POST /api/v1/meetings`, nếu phòng đang có thiết bị `healthStatus ∈ {faulty,offline}`, hệ thống cảnh báo và yêu cầu người dùng xác nhận tiếp tục — theo đúng pattern "override flag" đã có sẵn cho `CAPACITY_EXCEEDED`.
> KHÔNG bao gồm: notify sysadmin / confirm / resolve thiết bị (`spec/features/equipment/feat-equipment-fault-lifecycle/`), badge hiển thị khi tìm phòng (`spec/features/rooms/feat-room-search-equipment-badge/`).
> Tài liệu này chỉ là đặc tả (spec). KHÔNG kèm code.

---

## 0. Khảo sát hiện trạng (bắt buộc đọc trước)

### 0.1. Không có endpoint "tạo booking" riêng
Bảng `room_bookings` không có API tạo riêng — booking được tạo **bên trong** `MeetingsService.create()` (`services/meetings.service.ts:680-1041`), cùng transaction với `MeetingEntity`/`MeetingRequestEntity`. Đây là nơi duy nhất cần chèn logic cảnh báo.

### 0.2. Pattern "warning + override flag" đã có sẵn (CAPACITY_EXCEEDED)
`meetings.service.ts:778-795`:
```ts
const totalParticipants = uniqueParticipantIds.length + (dto.externalParticipants?.length || 0);
const capacityOverride = dto.capacityOverrideConfirmed === true;
if (totalParticipants > room.capacity && !capacityOverride) {
  throw new UnprocessableEntityException({
    success: false, message: 'Số lượng người tham dự vượt quá sức chứa của phòng',
    error: { code: 'CAPACITY_EXCEEDED', details: { roomCapacity: room.capacity, totalParticipants, capacityOverrideConfirmed: false } },
  });
}
```
`dto.capacityOverrideConfirmed` khai ở `create-meeting.dto.ts:75-77` (`@IsBoolean @IsOptional`). Cùng pattern lặp lại cho `PARTICIPANT_TIME_CONFLICT_WARNING` (`updateMeetingTime()`, dòng 1350-1383) với `details.blocking:false, requiresConfirmation:true` — đúng ngữ nghĩa "cảnh báo mềm, cho tiếp tục nếu xác nhận", khác `ROOM_CONFLICT` (`blocking:true`, không override được).

→ Feature này **tái dùng nguyên xi pattern trên**, không phát minh cơ chế mới.

### 0.3. Vị trí chèn — giữa `roomConflict` và capacity check
Trong `create()`: check `room` tồn tại (dòng 705-715) → check host/participants (717-759) → **check `roomConflict`** (761-776, chặn cứng, không override) → *[VỊ TRÍ CHÈN LOGIC MỚI]* → check capacity (778-795, override được) → tạo transaction (798+). Chèn ngay sau `roomConflict`, trước capacity — thứ tự không quan trọng về nghiệp vụ (độc lập), nhưng giữ cạnh capacity check vì cùng nhóm "soft warning".

### 0.4. `EquipmentEntity` chưa được `MeetingsModule` biết tới
`meetings.module.ts` hiện `TypeOrmModule.forFeature([...])` có `RoomEntity, RoomBookingEntity, ...` nhưng **không có** `EquipmentEntity`. Comment trong chính module (dòng 46-47) đã ghi rõ nguyên tắc: dùng `TypeOrmModule.forFeature` cho entity thay vì import cả module gốc, để tránh circular (`MeetingsModule → EquipmentModule → RoomsModule → MeetingsModule` — vòng lặp thật nếu import `EquipmentModule`).

---

## 1. Tổng quan Feature

| Thuộc tính | Giá trị |
| :--- | :--- |
| **Feature ID** | MEET-ROOM-FAULT-WARN-001 |
| **Module** | Meetings (`src/modules/meetings`), đọc `EquipmentEntity` (module `equipment`) qua `TypeOrmModule.forFeature` |
| **Primary Actor** | Người tạo meeting (mọi role có quyền `meeting.create`) |
| **Trigger** | Gọi `POST /api/v1/meetings` cho phòng đang có thiết bị `faulty`/`offline` |
| **Expected Output** | Lần gọi đầu (chưa xác nhận) → `422 ROOM_HAS_FAULTY_EQUIPMENT`, `details.blocking=false, requiresConfirmation=true`, kèm danh sách thiết bị hỏng. Gọi lại với `equipmentWarningConfirmed:true` → tạo meeting bình thường. |
| **Pre-condition** | Phòng tồn tại (đã pass check `room` §0.3), có ít nhất 1 `EquipmentEntity.currentRoomId = room.id AND healthStatus IN (faulty, offline)`. |
| **Related** | `feat-equipment-fault-lifecycle` (nguồn dữ liệu `healthStatus`), UC gốc tạo meeting (`meetings.service.ts:create`, KHÔNG có feat riêng trong `/spec/features` — đọc trực tiếp code). |

---

## 2. Actor & Pre-condition

- Actor: bất kỳ user nào có quyền tạo meeting (không cần permission riêng cho cảnh báo này — cùng quyền `meeting.create` đã check ở luồng hiện tại).
- Pre-condition: request đã pass validate thời gian, room tồn tại/active, host/participants hợp lệ, KHÔNG conflict booking (`ROOM_CONFLICT` — chặn cứng, xảy ra trước, không liên quan feature này).

---

## 3. Endpoint

Không có endpoint mới. **SỬA** `POST /api/v1/meetings` (đã có) — chỉ thêm 1 field input tùy chọn + 1 nhánh kiểm tra trong service.

---

## 4. Input DTO — thêm field vào `CreateMeetingDto`

| Field | Kiểu | Bắt buộc | Ghi chú |
| :--- | :--- | :--- | :--- |
| `equipmentWarningConfirmed?` | boolean | Không | `@IsBoolean @IsOptional` — mirror chính xác `capacityOverrideConfirmed` (dòng 75-77). Client gửi `true` ở lần gọi thứ 2 sau khi đã hiển thị cảnh báo cho user. |

---

## 5. Main Flow

1. Client gọi `POST /api/v1/meetings` với `roomId`, không có `equipmentWarningConfirmed` (hoặc `false`).
2. Service pass qua các check hiện có (thời gian, room tồn tại, host/participants, `roomConflict`).
3. **[MỚI]** Query `EquipmentEntity` theo `currentRoomId = dto.roomId AND healthStatus IN (FAULTY, OFFLINE)`.
4. Nếu có ≥1 kết quả và `dto.equipmentWarningConfirmed !== true` → throw `422 ROOM_HAS_FAULTY_EQUIPMENT` kèm danh sách thiết bị (id, tên, loại, healthStatus, issueNote).
5. Client hiển thị dialog xác nhận cho user ("Phòng này có thiết bị hỏng, tiếp tục đặt?").
6. User xác nhận → client gọi lại `POST /api/v1/meetings` với `equipmentWarningConfirmed:true`.
7. Bước 3 vẫn chạy (vẫn query lại — không cache), nhưng bước 4 bỏ qua vì đã confirm → tiếp tục capacity check → tạo meeting bình thường.

---

## 6. Ngữ nghĩa & ràng buộc

### 6.1. Chỉ `faulty`/`offline` — KHÔNG `warning`
Chốt với PO (đã duyệt qua EnterPlanMode): `warning` là mức nhẹ, chỉ hiển thị badge thông tin ở `feat-room-search-equipment-badge`, **không** chặn/yêu cầu xác nhận ở bước tạo meeting. Chỉ `faulty`/`offline` (thiết bị thực sự không dùng được) mới kích hoạt cảnh báo này.

### 6.2. Cảnh báo mềm — không phải `ROOM_CONFLICT`
`details.blocking=false, requiresConfirmation=true` — **khác** `ROOM_CONFLICT` (`blocking:true`, không override được). Người dùng vẫn có thể chọn tiếp tục đặt phòng dù có thiết bị hỏng (ví dụ họp không cần thiết bị đó).

### 6.3. Không cache/lưu trạng thái đã cảnh báo
Mỗi lần gọi `POST /meetings` đều query lại `EquipmentEntity` hiện tại (không dùng warning-token JWT như `WarningTokenUtil` — pattern đó dành cho luồng add-participant phức tạp hơn, không cần thiết ở đây vì chỉ 1 round-trip xác nhận đơn giản, đúng pattern `capacityOverrideConfirmed`).

---

## 7. Ràng buộc trạng thái

Không có state machine mới — chỉ đọc `healthStatus` hiện tại của `EquipmentEntity` tại thời điểm tạo meeting.

---

## 8. Permission / RBAC

Không có permission mới — dùng đúng quyền `meeting.create` hiện có của endpoint `POST /meetings`.

---

## 9. Audit logging

Không ghi audit riêng cho việc "đã cảnh báo" — audit tạo meeting hiện có (nếu có) không đổi. Việc user xác nhận `equipmentWarningConfirmed:true` được lưu gián tiếp trong chính request/response log tầng HTTP nếu dự án có, không thuộc phạm vi feature này.

---

## 10. Ranh giới feature

| Việc | Thuộc feature nào | Feature này làm? |
| :--- | :--- | :--- |
| Cảnh báo `faulty/offline` khi tạo meeting | **MEET-ROOM-FAULT-WARN-001** | ✅ |
| Set `healthStatus` thiết bị | `feat-equipment-fault-lifecycle` | ❌ (chỉ đọc) |
| Badge thiết bị khi tìm phòng (trước khi bấm đặt) | `feat-room-search-equipment-badge` | ❌ |
| Cập nhật `RoomEntity.currentStatus` theo tình trạng thiết bị | Ngoài phạm vi — chốt KHÔNG tự đổi `currentStatus` (rủi ro side-effect với booking logic khác, xem §11 C2) | ❌ |

---

## 11. Điểm đã chốt

| # | Vấn đề | Chốt |
| :--- | :--- | :--- |
| C1 | Mức độ chặn | Chỉ `faulty/offline`; `warning` không chặn |
| C2 | Có tự đổi `RoomEntity.currentStatus` sang `maintenance` không | KHÔNG — tính badge động từ `EquipmentEntity` tại thời điểm query, không lưu derived state trên `rooms` (tránh stale/đồng bộ 2 nguồn sự thật) |
| C3 | Cơ chế xác nhận | Override flag boolean trong body (mirror `capacityOverrideConfirmed`), KHÔNG dùng warning-token JWT |
| C4 | Có cần `EquipmentModule` import vào `MeetingsModule`? | KHÔNG — chỉ thêm `EquipmentEntity` vào `TypeOrmModule.forFeature`, tránh circular |

---

## 12. Functional Requirements

- **FR-01**: WHEN người dùng gửi `POST /meetings` cho phòng có ≥1 thiết bị `healthStatus ∈ {faulty,offline}` và `equipmentWarningConfirmed !== true`, THE system SHALL từ chối yêu cầu với `422 ROOM_HAS_FAULTY_EQUIPMENT` kèm danh sách thiết bị hỏng.
- **FR-02**: WHEN người dùng gửi lại với `equipmentWarningConfirmed = true`, THE system SHALL bỏ qua cảnh báo và tiếp tục luồng tạo meeting bình thường.
- **FR-03**: WHERE phòng không có thiết bị `faulty/offline` nào, THE system SHALL không chặn và không yêu cầu xác nhận.
- **FR-04**: THE system SHALL KHÔNG áp dụng cảnh báo này cho thiết bị ở trạng thái `warning` hoặc `healthy`.
- **FR-05**: IF việc tạo meeting bị chặn bởi `ROOM_CONFLICT` (double-booking), THEN THE system SHALL trả lỗi đó trước, KHÔNG cần kiểm tra thiết bị hỏng (thứ tự check không đổi hành vi nghiệp vụ hiện có).

## 13. Non-Functional Requirements

- **NFR-01**: Query `EquipmentEntity` không dùng `EquipmentModule` (tránh circular dependency) — chỉ `TypeOrmModule.forFeature`.
- **NFR-02**: Response lỗi tuân theo format chuẩn dự án (`success,message,error:{code,details},timestamp`), mirror `CAPACITY_EXCEEDED`.

## 14. Acceptance Criteria

- **AC-01**: Given phòng có 1 thiết bị `faulty`, When gọi `POST /meetings` không kèm `equipmentWarningConfirmed`, Then trả 422 `ROOM_HAS_FAULTY_EQUIPMENT`, `details.faultyEquipments` có đúng thiết bị đó.
- **AC-02**: Given cùng bối cảnh AC-01, When gọi lại với `equipmentWarningConfirmed:true`, Then meeting được tạo thành công (200/201).
- **AC-03**: Given phòng chỉ có thiết bị `warning` (không có `faulty/offline`), When gọi `POST /meetings`, Then KHÔNG bị chặn bởi cảnh báo này.
- **AC-04**: Given phòng đang bị double-booking (`ROOM_CONFLICT`) VÀ có thiết bị hỏng, When gọi `POST /meetings`, Then trả `ROOM_CONFLICT` (không phải `ROOM_HAS_FAULTY_EQUIPMENT`).

## 15. Exception / Alternative Flows

- **EC-01**: 422 `ROOM_HAS_FAULTY_EQUIPMENT` khi có thiết bị hỏng chưa confirm.
- **EC-02**: Phòng không tồn tại → `404 ROOM_NOT_FOUND` (đã có, không đổi, xảy ra trước bước check thiết bị).

---

## 16. [Missing] — Tóm tắt cần làm

**Trạng thái: [Missing]**.

1. THÊM `equipmentWarningConfirmed?: boolean` vào `create-meeting.dto.ts`.
2. THÊM `EquipmentEntity` vào `TypeOrmModule.forFeature([...])` của `meetings.module.ts`.
3. THÊM đoạn check trong `MeetingsService.create()` (sau `roomConflict`, trước capacity check).
4. Test: có thiết bị faulty/offline chặn đúng; warning không chặn; confirm bỏ qua; không ảnh hưởng `ROOM_CONFLICT`/capacity check hiện có.

**Ranh giới**: KHÔNG sửa logic `roomConflict`/capacity check hiện có. KHÔNG tạo permission mới. KHÔNG đổi `RoomEntity.currentStatus`. KHÔNG import `EquipmentModule`.
