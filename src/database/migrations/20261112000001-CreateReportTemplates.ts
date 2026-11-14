import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mẫu báo cáo quy chuẩn (NĐ 30/2020) cho Trung tâm báo cáo.
 *
 * - report_templates.layout: JSON theo `ReportTemplateLayout` (src/modules/reports/templates/report-template.layout.ts).
 * - report_type NULL = dùng cho mọi loại báo cáo.
 * - Mỗi phạm vi (một loại, hoặc "mọi loại") có tối đa một mẫu mặc định — ràng buộc bằng unique index một phần.
 * - Quyền report.template.manage: tạm cấp SYSTEM_ADMIN + BUSINESS_ADMIN; phân quyền văn thư đơn vị làm sau.
 */
export class CreateReportTemplates20261112000001 implements MigrationInterface {
  name = 'CreateReportTemplates20261112000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS report_templates (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        name varchar(150) NOT NULL,
        report_type varchar(50) NULL,
        is_default boolean NOT NULL DEFAULT false,
        layout jsonb NOT NULL,
        created_by uuid NULL,
        updated_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT "PK_report_templates_id" PRIMARY KEY (id),
        CONSTRAINT "FK_report_templates_created_by" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT "FK_report_templates_updated_by" FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_report_templates_default_scope"
        ON report_templates ((COALESCE(report_type, '*'))) WHERE is_default AND deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS "IDX_report_templates_type" ON report_templates (report_type) WHERE deleted_at IS NULL;
    `);

    await q.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       SELECT 'report.template.manage', 'Quản lý mẫu báo cáo quy chuẩn', 'reports', 'manage', 'Tạo, sửa, xóa mẫu báo cáo quy chuẩn (NĐ 30)', true
        WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'report.template.manage');`,
    );
    await q.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, p.id, NOW() FROM roles r CROSS JOIN permissions p
        WHERE p.permission_code = 'report.template.manage' AND r.role_code IN ('SYSTEM_ADMIN', 'BUSINESS_ADMIN') AND r.is_active = true
          AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = 'report.template.manage');`);
    await q.query(`DELETE FROM permissions WHERE permission_code = 'report.template.manage';`);
    await q.query(`DROP TABLE IF EXISTS report_templates;`);
  }
}
