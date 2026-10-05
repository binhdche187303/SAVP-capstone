# FA-RSV-001 — BE-10: Resolve stranger alert — ĐÓNG bằng endpoint sẵn có (không code mới)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | Tạo spec BE-10 (PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md §0.1, §6A). KHÔNG code — chỉ tài liệu hướng dẫn đóng mục theo hướng dùng endpoint có sẵn. | Toàn bộ |

## 1. Vì sao BE-10 KHÔNG thể implement như plan trưởng nhóm mô tả

Plan trưởng nhóm gốc (`PLAN_SUA_BE_cho_Tai_2026-07-26.md`) viết: *"`PATCH /face-access/stranger-alerts/:id/resolve`, DTO `{ note? }`, ghi `resolved_by/resolved_at`"*.

Đọc code thật `src/modules/face-access/services/stranger-alert.service.ts:176-213` — method `list()` (dùng cho `GET /face-access/stranger-alerts`) là **query `GROUP BY` động** trên `iot_device_events`:

```sql
SELECT e.device_id,
       e.payload_json->'extracted_fields'->>'stranger_id' AS stranger_id,
       MAX(e.created_at) AS last_seen,
       COUNT(*)::int AS hit_count,
       ...
  FROM iot_device_events e
 WHERE e.event_type = 'face_stranger'
   AND e.created_at >= now() - ($1 * interval '1 minute')
 GROUP BY e.device_id, stranger_id
```

**Hệ quả:**
- Không có bảng `stranger_alerts` — mỗi "dòng" trả về là kết quả GROUP BY, không phải bản ghi thật.
- Không có `id` ổn định để `PATCH .../:id/resolve` nhắm vào — `device_id`+`stranger_id` không phải khóa duy nhất bất biến (thay đổi theo cửa sổ thời gian `windowMinutes` truyền vào).
- Không có cột `resolved_by`/`resolved_at` ở đâu để ghi.

→ **Không thể** viết endpoint `PATCH /face-access/stranger-alerts/:id/resolve` đúng như mô tả — sẽ phải "resolve" một dòng không tồn tại thật trong DB.

## 2. Hạ tầng ĐÚNG đã có sẵn — dùng lại, không code mới

`stranger-alert.service.ts:87` (`recordAlert()`, gọi trong `handleStrangerEvent`) đã đẩy MỌI stranger event vào bảng `security_alerts` thật (qua `AlertsService.recordAlert({alertType: 'stranger', ...})`), thuộc hạ tầng UC-123 (Trung tâm cảnh báo an ninh, đã code + có bảng thật, Bước 3 SAVP).

`alerts.controller.ts` (`@Controller('security-alerts')`) đã có sẵn:
- `POST /security-alerts/:id/acknowledge` (`:69`, permission `security_alert.acknowledge`)
- `POST /security-alerts/:id/resolve` (`:82-93`, permission `security_alert.resolve`, body `ResolveSecurityAlertDto`, gọi `AlertsService.resolve(id, dto, userId)`) — **endpoint này CHÍNH LÀ thứ BE-10 cần**, vì stranger alert đã nằm trong `security_alerts` (có `id` UUID thật, `resolved_by`/`resolved_at` thật) từ khi `recordAlert()` chạy.

## 3. Quyết định — ĐÓNG mục, không viết endpoint mới

**BE-10 đóng bằng cách trỏ FE sang `POST /api/v1/security-alerts/{id}/resolve` sẵn có.** Không có file `.ts` nào được tạo/sửa ở phía BE cho mục này.

### Việc cần Nam làm (FE)

`businessAdminServices.js:190-194` hiện có:
```js
// NOTE: BE chưa có endpoint PATCH /face-access/stranger-alerts/:id/resolve
export const resolveStrangerAlert = async (alertId, data) => {
    return await patch(`/face-access/stranger-alerts/${alertId}/resolve`, data);
};
```

Cần đổi thành gọi `POST /api/v1/security-alerts/{id}/resolve` — **nhưng lưu ý `id` ở đây phải là `security_alerts.id` (UUID thật)**, không phải `device_id`/`stranger_id` như danh sách `GET /face-access/stranger-alerts` hiện trả về. Nếu màn Business Admin cần resolve trực tiếp từ danh sách stranger alert, Nam nên đổi màn sang gọi `GET /security-alerts?alert_type=stranger` (danh sách đã có `id` thật) thay vì `GET /face-access/stranger-alerts` (view tổng hợp, không có `id` ổn định) — hoặc giữ 2 màn tách biệt tuỳ UX team muốn.

### Ghi nhận thêm — bug đã fix trước đó

Bug `role_code='admin'` (chữ thường, không khớp 4 role thật của hệ thống) từng khiến `resolveAdmins()` không tìm được ai để gửi notification — **đã được fix** trước đợt P1 này: `stranger-alert.service.ts:167` nay dùng `WHERE r.role_code IN ('SYSTEM_ADMIN', 'BUSINESS_ADMIN')` (đã verify trực tiếp code, không phải suy đoán). `LO_TRINH_SAVP_TAI.md` mục 8 "Việc cần phối hợp" đóng theo (xem T-6.3).

## 4. Constitution

- **NO-SCOPE-01**: Không tạo bảng `stranger_alerts`, không tạo entity/migration mới.
- **DOC-01**: Đóng mục bằng ghi chú tài liệu (spec này + `docs/API_CONTRACT_v1.0_with_system_roles.md` + `LO_TRINH_SAVP_TAI.md`), không phải bằng code.

## 5. Residuals / known-gaps

- Danh sách `GET /face-access/stranger-alerts` (view tổng hợp GROUP BY) và danh sách `GET /security-alerts?alert_type=stranger` (bảng thật, có `id`) là **2 nguồn dữ liệu khác nhau về hình dạng** dù cùng phản ánh cùng một luồng sự kiện — nếu FE muốn UX liền mạch (xem danh sách rồi resolve ngay), Nam cần quyết định dùng nguồn nào làm danh sách chính. Ngoài phạm vi BE-10 (chỉ đóng phần "resolve"), cần bàn riêng nếu team muốn hợp nhất 2 view.
