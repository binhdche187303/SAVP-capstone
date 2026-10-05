# PLAN — MEET-ROOM-FAULT-WARN-001: Cảnh báo đặt phòng có thiết bị hỏng

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-08-14 | Tạo mới plan.md cho MEET-ROOM-FAULT-WARN-001. | Toàn bộ file |

> Dựa trên `spec.md` (MEET-ROOM-FAULT-WARN-001) đã duyệt. **CHỈ kế hoạch** — KHÔNG code.
> Mirror pattern `capacityOverrideConfirmed` đã có trong `MeetingsService.create()`.

---

## 0. Ràng buộc & quyết định đã chốt (không mở lại)

| # | Chốt |
| :--- | :--- |
| 1 | Chỉ chặn `healthStatus ∈ {faulty, offline}`; `warning` không chặn. |
| 2 | KHÔNG tự đổi `RoomEntity.currentStatus` — tính động từ `EquipmentEntity` mỗi lần query. |
| 3 | Cơ chế xác nhận: override flag boolean `equipmentWarningConfirmed` trong `CreateMeetingDto` (mirror `capacityOverrideConfirmed`), KHÔNG dùng `WarningTokenUtil`. |
| 4 | KHÔNG import `EquipmentModule` vào `MeetingsModule` (tránh circular `MeetingsModule→EquipmentModule→RoomsModule→MeetingsModule`) — chỉ thêm `EquipmentEntity` vào `TypeOrmModule.forFeature`. |
| 5 | Vị trí chèn: sau `roomConflict` check (dòng 761-776), trước capacity check (dòng 778-795), trong `MeetingsService.create()`. |
| 6 | KHÔNG permission mới — dùng `meeting.create` hiện có. |

---

## 1. Kiến trúc & luồng

```
MeetingsService.create(dto, authUser)
  [không đổi] validate thời gian (689-703)
  [không đổi] load room (705-715)
  [không đổi] validate host/participants (717-759)
  [không đổi] roomConflict check (761-776) — chặn cứng, không override
  [MỚI — chèn ở đây]
    const faultyEquipments = await this.equipmentRepo.find({
      where: { currentRoomId: dto.roomId, healthStatus: In([HealthStatus.FAULTY, HealthStatus.OFFLINE]) },
      select: { id: true, equipmentName: true, equipmentType: true, healthStatus: true, lastIssueNote: true },
    });
    const equipmentWarningConfirmed = dto.equipmentWarningConfirmed === true;
    if (faultyEquipments.length > 0 && !equipmentWarningConfirmed) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Phòng này đang có thiết bị hỏng, bạn có muốn tiếp tục đặt phòng không?',
        error: {
          code: 'ROOM_HAS_FAULTY_EQUIPMENT',
          details: { blocking: false, requiresConfirmation: true, faultyEquipments },
        },
      });
    }
  [không đổi] capacity check (778-795)
  [không đổi] transaction tạo meeting/booking (798+)
```

`equipmentRepo` = `this.dataSource.getRepository(EquipmentEntity)` — gọi trực tiếp qua `DataSource` đã có sẵn trong `MeetingsService` (constructor đã inject `DataSource`, mirror cách `RoomEntity`/`RoomBookingEntity`/`UserEntity` đang được dùng trong cùng method, ví dụ dòng 705, 718, 737).

### 1.1. Mirror pattern (trỏ dòng thật)
| Thành phần mới | Mirror từ |
| :--- | :--- |
| Override flag `equipmentWarningConfirmed` | `capacityOverrideConfirmed` — `create-meeting.dto.ts:75-77` |
| Throw `422` với `blocking:false,requiresConfirmation:true` | `CAPACITY_EXCEEDED` — `meetings.service.ts:782-795`; `PARTICIPANT_TIME_CONFLICT_WARNING` — `meetings.service.ts:1359-1383` |
| Query entity qua `DataSource.getRepository` trong `MeetingsService` | `this.dataSource.getRepository(RoomEntity).findOne(...)` — `meetings.service.ts:705` |
| Thêm entity vào `forFeature` thay vì import module | `RoomEntity, RoomBookingEntity` trong `meetings.module.ts:57-70` + comment dòng 46-47 giải thích lý do |

---

## 2. Danh sách file TẠO / SỬA

### 2.1. TẠO mới
| File | Vai trò |
| :--- | :--- |
| `src/modules/meetings/tests/meetings-create-equipment-warning.service.spec.ts` | Unit test nhánh mới |

### 2.2. SỬA (additive)
| File | Thay đổi |
| :--- | :--- |
| `src/modules/meetings/dto/create-meeting.dto.ts` | THÊM field `equipmentWarningConfirmed?: boolean` (`@IsBoolean @IsOptional`), đặt ngay sau `capacityOverrideConfirmed` (dòng 75-77). |
| `src/modules/meetings/meetings.module.ts` | THÊM `EquipmentEntity` vào mảng `TypeOrmModule.forFeature([...])` (dòng 57-70) + import entity. |
| `src/modules/meetings/services/meetings.service.ts` | THÊM đoạn check (§1) vào `create()`, sau dòng 776, trước dòng 778. THÊM import `EquipmentEntity, HealthStatus` từ `../../equipment/entities/equipment.entity.js`. |

> KHÔNG sửa `meetings.controller.ts` (không đổi endpoint/signature, chỉ field mới optional trong DTO đã có).

---

## 3. Error handling map

| Tình huống | Exception | HTTP | `error.code` |
| :--- | :--- | :--- | :--- |
| Có thiết bị `faulty/offline`, chưa confirm | `UnprocessableEntityException` | 422 | `ROOM_HAS_FAULTY_EQUIPMENT` |
| Đã confirm hoặc không có thiết bị hỏng | *(không throw, tiếp tục luồng)* | — | — |

`details`: `{ blocking: false, requiresConfirmation: true, faultyEquipments: Array<{id,equipmentName,equipmentType,healthStatus,lastIssueNote}> }`.

---

## 4. Test plan (liệt kê — implement ở bước sau)

`meetings-create-equipment-warning.service.spec.ts`:
- **EW1**: phòng có 1 thiết bị `faulty`, không truyền `equipmentWarningConfirmed` → 422 `ROOM_HAS_FAULTY_EQUIPMENT`, `details.faultyEquipments` đúng 1 phần tử.
- **EW2**: cùng bối cảnh, `equipmentWarningConfirmed:true` → không throw, đi tiếp tới capacity check/transaction (mock để verify không dừng ở đây).
- **EW3**: phòng chỉ có thiết bị `warning` → không throw (không nằm trong `[FAULTY,OFFLINE]`).
- **EW4**: phòng không có thiết bị nào → không throw.
- **EW5**: phòng có `roomConflict` (double-booking) VÀ có thiết bị `faulty` → trả `ROOM_CONFLICT` (không phải `ROOM_HAS_FAULTY_EQUIPMENT`) — verify thứ tự check không đổi.
- **EW6**: phòng có 2 thiết bị `offline` → `details.faultyEquipments` có đúng 2 phần tử.

---

## 5. Rủi ro & xác minh

| Rủi ro | Xác minh / xử lý |
| :--- | :--- |
| Circular dependency nếu lỡ import `EquipmentModule` | CHỈ thêm `EquipmentEntity` vào `TypeOrmModule.forFeature`, KHÔNG import module — đã verify comment sẵn có trong `meetings.module.ts:46-47` xác nhận nguyên tắc này. |
| Đổi thứ tự check làm sai lệch response `CAPACITY_EXCEEDED`/`ROOM_CONFLICT` hiện có | Chèn SAU `roomConflict`, TRƯỚC capacity — không đổi vị trí 2 check cũ, chỉ chèn xen giữa. Test EW5 verify `ROOM_CONFLICT` vẫn ưu tiên. |
| `select` không lấy đủ field cho `faultyEquipments` trong response | Liệt kê tường minh `select:{id,equipmentName,equipmentType,healthStatus,lastIssueNote}` — đúng convention "không over-fetch" của dự án (đã thấy ở `room-bookings.service.ts`). |

---

## 6. Tác động code người khác

- KHÔNG sửa `roomConflict`/`getRoomAvailability`/capacity check logic hiện có — chỉ chèn thêm 1 khối độc lập.
- KHÔNG sửa `meetings.controller.ts`, KHÔNG sửa module `equipment`/`rooms`.
- KHÔNG đổi response shape của các lỗi hiện có (`ROOM_CONFLICT`, `CAPACITY_EXCEEDED`, v.v).

---

## 7. Checklist file cần tạo/sửa

**TẠO**
- [ ] `src/modules/meetings/tests/meetings-create-equipment-warning.service.spec.ts`

**SỬA (additive)**
- [ ] `src/modules/meetings/dto/create-meeting.dto.ts` (+1 field)
- [ ] `src/modules/meetings/meetings.module.ts` (+`EquipmentEntity` vào forFeature)
- [ ] `src/modules/meetings/services/meetings.service.ts` (+1 khối check trong `create()`)

**KHÔNG làm**: import `EquipmentModule`; đổi `roomConflict`/capacity check hiện có; đổi `RoomEntity.currentStatus`; permission mới; sửa `meetings.controller.ts`.
