import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lịch UEL mục 12 / 13 / 16:
 *  - Nộp báo cáo trước họp: meetings.report_* + bảng meeting_report_submissions
 *    (mỗi người được giao một dòng; file lưu ở media_files, related_entity_type='meeting_report').
 *  - Trình ký kết luận: meetings.signoff_* + bảng meeting_signoff_logs (lịch sử trình / duyệt / trả lại).
 *  - Sự kiện lặp: dùng sẵn meeting_recurrence_rules + meetings.recurrence_rule_id / parent_meeting_id.
 */
export class MeetingReportSignoffRecurrence20261019000010 implements MigrationInterface {
  name = 'MeetingReportSignoffRecurrence20261019000010';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS report_required boolean NOT NULL DEFAULT false;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS report_deadline_minutes integer NULL;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS report_note text NULL;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS signoff_required boolean NOT NULL DEFAULT false;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS signoff_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS signoff_status varchar(20) NULL;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS signoff_minutes_id uuid NULL;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS signoff_note text NULL;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS signoff_at timestamptz NULL;
      ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meetings_signoff_status;
      ALTER TABLE meetings ADD CONSTRAINT chk_meetings_signoff_status
        CHECK (signoff_status IS NULL OR signoff_status IN ('pending', 'approved', 'returned'));

      CREATE TABLE IF NOT EXISTS meeting_report_submissions (
        meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_file_id uuid NULL,
        submitted_at timestamptz NULL,
        reminded_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY (meeting_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS meeting_signoff_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        minutes_id uuid NULL,
        action varchar(20) NOT NULL CHECK (action IN ('submitted', 'approved', 'returned')),
        actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        note text NULL,
        created_at timestamptz NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_meeting_signoff_logs_meeting ON meeting_signoff_logs(meeting_id, created_at);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS meeting_signoff_logs;
      DROP TABLE IF EXISTS meeting_report_submissions;
      ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meetings_signoff_status;
      ALTER TABLE meetings DROP COLUMN IF EXISTS signoff_at;
      ALTER TABLE meetings DROP COLUMN IF EXISTS signoff_note;
      ALTER TABLE meetings DROP COLUMN IF EXISTS signoff_minutes_id;
      ALTER TABLE meetings DROP COLUMN IF EXISTS signoff_status;
      ALTER TABLE meetings DROP COLUMN IF EXISTS signoff_user_id;
      ALTER TABLE meetings DROP COLUMN IF EXISTS signoff_required;
      ALTER TABLE meetings DROP COLUMN IF EXISTS report_note;
      ALTER TABLE meetings DROP COLUMN IF EXISTS report_deadline_minutes;
      ALTER TABLE meetings DROP COLUMN IF EXISTS report_required;
    `);
  }
}
