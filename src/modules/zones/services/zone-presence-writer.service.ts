import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Input ghi một dòng `appear` vào `zone_presence_events` (ZPW-001 / UC-109).
 * `eventTime` TỪ `evt.utc` (parseUtc, KHÔNG now()). `metadata` gồm { channelId, szUid,
 * similarity, sourceEventId } (nhánh B: link raw event qua JSONB, KHÔNG cột event_id).
 *
 * [FIX 2026-08-19] `userId` giờ NULLABLE — trước đây bắt buộc NOT NULL vì
 * `restricted-zone-intrusion.isViolation()` coi NULL = vi phạm nên `ivss` chặn không cho ghi
 * userId=null, khiến isViolation() không bao giờ nhận được input đó để đánh giá (người lạ hoàn
 * toàn "biến mất" khỏi cả zone_presence_events lẫn đánh giá xâm nhập khu vực hạn chế). Giờ
 * `ivss` chuyển thẳng userId (kể cả null) xuống đây — cột `zone_presence_events.user_id` vốn
 * đã nullable ở DB (không cần migration), `isViolation()` đã sẵn NULL-safe từ trước.
 */
export interface WriteAppearInput {
  zoneId: string;
  userId: string | null;
  eventTime: Date;
  deviceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Input ghi một dòng `count` vào `zone_presence_events` (F3, recon B5 — nguồn dữ liệu
 * cho crowd-alert/zone-traffic-heatmap, trước đây KHÔNG có gì ghi event_type='count').
 * KHÔNG có `userId` (đếm số lượng, không gắn 1 người cụ thể).
 */
export interface WriteCountInput {
  zoneId: string;
  occupancyCount: number;
  eventTime: Date;
  deviceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Kết quả validate zone khu vực (đọc, không ghi) — để `ivss` biết type TRƯỚC INSERT raw. */
export type ResolvePresenceZoneResult =
  | { valid: true }
  | { valid: false; reason: 'zone_wrong_type' };

/** Loại zone hợp lệ cho `appear` (QC-5). Trùng PRESENCE_ZONE_TYPES bên ivss — chủ ý ở phía chủ bảng. */
const PRESENCE_ZONE_TYPES = ['corridor', 'lobby', 'parking'];

// [FIX 2026-08-18] Dedupe writeCountEvent(): camera bắn count-event mỗi ~2-4s, đọc CÙNG
// giá trị khi đám đông không đổi → nhiều row trùng hệt nhau trong zone_presence_events,
// khiến cron evaluateCrowdAlerts() (EVERY_MINUTE) quét lại số row lớn bất thường mỗi tick.
// Mirror ĐÚNG pattern dedupe onFaceEvent() (Luồng 2): SELECT-precheck trước INSERT, cửa sổ
// 8s, KHÔNG UNIQUE constraint (bảng chưa từng có, chỉ 1 nguồn ghi tuần tự — writeCountEvent()
// chỉ được gọi từ đúng 1 chỗ, ivss-occupancy-ingest.service.ts).
const DEDUP_WINDOW_MS = 8000;

/**
 * ZonePresenceWriterService (ZPW-001 / UC-109) — nguồn ghi DUY NHẤT của `zone_presence_events`
 * cho vòng `appear` (QĐ-1/QC-4). `ivss` GỌI, KHÔNG bắn raw SQL chéo.
 *
 * Hai method: `resolvePresenceZone` (ĐỌC — validate zone.type để caller biết `zone_wrong_type`
 * TRƯỚC khi ghi raw event, tránh UPDATE bù) + `writeAppearEvent` (GHI — INSERT 1 dòng, tx riêng).
 *
 * ⚠⚠ BẢNG APPEND-ONLY: `zone_presence_events` KHÔNG có `deleted_at` ⇒ TUYỆT ĐỐI KHÔNG
 * `deletedAt`/`IsNull()` trên bảng này. `event_time` do caller đưa vào (từ evt.utc), method
 * KHÔNG tự sinh thời gian.
 */
@Injectable()
export class ZonePresenceWriterService {
  private readonly logger = new Logger(ZonePresenceWriterService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * ĐỌC — zone tồn tại (chưa xóa mềm) + `zone_type ∈ {corridor,lobby,parking}` (QC-5)?
   * Không tồn tại / sai type → `{valid:false, reason:'zone_wrong_type'}`. KHÔNG ghi.
   */
  async resolvePresenceZone(
    zoneId: string,
  ): Promise<ResolvePresenceZoneResult> {
    const rows: Array<{ zone_type: string }> =
      await this.dataSource.manager.query(
        `SELECT zone_type FROM zones WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [zoneId],
      );
    if (rows.length === 0 || !PRESENCE_ZONE_TYPES.includes(rows[0].zone_type)) {
      return { valid: false, reason: 'zone_wrong_type' };
    }
    return { valid: true };
  }

  /**
   * GHI — INSERT 1 dòng `appear`. Tự validate type lần nữa (defense: chỉ `ivss` gọi + đã
   * resolve, nhưng method phải an toàn nếu bị gọi trực tiếp) → sai type thì ném (không xảy ra
   * ở luồng thật vì caller đã lọc). Tx riêng, COMMIT trước khi trả. KHÔNG unique/pairing
   * (nhật ký bắt gặp cho phép trùng). KHÔNG cột `event_id` (nhánh B — link qua metadata).
   */
  async writeAppearEvent(
    input: WriteAppearInput,
  ): Promise<{ presenceId: string }> {
    const check = await this.resolvePresenceZone(input.zoneId);
    if (!check.valid) {
      // Defense-in-depth: luồng thật KHÔNG tới đây (caller đã resolve). Nếu tới → cấu hình sai.
      throw new Error(
        `writeAppearEvent: zone ${input.zoneId} không phải zone khu vực (zone_wrong_type)`,
      );
    }

    const metaJson =
      input.metadata && Object.keys(input.metadata).length > 0
        ? JSON.stringify(input.metadata)
        : null;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const rows: Array<{ id: string }> = await qr.manager.query(
        `INSERT INTO zone_presence_events
           (zone_id, device_id, user_id, event_type, occupancy_count,
            confidence_score, event_time, source_type, metadata_json)
         VALUES ($1, $2, $3, 'appear', NULL, NULL, $4, 'ivss', $5::jsonb)
         RETURNING id`,
        [
          input.zoneId,
          input.deviceId ?? null,
          input.userId,
          input.eventTime,
          metaJson,
        ],
      );
      await qr.commitTransaction();
      return { presenceId: rows[0].id };
    } catch (e) {
      await qr.rollbackTransaction();
      this.logger.error(
        `writeAppearEvent failed (zone=${input.zoneId} user=${input.userId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw e;
    } finally {
      await qr.release();
    }
  }

  /**
   * GHI — INSERT 1 dòng `count` (F3, recon B5). KHÔNG giới hạn `zone_type` như
   * `writeAppearEvent` (QC-5 chỉ áp dụng vòng `appear` — crowd-alert/heatmap đọc
   * theo zone_id bất kỳ do `alert_rules`/dashboard chỉ định, không kén loại zone).
   * Chỉ kiểm zone tồn tại (chưa xóa mềm).
   *
   * [RACE FIX 2026-08-22] SELECT-precheck [FIX 2026-08-18] rời rạc (KHÔNG transaction)
   * từng coi race window "không đáng kể" vì writeCountEvent() chỉ 1 nguồn gọi tuần tự —
   * SAI, xác nhận bằng dữ liệu thật: 20 cặp event gần-trùng trong cửa sổ 8s (gap
   * 0.24s-7.9s, cùng zone+occupancyCount) ở đợt test 2026-08-15 — camera đếm người bắn
   * liên tục lúc có chuyển động, 2 request gần như đồng thời cùng SELECT "không thấy
   * trùng" TRƯỚC KHI request nào kịp INSERT (SELECT/INSERT là 2 statement auto-commit
   * rời rạc, không gì khoá 2 request lại). Cùng lớp race đã xác nhận + sửa 2 lần ở
   * vehicle-resolve.service.ts (ANPR) và ivss-presence-ingestion.service.ts (onFaceEvent).
   * Mirror ĐÚNG pattern: bọc SELECT-precheck + INSERT trong 1 `dataSource.transaction()`,
   * khoá pg_advisory_xact_lock theo zoneId+occupancyCount NGAY ĐẦU — 2 request CÙNG
   * zone+count giờ xếp hàng (transaction sau đợi transaction trước COMMIT rồi mới
   * SELECT, nên luôn THẤY được row vừa tạo). pg_advisory_XACT_lock tự giải phóng khi
   * transaction kết thúc (commit/rollback), không cần unlock tay. Không đổi SQL text
   * SELECT/INSERT, không migration. KHÔNG đụng `writeAppearEvent()` — method đó dùng
   * `createQueryRunner()` riêng, giữ nguyên (không có SELECT-precheck để race).
   */
  async writeCountEvent(
    input: WriteCountInput,
  ): Promise<{ presenceId: string }> {
    const zoneRows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM zones WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [input.zoneId],
    );
    if (zoneRows.length === 0) {
      throw new Error(
        `writeCountEvent: zone ${input.zoneId} không tồn tại hoặc đã xóa`,
      );
    }

    const metaJson =
      input.metadata && Object.keys(input.metadata).length > 0
        ? JSON.stringify(input.metadata)
        : null;

    const lockKey = `zone_count_dedup_${input.zoneId}_${input.occupancyCount}`;
    let result: { skipped: boolean; presenceId: string };
    try {
      result = await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `SELECT pg_advisory_xact_lock(hashtext($1::text))`,
          [lockKey],
        );

        // [FIX 2026-08-18] Dedupe precheck — khóa zoneId+occupancyCount (CẢ HAI phải
        // khớp, KHÔNG chỉ zoneId: 1 lần đếm THẬT SỰ đổi giá trị vẫn phải ghi, phục vụ
        // heatmap chính xác), cửa sổ 8s. Trùng → KHÔNG INSERT, nhưng VẪN trả về
        // presenceId của row đã có (KHÔNG bỏ qua/return rỗng) — caller
        // (ivss-occupancy-ingest.service.ts) destructure { presenceId } ngay sau lệnh
        // gọi này rồi dùng để gọi evaluateZoneCountNow() TỨC THỜI; trả presenceId thật
        // giữ nguyên khả năng đánh giá ngưỡng crowd-alert mỗi lần gọi, chỉ giảm số row
        // LƯU TRỮ (ảnh hưởng cron quét lại sau này), không giảm tần suất đánh giá
        // ngưỡng thời gian thực.
        const dupRows: Array<{ id: string }> = await manager.query(
          `SELECT id FROM zone_presence_events
           WHERE zone_id = $1
             AND event_type = 'count'
             AND occupancy_count = $2
             AND event_time >= $3
           ORDER BY event_time DESC LIMIT 1`,
          [
            input.zoneId,
            input.occupancyCount,
            new Date(input.eventTime.getTime() - DEDUP_WINDOW_MS),
          ],
        );
        if (dupRows[0]) {
          return { skipped: true, presenceId: dupRows[0].id };
        }

        const rows: Array<{ id: string }> = await manager.query(
          `INSERT INTO zone_presence_events
             (zone_id, device_id, user_id, event_type, occupancy_count,
              confidence_score, event_time, source_type, metadata_json)
           VALUES ($1, $2, NULL, 'count', $3, NULL, $4, 'ivss', $5::jsonb)
           RETURNING id`,
          [
            input.zoneId,
            input.deviceId ?? null,
            input.occupancyCount,
            input.eventTime,
            metaJson,
          ],
        );
        return { skipped: false, presenceId: rows[0].id };
      });
    } catch (e) {
      this.logger.error(
        `writeCountEvent failed (zone=${input.zoneId} count=${input.occupancyCount}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw e;
    }

    if (result.skipped) {
      this.logger.debug(
        `writeCountEvent dedupe: bỏ qua INSERT (zone=${input.zoneId} count=${input.occupancyCount}) — đã có event trùng trong ${DEDUP_WINDOW_MS}ms (id=${result.presenceId}).`,
      );
    }
    return { presenceId: result.presenceId };
  }
}
