# Quickstart: BE phân hệ Khách đến làm việc (VIS-BE-001)

## 1. Cờ môi trường (mặc định đều TẮT)

| Cờ | Bật thì | Ghi chú |
|---|---|---|
| `VISITORS_ENABLED` | Mở mọi route `/public/visitor-*` và `/visitors/*`; camera IVSS/FaceGate đẩy sự kiện vào phân hệ Khách | Tắt → route trả 404, hook thoát ngay (không ảnh hưởng nhân sự) |
| `SCHEDULER_VISITOR_ENABLED` | Chạy 3 cron: `visitor-sweep` (mỗi phút), `visitor-face-reconcile` (5 phút), `visitor-photo-retention` (02:30) | Cần thêm `SCHEDULER_ENABLED=true` (mặc định đã true) và Redis |
| `VISITOR_FACEGATE_ENABLED` | Đẩy/gỡ khuôn mặt khách xuống thiết bị `face_server` theo khu vực | Mới kiểm bằng thiết bị giả. Chưa bật cho tới khi có thiết bị thật |

Thứ tự bật: `VISITORS_ENABLED` → kiểm tay đăng ký/duyệt → `SCHEDULER_VISITOR_ENABLED` → (khi có thiết bị) `VISITOR_FACEGATE_ENABLED`.

## 2. Migration

Chạy `npm run migration:run`. Bốn migration mới: `20261012000001` (5 bảng), `…02` (đơn vị `VISITOR`), `…03` (quyền `visitor.*`), `…04` (extension `unaccent`).
Quyền `visitor.visit.read|manage`, `visitor.desk.use`, `visitor.stats.read`, `visitor.host.self` được gán cho vai trò hiện có trong migration `…03`; kiểm lại ở màn Phân quyền trước khi bàn giao.

## 3. Cấu hình camera cổng (IVSS)

Camera chỉ check-in/out khi sự kiện đến từ khu vực loại `gate`. Với mỗi camera cổng, trong `system_configs` của IVSS:
- `ivss.channel_presence_zone_map`: map `channel → zoneId` của khu vực cổng.
- `ivss.channel_direction_map`: `{"0":"enter","1":"leave"}` (chỉ dùng `enter`/`leave`). Camera không phân biệt chiều sẽ chỉ cập nhật "lần cuối thấy", không check-in.

Khu vực được cấp cho khách phải gồm khu vực cổng, nếu không camera cổng trả `zone_not_allowed`.

## 4. Cấu hình nghiệp vụ (`system_configs`, nhóm `visitor`, đệm 30 giây)

`visitor.face_match_threshold` 0.80 · `visitor.access_buffer_minutes` 30 · `visitor.max_visit_days` 7 · `visitor.overstay_escalate_minutes` 30 · `visitor.approver_mode` `host_or_manager` | `manager_only` · `visitor.photo_retention_days` 30 · `visitor.notify_host_email` true · `visitor.public_host_search_enabled` true · `visitor.purposes` · `visitor.default_zone_codes` · `visitor.public_rate_limit`. Thiếu khóa hoặc sai kiểu → dùng mặc định.

## 5. Chạy thử với FE

BE: `NODE_ENV=development VISITORS_ENABLED=true SCHEDULER_VISITOR_ENABLED=true`.
FE: `REACT_APP_VISITOR_MOCK=false` (Báo cáo vẫn dùng dữ liệu giả cho tới khi nối BE báo cáo). Màn "Cổng" gọi `POST /dev/mock-visitor-scan`, route này chỉ có khi `NODE_ENV=development` và cần đăng nhập.

## 6. Quay lui

Đặt `VISITORS_ENABLED=false` (và hai cờ còn lại): route 404, cron dừng, camera bỏ qua khách. Dữ liệu giữ nguyên; tài khoản khách ẩn không lộ trong danh sách người dùng/phòng ban/tìm kiếm. Không cần chạy migration down.

## 7. Chưa kiểm chứng trên thiết bị thật

- Camera IVSS thật nhận ra khách ở cổng (đã kiểm bằng sự kiện giả lập đúng dạng hook, chưa có sự kiện thật).
- FaceGate thật: `addPerson` với khung hiệu lực, `findUidByName`, `deletePerson` (chỉ kiểm bằng nhà cung cấp giả).
- Gửi email thật (kiểm tới hàng đợi/builder, chưa qua SMTP).
- Chạy tay trên trình duyệt kịch bản demo bước 1–6 với BE thật.
