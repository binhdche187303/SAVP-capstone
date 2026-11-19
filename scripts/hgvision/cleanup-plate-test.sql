-- Dọn dữ liệu test "đẩy biển số SAVP → HGVision" (biển 99A-999.99 → 99A99999).
-- CHỈ chạy SAU KHI đã xoá biển 99A-999.99 trên trang "Danh sách biển số giám sát" lúc cờ ghi còn bật
-- (SAVP xoá mềm + xoá luôn bên HGVision). Script này xoá hẳn các dòng đã xoá mềm trong DB SAVP.
-- Không đụng biển nào khác ngoài 2 biển test '99A99999' và '99A99998'.

-- 1) Xem trước
SELECT id, plate_number, list_type, active, hgvision_sync_status, hgvision_synced_at, deleted_at
FROM vehicle_control_list
WHERE plate_number IN ('99A99999', '99A99998');

-- 2) Xoá hẳn (bỏ comment khi đã kiểm tra kết quả bước 1)
-- DELETE FROM vehicle_control_list WHERE plate_number IN ('99A99999', '99A99998') AND deleted_at IS NOT NULL;
