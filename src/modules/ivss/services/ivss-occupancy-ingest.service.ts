import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OccupancyPersistenceService } from '../../presence/services/occupancy-persistence.service.js';
import { ZonePresenceWriterService } from '../../zones/services/zone-presence-writer.service.js';
import { CrowdAlertService } from '../../crowd-alert/services/crowd-alert.service.js';
import { maskSensitiveMetadata } from '../../../common/utils/masking.util.js';
import { OccupancyEventDto } from '../dto/occupancy-event.dto.js';

interface IdRow {
  id: string;
}
interface ConfigRow {
  config_json: Record<string, unknown> | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRIDGE_DEVICE_CODE = 'IVSS-BRIDGE';
const BRIDGE_DEVICE_TYPE = 'ivss_bridge';
const SKEW_MS = 60 * 60 * 1000; // 1h

/**
 * IvssOccupancyIngestService (IVSS-OCC-001 / A-OCC) — nhận People-Counting từ IVSS bridge.
 *
 * Thứ tự (plan §1, raw TRƯỚC channel-map — hộp đen truy vết):
 *  1. occupancyCount = dto.number; eventTime = parseUtc(utc)→now.
 *  2. resolve bridge device (device_code='IVSS-BRIDGE'); chưa seed → skip + log (AC-12).
 *  3. ghi raw iot_device_events (room_id=NULL §2.4, payload mask) (AC-11).
 *  4. resolveRoom(channelId) qua system_configs['ivss.channel_room_map']; không map → skip + log (AC-05).
 *  5. OccupancyPersistenceService.persist(...) — DUY NHẤT, confidence=null (§Locked-9) (AC-04/06..09).
 *  6. (F3, recon B5) resolveZone(channelId) qua system_configs['ivss.channel_presence_zone_map']
 *     — ĐỘC LẬP với bước 4/5, không map → skip + log. Có map →
 *     ZonePresenceWriterService.writeCountEvent(...) — nguồn zone_presence_events
 *     (event_type='count') duy nhất cho crowd-alert (ACR-001) + zone-traffic-heatmap.
 *
 * Exception (vd count ngoài [0,MAX] từ persist) để trồi lên controller (controller nuốt → ack 200, AC-17).
 * SEC: KHÔNG nhân bản persist; raw payload đã mask; KHÔNG log token (guard lo).
 */
@Injectable()
export class IvssOccupancyIngestService {
  private readonly logger = new Logger(IvssOccupancyIngestService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly occupancyPersistence: OccupancyPersistenceService,
    private readonly zonePresenceWriter: ZonePresenceWriterService,
    private readonly crowdAlertService: CrowdAlertService,
  ) {}

  async ingest(dto: OccupancyEventDto): Promise<void> {
    const occupancyCount = dto.number;
    const { eventTime, utcFallback } = this.parseUtc(dto.utc);

    // 1. Resolve bridge device — chưa seed → skip (KHÔNG ghi raw).
    const deviceId = await this.resolveBridgeDeviceId();
    if (!deviceId) {
      this.logger.warn(
        `IVSS-BRIDGE device chưa seed — skip occupancy ingest (channel=${dto.channelId}).`,
      );
      return;
    }

    // 2. Ghi raw iot_device_events TRƯỚC channel-map (room_id=NULL — §2.4).
    const payload = maskSensitiveMetadata({
      type: dto.type,
      channelId: dto.channelId,
      number: dto.number,
      enteredNumber: dto.enteredNumber ?? null,
      exitedNumber: dto.exitedNumber ?? null,
      eventAction: dto.eventAction ?? null,
      utc: dto.utc,
      utcFallback,
      receivedAt: new Date().toISOString(),
    });
    await this.dataSource.manager.query(
      `INSERT INTO iot_device_events
         (device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status)
       VALUES ($1, NULL, NULL, 'ivss_occupancy_event', $2, 'ivss', 'info', $3::jsonb, 'received')`,
      [deviceId, eventTime, JSON.stringify(payload)],
    );

    // 3. Resolve room qua channel_room_map — không map → skip persist (đã có raw vết).
    const roomId = await this.resolveRoom(dto.channelId);
    if (roomId) {
      // 4. Persist (DUY NHẤT) — confidence luôn null cho IVSS. Exception trồi lên controller.
      await this.occupancyPersistence.persist({
        roomId,
        meetingId: null,
        occupancyCount,
        confidence: null,
        eventTime,
      });
    } else {
      this.logger.warn(
        `Occupancy channel chưa map room (channel=${dto.channelId}) — raw đã ghi, skip persist.`,
      );
    }

    // 5. Resolve zone qua channel_presence_zone_map (F3, recon B5) — ĐỘC LẬP với
    // room ở bước 3: cùng 1 channel có thể map room, zone, cả hai, hoặc không cái
    // nào. Trước fix này KHÔNG có gì ghi zone_presence_events(event_type='count')
    // → crowd-alert/zone-traffic-heatmap luôn rỗng dữ liệu. Không map → skip lặng
    // (giống room ở trên).
    const zoneId = await this.resolveZone(dto.channelId);
    if (zoneId) {
      const { presenceId } = await this.zonePresenceWriter.writeCountEvent({
        zoneId,
        occupancyCount,
        eventTime,
        deviceId,
        metadata: { channelId: dto.channelId, source: 'ivss_occupancy' },
      });

      // Đường TỨC THỜI (bên cạnh cron evaluateCrowdAlerts() 5 phút — KHÔNG thay
      // thế, cron vẫn chạy làm lưới quét bù). try/catch RIÊNG — lỗi ở đây KHÔNG
      // được làm hỏng luồng ghi occupancy chính (khác writeCountEvent ở trên,
      // vốn CỐ Ý để throw trồi lên controller ack-always).
      // Đợt 2 perf: chạy nền — webhook KHÔNG chờ (alert mới có thể chụp ảnh ≤6.5s).
      void this.crowdAlertService
        .evaluateZoneCountNow({
          zoneId,
          occupancyCount,
          eventTime,
          sourceEventId: presenceId,
        })
        .catch((e: unknown) => {
          this.logger.error(
            `crowd-alert check (immediate) failed (channel=${dto.channelId} zone=${zoneId}): ${
              e instanceof Error ? e.message : 'unknown'
            }`,
          );
        });
    } else {
      this.logger.warn(
        `Occupancy channel chưa map zone (channel=${dto.channelId}) — skip crowd-alert/heatmap write.`,
      );
    }
  }

  /** ISO + |skew|≤1h → eventTime; sai/lệch → now + fallback. */
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

  private async resolveBridgeDeviceId(): Promise<string | null> {
    const rows: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 AND device_type = $2 LIMIT 1`,
      [BRIDGE_DEVICE_CODE, BRIDGE_DEVICE_TYPE],
    );
    return rows[0]?.id ?? null;
  }

  private async resolveRoom(channelId: number): Promise<string | null> {
    const map = await this.getChannelRoomMap();
    return map[String(channelId)] ?? null;
  }

  /** system_configs['ivss.channel_room_map'] config_json {channelId: room_uuid}; validate uuid. */
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

  private async resolveZone(channelId: number): Promise<string | null> {
    const map = await this.getChannelPresenceZoneMap();
    return map[String(channelId)] ?? null;
  }

  /**
   * system_configs['ivss.channel_presence_zone_map'] config_json {channelId: zone_uuid};
   * validate uuid (F3, recon B5 — mirror getChannelRoomMap, key riêng vì channel có thể
   * map zone khác room, hoặc map cả hai).
   */
  private async getChannelPresenceZoneMap(): Promise<Record<string, string>> {
    const rows: ConfigRow[] = await this.dataSource.manager.query(
      `SELECT config_json FROM system_configs
       WHERE config_key = 'ivss.channel_presence_zone_map' AND is_active = true LIMIT 1`,
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
}
