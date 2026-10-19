import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lịch tuần UEL: khi đăng ký chọn cuộc họp có điểm danh hay không.
 * Mặc định true ⇒ dữ liệu cũ giữ hành vi hiện tại.
 */
export class AddAttendanceEnabledToMeetings20261019000001 implements MigrationInterface {
  name = 'AddAttendanceEnabledToMeetings20261019000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE meetings ADD COLUMN IF NOT EXISTS attendance_enabled boolean NOT NULL DEFAULT true;`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE meetings DROP COLUMN IF EXISTS attendance_enabled;`);
  }
}
