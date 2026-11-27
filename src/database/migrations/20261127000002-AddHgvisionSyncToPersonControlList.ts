import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Danh sách người giám sát → danh sách đen khuôn mặt HGVision.
 * - hgvision_face_ident: định danh khuôn mặt trên HGVision (mã NV/SV của user, hoặc
 *   `WL-<id>` cho người ngoài SAVP tự đăng ký từ ảnh).
 * - hgvision_sync_status: NULL (chưa từng) | pending (cờ ghi tắt) | synced | failed
 * - hgvision_synced_at: lần đẩy thành công gần nhất — có giá trị với người ngoài nghĩa là
 *   khuôn mặt đó do SAVP tạo (được phép xoá khi gỡ khỏi danh sách).
 * - hgvision_sync_error: lỗi gần nhất (đã cắt ngắn).
 */
export class AddHgvisionSyncToPersonControlList20261127000002
  implements MigrationInterface
{
  name = 'AddHgvisionSyncToPersonControlList20261127000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE person_control_list
        ADD COLUMN IF NOT EXISTS hgvision_face_ident varchar(100) NULL,
        ADD COLUMN IF NOT EXISTS hgvision_sync_status varchar(16) NULL,
        ADD COLUMN IF NOT EXISTS hgvision_synced_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS hgvision_sync_error varchar(255) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE person_control_list
        DROP COLUMN IF EXISTS hgvision_sync_error,
        DROP COLUMN IF EXISTS hgvision_synced_at,
        DROP COLUMN IF EXISTS hgvision_sync_status,
        DROP COLUMN IF EXISTS hgvision_face_ident
    `);
  }
}
