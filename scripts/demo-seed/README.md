# Dữ liệu demo cho khách hàng

Script tạo dữ liệu demo cho mọi trang của system admin và business admin, rồi **xoá sạch bằng một lệnh** sau buổi demo.

- Mọi dòng được tạo đều ghi id vào bảng `demo_seed_rows`. Lệnh purge xoá theo đúng danh sách này, nên dữ liệu thật không bị đụng tới.
- Không dùng migration. Dữ liệu seed cũ trong migration (`@meetingsys.vn`) được giữ nguyên.
- Thời gian trong dữ liệu được tính **tương đối so với lúc chạy**: lịch sử 14–30 ngày trước, vài cuộc họp đang diễn ra, lịch họp sắp tới. Vì vậy nên seed **vào đúng ngày demo**.
- Script đọc kết nối DB từ `.env` (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`). Chỉ cần DB chạy; BE và Redis có thể tắt.

## Các phần

| Phần | Nội dung | Cần chạy trước |
|---|---|---|
| `part1` | 5 phòng ban, 30 người dùng (mật khẩu chung `Demo@12345`), 10 zone, 8 phòng, 26 thiết bị | — |
| `part5` | ~370 cuộc họp đủ trạng thái, đặt phòng, yêu cầu duyệt, điểm danh, no-show, ghi chú, biên bản | part1 |
| `part2` | Lưu lượng zone 30 ngày (+ `kpi_zone_hourly`), ra/vào phòng bằng khuôn mặt, qua cổng, hành trình | part5 |
| `part3` | Đăng ký xe, danh sách kiểm soát biển số, lượt xe ANPR 14 ngày (+ `kpi_vehicle_*`) | part1 |
| `part4` | Quy tắc cảnh báo, danh sách kiểm soát người, ~100 cảnh báo an ninh (7 loại, đủ trạng thái) | part3 |
| `part6` | Thiết bị phòng họp, sự kiện điểm danh, thông báo in-app, nhật ký audit | part4 |
| `part7` | Ảnh: khuôn mặt (ra/vào phòng, hành trình, cảnh báo, danh sách kiểm soát), biển số đúng từng xe, đám đông | part6 + thư mục `images/` |

Tài khoản demo có email `demo.e…@demo.local` và mã nhân viên `DEMO-…`. Người dùng 1–5 là trưởng phòng (MANAGER), 6–7 là BUSINESS_ADMIN, còn lại là nhân viên. Thông báo cảnh báo an ninh cũng được gửi tới các tài khoản admin thật đang có trong DB, nên đăng nhập admin thật vẫn thấy chuông thông báo. Mọi thông báo seed đều hiện là chưa đọc, vì trạng thái đã đọc lưu ở Redis.

## Lệnh

```bash
npm run demo:seed -- all            # chạy mọi phần theo thứ tự (~1–2 phút, ước tính)
npm run demo:seed -- part3          # chạy riêng 1 phần (đã có thì bỏ qua)
npm run demo:seed -- status         # đếm dữ liệu demo theo phần/bảng
npm run demo:seed -- purge          # xoá toàn bộ (gõ "yes" để xác nhận; --yes để bỏ hỏi)
```

`purge` chạy luôn `demo:camera -- cleanup` (dữ liệu của mock camera), xoá các bảng tổng hợp KPI của zone demo, xoá mọi dòng đã ghi trong registry (bảng con trước bảng cha), rồi kiểm tra lại. Thấy dòng `✔ Sạch: không còn dữ liệu demo.` là thành công.

Muốn làm mới dữ liệu (ví dụ seed từ hôm trước, sáng nay muốn chạy lại cho đúng ngày): chạy `purge --yes` rồi chạy `all`.

## Deploy lên server demo

1. **Mã nguồn:** pull nhánh có thư mục `scripts/demo-seed` và `scripts/demo-camera-mock`, rồi chạy `npm ci` (cần `tsx` trong devDependencies).
2. **Ảnh** (bị gitignore, không có trong repo): chép từ máy local lên server. Thư mục này dùng cho cả `part7` lẫn mock camera, và đã có sẵn ảnh biển số của mọi xe seed (vẽ bằng `npm run demo:images` trên máy có Edge/Chrome). Vì vậy server **không cần** cài trình duyệt. Thiếu thư mục này thì `part7` báo lỗi và dừng; các phần 1–6 vẫn có đủ dữ liệu, chỉ là không có ảnh.
   ```bash
   scp -r scripts/demo-camera-mock/images <user>@<server>:<đường-dẫn-repo>/scripts/demo-camera-mock/
   ```
3. **Kiểm tra `.env`** trên server trỏ đúng DB demo. Lệnh purge in ra `host:port/database` trước khi xác nhận; đọc kỹ dòng đó.
4. **Sao lưu DB trước khi seed:**
   ```bash
   # DB chạy trong Docker (thay capstone-postgres bằng tên container trên server)
   docker exec capstone-postgres pg_dump -U <DB_USERNAME> -d <DB_DATABASE> -Fc > backup_truoc_demo.dump
   # Nếu cần khôi phục:
   docker exec -i capstone-postgres pg_restore -U <DB_USERNAME> -d <DB_DATABASE> --clean < backup_truoc_demo.dump
   ```
   Nếu DB không chạy trong Docker, dùng `pg_dump`/`pg_restore` trực tiếp với `-h <DB_HOST> -p <DB_PORT>`.
5. **Sáng ngày demo:** chạy `npm run demo:seed -- all`, rồi `npm run demo:seed -- status` để kiểm tra.
6. (Tuỳ chọn) Muốn có sự kiện camera realtime trong lúc demo: xem [../demo-camera-mock/README.md](../demo-camera-mock/README.md).
7. **Sau demo:** chạy `npm run demo:seed -- purge`. Nếu vẫn còn sót gì, khôi phục từ bản backup ở bước 4.

## Lưu ý

- FE đang trỏ mặc định tới server cũ của nhóm trước (`api.smartracking.io.vn`). Cần đổi URL API sang server demo trước khi build/deploy FE.
- Ảnh của `part7` được lưu vào storage của BE, dưới thư mục `demo-seed-snapshots/` (theo `STORAGE_DRIVER` local hoặc s3). `purge` xoá cả file lẫn bản ghi `media_files`. Đừng nhầm với thư mục `demo-seed/` có sẵn từ seed migration cũ: thư mục đó không thuộc script này.
- `purge` **không** xoá bản ghi `media_files` và file ảnh upload mà mock camera đã gửi lên BE. Nếu đã chạy mock camera, hãy khôi phục từ backup hoặc tự xoá các file đó. Thư mục `images/` đã chép lên server cũng tự xoá tay nếu không cần nữa.
- Không chạy `purge` khi BE đang ghi sự kiện mock camera vào cùng zone demo.
