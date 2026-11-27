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
