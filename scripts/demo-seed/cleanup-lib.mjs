// Xoá toàn bộ dữ liệu demo: chỉ các dòng có id bắt đầu bằng DEMO_PREFIX.
// Không đụng dữ liệu thật. Thử xoá nhiều lượt (savepoint) để tự giải quyết thứ tự khoá ngoại.
import { DEMO_PREFIX } from './lib.mjs';

// Bảng có id uuid (thứ tự không quan trọng vì có vòng lặp thử lại; liệt kê cho đủ).
export const DEMO_TABLES = [
  'kpi_zone_hourly', 'kpi_vehicle_hourly', 'kpi_vehicle_plate_hourly', // xoá theo zone_id (xem dưới)
  'meeting_minutes_shares', 'meeting_minutes', 'meeting_notes', 'meeting_agendas',
  'meeting_events', 'meeting_external_participants', 'transcripts',
  'recording_segments', 'capture_session_channels', 'capture_sessions',
  'recording_sessions', 'recording_configs',
  'attendance_events', 'attendance_records', 'presence_snapshots',
  'room_booking_usages', 'room_events', 'no_show_cases', 'room_bookings',
  'meeting_requests', 'meeting_participants', 'meetings', 'meeting_recurrence_rules',
  'security_alerts', 'alert_rules',
  'gate_access_logs', 'zone_presence_events', 'iot_device_events',
  'person_control_list', 'vehicle_control_list', 'vehicle_registrations',
  'device_user_mappings', 'face_profiles',
  'class_enrollments', 'class_sessions', 'class_sections', 'students', 'subjects', 'semesters',
  'notifications', 'background_jobs', 'audit_logs',
  'equipments', 'iot_devices', 'zones', 'rooms',
  'media_files', 'user_roles', 'system_configs', 'users',
];

export async function cleanupDemo(c, { keepSnapshots = false } = {}) {
  const like = `${DEMO_PREFIX}%`;
  let removed = 0;

  // KPI: khoá theo zone_id của zone demo
  for (const t of ['kpi_zone_hourly', 'kpi_vehicle_hourly', 'kpi_vehicle_plate_hourly']) {
    const r = await c.query(`DELETE FROM public."${t}" WHERE zone_id::text LIKE $1`, [like]);
    removed += r.rowCount ?? 0;
  }

  let pending = DEMO_TABLES.filter((t) => !t.startsWith('kpi_'));
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next = [];
    for (const t of pending) {
      await c.query('SAVEPOINT cl');
      try {
        const r = await c.query(`DELETE FROM public."${t}" WHERE id::text LIKE $1`, [like]);
        removed += r.rowCount ?? 0;
        await c.query('RELEASE SAVEPOINT cl');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT cl');
        if (e.code === '23503') next.push(t); // còn bị tham chiếu → thử lại lượt sau
        else if (e.code === '42P01') { /* bảng không tồn tại → bỏ qua */ }
        else throw e;
      }
    }
    pending = next;
  }
  if (pending.length) throw new Error(`Không dọn được (vướng khoá ngoại): ${pending.join(', ')}`);
  // Ảnh snapshot đã tải lên storage backend (id do backend sinh, nhận diện qua file_code RSNAP-*).
  // Giữ lại khi chỉ nạp lại seed (đỡ phải tải lại); xoá hẳn khi dọn sau demo.
  if (!keepSnapshots) {
    const r = await c.query(`DELETE FROM public.media_files WHERE file_code LIKE 'RSNAP-%'`);
    removed += r.rowCount ?? 0;
  }
  return removed;
}
