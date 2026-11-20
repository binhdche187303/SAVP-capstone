-- Dọn dữ liệu test "đẩy biển số SAVP → HGVision":
--   * Danh sách biển số giám sát: 99A-999.99 → 99A99999, 99A99998
--   * Xe đăng ký (Phương tiện cá nhân): 99A-999.97 → 99A99997, đổi biển → 99A99996 (có dòng "bia mộ" của 99A99997)
-- CHỈ chạy SAU KHI đã xoá các biển trên SAVP lúc cờ ghi còn bật
-- (SAVP xoá mềm + xoá luôn bên HGVision). Script này xoá hẳn các dòng đã xoá mềm trong DB SAVP.
-- Không đụng biển nào khác ngoài các biển test '99A99999', '99A99998', '99A99997', '99A99996'.

-- 1) Xem trước
SELECT id, plate_number, list_type, active, hgvision_sync_status, hgvision_synced_at, deleted_at
FROM vehicle_control_list
WHERE plate_number IN ('99A99999', '99A99998', '99A99997');

SELECT id, plate_number, status, hgvision_sync_status, hgvision_synced_at, deleted_at
FROM vehicle_registrations
WHERE plate_number IN ('99A99997', '99A99996');

-- 2) Xoá hẳn (bỏ comment khi đã kiểm tra kết quả bước 1)
-- DELETE FROM vehicle_control_list WHERE plate_number IN ('99A99999', '99A99998', '99A99997') AND deleted_at IS NOT NULL;
-- DELETE FROM vehicle_registrations WHERE plate_number IN ('99A99997', '99A99996') AND deleted_at IS NOT NULL;
