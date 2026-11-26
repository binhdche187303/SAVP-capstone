import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bổ sung khóa ngoại / UNIQUE / DEFAULT bị thiếu trên 4 bảng khách (visitors, visitor_visits,
 * visitor_visit_zones, visitor_visit_events) ở DB dựng từ bản dump.
 *
 * Cùng nguyên nhân với RestoreMissingCheckConstraints: bảng đã có sẵn (tạo từ entity, tên PK dạng
 * hash) nên `CREATE TABLE IF NOT EXISTS` của CreateVisitorTables (20261012000001) bị bỏ qua nguyên câu.
 * Hệ quả thấy được: xóa lượt khách không kéo theo visitor_visit_zones / visitor_visit_events
 * (thiếu ON DELETE CASCADE → dòng mồ côi), mã lượt có thể trùng, event_time không có DEFAULT now().
 * Định nghĩa giữ NGUYÊN như CreateVisitorTables.
 *
 * Kiểm tra theo CỘT, không theo tên: DB đã có khóa ngoại/UNIQUE trên cột đó (tên nào cũng được) → bỏ qua.
 * Dữ liệu cũ vi phạm → khóa ngoại thêm NOT VALID (chặn ghi mới) + cảnh báo; UNIQUE thì bỏ qua + cảnh báo.
 */
const FKS: ReadonlyArray<{ table: string; column: string; ref: string; onDelete: string; name: string }> = [
  { table: 'visitors', column: 'user_id', ref: 'users', onDelete: 'RESTRICT', name: 'FK_visitors_user' },
  { table: 'visitor_visits', column: 'visitor_id', ref: 'visitors', onDelete: 'RESTRICT', name: 'FK_visitor_visits_visitor' },
  { table: 'visitor_visits', column: 'host_user_id', ref: 'users', onDelete: 'RESTRICT', name: 'FK_visitor_visits_host' },
  { table: 'visitor_visits', column: 'department_id', ref: 'departments', onDelete: 'SET NULL', name: 'FK_visitor_visits_department' },
  { table: 'visitor_visits', column: 'last_seen_zone_id', ref: 'zones', onDelete: 'SET NULL', name: 'FK_visitor_visits_last_zone' },
  { table: 'visitor_visits', column: 'photo_file_id', ref: 'media_files', onDelete: 'SET NULL', name: 'FK_visitor_visits_photo' },
  { table: 'visitor_visits', column: 'created_by', ref: 'users', onDelete: 'SET NULL', name: 'FK_visitor_visits_created_by' },
  { table: 'visitor_visits', column: 'approved_by', ref: 'users', onDelete: 'SET NULL', name: 'FK_visitor_visits_approved_by' },
  { table: 'visitor_visit_zones', column: 'visit_id', ref: 'visitor_visits', onDelete: 'CASCADE', name: 'FK_visitor_visit_zones_visit' },
  { table: 'visitor_visit_zones', column: 'zone_id', ref: 'zones', onDelete: 'RESTRICT', name: 'FK_visitor_visit_zones_zone' },
  { table: 'visitor_visit_events', column: 'visit_id', ref: 'visitor_visits', onDelete: 'CASCADE', name: 'FK_visitor_visit_events_visit' },
  { table: 'visitor_visit_events', column: 'zone_id', ref: 'zones', onDelete: 'SET NULL', name: 'FK_visitor_visit_events_zone' },
  { table: 'visitor_visit_events', column: 'device_event_id', ref: 'iot_device_events', onDelete: 'SET NULL', name: 'FK_visitor_visit_events_device_event' },
  { table: 'visitor_visit_events', column: 'actor_user_id', ref: 'users', onDelete: 'SET NULL', name: 'FK_visitor_visit_events_actor' },
];

const UNIQUES: ReadonlyArray<{ table: string; column: string; name: string }> = [
  { table: 'visitors', column: 'user_id', name: 'UQ_visitors_user' },
  { table: 'visitor_visits', column: 'visit_code', name: 'UQ_visitor_visits_code' },
];

const warn = (msg: string) => console.warn(`[RestoreVisitorTableConstraints] ${msg}`);

export class RestoreVisitorTableConstraints20261125000003 implements MigrationInterface {
  name = 'RestoreVisitorTableConstraints20261125000003';

  public async up(q: QueryRunner): Promise<void> {
    for (const u of UNIQUES) {
      // Có UNIQUE (constraint hoặc index không điều kiện) đúng 1 cột này chưa?
      const has = (await q.query(
        `SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
          WHERE i.indrelid = to_regclass($1) AND i.indisunique AND i.indnatts = 1 AND i.indpred IS NULL AND a.attname = $2`,
        [u.table, u.column],
      )) as unknown[];
      if (has.length) continue;
      const [{ dup }] = (await q.query(
        `SELECT count(*)::int AS dup FROM (SELECT 1 FROM "${u.table}" WHERE "${u.column}" IS NOT NULL
           GROUP BY "${u.column}" HAVING count(*) > 1) d`,
      )) as Array<{ dup: number }>;
      if (dup > 0) {
        warn(`${u.table}.${u.column}: ${dup} giá trị trùng — CHƯA thêm ${u.name}, cần gộp/sửa dữ liệu trước.`);
        continue;
      }
      await q.query(`ALTER TABLE "${u.table}" ADD CONSTRAINT "${u.name}" UNIQUE ("${u.column}")`);
    }

    for (const f of FKS) {
      const has = (await q.query(
        `SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f' AND c.conrelid = to_regclass($1) AND array_length(c.conkey, 1) = 1 AND a.attname = $2`,
        [f.table, f.column],
      )) as unknown[];
      if (has.length) continue;
      const [{ orphan }] = (await q.query(
        `SELECT count(*)::int AS orphan FROM "${f.table}" t
          WHERE t."${f.column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${f.ref}" r WHERE r.id = t."${f.column}")`,
      )) as Array<{ orphan: number }>;
      await q.query(
        `ALTER TABLE "${f.table}" ADD CONSTRAINT "${f.name}" FOREIGN KEY ("${f.column}")
           REFERENCES "${f.ref}" ("id") ON DELETE ${f.onDelete} NOT VALID`,
      );
      if (orphan === 0) {
        await q.query(`ALTER TABLE "${f.table}" VALIDATE CONSTRAINT "${f.name}"`);
      } else {
        warn(
          `${f.table}.${f.column}: ${orphan} dòng trỏ tới ${f.ref} không tồn tại — đã thêm ${f.name} NOT VALID. ` +
            `Dọn dữ liệu rồi chạy: ALTER TABLE "${f.table}" VALIDATE CONSTRAINT "${f.name}"`,
        );
      }
    }

    await q.query(`ALTER TABLE "visitor_visit_events" ALTER COLUMN "event_time" SET DEFAULT now()`);
  }

  public async down(): Promise<void> {
    // Không gỡ: các ràng buộc này thuộc CreateVisitorTables. Trên DB dựng sạch migration này không thêm
    // gì, nên down() mà DROP sẽ xóa nhầm ràng buộc gốc.
  }
}
