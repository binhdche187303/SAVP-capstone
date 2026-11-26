import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bổ sung các CHECK constraint bị thiếu trên DB dựng từ bản dump.
 *
 * CreateAcademicTables (20261006000001) và CreateVisitorTables (20261012000001) dùng
 * `CREATE TABLE IF NOT EXISTS` — DB nào đã có sẵn bảng (khôi phục từ dump) thì cả câu bị bỏ qua,
 * nên các CHECK khai trong đó không bao giờ được tạo: ngày/giờ kết thúc trước bắt đầu, status lạ,
 * số tín chỉ âm... đều lọt. Định nghĩa dưới đây giữ NGUYÊN như 2 migration gốc (đã đối chiếu với
 * enum trong entity và VISIT_STATUSES / VISIT_CHANNELS hiện tại).
 *
 * - Constraint đã có (DB dựng sạch từ migration) → bỏ qua.
 * - Dữ liệu cũ không vi phạm → thêm và kiểm tra luôn.
 * - Dữ liệu cũ có dòng vi phạm → thêm NOT VALID (chặn ghi mới, không làm hỏng deploy) và cảnh báo;
 *   sửa dữ liệu xong thì chạy `ALTER TABLE <bảng> VALIDATE CONSTRAINT <tên>`.
 */
const CHECKS: ReadonlyArray<{ table: string; name: string; expr: string }> = [
  { table: 'semesters', name: 'CK_semesters_dates', expr: `"end_date" >= "start_date"` },
  { table: 'semesters', name: 'CK_semesters_status', expr: `"status" IN ('upcoming', 'ongoing', 'closed')` },
  { table: 'subjects', name: 'CK_subjects_credits', expr: `"credits" IS NULL OR "credits" >= 0` },
  { table: 'study_shifts', name: 'CK_study_shifts_time', expr: `"end_time" > "start_time"` },
  {
    table: 'students',
    name: 'CK_students_study_status',
    expr: `"study_status" IN ('studying', 'suspended', 'graduated', 'dropped_out')`,
  },
  {
    table: 'class_sections',
    name: 'CK_class_sections_max_students',
    expr: `"max_students" IS NULL OR "max_students" > 0`,
  },
  {
    table: 'class_sections',
    name: 'CK_class_sections_status',
    expr: `"status" IN ('planned', 'open', 'closed', 'cancelled')`,
  },
  { table: 'class_enrollments', name: 'CK_class_enrollments_status', expr: `"status" IN ('active', 'dropped')` },
  { table: 'class_sessions', name: 'CK_class_sessions_time', expr: `"end_time" > "start_time"` },
  {
    table: 'class_sessions',
    name: 'CK_class_sessions_status',
    expr: `"status" IN ('scheduled', 'ongoing', 'completed', 'cancelled')`,
  },
  {
    table: 'visitor_visits',
    name: 'CK_visitor_visits_schedule',
    expr: `"scheduled_to" > "scheduled_from" AND "valid_to" > "valid_from"`,
  },
  {
    table: 'visitor_visits',
    name: 'CK_visitor_visits_channel',
    expr: `"channel" IN ('online', 'host_invite', 'walk_in')`,
  },
  {
    table: 'visitor_visits',
    name: 'CK_visitor_visits_status',
    expr: `"status" IN ('pending_approval', 'approved', 'checked_in', 'checked_out', 'rejected', 'cancelled', 'revoked', 'expired', 'must_leave', 'exit_unrecorded')`,
  },
];

export class RestoreMissingCheckConstraints20261125000002 implements MigrationInterface {
  name = 'RestoreMissingCheckConstraints20261125000002';

  public async up(q: QueryRunner): Promise<void> {
    for (const { table, name, expr } of CHECKS) {
      const exists = (await q.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = to_regclass($2)`,
        [name, table],
      )) as unknown[];
      if (exists.length) continue;

      // CHECK coi NULL là đạt, nên đếm đúng các dòng mà Postgres sẽ từ chối.
      const [{ bad }] = (await q.query(
        `SELECT count(*)::int AS bad FROM "${table}" WHERE NOT (${expr})`,
      )) as Array<{ bad: number }>;

      await q.query(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expr}) NOT VALID`);
      if (bad === 0) {
        await q.query(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${name}"`);
      } else {
        console.warn(
          `[RestoreMissingCheckConstraints] ${table}.${name}: ${bad} dòng cũ vi phạm — đã thêm NOT VALID ` +
            `(chặn dữ liệu mới). Sửa dữ liệu rồi chạy: ALTER TABLE "${table}" VALIDATE CONSTRAINT "${name}"`,
        );
      }
    }
  }

  public async down(): Promise<void> {
    // Không gỡ: các constraint này thuộc CreateAcademicTables / CreateVisitorTables. Trên DB dựng sạch
    // migration này không thêm gì, nên down() mà DROP sẽ xóa nhầm constraint gốc.
  }
}
