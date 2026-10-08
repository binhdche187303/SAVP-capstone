import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IoTDeviceEntity } from '../entities/iot-device.entity.js';

/**
 * Lịch sử kết nối 1 thiết bị — dựng lại từ audit_logs (entity_type 'iot_devices'),
 * nơi MỌI lần đổi status đã được ghi: auto_offline/auto_online (probe IOT-014) và
 * disable/enable (thủ công), cùng dạng metadata_json.changed_fields.status {old,new}.
 * Không thêm bảng mới. Cảnh báo device_error gắn vào sự cố theo zone + thời gian chồng
 * nhau (camera hồi phục bị gỡ khỏi payload_json.offlineDevices nên không tra theo id được).
 */

export interface StatusChange {
  at: Date;
  old: string;
  new: string;
}

export interface StatusSegment {
  status: string;
  from: Date;
  to: Date;
}

export interface ConnectionIncident {
  started_at: Date;
  /** null = đang mất kết nối. */
  ended_at: Date | null;
  duration_seconds: number;
  alert_id: string | null;
  alert_status: string | null;
}

export interface ConnectionHistory {
  device_id: string;
  current_status: string;
  from: Date;
  to: Date;
  /** % online trên thời gian được giám sát (bỏ qua disabled/maintenance); null = không có dữ liệu. */
  uptime_percent: number | null;
  uptime_7d_percent: number | null;
  offline_count: number;
  longest_offline_seconds: number;
  segments: StatusSegment[];
  /** Mới nhất trước. */
  incidents: ConnectionIncident[];
}

const DAY_MS = 86_400_000;

/** Ghép các lần đổi status thành đoạn liên tục [from, to] phủ kín cửa sổ. */
export function buildSegments(
  from: Date,
  to: Date,
  initialStatus: string,
  changes: StatusChange[],
): StatusSegment[] {
  const segments: StatusSegment[] = [];
  let status = initialStatus;
  let cursor = from;
  for (const c of changes) {
    if (c.at <= from) {
      status = c.new;
      continue;
    }
    if (c.at >= to) break;
    if (c.new === status) continue;
    segments.push({ status, from: cursor, to: c.at });
    status = c.new;
    cursor = c.at;
  }
  segments.push({ status, from: cursor, to });
  return segments.filter((s) => s.to > s.from);
}

/** % online / (online + offline) trong [since, ∞). */
export function uptimePercent(
  segments: StatusSegment[],
  since: Date,
): number | null {
  let online = 0;
  let offline = 0;
  for (const s of segments) {
    const ms = s.to.getTime() - Math.max(s.from.getTime(), since.getTime());
    if (ms <= 0) continue;
    if (s.status === 'online') online += ms;
    else if (s.status === 'offline') offline += ms;
  }
  const total = online + offline;
  return total === 0 ? null : Math.round((online / total) * 1000) / 10;
}

@Injectable()
export class DeviceConnectionHistoryService {
  constructor(private readonly dataSource: DataSource) {}

  async getHistory(deviceId: string, days: number): Promise<ConnectionHistory> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);

    // Thay đổi trong cửa sổ + lần cuối TRƯỚC cửa sổ (để biết trạng thái lúc bắt đầu).
    const rows: Array<{ at: Date; old: string; new: string }> =
      await this.dataSource.query(
        `(SELECT created_at AS at,
                 metadata_json->'changed_fields'->'status'->>'old' AS old,
                 metadata_json->'changed_fields'->'status'->>'new' AS new
            FROM audit_logs
           WHERE entity_type = 'iot_devices' AND entity_id = $1
             AND metadata_json->'changed_fields'->'status'->>'new' IS NOT NULL
             AND created_at < $2
           ORDER BY created_at DESC LIMIT 1)
         UNION ALL
         (SELECT created_at, metadata_json->'changed_fields'->'status'->>'old',
                 metadata_json->'changed_fields'->'status'->>'new'
            FROM audit_logs
           WHERE entity_type = 'iot_devices' AND entity_id = $1
             AND metadata_json->'changed_fields'->'status'->>'new' IS NOT NULL
             AND created_at >= $2 AND created_at <= $3)
         ORDER BY at`,
        [deviceId, from, to],
      );
    const changes = rows.map((r) => ({ ...r, at: new Date(r.at) }));

    const before = changes.filter((c) => c.at <= from).pop();
    const firstInside = changes.find((c) => c.at > from);
    const initialStatus =
      before?.new ?? firstInside?.old ?? (device.status as string);
    const segments = buildSegments(from, to, initialStatus, changes);

    const offline = segments.filter((s) => s.status === 'offline');
    const alerts: Array<{
      id: string;
      status: string;
      triggered_at: Date;
      resolved_at: Date | null;
    }> =
      device.zoneId && offline.length > 0
        ? await this.dataSource.query(
            `SELECT id, status, triggered_at, resolved_at FROM security_alerts
              WHERE alert_type = 'device_error' AND zone_id = $1
                AND triggered_at <= $3
                AND (resolved_at IS NULL OR resolved_at >= $2)
              ORDER BY triggered_at`,
            [device.zoneId, from, to],
          )
        : [];

    const incidents: ConnectionIncident[] = offline
      .map((s) => {
        const ongoing =
          s.to.getTime() === to.getTime() && device.status === 'offline';
        const alert = alerts.find(
          (a) =>
            new Date(a.triggered_at) <= s.to &&
            (!a.resolved_at || new Date(a.resolved_at) >= s.from),
        );
        return {
          started_at: s.from,
          ended_at: ongoing ? null : s.to,
          duration_seconds: Math.round(
            (s.to.getTime() - s.from.getTime()) / 1000,
          ),
          alert_id: alert?.id ?? null,
          alert_status: alert?.status ?? null,
        };
      })
      .reverse();

    return {
      device_id: device.id,
      current_status: device.status,
      from,
      to,
      uptime_percent: uptimePercent(segments, from),
      uptime_7d_percent: uptimePercent(
        segments,
        new Date(to.getTime() - 7 * DAY_MS),
      ),
      offline_count: offline.length,
      longest_offline_seconds: Math.max(
        0,
        ...incidents.map((i) => i.duration_seconds),
      ),
      segments,
      incidents,
    };
  }
}
