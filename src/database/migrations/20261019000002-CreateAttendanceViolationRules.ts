import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lịch tuần UEL — cấu hình vi phạm điểm danh cuộc họp.
 * - attendance_violation_rules: hình thức + điểm trừ + mô tả điều kiện. 5 mã gốc (is_system) chỉ sửa/tắt,
 *   hình thức tự thêm là loại ghi nhận thủ công (thư ký/chủ trì chọn).
 * - attendance_records.penalty_points / violation_rule_code: điểm được CHỐT lúc ghi nhận (trigger),
 *   đổi cấu hình sau này không làm đổi điểm cuộc họp cũ.
 * - Mốc phút: attendance.late_grace_minutes = 5, attendance.early_leave_threshold_minutes = 15.
 * - Quyền attendance.violation_rule.manage → BUSINESS_ADMIN.
 */
export class CreateAttendanceViolationRules20261019000002 implements MigrationInterface {
  name = 'CreateAttendanceViolationRules20261019000002';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS attendance_violation_rules (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_code      varchar(50)  NOT NULL UNIQUE,
        rule_name      varchar(150) NOT NULL,
        penalty_points integer      NOT NULL DEFAULT 0,
        condition_text text,
        is_system      boolean      NOT NULL DEFAULT false,
        is_active      boolean      NOT NULL DEFAULT true,
        sort_order     integer      NOT NULL DEFAULT 100,
        updated_by     uuid,
        created_at     timestamptz  NOT NULL DEFAULT NOW(),
        updated_at     timestamptz  NOT NULL DEFAULT NOW()
      );
      INSERT INTO attendance_violation_rules (rule_code, rule_name, penalty_points, condition_text, is_system, sort_order) VALUES
        ('PRESENT',    'Có mặt',   0,  'Giờ vào ghi nhận không trễ quá mốc đi trễ so với giờ bắt đầu cuộc họp', true, 1),
        ('ABSENT',     'Vắng mặt', -2, 'Không ghi nhận giờ vào và không có lý do hoặc lý do không được duyệt', true, 2),
        ('LATE',       'Đi trễ',   -1, 'Giờ vào sau giờ bắt đầu cuộc họp quá mốc đi trễ', true, 3),
        ('LEFT_EARLY', 'Về sớm',   -1, 'Giờ ra trước giờ kết thúc cuộc họp quá mốc về sớm (camera ghi nhận hoặc thư ký ghi chú)', true, 4),
        ('EXCUSED',    'Vắng mặt/đi trễ/về sớm có lý do', 0, 'Thành viên tự nhập lý do và được chủ trì/thư ký duyệt', true, 5)
      ON CONFLICT (rule_code) DO NOTHING;

      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS penalty_points integer NULL;
      ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS violation_rule_code varchar(50) NULL;
    `);

    // Điểm = điểm hình thức chính (violation_rule_code nếu thư ký chọn, ngược lại suy từ attendance_status)
    //      + điểm "Về sớm" nếu vừa trễ/có mặt vừa ra sớm. EXCUSED ⇒ 0 tuyệt đối.
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

      DROP TRIGGER IF EXISTS trg_attendance_penalty ON attendance_records;
      CREATE TRIGGER trg_attendance_penalty BEFORE INSERT OR UPDATE ON attendance_records
        FOR EACH ROW EXECUTE FUNCTION fn_attendance_penalty();

      UPDATE attendance_records SET penalty_points = NULL;
    `);

    for (const [key, val, desc] of [
      ['attendance.late_grace_minutes', '5', 'Vào sau giờ bắt đầu quá số phút này thì ghi nhận đi trễ'],
      ['attendance.early_leave_threshold_minutes', '15', 'Ra trước giờ kết thúc quá số phút này thì ghi nhận về sớm'],
    ]) {
      await q.query(
        `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_sensitive, is_active, version_no)
         SELECT $1::varchar, $2::text, 'number', 'attendance', $3::text, false, true, 1
         WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = $1);`,
        [key, val, desc],
      );
    }

    await q.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       SELECT 'attendance.violation_rule.manage', 'Cấu hình vi phạm điểm danh', 'attendance', 'manage',
              'Thêm/sửa hình thức vi phạm, điểm trừ, mốc phút điểm danh cuộc họp', true
       WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'attendance.violation_rule.manage');`,
    );
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r, permissions p
       WHERE r.role_code = 'BUSINESS_ADMIN' AND p.permission_code = 'attendance.violation_rule.manage'
         AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = 'attendance.violation_rule.manage');
      DELETE FROM permissions WHERE permission_code = 'attendance.violation_rule.manage';
      DELETE FROM system_configs WHERE config_key = 'attendance.early_leave_threshold_minutes';
      DROP TRIGGER IF EXISTS trg_attendance_penalty ON attendance_records;
      DROP FUNCTION IF EXISTS fn_attendance_penalty();
      ALTER TABLE attendance_records DROP COLUMN IF EXISTS violation_rule_code;
      ALTER TABLE attendance_records DROP COLUMN IF EXISTS penalty_points;
      DROP TABLE IF EXISTS attendance_violation_rules;
    `);
  }
}
