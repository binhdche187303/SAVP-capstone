import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import { GateAccessLogEntity } from '../../zones/entities/gate-access-log.entity.js';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import { AlertRuleEntity } from '../../alerts/entities/alert-rule.entity.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { vnMinutesOfDay } from '../../../common/utils/vn-restricted-hours.util.js';

const CONFIG_GROUP = 'restricted_zone_intrusion';
/** Cùng (zone, người) trong khoảng này chỉ ghi alert 1 lần. */
const INTRUSION_REPEAT_MS = 30_000;
const FULL_NAME_CACHE_MS = 5 * 60_000;
const REPEAT_MAP_MAX = 5000;
const GATE_LOG_WATERMARK_KEY = 'restricted_zone.gate_log_watermark';
const PRESENCE_EVENT_WATERMARK_KEY = 'restricted_zone.presence_event_watermark';
import { ZONE_PRESENCE_EVENT_TYPES } from '../../zones/constants/zone-presence-event-type.constant.js';

export interface EvaluateIntrusionsResult {
  zonesScanned: number;
  gateLogsChecked: number;
  presenceEventsChecked: number;
  violationsFound: number;
}

interface RestrictedHours {
  allowFrom?: string;
  allowTo?: string;
}

/**
 * RestrictedZoneIntrusionService (ARZ-001 / UC-124) — cron đối chiếu `gate_access_logs`
 * + `zone_presence_events` với `alert_rules` (`alert_type='intrusion'`, GẮN ZONE CỤ THỂ)
 * để phát hiện xâm nhập khu vực hạn chế.
 *
 * DATA-01: KHÔNG ghi `gate_access_logs`/`zone_presence_events` (append-only, chỉ đọc).
 * PERF-01: watermark cursor qua `system_configs` — KHÔNG full-scan 2 bảng log mỗi lần chạy,
 * KHÔNG quét lùi dữ liệu lịch sử ở lần chạy đầu (R5). Dedup vi phạm liên tiếp cùng zone qua
 * `recordAlert()` có sẵn (UC-123), KHÔNG tự chế logic chống trùng riêng.
 */
@Injectable()
export class RestrictedZoneIntrusionService {
  private readonly logger = new Logger(RestrictedZoneIntrusionService.name);
  /** Cron đang chạy → lượt sau bỏ qua. */
  private cronRunning = false;
  /** Lần ghi gần nhất theo `zoneId:userId` — chống ghi lặp khi người đứng yên trong vùng. */
  private readonly lastRecordedAt = new Map<string, number>();
  private readonly fullNameCache = new Map<
    string,
    { value: string | null; expiresAt: number }
  >();

  constructor(
    @InjectRepository(GateAccessLogEntity)
    private readonly gateLogRepo: Repository<GateAccessLogEntity>,
    @InjectRepository(ZonePresenceEventEntity)
    private readonly presenceRepo: Repository<ZonePresenceEventEntity>,
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
    private readonly dataSource: DataSource,
  ) {}

  async evaluateIntrusions(): Promise<EvaluateIntrusionsResult> {
    if (this.cronRunning) {
      this.logger.warn(
        '[INTRUSION] cron lượt trước chưa xong → bỏ qua lượt này',
      );
      return {
        zonesScanned: 0,
        gateLogsChecked: 0,
        presenceEventsChecked: 0,
        violationsFound: 0,
      };
    }
    this.cronRunning = true;
    try {
      return await this.runIntrusionScan();
    } finally {
      this.cronRunning = false;
    }
  }

  /** Đợt 2 perf: 2 truy vấn cho MỌI zone (trước: 2 truy vấn/zone). */
  private async runIntrusionScan(): Promise<EvaluateIntrusionsResult> {
    const rules = await this.loadZoneScopedIntrusionRules();
    const gateWatermark = await this.loadWatermark(GATE_LOG_WATERMARK_KEY);
    const presenceWatermark = await this.loadWatermark(
      PRESENCE_EVENT_WATERMARK_KEY,
    );

    let violationsFound = 0;
    let maxGateTime = gateWatermark;
    let maxPresenceTime = presenceWatermark;

    const zoneIds = [...new Set(rules.map((r) => r.zoneId as string))];
    const [logs, events] =
      zoneIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.gateLogRepo.find({
              where: {
                zoneId: In(zoneIds),
                direction: 'enter',
                accessTime: MoreThan(gateWatermark),
              },
            }),
            this.presenceRepo.find({
              where: {
                zoneId: In(zoneIds),
                eventType: ZONE_PRESENCE_EVENT_TYPES[0],
                eventTime: MoreThan(presenceWatermark),
              },
            }),
          ]);

    for (const rule of rules) {
      for (const log of logs) {
        if (log.zoneId !== rule.zoneId) continue;
        if (this.isViolation(rule, log.userId, log.accessTime)) {
          violationsFound++;
          await this.recordIntrusion(rule, {
            sourceTable: 'gate_access_logs',
            sourceRowId: log.id,
            userId: log.userId,
            occurredAt: log.accessTime.toISOString(),
          });
        }
      }
      for (const evt of events) {
        if (evt.zoneId !== rule.zoneId) continue;
        if (this.isViolation(rule, evt.userId, evt.eventTime)) {
          violationsFound++;
          await this.recordIntrusion(rule, {
            sourceTable: 'zone_presence_events',
            sourceRowId: evt.id,
            userId: evt.userId,
            occurredAt: evt.eventTime.toISOString(),
          });
        }
      }
    }
    for (const log of logs) {
      if (log.accessTime > maxGateTime) maxGateTime = log.accessTime;
    }
    for (const evt of events) {
      if (evt.eventTime > maxPresenceTime) maxPresenceTime = evt.eventTime;
    }

    await this.saveWatermark(GATE_LOG_WATERMARK_KEY, maxGateTime);
    await this.saveWatermark(PRESENCE_EVENT_WATERMARK_KEY, maxPresenceTime);

    this.logger.debug(
      `[INTRUSION] cron: zones=${rules.length} gateLogs=${logs.length} presenceEvents=${events.length} violations=${violationsFound}`,
    );
    return {
      zonesScanned: rules.length,
      gateLogsChecked: logs.length,
      presenceEventsChecked: events.length,
      violationsFound,
    };
  }

  /**
   * Đường TỨC THỜI (bên cạnh cron `evaluateIntrusions()` — KHÔNG thay thế, cron vẫn
   * chạy làm lưới quét bù cho các trường hợp bỏ lỡ, vd event đến lúc rule vừa bật).
   * Gọi ngay sau khi 1 zone-presence "appear" event được ghi, để cảnh báo xuất hiện
   * ngay thay vì đợi tới chu kỳ cron. isViolation() thuần tuý, không phụ thuộc
   * watermark → gọi trực tiếp an toàn.
   *
   * Chỉ tải rule của ĐÚNG zoneId (query DB có `zoneId` filter sẵn trong
   * `AlertRulesService.list()`) — KHÔNG dùng `loadZoneScopedIntrusionRules()` (tải
   * TẤT CẢ zone rồi lọc JS, tốn cho đường per-event). Số rule intrusion active/zone
   * thường 0-1 → 1 query nhẹ, không cần cache.
   *
   * Dedupe: KHÔNG thêm cờ "đã xử lý tức thời" nào — dựa hoàn toàn vào
   * `AlertsService.recordAlert()` (unique index mở theo alertType+zoneId, §UC-123).
   * Nếu cron quét lại đúng event này sau đó, `recordAlert()` chỉ bump
   * `occurrenceCount` trên alert đã mở, KHÔNG tạo alert thứ 2 (không double-alert).
   */
  async evaluateZoneEventNow(args: {
    zoneId: string;
    userId: string | null;
    eventTime: Date;
    sourceTable: string;
    sourceRowId: string;
  }): Promise<boolean> {
    const rules = (
      await this.alertRulesService.listEnabledZoneRules('intrusion')
    ).filter((r) => r.zoneId === args.zoneId);
    let violated = false;
    for (const rule of rules) {
      if (this.isViolation(rule, args.userId, args.eventTime)) {
        violated = true;
        await this.recordIntrusion(rule, {
          sourceTable: args.sourceTable,
          sourceRowId: args.sourceRowId,
          userId: args.userId,
          occurredAt: args.eventTime.toISOString(),
        });
      }
    }
    return violated;
  }

  /**
   * SỬA 2026-08-09 (recon: FE chỉ đọc security_alerts.source_event_id — cột top-level FK
   * → iot_device_events.id — để hiện ảnh qua ThumbnailImage, KHÔNG đọc
   * payload_json.snapshotFileId như bản trước). Đổi sang đúng cơ chế FE dùng, mirror
   * chính xác vehicle-control-alert.service.ts (`sourceEventId: eventId ?? null`).
   *
   * userId/isKnownPerson VẪN giữ trong payload — hữu ích cho phân biệt người quen/lạ,
   * KHÔNG liên quan tới việc hiện ảnh nên không đụng.
   *
   * CHỈ áp dụng khi TẠO alert mới qua recordAlert() (INSERT nhánh mới — xem tryInsert());
   * nếu recordAlert() bump alert đang mở (23505 → UPDATE occurrence_count), top-level
   * source_event_id LẪN payload gốc của alert đó GIỮ NGUYÊN làm "đại diện" — KHÔNG đổi
   * cơ chế dedupe/bump. `userId`/`sourceEventId` của lần vi phạm mới VẪN được giữ lại,
   * append vào `payload_json.occurrences` bởi `AlertsService.bumpOccurrence()` (fix
   * 2026-08-09, recon "nhiều người vi phạm cùng 1 alert") — KHÔNG mất dấu vết.
   */
  private async recordIntrusion(
    rule: AlertRuleEntity,
    payloadJson: Record<string, unknown>,
  ): Promise<void> {
    const userId = (payloadJson.userId as string | null | undefined) ?? null;

    // Đợt 2 perf: người đứng yên trong vùng → camera bắn "appear" mỗi vài giây; trong
    // INTRUSION_REPEAT_MS chỉ ghi 1 lần cho mỗi (zone, người) — áp cho cả webhook lẫn cron.
    const repeatKey = `${rule.zoneId}:${userId ?? 'unknown'}`;
    const now = Date.now();
    const last = this.lastRecordedAt.get(repeatKey);
    if (last !== undefined && now - last < INTRUSION_REPEAT_MS) {
      this.logger.debug(`[INTRUSION] ${repeatKey} vừa ghi → bỏ qua lần lặp`);
      return;
    }
    // Mỗi người 1 alert riêng trong cùng zone; người chưa định danh gộp chung key ''.
    const dedupeKey = userId ?? '';
    const sourceTable = payloadJson.sourceTable as string | undefined;
    const sourceRowId = payloadJson.sourceRowId as string | undefined;

    // CHỈ zone_presence_events có đường join tới iot_device_events (nhánh B qua
    // metadata_json.sourceEventId — xem ZonePresenceWriterService). gate_access_logs có FK
    // event_id trực tiếp nhưng NGOÀI phạm vi lần sửa này (đã xác nhận với user trước đó)
    // → sourceEventId=null cho nhánh đó, giữ nguyên hành vi cũ (không có ảnh).
    // Sự kiện gốc (ảnh) chỉ dùng cho alert MỚI — alert đang mở thì bỏ JOIN này.
    const isOpen = await this.alertsService.hasOpenAlert(
      'intrusion',
      rule.zoneId,
      dedupeKey,
    );
    const sourceEventId =
      !isOpen && sourceTable === 'zone_presence_events' && sourceRowId
        ? await this.findSourceEventIdForPresence(sourceRowId)
        : null;

    // SecurityAlerts.jsx (FE) chỉ có userId (UUID) để hiện cho người vận hành — không tự
    // tra tên. Kèm sẵn fullName ở đây (best-effort, mirror findSourceEventIdForPresence)
    // để FE hiện tên thật thay vì UUID cho người quen vi phạm.
    const fullName = userId ? await this.findUserFullName(userId) : null;

    await this.alertsService.recordAlert({
      alertType: 'intrusion',
      zoneId: rule.zoneId,
      ruleId: rule.id,
      sourceEventId: sourceEventId ?? null,
      payloadJson: {
        ...payloadJson,
        isKnownPerson: userId !== null,
        fullName,
      },
      dedupeKey,
    });
    // Chỉ đánh dấu chống lặp khi ghi THÀNH CÔNG — recordAlert lỗi (throw) thì lần sau
    // (webhook kế tiếp/cron) vẫn được ghi lại, không bị chặn oan 30s.
    this.lastRecordedAt.set(repeatKey, Date.now());
    this.pruneRepeatMap(Date.now());
  }

  private pruneRepeatMap(now: number): void {
    if (this.lastRecordedAt.size <= REPEAT_MAP_MAX) return;
    for (const [k, at] of this.lastRecordedAt) {
      if (now - at >= INTRUSION_REPEAT_MS) this.lastRecordedAt.delete(k);
    }
  }

  /** Tên người ít đổi → cache FULL_NAME_CACHE_MS. */
  private async findUserFullName(userId: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.fullNameCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.value;
    const value = await this.queryUserFullName(userId);
    if (this.fullNameCache.size > REPEAT_MAP_MAX) this.fullNameCache.clear();
    this.fullNameCache.set(userId, {
      value,
      expiresAt: now + FULL_NAME_CACHE_MS,
    });
    return value;
  }

  private async queryUserFullName(userId: string): Promise<string | null> {
    try {
      const rows: Array<{ full_name: string }> =
        await this.dataSource.manager.query(
          `SELECT full_name FROM users WHERE id = $1`,
          [userId],
        );
      return rows[0]?.full_name ?? null;
    } catch (e) {
      this.logger.warn(
        `findUserFullName failed (userId=${userId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      return null;
    }
  }

  /**
   * Lấy iot_device_events.id của raw event GÂY RA 1 dòng zone_presence_events — link qua
   * metadata_json.sourceEventId (nhánh B, KHÔNG có cột FK trực tiếp trên bảng này — xem
   * ivss-presence-ingestion.service.ts + ZonePresenceWriterService). JOIN xác nhận row THẬT
   * tồn tại trong iot_device_events (không trả id "treo" nếu metadata trỏ tới hàng không
   * còn). 1 query nhẹ, KHÔNG N+1 (đúng 1 lần/case vi phạm, KHÔNG loop). Best-effort, KHÔNG
   * throw: presenceId không tồn tại/không có sourceEventId → null (mirror getChannelZoneMap()).
   */
  private async findSourceEventIdForPresence(
    presenceId: string,
  ): Promise<string | null> {
    try {
      const rows: Array<{ id: string }> = await this.dataSource.manager.query(
        `SELECT ide.id
           FROM zone_presence_events zpe
           JOIN iot_device_events ide
             ON ide.id = (zpe.metadata_json->>'sourceEventId')::uuid
          WHERE zpe.id = $1`,
        [presenceId],
      );
      return rows[0]?.id ?? null;
    } catch (e) {
      this.logger.warn(
        `findSourceEventIdForPresence failed (presenceId=${presenceId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      return null;
    }
  }

  /**
   * isViolation (spec §2.3) — trong khung giờ cho phép → KHÔNG vi phạm bất kể userId;
   * ngoài khung (hoặc rule không có khung giờ hợp lệ) → chỉ userId trong
   * `allowedPersonIdsJson` mới KHÔNG vi phạm; userId NULL (chưa định danh) → LUÔN vi phạm.
   */
  private isViolation(
    rule: AlertRuleEntity,
    userId: string | null,
    occurredAt: Date,
  ): boolean {
    const hours = rule.restrictedHoursJson as RestrictedHours | null;
    if (
      hours?.allowFrom &&
      hours?.allowTo &&
      this.isWithinAllowedHours(
        { allowFrom: hours.allowFrom, allowTo: hours.allowTo },
        occurredAt,
      )
    ) {
      return false;
    }

    if (!userId) return true;
    const allowed = rule.allowedPersonIdsJson ?? [];
    return !allowed.includes(userId);
  }

  /**
   * Xử lý qua đêm: allowFrom > allowTo (vd 22:00→06:00) → trong khung nếu >=from HOẶC <=to.
   * `allowFrom`/`allowTo` là giờ VN theo cách admin nhập trên UI — so sánh PHẢI quy
   * `occurredAt` về giờ VN (Asia/Ho_Chi_Minh) qua `vnMinutesOfDay()`, ĐỘC LẬP với TZ
   * runtime của server (KHÔNG dùng Date#getHours()/getMinutes() — sai nếu server chạy
   * UTC, xem vn-restricted-hours.util.ts).
   */
  private isWithinAllowedHours(
    hours: { allowFrom: string; allowTo: string },
    occurredAt: Date,
  ): boolean {
    const toMinutes = (hhmm: string): number => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const from = toMinutes(hours.allowFrom);
    const to = toMinutes(hours.allowTo);
    const current = vnMinutesOfDay(occurredAt);

    if (from <= to) {
      return current >= from && current <= to;
    }
    return current >= from || current <= to; // qua đêm
  }

  /** Chỉ rule intrusion GẮN ZONE CỤ THỂ (§2.1) — rule "toàn khuôn viên" bị bỏ qua có chủ đích. */
  private async loadZoneScopedIntrusionRules(): Promise<AlertRuleEntity[]> {
    const items =
      await this.alertRulesService.listEnabledZoneRules('intrusion');
    return items.filter((r) => r.zoneId !== null);
  }

  /**
   * loadWatermark (§2.4/R5) — KHÔNG có dòng → khởi tạo = thời điểm HIỆN TẠI (KHÔNG quét
   * lùi dữ liệu lịch sử) và lưu luôn (tránh reset watermark mỗi lần restart process).
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
        'ARZ-001/UC-124: watermark cursor cho cron RestrictedZoneIntrusionService — KHÔNG sửa tay.',
    });
    await repo.save(entity);
  }
}
