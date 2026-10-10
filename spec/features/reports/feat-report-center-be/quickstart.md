# Quickstart: BE Trung tâm báo cáo và lịch gửi tự động (RPT-CENTER-BE-001)

## 1. Cờ môi trường (mặc định đều TẮT)

| Cờ | Bật thì |
|---|---|
| `REPORT_CENTER_ENABLED` | Mở `GET /reports/catalog|lookups|:type/preview`, `POST /reports/center/:type/exports`, `GET /reports/exports/recent`, `/report-schedules`, `/report-schedule-runs`. Tắt → các route này trả 404 |
| `SCHEDULER_REPORT_SCHEDULE_ENABLED` | Cron `report-schedule-dispatch` (mỗi phút) sinh lần chạy cho lịch đến hạn. Cần `SCHEDULER_ENABLED=true` và hàng đợi `report-export` + `notification` đang có worker |

Báo cáo **khách** còn cần `VISITORS_ENABLED=true`; tắt thì danh mục báo `available=false` và xem trước/xuất trả 409.

## 2. Migration và chỉ mục

`npm run migration:run` chạy ba migration `20261013000001` (bảng lịch + lần chạy), `…02` (quyền `report.center.read|export`, `report.schedule.manage`), `…03` (chỉ mục sự kiện khuôn mặt).

**Production:** tạo chỉ mục trước, không khóa bảng, rồi mới chạy migration (migration dùng `IF NOT EXISTS` nên bỏ qua):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_iot_device_events_face_user_time"
  ON iot_device_events ((payload_json->>'userId'), event_time)
  WHERE event_type = 'ivss_face_event' AND payload_json->>'userId' IS NOT NULL;
```

Quyền: SYSTEM_ADMIN và BUSINESS_ADMIN có cả ba; MANAGER có `read` và `export` (chỉ đơn vị mình quản lý; `vehicle` và `security-alert` không có chiều đơn vị nên MANAGER nhận 403 `REPORT_OUT_OF_SCOPE`).

## 3. Cấu hình (`system_configs`)

| Khóa | Mặc định | Ý nghĩa |
|---|---|---|
| `report.staff_attendance.rules` (`config_json`) | `{"workStart":"08:00","workEnd":"17:00","graceMinutes":15,"workdays":[1,2,3,4,5]}` | Quy tắc đi muộn / về sớm / vắng. Khóa thiếu hoặc sai kiểu → dùng mặc định |
| `report.export_max_rows` (`config_value`) | `50000` | Quá trần → job `failed`, yêu cầu thu hẹp kỳ |
| `analytics.dashboard_max_range_days` | `366` | Số ngày tối đa của một kỳ báo cáo (dùng chung với các báo cáo cũ) |

Cứng trong mã: tệp đính kèm email tối đa 15 MB tổng (vượt → email không kèm tệp, lần chạy `success` kèm ghi chú), tối đa 20 người nhận, thử lại 3 lần cách nhau 30 giây.

## 4. Đường dẫn khác với spec

Xuất file là `POST /reports/center/:type/exports` (có `center/`), vì bốn controller xuất cũ đã giữ `POST /reports/{gate-access,vehicle,room-utilization,security-alert}/exports` và không được sửa. Tải tệp của lần chạy là `GET /report-schedule-runs/:id/files/:format` trả JSON `{ fileName, downloadUrl }` (liên kết ký 10 phút) thay vì chuyển hướng 302, để trình duyệt vừa gửi token vừa mở được tệp.

## 5. Chạy thử

BE: `NODE_ENV=development REPORT_CENTER_ENABLED=true SCHEDULER_REPORT_SCHEDULE_ENABLED=true VISITORS_ENABLED=true`. FE: `REACT_APP_REPORT_MOCK=false`.
Tạo lịch hằng ngày có giờ gửi sau 2 phút (hoặc bấm "Gửi thử ngay") và theo dõi hộp thư thử. Đo hiệu năng: `BENCH=1 RUN_DB_TESTS=1 DB_DATABASE=<db> npx jest --config test/jest-e2e.json test/reports/center/perf.bench --runInBand`.

## 6. Quay lui

Đặt hai cờ về `false`: route 404, cron dừng. Bảng lịch giữ nguyên dữ liệu; không cần migration down. Năm endpoint xuất cũ không bị ảnh hưởng.

## 7. Việc còn lại

- Khi phân hệ 2.7 có điểm danh từng buổi: thêm provider `student-attendance` (đổi `available=true` trong registry) và ba lookup `semesters/subjects/classSections`.
- Chưa trừ ngày nghỉ lễ / nghỉ phép trong chuyên cần cán bộ (đã ghi `notes[]` trong phản hồi và file xuất).
- `security-alert` tải cả kỳ vào bộ nhớ: nếu một kỳ vượt vài chục nghìn cảnh báo thì chuyển sang gộp ở DB.
- Chưa kiểm chứng: email thật qua SMTP, mở tệp xuất bằng Excel/Word/trình đọc PDF thật, hiệu năng trên dữ liệu production, chạy tay trên trình duyệt kịch bản demo bước 7–9.
