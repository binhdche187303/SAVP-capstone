## 📝 CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-11-27 | Gộp 2 bộ seed demo (run.mjs từ chore/demo-seed + demo-seed.ts từ feature/camera-device-mgmt) khi merge main | Toàn file |

# Bộ seed dữ liệu DEMO (tag `DEMO-2026-10`)

Nạp dữ liệu mẫu thực tế cho buổi demo: người dùng đủ 7 role, ảnh khuôn mặt AI (không có thật),
biển số giả, ra/vào cổng 30 ngày, meeting đủ trạng thái, điểm danh, cảnh báo, KPI, học vụ...

**Mọi dòng demo có id bắt đầu bằng `de0de0de-`** → dọn sạch chỉ bằng 1 lệnh, không đụng dữ liệu thật.

## Lệnh (cần biến `DEMO_DB_URL` = connection string Postgres/Neon)

```bash
# Thử trước (chạy hết rồi ROLLBACK, không lưu gì)
DEMO_DB_URL='postgresql://...' node scripts/demo-seed/run.mjs --dry-run

# Nạp (tự dọn bản demo cũ rồi nạp lại — chạy lại bao nhiêu lần cũng được)
DEMO_DB_URL='postgresql://...' node scripts/demo-seed/run.mjs

# SÁNG NGÀY DEMO: dựng lại số liệu "hôm nay" cho đúng ngày; --today-until = giờ VN dự kiến demo
DEMO_DB_URL='postgresql://...' node scripts/demo-seed/run.mjs --today-until=10:30

# Sau demo: xoá toàn bộ dữ liệu demo
DEMO_DB_URL='postgresql://...' node scripts/demo-seed/cleanup-demo.mjs

# (Tuỳ chọn) xuất file ảnh snapshot để copy vào storage của backend
DEMO_DB_URL='postgresql://...' node scripts/demo-seed/export-storage.mjs ./storage-export
```

## Lưu ý
- Mật khẩu mọi tài khoản demo: `Abcd1234@`.
- Widget "hôm nay" (lưu lượng cổng, cảnh báo hôm nay, hiện diện, meeting hôm nay) tính theo ngày chạy;
  nên chạy lại script vào sáng ngày demo.
- Ảnh khuôn mặt/ảnh đại diện là data URI trong `users.avatar_url` / `media_files.file_url`. Ảnh hồ sơ khuôn mặt
  (`storage_provider = cloud_provider`) backend tải từ `file_url`. Ảnh snapshot sự kiện camera (người lạ, biển số
  trong lịch sử ANPR) backend đọc từ storage thật theo `storage_key` → cần copy thư mục `demo-seed/` (từ
  `export-storage.mjs`) vào storage root của backend nếu muốn hiện.
- Ngưỡng "dữ liệu cũ" của bản đồ khuôn viên được nới qua 1 dòng `system_configs` (xoá cùng dữ liệu demo).

---

# (Bộ 2) TypeScript seed — `npm run demo:seed`


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

## Gỡ bỏ hoàn toàn sau khi demo xong

Làm theo thứ tự, trên **từng máy/server** đã chạy seed:

1. **Xoá dữ liệu trong DB + file ảnh trong storage:**
   ```bash
   npm run demo:seed -- purge     # gõ "yes"; phải thấy "✔ Sạch: không còn dữ liệu demo."
   ```
   Lệnh này xoá mọi dòng demo, file ảnh `demo-seed-snapshots/` (local hoặc s3), dữ liệu mock camera, và DROP luôn bảng `demo_seed_rows`. Không đụng dữ liệu thật hay seed migration cũ (`demo-seed/`, `@meetingsys.vn`).
2. **Kiểm tra lại:** `npm run demo:seed -- status` báo không còn gì.
3. **Nếu đã chạy mock camera:** ảnh mà mock camera upload qua BE không được purge xoá. Khôi phục DB từ backup (mục Deploy, bước 4) hoặc bỏ qua nếu không quan tâm.
4. **Xoá ảnh nguồn trên máy** (không có trong git, chỉ tốn dung lượng):
   ```bash
   rm -rf scripts/demo-camera-mock/images/faces/*.* scripts/demo-camera-mock/images/plates/*.* scripts/demo-camera-mock/images/crowd
   ```
5. **(Tuỳ chọn) Gỡ code demo khỏi máy:** chạy purge **trước**, vì xoá code rồi thì không còn lệnh purge.
   ```bash
   git checkout main
   git branch -D feature/demo-seed                # xoá nhánh local
   git push origin --delete feature/demo-seed     # xoá nhánh trên GitHub (chỉ 1 người làm)
   ```
   Nếu nhánh đã merge vào main thì thay vào đó tạo commit xoá thư mục `scripts/demo-seed`, `scripts/demo-camera-mock` và 3 lệnh `demo:*` trong `package.json`.
