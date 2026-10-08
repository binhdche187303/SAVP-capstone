import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A1 Lớp 2 (2026-10-05) — chặn double-booking ngay ở tầng DB.
 *
 * Lớp 1 (pg_advisory_xact_lock trong create/approve/extension) đã chặn race ở
 * các luồng hiện có. Constraint này là lưới an toàn cho luồng tương lai quên
 * gọi lockRoomsForBooking và cho ghi thẳng bằng SQL/script: cùng phòng KHÔNG
 * được có 2 booking approved/active giao nhau. Range `[)` → lịch nối đuôi
 * (end = start kế) KHÔNG tính là trùng. Buffer giữa 2 lịch là cấu hình động
 * nên vẫn do app kiểm (Lớp 1), constraint chỉ chặn trùng thật.
 *
 * Vi phạm → Postgres 23P01, QueryFailedFilter map sang 409 ROOM_CONFLICT.
 * ADD-ONLY: thêm extension + constraint, không sửa/xóa cột.
 */
export class AddRoomBookingNoOverlapExclusion20261005000001
  implements MigrationInterface
{
  name = 'AddRoomBookingNoOverlapExclusion20261005000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Báo lỗi rõ ràng thay vì để ADD CONSTRAINT fail khó đọc khi còn data trùng.
    const overlaps: Array<{ c: string }> = await queryRunner.query(`
      SELECT count(*)::text AS c
        FROM room_bookings x
        JOIN room_bookings y
          ON x.room_id = y.room_id AND x.id < y.id
         AND x.reserved_start_time < y.reserved_end_time
         AND y.reserved_start_time < x.reserved_end_time
       WHERE x.status IN ('approved','active')
         AND y.status IN ('approved','active')`);
    if (Number(overlaps[0]?.c ?? 0) > 0) {
      throw new Error(
        `room_bookings còn ${overlaps[0].c} cặp booking approved/active trùng phòng/giờ — dọn trước khi chạy migration này.`,
      );
    }

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'ex_room_bookings_no_overlap'
        ) THEN
          ALTER TABLE "room_bookings"
            ADD CONSTRAINT "ex_room_bookings_no_overlap"
            EXCLUDE USING gist (
              "room_id" WITH =,
              tstzrange("reserved_start_time", "reserved_end_time", '[)') WITH &&
            ) WHERE ("status" IN ('approved', 'active'));
        END IF;
      END $$;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Giữ extension btree_gist — có thể đã được dùng chỗ khác.
    await queryRunner.query(
      `ALTER TABLE "room_bookings" DROP CONSTRAINT IF EXISTS "ex_room_bookings_no_overlap"`,
    );
  }
}
