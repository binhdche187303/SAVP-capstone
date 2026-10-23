import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClassAttendanceAuditDetails20261022000001 implements MigrationInterface {
  name = 'AddClassAttendanceAuditDetails20261022000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE class_attendance_records
        ADD COLUMN IF NOT EXISTS manual_reason text,
        ADD COLUMN IF NOT EXISTS actor_user_id uuid,
        ADD COLUMN IF NOT EXISTS zone_id uuid,
        ADD COLUMN IF NOT EXISTS camera_group_id uuid,
        ADD COLUMN IF NOT EXISTS camera_id uuid
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS class_attendance_events (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        class_section_id uuid NOT NULL,
        student_id uuid NOT NULL,
        attendance_date date NOT NULL,
        direction varchar(10) NOT NULL,
        status varchar(20) NOT NULL,
        source varchar(30) NOT NULL,
        actor_user_id uuid,
        reason text,
        zone_id uuid,
        camera_group_id uuid,
        camera_id uuid,
        evidence_image text,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT PK_class_attendance_events PRIMARY KEY (id),
        CONSTRAINT FK_class_attendance_events_class FOREIGN KEY (class_section_id) REFERENCES class_sections(id) ON DELETE RESTRICT,
        CONSTRAINT FK_class_attendance_events_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
        CONSTRAINT FK_class_attendance_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS IDX_class_attendance_events_class_date ON class_attendance_events(class_section_id, attendance_date, occurred_at DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS IDX_class_attendance_events_student_date ON class_attendance_events(student_id, attendance_date, occurred_at DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS class_attendance_events`);
    await q.query(`ALTER TABLE class_attendance_records DROP COLUMN IF EXISTS camera_id, DROP COLUMN IF EXISTS camera_group_id, DROP COLUMN IF EXISTS zone_id, DROP COLUMN IF EXISTS actor_user_id, DROP COLUMN IF EXISTS manual_reason`);
  }
}
