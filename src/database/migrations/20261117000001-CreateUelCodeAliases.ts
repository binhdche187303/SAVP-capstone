import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đồng bộ UEL — mã phụ.
 *
 * UEL có người mang 2 mã cùng 1 email (vd học viên SĐH lớp "-DB" và "-2", cán bộ cơ hữu kiêm
 * thỉnh giảng). users.email là duy nhất và mỗi tài khoản chỉ có 1 hồ sơ SV ⇒ mã thứ hai được
 * lưu ở đây, trỏ về tài khoản chính; đăng ký / lịch dạy theo mã phụ gắn vào đúng người.
 */
export class CreateUelCodeAliases20261117000001 implements MigrationInterface {
  name = 'CreateUelCodeAliases20261117000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS uel_code_aliases (
        kind varchar(10) NOT NULL,
        alias_code varchar(50) NOT NULL,
        user_id uuid NOT NULL,
        primary_code varchar(50) NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_synced_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_uel_code_aliases" PRIMARY KEY (kind, alias_code),
        CONSTRAINT "FK_uel_code_aliases_user" FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT "CK_uel_code_aliases_kind" CHECK (kind IN ('staff', 'student'))
      );
      CREATE INDEX IF NOT EXISTS "IDX_uel_code_aliases_user" ON uel_code_aliases (user_id);
    `);
    await q.query(
      `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_active)
       SELECT 'uel_sync.interval_days', '3', 'number', 'uel_sync',
              'Số ngày giữa 2 lần đồng bộ UEL tự động khi chọn "Mỗi N ngày" (2..90).', true
        WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = 'uel_sync.interval_days')`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS uel_code_aliases`);
    await q.query(
      `DELETE FROM system_configs WHERE config_key = 'uel_sync.interval_days'`,
    );
  }
}
