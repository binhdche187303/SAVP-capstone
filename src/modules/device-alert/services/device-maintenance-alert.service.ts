import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { SecurityAlertNotifierService } from '../../alerts/services/security-alert-notifier.service.js';
import { formatCameraList } from './device-offline-alert.service.js';

export const MAINTENANCE_ALERT_TYPE = 'device_maintenance';
const CONFIG_KEY = 'device_maintenance.offline_hours';
const DEFAULT_HOURS = 24;

interface StaleRow {
  device_id: string;
  device_code: string;
  device_name: string;
  zone_id: string | null;
  offline_since: Date;
  groups: string[];
}

export interface MaintenanceScanResult {
  thresholdHours: number;
  stale: number;
  alertsRecorded: number;
  alertsResolved: number;
}

/**
 * CAMG-001 — camera offline liên tục quá X giờ (system_configs `device_maintenance.offline_hours`,
 * mặc định 24) → cảnh báo `device_maintenance` theo khu vực, payload liệt kê camera + nhóm.
 * "Offline từ lúc" = lần cuối audit ghi status→offline (probe/heartbeat), thiếu thì last_seen_at/updated_at.
 * Alert tự đóng khi khu vực hết camera quá hạn (SecurityAlertAutoResolveService bỏ qua loại này).
 */
@Injectable()
export class DeviceMaintenanceAlertService {
  private readonly logger = new Logger(DeviceMaintenanceAlertService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly alertsService: AlertsService,
    private readonly notifier: SecurityAlertNotifierService,
  ) {}

  async scan(now = new Date()): Promise<MaintenanceScanResult> {
    const hours = await this.getThresholdHours();
    const cutoff = new Date(now.getTime() - hours * 3_600_000);
    const stale = await this.findStale(cutoff);

    const byZone = new Map<string | null, StaleRow[]>();
    for (const r of stale) byZone.set(r.zone_id, [...(byZone.get(r.zone_id) ?? []), r]);

    let recorded = 0;
    for (const [zoneId, rows] of byZone) {
      if (await this.recordZone(zoneId, rows, hours)) recorded++;
    }
    const resolved = await this.resolveRecovered([...byZone.keys()]);
    return { thresholdHours: hours, stale: stale.length, alertsRecorded: recorded, alertsResolved: resolved };
  }

  private async getThresholdHours(): Promise<number> {
    const rows: Array<{ config_value: string | null }> = await this.dataSource.query(
      `SELECT config_value FROM system_configs WHERE config_key = $1 AND is_active = true`,
      [CONFIG_KEY],
    );
    const n = parseInt(rows[0]?.config_value ?? '', 10);
    return Number.isInteger(n) && n >= 1 ? n : DEFAULT_HOURS;
  }

  private findStale(cutoff: Date): Promise<StaleRow[]> {
    return this.dataSource.query(
      `SELECT d.id AS device_id, d.device_code, d.device_name, d.zone_id,
              COALESCE(a.at, d.last_seen_at, d.updated_at) AS offline_since,
              COALESCE((SELECT array_agg(g.group_name ORDER BY g.group_name)
                          FROM camera_group_members m JOIN camera_groups g ON g.id = m.group_id
                         WHERE m.device_id = d.id), '{}') AS groups
         FROM iot_devices d
         LEFT JOIN LATERAL (
           SELECT MAX(created_at) AS at FROM audit_logs
            WHERE entity_type = 'iot_devices' AND entity_id = d.id
              AND metadata_json->'changed_fields'->'status'->>'new' = 'offline'
         ) a ON true
        WHERE d.status = 'offline'
          AND d.device_type IN ('ip_camera','door_camera','room_camera','anpr_camera')
          AND COALESCE(a.at, d.last_seen_at, d.updated_at) <= $1`,
      [cutoff],
    );
  }

  private async recordZone(zoneId: string | null, rows: StaleRow[], hours: number): Promise<boolean> {
    try {
      const devices = rows.map((r) => ({
        deviceId: r.device_id,
        deviceCode: r.device_code,
        deviceName: r.device_name,
        offlineSince: r.offline_since,
        groups: r.groups,
      }));
      const { alert, isNew } = await this.alertsService.recordAlert({
        alertType: MAINTENANCE_ALERT_TYPE,
        zoneId,
        payloadJson: { thresholdHours: hours, devices },
      });
      if (!alert) return false;
      if (!isNew) {
        // Alert đang mở: làm tươi danh sách camera (không báo lại).
        await this.dataSource.query(`UPDATE security_alerts SET payload_json = $2::jsonb, updated_at = NOW() WHERE id = $1`, [
          alert.id,
          JSON.stringify({ thresholdHours: hours, devices }),
        ]);
        return true;
      }
      await this.notifier.notifyDeviceStatus(
        alert,
        `${devices.length} camera cần bảo trì`,
        `${formatCameraList(devices)} đã mất kết nối quá ${hours} giờ, cần kiểm tra bảo trì.`,
      );
      return true;
    } catch (e) {
      this.logger.error(`Maintenance alert failed (zone=${zoneId ?? 'none'}): ${e instanceof Error ? e.message : 'unknown'}`);
      return false;
    }
  }

  /** Đóng alert mở của khu vực không còn camera quá hạn. */
  private async resolveRecovered(activeZones: Array<string | null>): Promise<number> {
    const res: unknown = await this.dataSource.query(
      `UPDATE security_alerts
          SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
              resolution_note = 'Tự động đóng: không còn camera offline quá hạn'
        WHERE alert_type = $1 AND status <> 'resolved'
          AND NOT (
            zone_id IS NULL AND $3::boolean
            OR zone_id = ANY($2::uuid[])
          )
        RETURNING id`,
      [MAINTENANCE_ALERT_TYPE, activeZones.filter((z): z is string => !!z), activeZones.includes(null)],
    );
    const rows = Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) ? res[0] : (res as unknown[]);
    return rows.length;
  }
}
