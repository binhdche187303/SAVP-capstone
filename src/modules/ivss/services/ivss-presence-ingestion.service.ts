import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type {
  IvssEventHandlerPort,
  IvssFaceEvent,
} from '../../../common/ports/ivss-event-hook.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { ZonePresenceWriterService } from '../../zones/services/zone-presence-writer.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { RestrictedZoneIntrusionService } from '../../restricted-zone/services/restricted-zone-intrusion.service.js';
import { saveEventSnapshot } from '../../../common/utils/save-event-snapshot.util.js';
import {
  IVSS_CHANNEL_PRESENCE_ZONE_MAP_KEY,
  type PresenceSkippedReason,
} from '../constants/zone-presence.constant.js';
import { IvssPresenceConfigService } from './ivss-presence-config.service.js';

/** Subfolder storage cho snapshot ảnh sự kiện IVSS (mọi matchState có imageBase64). */
const SNAPSHOT_FOLDER = 'stranger-snapshots';
/** media_files.related_entity_type cho snapshot lưu từ luồng IVSS ingestion. */
const SNAPSHOT_RELATED_ENTITY_TYPE = 'ivss_device_event';

interface IdRow {
  id: string;
}
interface UserRow {
  user_id: string;
}
interface ConfigRow {
  config_json: Record<string, unknown> | null;
}
interface FullNameRow {
  full_name: string | null;
}

/** IRP-001 (#40): payload realtime đẩy về client — SEC-01/C4 KHÔNG szUid/imageBase64/similarity. */
interface PresenceBroadcast {
  meetingId: string;
  roomId: string;
  userId: string;
  fullName: string | null;
  direction: Direction;
  matchState: 'matched';
  at: string;
}

const IVSS_PRESENCE_EVENT = 'ivss.presence';
const IVSS_MEETING_ROOM = (meetingId: string): string =>
  `ivss:meeting:${meetingId}`;
// B2 (Zone realtime, gate ZONE_REALTIME_ENABLED) — mirror IVSS_PRESENCE_EVENT/
// IVSS_MEETING_ROOM ở trên, room/channel MỚI HOÀN TOÀN, KHÔNG liên quan
// ivss:subscribe cũ (không auth). Auth thật nằm ở EventsGateway#handleZoneSubscribe.
const ZONE_PRESENCE_EVENT = 'zone.presence.updated';
const ZONE_ROOM = (zoneId: string): string => `zone:${zoneId}`;

type Direction = 'enter' | 'leave' | 'seen';
type MatchState =
  | 'matched'
  | 'unmatched_identity'
  | 'unmatched_location'
  | 'unmatched_both';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRIDGE_DEVICE_CODE = 'IVSS-BRIDGE';
const BRIDGE_DEVICE_TYPE = 'ivss_bridge';
const SKEW_MS = 60 * 60 * 1000; // 1h
// [FIX 2026-08-17] Dedupe spam: camera bắn nhiều frame liên tục cho CÙNG 1 lần
// xuất hiện (không phải regression — thiếu sót thiết kế từ đầu, event log
// KHÔNG có time-window nào trước đây). 8s nằm giữa khoảng đề xuất 5-10s.
const DEDUP_WINDOW_MS = 8000;
// eventAction biết → direction. VERIFY-LIVE owed: tập giá trị thực bridge gửi.
const ENTER_ACTIONS = new Set(['enter', 'in', '1']);
const LEAVE_ACTIONS = new Set(['leave', 'out', 'exit', '2']);

/**
 * IvssPresenceIngestionService (IPI-001 #38+#39) — handler thật cho IVSS_EVENT_HANDLER.
 *
 * onFaceEvent: resolve identity (szUid→user, source='ivss'+deleted_at) + location (channel→room
 * qua system_configs[ivss.channel_room_map]) + meeting best-effort → persist per-identity event vào
 * iot_device_events (device=bridge, event_type='ivss_face_event', source_protocol='ivss') — OQ-1 né migration.
 *
 * C5: matchState (matched|unmatched_identity|unmatched_location|unmatched_both) TÁCH khỏi direction
 *     (enter/leave/seen theo eventAction, độc lập). processed_status='processed' chỉ khi matched.
 * OQ-5: unmatched VẪN persist (debuggable). C3: utc rác → fallback receivedAt. C1: event_type distinct
 *     ('ivss_face_event') → KHÔNG nhiễm query face_verify/face_stranger/occupancy.
 * SEC-01 KHÔNG lưu/log imageBase64. SEC-03 bind tham số + validate channel-map uuid.
 * Handler KHÔNG throw (webhook always-ack #36). ARCH-01 qua port, KHÔNG NetSDK.
 */
@Injectable()
export class IvssPresenceIngestionService implements IvssEventHandlerPort {
  private readonly logger = new Logger(IvssPresenceIngestionService.name);
  // IRP-001 (#40) C1/B1: gate broadcast realtime — default OFF (mirror SCHEDULER_*_ENABLED).
  private readonly realtimeEnabled: boolean;
  // B2 (Zone realtime): gate riêng, ĐỘC LẬP với realtimeEnabled (IVSS meeting) —
  // default OFF, bật qua ZONE_REALTIME_ENABLED khi đã kiểm thử xong zone:subscribe.
  private readonly zoneRealtimeEnabled: boolean;

  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly configService: ConfigService,
    private readonly zonePresenceWriter: ZonePresenceWriterService,
    private readonly storageService: StorageService,
    private readonly restrictedZoneIntrusionService: RestrictedZoneIntrusionService,
    private readonly ivssPresenceConfigService: IvssPresenceConfigService,
  ) {
    this.realtimeEnabled = this.configService.get<boolean>(
      'IVSS_REALTIME_ENABLED',
      false,
    );
    this.zoneRealtimeEnabled = this.configService.get<boolean>(
      'ZONE_REALTIME_ENABLED',
      false,
    );
  }

  async onFaceEvent(evt: IvssFaceEvent): Promise<void> {
    try {
      const deviceId = await this.resolveBridgeDeviceId();
      if (!deviceId) {
        this.logger.warn(
          'IVSS bridge device không tồn tại — skip ingest (chưa enroll #37?).',
        );
        return;
      }

      const szUid = evt.personUid;
      let userId = await this.resolveUser(szUid);
      // [FIX 2026-08-11, Phần B, Case 5] similarity thấp hơn ngưỡng cấu hình → KHÔNG
      // coi là khớp danh tính thật. Null-hoá userId NGAY TẠI ĐÂY (trước matchStateOf,
      // payload, writeAppearEvent, evaluateZoneEventNow, broadcastPresence) để mọi
      // nhánh phía sau tự nhiên coi như "không nhận ra người" — KHÔNG sửa chữ ký/logic
      // matchStateOf(). evt.similarity=null (bridge không gửi/SDK không trả) → GIỮ
      // NGUYÊN hành vi cũ, không áp ngưỡng (không đủ căn cứ để từ chối).
      if (evt.similarity != null) {
        const { minSimilarityThreshold } =
          await this.ivssPresenceConfigService.getValues();
        if (evt.similarity < minSimilarityThreshold) {
          this.logger.warn(
            `IVSS event similarity ${evt.similarity} < ngưỡng ${minSimilarityThreshold} (channel=${evt.channelId} szUid=${szUid}) — không coi là khớp danh tính.`,
          );
          userId = null;
        }
      }
      const roomId = await this.resolveRoom(evt.channelId);

      // [FIX 2026-08-15] Xác định sớm ngữ cảnh Zone (roomId null, nhưng channel có map zone
      // qua channel_presence_zone_map — camera Zone không map qua channel_room_map nên
      // roomId LUÔN null) để matchStateOf() không áp nhầm yêu cầu roomId/isParticipant
      // (chỉ có ý nghĩa cho phòng họp — xem matchStateOf() bên dưới). Đọc thêm 1 lần
      // channel_presence_zone_map ở đây (nhẹ, cùng kiểu query đã lặp lại nhiều lần trong
      // hàm này) — KHÔNG tái cấu trúc khối ZPW-001 (presenceZoneId/presenceSkipped) phía
      // dưới, vẫn giữ nguyên logic đó. Dual-map (channel có CẢ room_map lẫn presence_zone_
      // map) → roomId đã resolve non-null từ room_map → isZoneContext=false tự động, ưu
      // tiên hành vi Room (chặt hơn) khi cấu hình mơ hồ — khớp đúng cảnh báo "camera nên
      // một vai" đã có sẵn ở khối ZPW-001.
      const isZoneContext =
        !roomId &&
        !!(await this.getChannelPresenceZoneMap())[String(evt.channelId)];

      const { eventTime, utcFallback } = this.parseUtc(evt.utc);
      const meetingId = roomId
        ? await this.resolveMeeting(roomId, eventTime)
        : null;

      // Task B: direction ưu tiên channel-direction-map (camera nào thấy mặt) →
      // fallback eventAction (normalizeDirection) → 'seen'. C5: ĐỘC LẬP matchState.
      const directionMap = await this.getChannelDirectionMap();
      const direction =
        directionMap[String(evt.channelId)] ??
        this.normalizeDirection(evt.eventAction);
      // Nợ #3: chỉ điểm danh người THỰC SỰ thuộc cuộc họp đang diễn ra tại room đó.
      // meetingId null (không có họp lúc đi qua camera) → isParticipant=false → không matched.
      let isParticipant = false;
      if (userId && meetingId) {
        const pr: IdRow[] = await this.dataSource.manager.query(
          `SELECT id FROM meeting_participants
           WHERE meeting_id = $1 AND user_id = $2 LIMIT 1`,
          [meetingId, userId],
        );
        isParticipant = !!pr[0];
      }
      const matchState = this.matchStateOf(
        userId,
        roomId,
        isParticipant,
        isZoneContext,
      );
      const processedStatus =
        matchState === 'matched' ? 'processed' : 'unmatched';

      // ZPW-001 (UC-109, A.1): QUYẾT ĐỊNH presence TRƯỚC INSERT — presenceSkipped vào payload
      // MỘT lần (KHÔNG UPDATE bù). Đường presence ĐỘC LẬP điểm danh phòng họp bên trên.
      const roomMap = await this.getChannelRoomMap();
      const presenceMap = await this.getChannelPresenceZoneMap();
      const chKey = String(evt.channelId);
      // A.2: WARN khi channel có KEY trong CẢ hai map (kiểm KEY, KHÔNG kiểm giá trị resolve).
      if (
        Object.prototype.hasOwnProperty.call(roomMap, chKey) &&
        Object.prototype.hasOwnProperty.call(presenceMap, chKey)
      ) {
        this.logger.warn(
          `channel ${evt.channelId} có trong CẢ room_map lẫn presence_zone_map — kiểm cấu hình, camera nên một vai.`,
        );
      }
      const presenceZoneId = presenceMap[chKey] ?? null;
      let presenceSkipped: PresenceSkippedReason | null = null;
      if (!presenceZoneId) presenceSkipped = 'zone_unmapped';
      // [FIX 2026-08-19] Bỏ skip theo userId==null (trước: 'unmatched_identity') — restricted-
      // zone-intrusion.isViolation() coi userId=null LÀ vi phạm (mirror Room, xem ZPW-001 §5.4
      // cũ đã lỗi thời), nhưng writer trước đây chặn không cho ghi nên isViolation() không bao
      // giờ nhận được input null để đánh giá. Giờ để userId=null đi tiếp tới writeAppearEvent()
      // — zone_presence_events.user_id vốn đã nullable ở DB, không cần migration.
      else if (utcFallback) presenceSkipped = 'bad_utc';
      else {
        const chk =
          await this.zonePresenceWriter.resolvePresenceZone(presenceZoneId);
        if (!chk.valid) presenceSkipped = chk.reason;
      }

      // Quyết định mới (2026-08-07): lưu ảnh cho MỌI event có imageBase64, bất kể
      // matchState (matched/unmatched_identity/unmatched_location/unmatched_both).
      // Gate cũ theo matchState (F-B) và theo zone-violation/restricted-hours (F-C)
      // đã bị bỏ — saveSnapshotSafe tự no-op (trả null) khi KHÔNG có ảnh.
      // SEC-01 vẫn giữ nguyên: ảnh KHÔNG bao giờ vào payload_json — chỉ media_files.id
      // (snapshotFileId) đi vào cột riêng snapshot_file_id.
      const snapshotFileId = await this.saveSnapshotSafe(evt.imageBase64);

      // SEC-01: KHÔNG imageBase64; szUid metadata-only.
      const payload = {
        szUid,
        userId,
        channelId: evt.channelId,
        roomId,
        meetingId,
        direction,
        matchState,
        eventActionRaw: evt.eventAction ?? null,
        similarity: evt.similarity ?? null,
        name: evt.name ?? null,
        utc: evt.utc,
        utcFallback,
        receivedAt: new Date().toISOString(),
        // ZPW-001: lý do skip presence (null nếu sẽ ghi appear). Nhánh B: link raw event
        // qua metadata_json.sourceEventId của zone_presence_events, KHÔNG cột event_id.
        presenceSkipped,
      };

      // [FIX 2026-08-17] Dedupe spam TRƯỚC INSERT — camera bắn nhiều frame liên tục
      // cho CÙNG 1 lần xuất hiện → nhiều row trùng trong RoomAccessLogs/ZoneManagement.
      // Khóa: channelId + szUid (RAW evt.personUid — KHÔNG dùng userId đã resolve, vì
      // userId có thể bị null-hoá bởi ngưỡng similarity dù szUid vẫn có giá trị thật,
      // xem Phần B Case 5 ở trên — dùng userId sẽ trộn "người quen bị null do similarity
      // thấp" lẫn "người lạ thật" không nhất quán). Người lạ (szUid null, sau fix Phần
      // A/B trước) → so khớp NULL-safe (`IS NOT DISTINCT FROM`), gộp theo channelId
      // trong cửa sổ — chấp nhận đánh đổi có thể gộp nhầm 2 người lạ khác nhau đứng sát
      // giờ CÙNG 1 channel (ưu tiên chống spam hơn phân biệt tuyệt đối từng người lạ).
      // iot_device_events cũng chưa từng có UNIQUE constraint nào (mọi migration trước
      // giờ chỉ ADD COLUMN + index thường) — thêm retroactive lên bảng ĐANG có dữ liệu
      // trùng thật (chính bug đang sửa) có rủi ro migration fail không cần thiết.
      //
      // [RACE FIX 2026-08-22] SELECT-precheck rời rạc (KHÔNG transaction) từng coi race
      // window "không đáng kể" — SAI, xác nhận bằng dữ liệu thật: 60 nhóm event trùng
      // TUYỆT ĐỐI cùng giây (channel+szUid+event_time) trong 7 ngày (2 request gần như
      // đồng thời, cả 2 cùng SELECT "không thấy trùng" TRƯỚC KHI request nào kịp INSERT
      // — SELECT và INSERT là 2 statement auto-commit rời rạc, không gì khoá 2 request
      // lại). Mirror ĐÚNG pattern đã chạy production tại
      // vehicle-resolve.service.ts:190-234 (RACE FIX bằng chứng thật 2026-08-08): bọc
      // SELECT-precheck + INSERT trong 1 `dataSource.transaction()`, khoá
      // pg_advisory_xact_lock theo channelId+szUid NGAY ĐẦU — 2 request CÙNG
      // channel+szUid giờ xếp hàng (transaction sau đợi transaction trước COMMIT rồi
      // mới SELECT, nên luôn THẤY được row vừa tạo). pg_advisory_XACT_lock (KHÔNG phải
      // advisory_lock thường) tự giải phóng khi transaction kết thúc (commit/rollback),
      // an toàn nếu exception giữa chừng, KHÔNG cần unlock tay. Khoá theo channelId+szUid
      // (mịn hơn vehicle-resolve chỉ khoá channelId) — 2 người KHÁC NHAU cùng 1 channel
      // cùng lúc KHÔNG bị chặn nhau, chỉ đúng 2 event TRÙNG người mới xếp hàng.
      // szUid null (người lạ hoàn toàn) → thế sentinel string TRƯỚC khi bind, KHÔNG
      // nối chuỗi có NULL trong SQL (`'x' || NULL` = NULL ⇒ hashtext/advisory_lock lỗi).
      // Không đổi SQL text của SELECT/INSERT — chỉ đổi đường gọi (`manager.query` thay
      // `this.dataSource.manager.query`) + bọc transaction/lock. Phần SAU (broadcast/
      // zonePresenceWriter/restrictedZoneIntrusion) GIỮ NGUYÊN ngoài transaction — đúng
      // nguyên tắc vehicle-resolve: chỉ bọc đúng đoạn merge-hoặc-insert.
      const lockKey = `ivss_face_dedup_${evt.channelId}_${szUid ?? '__stranger__'}`;
      const insertResult = await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `SELECT pg_advisory_xact_lock(hashtext($1::text))`,
          [lockKey],
        );

        const dupRows: IdRow[] = await manager.query(
          `SELECT id FROM iot_device_events
           WHERE device_id = $1
             AND event_type = 'ivss_face_event'
             AND payload_json->>'channelId' = $2
             AND payload_json->>'szUid' IS NOT DISTINCT FROM $3
             AND event_time >= $4
           ORDER BY event_time DESC LIMIT 1`,
          [
            deviceId,
            String(evt.channelId),
            szUid ?? null,
            new Date(eventTime.getTime() - DEDUP_WINDOW_MS),
          ],
        );
        if (dupRows[0]) {
          return { skipped: true as const, dupId: dupRows[0].id };
        }

        // QĐ-4 (nhánh B): RETURNING id → sourceEventId (đi vào metadata presence, không cột).
        // F-B/F-E: snapshot_file_id THÊM Ở CUỐI danh sách cột — KHÔNG đổi vị trí các cột/tham
        // số cũ (payload_json vẫn param $5, processed_status vẫn param $6).
        // [FIX 2026-08-11, Zone Access Log đường B] zone_id THÊM Ở CUỐI ($8) — tái dùng ĐÚNG
        // presenceZoneId đã tính ở trên (dòng 173, từ channel_presence_zone_map), KHÔNG query
        // thêm, KHÔNG đổi logic resolve zone hiện có. NULL khi channel không map presence zone
        // (giữ nguyên hành vi cũ cho event không thuộc zone nào). Cột phục vụ RIÊNG
        // IvssZoneAccessLogService (đọc trực tiếp iot_device_events.zone_id) — KHÔNG đụng
        // presenceSkipped/matchState/writeAppearEvent ở trên/dưới.
        const insRows: IdRow[] = await manager.query(
          `INSERT INTO iot_device_events
             (device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, snapshot_file_id, zone_id)
           VALUES ($1, $2, $3, 'ivss_face_event', $4, 'ivss', 'info', $5::jsonb, $6, $7, $8)
           RETURNING id`,
          [
            deviceId,
            roomId,
            meetingId,
            eventTime,
            JSON.stringify(payload),
            processedStatus,
            snapshotFileId,
            presenceZoneId,
          ],
        );
        return { skipped: false as const, sourceEventId: insRows[0]?.id ?? null };
      });

      if (insertResult.skipped) {
        this.logger.debug(
          `IVSS event dedupe: bỏ qua (channel=${evt.channelId} szUid=${szUid}) — đã có event trùng trong ${DEDUP_WINDOW_MS}ms (id=${insertResult.dupId}).`,
        );
        return;
      }
      const sourceEventId = insertResult.sourceEventId;

      if (matchState !== 'matched') {
        // OQ-5: log + metric (đếm qua log); vẫn đã persist row unmatched.
        this.logger.warn(
          `IVSS event ${matchState} (channel=${evt.channelId} szUid=${szUid}).`,
        );
      } else if (this.realtimeEnabled && meetingId && roomId && userId) {
        // IRP-001 (#40): broadcast SAU persist (OQ-7), chỉ matched + có họp (OQ-4/5).
        // C1 gate + C3 best-effort: broadcastPresence tự nuốt lỗi, KHÔNG vỡ ingest.
        await this.broadcastPresence({
          meetingId,
          roomId,
          userId,
          direction,
          eventTime,
        });
      }

      // ZPW-001 (UC-109, A.1): GHI presence SAU raw event + SAU nhánh điểm danh. Chỉ khi KHÔNG
      // skip (mọi presenceSkipped đã ở payload). try/catch NUỐT lỗi — KHÔNG vỡ điểm danh/ack.
      // [FIX 2026-08-19] Bỏ "&& userId" — userId=null (người lạ hoàn toàn) giờ VẪN ghi appear,
      // để restricted-zone-intrusion đánh giá được (xem comment ở presenceSkipped phía trên).
      if (!presenceSkipped && presenceZoneId) {
        try {
          const { presenceId } = await this.zonePresenceWriter.writeAppearEvent(
            {
              zoneId: presenceZoneId,
              userId,
              eventTime,
              deviceId,
              metadata: {
                channelId: evt.channelId,
                szUid,
                similarity: evt.similarity ?? null,
                sourceEventId,
              },
            },
          );

          // B2 (Zone realtime): broadcast SAU writeAppearEvent() đã commit xong
          // (presenceId đã có) — KHÔNG nằm trong transaction/lock của writer, KHÔNG
          // thể làm rollback lại ghi đã xong. broadcastZonePresence tự nuốt lỗi.
          if (this.zoneRealtimeEnabled) {
            this.broadcastZonePresence({
              zoneId: presenceZoneId,
              userId,
              direction,
              eventTime,
            });
          }

          // Đường TỨC THỜI (bên cạnh cron evaluateIntrusions() 5 phút — KHÔNG
          // thay thế, cron vẫn chạy làm lưới quét bù). try/catch RIÊNG — lỗi ở
          // đây KHÔNG được làm hỏng luồng ghi appear chính (always-ack #36).
          // Dedupe alert dựa vào AlertsService.recordAlert() có sẵn (UQ mở
          // theo alertType+zoneId) — cron quét lại event này sau đó chỉ bump
          // occurrenceCount, KHÔNG tạo alert thứ 2.
          // Đợt 2: fire-and-forget — KHÔNG để kiểm tra xâm nhập chặn luồng ingest IVSS.
          void this.restrictedZoneIntrusionService
            .evaluateZoneEventNow({
              zoneId: presenceZoneId,
              userId,
              eventTime,
              sourceTable: 'zone_presence_events',
              sourceRowId: presenceId,
            })
            .catch((e: unknown) =>
              this.logger.error(
                `restricted-zone intrusion check (immediate) failed (channel=${evt.channelId} szUid=${szUid}): ${
                  e instanceof Error ? e.message : 'unknown'
                }`,
              ),
            );
        } catch (e) {
          this.logger.error(
            `zone presence write failed (channel=${evt.channelId} szUid=${szUid}): ${
              e instanceof Error ? e.message : 'unknown'
            }`,
          );
        }
      }
    } catch (e) {
      // Webhook always-ack (#36) — handler KHÔNG throw.
      this.logger.error(
        `IVSS presence ingest failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * IRP-001 (#40): đẩy realtime presence về room ivss:meeting:<meetingId>.
   * B2/C3: TOÀN BỘ thân (query fullName + emit) trong try/catch → KHÔNG bao giờ throw
   * ra ngoài (không vỡ ingest, không floating-reject). C4/SEC-01: payload KHÔNG
   * szUid/imageBase64/similarity. SEC-03: query full_name bind tham số.
   */
  private async broadcastPresence(args: {
    meetingId: string;
    roomId: string;
    userId: string;
    direction: Direction;
    eventTime: Date;
  }): Promise<void> {
    try {
      const rows: FullNameRow[] = await this.dataSource.manager.query(
        `SELECT full_name FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [args.userId],
      );
      const payload: PresenceBroadcast = {
        meetingId: args.meetingId,
        roomId: args.roomId,
        userId: args.userId,
        fullName: rows[0]?.full_name ?? null,
        direction: args.direction,
        matchState: 'matched',
        at: args.eventTime.toISOString(),
      };
      this.websocketService.emitToRoom(
        IVSS_MEETING_ROOM(args.meetingId),
        IVSS_PRESENCE_EVENT,
        payload,
      );
    } catch (e) {
      // C3 best-effort: lỗi query/emit/gateway-down → log, KHÔNG throw, KHÔNG rollback persist.
      this.logger.warn(
        `IVSS realtime broadcast skipped: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * B2 (Zone realtime) — đẩy realtime "có sự kiện zone mới" về room
   * zone:<zoneId>, để ZoneManagement (FE) refetch ngay thay vì đợi polling.
   * Mirror broadcastPresence(): TOÀN BỘ thân trong try/catch → KHÔNG bao giờ
   * throw ra ngoài (không vỡ ingest). Gọi SAU writeAppearEvent() đã commit
   * xong (xem call site) — lỗi ở đây KHÔNG thể rollback ghi đã xong.
   * Payload tối giản (KHÔNG szUid/similarity/imageBase64, mirror SEC-01) —
   * FE chỉ dùng event này như tín hiệu "có gì mới", không render trực tiếp.
   */
  private broadcastZonePresence(args: {
    zoneId: string;
    userId: string | null;
    direction: Direction;
    eventTime: Date;
  }): void {
    try {
      this.websocketService.emitToRoom(ZONE_ROOM(args.zoneId), ZONE_PRESENCE_EVENT, {
        zoneId: args.zoneId,
        userId: args.userId,
        direction: args.direction,
        at: args.eventTime.toISOString(),
      });
    } catch (e) {
      this.logger.warn(
        `Zone realtime broadcast skipped: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * C5: 4 trạng thái khớp, tách khỏi direction.
   * Nợ #3: `matched` (Room) YÊU CẦU thêm `isParticipant` — nhận ra người + có room vẫn
   * chưa đủ. Người còn mặt trên IVSS (deprovision lỗi) nhưng KHÔNG thuộc meeting đang
   * diễn ra → 'unmatched_identity' → processed_status='unmatched' → KHÔNG được điểm danh.
   *
   * [FIX 2026-08-15] `isZoneContext` — Zone (lobby/hành lang/bãi xe...) KHÔNG có khái
   * niệm phòng họp/participant; camera Zone map qua channel_presence_zone_map nên
   * `roomId` LUÔN null (KHÔNG phải "chưa map được phòng" như Room) — áp nguyên yêu cầu
   * `roomId && isParticipant` của Room khiến MỌI sự kiện Zone, kể cả người quen nhận diện
   * đúng, không bao giờ ra được 'matched' (luôn rơi 'unmatched_location'). Ở Zone, chỉ
   * cần `userId` khớp là đủ 'matched' — 4 nhánh còn lại GIỮ NGUYÊN không đổi (Room không
   * bị ảnh hưởng, security fix c444853 vẫn nguyên vẹn khi isZoneContext=false).
   */
  private matchStateOf(
    userId: string | null,
    roomId: string | null,
    isParticipant: boolean,
    isZoneContext: boolean,
  ): MatchState {
    const matched = isZoneContext
      ? !!userId
      : !!(userId && roomId && isParticipant);
    if (matched) return 'matched';
    // Nhận ra người nhưng không có trong họp (hoặc không map được meeting).
    if (userId && roomId && !isParticipant) return 'unmatched_identity';
    if (!userId && !roomId) return 'unmatched_both';
    if (!userId) return 'unmatched_identity';
    return 'unmatched_location';
  }

  /** OQ-3 defensive: eventAction biết → enter/leave; lạ/thiếu → seen. */
  private normalizeDirection(action?: string): Direction {
    if (action) {
      const a = action.trim().toLowerCase();
      if (ENTER_ACTIONS.has(a)) return 'enter';
      if (LEAVE_ACTIONS.has(a)) return 'leave';
    }
    return 'seen';
  }

  /** C3: ISO + |skew|≤1h → eventTime; sai/lệch → now + fallback. */
  private parseUtc(raw: string): { eventTime: Date; utcFallback: boolean } {
    const t = new Date(raw);
    if (
      !Number.isNaN(t.getTime()) &&
      Math.abs(Date.now() - t.getTime()) <= SKEW_MS
    ) {
      return { eventTime: t, utcFallback: false };
    }
    return { eventTime: new Date(), utcFallback: true };
  }

  /**
   * F-B/F-C: lưu snapshot ảnh (nếu có) qua storageService + media_files — KHÔNG throw
   * (webhook always-ack #36): lỗi storage/DB chỉ log + trả null, KHÔNG được chặn persist
   * raw event. Không có ảnh (undefined/rỗng) → null, KHÔNG gọi storage.
   */
  private async saveSnapshotSafe(
    imageBase64: string | null | undefined,
  ): Promise<string | null> {
    if (!imageBase64) return null;
    try {
      return await saveEventSnapshot(this.dataSource, this.storageService, {
        imageBase64,
        folder: SNAPSHOT_FOLDER,
        relatedEntityType: SNAPSHOT_RELATED_ENTITY_TYPE,
      });
    } catch (e) {
      this.logger.warn(
        `snapshot save failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
      return null;
    }
  }

  private async resolveBridgeDeviceId(): Promise<string | null> {
    const rows: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 AND device_type = $2 LIMIT 1`,
      [BRIDGE_DEVICE_CODE, BRIDGE_DEVICE_TYPE],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Nhận diện từ CẢ 2 nguồn mapping:
   * - 'ivss'     — person-sync group "1", vòng đời theo cuộc họp.
   * - 'portrait' — portrait-sync group "USERS", thường trực theo account/ảnh.
   * Nguồn ghi giữ nguyên source riêng (khác vòng đời xoá); chỉ mở đường đọc.
   * ORDER BY để mapping mới nhất thắng khi 1 người có cả 2 nguồn (tránh phụ
   * thuộc thứ tự vật lý của bảng).
   */
  private async resolveUser(szUid: string | undefined): Promise<string | null> {
    // [FIX 2026-08-17] 0 candidate (người lạ hoàn toàn) → bridge gửi personUid
    // rỗng — không có gì để resolve, tránh round-trip DB vô ích.
    if (!szUid) return null;
    const rows: UserRow[] = await this.dataSource.manager.query(
      `SELECT user_id FROM device_user_mappings
       WHERE device_person_id = $1
         AND metadata_json->>'source' IN ('ivss', 'portrait')
         AND deleted_at IS NULL
       ORDER BY last_synced_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [szUid],
    );
    return rows[0]?.user_id ?? null;
  }

  private async resolveRoom(channelId: number): Promise<string | null> {
    const map = await this.getChannelRoomMap();
    return map[String(channelId)] ?? null;
  }

  /** OQ-2: system_configs[ivss.channel_room_map] config_json {channelId: room_uuid}; validate uuid (SEC-03). */
  private async getChannelRoomMap(): Promise<Record<string, string>> {
    const rows: ConfigRow[] = await this.dataSource.manager.query(
      `SELECT config_json FROM system_configs
       WHERE config_key = 'ivss.channel_room_map' AND is_active = true LIMIT 1`,
    );
    const raw = rows[0]?.config_json;
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && UUID_RE.test(v)) out[k] = v;
      }
    }
    return out;
  }

  /**
   * ZPW-001 (UC-109, QĐ-2): system_configs[ivss.channel_presence_zone_map] {channelId: zone_uuid};
   * validate uuid. KEY RIÊNG với channel_room_map/channel_zone_map (camera một-vai-một-channel).
   * Không cache. Đọc lỗi → {} (KHÔNG throw): channel không map → zone_unmapped (AC-BACKCOMPAT).
   *
   * ⚠ NỢ TD-ZPW-1: bản đọc thứ 4 cùng khuôn `system_configs` channel-map. Sửa validate ở đây
   * phải soát cả: ivss-occupancy-ingest.service.ts:119, ivss-presence-ingestion.service.ts:289,
   * anpr/vehicle-resolve.service.ts:265. Gom thành util sau khi scope ổn định (plan §11).
   */
  private async getChannelPresenceZoneMap(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
      const rows: ConfigRow[] = await this.dataSource.manager.query(
        `SELECT config_json FROM system_configs
         WHERE config_key = $1 AND is_active = true LIMIT 1`,
        [IVSS_CHANNEL_PRESENCE_ZONE_MAP_KEY],
      );
      const raw = rows[0]?.config_json;
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'string' && UUID_RE.test(v)) out[k] = v;
        }
      }
    } catch (e) {
      this.logger.warn(
        `IVSS channel_presence_zone_map read failed (→ zone_unmapped): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return out;
  }

  /**
   * Task B: system_configs[ivss.channel_direction_map] config_json {channelId: enter|leave|seen}.
   * MIRROR getChannelRoomMap (cùng query, is_active=true). Chỉ nhận value ∈ {enter,leave,seen}
   * (value lạ → bỏ entry). Lookup dùng String(channelId) — nhất quán channel_room_map.
   * Đọc config lỗi → trả rỗng (KHÔNG throw): map-miss = đường cũ (eventAction/'seen').
   */
  // ⚠ NỢ A.6: bản đọc THỨ HAI cùng config ở vehicle-resolve.service.ts (getChannelDirectionMap, luồng xe) — sửa validate ở đây phải sửa cả bên đó.
  private async getChannelDirectionMap(): Promise<Record<string, Direction>> {
    const out: Record<string, Direction> = {};
    try {
      const rows: ConfigRow[] = await this.dataSource.manager.query(
        `SELECT config_json FROM system_configs
         WHERE config_key = 'ivss.channel_direction_map' AND is_active = true LIMIT 1`,
      );
      const raw = rows[0]?.config_json;
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          if (v === 'enter' || v === 'leave' || v === 'seen') out[k] = v;
        }
      }
    } catch (e) {
      this.logger.warn(
        `IVSS channel_direction_map read failed (fallback eventAction): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return out;
  }

  /**
   * Tìm cuộc họp đang diễn ra tại phòng, ở đúng thời điểm quẹt mặt.
   *
   * [F-B] Nhận CẢ `scheduled` lẫn `in_progress`, KHÔNG chỉ `in_progress` như
   * trước. Cửa sổ thời gian (`BETWEEN start_time AND end_time`) mới là điều
   * kiện quyết định "họp có đang diễn ra không" — `status` chỉ phản ánh đã có
   * ai bấm "bắt đầu" chưa.
   *
   * Vì sao cần: cron `meeting-status-advance` (F-A) lật `scheduled` →
   * `in_progress` mỗi phút, nên vẫn còn khe tối đa ~1 phút ngay đầu giờ mà
   * họp còn `scheduled`. Trước fix, mọi lần quẹt mặt rơi vào khe đó bị tính
   * `unmatched` vĩnh viễn (raw event đã ghi, không quay lại sửa). Nới điều
   * kiện ở đây bịt khe đó, đồng thời giữ hệ thống chạy đúng cả khi cron bị
   * tắt (`SCHEDULER_MEETING_STATUS_ENABLED=false`) — điểm danh không phụ
   * thuộc vào việc cron có được bật hay không.
   *
   * VẪN loại `cancelled` (họp đã hủy không điểm danh), `completed` (đã kết
   * thúc), `draft`/`pending_approval` (chưa được duyệt, chưa giữ phòng thật).
   */
  private async resolveMeeting(
    roomId: string,
    eventTime: Date,
  ): Promise<string | null> {
    const rows: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM meetings
       WHERE room_id = $1 AND status IN ('scheduled', 'in_progress')
         AND $2 BETWEEN start_time AND end_time
         AND deleted_at IS NULL
       ORDER BY start_time ASC
       LIMIT 1`,
      [roomId, eventTime],
    );
    return rows[0]?.id ?? null;
  }
}
