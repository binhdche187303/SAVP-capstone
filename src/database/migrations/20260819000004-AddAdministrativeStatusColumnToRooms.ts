import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * feat-room-realtime-status: them cot administrative_status cho rooms, tach
 * bach khoi current_status (cot nay do OccupancyPersistenceService ghi tu
 * presence camera, CHI TUNG flip sang 'occupied', KHONG BAO GIO reset —
 * xem BAO_CAO tuong ung 2026-08-19). administrative_status la co the CHU
 * DONG do admin dat qua PATCH /rooms/:roomId/administrative-status, chi nhan
 * 'available' | 'maintenance' | 'inactive', uu tien cao nhat khi tinh trang
 * thai hien thi real-time (RoomSearchService/RoomStatusService). Default
 * 'available' de khop hanh vi cu (phong hien co coi nhu khong bi override).
 */
export class AddAdministrativeStatusColumnToRooms20260819000004
  implements MigrationInterface
{
  name = 'AddAdministrativeStatusColumnToRooms20260819000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "administrative_status" varchar(20) NOT NULL DEFAULT 'available'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP COLUMN "administrative_status"`,
    );
  }
}
