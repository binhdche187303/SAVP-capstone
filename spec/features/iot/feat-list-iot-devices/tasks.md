# Tasks: Liệt kê & Xem chi tiết thiết bị IoT/Camera (IOT-013)

- **Feature ID**: IOT-013
- **Module**: `iot`
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)
- **Status**: Draft (chưa code)

> Quy tắc: theo thứ tự. Mỗi task: file đụng + DoD + FR/AC/EC. Read-only (KHÔNG audit/transaction). KHÔNG sửa entity/schema. QueryBuilder dùng **property-name** (`d.deviceType`...), search **bound param**.

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo tasks.md cho IOT-013 (list+detail, query DTO, findAll/findOne, seed read). NC-P1 chốt whitelist-only. | Toàn bộ file (bản đầu tiên) |

---

## 1. DTO — `ListIotDevicesQueryDto`
**File**: `src/modules/iot/dto/list-iot-devices-query.dto.ts` (mới)

- [ ] `page`: `@IsOptional` `@Type(()=>Number)` `@IsInt` `@Min(1)` default `1`.
- [ ] `limit`: `@IsOptional` `@Type(()=>Number)` `@IsInt` `@Min(1)` `@Max(100)` default `20` (limit>100 → 400).
- [ ] `status?`: `@IsOptional` `@IsEnum(IoTDeviceStatus)`.
- [ ] `deviceType?`: `@Expose({name:'device_type'})` `@IsOptional` `@IsEnum(IoTDeviceType)`.
- [ ] `roomId?`: `@Expose({name:'room_id'})` `@IsOptional` `@IsUUID('4')`.
- [ ] `search?`: `@IsOptional` `@MaxLength(200)`.

**DoD**: compile; default page/limit; transform string→number; snake↔camel cho device_type/room_id.
**Tham chiếu**: FR-013-005, EC-001/002/003.

---

## 2. Service — `findAll` + `findOne`
**File**: `src/modules/iot/services/iot-devices.service.ts` (sửa)

- [ ] `findAll(query)`:
  - `qb = this.dataSource.getRepository(IoTDeviceEntity).createQueryBuilder('d')`.
  - `if status` → `qb.andWhere('d.status = :status', { status })`.
  - `if deviceType` → `qb.andWhere('d.deviceType = :deviceType', { deviceType })`.
  - `if roomId` → `qb.andWhere('d.roomId = :roomId', { roomId })`.
  - `if search` → `qb.andWhere('(d.deviceName ILIKE :s OR d.deviceCode ILIKE :s)', { s: '%'+search+'%' })` (**BOUND**).
  - `qb.orderBy('d.createdAt','DESC').skip((page-1)*limit).take(limit)`.
  - `const [items,total] = await qb.getManyAndCount()`.
  - return `{ items: items.map(toIotDeviceResponse), meta: { page, limit, total, totalPages: Math.ceil(total/limit) } }`.
- [ ] `findOne(deviceId)`: `manager.findOne({where:{id}})` → null → `NotFoundException IOT_DEVICE_NOT_FOUND`; else `toIotDeviceResponse(device)`.
- [ ] Read-only: KHÔNG transaction, KHÔNG audit.

**DoD**: QueryBuilder property-name; filter AND; search bound; meta camelCase; findOne 404.
**Tham chiếu**: FR-013-001..009, EC-006, AC-001..006.

---

## 3. Controller — 2 handler GET
**File**: `src/modules/iot/controllers/iot-devices.controller.ts` (sửa)

- [ ] Import `Get`, `Query` từ `@nestjs/common`.
- [ ] `@Get()` list: `@UseGuards(JwtAuthGuard, MockPermissionsGuard)` + `@Permissions('iot.device.read')` + `@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))` (**KHÔNG** forbidNonWhitelisted) + `@Query() query: ListIotDevicesQueryDto`. Trả `{ success, message:'IoT devices retrieved successfully', data: items, meta }`.
- [ ] `@Get(':id')` detail: guard mock + `@Permissions('iot.device.read')` + `@Param('id', ParseUUIDPipe)`. Trả `{ success, message:'IoT device retrieved successfully', data }`.
- [ ] Đặt `@Get()` trước `@Get(':id')`. GET không cần `@HttpCode` (mặc định 200).

**DoD**: 2 route đăng ký; query thừa bị bỏ qua (không 400); sai UUID :id → 400.
**Tham chiếu**: FR-013-001/006/011/012, EC-005, NC-P1.

---

## 4. Seed `iot.device.read`
**File**: `src/database/seeds/20260615000003-SeedIotDeviceReadPermission.ts` (mới)

- [ ] Mirror `SeedIotDeviceUpdatePermission.ts`. INSERT `('iot.device.read', 'Xem danh sách / chi tiết thiết bị IoT', 'iot', 'device_read', '<mô tả>', true)` + `ON CONFLICT (permission_code) DO NOTHING`.
- [ ] Gán `ADMIN`, `MANAGER` (VIEWER không tồn tại) qua `role_permissions` (`ON CONFLICT DO NOTHING`).
- [ ] Ghi chú seed-runner team-wide (NC-P2).

**DoD**: file đúng convention, idempotent.

---

## 5. Tests
**File**: `src/modules/iot/services/iot-devices.service.spec.ts` (bổ sung) + `src/modules/iot/dto/list-iot-devices-query.dto.spec.ts` (mới)

- [ ] Mock QueryBuilder (`andWhere/orderBy/skip/take` → `mockReturnThis()`, `getManyAndCount` → `jest.fn()`); `dataSourceMock.getRepository = jest.fn().mockReturnValue({ createQueryBuilder: () => qb })`.
- [ ] **findAll default**: getManyAndCount→[items,total]; orderBy createdAt DESC; skip(0) take(20); meta đúng. *(AC-001)*
- [ ] **findAll status-filter**: andWhere status gọi. *(AC-002)*
- [ ] **findAll search**: andWhere `(d.deviceName ILIKE :s OR d.deviceCode ILIKE :s)` với `s='%...%'`. *(AC-003)*
- [ ] **findAll page2**: skip(20). *(AC-004)*
- [ ] **findAll empty**: [[],0] → meta.total=0, totalPages=0. *(EC-006)*
- [ ] **findOne happy**: trả response. *(AC-005)*
- [ ] **findOne 404**: null → NotFoundException. *(AC-006)*
- [ ] **DTO**: limit>100→invalid; status/device_type sai enum, room_id sai uuid, search>200→invalid; default page=1/limit=20. *(EC-002/003)*
- [ ] Coverage ≥ 80% code mới. Không e2e.

**DoD**: tất cả test pass.

---

## 6. API Contract
**File**: `docs/API_CONTRACT_v1.0_with_system_roles.md` (sửa)

- [ ] Thêm mục **IOT-013** (mirror IOT-011/012): 2 GET (list + detail), list query params, response list `{ data[] snake_case, meta { page, limit, total, totalPages } }` (meta camelCase), detail 404. + 1 dòng CHANGELOG.

**DoD**: mục IOT-013 hiện diện, CHANGELOG cập nhật.

---

## 7. Final Verification
- [ ] `npm run build` pass.
- [ ] LINT: `npx eslint <từng path>` (KHÔNG `npm run lint`).
- [ ] `npx jest modules/iot` pass; coverage ≥ 80% code mới.
- [ ] Rà: read-only (no audit/transaction); QueryBuilder property-name; search bound; mask metadata; import `.js`.

---

## 8. Traceability

| Task | FR / AC / EC | NC |
|---|---|---|
| 1 DTO | FR-005, EC-001/002/003 | NC-2 |
| 2 Service | FR-001..010, AC-001..006, EC-006 | — |
| 3 Controller | FR-001/006/011/012, EC-005 | NC-P1 |
| 4 Seed | FR-012 | NC-P2 |
| 5 Tests | AC-001..006, EC-002/003/006 | NC-P3 |
| 6 API Contract | — | NC-1 |

---

> Trạng thái: **CHỜ REVIEW** sau implement. Dừng chờ Thiếu Chủ.
