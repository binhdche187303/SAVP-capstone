import { EntityManager } from 'typeorm';

/**
 * Serialize ghi booking theo phòng trong 1 transaction (pg_advisory_xact_lock).
 * Lock tự nhả khi transaction commit/rollback. Nhiều phòng → khóa theo thứ tự id
 * đã sort để tránh deadlock. Phải gọi TRƯỚC khi re-check conflict bằng `em`.
 */
export async function lockRoomsForBooking(
  em: EntityManager,
  roomIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set(roomIds.filter((id): id is string => !!id))].sort();
  for (const id of ids) {
    await em.query(
      `SELECT pg_advisory_xact_lock(hashtext('room_booking:' || $1::text))`,
      [id],
    );
  }
}
