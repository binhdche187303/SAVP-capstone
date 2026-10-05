# Tasks: UC-RM-01 Tao thu cong phong hop moi

**Input**: Design documents from spec/features/rooms/feat-create-meeting-room/
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/create-room-api.md, quickstart.md

**Organization**: Tasks are grouped by implementation phase. Feature nay la 1 User Story don (tao phong hop), chia nho thanh cac task co dependency.

## Format: [TaskID] [P?] [Story] Description with file path

- **[P]**: Co the chay song song (khac file, khong dependency)
- **[US1]**: Thuoc User Story 1 (toan bo feature)
- Include exact file paths

---

## Phase 1: Setup — Database Migration

**Purpose**: Them partial unique index cho room_name de chan race condition

- [x] T001 Tao migration file cho partial unique index ux_rooms_room_name_not_deleted trong src/database/migrations/[timestamp]-AddRoomNameUniqueIndex.ts

---

## Phase 2: Foundational — DTOs & Validation

**Purpose**: Dinh nghia request/response DTO voi validation decorators

- [x] T002 [P] Tao CreateRoomDto trong src/modules/rooms/dto/create-room.dto.ts voi cac field va validation:
  - oomCode: @IsString(), @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/), @Length(3, 80)
  - oomName: @IsString(), @IsNotEmpty(), @MaxLength(255)
  - siteName, reaName, locationDescription: @IsOptional(), @IsString(), @MaxLength()
  - capacity: @IsInt(), @Min(1), @Max(1000)
  - oomType: @IsOptional(), @IsEnum(RoomType), @IsIn(enum values)
  - hasCamera, hasMicrophone, hasDisplay, llowRecording: @IsOptional(), @IsBoolean()

- [x] T003 [P] Tao CreateRoomResponseDto trong src/modules/rooms/dto/create-room-response.dto.ts voi cac field:
  - id, oomCode, oomName, capacity, currentStatus, isActive, createdAt

---

## Phase 3: User Story 1 — Business Logic Service [US1]

**Goal**: Implement RoomsService.create() voi day du business logic, validation, transaction, audit log

**Independent Test**: Goi POST /api/v1/rooms voi valid data -> nhan 201 + room data

- [x] T004 [US1] Tao RoomsService trong src/modules/rooms/services/rooms.service.ts gom:
  - create(createRoomDto, userId): method chinh xu ly validate, persist, audit
  - checkDuplicateRoomCode(code): kiem tra roomCode da ton tai trong DB
  - checkDuplicateRoomName(name): kiem tra roomName unique (case-insensitive, trim, deleted_at IS NULL)
  - Map loi DB constraint violation sang error code ROOM_CODE_ALREADY_EXISTS / ROOM_NAME_ALREADY_EXISTS

- [x] T005 [US1] Implement create flow trong RoomsService:
  1. UpperCase roomCode
  2. Trim roomName
  3. Check duplicate roomCode (DB query)
  4. Check duplicate roomName (DB query, case-insensitive, deleted_at IS NULL)
  5. Tao RoomEntity instance voi cac default values
  6. Persist trong TypeORM transaction (QueryRunner) — room + audit_log
  7. Return CreateRoomResponseDto

---

## Phase 4: User Story 1 — Controller & Module Wiring [US1]

**Goal**: Expose POST /api/v1/rooms endpoint voi auth guards

- [x] T006 [P] [US1] Tao RoomsController trong src/modules/rooms/controllers/rooms.controller.ts:
  - @Post() @HttpCode(HttpStatus.CREATED) @UseGuards(JwtAuthGuard, PermissionsGuard)
  - @RequirePermissions('room.create')
  - @CurrentUser() userId, @Body(ValidationPipe) createRoomDto
  - ValidationPipe config: whitelist: true, forbidNonWhitelisted: true (reject unsupported fields nhu layoutJson)
  - Goi roomsService.create() va tra ve response

- [x] T007 [P] [US1] Update RoomsModule trong src/modules/rooms/rooms.module.ts:
  - Them RoomsController vao controllers
  - Them RoomsService vao providers
  - Import TypeOrmModule.forFeature([AuditLogEntity]) neu can
  - Dam bao AuthModule da duoc import de dung guards (hoac import trong root module)

---

## Phase 5: Testing

**Purpose**: Unit tests cho DTO validation, service logic, controller

- [x] T008 [P] [US1] Tao DTO validation test trong src/modules/rooms/dto/create-room.dto.spec.ts:
  - Valid data -> pass
  - Thieu roomCode -> fail
  - roomCode sai regex (chu thuong, khoang trang, ky tu dac biet) -> fail
  - roomCode qua ngan (<3) hoac qua dai (>80) -> fail
  - Thieu roomName -> fail
  - Thieu capacity -> fail
  - capacity = 0, -1, 1.5, 1001 -> fail
  - roomType sai enum -> fail

- [x] T009 [P] [US1] Tao Service unit test trong src/modules/rooms/tests/rooms.service.spec.ts:
  - Tao phong thanh cong -> tra ve CreateRoomResponseDto dung
  - Tao phong voi duplicate roomCode -> throw HttpException 409 ROOM_CODE_ALREADY_EXISTS
  - Tao phong voi duplicate roomName -> throw HttpException 409 ROOM_NAME_ALREADY_EXISTS
  - Tao phong -> check audit log duoc ghi
  - Transaction rollback khi save room fail
  - Transaction rollback khi save audit_log fail

- [x] T010 [P] [US1] Tao Controller unit test trong src/modules/rooms/tests/rooms.controller.spec.ts:
  - POST 201 voi valid data
  - POST 401 khi khong co token
  - POST 403 khi khong co permission 'room.create'
  - POST 422 khi request body chua field ngoai contract (layoutJson)

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T011 Verify quickstart.md test scenarios: chay manual hoac integration test

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Migration)**: Co the chay truoc hoac song song voi Phase 2
- **Phase 2 (DTOs)**: Khong dependency — co the bat dau ngay
- **Phase 3 (Service [US1])**: Phu thuoc T002 (create-room.dto.ts)
- **Phase 4 (Controller [US1])**: Phu thuoc T005 (service create flow)
- **Phase 5 (Testing)**: T008 phu thuoc T002 (DTO); T009 phu thuoc T005; T010 phu thuoc T006
- **Phase 6 (Polish)**: Phu thuoc Phase 5

### Parallel Opportunities

- T001 + T002 + T003: Co the chay song song (migration, input DTO, response DTO)
- T006 + T007: Controller va Module update co the chay song song
- T008 + T009 + T010: Tat ca test co the chay song song

### Parallel Execution Example

`ash
# Phase 2: Tao DTOs song song
Task: T002 Tao CreateRoomDto
Task: T003 Tao CreateRoomResponseDto

# Phase 3+4 (sau khi DTOs xong): Tao service + controller song song
Task: T004+T005 Tao RoomsService (business logic)
Task: T006+T007 Tao RoomsController + update module

# Phase 5: Tao tests song song
Task: T008 DTO validation tests
Task: T009 Service unit tests
Task: T010 Controller unit tests
`

---

## Implementation Strategy

### MVP Scope

Toan bo feature nay la MVP — 1 endpoint POST /api/v1/rooms:
1. Migration + DTOs (T001-T003)
2. Service logic (T004-T005)
3. Controller + Module (T006-T007)
4. Tests (T008-T010)
5. Verify (T011)

### Incremental Delivery

1. Migration + DTOs xong -> co the test validation standalone
2. Service xong -> co the goi truc tiep (unit test)
3. Controller + Module xong -> endpoint hoan chinh
4. Tests xong -> full coverage

---

## Requirements Coverage

### FR Coverage

| Task | FR | Status |
|---|---|---|
| T005 | FR-001 (luu thong tin phong) | Service create |
| T005 | FR-002 (currentStatus=available) | Default value |
| T005 | FR-003 (isActive=true) | Default value |
| T005 | FR-004 (ghi timestamp) | TypeORM auto |
| T005 | FR-005 (WHEN Business Admin gui) | Endpoint + Service |
| T006 | FR-006 (phong available xuat hien) | Endpoint |
| T002 | FR-007 (optional fields vi tri) | DTO decorators |
| T002 | FR-008 (optional fields thiet bi) | DTO decorators |
| T004 | FR-009 (roomCode format) | Service validation |
| T004 | FR-010 (duplicate roomCode) | Service check |
| T004 | FR-011 (duplicate roomName) | Service check |
| T004 | FR-012 (capacity invalid) | DTO + Service validation |
| T004 | FR-012b (roomType invalid) | DTO validation |
| T006 | FR-012c (unsupported field) | ValidationPipe whitelist |
| T006 | FR-013 (unauthenticated) | JwtAuthGuard |
| T006 | FR-014 (no permission) | PermissionsGuard |
| T006 | FR-015 (verify auth before logic) | Guard order |
| T005 | FR-016 (persist default values) | Service create |
| T005 | FR-017 (rollback khi fail) | Transaction |
| T005 | FR-018 (audit log) | Service write audit_log |
| T005 | FR-019 (audit fail khong rollback room) | Service error handling |

### AC Coverage

| AC ID | Task | Verification |
|---|---|---|
| AC-001 | T005 | Service tao phong thanh cong |
| AC-002 | T008 | Thieu roomCode fail |
| AC-002b | T008 | roomCode sai format fail |
| AC-003 | T008 | Thieu roomName fail |
| AC-004 | T008 | Thieu capacity fail |
| AC-005 | T008 | capacity sai range fail |
| AC-006 | T008 | roomType sai enum fail |
| AC-006b | T010 | Unsupported field reject |
| AC-007 | T010 | 401 khi chua dang nhap |
| AC-008 | T010 | 403 khi khong co quyen |
| AC-009 | T009 | Duplicate roomCode 409 |
| AC-010 | T009 | Duplicate roomName 409 |
| AC-011 | T009 | Audit log duoc ghi |


