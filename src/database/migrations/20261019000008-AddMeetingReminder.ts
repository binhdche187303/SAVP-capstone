import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nhắc trước cuộc họp: người đặt lịch chọn 0 (không nhắc) / 5 / 10 / 15 / 30 / 60 phút
 * (mặc định 10). Cron `notification-reminder` gửi thông báo in-app tới thành viên đúng
 * 1 lần — `reminder_sent_at` đánh dấu đã gửi, reset khi đổi giờ họp.
 */
export class AddMeetingReminder20261019000008 implements MigrationInterface {
  name = 'AddMeetingReminder20261019000008';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_minutes smallint NOT NULL DEFAULT 10;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz NULL;
      ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meetings_reminder_minutes;
      ALTER TABLE meetings ADD CONSTRAINT chk_meetings_reminder_minutes
        CHECK (reminder_minutes IN (0, 5, 10, 15, 30, 60));
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meetings_reminder_minutes;
      ALTER TABLE meetings DROP COLUMN IF EXISTS reminder_sent_at;
      ALTER TABLE meetings DROP COLUMN IF EXISTS reminder_minutes;
    `);
  }
}
