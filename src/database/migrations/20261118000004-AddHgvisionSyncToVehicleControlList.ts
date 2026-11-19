import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đẩy biển số kiểm soát SAVP → HGVision: lưu trạng thái đồng bộ từng dòng.
 * - hgvision_sync_status: NULL (chưa từng đồng bộ) | pending (cờ ghi tắt) | synced | failed
 * - hgvision_synced_at: lần đẩy thành công gần nhất — có giá trị nghĩa là biển này do SAVP
 *   tạo trên HGVision, chỉ khi đó SAVP mới được xoá biển bên HGVision.
 * - hgvision_sync_error: lỗi gần nhất (đã cắt ngắn, không chứa token/secret).
 */
export class AddHgvisionSyncToVehicleControlList20261118000004 implements MigrationInterface {
  name = 'AddHgvisionSyncToVehicleControlList20261118000004';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE vehicle_control_list
        ADD COLUMN IF NOT EXISTS hgvision_sync_status varchar(16) NULL,
        ADD COLUMN IF NOT EXISTS hgvision_synced_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS hgvision_sync_error varchar(255) NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE vehicle_control_list
        DROP COLUMN IF EXISTS hgvision_sync_error,
        DROP COLUMN IF EXISTS hgvision_synced_at,
        DROP COLUMN IF EXISTS hgvision_sync_status
    `);
  }
}
