import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: partial index cho cron notification-reminder (MeetingReminderDispatchService),
 * chạy mỗi phút tìm nhắc lịch hẹn giờ đã tới hạn:
 *   WHERE delivery_status = 'draft' AND scheduled_send_at <= now()
 * Chỉ chứa bản ghi draft có hẹn giờ (rất ít) nên không phải quét cả bảng notifications.
 *
 * Index-only — không thay đổi schema cột/bảng.
 */
export class AddNotificationsScheduledDueIndex20261019000011 implements MigrationInterface {
  name = 'AddNotificationsScheduledDueIndex20261019000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_notifications_scheduled_due
      ON notifications (scheduled_send_at)
      WHERE delivery_status = 'draft' AND scheduled_send_at IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS ix_notifications_scheduled_due;
    `);
  }
}
