# Đo hiệu năng xem trước — Trung tâm báo cáo (RPT-CENTER-BE-001, Task 9)

**Cách đo:** `test/reports/center/perf.bench.e2e-spec.ts` (chỉ chạy khi `BENCH=1`), kỳ 31 ngày (2026-09-01 → 2026-10-01), trang 1 × 20 dòng, quyền quản trị, 5 lần mỗi loại, máy phát triển, PostgreSQL cục bộ (Docker).

**Dữ liệu tổng hợp** (`.superpowers/sdd/bench-seed.sql`, không phải dữ liệu thật):
500 cán bộ / 10 đơn vị · 62 000 sự kiện khuôn mặt (`iot_device_events`, 4 lần/người/ngày) · 43 400 dòng `gate_access_logs` (≈ 21 700 phiên, 40% có biển số) · 6 000 cảnh báo an ninh. Bảng họp/đặt phòng gần như trống (đo chỉ có ý nghĩa với 5 loại còn lại).

| Loại | Trung bình | Chậm nhất | Ghi chú |
|---|---|---|---|
| `staff-attendance` | 524 ms | 672 ms | gộp ở DB bằng chỉ mục `IDX_iot_device_events_face_user_time`; phân loại ngày ở ứng dụng (500 × 22 ngày làm việc) |
| `gate-access` | 394 ms | 418 ms | CTE phiên + 4 truy vấn tổng hợp |
| `vehicle` | 270 ms | 337 ms | cùng CTE, lọc có biển số |
| `security-alert` | 425 ms | 473 ms | tải toàn bộ cảnh báo của kỳ (6 000 dòng) rồi gộp ở ứng dụng |
| `room-utilization` | ~1 ms | 3 ms | dữ liệu bench trống; truy vấn một lượt, chỉ mục sẵn có của `room_bookings` |
| `visitor` | chưa đo | | dùng lại `VisitQueryService` (đã đo ở plan Khách) |

**Kết luận:** cả 5 loại đã đo đều dưới ngưỡng 2 giây của ARCH-02 với dữ liệu cỡ này; không cần sửa truy vấn hay thêm bảng tổng hợp.

**Chưa đo / rủi ro còn lại:**
- Chưa đo trên bản sao dữ liệu production. Loại đáng ngờ nhất là `security-alert` (tải cả kỳ vào bộ nhớ): nếu một kỳ 31 ngày vượt vài chục nghìn cảnh báo thì cần chuyển sang gộp ở DB.
- `room-utilization` chưa đo với dữ liệu họp thật.
- `EXPLAIN (ANALYZE, BUFFERS)` chưa chụp từng truy vấn vì không loại nào chạm ngưỡng.
