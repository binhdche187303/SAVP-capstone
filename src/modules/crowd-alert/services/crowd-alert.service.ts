import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import { AlertRuleEntity } from '../../alerts/entities/alert-rule.entity.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { IVSS_BRIDGE } from '../../ivss/ports/ivss-bridge.port.js';
import type { IvssBridgePort } from '../../ivss/ports/ivss-bridge.port.js';
import { IVSS_CHANNEL_PRESENCE_ZONE_MAP_KEY } from '../../ivss/constants/zone-presence.constant.js';
import { StorageService } from '../../storage/storage.service.js';
import { saveEventSnapshot } from '../../../common/utils/save-event-snapshot.util.js';

const CONFIG_GROUP = 'crowd_alert';
const COUNT_EVENT_WATERMARK_KEY = 'crowd_alert.count_event_watermark';
import { ZONE_PRESENCE_EVENT_TYPES } from '../../zones/constants/zone-presence-event-type.constant.js';

/**
 * Bổ sung 2026-08-09 — chụp ảnh chủ động qua bridge khi crowd vượt ngưỡng (best-effort
 * side-effect, KHÔNG phải bước bắt buộc trong đường ghi alert chính).
 */
const CROWD_SNAPSHOT_TIMEOUT_MS = 6500; // dư ~1.5s so với timeout 5s phía bridge (CONFIRMED).
const CROWD_SNAPSHOT_FOLDER = 'crowd-alert-snapshots';
const CROWD_SNAPSHOT_RELATED_ENTITY_TYPE = 'crowd_alert_snapshot';
/**
 * event_type riêng cho dòng iot_device_events TỐI GIẢN được tạo LÀM NEO cho ảnh chủ
 * động — crowd-alert KHÔNG có raw event nào sẵn dùng lại được (khác intrusion/vehicle):
 * dòng 'ivss_occupancy_event' do IvssOccupancyIngestService ghi tại thời điểm ingest
 * KHÔNG bắt RETURNING id (không thread được vào metadata_json.sourceEventId của
 * zone_presence_events) VÀ không hề có ảnh (OccupancyEventDto không có imageBase64 —
 * People-Counting thuần, tách biệt thời điểm lẫn ngữ nghĩa với chụp ảnh chủ động chỉ
 * xảy ra SAU khi vượt ngưỡng). Vì vậy phải tạo dòng mới ở ĐÚNG thời điểm chụp ảnh.
 */
const CROWD_SNAPSHOT_EVENT_TYPE = 'crowd_alert_snapshot';
const BRIDGE_DEVICE_CODE = 'IVSS-BRIDGE';
const BRIDGE_DEVICE_TYPE = 'ivss_bridge';

export interface EvaluateCrowdAlertsResult {
  zonesScanned: number;
  eventsChecked: number;
  violationsFound: number;
}

/**
 * CrowdAlertService (ACR-001 / UC-121) — cron đối chiếu `zone_presence_events`
 * (`event_type='count'`, tận dụng `IDX_zpe_count`) với `alert_rules`
 * (`alert_type='crowd'`, GẮN ZONE CỤ THỂ) để phát hiện tụ tập đông người.
 *
 * DATA-01: KHÔNG ghi `zone_presence_events` (append-only, chỉ đọc).
 * PERF-01: watermark cursor qua `system_configs` — KHÔNG full-scan mỗi lần chạy.
 * Dedup dùng NGUYÊN `recordAlert()` có sẵn (UC-123) — deviation so với chữ SRS EX1 đã
 * chốt + ghi rõ trong spec §2.2, KHÔNG tự chế state-tracking riêng ở đây.
 */
@Injectable()
export class CrowdAlertService {
  private readonly logger = new Logger(CrowdAlertService.name);

  constructor(
    @InjectRepository(ZonePresenceEventEntity)
    private readonly presenceRepo: Repository<ZonePresenceEventEntity>,
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
    private readonly dataSource: DataSource,
    @Inject(IVSS_BRIDGE) private readonly ivssBridge: IvssBridgePort,
    private readonly storageService: StorageService,
  ) {}

  async evaluateCrowdAlerts(): Promise<EvaluateCrowdAlertsResult> {
    const rules = await this.loadZoneScopedCrowdRules();
    const watermark = await this.loadWatermark(COUNT_EVENT_WATERMARK_KEY);

    let eventsChecked = 0;
    let violationsFound = 0;
    let maxTime = watermark;

    for (const rule of rules) {
      const zoneId = rule.zoneId as string; // đã filter zoneId !== null ở loadZoneScopedCrowdRules
      const threshold = rule.threshold as number; // đã filter threshold !== null

      const events = await this.presenceRepo.find({
        where: {
          zoneId,
          eventType: ZONE_PRESENCE_EVENT_TYPES[2],
          eventTime: MoreThan(watermark),
        },
      });

      for (const event of events) {
        eventsChecked++;
        if (this.isThresholdExceeded(rule, event.occupancyCount ?? 0)) {
          violationsFound++;
          await this.recordCrowdAlert(rule, {
            occupancyCount: event.occupancyCount,
            threshold,
            sourceEventId: event.id,
            occurredAt: event.eventTime.toISOString(),
          });
        }
        if (event.eventTime > maxTime) maxTime = event.eventTime;
      }
    }

    await this.saveWatermark(COUNT_EVENT_WATERMARK_KEY, maxTime);

    this.logger.debug(
      `evaluateCrowdAlerts: zones=${rules.length} events=${eventsChecked} violations=${violationsFound}`,
    );

    return {
      zonesScanned: rules.length,
      eventsChecked,
      violationsFound,
    };
  }

  /**
   * Đường TỨC THỜI (bên cạnh cron `evaluateCrowdAlerts()` — KHÔNG thay thế, cron
   * vẫn chạy làm lưới quét bù). Gọi ngay sau khi 1 count-event (`zone_presence_events
   * .event_type='count'`) được ghi, để cảnh báo xuất hiện ngay thay vì đợi chu kỳ
   * cron. `isThresholdExceeded()` thuần tuý, không phụ thuộc watermark → gọi trực
   * tiếp an toàn.
   *
   * Chỉ tải rule của ĐÚNG zoneId (`AlertRulesService.list()` có sẵn filter `zoneId`)
   * — KHÔNG dùng `loadZoneScopedCrowdRules()` (tải TẤT CẢ zone rồi lọc JS, tốn cho
   * đường per-event). Mirror `RestrictedZoneIntrusionService.evaluateZoneEventNow()`.
   *
   * Dedupe: KHÔNG thêm cờ "đã xử lý tức thời" — dựa hoàn toàn vào
   * `AlertsService.recordAlert()` (unique index mở theo alertType+zoneId, §UC-123).
   * Cron quét lại đúng event này sau đó chỉ bump `occurrenceCount`, KHÔNG tạo alert
   * thứ 2.
   */
  async evaluateZoneCountNow(args: {
    zoneId: string;
    occupancyCount: number;
    eventTime: Date;
    sourceEventId: string;
  }): Promise<boolean> {
    const { items: rules } = await this.alertRulesService.list({
      alertType: 'crowd',
      zoneId: args.zoneId,
      enabled: true,
      page: 1,
      limit: 50,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    let violated = false;
    for (const rule of rules) {
      if (rule.threshold === null) continue; // mirror loadZoneScopedCrowdRules
      if (this.isThresholdExceeded(rule, args.occupancyCount)) {
        violated = true;
        await this.recordCrowdAlert(rule, {
          occupancyCount: args.occupancyCount,
          threshold: rule.threshold,
          sourceEventId: args.sourceEventId,
          occurredAt: args.eventTime.toISOString(),
        });
      }
    }
    return violated;
  }

  /** isThresholdExceeded (spec §2.4) — thuần tuý, tách khỏi vòng lặp cron để tái dùng cho đường tức thời. */
  private isThresholdExceeded(
    rule: AlertRuleEntity,
    occupancyCount: number,
  ): boolean {
    const threshold = rule.threshold as number; // caller đảm bảo threshold !== null
    return occupancyCount > threshold; // spec UC-121 §2.3: "vượt quá", bằng ngưỡng chưa tính
  }

  /**
   * SỬA 2026-08-09 (recon: FE chỉ đọc security_alerts.source_event_id — cột top-level FK
   * → iot_device_events.id — để hiện ảnh, KHÔNG đọc payload_json.snapshotFileId). Chụp
   * ảnh chủ động qua bridge (best-effort side-effect) TRƯỚC khi ghi alert, truyền
   * sourceEventId nếu thành công — mirror chính xác restricted-zone-intrusion.service.ts/
   * vehicle-control-alert.service.ts. KHÔNG chặn/làm chậm đáng kể luồng ghi alert chính —
   * fail/timeout/không resolve được channelId/không seed bridge device → sourceEventId=null,
   * alert vẫn tạo bình thường. KHÔNG đổi ngưỡng/logic đánh giá crowd hiện có.
   */
  private async recordCrowdAlert(
    rule: AlertRuleEntity,
    payloadJson: Record<string, unknown>,
  ): Promise<void> {
    const sourceEventId = await this.captureSnapshotForZone(rule.zoneId);

    await this.alertsService.recordAlert({
      alertType: 'crowd',
      zoneId: rule.zoneId,
      ruleId: rule.id,
      sourceEventId: sourceEventId ?? null,
      payloadJson,
    });
  }

  /**
   * Chụp ảnh chủ động qua bridge cho zone vừa vượt ngưỡng crowd, lưu ảnh, rồi tạo 1 dòng
   * iot_device_events TỐI GIẢN làm neo (crowd-alert không có raw event nào sẵn dùng lại
   * được — xem CROWD_SNAPSHOT_EVENT_TYPE) → trả về id dòng đó làm sourceEventId. Best-effort,
   * KHÔNG throw dưới bất kỳ nhánh nào (resolve channelId lỗi/miss, bridge lỗi/timeout, lưu
   * ảnh lỗi, chưa seed bridge device, INSERT lỗi → null, ghi warning, KHÔNG chặn
   * recordCrowdAlert()).
   */
  private async captureSnapshotForZone(
    zoneId: string | null,
  ): Promise<string | null> {
    if (!zoneId) return null;

    const channelId = await this.resolveChannelIdForZone(zoneId);
    if (channelId === null) {
      this.logger.warn(
        `crowd-alert snapshot skip: zone ${zoneId} không map được channelId (channel_presence_zone_map)`,
      );
      return null;
    }

    try {
      const res = await this.ivssBridge.getSnapshot(
        { channelId },
        CROWD_SNAPSHOT_TIMEOUT_MS,
      );
      if (!res.ok) {
        this.logger.warn(
          `crowd-alert snapshot failed (zone=${zoneId} channel=${channelId}): ${res.error.code} ${res.error.message}`,
        );
        return null;
      }

      const snapshotFileId = await saveEventSnapshot(
        this.dataSource,
        this.storageService,
        {
          imageBase64: res.data.imageBase64,
          folder: CROWD_SNAPSHOT_FOLDER,
          relatedEntityType: CROWD_SNAPSHOT_RELATED_ENTITY_TYPE,
        },
      );
      if (!snapshotFileId) return null; // decode thất bại — saveEventSnapshot đã tự lo.

      return await this.createSnapshotAnchorEvent(
        zoneId,
        channelId,
        snapshotFileId,
      );
    } catch (e) {
      this.logger.warn(
        `crowd-alert snapshot save failed (zone=${zoneId} channel=${channelId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      return null;
    }
  }

  /**
   * Tạo 1 dòng iot_device_events TỐI GIẢN làm neo cho ảnh chủ động vừa lưu — payload chỉ
   * channelId/zoneId (không có "sự kiện" thật nào khác để mô tả). device_id NOT NULL trên
   * bảng này (xem iot-device-event.entity.ts) → resolveBridgeDeviceId() trước; chưa seed
   * → skip tạo dòng (best-effort, KHÔNG throw), sourceEventId=null. zone_id set thẳng vào
   * cột riêng (KHÔNG chỉ payload — bảng có cột zone_id, song song room_id).
   */
  private async createSnapshotAnchorEvent(
    zoneId: string,
    channelId: number,
    snapshotFileId: string,
  ): Promise<string | null> {
    const deviceId = await this.resolveBridgeDeviceId();
    if (!deviceId) {
      this.logger.warn(
        `crowd-alert snapshot anchor skip: IVSS-BRIDGE device chưa seed (zone=${zoneId})`,
      );
      return null;
    }

    try {
      const rows: Array<{ id: string }> = await this.dataSource.manager.query(
        `INSERT INTO iot_device_events
           (device_id, room_id, meeting_id, zone_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, snapshot_file_id)
         VALUES ($1, NULL, NULL, $2, $3, NOW(), 'ivss', 'info', $4::jsonb, 'processed', $5)
         RETURNING id`,
        [
          deviceId,
          zoneId,
          CROWD_SNAPSHOT_EVENT_TYPE,
          JSON.stringify({ channelId, zoneId }),
          snapshotFileId,
        ],
      );
      return rows[0]?.id ?? null;
    } catch (e) {
      this.logger.warn(
        `crowd-alert snapshot anchor INSERT failed (zone=${zoneId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      return null;
    }
  }

  /** Mirror resolveBridgeDeviceId() ở vehicle-resolve.service.ts/ivss-occupancy-ingest.service.ts. */
  private async resolveBridgeDeviceId(): Promise<string | null> {
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 AND device_type = $2 LIMIT 1`,
      [BRIDGE_DEVICE_CODE, BRIDGE_DEVICE_TYPE],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Đảo ngược `channel_presence_zone_map` ({channelId: zoneId}) → tìm channelId đầu tiên
   * khớp đúng zoneId. Không có index đảo chiều (map nhỏ, đọc mỗi lần vượt ngưỡng — không
   * phải đường nóng). Đọc lỗi/không khớp → null (KHÔNG throw, mirror
   * getChannelPresenceZoneMap() ở vehicle-control-alert.service.ts).
   */
  private async resolveChannelIdForZone(
    zoneId: string,
  ): Promise<number | null> {
    try {
      const rows: Array<{ config_json: Record<string, unknown> | null }> =
        await this.dataSource.manager.query(
          `SELECT config_json FROM system_configs
           WHERE config_key = $1 AND is_active = true LIMIT 1`,
          [IVSS_CHANNEL_PRESENCE_ZONE_MAP_KEY],
        );
      const raw = rows[0]?.config_json;
      if (!raw || typeof raw !== 'object') return null;

      const entry = Object.entries(raw).find(([, v]) => v === zoneId);
      if (!entry) return null;

      const channelId = Number(entry[0]);
      return Number.isInteger(channelId) ? channelId : null;
    } catch (e) {
      this.logger.warn(
        `resolveChannelIdForZone failed (zone=${zoneId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      return null;
    }
  }

  /** Chỉ rule crowd GẮN ZONE CỤ THỂ VÀ đã cấu hình threshold (spec §2.1/§2.4). */
  private async loadZoneScopedCrowdRules(): Promise<AlertRuleEntity[]> {
    const { items } = await this.alertRulesService.list({
      alertType: 'crowd',
      enabled: true,
      page: 1,
      limit: 500,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    return items.filter((r) => r.zoneId !== null && r.threshold !== null);
  }

  /**
   * loadWatermark — KHÔNG có dòng → khởi tạo = thời điểm HIỆN TẠI (KHÔNG quét lùi dữ
   * liệu lịch sử) và lưu luôn (tránh reset watermark mỗi lần restart process). Mirror
   * `RestrictedZoneIntrusionService`.
   */
  private async loadWatermark(key: string): Promise<Date> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const existing = await repo.findOne({
      where: { configGroup: CONFIG_GROUP, configKey: key },
    });
    if (existing?.configValue) {
      const parsed = new Date(existing.configValue);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const now = new Date();
    await this.saveWatermark(key, now);
    return now;
  }

  private async saveWatermark(key: string, value: Date): Promise<void> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const existing = await repo.findOne({
      where: { configGroup: CONFIG_GROUP, configKey: key },
    });
    if (existing) {
      existing.configValue = value.toISOString();
      await repo.save(existing);
      return;
    }
    const entity = repo.create({
      configGroup: CONFIG_GROUP,
      configKey: key,
      configValue: value.toISOString(),
      description:
        'ACR-001/UC-121: watermark cursor cho cron CrowdAlertService — KHÔNG sửa tay.',
    });
    await repo.save(entity);
  }
}
