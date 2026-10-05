import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * STT 5 (2026-10-05) — index cho các truy vấn báo cáo / xuất điểm danh.
 *
 * Trước: attendance_records, meeting_participants, room_bookings, meetings chỉ có
 * PK → mọi JOIN theo meeting_id / lọc start_time đều Seq Scan toàn bảng
 * (200k dòng ≈ 650 ms cho báo cáo chi tiết cuộc họp 1 tháng).
 * Migration AddKpiDashboardIndexes1770000000000 đã khai một phần index này nhưng
 * DB thực tế không có → tạo lại bằng tên mới + IF NOT EXISTS.
 *
 * ADD-ONLY: chỉ thêm index, không sửa/xóa cột hay dữ liệu.
 */
export class AddReportQueryIndexes20261005000002 implements MigrationInterface {
  name = 'AddReportQueryIndexes20261005000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Lấy điểm danh theo cuộc họp + người (JOIN báo cáo, danh sách điểm danh).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_records_meeting_user" ON "attendance_records" ("meeting_id", "user_id")`,
    );
    // Danh sách người tham dự theo cuộc họp.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_meeting_participants_meeting" ON "meeting_participants" ("meeting_id")`,
    );
    // Booking theo cuộc họp (JOIN meetings → room_bookings).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_room_bookings_meeting" ON "room_bookings" ("meeting_id")`,
    );
    // Lọc kỳ báo cáo theo start_time.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_meetings_start_time" ON "meetings" ("start_time")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_meetings_start_time"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_room_bookings_meeting"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meeting_participants_meeting"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_attendance_records_meeting_user"`,
    );
  }
}
