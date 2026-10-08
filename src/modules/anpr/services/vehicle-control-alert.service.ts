import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { VehicleControlListService } from './vehicle-control-list.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { AlertSeverity } from '../../alerts/dto/record-alert.input.js';
import { IVSS_CHANNEL_PRESENCE_ZONE_MAP_KEY } from '../../ivss/constants/zone-presence.constant.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VehicleControlAlertContext {
  channelId: number;
  direction: string;
}

export interface VehicleControlAlertOptions {
  /**
   * STT 20 (perf): caller đã resolve biển → đăng ký `active` (VehicleResolveService
   * resolveUserByPlate). Xe active KHÔNG BAO GIỜ sinh unknown_vehicle/vehicle_unauthorized
   * → bỏ query vehicle_registrations. Control-list VẪN kiểm tra như cũ.
   */
  registeredActive?: boolean;
}

/** STT 20 (perf): TTL cache zone map + recipients (mirror CHANNEL_MAP_CACHE_MS của VehicleResolveService). */
const CONFIG_CACHE_MS = 30_000;
/** STT 20 (perf): trần map throttle — vượt thì dọn các plate đã hết cửa sổ throttle. */
const THROTTLE_MAP_MAX = 5000;

/**
 * VehicleControlAlertService (VCC-001 / UC9) — "đích cảnh báo" khi biển số khớp
 * `vehicle_control_list`. Tách biệt khỏi `checkControlList` (pure lookup) theo chủ đích.
 *
 * ASM-001 (Bước 3 / 3d): trước khi gửi notification (giữ nguyên 100%), gọi
 * `AlertRulesService.findEffectiveRule('vehicle_control_match', null)` — `suppressed` (rule
 * tắt tường minh) → dừng CẢ recordAlert lẫn notification (AF1). Không suppressed →
 * `AlertsService.recordAlert()` TRƯỚC (severity theo `listType`, bọc try/catch NotThrow
 * RIÊNG — lỗi ghi `security_alerts` KHÔNG được chặn notification cũ), rồi mới notification
 * như cũ.
 *
 * F6 (recon R1): `zoneId` resolve qua `system_configs['ivss.channel_presence_zone_map']`
 * (mirror `ivss-presence-ingestion.service.ts`/`ivss-occupancy-ingest.service.ts` — KHÔNG
 * có hàm dùng chung, tech-debt TD-ZPW-1 đã ghi nhận). TRƯỚC ĐÂY query thẳng
 * `iot_devices.channel_id` — cột đó KHÔNG TỒN TẠI → luôn throw → zoneId luôn null (bug đã
 * fix). Channel chưa map → `zoneId=null`, alert VẪN bắn bình thường (bất biến, KHÔNG đổi).
 *
 * NotThrow toàn bộ `evaluate()`: lỗi cảnh báo KHÔNG được phá luồng ingest event chính
 * (mirror `VehicleResolveService`/`StrangerAlertService`). Throttle in-memory theo plate
 * (⚠ single-instance, reset khi restart — mirror `StrangerAlertService`).
 */
@Injectable()
export class VehicleControlAlertService {
  private readonly logger = new Logger(VehicleControlAlertService.name);
  private static readonly DEFAULT_THROTTLE_SECONDS = 300;
  private readonly lastAlertAt = new Map<string, number>();
  private zoneMapCache?: { at: number; value: Record<string, string> };
  private recipientsCache?: { at: number; value: string[] };

  constructor(
    private readonly vehicleControlListService: VehicleControlListService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
  ) {}

  async evaluate(
    plateNumber: string,
    context: VehicleControlAlertContext,
    eventId?: string,
    options: VehicleControlAlertOptions = {},
  ): Promise<void> {
    try {
      // --- Step 1: Throttle check ---
      const throttleMs =
        this.configService.get<number>(
          'VEHICLE_CONTROL_ALERT_THROTTLE_SECONDS',
          VehicleControlAlertService.DEFAULT_THROTTLE_SECONDS,
        ) * 1000;
      const now = Date.now();
      const last = this.lastAlertAt.get(plateNumber);
      if (last !== undefined && now - last < throttleMs) {
        return;
      }
      this.lastAlertAt.set(plateNumber, now);
      this.pruneThrottle(now, throttleMs);

      // --- Step 3: Priority chain (B>C>A>D) ---
      let alertType: string | null = null;
      let severity: AlertSeverity = 'medium';
      let subject = '';
      let notificationType: NotificationType =
        NotificationType.VEHICLE_CONTROL_LIST_MATCH;
      let payload: Record<string, unknown> = {
        plateNumber,
        channelId: context.channelId,
        direction: context.direction,
      };
      let ruleId: string | null = null;

      const controlListMatch =
        await this.vehicleControlListService.checkControlList(plateNumber);
      if (controlListMatch) {
        payload = {
          ...payload,
          listType: controlListMatch.listType,
          reason: controlListMatch.reason,
          controlListEntryId: controlListMatch.id,
        };
        if (controlListMatch.listType === 'blocklist') {
          alertType = 'vehicle_control_match';
          severity = 'high';
          subject = 'Cảnh báo: xe trong danh sách chặn';
          notificationType = NotificationType.VEHICLE_CONTROL_LIST_MATCH;
        } else {
          alertType = 'vehicle_control_match';
          severity = 'medium';
          subject = 'Cảnh báo: xe cần theo dõi';
          notificationType = NotificationType.VEHICLE_CONTROL_LIST_MATCH;
        }
      }

      if (!alertType && !options.registeredActive) {
        try {
          const regRows: Array<{ status: string }> =
            await this.dataSource.manager.query(
              `SELECT status FROM vehicle_registrations WHERE plate_number = $1 AND deleted_at IS NULL LIMIT 1`,
              [plateNumber],
            );
          if (regRows.length === 0) {
            alertType = 'unknown_vehicle';
            severity = 'medium';
            subject = 'Cảnh báo: biển số không xác định';
            notificationType = NotificationType.UNKNOWN_VEHICLE_ALERT;
          } else if (
            regRows[0].status === 'pending' ||
            regRows[0].status === 'rejected'
          ) {
            alertType = 'vehicle_unauthorized';
            severity = 'low';
            subject = 'Thông báo: xe đang chờ duyệt/bị từ chối';
            notificationType = NotificationType.VEHICLE_UNAUTHORIZED_ALERT;
          }
        } catch (e) {
          this.logger.warn(
            `Vehicle registration check failed (plate=${plateNumber}): ${e instanceof Error ? e.message : 'unknown'}`,
          );
          return;
        }
      }

      if (!alertType) return;

      // --- Step 2: Resolve zone_id from channelId (FR-020) ---
      // F6: qua channel_presence_zone_map — KHÔNG map → zoneId=null, KHÔNG throw
      // (AC-BACKCOMPAT, mirror pattern presence/occupancy).
      // STT 20 (perf): dời xuống SAU khi biết có alertType — xe không cảnh báo không đọc map.
      const zoneId = await this.resolveZone(context.channelId);

      // --- Step 4: Check alert_rules ---
      try {
        const { suppressed, rule } =
          await this.alertRulesService.findEffectiveRule(alertType, zoneId);
        if (suppressed) {
          this.logger.debug(
            `Alert suppressed by rule (type=${alertType} plate=${plateNumber})`,
          );
          return;
        }
        ruleId = rule?.id ?? null;
      } catch (e) {
        this.logger.warn(
          `Alert rules check failed (type=${alertType}): ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }

      // --- Step 5: recordAlert ---
      // Đợt 3: dedupeKey = biển số → 2 xe KHÁC biển cùng zone là 2 alert riêng (trước đây
      // gộp chung 1 alert theo (alertType, zoneId) → mất biển của xe thứ 2).
      let isNew = true;
      try {
        const res = await this.alertsService.recordAlert({
          alertType,
          zoneId,
          severity,
          ruleId,
          sourceEventId: eventId ?? null,
          payloadJson: payload,
          dedupeKey: plateNumber,
        });
        isNew = res?.isNew !== false;
      } catch (e) {
        this.logger.error(
          `recordAlert failed (plate=${plateNumber}): ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }
      // Đợt 3: alert của biển này vẫn đang MỞ (chỉ bump) → KHÔNG gửi lại thông báo.
      // recordAlert lỗi → vẫn gửi (giữ đảm bảo cũ: lỗi ghi alert không chặn notification).
      if (!isNew) {
        this.logger.debug(
          `Alert still open (type=${alertType} plate=${plateNumber}) — bump only, skip notification.`,
        );
        return;
      }

      // --- Step 6: createNotification ---
      const recipients = await this.resolveRecipients();
      if (recipients.length === 0) {
        this.logger.warn(
          `Alert match (plate=${plateNumber}) - no recipients, skip notification.`,
        );
        return;
      }
      const alertContent =
        `Biển số ${plateNumber} vừa qua cổng ` +
        `(channel ${context.channelId}, direction ${context.direction}).` +
        (payload.listType ? ` Loại: ${payload.listType}.` : '') +
        (payload.reason ? ` Lý do: ${payload.reason}.` : '');
      await this.notificationsService.createNotification({
        notificationType,
        channel: NotificationChannel.IN_APP,
        subject,
        content: alertContent,
        priority:
          severity === 'high'
            ? NotificationPriority.HIGH
            : severity === 'low'
              ? NotificationPriority.LOW
              : NotificationPriority.NORMAL,
        recipientScope: 'user_list',
        recipientUserIds: recipients,
        payloadJson: payload,
      });
    } catch (e) {
      this.logger.error(
        `Alert evaluation failed (plate=${plateNumber}): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }
  private async resolveZone(channelId: number): Promise<string | null> {
    const map = await this.getChannelPresenceZoneMap();
    return map[String(channelId)] ?? null;
  }

  /** STT 20 (perf): map vượt trần → xoá plate đã quá cửa sổ throttle (không đổi hành vi throttle). */
  private pruneThrottle(now: number, throttleMs: number): void {
    if (this.lastAlertAt.size <= THROTTLE_MAP_MAX) return;
    for (const [plate, at] of this.lastAlertAt) {
      if (now - at >= throttleMs) this.lastAlertAt.delete(plate);
    }
  }

  /**
   * F6 (recon R1/R2): system_configs['ivss.channel_presence_zone_map'] {channelId: zone_uuid};
   * validate uuid. STT 20: cache CONFIG_CACHE_MS khi đọc THÀNH CÔNG (kể cả map rỗng); đọc
   * lỗi KHÔNG cache. Đọc lỗi/không map → {} (KHÔNG throw): map-miss = zoneId=null,
   * alert vẫn bắn (AC-BACKCOMPAT). Mirror ivss-occupancy-ingest.service.ts/
   * ivss-presence-ingestion.service.ts — KHÔNG có hàm dùng chung (TD-ZPW-1).
   */
  private async getChannelPresenceZoneMap(): Promise<Record<string, string>> {
    if (
      this.zoneMapCache &&
      Date.now() - this.zoneMapCache.at < CONFIG_CACHE_MS
    ) {
      return this.zoneMapCache.value;
    }
    const out: Record<string, string> = {};
    try {
      const rows: Array<{ config_json: Record<string, unknown> | null }> =
        await this.dataSource.manager.query(
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
      this.zoneMapCache = { at: Date.now(), value: out };
    } catch (e) {
      this.logger.warn(
        `channel_presence_zone_map read failed (→ zoneId null): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
    return out;
  }

  /**
   * Recipient = đúng bộ role đã gán quyền `vehicle_control.read` (UC8 migration 20260722000001).
   * STT 20: cache CONFIG_CACHE_MS khi có recipient; rỗng/lỗi KHÔNG cache.
   */
  private async resolveRecipients(): Promise<string[]> {
    if (
      this.recipientsCache &&
      Date.now() - this.recipientsCache.at < CONFIG_CACHE_MS
    ) {
      return this.recipientsCache.value;
    }
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
         JOIN roles r ON r.id = ur.role_id
        WHERE r.role_code IN ('MANAGER','BUSINESS_ADMIN','SYSTEM_ADMIN')
          AND u.deleted_at IS NULL`,
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) this.recipientsCache = { at: Date.now(), value: ids };
    return ids;
  }
}
