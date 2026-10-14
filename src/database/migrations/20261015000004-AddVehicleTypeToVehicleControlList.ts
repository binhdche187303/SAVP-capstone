import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BUG-004: thêm loại phương tiện (tùy chọn) cho danh sách kiểm soát biển số.
 * NULL = "Không xác định" — dữ liệu cũ giữ NULL, không điền bù.
 */
export class AddVehicleTypeToVehicleControlList20261015000004 implements MigrationInterface {
  name = 'AddVehicleTypeToVehicleControlList20261015000004';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE vehicle_control_list ADD COLUMN IF NOT EXISTS vehicle_type varchar(20) NULL;`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE vehicle_control_list DROP COLUMN IF EXISTS vehicle_type;`,
    );
  }
}
