# Đồng bộ UEL: lấy lịch học đến hết năm học

Ngày: 2026-11-17 · Trạng thái: chờ duyệt

## Mục đích
Cần xem được lịch học **cả năm** trong hệ thống. Hiện mỗi lượt "đồng bộ toàn bộ" chỉ lấy lịch
từ hôm nay → +14 ngày (`uel_sync.session_days_ahead`, tối đa 120), trong khi UEL đã xếp lịch tới 9/7/2027.
Thời gian chạy không quan trọng: sẽ chạy tự động 02:00 hằng đêm.

## Mục tiêu / Không làm
- Mục tiêu: mỗi lượt đồng bộ toàn bộ (tự động và nút "Đồng bộ ngay") lấy lịch từ **hôm nay → hết năm học**,
  kèm lớp HP + đăng ký của **mọi học kỳ** xuất hiện trong khoảng đó (HK2, hè…).
- Không làm: lấy lại quá khứ (hướng C — để sau); đổi chu kỳ "mỗi N ngày"; gọn lại giao diện tổng thể;
  sửa lỗi trùng email / lọc khóa K22.
- Không được: hủy nhầm buổi học ở những ngày nghỉ dài (Tết, hè) khi API trả rỗng — giữ nguyên logic hiện có.

## Ràng buộc
UEL chỉ có API lịch theo 1 ngày (`thoikhoabieu/tkb_lophp_1ngay`) ⇒ vẫn gọi từng ngày (~290 lượt/đêm).
Sau review: bước lịch học tải lại TKB từng ngày (không dùng cache từ bước nhận học kỳ) để dữ liệu mới và không giữ TKB cả năm trong RAM; lượt toàn bộ được phép tối đa 400 ngày; chế độ học kỳ chỉ định bỏ qua buổi của kỳ khác.

## Các hướng đã cân nhắc
- **A. Lấy tới hết năm học mỗi đêm** — đơn giản, dữ liệu luôn mới; chạy lâu hơn (ước 1–2h). **Đã chọn.**
- B. Gần 14 ngày mỗi đêm + xa hằng tuần — nhẹ cho UEL nhưng 2 lịch chạy, phức tạp; không cần vì không ngại lâu.
- C. Thêm lấy từ đầu năm học (chỉ thêm buổi thiếu) — để sau.

## Thiết kế
1. **Ngày kết thúc** (`schoolYearEndOf`, giờ VN):
   - Tháng hiện tại ≥ 9 ⇒ 31/08 năm sau; còn lại ⇒ 31/08 năm nay (không theo năm học chỉ định — sau review).
   - Luôn tối thiểu hôm nay + 13 ngày (cuối tháng 8 vẫn có lịch 2 tuần tới của năm học mới).
2. `runAllPlanOf` dùng `toDate = schoolYearEndOf(...)` thay cho `sessionDaysAhead`. Bỏ giới hạn 120 ngày cho lượt toàn bộ.
3. Cài đặt `sessionDaysAhead` (*quyết định của mình*): bỏ khỏi giao diện và DTO; key `uel_sync.session_days_ahead`
   để nguyên trong DB, không còn đọc. Lượt đồng bộ chọn tay theo GV/SV (`POST /run`) giữ nguyên fromDate/toDate tự nhập.
4. Giao diện `UelSync.jsx`: thẻ "Đồng bộ ngay" ghi "lịch học từ hôm nay đến DD/MM/YYYY (hết năm học)"
   (BE trả `toDate` dự kiến trong `GET /status`), kèm ghi chú lượt chạy có thể mất 1–2 giờ.
5. Bật hẹn giờ: thêm `SCHEDULER_UEL_SYNC_ENABLED=true` vào `.env` (`.env.example` giữ `false` cho máy dev — sau review); người dùng bật tự động 02:00 hằng ngày trên trang.
6. Test: unit test `schoolYearEndOf` (tháng 11, tháng 3, cuối tháng 8, fixed) và `runAllPlanOf`; cập nhật spec/smoke test đang dùng `sessionDaysAhead`.

## Để người làm tự quyết
Tên hàm, cách hiển thị ngày trên FE, chi tiết cập nhật test hiện có.
