# Backend Trung tâm báo cáo và lịch gửi tự động (2.13) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay lớp dữ liệu giả của Trung tâm báo cáo bằng BE thật cho 6 loại báo cáo: xem trước trên màn hình, xuất PDF/Excel/Word qua job, lịch gửi tự động có lịch sử chạy, và nối FE.

**Architecture:** Mở rộng module `reports`. Mỗi loại báo cáo là một `ReportProvider` trả về một `ReportModel` chung; ba renderer dùng chung chỉ biết `ReportModel`. Xuất và lịch gửi đi qua hàng đợi `report-export` sẵn có, thêm nhánh `job.name` vào processor duy nhất. Lịch gửi chống chạy trùng bằng `FOR UPDATE SKIP LOCKED` và unique của bảng lần chạy.

**Tech Stack:** NestJS 11, TypeORM 1.0 (SQL tham số qua `DataSource`), PostgreSQL, BullMQ, `@nestjs/schedule`, `pdfkit`, `exceljs`, `docx`, `nodemailer`, Jest.

**Spec:** `spec/features/reports/feat-report-center-be/spec.md` (RPT-CENTER-BE-001). Định nghĩa báo cáo gốc: `spec/features/visitor-reports/feat-visitor-report-ui-mockup/spec.md` §4.2.

**Mức chi tiết của plan này:** mỗi task ghi file, chữ ký hàm, DDL, quy tắc và danh sách ca test có kỳ vọng cụ thể. Code đầy đủ chỉ có sẵn cho phần chép từ FE (tính lần chạy kế tiếp và bộ test). Phần còn lại người làm viết theo hợp đồng ở task, test trước.

## Global Constraints

- **Không commit, không push** khi LamNH chưa yêu cầu. Mỗi task kết thúc bằng "Điểm dừng". Không thêm dòng `Co-Authored-By`.
- Làm trên nhánh `feat/report-center-be` tách từ `main` của BE.
- Hiến pháp dự án: SQL chỉ dùng tham số, `sortKey` phải thuộc danh sách cột của loại (SEC-03); mọi endpoint có JWT và quyền (SEC-02); xóa mềm cho bảng lịch (DATA-01); xem trước phải dưới 2 giây, mọi việc dựng file đi qua hàng đợi (ARCH-02); thao tác ghi lặp lại an toàn (ARCH-03).
- **Không sửa** 5 endpoint xuất cũ, DTO, service, renderer của chúng. Chỉ được thêm nhánh `job.name` vào `MeetingActivityReportWorkerProcessor.process()`.
- Phản hồi `{ success, message, data, meta }`; lỗi `{ success: false, message, error: { code, details } }`.
- **Mọi phép tính theo "ngày", "tuần", "tháng", giờ gửi dùng múi `Asia/Ho_Chi_Minh` tường minh.** Máy chủ production chạy UTC.
- Khóa bộ lọc, KPI, biểu đồ, cột của từng loại phải trùng `SAVP-capstone-FE/src/config/reportDefinitions.js`.
- Giá trị mặc định: giờ làm `08:00`–`17:00`, ân hạn `15` phút, ngày làm việc thứ Hai–thứ Sáu; trần xuất `50 000` dòng; trần đính kèm `15` MB; tối đa `20` người nhận; ngày trong tháng `1`–`28` hoặc ngày cuối.
- Thông điệp lỗi kiểm lịch gửi trùng từng chữ với bảng `validateSchedule` ở plan mockup Task 6 (FE đang so chuỗi).
- Lệnh test: unit `npx jest <đường dẫn>`; DB và e2e `RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json <đường dẫn> --runInBand`. Bộ jest đầy đủ vốn có khoảng 250 ca hỏng sẵn trên `main`; so với số nền.
- Dải số migration của plan này: `20261013000001`–`20261013000009`.

## Review Focus

1. **Máy chủ chạy UTC:** "hôm qua", "tuần trước", giờ gửi 08:00, và việc gộp sự kiện theo ngày đều phải ra kết quả theo giờ Việt Nam. Sự kiện lúc 23:30 UTC thuộc ngày hôm sau ở Việt Nam. (Task 8, 13)
2. **Hai instance cùng chạy cron dispatch:** mỗi lịch chỉ sinh một lần chạy và một email. (Task 15)
3. **Kỳ không có dữ liệu, kỳ quá lớn, `sortKey` lạ, loại báo cáo không tồn tại hoặc chưa khả dụng:** trả lỗi hoặc file hợp lệ có thông báo, không văng 500. (Task 5, 12)
4. **Người sở hữu lịch mất quyền, người nhận nội bộ đã nghỉ, không còn người nhận hợp lệ:** lần chạy thất bại với lý do đọc được, không gửi cho sai người. (Task 15)
5. **Tiếng Việt có dấu** trong PDF (phông), trong tên sheet Excel, trong Word và trong tên tệp đính kèm email. (Task 11)

---

## File Structure

```
src/database/migrations/20261013000001..9-*.ts
src/modules/reports/center/
  report-model.ts                       kiểu ReportModel, ReportProvider, ReportFilters
  report-definition.registry.ts         khóa bộ lọc/KPI/biểu đồ/cột của 7 loại (đối chiếu FE)
  report-format.util.ts (+ .spec)       định dạng số, %, giờ, ngày giờ kiểu Việt Nam
  report-scope.service.ts (+ .spec)     phạm vi theo vai trò
  report-center.service.ts              catalog, lookups, preview, điều phối
  report-center-export.service.ts       tạo job, file gần đây
  report-center-worker.processor.ts     dựng file cho job export:report-center
  providers/  gate-access · vehicle · room-utilization · security-alert · staff-attendance · visitor
  renderers/  report-pdf.renderer.ts · report-xlsx.renderer.ts · report-docx.renderer.ts (+ .spec)
  dto/        preview.query.dto.ts · create-export.dto.ts
  controllers/report-center.controller.ts
src/modules/reports/schedules/
  schedule-next-run.ts (+ .spec)        chép từ FE
  entities/  report-schedule.entity.ts · report-schedule-run.entity.ts
  dto/       upsert-schedule.dto.ts · list-runs.query.dto.ts
  report-schedule.service.ts · report-schedule-dispatch.service.ts · report-schedule-run.worker.ts
  controllers/ report-schedule.controller.ts · report-schedule-run.controller.ts
test/reports/center/  fixtures.ts · fe-report-definitions.snapshot.json · *.e2e-spec.ts
```

Sửa ở module khác: `reports.module.ts`, `processors/meeting-activity-report-worker.processor.ts` (2 nhánh), `notifications/notification-worker.service.ts` (`attachments[]`), `mail/templates/builders.ts` (1 mẫu), `scheduler` (1 cron), `config/env.validation.ts` (2 cờ).

---

# M1 — Nền (3 ngày)

### Task 1: Migration bảng lịch gửi, quyền, chỉ mục

**Files:**
- Create: `20261013000001-CreateReportScheduleTables.ts`, `20261013000002-SeedReportCenterPermissions.ts`, `20261013000003-AddIvssFaceEventUserIndex.ts`
- Test: `test/reports/center/report-center-schema.e2e-spec.ts`

**Interfaces:**
- Produces: bảng `report_schedules`, `report_schedule_runs` đúng spec §6.1; quyền `report.center.read`, `report.center.export`, `report.schedule.manage` phân vai theo spec §7; chỉ mục `IDX_iot_device_events_face_user_time ON iot_device_events ((payload_json->>'userId'), event_time) WHERE event_type = 'ivss_face_event' AND payload_json->>'userId' IS NOT NULL`.

- [ ] **Step 1: Test DB (đỏ):** hai bảng tồn tại; chèn hai lần chạy `scheduled` cùng `(schedule_id, scheduled_for)` → 23505, còn `manual` thì chèn trùng được; `day_of_month = 29` → lỗi CHECK; MANAGER có `report.center.read` nhưng không có `report.schedule.manage`; `EXPLAIN` của truy vấn lọc `payload_json->>'userId' = $1` với `event_type='ivss_face_event'` dùng chỉ mục mới; revert rồi run lại không lỗi.
- [ ] **Step 2–4:** đỏ → viết → xanh. Ghi trong file migration chỉ mục: trên production tạo trước bằng `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, migration dùng `IF NOT EXISTS` nên bỏ qua.
- [ ] **Step 5: Điểm dừng.**

### Task 2: `ReportModel`, bảng khai báo 7 loại, test hợp đồng với FE

**Files:**
- Create: `center/report-model.ts`, `center/report-definition.registry.ts`, `test/reports/center/fe-report-definitions.snapshot.json`, `scripts/export-fe-report-definitions.mjs`
- Test: `center/report-definition.registry.spec.ts`

**Interfaces:**
- Produces:

```ts
export type ReportType = 'staff-attendance' | 'student-attendance' | 'gate-access' | 'room-utilization' | 'vehicle' | 'visitor' | 'security-alert';
export type CellFormat = 'text' | 'number' | 'percent' | 'hours' | 'minutes' | 'duration' | 'datetime';
export interface ReportDefinition {
  type: ReportType; title: string; description: string; available: boolean; unavailableReason?: string;
  hasDepartmentScope: boolean;
  filters: { key: string; label: string; kind: 'lookup' | 'options'; lookup?: string; options?: { value: string; label: string }[] }[];
  kpis: { key: string; label: string; format: CellFormat }[];
  charts: { key: string; title: string; kind: 'line' | 'bar' | 'pie'; xKey: string; series: { key: string; label: string }[] }[];
  columns: { key: string; label: string; format: CellFormat }[];
}
export interface ReportFilters { from: string; to: string; q?: string; [key: string]: string | undefined }
export interface ReportPage { page: number; limit: number; sortKey?: string; sortDir?: 'asc' | 'desc' }
export interface ReportModel { /* đúng spec §3 */ }
export interface ReportProvider {
  readonly type: ReportType;
  build(filters: ReportFilters, scope: ResolvedScope, page: ReportPage | null, now: Date): Promise<ReportModel>;
}
```

- `scripts/export-fe-report-definitions.mjs` đọc `../SAVP-capstone-FE/src/config/reportDefinitions.js` và ghi ra file snapshot (chỉ khóa và nhãn); chạy tay khi FE đổi.

- [ ] **Step 1: Sinh snapshot** từ FE hiện tại.
- [ ] **Step 2: Test (đỏ):** với mỗi loại, danh sách khóa `filters`, `kpis`, `charts` (kèm `xKey` và khóa chuỗi), `columns` (kèm `format`) của registry trùng snapshot; `student-attendance` có `available=false` và `unavailableReason` không rỗng; 6 loại còn lại `available=true`; `vehicle` và `security-alert` có `hasDepartmentScope=false`.
- [ ] **Step 3–4:** viết registry → xanh.
- [ ] **Step 5: Điểm dừng.**

### Task 3: Phạm vi theo vai trò và tiện ích định dạng

**Files:**
- Create: `center/report-scope.service.ts`, `center/report-format.util.ts`
- Test: hai file `.spec.ts` tương ứng

**Interfaces:**
- Produces:
  - `ReportScopeService.resolve(userId, definition, filters): Promise<ResolvedScope>` với `ResolvedScope = { unrestricted: boolean; departmentIds: string[] | null }`. Quy tắc chép từ `gate-access-report.service.ts:165-232` (không sửa file đó): quản trị → không giới hạn; MANAGER → các đơn vị có `manager_user_id` là mình; MANAGER xin `departmentId` ngoài phạm vi → 403 `DEPARTMENT_OUT_OF_SCOPE`; MANAGER với loại `hasDepartmentScope=false` → 403 `REPORT_OUT_OF_SCOPE`; vai trò khác → 403.
  - `formatCell(value, format): string` cho PDF/Word và `toExcelValue(value, format)` trả số/`Date` thật. Kết quả chuỗi trùng `formatCell` của FE (`src/utils/reportFormat.js`): `1.234`, `92,5%`, `7,5 giờ`, `35 phút`, `2g 15p`, `07/10/2026 08:15` (giờ Việt Nam), rỗng → `—`.

- [ ] **Step 1: Test (đỏ):** 6 ca phạm vi ở trên; 8 ca định dạng của test FE cộng: `datetime` của `2026-10-07T17:30:00Z` → `08/10/2026 00:30` khi `TZ=UTC`.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng M1.**

---

# M2 — Xem trước 6 loại (6,5 ngày)

### Task 4: Controller, dịch vụ điều phối, cờ bật

**Files:**
- Create: `center/report-center.service.ts`, `center/controllers/report-center.controller.ts`, `center/dto/preview.query.dto.ts`
- Modify: `src/modules/reports/reports.module.ts`, `src/config/env.validation.ts` (`REPORT_CENTER_ENABLED`, `SCHEDULER_REPORT_SCHEDULE_ENABLED`, đều mặc định `false`)
- Test: `center/report-center.service.spec.ts`, `test/reports/center/report-center-api.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /reports/catalog` → `[{ type, title, description, available, unavailableReason, activeSchedules, lastExportAt }]`; `GET /reports/lookups`; `GET /reports/:type/preview` → `{ kpis: [{ key, value }], charts: [{ key, data }], rows, total, notes }`.
- `ReportCenterService.preview(type, query, user)`: kiểm loại → kiểm khả dụng → `validateRange` (thiếu ngày, `from > to`, quá `getMaxRangeDays()`) → kiểm bộ lọc chỉ gồm khóa của loại → kiểm `sortKey` thuộc cột → phạm vi → `provider.build`.

- [ ] **Step 1: Test (đỏ)** với provider giả: loại lạ → 404 `REPORT_TYPE_NOT_FOUND`; `student-attendance` → 409 `REPORT_NOT_AVAILABLE`; thiếu `from` → 400 "Vui lòng chọn kỳ báo cáo"; `from > to` → 400 "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc"; quá số ngày tối đa → 400; `sortKey` không thuộc cột → 400; `limit=500` bị kẹp về 100; không token → 401; EMPLOYEE → 403; danh mục trả đủ 7 loại theo thứ tự của FE; cờ `REPORT_CENTER_ENABLED=false` → route không đăng ký.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng.**

### Task 5: Provider `gate-access` và `vehicle`

**Files:**
- Create: `center/providers/gate-access.provider.ts`, `center/providers/vehicle.provider.ts`, `test/reports/center/fixtures.ts`
- Test: `test/reports/center/gate-vehicle-provider.e2e-spec.ts`

**Interfaces:**
- Consumes: CTE phiên của `gate-access/services/gate-access-history.service.ts:39` (xuất hằng `SESSIONS_CTE` ra khỏi file đó bằng `export`, không đổi nội dung), quy tắc "chỉ phiên hoàn tất" của `gate-access-report-data.service.ts`, `anpr/utils/control-list-flag.sql.ts`.
- Produces: hai provider trả đúng khóa của registry. `subjectType`: `staff` (có `user_id`, không thuộc đơn vị VISITOR, không role STUDENT), `student` (role STUDENT), `visitor` (đơn vị VISITOR), `unknown` (không `user_id`).

- [ ] **Step 1: Fixture** (id tiền tố `fa11ed01-`): 2 cổng, 6 người (2 cán bộ hai đơn vị, 2 sinh viên, 1 khách, 1 vãng lai chỉ có biển số), 20 phiên trong 3 ngày có số liệu biết trước, 2 phiên chưa hoàn tất, 3 phiên vắt qua nửa đêm giờ VN.
- [ ] **Step 2: Test (đỏ):** KPI `entries`, `exits`, `onSite`, `avgStayMinutes` đúng số fixture; phiên chưa hoàn tất không nằm trong bảng nhưng phiên mở hôm nay được đếm ở `onSite`; lọc `zoneId`, `departmentId`, `subjectType` thu hẹp đúng; biểu đồ theo giờ gộp theo giờ Việt Nam; phạm vi MANAGER chỉ thấy đơn vị mình; `q` tìm theo tên và biển số; phân trang và sắp xếp; `vehicle`: đếm ô tô, xe máy, chưa đăng ký, thuộc danh sách kiểm soát đúng fixture.
- [ ] **Step 3–4:** viết → xanh.
- [ ] **Step 5: Điểm dừng.**

### Task 6: Provider `room-utilization` và `security-alert`

**Files:**
- Create: `center/providers/room-utilization.provider.ts`, `center/providers/security-alert.provider.ts`
- Test: `test/reports/center/room-security-provider.e2e-spec.ts`

**Interfaces:**
- Consumes: `RoomUtilizationReportDataService` (`getUtilizationSection`, `getNoShowSection`, `getActualUsageByRoom`), `SecurityAlertReportDataService.listAllForExport`. Gọi qua DI, không sửa hai service.

- [ ] **Step 1: Test (đỏ)** trên fixture bổ sung (4 phòng 2 tòa, 12 cuộc họp có 2 không đến; 15 cảnh báo đủ loại, mức, trạng thái): KPI khớp số của service gốc trên cùng bộ lọc; lọc `building`, `roomId`, `alertType`, `severity`, `zoneId`, `status`; danh sách lựa chọn `alertType` có ba loại `visitor_*`; thời gian xử lý trung bình chỉ tính cảnh báo đã xử lý.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng.**

### Task 7: Provider `staff-attendance`

**Files:**
- Create: `center/providers/staff-attendance.provider.ts`, `center/staff-attendance.rules.ts`
- Test: `center/staff-attendance.rules.spec.ts`, `test/reports/center/staff-attendance-provider.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `classifyDay({ firstSeen, lastSeen }, day, rules, now)` → `{ status: 'on_time'|'late'|'early_leave'|'late_and_early'|'absent'|'pending', hours }` — hàm thuần.
  - Provider: một câu SQL gộp theo `(user_id, ngày giờ VN)` lấy `min`/`max` thời điểm từ `UNION ALL` của `iot_device_events` (khuôn mặt) và `gate_access_logs`; nối với lịch ngày làm việc sinh bằng `generate_series`; phân loại ở ứng dụng bằng `classifyDay`. `notes[]` nêu hai hạn chế của spec §4.1.

- [ ] **Step 1: Test hàm thuần (đỏ):** vào 08:15 → đúng giờ; 08:16 → muộn; ra 16:59 → về sớm; cả hai; không có lần thấy → vắng; thứ Bảy không tính; hôm nay lúc 10:00 chưa thấy ai → `pending`, không phải vắng; hôm nay đã vào chưa ra → không tính về sớm; quy tắc cấu hình `workStart=07:30` đổi kết quả.
- [ ] **Step 2: Test DB (đỏ):** fixture 4 cán bộ × 5 ngày làm việc với lịch biết trước, một sinh viên, một tài khoản khách, một tài khoản đối tác; kỳ vọng: sinh viên, khách, đối tác không có trong bảng; sự kiện lúc `2026-10-05T23:30:00Z` thuộc ngày 06/10; KPI `attendanceRate`, `lateCount`, `earlyLeaveCount`, `absentDays`, `avgHoursPerDay` đúng số tay; cán bộ chỉ có lượt xe (không khuôn mặt) vẫn được tính có mặt; lọc `departmentId`, `staffId`; phạm vi MANAGER.
- [ ] **Step 3–4:** viết → xanh.
- [ ] **Step 5: Điểm dừng.**

### Task 8: Provider `visitor`

**Phụ thuộc:** plan Khách Task 1 (bảng) và Task 7 (`VisitQueryService.computeKpis`). Chưa có thì hoãn task này; danh mục tạm đặt loại `visitor` là `available=false` với lý do "chờ phân hệ Khách".

**Files:**
- Create: `center/providers/visitor.provider.ts`
- Modify: `reports.module.ts` (import `VisitorsModule` có điều kiện theo `VISITORS_ENABLED`)
- Test: `test/reports/center/visitor-provider.e2e-spec.ts`

- [ ] **Step 1: Test (đỏ):** với cùng kỳ và đơn vị, `totalVisits`, `uniqueVisitors`, `avgStayMinutes`, `overstayCount`, `noShowRate` bằng đúng `GET /visitors/stats`; bảng gồm lượt đã đến và lượt hết hạn; `statusLabel` có "(quá giờ)" và "(giờ ra nhập tay)" khi tương ứng; hàng không chứa số giấy tờ và điện thoại; `VISITORS_ENABLED=false` → danh mục báo chưa khả dụng, xem trước 409.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng.**

### Task 9: Đo hiệu năng xem trước

- [ ] **Step 1:** Chạy migration chỉ mục trên DB bench cục bộ `capstone_perf`.
- [ ] **Step 2:** Với mỗi loại, gọi xem trước kỳ 31 ngày 5 lần, ghi thời gian trung bình và `EXPLAIN (ANALYZE, BUFFERS)` của truy vấn chậm nhất.
- [ ] **Step 3:** Loại nào trên 2 giây: sửa truy vấn (không thêm bảng tổng hợp trong đợt này); nếu không xuống được dưới 2 giây thì dừng và báo LamNH với số đo.
- [ ] **Step 4: Điểm dừng M2.** Ghi bảng số đo vào `spec/features/reports/feat-report-center-be/perf.md`.

---

# M3 — Xuất ba định dạng (3 ngày)

### Task 10: Ba renderer dùng chung

**Files:**
- Create: `center/renderers/report-pdf.renderer.ts`, `report-xlsx.renderer.ts`, `report-docx.renderer.ts`
- Test: ba file `.spec.ts`

**Interfaces:**
- Produces: `renderReportPdf(model, meta): Promise<Buffer>`, `renderReportXlsx(model, meta): Promise<Buffer>`, `renderReportDocx(model, meta): Promise<Buffer>` với `meta = { generatedAt: Date; generatedByEmail: string }`. Hằng `EMPTY_TEXT = 'Không có dữ liệu trong kỳ đã chọn'`. Bố cục theo spec §5.

- [ ] **Step 1: Test (đỏ)** — tạo file rồi đọc lại:
  - Excel (đọc bằng `exceljs`): 2 sheet "Tổng hợp" và "Dữ liệu"; ô A1 là tiêu đề; cột `number` là kiểu số, cột `datetime` là kiểu ngày; mô hình rỗng → ô A2 của "Dữ liệu" là `EMPTY_TEXT`.
  - Word (giải nén bằng `jszip`, đọc `word/document.xml`): có tiêu đề, kỳ, mỗi nhãn cột, chuỗi "Nguyễn Thị Hồng Ánh" còn nguyên dấu; ký tự `<`, `&` trong dữ liệu được thoát; mô hình rỗng có `EMPTY_TEXT`.
  - PDF: bắt đầu bằng `%PDF`; 500 dòng → nhiều hơn 1 trang; dựng không ném lỗi với tên có dấu (phông qua `common/utils/pdf-font.util.ts`).
- [ ] **Step 2–4:** đỏ → viết → xanh. Mẫu: `renderers/gate-access-pdf-renderer.ts`, `gate-access-xlsx-renderer.ts`, `minutes/renderers/meeting-minutes-docx-renderer.ts`.
- [ ] **Step 5: Điểm dừng.**

### Task 11: Job xuất, worker, file gần đây

**Files:**
- Create: `center/report-center-export.service.ts`, `center/report-center-worker.processor.ts`, `center/dto/create-export.dto.ts`
- Modify: `constants/report-export-job.constants.ts` (thêm `REPORT_CENTER_EXPORT_JOB_NAME = 'export:report-center'`), `processors/meeting-activity-report-worker.processor.ts` (một nhánh `job.name`), controller Task 4
- Test: `center/report-center-export.service.spec.ts`, `test/reports/center/report-center-export.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /reports/:type/exports` → 202 `{ jobId, status: 'queued', delivery: 'download', outputFileId: null }` (cùng dạng `CreateExportResponseDto` của các báo cáo cũ); `GET /reports/exports/recent`. Worker theo đúng trình tự của `gate-access-report-worker.processor.ts`: `markRunning` → `provider.build(…, page=null)` → kiểm trần dòng → render → `storageService.saveFile` → `media_files` → `markCompleted`. Tên file `<type>_<from>_<to>.<pdf|xlsx|docx>`.

- [ ] **Step 1: Test (đỏ):** định dạng lạ → 400; loại chưa khả dụng → 409; tạo job ghi `related_entity_type='report_center'` và phạm vi đã phân giải trong `input_json`; worker với mô hình 3 dòng tạo `media_files` đúng `mime_type` cho cả ba định dạng; mô hình rỗng vẫn hoàn tất; quá trần dòng → job `failed` với thông điệp yêu cầu thu hẹp kỳ; lỗi provider → `markFailed`, không ném khỏi worker; job `export:gate-access` cũ vẫn đi đúng worker cũ (ca hồi quy); `recent` chỉ trả job của chính người gọi, tối đa 10, mới nhất trước; ghi `audit_logs`.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng M3.** Tải thử ba file của một báo cáo qua `media-files/:id/secure-download` và mở bằng Excel, Word, trình đọc PDF; ghi kết quả.

---

# M4 — Lịch gửi tự động (4,5 ngày)

### Task 12: Tính lần chạy kế tiếp (chép từ FE)

**Files:**
- Create: `schedules/schedule-next-run.ts`
- Test: `schedules/schedule-next-run.spec.ts`

**Interfaces:**
- Consumes: `SAVP-capstone-FE/src/mocks/visitorReport/scheduleNextRun.js` và file test của nó.
- Produces: `computeNextRun(schedule, now): Date | null`, `resolvePeriod(period, now): { from: string; to: string }` — cùng hành vi, thêm kiểu.

- [ ] **Step 1:** Chép 17 ca test của FE; đặt `process.env.TZ='UTC'` ở đầu file. **Step 2:** chạy, đỏ. **Step 3:** chép và thêm kiểu. **Step 4:** `npx jest src/modules/reports/schedules/schedule-next-run.spec.ts` → 17 passed. **Step 5: Điểm dừng.**

### Task 13: CRUD lịch gửi

**Files:**
- Create: 2 entity, `dto/upsert-schedule.dto.ts`, `report-schedule.service.ts`, `controllers/report-schedule.controller.ts`
- Test: `report-schedule.service.spec.ts`, `test/reports/center/report-schedule-api.e2e-spec.ts`

**Interfaces:**
- Produces: `list(user)`, `create(dto, user)`, `update(id, dto, user)`, `toggle(id, enabled, user)`, `duplicate(id, user)`, `remove(id, user)` → `ScheduleView` = dòng + `reportTitle` + `nextRunAt`. `validateSchedule(dto)` theo đúng thứ tự và thông điệp của bảng ở plan mockup Task 6, thêm BR-S11. `PATCH /report-schedules/:id` nhận cả thân đầy đủ lẫn `{ enabled }` (FE dùng cả hai).

- [ ] **Step 1: Test (đỏ):** 11 ca kiểm đầu vào của FE với đúng thông điệp; loại `student-attendance` → 409; tạo → `next_run_at` đúng theo `computeNextRun`; tắt → `next_run_at` NULL; bật lại → có giá trị; sửa tần suất → tính lại; nhân bản → tên thêm " (bản sao)", tắt, không có `last_run_at`; xóa là xóa mềm và lịch sử lần chạy còn; bộ lọc chứa khóa không thuộc loại → 400; MANAGER → 403; ghi `audit_logs` kèm danh sách người nhận.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng.**

### Task 14: Email nhiều tệp đính kèm

**Files:**
- Modify: `src/modules/notifications/notification-worker.service.ts` (quanh dòng 108–124), DTO của `enqueueEmailNotification`, `src/modules/mail/templates/builders.ts` (thêm `buildReportScheduleEmail`), enum loại thông báo
- Test: `notification-worker.service.spec.ts` (bổ sung), `builders.spec.ts` (bổ sung)

**Interfaces:**
- Produces: payload job email nhận thêm `attachments?: { storageKey, fileName, mimeType }[]`; trường `attachment` cũ vẫn chạy. `buildReportScheduleEmail({ scheduleName, reportTitle, periodLabel, message, fileNames, appUrl })`.

- [ ] **Step 1: Test (đỏ):** job có `attachments` 3 phần tử → `sendMail` nhận 3 tệp đúng tên có dấu; job chỉ có `attachment` cũ → 1 tệp (hồi quy); cả hai cùng có → gộp, không trùng; tải một tệp lỗi → job ném để BullMQ thử lại; nội dung email có tên báo cáo, kỳ, lời nhắn đã thoát HTML.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng.**

### Task 15: Dispatch theo lịch, worker lần chạy, gửi thử, gửi lại

**Files:**
- Create: `report-schedule-dispatch.service.ts`, `report-schedule-run.worker.ts`, `controllers/report-schedule-run.controller.ts`, `dto/list-runs.query.dto.ts`
- Modify: `processors/meeting-activity-report-worker.processor.ts` (nhánh `report-schedule:run`), `src/modules/scheduler/scheduler.service.ts` (cron `report-schedule-dispatch` mỗi phút, cờ `SCHEDULER_REPORT_SCHEDULE_ENABLED`), controller Task 13 (`run-now`)
- Test: `report-schedule-dispatch.service.spec.ts`, `report-schedule-run.worker.spec.ts`, `test/reports/center/report-schedule-dispatch.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `dispatchDue(now): Promise<{ dispatched: number }>` — đúng 3 bước của spec §6.3; đẩy job sau khi commit.
  - Worker `processRun({ runId })`: nạp lần chạy và lịch → phân giải phạm vi của người sở hữu → `provider.build` một lần → render từng định dạng → lưu `media_files` → phân giải người nhận (BR-S8) → một email kèm mọi tệp (hoặc không tệp nếu vượt trần) → cập nhật `status`, `output_file_ids`, `recipient_count`, `finished_at`.
  - `POST /report-schedules/:id/run-now` → `Run` loại `manual`, không đổi `next_run_at`; `GET /report-schedule-runs` (lọc `scheduleId`, `status`, `from`, `to`, phân trang); `POST /report-schedule-runs/:id/retry`; `GET /report-schedule-runs/:id/files/:format` → chuyển hướng tới URL ký tạm của file.

- [ ] **Step 1: Test (đỏ).**
  - Dispatch: lịch đến hạn → 1 lần chạy `queued`, `next_run_at` nhảy đúng, `last_run_at` cập nhật; lịch tắt hoặc chưa đến hạn không chạy; **hai lời gọi `dispatchDue` đồng thời trên hai kết nối với 5 lịch đến hạn → tổng đúng 5 lần chạy, 5 job**; job được đẩy sau commit (giả lập lỗi đẩy job → lần chạy chuyển `failed` với lý do, không mất dấu).
  - Worker: 2 định dạng → 2 `media_files`, một lời gọi email có 2 tệp; người nhận nội bộ đã nghỉ bị bỏ qua và `recipient_count` phản ánh đúng; không còn ai → `failed` "Không còn người nhận hợp lệ"; người sở hữu mất quyền → `failed`; tổng tệp vượt trần → email không tệp, lần chạy `success` kèm ghi chú; lỗi render → `failed` có `error_message`, không ném khỏi worker sau lần thử cuối.
  - API: `run-now` không đổi `next_run_at`; `retry` chỉ cho lần `failed` chưa gửi lại, tạo lần `manual` cùng kỳ và gắn `retried_by_run_id`; gọi `retry` lần hai → 409; tải file của lần `failed` → 409; lọc và phân trang.
  - e2e: tạo lịch có `next_run_at` ở quá khứ → gọi `dispatchDue` → chạy worker → có email trong transport thử với đúng số tệp.
- [ ] **Step 2–4:** đỏ → viết → xanh.
- [ ] **Step 5: Điểm dừng M4.**

---

# M5 — Nối FE và nghiệm thu (2 ngày)

### Task 16: FE gọi API thật cho phân hệ Báo cáo

**Repo:** `SAVP-capstone-FE`, nhánh `feat/report-center-be-integration` từ `main`.

**Files:**
- Modify: `src/config/featureFlags.js` (cờ `REPORT_MOCK_ENABLED`; nếu plan Khách đã tách cờ thì dùng lại), `src/service/reportCenterService.js` (nhánh thật của `exportReport` và `downloadRunFile`: tạo job → hỏi `/background-jobs/:id` mỗi 2 giây bằng một hàm chờ thuần trong service (tối đa 2 phút) → tải qua endpoint bảo mật; cùng luồng với `ExportReportModal.jsx`), `src/pages/shared/reports/ReportCenter.jsx` và `ReportViewer.jsx` (thẻ và trang của loại `available=false` hiện lý do, ẩn nút xuất và đặt lịch), `src/components/report/ExportMenu.jsx` (trạng thái "đang tạo file"), `src/routers/index.js` và `src/config/navigationRegistry.js` (menu theo quyền `report.center.read`, `report.schedule.manage`), `src/pages/shared/visitors/VisitorHistory.jsx` (nút Xuất Excel dùng luồng job)
- Test: cập nhật `src/service/mockFlagOff.test.jsx`, `src/pages/shared/reports/reports.smoke.test.jsx`

- [ ] **Step 1: Test (đỏ):** cờ báo cáo tắt → `exportReport` gọi `POST /reports/<type>/exports` rồi hỏi trạng thái job tới khi `completed` và trả `fileName`; job `failed` → trả `{ success: false, message }`; thẻ báo cáo có `available=false` hiện lý do và không có liên kết xem; hai cờ độc lập (khách thật, báo cáo giả và ngược lại).
- [ ] **Step 2–4:** đỏ → sửa → xanh; `CI=true npx react-scripts test --watchAll=false` và `npm run build`.
- [ ] **Step 5: Điểm dừng.**

### Task 17: Nghiệm thu đầu-cuối và tài liệu

- [ ] **Step 1:** BE cục bộ với `REPORT_CENTER_ENABLED=true`, `SCHEDULER_REPORT_SCHEDULE_ENABLED=true`; FE với `REACT_APP_REPORT_MOCK=false`. Đi kịch bản demo bước 7–9; với mỗi loại xuất đủ ba định dạng và mở file; tạo một lịch hằng ngày có giờ gửi sau 2 phút, chờ email đến hộp thư thử.
- [ ] **Step 2:** Chạy `test/reports/center`, `src/modules/reports`; chạy jest đầy đủ và so số nền; độ phủ `center/` và `schedules/` ≥ 80%.
- [ ] **Step 3:** Mở lại các màn đang dùng 5 endpoint xuất cũ (Hiệu suất phòng họp, Cảnh báo an ninh, Kiểm soát ra vào cổng) và xuất thử: hành vi không đổi.
- [ ] **Step 4:** Tự rà theo danh sách của hiến pháp và ghi kết quả.
- [ ] **Step 5:** Viết `spec/features/reports/feat-report-center-be/quickstart.md`: cờ env, tạo chỉ mục `CONCURRENTLY` trên production, cấu hình `report.staff_attendance.rules`, cách quay lui, việc còn lại khi phân hệ 2.7 xong (thêm provider sinh viên).
- [ ] **Step 6: Điểm dừng cuối.** Báo: số test, độ phủ, bảng hiệu năng, kết quả kịch bản, điều chưa kiểm chứng. Hỏi LamNH về commit.

---

## Tổng hợp ước lượng

| Mốc | Task | Ngày công |
|---|---|---|
| M1 Nền | 1–3 | 3 |
| M2 Xem trước 6 loại | 4–9 | 6,5 |
| M3 Xuất ba định dạng | 10–11 | 3 |
| M4 Lịch gửi | 12–15 | 4,5 |
| M5 Nối FE, nghiệm thu | 16–17 | 2 |
| **Tổng** | | **19** |

Chỉ Task 8 phụ thuộc plan Khách. Mọi task khác chạy song song với plan Khách được nếu có hai người; hai plan cùng sửa `featureFlags.js`, `routers/index.js`, `navigationRegistry.js` của FE và `scheduler.service.ts`, `env.validation.ts`, `builders.ts` của BE, nên ai làm sau cần gộp cẩn thận ở các file đó.
