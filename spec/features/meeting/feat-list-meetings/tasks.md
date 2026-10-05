# Tasks — BE-02 GET /api/v1/meetings

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo tasks lần đầu, đối chiếu `PLAN_THUC_THI_P0_CODE_VA_SPEC_2026-07-26.md` (T-4.1 → T-4.12) | Toàn bộ file |

---

| ID | Việc | File | Trạng thái |
| :-- | :-- | :-- | :-- |
| T-4.1 | Tạo `MeetingListQueryDto` (page/limit/sortBy allowlist/sortOrder/status/roomId/organizerId/from/to/search) | `src/modules/meetings/dto/meeting-list-query.dto.ts` | ✅ Xong |
| T-4.2 | Tạo `MeetingListItemDto` | `src/modules/meetings/dto/meeting-list-item.dto.ts` | ✅ Xong |
| T-4.3 | Tạo `MeetingListService` (service riêng, QueryBuilder + parameter binding) | `src/modules/meetings/services/meeting-list.service.ts` | ✅ Xong |
| T-4.4 | Unit test: phân trang, filter, allowlist chặn `sortBy` lạ, `from > to` | `src/modules/meetings/services/meeting-list.service.spec.ts` | ✅ Xong (13 test) |
| T-4.5 | Thêm `@Get('meetings')` trước `@Get('meetings/:meetingId')`, permission `meeting.read.all`, response `{success,message,data,meta}` | `src/modules/meetings/controllers/meetings.controller.ts` | ✅ Xong |
| T-4.6 | Đăng ký `MeetingListService` | `src/modules/meetings/meetings.module.ts` | ✅ Xong |
| T-4.7 | Re-check số migration mới nhất ngay trước khi tạo file | `src/database/migrations` | ✅ Đã re-check, mới nhất là `20260726000002` |
| T-4.8 | Migration seed `meeting.read.all` → `BUSINESS_ADMIN`, `SYSTEM_ADMIN` | `src/database/migrations/20260726000003-SeedMeetingReadAllPermission.ts` | ✅ Xong |
| T-4.9 | Tạo `spec.md` | `spec/features/meeting/feat-list-meetings/spec.md` | ✅ Xong |
| T-4.10 | Tạo `plan.md` | `spec/features/meeting/feat-list-meetings/plan.md` | ✅ Xong |
| T-4.11 | Tạo `tasks.md` (file này) | `spec/features/meeting/feat-list-meetings/tasks.md` | ✅ Xong |
| T-4.12 | Thêm UC mới `GET /api/v1/meetings` vào `API_CONTRACT_v1.0_with_system_roles.md` (trước UC-18, mã UC-17b) | `docs/API_CONTRACT_v1.0_with_system_roles.md` | ✅ Xong |

**Extra (phát sinh khi code, không có trong plan gốc):**
- Đổi constructor `MeetingsController` (thêm `MeetingListService`) làm gãy 2 file test có sẵn (`update-agenda-item.controller.spec.ts`, `delete-agenda-item.controller.spec.ts`) do chúng tự dựng `TestingModule` với danh sách provider cứng. Đã thêm `{ provide: MeetingListService, useValue: {} }` vào cả 2 file để phục hồi — xác nhận bằng cách chạy lại `npx jest src/modules/meetings` và so khớp số fail với baseline T-1.5 trước/sau.
