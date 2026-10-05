# Implementation Plan: UC-RM-01 Tao thu cong phong hop moi

**Branch**: feat-create-meeting-room | **Date**: 2026-06-16 | **Spec**: spec.md
**Input**: Feature specification from spec/features/rooms/feat-create-meeting-room/spec.md

---

## Summary

Tao endpoint POST /api/v1/rooms cho phep Business Admin tao phong hop moi. Xu ly validation, duplicate check, audit log. Sync operation, khong background job.

## Technical Context

**Language/Version**: TypeScript / NestJS
**Primary Dependencies**: @nestjs/common, @nestjs/typeorm, class-validator, class-transformer
**Storage**: PostgreSQL via TypeORM (RoomEntity existing)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Backend API (modular monolith)
**Performance Goals**: < 3 giay cho tao phong
**Constraints**: Sync, khong background_jobs
**Scale/Scope**: 1 endpoint, 1 table (rooms) + 1 table (audit_logs)

## Constitution Check

All gates passed:

| Gate | Status | Note |
|---|---|---|
| DB Gate | PASS | Khong them bang moi. Chi them partial unique index (migration) |
| Security Gate | PASS | JWT auth, permission guard, user_id tu JWT |
| Scope Gate | PASS | Dung scope spec, reject unsupported fields |
| Module Gate | PASS | Tao trong module rooms, khong import cheo |
| API Gate | PASS | Dung response format convention |
| Auth Gate | PASS | JwtAuthGuard + PermissionsGuard + @RequirePermissions('room.create') |
| Test Gate | PASS | Unit test cho service, DTO validation, controller |

## Project Structure

### Documentation

`
spec/features/rooms/feat-create-meeting-room/
  plan.md              # File nay
  spec.md              # Feature specification (da co)
  research.md          # Codebase analysis
  data-model.md        # Data model & migration
  quickstart.md        # Test scenarios
  contracts/
    create-room-api.md # API contract
  tasks.md             # Tasks (tao sau boi speckit-tasks)
`

### Source Code

`
src/modules/rooms/
  rooms.module.ts                   # Update: them controller + service providers
  controllers/
    rooms.controller.ts             # NEW: POST /api/v1/rooms endpoint
  services/
    rooms.service.ts                # NEW: Business logic
  dto/
    create-room.dto.ts              # NEW: Request DTO + validation decorators
    create-room-response.dto.ts     # NEW: Response DTO
    create-room.dto.spec.ts         # NEW: DTO validation tests
  entities/
    room.entity.ts                  # EXISTING (khong can sua)
  tests/
    rooms.controller.spec.ts        # NEW: Controller tests
    rooms.service.spec.ts           # NEW: Service tests

src/database/migrations/
  [timestamp]-add-room-name-unique-index.ts  # NEW: Partial unique index
`

## Implementation Phases

### Phase 1: Migration & Infrastructure
- Tao migration file cho partial unique index ux_rooms_room_name_not_deleted
- Dam bao RoomEntity da co enum RoomType day du

### Phase 2: DTOs & Validation
- create-room.dto.ts: Define request body fields, validation decorators
  - @IsString() @Matches() cho roomCode (regex, uppercase)
  - @IsString() @IsNotEmpty() cho roomName
  - @IsInt() @Min(1) @Max(1000) cho capacity
  - @IsOptional() @IsEnum(RoomType) cho roomType
  - @IsOptional() @IsBoolean() cho boolean fields
  - Custom validator: @IsUnsupportedField() hoac whitelist: true trong ValidationPipe
- create-room-response.dto.ts: Define response shape

### Phase 3: Service - Business Logic
- ooms.service.ts:
  - create(dto, userId): Main method
    1. Validate business rules (format, duplicate, khoang)
    2. Check duplicate roomCode (DB lookup)
    3. Check duplicate roomName (case-insensitive, trim, deleted_at IS NULL)
    4. Tao RoomEntity voi gia tri mac dinh
    5. Persist trong transaction
    6. Ghi audit_logs
    7. Return response DTO
  - checkDuplicateRoomCode(code): Kiem tra roomCode da ton tai
  - checkDuplicateRoomName(name): Kiem tra roomName unique
  - Error codes mapping database constraint violation

### Phase 4: Controller & Module wiring
- ooms.controller.ts:
  - @Post() @HttpCode(201)
  - JwtAuthGuard, PermissionsGuard, @RequirePermissions('room.create')
  - @CurrentUser() userId tu JWT
  - ValidationPipe whitelist: true (reject unsupported fields)
- ooms.module.ts: Add controller + service providers

### Phase 5: Testing
- DTO validation tests (class-validator decorators)
- Service unit tests (all FRs)
- Controller unit tests (HTTP codes, guards)
- Integration test: tao phong -> kiem tra DB record

## Transaction Boundary

`
BEGIN TRANSACTION
  1. Validate input (trong controller/DTO)
  2. Check business rules (duplicate roomCode, roomName)
  3. Create RoomEntity
  4. Save RoomEntity (TypeORM save)
  5. Create audit_log record
  6. Save audit_log
COMMIT

IF fail at 4-6 -> ROLLBACK (TypeORM default)
`

> Khong can @Transactional decorator vi NestJS QueryRunner default la transaction cho single save. Dùng QueryRunner de wrap manual transaction neu can atomic cho 2 saves (room + audit).

## Authorization Flow

1. Request -> JwtAuthGuard -> kiem tra token
2. PermissionsGuard -> kiem tra user co 'room.create'
3. @CurrentUser() -> lay userId tu JWT payload
4. Service nhan userId lam created_by

## Error Handling Strategy

| Error Type | Handling | HTTP Code |
|---|---|---|
| Validation (missing field) | class-validator + ValidationPipe | 400 |
| Validation (wrong format) | Custom validator/pipe | 422 |
| Business rule (duplicate) | Service check + throw HttpException | 409 |
| Auth (unauthenticated) | JwtAuthGuard | 401 |
| Auth (no permission) | PermissionsGuard | 403 |
| Unsupported field | ValidationPipe whitelist: true | 422 |
| DB constraint violation | Catch TypeORM exception -> map sang error code | 409 |
| Server error | Global exception filter | 500 |

## Testing Strategy

### Service Tests (rooms.service.spec.ts)
- Tao phong thanh cong -> tra ve room data
- Tao phong voi duplicate roomCode -> throw 409
- Tao phong voi duplicate roomName -> throw 409
- Tao phong voi capacity invalid -> throw 422
- Tao phong thanh cong -> audit log duoc ghi
- Transaction rollback khi save fail

### DTO Tests (create-room.dto.spec.ts)
- Valid data pass
- Thieu roomCode fail
- roomCode sai regex fail
- capacity = 0 fail
- capacity > 1000 fail
- roomType sai enum fail

### Controller Tests (rooms.controller.spec.ts)
- POST 201 voi valid data
- POST 401 khi khong co token
- POST 403 khi khong co permission

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Race condition roomName unique | DB partial unique index + service-level check (defense in depth) |
| Unsupported fields | ValidationPipe whitelist: true |
| Circular dependency (AccountsModule) | Import TypeOrmModule.forFeature([UserEntity]) thay vi import AccountsModule |
| Transaction consistency (room + audit) | Manual QueryRunner transaction |

## Acceptance Criteria Traceability

| AC ID | Test Strategy | Phase |
|---|---|---|
| AC-001 | Service integration test | Phase 5 |
| AC-002 to AC-006 | DTO validation test | Phase 5 |
| AC-007 to AC-008 | Controller auth test | Phase 5 |
| AC-009 to AC-010 | Service business rule test | Phase 5 |
| AC-011 | Audit log verification test | Phase 5 |
