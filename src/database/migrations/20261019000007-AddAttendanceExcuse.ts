import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lý do vắng mặt / đi trễ / về sớm do thành viên tự nhập (mỗi người 1 lần / cuộc họp,
 * gửi trước hoặc tới 24 giờ sau khi họp kết thúc); chủ trì / thư ký duyệt hoặc từ chối.
 * Duyệt ⇒ fn_attendance_penalty tính hình thức EXCUSED (0 điểm).
 */
export class AddAttendanceExcuse20261019000007 implements MigrationInterface {
  name = 'AddAttendanceExcuse20261019000007';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS excuse_reason text NULL;
      ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS excuse_status varchar(20) NULL;
      ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS excuse_submitted_at timestamptz NULL;
      ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS excuse_reviewed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS excuse_reviewed_at timestamptz NULL;
      ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS excuse_review_note text NULL;
      ALTER TABLE meeting_participants DROP CONSTRAINT IF EXISTS chk_meeting_participants_excuse_status;
      ALTER TABLE meeting_participants ADD CONSTRAINT chk_meeting_participants_excuse_status
        CHECK (excuse_status IS NULL OR excuse_status IN ('pending', 'approved', 'rejected'));
    `);
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_attendance_penalty() RETURNS trigger AS $$
      DECLARE
        main_code text;
        pts integer;
        early integer;
      BEGIN
        IF TG_OP = 'UPDATE'
           AND NEW.attendance_status IS NOT DISTINCT FROM OLD.attendance_status
           AND NEW.left_early IS NOT DISTINCT FROM OLD.left_early
           AND NEW.violation_rule_code IS NOT DISTINCT FROM OLD.violation_rule_code
           AND NEW.penalty_points IS NOT NULL THEN
          RETURN NEW;
        END IF;

        -- Lý do vắng/trễ/về sớm đã được chủ trì/thư ký duyệt ⇒ EXCUSED (0 điểm).
        IF EXISTS (SELECT 1 FROM meeting_participants mp
                    WHERE mp.meeting_id = NEW.meeting_id AND mp.user_id = NEW.user_id
                      AND mp.excuse_status = 'approved') THEN
          main_code := 'EXCUSED';
        ELSE
        main_code := COALESCE(NEW.violation_rule_code, CASE NEW.attendance_status
          WHEN 'present' THEN 'PRESENT' WHEN 'late' THEN 'LATE'
          WHEN 'absent' THEN 'ABSENT' WHEN 'left_early' THEN 'LEFT_EARLY' END);
        END IF;
        IF main_code IS NULL THEN
          NEW.penalty_points := NULL; -- pending_review / invalidated: chưa chốt
          RETURN NEW;
        END IF;

        SELECT penalty_points INTO pts FROM attendance_violation_rules WHERE rule_code = main_code;
        IF main_code <> 'EXCUSED' AND main_code <> 'LEFT_EARLY' AND NEW.left_early THEN
          SELECT penalty_points INTO early FROM attendance_violation_rules WHERE rule_code = 'LEFT_EARLY';
          pts := COALESCE(pts, 0) + COALESCE(early, 0);
        END IF;
        NEW.penalty_points := COALESCE(pts, 0);
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION fn_attendance_penalty() RETURNS trigger AS $$
      DECLARE
        main_code text;
        pts integer;
        early integer;
      BEGIN
        IF TG_OP = 'UPDATE'
           AND NEW.attendance_status IS NOT DISTINCT FROM OLD.attendance_status
           AND NEW.left_early IS NOT DISTINCT FROM OLD.left_early
           AND NEW.violation_rule_code IS NOT DISTINCT FROM OLD.violation_rule_code
           AND NEW.penalty_points IS NOT NULL THEN
          RETURN NEW;
        END IF;

        main_code := COALESCE(NEW.violation_rule_code, CASE NEW.attendance_status
          WHEN 'present' THEN 'PRESENT' WHEN 'late' THEN 'LATE'
          WHEN 'absent' THEN 'ABSENT' WHEN 'left_early' THEN 'LEFT_EARLY' END);
        IF main_code IS NULL THEN
          NEW.penalty_points := NULL; -- pending_review / invalidated: chưa chốt
          RETURN NEW;
        END IF;

        SELECT penalty_points INTO pts FROM attendance_violation_rules WHERE rule_code = main_code;
        IF main_code <> 'EXCUSED' AND main_code <> 'LEFT_EARLY' AND NEW.left_early THEN
          SELECT penalty_points INTO early FROM attendance_violation_rules WHERE rule_code = 'LEFT_EARLY';
          pts := COALESCE(pts, 0) + COALESCE(early, 0);
        END IF;
        NEW.penalty_points := COALESCE(pts, 0);
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
    await q.query(`
      ALTER TABLE meeting_participants DROP CONSTRAINT IF EXISTS chk_meeting_participants_excuse_status;
      ALTER TABLE meeting_participants DROP COLUMN IF EXISTS excuse_review_note;
      ALTER TABLE meeting_participants DROP COLUMN IF EXISTS excuse_reviewed_at;
      ALTER TABLE meeting_participants DROP COLUMN IF EXISTS excuse_reviewed_by;
      ALTER TABLE meeting_participants DROP COLUMN IF EXISTS excuse_submitted_at;
      ALTER TABLE meeting_participants DROP COLUMN IF EXISTS excuse_status;
      ALTER TABLE meeting_participants DROP COLUMN IF EXISTS excuse_reason;
    `);
  }
}
