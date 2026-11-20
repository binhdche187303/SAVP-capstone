import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier 2 demo data: room_booking_usages, room_events, 1 no_show_cases, attendance_records,
 * attendance_events, presence_snapshots — suy ra tu tap meeting/room_bookings/
 * meeting_participants demo da tao o 20260720000007/20260720000008 (loc theo
 * meeting_code LIKE 'MTG-2026-%' de khong dung cham du lieu that ngoai demo).
 *
 * Dung INSERT ... SELECT set-based tren meeting_participants/room_bookings thay vi
 * liet ke tung dong bang JS, vi so luong ban ghi phu thuoc truc tiep vao participant
 * cua tung meeting da seed truoc do.
 */
export class SeedDemoAttendancePresenceUsage20260720000009 implements MigrationInterface {
  name = 'SeedDemoAttendancePresenceUsage20260720000009';

  /** Dữ liệu demo đã gỡ khỏi luồng migration — chỉ giữ data thật. down() vẫn dọn được demo cũ. */
  public async up(): Promise<void> {}

  /** Seed demo cũ — không còn chạy tự động. */
  public async seedDemo(queryRunner: QueryRunner): Promise<void> {
    // room_booking_usages: 1 dong cho moi booking completed/active co room.
    await queryRunner.query(
      `INSERT INTO room_booking_usages (
         booking_id, meeting_id, room_id, reserved_start_time, reserved_end_time,
         actual_start_time, actual_end_time, first_presence_at, last_presence_at,
         usage_status, occupancy_source, occupancy_confidence
       )
       SELECT rb.id, mt.id, rb.room_id, rb.reserved_start_time, rb.reserved_end_time,
              mt.actual_start_time, mt.actual_end_time, mt.actual_start_time, mt.actual_end_time,
              CASE WHEN mt.status = 'completed' THEN 'completed' ELSE 'in_use' END,
              'manual', 95.00
       FROM room_bookings rb
       JOIN meetings mt ON mt.id = rb.meeting_id
       WHERE mt.meeting_code LIKE 'MTG-2026-%' AND mt.status IN ('completed', 'in_progress')
         AND NOT EXISTS (SELECT 1 FROM room_booking_usages rbu WHERE rbu.booking_id = rb.id);`,
    );

    // room_events: occupancy_detected luc bat dau, room_released luc ket thuc (completed).
    await queryRunner.query(
      `INSERT INTO room_events (room_id, meeting_id, booking_id, event_type, event_time, source_type, new_status, occupancy_count, description)
       SELECT rb.room_id, mt.id, rb.id, 'occupancy_detected', mt.actual_start_time, 'camera', 'occupied',
              (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = mt.id),
              'Phat hien co nguoi trong phong (demo seed)'
       FROM room_bookings rb
       JOIN meetings mt ON mt.id = rb.meeting_id
       WHERE mt.meeting_code LIKE 'MTG-2026-%' AND mt.status IN ('completed', 'in_progress') AND mt.actual_start_time IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM room_events re WHERE re.booking_id = rb.id AND re.event_type = 'occupancy_detected');`,
    );
    await queryRunner.query(
      `INSERT INTO room_events (room_id, meeting_id, booking_id, event_type, event_time, source_type, old_status, new_status, description)
       SELECT rb.room_id, mt.id, rb.id, 'room_released', mt.actual_end_time, 'system', 'occupied', 'available',
              'Phong duoc giai phong sau khi hop ket thuc (demo seed)'
       FROM room_bookings rb
       JOIN meetings mt ON mt.id = rb.meeting_id
       WHERE mt.meeting_code LIKE 'MTG-2026-%' AND mt.status = 'completed' AND mt.actual_end_time IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM room_events re WHERE re.booking_id = rb.id AND re.event_type = 'room_released');`,
    );

    // 1 no_show_cases: gan voi booking cua meeting da bi huy (MTG-2026-011) — kich ban:
    // phat hien nguy co no-show (khong ai check-in dung gio), sau do host tu huy hop thay
    // vi de he thong tu dong giai phong phong.
    await queryRunner.query(
      `INSERT INTO no_show_cases (booking_id, meeting_id, room_id, detection_status, detected_at, resolved_by, resolution_status, note)
       SELECT rb.id, mt.id, rb.room_id, 'resolved', mt.start_time + interval '10 minutes',
              (SELECT id FROM users WHERE lower(username) = 'sysadmin'), 'manual_override',
              'Khong co participant check-in sau 10 phut; host huy hop truc tiep thay vi de he thong giai phong phong (demo seed)'
       FROM room_bookings rb
       JOIN meetings mt ON mt.id = rb.meeting_id
       WHERE mt.meeting_code = 'MTG-2026-011'
         AND NOT EXISTS (SELECT 1 FROM no_show_cases nsc WHERE nsc.booking_id = rb.id);`,
    );

    // attendance_records: 1 dong cho moi participant cua meeting completed, mac dinh 'present'.
    await queryRunner.query(
      `INSERT INTO attendance_records (
         meeting_id, participant_id, user_id, check_in_method, attendance_source,
         check_in_time, check_out_time, is_present, is_late, presence_duration_minutes,
         attendance_status, verified_by, verified_at
       )
       SELECT mp.meeting_id, mp.id, mp.user_id, 'system', 'mixed',
              mt.actual_start_time + interval '3 minutes', mt.actual_end_time,
              true, false, EXTRACT(EPOCH FROM (mt.actual_end_time - mt.actual_start_time)) / 60,
              'present', (SELECT id FROM users WHERE lower(username) = 'sysadmin'), mt.actual_end_time
       FROM meeting_participants mp
       JOIN meetings mt ON mt.id = mp.meeting_id
       WHERE mt.meeting_code LIKE 'MTG-2026-%' AND mt.status = 'completed'
         AND NOT EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.meeting_id = mt.id AND ar.user_id = mp.user_id);`,
    );

    // Da dang hoa: danh dau 1 nguoi den tre (MTG-2026-004, emp.it2) va 1 nguoi vang (MTG-2026-008, emp.hr2).
    await queryRunner.query(
      `UPDATE attendance_records ar SET is_late = true, late_minutes = 12, attendance_status = 'late',
         check_in_time = mt.actual_start_time + interval '12 minutes'
       FROM meetings mt, users u
       WHERE ar.meeting_id = mt.id AND ar.user_id = u.id
         AND mt.meeting_code = 'MTG-2026-004' AND lower(u.username) = 'emp.it2';`,
    );
    await queryRunner.query(
      `UPDATE attendance_records ar SET is_present = false, attendance_status = 'absent',
         check_in_time = NULL, check_out_time = NULL, presence_duration_minutes = NULL
       FROM meetings mt, users u
       WHERE ar.meeting_id = mt.id AND ar.user_id = u.id
         AND mt.meeting_code = 'MTG-2026-008' AND lower(u.username) = 'emp.hr2';`,
    );

    // attendance_events: 1 check_in event cho moi attendance_record 'present'/'late'.
    await queryRunner.query(
      `INSERT INTO attendance_events (meeting_id, attendance_record_id, user_id, room_id, event_type, event_time, source_type)
       SELECT ar.meeting_id, ar.id, ar.user_id, mt.room_id, 'check_in', ar.check_in_time, 'system'
       FROM attendance_records ar
       JOIN meetings mt ON mt.id = ar.meeting_id
       WHERE mt.meeting_code LIKE 'MTG-2026-%' AND ar.check_in_time IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM attendance_events ae WHERE ae.attendance_record_id = ar.id AND ae.event_type = 'check_in');`,
    );

    // presence_snapshots: 1 snapshot dau gio cho moi meeting completed/in_progress.
    await queryRunner.query(
      `INSERT INTO presence_snapshots (meeting_id, room_id, presence_status, occupancy_count, snapshot_time, source_type, confidence_score)
       SELECT mt.id, mt.room_id, 'present',
              (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = mt.id),
              mt.actual_start_time, 'camera', 92.50
       FROM meetings mt
       WHERE mt.meeting_code LIKE 'MTG-2026-%' AND mt.status IN ('completed', 'in_progress')
         AND mt.room_id IS NOT NULL AND mt.actual_start_time IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM presence_snapshots ps WHERE ps.meeting_id = mt.id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const meetingFilter = `SELECT id FROM meetings WHERE meeting_code LIKE 'MTG-2026-%'`;
    await queryRunner.query(
      `DELETE FROM presence_snapshots WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM attendance_events WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM attendance_records WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM no_show_cases WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM room_events WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM room_booking_usages WHERE meeting_id IN (${meetingFilter});`,
    );
  }
}
