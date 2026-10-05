# SPEC — EQUIP-FAULT-LIFECYCLE-001: Notify sysadmin + Xác nhận + Xử lý xong lỗi thiết bị

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-08-14 | Tạo mới spec.md cho EQUIP-FAULT-LIFECYCLE-001 (khép kín vòng đời báo lỗi thiết bị: notify SYSTEM_ADMIN → sysadmin xác nhận → sysadmin cập nhật sau khi sửa xong). Trạng thái [Missing]. | Toàn bộ file |
| 2026-08-20 | ĐẢO NGƯỢC quyết định notify: người dùng chốt lại — báo lỗi thiết bị giờ notify role `BUSINESS_ADMIN` (không còn `SYSTEM_ADMIN`), vì BA mới là người thực tế xử lý confirm/resolve trên FE. Đổi `resolveSystemAdminIds()` → `resolveBusinessAdminIds()` trong `equipment.service.ts`, SQL `role_code` đổi từ `SYSTEM_ADMIN` sang `BUSINESS_ADMIN`. Permission `equipment.confirm_fault`/`equipment.resolve_fault` giữ nguyên `[SYSTEM_ADMIN, BUSINESS_ADMIN]` — không đổi. | Mục 0 (dòng "Notification chỉ gửi..."), §Primary Actor/Trigger/Expected Output, FR-01, AC-01, C3, EC-04 |

> Phạm vi: mở rộng UC-62 (`feat-report-equipment-fault`, đã triển khai) bằng 3 việc: (1) notify SYSTEM_ADMIN khi có report mới, (2) endpoint mới cho sysadmin xác nhận lỗi thật, (3) endpoint mới cho sysadmin cập nhật lại sau khi sửa vật lý xong (recovery — điểm đã được UC-62 §10/§11-C10 đánh dấu "KHÔNG thuộc UC-62, là UC riêng future").
> KHÔNG bao gồm: cảnh báo khi đặt phòng (`spec/features/meeting/feat-room-equipment-fault-warning/`) và badge thiết bị hỏng khi tìm phòng (`spec/features/rooms/feat-room-search-equipment-badge/`) — 2 feature riêng, module khác.
> Tài liệu này chỉ là đặc tả (spec). KHÔNG kèm code.

---

## 0. Khảo sát hiện trạng (bắt buộc đọc trước)

### 0.1. Nền đã có (UC-62 — `feat-report-equipment-fault`, đã triển khai)
| Thành phần | Hiện trạng |
| :--- | :--- |
| `PATCH /api/v1/equipments/:equipmentId/fault` | ✅ Đã có (`EquipmentController.reportFault`, `controllers/equipment.controller.ts:93-149`). Cho phép set `healthStatus ∈ {warning,faulty,offline}` và/hoặc `assetStatus ∈ {active,maintenance,retired}` (resolve qua `resolveAssetAction`, `services/equipment.service.ts:209-222`). |
| `EquipmentService.reportFault` | ✅ `services/equipment.service.ts:233-351`. Phase A (validate) → Phase B (transaction cập nhật) → Phase C (audit fail-separate, `actionType:'update'`, `severity:WARNING`). **KHÔNG có Phase D notify** — sysadmin hoàn toàn không biết có report mới trừ khi tự vào tra `GET /equipments`. |
| Permission `equipment.report_fault` | ✅ Đã seed thật trong migration `20260720000005-BackfillRolePermissions.ts:263` (KHÁC seed cũ ở `src/database/seeds/` — folder đó không có runner, không tính). Roles: `SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, EMPLOYEE` (role code thật là `EMPLOYEE`, không phải `INTERNAL_USER`). |
| Recovery (`healthStatus=healthy`) | ❌ **Chưa có**. `ReportEquipmentFaultDto.healthStatus` chặn cứng bằng `@IsIn(['warning','faulty','offline'])` (`dto/report-equipment-fault.dto.ts:27-30`) — không có đường nào set lại `healthy` qua endpoint hiện tại. |
| Xác nhận lỗi thật (trước khi sửa) | ❌ **Chưa có** — không có khái niệm này trong entity/service hiện tại. |
| `NotificationsService` | ✅ Đã có, method dùng chung `createNotification(dto)` nhận `recipientUserIds: string[]` (`notifications.service.ts:88-118`, interface `CreateNotificationDto` dòng 23-38). `EquipmentModule` **chưa import** `NotificationsModule`. |
| Pattern "notify theo role" | ✅ Đã có 3 tiền lệ y hệt nhu cầu này: `StrangerAlertService.resolveAdmins()` (`face-access/services/stranger-alert.service.ts:165-179`, SYSTEM_ADMIN+BUSINESS_ADMIN), `VehicleControlAlertService.resolveRecipients()` (`anpr/services/vehicle-control-alert.service.ts:254-264`, MANAGER+BUSINESS_ADMIN+SYSTEM_ADMIN) — cả 2 dùng raw SQL join `users/user_roles/roles WHERE r.role_code = ...`. |

### 0.2. Vì sao "xác nhận" không cần cột DB mới (quyết định đã chốt với PO)
Phân tích ban đầu có 2 phương án: (A) thêm cột `fault_confirmed_by`/`fault_confirmed_at` vào `equipments`, hoặc (B) chỉ ghi 1 dòng `audit_logs` khi sysadmin xác nhận, không đổi entity. PO đã chốt **phương án B** — không thêm cột, giữ đúng nguyên tắc DB Compact (CLAUDE.md §5.4: "Không tự ý thêm bảng/cột khi chưa có yêu cầu rõ ràng", ở đây rõ ràng chưa cần vì `audit_logs` đã đủ làm nguồn sự thật cho một sự kiện one-shot không cần query lại thường xuyên theo điều kiện lọc).

Hệ quả: **"đã xác nhận" không phải là 1 trạng thái filter được trên `equipments`** — chỉ là 1 dòng lịch sử trong `audit_logs`. Cảnh báo đặt phòng (`feat-room-equipment-fault-warning`) và badge tìm phòng (`feat-room-search-equipment-badge`) **KHÔNG phân biệt đã-xác-nhận/chưa-xác-nhận** — chỉ dựa vào `healthStatus ∈ {faulty,offline}`. Đây là ranh giới quan trọng cần nhớ khi đọc 2 spec kia.

### 0.3. Nhận diện "report gần nhất" từ audit_logs (không có cột `reported_by` trên equipment)
`equipments` không có cột lưu "ai đã báo lỗi lần gần nhất" — chỉ có `last_issue_reported_at`/`last_issue_note` (không có user). Để notify lại đúng người đã báo (khi confirm/resolve), suy ra từ `audit_logs`:

Tổ hợp `(entityType='equipment', actionType='update', severity='WARNING')` là **duy nhất** của luồng `reportFault` — đã verify bằng cách đọc toàn bộ 4 chỗ ghi audit trong `equipment.service.ts`:
| Method | actionType | severity |
| :--- | :--- | :--- |
| `create` (dòng 163-175) | `create` | `INFO` |
| `reportFault` (dòng 313-324) | `update` | `WARNING` |
| `deleteEquipment` (dòng 414-419) | `delete` | `WARNING` |
| `assignToRoom` (dòng 625-636) | `update` | `INFO` |

→ `(actionType='update', severity='WARNING')` chỉ khớp `reportFault`, phân biệt được với `assignToRoom` (cũng `update` nhưng `INFO`). Query `audit_logs WHERE entity_type='equipment' AND entity_id=:id AND action_type='update' AND severity='WARNING' ORDER BY created_at DESC LIMIT 1` → lấy `user_id` = người report gần nhất.

---

## 1. Tổng quan Feature

| Thuộc tính | Giá trị |
| :--- | :--- |
| **Feature ID** | EQUIP-FAULT-LIFECYCLE-001 |
| **Module** | Equipment Management (`src/modules/equipment`), phụ thuộc `NotificationsModule` |
| **Primary Actor** | BUSINESS_ADMIN (nhận notify, xác nhận, xử lý xong — đổi từ SYSTEM_ADMIN, xem changelog 2026-08-20); EMPLOYEE/MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN (report — đã có ở UC-62, không đổi) |
| **Trigger** | (1) Nhân viên gọi `PATCH .../fault` có sẵn → cần notify BUSINESS_ADMIN. (2) SYSTEM_ADMIN/BUSINESS_ADMIN xác nhận lỗi thật trước khi cử người sửa. (3) SYSTEM_ADMIN/BUSINESS_ADMIN cập nhật sau khi sửa vật lý xong. |
| **Expected Output** | BUSINESS_ADMIN nhận được notification in-app khi có report mới; có endpoint xác nhận (ghi vết audit, không đổi trạng thái thiết bị); có endpoint đưa thiết bị về `healthy`/`warning` sau khi sửa xong, kèm `lastMaintenanceAt`. |
| **Pre-condition** | Thiết bị tồn tại và đang có `healthStatus != healthy` (đang có vấn đề cần xác nhận/xử lý). |
| **Related** | UC-62 (`feat-report-equipment-fault`, đã có — mở rộng, KHÔNG sửa method `reportFault` hiện có ngoài việc THÊM Phase D). Related module: `feat-room-equipment-fault-warning` (meetings), `feat-room-search-equipment-badge` (rooms) — đọc `healthStatus` do feature này duy trì. |

---

## 2. Actor & Pre-condition

### 2.1. Danh sách actor
| Actor | Vai trò trong feature | Quyền/Trách nhiệm |
| :--- | :--- | :--- |
| EMPLOYEE/MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN | Người report lỗi (đã có ở UC-62) | Gọi `PATCH .../fault`; sau feature này, được notify ngược khi lỗi mình báo được confirm/resolve. |
| SYSTEM_ADMIN, BUSINESS_ADMIN | Người xác nhận + xử lý | Gọi 2 endpoint mới; permission mới `equipment.confirm_fault`, `equipment.resolve_fault`. |

### 2.2. Role & Permission Rules
- `equipment.confirm_fault`, `equipment.resolve_fault`: seed cho `SYSTEM_ADMIN, BUSINESS_ADMIN` — mirror đúng nhóm quyền admin đang dùng cho `equipment.create/delete/assign` (KHÔNG mở cho MANAGER/EMPLOYEE, khác với `report_fault`).
- Notification chỉ gửi cho role `BUSINESS_ADMIN` (đảo ngược quyết định cũ 2026-08-20 — trước đây chỉ gửi SYSTEM_ADMIN; BA là người thực tế thao tác confirm/resolve trên FE nên nhận notify trực tiếp, SYSTEM_ADMIN không còn nhận).

### 2.3. Actor Constraints
- Actor phải đăng nhập (`JwtAuthGuard`) và có permission tương ứng (`PermissionsGuard`).
- Thiết bị phải đang ở trạng thái có vấn đề (`healthStatus != healthy`) để confirm/resolve được — nếu không, có gì để xác nhận/xử lý.

---

## 3. Endpoint

### 3.1. Endpoint 1 (SỬA — additive) — Notify khi report
Không có endpoint mới; **THÊM Phase D (notify)** vào cuối `EquipmentService.reportFault` đã có. Client-facing API không đổi.

### 3.2. Endpoint 2 (MỚI) — Xác nhận lỗi thật
```
PATCH /api/v1/equipments/:equipmentId/fault-confirmation
```
| Thuộc tính | Giá trị |
| :--- | :--- |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `equipment.confirm_fault` |
| Success status | `200 OK` |
| Handler | `EquipmentController.confirmFault` (THÊM) |
| Service | `EquipmentService.confirmFault` (THÊM) |

### 3.3. Endpoint 3 (MỚI) — Cập nhật sau khi sửa xong
```
PATCH /api/v1/equipments/:equipmentId/fault-resolution
```
| Thuộc tính | Giá trị |
| :--- | :--- |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `equipment.resolve_fault` |
| Success status | `200 OK` |
| Handler | `EquipmentController.resolveFault` (THÊM) |
| Service | `EquipmentService.resolveFault` (THÊM) |

`:equipmentId` dùng `ParseUUIDPipe` (mirror endpoint `fault` đã có).

**Route order**: cả 2 route mới đều là leaf tĩnh dưới `:equipmentId` (`/fault-confirmation`, `/fault-resolution`), không collision với `/fault` (đã có) hay `/assignment` (đã có).

---

## 4. Input DTO

### 4.1. `ConfirmEquipmentFaultDto` (mới)
| Field | Kiểu | Bắt buộc | Ràng buộc |
| :--- | :--- | :--- | :--- |
| `confirmationNote?` | string | Không | `@IsOptional @IsString @MaxLength(2000)` |

Không có field bắt buộc — hành động confirm chỉ ghi vết, note là tùy chọn để sysadmin giải thích ngắn nếu muốn.

### 4.2. `ResolveEquipmentFaultDto` (mới)
| Field (DTO) | Cột DB bị ảnh hưởng | Bắt buộc | Ràng buộc |
| :--- | :--- | :--- | :--- |
| `healthStatus` | `health_status` | **Bắt buộc** | `@IsIn(['healthy','warning'])` — `healthy` = sửa xong hoàn toàn; `warning` = tạm ổn, còn theo dõi. KHÔNG nhận `faulty/offline` (đó là report, không phải resolve) |
| `assetStatus?` | `asset_status` | Không | `@IsOptional @IsIn(['active','maintenance','retired'])` — tái dùng đúng allowlist + `resolveAssetAction()` của `reportFault` |
| `resolutionNote` | `last_issue_note` (append) | **Bắt buộc** | `@IsString @IsNotEmpty @MaxLength(2000)` — mô tả đã sửa gì |

Cả 2 DTO dùng `forbidNonWhitelisted` (ValidationPipe chuẩn dự án) → field lạ bị reject.

---

## 5. Main Flow

### 5.1. Notify khi report (Phase D của `reportFault` đã có)
1. Sau khi Phase C (audit) của `reportFault` hoàn tất (thành công hay thất bại đều không ảnh hưởng — audit đã fail-separate từ trước).
2. Resolve danh sách `userId` có role `BUSINESS_ADMIN` (raw SQL, mirror `resolveAdmins()`).
3. Load tên phòng nếu `saved.currentRoomId` có giá trị (query nhẹ `RoomEntity`).
4. Gọi `notificationsService.createNotification(...)` — **fail-separate** (try/catch riêng, không ảnh hưởng response của `reportFault`).

### 5.2. Xác nhận lỗi thật
1. Actor gửi `PATCH .../fault-confirmation` + `ConfirmEquipmentFaultDto`.
2. Guard xác thực + permission `equipment.confirm_fault`.
3. `EquipmentService.confirmFault(equipmentId, dto, userId, ipAddress)`:
   1. Load equipment → không có ⇒ 404 `EQUIPMENT_NOT_FOUND`.
   2. `healthStatus === HEALTHY` (không có gì để xác nhận) ⇒ 409 `EQUIPMENT_NO_ACTIVE_FAULT`.
   3. Ghi 1 dòng `audit_logs`: `actionType:'confirm', entityType:'equipment', entityId, userId, newValueJson:{confirmationNote, healthStatusAtConfirmation}, severity:INFO`. **KHÔNG đổi field nào trên `equipments`** (§0.2).
   4. Tìm reporter gần nhất (§0.3) → nếu có và khác actor hiện tại, notify `EQUIPMENT_FAULT_CONFIRMED` — fail-separate.
4. Trả `200` + `{success, message, data: {equipmentId, healthStatus, confirmedBy, confirmedAt}}`.

### 5.3. Cập nhật sau khi sửa xong
1. Actor gửi `PATCH .../fault-resolution` + `ResolveEquipmentFaultDto`.
2. Guard xác thực + permission `equipment.resolve_fault`.
3. `EquipmentService.resolveFault(equipmentId, dto, userId, ipAddress)`:
   1. Load equipment → không có ⇒ 404 `EQUIPMENT_NOT_FOUND`.
   2. `healthStatus === HEALTHY` ⇒ 409 `EQUIPMENT_NO_ACTIVE_FAULT` (không có gì để resolve).
   3. Snapshot `oldValue` cho audit.
   4. Transaction: set `healthStatus = dto.healthStatus`; nếu có `dto.assetStatus`, resolve qua `resolveAssetAction()` (tái dùng nguyên vẹn); set `lastMaintenanceAt = now()` (cột có sẵn, chưa nơi nào set); **giữ nguyên** `lastIssueReportedAt`/`lastIssueNote` cũ làm lịch sử.
   5. Audit fail-separate: `actionType:'update', severity:INFO` (khác `WARNING` của report — để không bị nhầm là 1 report mới khi tra cứu theo §0.3).
   6. Tìm reporter gần nhất (§0.3) → notify `EQUIPMENT_FAULT_RESOLVED` — fail-separate.
4. Trả `200` + `{success, message, data: EquipmentResponseDto}` (tái dùng, mirror `reportFault`).

---

## 6. Ngữ nghĩa cập nhật & ràng buộc giá trị

### 6.1. Confirm — không đổi trạng thái thiết bị
Confirm **chỉ ghi audit**, không set `healthStatus`/`assetStatus`/bất kỳ cột nào trên `equipments`. Đây là hành động "tôi (sysadmin) đã xem và xác nhận đúng là hỏng", tách biệt khỏi hành động sửa xong.

### 6.2. Resolve — chiều "tốt lên", đối xứng với report
`reportFault` chỉ cho chiều xấu đi (`warning/faulty/offline`); `resolveFault` chỉ cho chiều tốt lên (`healthy/warning`). Không endpoint nào cho phép set `unknown` (giá trị khởi tạo, không phải trạng thái nghiệp vụ chủ động set).

### 6.3. `lastMaintenanceAt` — set ở resolve, không set ở confirm
Đúng ngữ nghĩa "lần bảo trì/sửa gần nhất hoàn tất" — set khi **resolve** (sửa xong), không set khi **confirm** (mới chỉ xác nhận, chưa sửa).

### 6.4. Lịch sử report giữ nguyên
`resolveFault` **không xóa** `lastIssueReportedAt`/`lastIssueNote` — dùng làm lịch sử. Muốn biết "đã xử lý xong lần báo gần nhất chưa" so sánh `lastMaintenanceAt > lastIssueReportedAt`.

---

## 7. Ràng buộc trạng thái

### 7.1. Không có gì để confirm/resolve
`healthStatus === HEALTHY` → cả 2 endpoint mới đều trả 409 `EQUIPMENT_NO_ACTIVE_FAULT`. `UNKNOWN` (giá trị khởi tạo mặc định, chưa từng report) cũng chặn tương tự (coi là "không có fault active" — chỉ `warning/faulty/offline` mới coi là có fault).

### 7.2. `retired`/`lost` — không kế thừa ràng buộc của `reportFault`
`reportFault` chặn `assetStatus ∈ {retired,lost}` (409 `EQUIPMENT_NOT_REPORTABLE`) vì thiết bị đã thanh lý/mất không "báo thêm lỗi" được nữa. Với `confirmFault`/`resolveFault`, **không áp dụng ràng buộc này** — vẫn có thể confirm/resolve một fault đã tồn tại trước khi thiết bị bị retired (dữ liệu lịch sử), miễn `healthStatus != healthy`. Nếu `dto.assetStatus` của `resolveFault` set `retired`, cho phép (đó chính là kết luận "thiết bị hỏng không sửa được, thanh lý luôn" — hợp lý).

---

## 8. Permission / RBAC

| permission_code | module_code | action_code | roles |
| :--- | :--- | :--- | :--- |
| `equipment.confirm_fault` | `equipment` | `confirm_fault` | `SYSTEM_ADMIN, BUSINESS_ADMIN` |
| `equipment.resolve_fault` | `equipment` | `resolve_fault` | `SYSTEM_ADMIN, BUSINESS_ADMIN` |

Seed **BẮT BUỘC đặt trong `src/database/migrations/`** (không phải `src/database/seeds/` — folder đó không có runner, đã verify không permission nào trong đó thực sự có hiệu lực trên DB thật trừ khi có migration tương ứng backfill, giống trường hợp `equipment.report_fault` đã xảy ra).

---

## 9. Audit logging

| Hành động | `actionType` | `severity` | Field đổi trên `equipments` |
| :--- | :--- | :--- | :--- |
| Report (đã có) | `update` | `WARNING` | `healthStatus?`, `assetStatus?`, `lastIssueReportedAt`, `lastIssueNote` |
| Confirm (mới) | `confirm` | `INFO` | *(không đổi field nào)* |
| Resolve (mới) | `update` | `INFO` | `healthStatus`, `assetStatus?`, `lastMaintenanceAt` |

Cả 3 đều audit **fail-separate** (transaction riêng, `try/catch`, `logger.error`, không rollback nghiệp vụ chính).

---

## 10. Ranh giới feature

| Việc | Thuộc feature nào | Feature này làm? |
| :--- | :--- | :--- |
| Report lỗi (set warning/faulty/offline) | UC-62 (đã có) | ❌ (không sửa, chỉ thêm Phase D) |
| Notify BUSINESS_ADMIN khi có report | **EQUIP-FAULT-LIFECYCLE-001** | ✅ |
| Xác nhận lỗi thật | **EQUIP-FAULT-LIFECYCLE-001** | ✅ |
| Cập nhật sau khi sửa xong (recovery) | **EQUIP-FAULT-LIFECYCLE-001** | ✅ |
| Cảnh báo khi đặt phòng có thiết bị hỏng | `feat-room-equipment-fault-warning` (meetings) | ❌ |
| Badge thiết bị hỏng khi tìm phòng | `feat-room-search-equipment-badge` (rooms) | ❌ |
| WebSocket push real-time cho sysadmin | Ngoài phạm vi (chốt với PO — chỉ in-app inbox) | ❌ |
| Gỡ thiết bị khỏi phòng (`currentRoomId=null`) | UC-65 (phân bổ, đã có) | ❌ |

---

## 11. Điểm đã chốt (không mở lại — đã duyệt qua EnterPlanMode với PO)

| # | Vấn đề | Chốt |
| :--- | :--- | :--- |
| C1 | Lưu trạng thái "đã xác nhận" ở đâu | Chỉ `audit_logs`, KHÔNG thêm cột |
| C2 | Booking gate chặn mức độ nào | (thuộc spec khác) chỉ `faulty/offline` |
| C3 | Notification gửi role nào | Chỉ `BUSINESS_ADMIN` (đảo ngược 2026-08-20, xem changelog — trước đó là `SYSTEM_ADMIN`) |
| C4 | Real-time WebSocket push | KHÔNG — chỉ in-app inbox |
| C5 | Permission confirm/resolve — role nào | `SYSTEM_ADMIN, BUSINESS_ADMIN` (mirror `create/delete/assign`) |
| C6 | `lastMaintenanceAt` set khi nào | Chỉ khi `resolveFault`, không set ở `confirmFault` |
| C7 | Xóa `lastIssueReportedAt/Note` khi resolve? | KHÔNG — giữ làm lịch sử |
| C8 | `retired/lost` có chặn confirm/resolve? | KHÔNG (khác `reportFault`) — xem §7.2 |

---

## 12. Functional Requirements

- **FR-01**: Khi `reportFault` thành công, hệ thống tạo 1 notification in-app cho toàn bộ user có role `BUSINESS_ADMIN`.
- **FR-02**: Notify thất bại KHÔNG ảnh hưởng response thành công của `reportFault` (fail-separate).
- **FR-03**: Cung cấp `PATCH /api/v1/equipments/:equipmentId/fault-confirmation`, chỉ user có `equipment.confirm_fault` được gọi.
- **FR-04**: Confirm ghi đúng 1 dòng `audit_logs` (`actionType='confirm'`), KHÔNG đổi field nào trên `equipments`.
- **FR-05**: Thiết bị `healthStatus=healthy` → confirm/resolve đều trả 409 `EQUIPMENT_NO_ACTIVE_FAULT`.
- **FR-06**: Cung cấp `PATCH /api/v1/equipments/:equipmentId/fault-resolution`, chỉ user có `equipment.resolve_fault` được gọi.
- **FR-07**: Resolve set `healthStatus ∈ {healthy,warning}`, tùy chọn `assetStatus`, luôn set `lastMaintenanceAt=now`, giữ nguyên `lastIssueReportedAt/lastIssueNote`.
- **FR-08**: Sau confirm/resolve, nếu tìm được reporter gần nhất (qua audit_logs §0.3) và khác actor hiện tại, hệ thống tạo notification cho reporter đó.
- **FR-09**: Thiết bị không tồn tại → 404 `EQUIPMENT_NOT_FOUND` (cả 2 endpoint mới).
- **FR-10**: Chưa đăng nhập → 401; thiếu permission → 403 (cả 2 endpoint mới).

## 13. Non-Functional Requirements

- **NFR-01**: Notify/audit fail-separate — không rollback nghiệp vụ chính (đúng pattern `reportFault` Phase C đã có).
- **NFR-02**: DTO validate ở boundary (`whitelist+forbidNonWhitelisted+transform`), đúng CLAUDE.md §13.
- **NFR-03**: Không thêm bảng/cột DB mới (CLAUDE.md §5.4, §0.2).
- **NFR-04**: Tái dùng `resolveAssetAction()`, `EquipmentResponseDto`, pattern `resolveAdmins()`/`createNotification()` có sẵn — không viết lại logic đã tồn tại.
- **NFR-05**: `EquipmentModule` import `NotificationsModule` — không tạo circular dependency (đã verify: `NotificationsModule` không import ngược `EquipmentModule`, chỉ export `TypeOrmModule` + `NotificationsService`).

## 14. Acceptance Criteria

- **AC-01**: EMPLOYEE gọi `PATCH .../fault` thành công → có 1 bản ghi `notifications` mới, `recipient_user_ids_json` chứa đúng toàn bộ userId role BUSINESS_ADMIN.
- **AC-02**: SYSTEM_ADMIN gọi `PATCH .../fault-confirmation` với thiết bị đang `faulty` → 200, có 1 dòng `audit_logs` mới (`actionType='confirm'`), `equipments.health_status` KHÔNG đổi.
- **AC-03**: Gọi `fault-confirmation` khi thiết bị đang `healthy` → 409 `EQUIPMENT_NO_ACTIVE_FAULT`.
- **AC-04**: SYSTEM_ADMIN gọi `PATCH .../fault-resolution` với `healthStatus=healthy` → 200, `data.healthStatus='healthy'`, `lastMaintenanceAt` được set, `lastIssueNote` cũ vẫn còn.
- **AC-05**: Người đã report (khác actor confirm/resolve) nhận được notification `EQUIPMENT_FAULT_CONFIRMED`/`EQUIPMENT_FAULT_RESOLVED` tương ứng.
- **AC-06**: EMPLOYEE (không có `equipment.confirm_fault`/`equipment.resolve_fault`) gọi 2 endpoint mới → 403.
- **AC-07**: Audit ghi lỗi (giả lập DB fail) → confirm/resolve/report vẫn trả 200 (fail-separate, không rollback).

## 15. Exception / Alternative Flows

- **EC-01**: 404 thiết bị không tồn tại (cả 2 endpoint mới).
- **EC-02**: 409 `EQUIPMENT_NO_ACTIVE_FAULT` khi `healthStatus=healthy`.
- **EC-03**: 422 giá trị enum ngoài allowlist (`healthStatus` resolve nhận `faulty/offline` → reject ở DTO).
- **EC-04**: Notify thất bại (BUSINESS_ADMIN rỗng, hoặc `createNotification` throw) → log warning, KHÔNG ảnh hưởng response chính.
- **EC-05**: Không tìm được reporter gần nhất (report đầu tiên bị audit ghi lỗi trước đó, hoặc dữ liệu cũ) → bỏ qua bước notify reporter, không lỗi.

---

## 16. [Missing] — Tóm tắt cần làm

**Trạng thái: [Missing]** — 3 việc đều chưa tồn tại trong code.

Danh mục triển khai (ở plan/tasks sau, KHÔNG làm trong spec này):
1. THÊM `NotificationType.EQUIPMENT_FAULT_REPORTED/CONFIRMED/RESOLVED` vào `notification.entity.ts`.
2. THÊM `NotificationsModule` vào `equipment.module.ts` imports.
3. THÊM Phase D (notify) vào `EquipmentService.reportFault`.
4. TẠO `EquipmentService.confirmFault`, `resolveFault`, helper `findLastFaultReportAuditLog`.
5. TẠO `ConfirmEquipmentFaultDto`, `ResolveEquipmentFaultDto`, response DTO nhẹ cho confirm.
6. TẠO 2 handler controller mới + seed permission migration (KHÔNG execute trong lúc spec/plan/tasks, chỉ tạo file).
7. Test service + controller cho 2 action mới + Phase D notify.

**Ranh giới**: KHÔNG sửa `reportFault` ngoài việc THÊM Phase D. KHÔNG đụng `create`/`deleteEquipment`/`assignToRoom`/`listEquipments`. KHÔNG migration DB schema (chỉ migration permission — không đổi bảng `equipments`). KHÔNG implement booking gate hay room search badge (2 spec riêng).
