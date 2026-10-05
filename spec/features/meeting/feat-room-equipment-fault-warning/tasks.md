# TASKS — MEET-ROOM-FAULT-WARN-001: Cảnh báo đặt phòng có thiết bị hỏng

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-08-14 | Tạo mới tasks.md cho MEET-ROOM-FAULT-WARN-001 (T001–T004). | Toàn bộ file |

> Dựa trên `spec.md` + `plan.md` (MEET-ROOM-FAULT-WARN-001) đã duyệt. **CHỈ danh sách task** — KHÔNG code.
> KHÔNG commit.

---

## 0. Ràng buộc thực thi (áp cho mọi task)

| # | Chốt |
| :--- | :--- |
| 1 | Chỉ chặn `faulty/offline`, không chặn `warning`. |
| 2 | KHÔNG import `EquipmentModule` — chỉ `EquipmentEntity` vào `TypeOrmModule.forFeature`. |
| 3 | Chèn SAU `roomConflict` (dòng 761-776), TRƯỚC capacity check (778-795) trong `MeetingsService.create()`. |
| 4 | KHÔNG sửa `roomConflict`/capacity check/`meetings.controller.ts`/`RoomEntity.currentStatus`. |

---

## T001 — [MODIFY additive] `create-meeting.dto.ts` — field `equipmentWarningConfirmed`
**File**: `src/modules/meetings/dto/create-meeting.dto.ts`

Thêm ngay sau field `capacityOverrideConfirmed` (dòng 75-77):
```ts
@IsBoolean({ message: 'equipment_warning_confirmed phải là boolean' })
@IsOptional()
equipmentWarningConfirmed?: boolean;
```

**DoD**: field optional, decorator đúng mirror `capacityOverrideConfirmed`; tsc sạch; không đổi field khác trong DTO.

---

## T002 — [MODIFY additive] `meetings.module.ts` — thêm `EquipmentEntity`
**File**: `src/modules/meetings/meetings.module.ts`

Thêm `import { EquipmentEntity } from '../equipment/entities/equipment.entity.js';` và thêm `EquipmentEntity` vào mảng `TypeOrmModule.forFeature([...])` (dòng 57-70), cạnh `RoomEntity`/`RoomBookingEntity`.

**DoD**: KHÔNG import `EquipmentModule`; build không circular dependency error; `imports` array không đổi thành phần khác.

---

## T003 — [MODIFY additive] `MeetingsService.create()` — check thiết bị hỏng
**File**: `src/modules/meetings/services/meetings.service.ts`
**Vị trí**: sau dòng 776 (`}` đóng khối `roomConflict`), trước dòng 778 (khai báo `totalParticipants`).

Thêm import: `EquipmentEntity, HealthStatus` từ `../../equipment/entities/equipment.entity.js` (additive, cạnh các import entity khác đã có).

Thêm khối (xem plan §1 cho code đầy đủ):
```ts
const faultyEquipments = await this.dataSource.getRepository(EquipmentEntity).find({
  where: { currentRoomId: dto.roomId, healthStatus: In([HealthStatus.FAULTY, HealthStatus.OFFLINE]) },
  select: { id: true, equipmentName: true, equipmentType: true, healthStatus: true, lastIssueNote: true },
});
const equipmentWarningConfirmed = dto.equipmentWarningConfirmed === true;
if (faultyEquipments.length > 0 && !equipmentWarningConfirmed) {
  throw new UnprocessableEntityException({
    success: false,
    message: 'Phòng này đang có thiết bị hỏng, bạn có muốn tiếp tục đặt phòng không?',
    error: { code: 'ROOM_HAS_FAULTY_EQUIPMENT', details: { blocking: false, requiresConfirmation: true, faultyEquipments } },
  });
}
```
(`In` từ `typeorm` — kiểm import đã có sẵn ở đầu file, nếu chưa thêm additive.)

**DoD**: đoạn `roomConflict` (761-776) và capacity check (778-795 cũ, dời xuống sau khối mới) KHÔNG đổi nội dung; khối mới đúng vị trí; tsc sạch.

---

## T004 — [CREATE] Unit test + Cổng chất lượng
**File**: `src/modules/meetings/tests/meetings-create-equipment-warning.service.spec.ts`

6 case EW1-EW6 (xem plan §4). Mock `dataSource.getRepository(EquipmentEntity).find`, giữ mock các repository khác (`RoomEntity`, `UserEntity`, `RoomBookingEntity`) như baseline test `create()` hiện có (đọc file test hiện có của `meetings.service` để mirror cách mock, không đoán).

Sau khi test pass:
1. `npx tsc --noEmit` — net +0.
2. `npx eslint` file đã sửa/tạo.
3. `npx jest src/modules/meetings` — suite mới pass + suite `create()` hiện có 0 regression (đặc biệt case `CAPACITY_EXCEEDED`/`ROOM_CONFLICT` cũ vẫn đúng).
4. `git stash` so baseline `src/modules/meetings`.

**DoD**: 6 case EW1-EW6 pass; 0 regression test `create()` cũ; tsc/eslint sạch; **KHÔNG commit**.

---

## KHÔNG được làm
- KHÔNG import `EquipmentModule`. KHÔNG sửa `roomConflict`/capacity check logic hiện có. KHÔNG sửa `meetings.controller.ts`. KHÔNG đổi `RoomEntity.currentStatus`. KHÔNG permission mới.
- **KHÔNG bắt đầu code cho tới khi có lệnh triển khai rõ ràng từ user.**

---

## Thứ tự thực thi
`T001 → T002 → T003 → T004`

> Chưa code — chờ duyệt spec/plan/tasks + lệnh triển khai.
