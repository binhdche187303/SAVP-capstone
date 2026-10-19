import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lịch tuần UEL — 3 nhóm lịch trên cuộc họp:
 * - UNIT: lịch đơn vị (calendar_department_id = đơn vị của người đặt) → trưởng phòng / văn thư đơn vị duyệt.
 * - SCHOOL_LEADERSHIP: lịch lãnh đạo trường (BGH chủ trì) → đơn vị duyệt cấp trường (P.HC) duyệt.
 * - SCHOOL_OTHER: lịch hoạt động khác → P.HC duyệt.
 * attendee_composition: "Thành phần tham gia" dạng chữ hiển thị trên lịch tuần.
 */
export class AddCalendarTypeToMeetings20261019000005 implements MigrationInterface {
  name = 'AddCalendarTypeToMeetings20261019000005';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS calendar_type varchar(30) NOT NULL DEFAULT 'UNIT';
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS calendar_department_id uuid NULL REFERENCES departments(id) ON DELETE SET NULL;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS attendee_composition text NULL;
      ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meetings_calendar_type;
      ALTER TABLE meetings ADD CONSTRAINT chk_meetings_calendar_type
        CHECK (calendar_type IN ('UNIT', 'SCHOOL_LEADERSHIP', 'SCHOOL_OTHER'));
      UPDATE meetings m SET calendar_department_id = u.department_id
        FROM users u WHERE u.id = m.organizer_id AND m.calendar_department_id IS NULL;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meetings_calendar_type;
      ALTER TABLE meetings DROP COLUMN IF EXISTS attendee_composition;
      ALTER TABLE meetings DROP COLUMN IF EXISTS calendar_department_id;
      ALTER TABLE meetings DROP COLUMN IF EXISTS calendar_type;
    `);
  }
}
