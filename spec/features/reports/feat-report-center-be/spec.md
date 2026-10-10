# Feature Specification: Backend Trung tâm báo cáo và lịch gửi tự động (2.13)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-10-09 | Tạo spec lần đầu sau khi mockup FE đã được duyệt và đưa lên `main`. Báo cáo chuyên cần sinh viên hoãn theo quyết định của LamNH (§0.1). | Toàn bộ file |

---

- **Feature ID**: RPT-CENTER-BE-001
- **Feature Name**: Backend Trung tâm báo cáo, xuất PDF/Excel/Word, lịch gửi tự động
- **Phân hệ tài liệu khách hàng**: 2.13 (checklist STT 72–80)
- **Module / Domain**: `reports` (mở rộng); chạm nhẹ `notifications`, `scheduler`
- **Created Date**: 2026-10-09
- **Status**: Draft, chờ LamNH duyệt
- **Source Documents**:
  - `spec/features/visitor-reports/feat-visitor-report-ui-mockup/spec.md` §4.2, §6.4, §7 — định nghĩa 7 báo cáo và quy tắc lịch gửi đã duyệt qua mockup
  - FE `src/config/reportDefinitions.js` — khóa bộ lọc, KPI, biểu đồ, cột của từng loại (hợp đồng dữ liệu)
  - FE `src/service/reportCenterService.js`, `src/mocks/visitorReport/scheduleNextRun.js` + test
  - `spec/features/reports/uc127-gate-access-export/spec.md` và 4 spec xuất báo cáo cùng thư mục — khuôn job xuất hiện có
  - `spec/features/visitors/feat-visitor-management-be/spec.md` — nguồn dữ liệu của báo cáo khách
  - `spec/global/constitution.md`

---

## 0. RECON — quyết định đã chốt và dữ kiện từ codebase

### 0.1. Quyết định của LamNH (2026-10-09)

| # | Quyết định |
|---|---|
| D1 | **Báo cáo chuyên cần sinh viên hoãn** tới khi phân hệ 2.7 có bảng điểm danh theo buổi. Đợt này làm 6 loại; loại sinh viên có mặt trong danh mục với `available: false`. |
| D2 | Quy tắc chuyên cần cán bộ chưa được khách hàng chốt: dùng mặc định của mockup, đưa vào cấu hình. |
| D3 | Plan kết thúc bằng mốc nối FE cho phân hệ Báo cáo. |

### 0.2. Dữ kiện từ codebase

| # | Dữ kiện | Nguồn | Hệ quả thiết kế |
|---|---|---|---|
| F1 | 5 báo cáo đã có luồng xuất: tạo `background_jobs` → hàng đợi `report-export` → worker → `media_files` → FE hỏi `GET /background-jobs/:id` rồi tải file. Chỉ PDF/XLSX (riêng phòng họp có CSV). | `reports/services/gate-access-report.service.ts`, `processors/*` | Giữ nguyên luồng và 5 endpoint cũ; phần mới đi cùng khuôn. |
| F2 | Hàng đợi `report-export` chỉ có **một** `@Processor` (`MeetingActivityReportWorkerProcessor`) phân nhánh theo `job.name`. | `processors/meeting-activity-report-worker.processor.ts:55-110` | Job mới thêm một nhánh `job.name`, không đăng ký processor thứ hai. |
| F3 | Mỗi báo cáo hiện có renderer riêng (PDF, XLSX). Không có renderer Word cho báo cáo; `docx` đã cài và đang dùng cho biên bản họp. | `reports/renderers/*`, `minutes/renderers/meeting-minutes-docx-renderer.ts` | Viết **ba renderer dùng chung** trên một "mô hình báo cáo" thay vì 7×3 renderer. |
| F4 | Chưa có API trả dữ liệu báo cáo để xem trên màn hình. | — | Thêm API xem trước, đồng bộ, có phân trang. |
| F5 | DTO xuất cũ nhận `scope` lồng nhau (`{ zoneId, departmentId, userId }`); FE mới gửi bộ lọc phẳng theo khóa của `reportDefinitions.js`. | `reports/dto/*.ts` | API mới nhận bộ lọc phẳng; không đổi DTO cũ. |
| F6 | Phạm vi theo vai trò đã có quy tắc: quản trị không giới hạn; MANAGER chỉ đơn vị mình quản lý (`departments.manager_user_id`). | `gate-access-report.service.ts:165-232` | Tách quy tắc này thành một service dùng chung cho xem trước và xuất. |
| F7 | Giới hạn kỳ báo cáo lấy từ `DashboardOverviewConfigService.getMaxRangeDays()`. | `analytics/services/dashboard-overview-config.service.ts` | Dùng lại. |
| F8 | Worker email chỉ đính kèm **một** file (`attachment` đơn). | `notifications/notification-worker.service.ts:108-124` | Lịch gửi nhiều định dạng cần mở rộng thành `attachments[]`, giữ tương thích trường cũ. |
| F9 | Không có khái niệm lịch làm việc. Sự kiện khuôn mặt nằm ở `iot_device_events` (`event_type='ivss_face_event'`, `payload_json->>'userId'`); lượt xe có chủ nằm ở `gate_access_logs.user_id`. | `ivss-presence-ingestion.service.ts:232-250`, `zones/entities/gate-access-log.entity.ts` | Chuyên cần cán bộ = lần thấy đầu và cuối trong ngày từ hai nguồn này, so với giờ làm cấu hình. |
| F10 | Phiên ra vào cổng đã có câu CTE ghép cặp vào/ra, và quy tắc "phiên chưa hoàn tất không tính vào báo cáo chính thức". | `gate-access/services/gate-access-history.service.ts:39`, `reports/services/gate-access-report-data.service.ts` | Xem trước và xuất dùng đúng CTE và quy tắc đó. |
| F11 | Cron đặt trong `SchedulerService`, có cờ env riêng từng nhóm. | `scheduler/scheduler.service.ts` | Lịch gửi thêm một cron và cờ `SCHEDULER_REPORT_SCHEDULE_ENABLED`. |

## 1. Mục tiêu và tiêu chí thành công

**Mục tiêu:** thay lớp dữ liệu giả của Trung tâm báo cáo bằng BE thật cho 6 loại báo cáo, có xuất ba định dạng và lịch gửi tự động.

**Thành công khi:**
1. Với cờ mock tắt, bốn màn S8–S11 chạy trên dữ liệu thật cho 6 loại; loại sinh viên hiện thông báo "chờ phân hệ điểm danh phòng học".
2. Mỗi loại xem được KPI, hai biểu đồ, bảng phân trang; phản hồi xem trước dưới 2 giây với kỳ 31 ngày trên dữ liệu cỡ bench (ARCH-02).
3. Mỗi loại xuất được PDF, Excel, Word qua job; file mở được; kỳ không có dữ liệu vẫn ra file hợp lệ.
4. Lịch gửi chạy đúng giờ Việt Nam, gửi một email kèm đủ các file đã chọn, ghi lịch sử từng lần chạy; lần lỗi có lý do và gửi lại được.
5. Hai instance BE chạy song song không gửi trùng một lần chạy.
6. Năm endpoint xuất cũ và các màn đang dùng chúng không đổi hành vi.

## 2. Phạm vi

**Trong phạm vi:** API danh mục, tra cứu, xem trước; báo cáo chuyên cần cán bộ và báo cáo khách (mới); xem trước cho 4 loại đã có; xuất chung ba định dạng; file xuất gần đây; lịch gửi và lịch sử chạy; quyền; nối FE.

**Ngoài phạm vi:** báo cáo chuyên cần sinh viên; biểu mẫu riêng của trường (quốc hiệu, chữ ký); ngày nghỉ lễ và ca kíp trong chuyên cần cán bộ; sửa 5 endpoint xuất cũ; xuất CSV cho loại mới.

## 3. Kiến trúc

```
FE (reportCenterService)
   │
   ▼
ReportCenterController ── catalog · lookups · :type/preview · :type/exports · exports/recent
ReportScheduleController ── CRUD · toggle · duplicate · run-now      ReportScheduleRunController ── list · retry · file
   │
   ▼
ReportScopeService (phạm vi theo vai trò)     ReportDefinitionRegistry (6 loại)
   │                                                │ mỗi loại: ReportProvider { validateFilters, build(filters, scope, page?) → ReportModel }
   ▼                                                ▼
ReportCenterExportService ─▶ hàng đợi report-export ─▶ ReportCenterWorker ─▶ renderer chung (pdf · xlsx · docx) ─▶ media_files
ReportScheduleService ─▶ cron report-schedule-dispatch ─▶ job report-schedule:run ─▶ worker ─▶ NotificationsService (email nhiều tệp)
```

**Mô hình báo cáo** là cấu trúc trung gian duy nhất giữa dữ liệu và trình bày, giống hệt cái mockup đang dùng:

```ts
interface ReportModel {
  type: string; title: string;
  period: { from: string; to: string };
  filterLines: string[];                       // "Đơn vị: Khoa CNTT"
  kpis: { key: string; label: string; value: number; format: string }[];
  charts: { key: string; data: Record<string, unknown>[] }[];
  columns: { key: string; label: string; format: string }[];
  rows: Record<string, unknown>[];
  total: number;
}
```

Mỗi loại báo cáo là một `ReportProvider`. Xem trước gọi `build` có phân trang; xuất gọi `build` không phân trang. Ba renderer chỉ biết `ReportModel`.

Khóa KPI, biểu đồ, cột của từng loại phải trùng `reportDefinitions.js` của FE; có test hợp đồng kiểm việc này.

## 4. Sáu loại báo cáo

Bộ lọc chung: `from`, `to` (`YYYY-MM-DD`, cả hai đầu, theo ngày Việt Nam), `q`, `page`, `limit` (tối đa 100), `sortKey`, `sortDir`.

| Loại | Nguồn dữ liệu | Bộ lọc riêng | Ghi chú |
|---|---|---|---|
| `staff-attendance` | lần thấy đầu/cuối mỗi ngày của từng cán bộ, gộp từ `iot_device_events` (khuôn mặt) và `gate_access_logs` (xe có chủ) | `departmentId`, `staffId` | Quy tắc ở §4.1. Mới. |
| `gate-access` | CTE phiên ra vào (F10), chỉ phiên hoàn tất; "đang trong khuôn viên" đếm riêng phiên mở của hôm nay | `zoneId`, `departmentId`, `subjectType` | `subjectType` suy từ role/đơn vị: cán bộ, sinh viên (role STUDENT), khách (đơn vị VISITOR), vãng lai (không có `user_id`). |
| `room-utilization` | các hàm của `RoomUtilizationReportDataService` | `building`, `roomId` | Dùng lại số liệu đã có. |
| `vehicle` | CTE phiên ra vào có biển số + `vehicle_registrations` + danh sách kiểm soát xe | `zoneId`, `vehicleType`, `registrationStatus` | Cờ danh sách kiểm soát dùng `control-list-flag.sql.ts` sẵn có. |
| `visitor` | `visitor_visits` (spec VIS-BE-001) | `departmentId`, `purpose`, `status` | KPI dùng chung hàm với `GET /visitors/stats` để hai nơi luôn khớp. |
| `security-alert` | `security_alerts` qua `SecurityAlertReportDataService` | `alertType`, `severity`, `zoneId`, `status` | Thêm ba loại cảnh báo khách vào danh sách lựa chọn. |
| `student-attendance` | — | — | Danh mục trả `available: false`, `unavailableReason`. Xem trước và xuất trả 409 `REPORT_NOT_AVAILABLE`. |

### 4.1. Chuyên cần cán bộ

**Đối tượng:** user `employment_status` đang làm việc, không thuộc đơn vị PARTNER/VISITOR, không có role STUDENT.

**Quy tắc** (cấu hình `report.staff_attendance.rules`, mặc định theo mockup):

| Khóa | Mặc định |
|---|---|
| `workStart` / `workEnd` | `08:00` / `17:00` |
| `graceMinutes` | `15` |
| `workdays` | `[1,2,3,4,5]` (thứ Hai–thứ Sáu) |
| `timezone` | `Asia/Ho_Chi_Minh` |

Với mỗi cán bộ và mỗi ngày làm việc trong kỳ: không có lần thấy nào → **vắng**; lần thấy đầu sau `workStart + graceMinutes` → **đi muộn**; lần thấy cuối trước `workEnd` → **về sớm**; còn lại → **đúng giờ**. Giờ hiện diện = lần cuối − lần đầu. Ngày chưa kết thúc (hôm nay) không tính về sớm và không tính vắng trước `workEnd`.

Truy vấn gộp theo `(user_id, ngày)` ở DB, không kéo sự kiện thô về ứng dụng. Thêm chỉ mục biểu thức một phần trên `iot_device_events ((payload_json->>'userId'), event_time) WHERE event_type = 'ivss_face_event' AND payload_json->>'userId' IS NOT NULL`; trên production tạo bằng `CREATE INDEX CONCURRENTLY` trước khi chạy migration.

Hạn chế ghi rõ trong phản hồi (`notes[]`) và trong file xuất: chưa trừ ngày nghỉ lễ, nghỉ phép; cán bộ không có ảnh khuôn mặt đã duyệt và không có xe đăng ký sẽ luôn hiện vắng.

## 5. Xuất file

`POST /reports/:type/exports` với `{ format: 'pdf'|'xlsx'|'docx', from, to, ...bộ lọc phẳng }` → 202 `{ jobId, status: 'queued' }`. Job `export:report-center` trên hàng đợi `report-export`; `background_jobs.related_entity_type = 'report_center'`, `input_json` giữ loại, định dạng, bộ lọc, phạm vi đã phân giải.

| Định dạng | Renderer chung | Nội dung |
|---|---|---|
| PDF | `pdfkit`, phông Việt qua `pdf-font.util.ts`, khổ A4 ngang | tiêu đề, kỳ, bộ lọc, bảng KPI, bảng dữ liệu có lặp tiêu đề cột qua trang |
| Excel | `exceljs`, 2 sheet "Tổng hợp" và "Dữ liệu" | số là số, ngày giờ là ngày giờ (không phải chuỗi) |
| Word | `docx` | cùng bố cục với PDF, bảng thật của Word |

Kỳ không có dữ liệu: vẫn tạo file với dòng "Không có dữ liệu trong kỳ đã chọn" (giữ quyết định §0.1 của UC-127). Quá `report.export_max_rows` (mặc định 50 000) thì job thất bại với thông điệp yêu cầu thu hẹp kỳ.

`GET /reports/exports/recent` trả 10 job `report_center` gần nhất của người đang đăng nhập kèm `outputFileId`; FE tải qua endpoint tải file bảo mật sẵn có của `media-files`.

## 6. Lịch gửi tự động

### 6.1. Bảng

**`report_schedules`**: `id`, `name` varchar(150), `report_type` varchar(40), `filters_json` jsonb, `period` (`yesterday`/`last_week`/`last_month`), `frequency` (`daily`/`weekly`/`monthly`), `send_time` time, `day_of_week` smallint NULL (0–6), `day_of_month` smallint NULL (1–28), `last_day_of_month` boolean, `formats` text[] , `recipients_json` jsonb (`[{ type:'user'|'email', value, label }]`), `subject`, `message`, `enabled` boolean, `next_run_at` timestamptz NULL, `last_run_at` timestamptz NULL, `owner_user_id` → users, `created_at`, `updated_at`, `deleted_at`. Chỉ mục một phần `(next_run_at) WHERE enabled AND deleted_at IS NULL`.

**`report_schedule_runs`**: `id`, `schedule_id` → report_schedules, `schedule_name`, `report_type`, `trigger` (`scheduled`/`manual`), `status` (`queued`/`running`/`success`/`failed`), `scheduled_for` timestamptz NULL, `period_from`, `period_to` date, `formats` text[], `recipient_count` int, `output_file_ids` uuid[], `error_message` text NULL, `retried_by_run_id` uuid NULL, `started_at`, `finished_at`, `created_at`. Unique một phần `(schedule_id, scheduled_for) WHERE trigger = 'scheduled'` để không tạo trùng một lần chạy.

Lần chạy giữ `schedule_name` và `report_type` dạng chép lại để lịch sử còn đọc được sau khi lịch bị xóa mềm.

### 6.2. Quy tắc

Giữ BR-S1 đến BR-S6 của spec mockup. `computeNextRun` và `resolvePeriod` chép từ `scheduleNextRun.js` của FE sang TypeScript, cùng bộ test 17 ca. Thêm:

| Mã | Quy tắc |
|---|---|
| BR-S7 | `next_run_at` được tính lại khi tạo, sửa, bật, và sau mỗi lần chạy theo lịch. Tắt lịch thì `next_run_at = NULL`. |
| BR-S8 | Người nhận nội bộ được tra email tại thời điểm gửi; tài khoản không còn hoạt động bị bỏ qua. Không còn người nhận hợp lệ nào thì lần chạy thất bại với lý do rõ ràng. |
| BR-S9 | Phạm vi dữ liệu của một lịch là phạm vi của người sở hữu lịch tại thời điểm chạy (F6). Người sở hữu mất quyền thì lần chạy thất bại. |
| BR-S10 | Lỗi tạo file hoặc gửi email: job thử lại tối đa 3 lần cách nhau tăng dần; hết lượt thì lần chạy `failed`. "Gửi lại" tạo lần chạy `manual` mới với cùng kỳ. |
| BR-S11 | Lịch trỏ tới loại báo cáo chưa khả dụng (sinh viên) không tạo được. |

### 6.3. Chạy theo lịch

Cron `report-schedule-dispatch` mỗi phút:

1. Trong một transaction: `SELECT … FROM report_schedules WHERE enabled AND deleted_at IS NULL AND next_run_at <= now() ORDER BY next_run_at LIMIT 20 FOR UPDATE SKIP LOCKED`.
2. Với mỗi lịch: chèn `report_schedule_runs` (`scheduled_for = next_run_at`; trùng unique thì bỏ qua), cập nhật `next_run_at` mới và `last_run_at`, đẩy job `report-schedule:run`.
3. Commit rồi mới đẩy job (đẩy sau commit để worker không đọc phải dòng chưa có).

Worker: dựng `ReportModel` một lần → render từng định dạng → lưu `media_files` → gửi **một** email kèm mọi tệp → cập nhật lần chạy. Tổng dung lượng đính kèm vượt `report.schedule_max_attachment_mb` (mặc định 15) thì email chỉ chứa thông báo và lần chạy ghi rõ file phải tải trong hệ thống.

`FOR UPDATE SKIP LOCKED` cùng unique của bảng lần chạy bảo đảm tiêu chí 5 mà không cần khóa Redis.

## 7. Hợp đồng API

Tiền tố `/api/v1`. Phản hồi `{ success, message, data, meta }`.

| Endpoint | Quyền |
|---|---|
| `GET /reports/catalog` · `GET /reports/lookups` | `report.center.read` |
| `GET /reports/:type/preview` | `report.center.read` |
| `POST /reports/:type/exports` · `GET /reports/exports/recent` | `report.center.export` |
| `GET /report-schedules` · `POST` · `PATCH /:id` · `DELETE /:id` · `POST /:id/duplicate` · `POST /:id/run-now` | `report.schedule.manage` |
| `GET /report-schedule-runs` · `POST /:id/retry` · `GET /:id/files/:format` | `report.schedule.manage` |

`GET /reports/lookups` trả `departments, staff, zones, gates, buildings, rooms, purposes` (bỏ `semesters, subjects, classSections` cho tới khi có loại sinh viên). `staff` giới hạn theo phạm vi của người gọi.

**Quyền** (seed bằng migration):

| Mã quyền | SYSTEM_ADMIN | BUSINESS_ADMIN | MANAGER |
|---|---|---|---|
| `report.center.read` | ✓ | ✓ | ✓ (chỉ đơn vị mình quản lý) |
| `report.center.export` | ✓ | ✓ | ✓ |
| `report.schedule.manage` | ✓ | ✓ | |

MANAGER gọi báo cáo không có chiều đơn vị (`vehicle`, `security-alert`) nhận 403 `REPORT_OUT_OF_SCOPE`.

## 8. Thay đổi ở module khác

| Module | Thay đổi |
|---|---|
| `notifications` | worker nhận `attachments[]` bên cạnh `attachment` cũ; thêm loại `report_schedule_delivery` |
| `mail` | mẫu email gửi báo cáo định kỳ (tên báo cáo, kỳ, lời nhắn, danh sách tệp) |
| `scheduler` | cron `report-schedule-dispatch`, cờ `SCHEDULER_REPORT_SCHEDULE_ENABLED` |
| `reports` (worker hiện có) | thêm hai nhánh `job.name` trong processor duy nhất (F2) |

## 9. Bảo mật

- Bộ lọc do người dùng gửi chỉ đi vào SQL qua tham số; `sortKey` phải thuộc danh sách cột của loại báo cáo (SEC-03).
- Email ngoài trong danh sách người nhận được kiểm định dạng; tối đa 20 người nhận; mọi lần tạo, sửa, xóa lịch và mỗi lần gửi ghi `audit_logs` (ai, gửi cho những ai, báo cáo gì).
- File xuất lưu với `visibility_level = internal`; chỉ người tạo job hoặc người có `report.schedule.manage` tải được.
- Báo cáo khách không đưa số giấy tờ và số điện thoại của khách vào file gửi tự động.

## 10. Kiểm thử

| Tầng | Nội dung |
|---|---|
| Unit | `computeNextRun`, `resolvePeriod` (17 ca chép từ FE); quy tắc chuyên cần cán bộ trên dữ liệu dựng tay; kiểm bộ lọc; ba renderer (mở lại file vừa tạo để kiểm tiêu đề, số sheet, số dòng, tiếng Việt có dấu); phạm vi theo vai trò |
| DB (`RUN_DB_TESTS=1`) | truy vấn từng provider trên dữ liệu seed; `FOR UPDATE SKIP LOCKED` với hai kết nối đồng thời; unique lần chạy |
| e2e | xem trước 6 loại; tạo job xuất và tải file; tạo lịch → chạy cron → có lần chạy và email (dùng transport thử) |
| Hợp đồng | khóa KPI, biểu đồ, cột của mỗi loại khớp `reportDefinitions.js` của FE |
| Hiệu năng | xem trước 31 ngày trên DB bench `capstone_perf` dưới 2 giây cho từng loại |

## 11. Triển khai

Cờ `REPORT_CENTER_ENABLED`, `SCHEDULER_REPORT_SCHEDULE_ENABLED`. Thứ tự: tạo chỉ mục `CONCURRENTLY` trên production → migration → bật `REPORT_CENTER_ENABLED` → bật cron → tắt cờ mock ở FE. Quay lui: tắt hai cờ; bảng mới không ảnh hưởng luồng cũ.

Phụ thuộc: loại `visitor` cần spec VIS-BE-001 xong phần bảng và thống kê. Năm loại còn lại và toàn bộ lịch gửi không phụ thuộc phân hệ Khách.

## 12. Rủi ro

| Mã | Rủi ro | Xử lý |
|---|---|---|
| R1 | Chuyên cần cán bộ sai lệch với thực tế vì chưa có lịch làm việc, ngày nghỉ. | Quy tắc cấu hình được; ghi rõ hạn chế trên màn hình và trong file; chờ câu trả lời của khách hàng. |
| R2 | Truy vấn `iot_device_events` theo `payload_json->>'userId'` chậm trên dữ liệu lớn. | Chỉ mục biểu thức một phần; đo trên `capstone_perf` trước khi nối FE; nếu vẫn chậm thì thêm bảng tổng hợp ngày theo mẫu `kpi-rollup` (ngoài đợt này). |
| R3 | Email có nhiều tệp lớn bị máy chủ thư từ chối. | Trần dung lượng đính kèm, vượt thì gửi thông báo không kèm tệp. |
| R4 | Gửi trùng khi chạy nhiều instance. | `SKIP LOCKED` + unique lần chạy; có test hai kết nối. |
| R5 | Loại báo cáo sinh viên bị bỏ ngỏ lâu. | Danh mục và FE đã có chỗ cho nó; khi 2.7 xong chỉ thêm một `ReportProvider`. |

## 13. Ước lượng

Một dev đã quen codebase: **khoảng 19 ngày công**, chia mốc ở plan. Ba renderer dùng chung thay cho renderer riêng từng loại bù lại phần việc nối FE, nên tổng xấp xỉ con số 17,5 ngày ở spec mockup dù đã bỏ báo cáo sinh viên.
