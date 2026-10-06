/**
 * STT 19 (2026-10-08) — cờ danh sách đen (isBlacklisted/listType) cho màn lịch sử ANPR,
 * dùng chung VehicleHistoryService + VehicleUnknownService.
 *
 * Trước: LEFT JOIN security_alerts qua source_event_id. SAI cho hầu hết lượt xe trong
 * danh sách: security_alerts chỉ giữ 1 alert MỞ / (alert_type, zone)
 * (UQ_security_alerts_open_type_*) — lượt sau chỉ bumpOccurrence() vào payload_json.occurrences,
 * source_event_id giữ của lượt ĐẦU → mọi lượt sau (kể cả xe khác) hiện false; thêm cả
 * throttle 300s/plate của evaluate().
 *
 * Nay: tra thẳng vehicle_control_list theo biển, chỉ tính dòng TỒN TẠI tại event_time
 * (created_at <= event_time, chưa soft-delete tại thời điểm đó) → thêm biển vào danh sách
 * hôm nay KHÔNG gắn cờ ngược cho lượt cũ. `active` là trạng thái HIỆN TẠI (bảng không lưu
 * lịch sử bật/tắt) — giới hạn đã chấp nhận. event_time là giờ camera, created_at giờ server
 * → lệch vài giây ở biên, không đáng kể.
 *
 * DATA-02: 1 biển có thể có cả blocklist + watchlist → ORDER BY list_type ASC ưu tiên
 * 'blocklist' (mirror VehicleControlListService.checkControlList). LIMIT 1 → không nhân dòng.
 *
 * Yêu cầu: bảng iot_device_events KHÔNG alias (tham chiếu `iot_device_events.` trực tiếp).
 */
export const CONTROL_LIST_FLAG_JOIN = `LEFT JOIN LATERAL (
           SELECT vcl.list_type
             FROM vehicle_control_list vcl
            WHERE vcl.plate_number = iot_device_events.payload_json->>'plateNumber'
              AND vcl.active = true
              AND vcl.created_at <= iot_device_events.event_time
              AND (vcl.deleted_at IS NULL OR vcl.deleted_at > iot_device_events.event_time)
            ORDER BY vcl.list_type ASC
            LIMIT 1
         ) vcl ON true`;

/** Cột SELECT tương ứng — giữ nguyên tên is_blacklisted/list_type (response API không đổi). */
export const CONTROL_LIST_FLAG_COLUMNS = `vcl.list_type IS NOT NULL AS is_blacklisted,
              vcl.list_type             AS list_type`;
