import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { SecurityAlertNotifierService } from '../../alerts/services/security-alert-notifier.service.js';
import type { SecurityAlertEntity } from '../../alerts/entities/security-alert.entity.js';
import type {
  DeviceOfflineAlertHook,
  DeviceOfflineAlertInput,
} from '../../../common/ports/device-offline-alert-hook.js';

interface AlertRow {
  id: string;
  alert_type: string;
  severity: SecurityAlertEntity['severity'];
  zone_id: string | null;
  triggered_at: Date;
}

/** Phần tử `payload_json.offlineDevices` — camera đang mất kết nối trong alert. */
interface OfflineDeviceRef {
  deviceId: string;
  deviceCode: string;
  deviceName: string;
}

/**
 * DeviceOfflineAlertService — camera IP chuyển online ↔ offline (IOT-014 active probe)
 * → `security_alerts` (alertType `device_error`).
 *
 * Dedup dùng NGUYÊN `AlertsService.recordAlert()` (unique mở theo alertType+zoneId):
 * nhiều camera cùng khu vực rớt → 1 alert. `payload_json.offlineDevices` giữ DANH SÁCH
 * camera đang rớt (bump chỉ giữ payload gốc nên tự append). Alert mới → notifier tự gửi;
 * camera thứ 2+ rớt / camera có tín hiệu lại → gửi qua `notifyDeviceStatus`.
 * Camera online lại → gỡ khỏi danh sách; hết camera offline → tự đóng alert.
 *
 * NotThrow toàn bộ: lỗi cảnh báo KHÔNG được phá luồng probe trạng thái thiết bị.
 */
@Injectable()
export class DeviceOfflineAlertService implements DeviceOfflineAlertHook {
  private readonly logger = new Logger(DeviceOfflineAlertService.name);
  private static readonly ALERT_TYPE = 'device_error';

  constructor(
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
    private readonly notifier: SecurityAlertNotifierService,
    private readonly dataSource: DataSource,
  ) {}

  async onDeviceOffline(evt: DeviceOfflineAlertInput): Promise<void> {
    try {
      const alertType = DeviceOfflineAlertService.ALERT_TYPE;

      // --- Step 1: Check alert_rules (rule tắt → suppressed) ---
      let ruleId: string | null = null;
      try {
        const { suppressed, rule } =
          await this.alertRulesService.findEffectiveRule(alertType, evt.zoneId);
        if (suppressed) {
          this.logger.debug(
            `Alert suppressed by rule (type=${alertType} device=${evt.deviceCode})`,
          );
          return;
        }
        ruleId = rule?.id ?? null;
      } catch (e) {
        this.logger.warn(
          `Alert rules check failed (type=${alertType}): ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }

      // --- Step 2: recordAlert (alert mới → notifier tự gửi thông báo) ---
      const ref: OfflineDeviceRef = {
        deviceId: evt.deviceId,
        deviceCode: evt.deviceCode,
        deviceName: evt.deviceName,
      };
      const { alert, isNew } = await this.alertsService.recordAlert({
        alertType,
        zoneId: evt.zoneId,
        ruleId,
        triggeredAt: evt.detectedAt,
        payloadJson: { reason: 'offline', ...ref, offlineDevices: [ref] },
      });
      if (isNew || !alert) return;

      // --- Step 3: bump (alert khu vực đang mở) → thêm camera vào danh sách + báo ---
      const rows = await this.query<{ n: number }>(
        `UPDATE security_alerts
            SET payload_json = jsonb_set(
                  payload_json, '{offlineDevices}',
                  ${this.listExpr()} || $2::jsonb)
          WHERE id = $1
            AND NOT ${this.listExpr()} @> $3::jsonb
        RETURNING jsonb_array_length(payload_json->'offlineDevices') AS n`,
        [
          alert.id,
          JSON.stringify([ref]),
          JSON.stringify([{ deviceId: evt.deviceId }]),
        ],
      );
      if (rows.length === 0) return; // camera đã có trong danh sách → không báo lại.
      await this.notifier.notifyDeviceStatus(
        alert,
        'Cảnh báo: thêm camera mất kết nối',
        `Camera ${evt.deviceName} (${evt.deviceCode}) cũng không còn phản hồi — ${rows[0].n} camera đang mất kết nối trong khu vực.`,
      );
    } catch (e) {
      this.logger.error(
        `Device offline alert failed (device=${evt.deviceCode}): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  async onDeviceOnline(evt: DeviceOfflineAlertInput): Promise<void> {
    try {
      // Gỡ camera khỏi MỌI alert device_error đang mở chứa nó (kể cả alert cũ chỉ có deviceId).
      const alerts = await this.query<AlertRow & { remaining: number }>(
        `UPDATE security_alerts
            SET payload_json = jsonb_set(
                  payload_json, '{offlineDevices}',
                  COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(${this.listExpr()}) e
                             WHERE e->>'deviceId' <> $1), '[]'::jsonb))
          WHERE alert_type = 'device_error'
            AND status <> 'resolved'
            AND (payload_json->>'deviceId' = $1 OR ${this.listExpr()} @> $2::jsonb)
        RETURNING id, alert_type, severity, zone_id, triggered_at, (
          SELECT COUNT(*)::int FROM iot_devices d
           WHERE d.status = 'offline' AND d.id::text <> $1
             AND (d.id::text = payload_json->>'deviceId'
                  OR payload_json->'offlineDevices' @> jsonb_build_array(jsonb_build_object('deviceId', d.id::text)))
        ) AS remaining`,
        [evt.deviceId, JSON.stringify([{ deviceId: evt.deviceId }])],
      );

      for (const a of alerts) {
        const resolved =
          a.remaining === 0
            ? await this.query<{ id: string }>(
                `UPDATE security_alerts
                    SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
                        resolution_note = 'Tự động đóng: camera đã có tín hiệu lại'
                  WHERE id = $1 AND status <> 'resolved'
                RETURNING id`,
                [a.id],
              )
            : [];
        await this.notifier.notifyDeviceStatus(
          {
            id: a.id,
            alertType: a.alert_type,
            severity: a.severity,
            zoneId: a.zone_id,
            triggeredAt: a.triggered_at,
          } as SecurityAlertEntity,
          'Camera đã có tín hiệu lại',
          `Camera ${evt.deviceName} (${evt.deviceCode}) đã có tín hiệu lại.` +
            (resolved.length > 0
              ? ' Cảnh báo đã tự động đóng.'
              : ` Còn ${a.remaining} camera đang mất kết nối trong khu vực.`),
        );
      }
    } catch (e) {
      this.logger.error(
        `Device online handling failed (device=${evt.deviceCode}): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  /** Danh sách camera rớt (alert cũ trước bản này chỉ có deviceId top-level → dựng từ đó). */
  private listExpr(): string {
    return `COALESCE(payload_json->'offlineDevices',
      jsonb_build_array(jsonb_build_object(
        'deviceId', payload_json->>'deviceId',
        'deviceCode', payload_json->>'deviceCode',
        'deviceName', payload_json->>'deviceName')))`;
  }

  /** UPDATE…RETURNING qua TypeORM trả [rows,count]; SELECT trả rows. */
  private async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    const res: unknown = await this.dataSource.manager.query(sql, params);
    if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0])) {
      return res[0] as T[];
    }
    return (res as T[]) ?? [];
  }
}
