import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mẫu báo cáo áp dụng cho NHIỀU loại báo cáo: report_type (1 loại | NULL) → report_types varchar[].
 * - Mảng rỗng = dùng cho mọi loại báo cáo (tương đương report_type NULL cũ).
 * - Mặc định: không thể diễn đạt "không chồng loại" bằng unique index → bỏ index, service tự gỡ
 *   cờ mặc định của các mẫu chồng loại (trong transaction + advisory lock).
 */
export class ReportTemplateMultiType20261120000002 implements MigrationInterface {
  name = 'ReportTemplateMultiType20261120000002';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS report_types varchar(50)[] NOT NULL DEFAULT '{}'`);
    await q.query(`UPDATE report_templates SET report_types = ARRAY[report_type]::varchar(50)[] WHERE report_type IS NOT NULL`);
    await q.query(`DROP INDEX IF EXISTS "UQ_report_templates_default_scope"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_report_templates_type"`);
    await q.query(`ALTER TABLE report_templates DROP COLUMN IF EXISTS report_type`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_report_templates_types" ON report_templates USING gin (report_types) WHERE deleted_at IS NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_report_templates_types"`);
    await q.query(`ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS report_type varchar(50) NULL`);
    // Mẫu nhiều loại không quay về được 1 loại → lấy loại đầu tiên.
    await q.query(`UPDATE report_templates SET report_type = report_types[1]`);
    // Giữ tối đa một mặc định mỗi phạm vi trước khi dựng lại unique index.
    await q.query(`
      UPDATE report_templates t SET is_default = false
       WHERE t.is_default AND t.deleted_at IS NULL AND EXISTS (
         SELECT 1 FROM report_templates o
          WHERE o.is_default AND o.deleted_at IS NULL AND o.id <> t.id
            AND COALESCE(o.report_type, '*') = COALESCE(t.report_type, '*') AND o.updated_at > t.updated_at)`);
    await q.query(`ALTER TABLE report_templates DROP COLUMN IF EXISTS report_types`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_report_templates_default_scope" ON report_templates ((COALESCE(report_type, '*'))) WHERE is_default AND deleted_at IS NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_report_templates_type" ON report_templates (report_type) WHERE deleted_at IS NULL`);
  }
}
