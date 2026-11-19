import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đẩy xe đăng ký (Phương tiện cá nhân / Đăng ký xe nhân viên) → HGVision dạng "Bình thường".
 * Cùng 3 cột như vehicle_control_list (migration 20261118000004):
 * - hgvision_sync_status: NULL | pending (cờ ghi tắt) | synced | failed
 * - hgvision_synced_at: có giá trị = biển do SAVP tạo trên HGVision (được phép xoá bên đó)
 * - hgvision_sync_error: lỗi gần nhất (đã cắt ngắn, không chứa token/secret)
 */
export class AddHgvisionSyncToVehicleRegistrations20261119000001 implements MigrationInterface {
  name = 'AddHgvisionSyncToVehicleRegistrations20261119000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE vehicle_registrations
        ADD COLUMN IF NOT EXISTS hgvision_sync_status varchar(16) NULL,
        ADD COLUMN IF NOT EXISTS hgvision_synced_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS hgvision_sync_error varchar(255) NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE vehicle_registrations
        DROP COLUMN IF EXISTS hgvision_sync_error,
        DROP COLUMN IF EXISTS hgvision_synced_at,
        DROP COLUMN IF EXISTS hgvision_sync_status
    `);
  }
}
