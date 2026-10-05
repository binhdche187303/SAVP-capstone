# Research: UC-RM-01 Tao thu cong phong hop moi

## Codebase Analysis

### Existing Module: rooms
- **Path**: src/modules/rooms/
- **Entities**: RoomEntity, RoomBookingEntity, RoomBookingUsageEntity, NoShowCaseEntity, RoomEventEntity
- **RoomEntity**: Day du cac field can thiet (roomCode, roomName, capacity, roomType enum, hasCamera, hasMicrophone, hasDisplay, allowRecording, currentStatus, isActive, createdBy, updatedBy, timestamps, soft delete)
- **RoomType enum**: meeting_room, training_room, board_room, open_space
- **RoomStatus enum**: available, occupied, reserved, maintenance, inactive
- **Controller/Service**: Chua co -- can tao moi

### Existing Patterns (tham khao tu meetings module)
- Controller: src/modules/rooms/controllers/rooms.controller.ts
- Service: src/modules/rooms/services/rooms.service.ts  
- DTO: src/modules/rooms/dto/
- Guards: src/modules/auth/guards/jwt-auth.guard.ts, permissions.guard.ts
- Decorators: @CurrentUser(), @RequirePermissions()
- Validation: class-validator + ValidationPipe
- Response format: { success, message, data, meta }
- Testing: Jest spec files ke ben file

### Database Impact
- Bang ooms da co san trong DB v3.2 Compact (39 tables)
- RoomEntity da co cac field, KHONG can migration them cot
- Can them DB migration cho partial unique index oomName de tranh race condition
- Khong can tao bang moi

### Technology Decisions
| Decision | Choice | Rationale |
|---|---|---|
| ORM | TypeORM | Project standard, tuyet doi khong dung Prisma |
| Validation | class-validator + ValidationPipe | Project standard |
| Auth | JwtAuthGuard + PermissionsGuard + @RequirePermissions() | Project standard |
| Transaction | TypeORM QueryRunner / @Transactional | Dam bao rollback khi persist fail |
| Response format | ResponseEntity pattern | Project API convention |
| Testing | Jest | Project standard |

### Risks
1. Race condition unique roomName: Spec yeu cau DB partial unique index, can tao migration
2. Cross-module dependency: Rooms module can dung AccountsModule cho UserEntity relations
