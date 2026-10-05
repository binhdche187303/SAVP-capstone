# Tasks — BE-03 PATCH /api/v1/meetings/{meetingId}

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo tasks lần đầu, đối chiếu `PLAN_THUC_THI_P0_CODE_VA_SPEC_2026-07-26.md` (T-5.1 → T-5.11) | Toàn bộ file |

---

| ID | Việc | File | Trạng thái |
| :-- | :-- | :-- | :-- |
| T-5.1 | Tạo `UpdateMeetingDto` (title?/description?, chặn body rỗng ở service) | `src/modules/meetings/dto/update-meeting.dto.ts` | ✅ Xong |
| T-5.2 | Tạo `UpdateMeetingResponseDto` | `src/modules/meetings/dto/update-meeting-response.dto.ts` | ✅ Xong |
| T-5.3 | Tạo `MeetingUpdateService` (ownership check mirror `meeting.cancel.own`, chặn cancelled/completed, transaction + `meeting_events`) | `src/modules/meetings/services/meeting-update.service.ts` | ✅ Xong |
| T-5.4 | Unit test: không phải organizer → 403; đã hủy/kết thúc → 409; chỉ gửi title → chỉ title đổi; body rỗng → 400 | `src/modules/meetings/services/meeting-update.service.spec.ts` | ✅ Xong (10 test) |
| T-5.5 | `@Patch('meetings/:meetingId')`, permission `meeting.update.own`, OpenAPI đầy đủ | `src/modules/meetings/controllers/meetings.controller.ts` | ✅ Xong |
| T-5.6 | Đăng ký `MeetingUpdateService` | `src/modules/meetings/meetings.module.ts` | ✅ Xong |
| T-5.7 | Migration seed `meeting.update.own` (role mapping giống `meeting.cancel.own`) | `src/database/migrations/20260726000004-SeedMeetingUpdateOwnPermission.ts` | ✅ Xong |
| T-5.8 | Tạo `spec.md` (mục "Ngoài phạm vi" liệt kê rõ endpoint chuyên trách cho time/room/participants/agenda/recording + cảnh báo `forbidNonWhitelisted`) | `spec/features/meeting/feat-update-meeting-metadata/spec.md` | ✅ Xong |
| T-5.9 | Tạo `plan.md` | `spec/features/meeting/feat-update-meeting-metadata/plan.md` | ✅ Xong |
| T-5.10 | Tạo `tasks.md` (file này) | `spec/features/meeting/feat-update-meeting-metadata/tasks.md` | ✅ Xong |
| T-5.11 | Thêm UC mới `PATCH /api/v1/meetings/{meetingId}` vào `API_CONTRACT_v1.0_with_system_roles.md` (mã UC-18b, sau UC-18) | `docs/API_CONTRACT_v1.0_with_system_roles.md` | ✅ Xong |

**Extra (phát sinh khi code, không có trong plan gốc):**
- Thêm `MeetingEventType.METADATA_UPDATED = 'metadata_updated'` vào `meeting-event.entity.ts` — không có giá trị enum sẵn có phù hợp cho sự kiện "sửa title/description" (không có migration vì cột `event_type` là `varchar`, không CHECK constraint).
- Đổi constructor `MeetingsController` (thêm `MeetingUpdateService`, tham số thứ 5) làm gãy lại 2 file test đã sửa ở BE-02 (`update-agenda-item.controller.spec.ts`, `delete-agenda-item.controller.spec.ts`) — đã thêm thêm 1 dòng mock provider vào cả 2 file.
