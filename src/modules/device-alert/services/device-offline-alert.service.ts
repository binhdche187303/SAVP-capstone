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
export interface OfflineDeviceRef {
  deviceId: string;
  deviceCode: string;
  deviceName: string;
}

/** Số camera liệt kê tên trong nội dung thông báo; còn lại ghi "và N camera khác". */
const MAX_NAMES_IN_TEXT = 5;

/** "Cam 1 (CAM-1), Cam 2 (CAM-2) và 3 camera khác". */
export function formatCameraList(refs: OfflineDeviceRef[]): string {
  const shown = refs
    .slice(0, MAX_NAMES_IN_TEXT)
    .map((r) => `${r.deviceName} (${r.deviceCode})`)
    .join(', ');
  const rest = refs.length - MAX_NAMES_IN_TEXT;
  return rest > 0 ? `${shown} và ${rest} camera khác` : shown;
}

/**
 * DeviceOfflineAlertService — camera IP chuyển online ↔ offline (IOT-014 active probe)
 * → `security_alerts` (alertType `device_error`).
 *
 * Nhận CẢ LÔ camera đổi trạng thái trong 1 lượt quét, gộp theo khu vực:
 * - Rớt: mỗi khu vực 1 lần `recordAlert()` (unique mở theo alertType+zoneId) với
 *   `payload_json.offlineDevices` = cả danh sách. Alert mới → notifier tự gửi 1 thông báo
 *   ("N camera mất kết nối"); alert đang mở → append cả lô bằng 1 UPDATE + 1 thông báo.
 * - Có tín hiệu lại: 1 UPDATE gỡ cả lô khỏi mọi alert đang mở, 1 UPDATE đóng các alert hết
 *   camera rớt, mỗi alert 1 thông báo.
 * Trước đây: mỗi camera 1 lần xử lý + 1 thông báo (100 camera rớt ≈ 100 thông báo/người).
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

  async onDevicesOffline(evts: DeviceOfflineAlertInput[]): Promise<void> {
    const byZone = new Map<string | null, DeviceOfflineAlertInput[]>();
    for (const e of evts) {
      const list = byZone.get(e.zoneId) ?? [];
      list.push(e);
      byZone.set(e.zoneId, list);
    }
    for (const [zoneId, group] of byZone) {
      await this.handleZoneOffline(zoneId, group);
    }
  }

  private async handleZoneOffline(
    zoneId: string | null,
    group: DeviceOfflineAlertInput[],
  ): Promise<void> {
    const alertType = DeviceOfflineAlertService.ALERT_TYPE;
    const zoneLabel = zoneId ?? 'toàn hệ thống';
    try {
      let ruleId: string | null = null;
      try {
        const { suppressed, rule } =
          await this.alertRulesService.findEffectiveRule(alertType, zoneId);
        if (suppressed) {
          this.logger.log(
            `[CAM-OFFLINE] Khu vực ${zoneLabel}: luật đang tắt → bỏ qua ${group.length} camera`,
          );
          return;
        }
        ruleId = rule?.id ?? null;
      } catch (e) {
        this.logger.warn(
          `Alert rules check failed (type=${alertType}): ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }

      const refs: OfflineDeviceRef[] = group.map((e) => ({
        deviceId: e.deviceId,
        deviceCode: e.deviceCode,
        deviceName: e.deviceName,
      }));
      const { alert, isNew } = await this.alertsService.recordAlert({
        alertType,
        zoneId,
        ruleId,
        triggeredAt: group[0].detectedAt,
        payloadJson: { reason: 'offline', ...refs[0], offlineDevices: refs },
      });
      if (isNew) {
        this.logger.log(
          `[CAM-OFFLINE] Khu vực ${zoneLabel}: tạo 1 cảnh báo mới cho ${refs.length} camera → 1 thông báo/người`,
        );
        return;
      }
      if (!alert) return;

      // Alert đang mở → append các camera CHƯA có trong danh sách, 1 câu UPDATE.
      const rows = await this.query<{
        total: number;
        added: OfflineDeviceRef[];
      }>(
        `WITH cur AS (
           SELECT id, ${this.listExpr()} AS list FROM security_alerts WHERE id = $1
         ), add AS (
           SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) AS items
             FROM cur, jsonb_array_elements($2::jsonb) x
            WHERE NOT cur.list @> jsonb_build_array(jsonb_build_object('deviceId', x->>'deviceId'))
         )
         UPDATE security_alerts s
            SET payload_json = jsonb_set(s.payload_json, '{offlineDevices}', cur.list || add.items),
                updated_at = NOW()
           FROM cur, add
          WHERE s.id = cur.id AND jsonb_array_length(add.items) > 0
        RETURNING jsonb_array_length(s.payload_json->'offlineDevices') AS total,
                  add.items AS added`,
        [alert.id, JSON.stringify(refs)],
      );
      if (rows.length === 0) return; // mọi camera đã có trong danh sách → không báo lại.
      const { total, added } = rows[0];
      this.logger.log(
        `[CAM-OFFLINE] Khu vực ${zoneLabel}: thêm ${added.length} camera vào cảnh báo đang mở (tổng ${total}) → 1 thông báo/người`,
      );
      await this.notifier.notifyDeviceStatus(
        alert,
        added.length > 1
          ? `Cảnh báo: thêm ${added.length} camera mất kết nối`
          : 'Cảnh báo: thêm camera mất kết nối',
        `${formatCameraList(added)} cũng không còn phản hồi — ${total} camera đang mất kết nối trong khu vực.`,
      );
    } catch (e) {
      this.logger.error(
        `Device offline alert failed (zone=${zoneLabel}, ${group.length} camera): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  async onDevicesOnline(evts: DeviceOfflineAlertInput[]): Promise<void> {
    if (evts.length === 0) return;
    try {
      const ids = evts.map((e) => e.deviceId);
      const byId = new Map(evts.map((e) => [e.deviceId, e]));

      // 1 câu: gỡ cả lô khỏi mọi alert đang mở có chứa chúng; trả số camera còn offline.
      const alerts = await this.query<
        AlertRow & { recovered_ids: string[]; remaining: number }
      >(
        `WITH tgt AS (
           SELECT id, ${this.listExpr()} AS list
             FROM security_alerts
            WHERE alert_type = 'device_error'
              AND status <> 'resolved'
              AND (payload_json->>'deviceId' = ANY($1::text[])
                   OR EXISTS (SELECT 1 FROM jsonb_array_elements(${this.listExpr()}) e
                               WHERE e->>'deviceId' = ANY($1::text[])))
         ), upd AS (
           UPDATE security_alerts s
              SET payload_json = jsonb_set(s.payload_json, '{offlineDevices}',
                    COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(tgt.list) e
                               WHERE NOT (e->>'deviceId' = ANY($1::text[]))), '[]'::jsonb)),
                  updated_at = NOW()
             FROM tgt
            WHERE s.id = tgt.id
          RETURNING s.id, s.alert_type, s.severity, s.zone_id, s.triggered_at,
                    s.payload_json->'offlineDevices' AS list,
                    (SELECT COALESCE(jsonb_agg(e->>'deviceId'), '[]'::jsonb)
                       FROM jsonb_array_elements(tgt.list) e
                      WHERE e->>'deviceId' = ANY($1::text[])) AS recovered_ids
         )
         SELECT upd.id, upd.alert_type, upd.severity, upd.zone_id, upd.triggered_at,
                upd.recovered_ids,
                (SELECT COUNT(*)::int FROM jsonb_array_elements(upd.list) e
                   JOIN iot_devices d ON d.id::text = e->>'deviceId'
                  WHERE d.status = 'offline') AS remaining
           FROM upd`,
        [ids],
      );
      if (alerts.length === 0) return;

      // 1 câu: đóng mọi alert đã hết camera rớt.
      const doneIds = alerts.filter((a) => a.remaining === 0).map((a) => a.id);
      const resolved = new Set(
        doneIds.length === 0
          ? []
          : (
              await this.query<{ id: string }>(
                `UPDATE security_alerts
                    SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
                        resolution_note = 'Tự động đóng: camera đã có tín hiệu lại'
                  WHERE id = ANY($1::uuid[]) AND status <> 'resolved'
                RETURNING id`,
                [doneIds],
              )
            ).map((r) => r.id),
      );

      for (const a of alerts) {
        const recovered: OfflineDeviceRef[] = (a.recovered_ids ?? [])
          .map((id) => byId.get(id))
          .filter((e): e is DeviceOfflineAlertInput => !!e)
          .map((e) => ({
            deviceId: e.deviceId,
            deviceCode: e.deviceCode,
            deviceName: e.deviceName,
          }));
        if (recovered.length === 0) continue;
        const isResolved = resolved.has(a.id);
        this.logger.log(
          `[CAM-OFFLINE] Cảnh báo ${a.id}: ${recovered.length} camera có tín hiệu lại, còn ${a.remaining} rớt` +
            (isResolved ? ' → tự đóng cảnh báo' : '') +
            ' → 1 thông báo/người',
        );
        await this.notifier.notifyDeviceStatus(
          {
            id: a.id,
            alertType: a.alert_type,
            severity: a.severity,
            zoneId: a.zone_id,
            triggeredAt: a.triggered_at,
          } as SecurityAlertEntity,
          recovered.length > 1
            ? `${recovered.length} camera đã có tín hiệu lại`
            : 'Camera đã có tín hiệu lại',
          `${recovered.length > 1 ? 'Các camera ' : 'Camera '}${formatCameraList(recovered)} đã có tín hiệu lại.` +
            (isResolved
              ? ' Cảnh báo đã tự động đóng.'
              : ` Còn ${a.remaining} camera đang mất kết nối trong khu vực.`),
        );
      }
    } catch (e) {
      this.logger.error(
        `Device online handling failed (${evts.length} camera): ${e instanceof Error ? e.message : 'unknown'}`,
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
