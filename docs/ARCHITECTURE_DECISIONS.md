# Architecture Decisions — Backend Capstone

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-06-04 | Tạo tài liệu ban đầu: ghi lại quyết định kiến trúc Hybrid TypeORM | Toàn bộ file |
| 2026-06-15 | Thêm ADR-008: IoT Device dùng status-based disable thay soft delete (phục vụ spec IOT-011) | Cuối file |
| 2026-10-05 | ADR-004: thêm 5 bảng Học vụ (ACD-001) vào danh sách soft delete | ADR-004 |

---

## ADR-001: Hybrid Database Access Architecture

### Trạng thái
**Accepted** — 2026-06-04

### Bối cảnh
Backend Capstone sử dụng NestJS + TypeORM + PostgreSQL. Module `auth` đã được triển khai hoàn chỉnh trước khi quyết định chuẩn hóa kiến trúc, sử dụng raw SQL qua `DataSource.query()` cho tất cả database access.

Câu hỏi: Có nên refactor auth module sang TypeORM Entity/Repository pattern như các module khác không?

### Quyết định
**Kiến trúc Hybrid có kiểm soát** — Không refactor auth, chuẩn hóa từ các module nghiệp vụ mới:

```
┌──────────────────────────────────────────────────────────────┐
│                    Database Access Policy                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  auth module          →  Raw SQL via DataSource.query()      │
│  (security-sensitive)    Ngoại lệ có chủ đích                │
│                                                              │
│  business modules     →  TypeORM Entity + Repository         │
│  (accounts, meetings,    @Entity, @InjectRepository          │
│   rooms, equipment,      TypeOrmModule.forFeature()          │
│   iot, attendance,                                           │
│   presence, recording,                                       │
│   transcription,                                             │
│   minutes, notifications)                                    │
│                                                              │
│  analytics/reporting  →  Raw SQL, SQL View hoặc             │
│  (analytics, reports)    Materialized View                   │
│                          Cho complex aggregation queries      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Lý do

**Tại sao auth giữ raw SQL:**
- Auth module đã implement đầy đủ (49 files, comprehensive test coverage)
- Security-sensitive code: raw SQL + parameterized queries kiểm soát tốt hơn SQL injection risks
- Custom transaction pattern với row-level locking (`SELECT ... FOR UPDATE`)
- Stateless JWT blacklist qua Redis Cache không liên quan đến TypeORM entity
- Không có bug hiện tại — "if it ain't broke, don't fix it"

**Tại sao business modules dùng TypeORM Entity:**
- Tất cả 19 module nghiệp vụ còn lại đều là empty scaffolds — cơ hội clean start
- TypeORM entity cung cấp: type safety, relation loading, query builder, migrations
- Giảm boilerplate code khi viết CRUD operations
- Dễ maintain và extend khi team phát triển

**Tại sao analytics/reports được phép dùng raw SQL:**
- Dashboard queries thường cần complex JOINs, window functions, aggregations
- TypeORM QueryBuilder có giới hạn với GROUP BY phức tạp
- SQL View và Materialized View tối ưu performance hơn

### Hệ quả
- Có 2 cách access vào bảng `audit_logs`: auth module (raw SQL) và administration module (AuditLogEntity)
- Đây là trade-off được chấp nhận — audit_logs là append-only, không conflict
- Cần document rõ cho developer mới về convention này

---

## ADR-002: Entity Placement Strategy

### Trạng thái
**Accepted** — 2026-06-04

### Quyết định
Entities nằm trong module của chúng (`src/modules/<module>/entities/`) thay vì một thư mục trung tâm (`src/database/entities/`).

### Lý do
- Phù hợp với NestJS modular monolith pattern
- Module tự quản lý entities của mình
- Import boundary rõ ràng hơn

### Barrel Index
File `src/database/entities/index.ts` re-export tất cả entities để tiện import:
```typescript
import { UserEntity, MeetingEntity } from '@/database/entities';
```
Nhưng entity vẫn phải được đăng ký qua `TypeOrmModule.forFeature()` trong module gốc.

---

## ADR-003: Cross-Module Entity Relations

### Trạng thái
**Accepted** — 2026-06-04

### Quyết định
Module cần dùng entity của module khác phải **import module đó** và sử dụng `TypeOrmModule.forFeature()` kết hợp với NestJS module exports.

```typescript
// meetings.module.ts cần UserEntity từ AccountsModule
@Module({
  imports: [
    AccountsModule,        // ← Import module chứa UserEntity
    TypeOrmModule.forFeature([MeetingEntity, ...])
  ],
  exports: [TypeOrmModule] // ← Export để downstream modules dùng
})
```

### Module Dependency Graph (đơn giản hóa)
```
AccountsModule
    ↑
MeetingsModule ← RoomsModule ← EquipmentModule ← IotModule
                                                      ↑
AttendanceModule ────────────────────────────────────┤
PresenceModule ──────────────────────────────────────┤
RecordingModule ─────────────────────────────────────┘
    ↑
TranscriptionModule
    ↑
MinutesModule
```

---

## ADR-004: Soft Delete Strategy

### Trạng thái
**Accepted** — 2026-06-04

### Quyết định
Dùng `@DeleteDateColumn()` của TypeORM cho các bảng có cột `deleted_at`.

```typescript
@DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
deletedAt: Date | null;
```

### Hành vi
- Khi gọi `repository.softDelete(id)`: TypeORM tự set `deleted_at = now()`
- Khi gọi `repository.find()`: TypeORM tự thêm `WHERE deleted_at IS NULL`
- Để thấy records đã xóa: dùng `repository.find({ withDeleted: true })`

### Bảng áp dụng soft delete
`departments`, `users`, `face_profiles`, `meetings`, `meeting_notes`, `rooms`, `equipments`, `device_user_mappings`, `media_files`, `meeting_minutes`, `semesters`, `subjects`, `study_shifts`, `students`, `class_sections` (ACD-001; `class_enrollments`/`class_sessions` dùng status, không soft delete — tiền lệ ADR-008)

---

## ADR-005: TypeORM Version

### Trạng thái
**Accepted** — 2026-06-04

### Quyết định
Giữ TypeORM v1.x (như đã cài trong `package.json: "typeorm": "^1.0.0"`).

### Lưu ý
- TypeORM v1.x là major rewrite từ v0.3.x
- `synchronize: false` là bắt buộc trong mọi môi trường dự án thật
- Migration phải được tạo thủ công cho mọi schema change

---

## ADR-006: Migration Policy

### Trạng thái
**Accepted** — 2026-06-04

### Quyết định
- Database schema hiện tại (39 bảng) đã được tạo từ `database_v3_2_compact_39_tables.sql`
- **Không chạy `migration:generate`** cho schema hiện có — entities được thiết kế map 1-1 với schema đã tồn tại
- **Chỉ tạo migration** khi có schema change mới (thêm cột, thêm bảng, đổi constraint)
- Migration scripts:
  ```bash
  npm run migration:generate -- src/database/migrations/<MigrationName>
  npm run migration:run
  npm run migration:revert
  npm run migration:show
  ```

---

## ADR-007: password_hash Security

### Trạng thái
**Accepted** — 2026-06-04

### Quyết định
`UserEntity.passwordHash` được khai báo với `select: false`:
```typescript
@Column({ name: 'password_hash', ..., select: false })
passwordHash: string;
```

Điều này đảm bảo `password_hash` **không bao giờ** được trả về trong default SELECT queries khi dùng TypeORM repository. Muốn lấy phải explicit: `repository.findOne({ select: ['id', 'passwordHash', ...] })`.

Auth module không sử dụng UserEntity nên không bị ảnh hưởng.

---

## ADR-008: IoT Device Lifecycle — Status-based Disable (không dùng soft delete)

### Trạng thái
**Accepted** — 2026-06-15

### Bối cảnh
Spec IOT-011 (Cập nhật thông tin thiết bị IoT) cần xác định hành vi khi thiết bị "ngừng hoạt động". `IoTDeviceEntity` (bảng `iot_devices`) **không có** cột `deleted_at` và không nằm trong danh sách bảng áp dụng soft delete ở ADR-004.

### Quyết định
Vòng đời "vô hiệu hóa" của `iot_devices` được quản lý bằng cột **`status`** (`online` / `offline` / `disabled` / `maintenance`), **không** dùng soft delete (`deleted_at`). UC cập nhật (IOT-011) do đó không kiểm tra điều kiện soft-delete và không tạo cột `deleted_at` mới (giữ baseline DB v3.2 Compact theo DATA-01).

### Hệ quả
- IOT-011 không có FR liên quan soft-delete; thiết bị có thể được cập nhật ở mọi `status`.
- Nếu sau này cần "xóa" thiết bị, dùng trạng thái `disabled` thay vì xóa bản ghi (giữ lịch sử `iot_device_events`).
