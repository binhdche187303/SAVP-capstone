import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { resolveOccupancyStatus } from '../utils/resolve-occupancy-status.util.js';
import { resolveCameraStatus } from '../utils/resolve-camera-status.util.js';
import { toZoneCoordinates } from '../utils/to-zone-coordinates.util.js';
import type { QueryCampusMapDto } from '../dto/query-campus-map.dto.js';
import type {
  CampusMapResponseDto,
  MapAlertDto,
  MapZoneAlertsDto,
  MapZoneDto,
} from '../dto/campus-map-response.dto.js';

const DEFAULT_HOURS = 24;
const LATEST_ALERTS_PER_ZONE = 5;
const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

interface AlertAggregateRow {
  zone_id: string | null;
  total: number;
  open: number;
  top_open_rank: number | null;
}

interface AlertRow {
  id: string;
  zone_id: string;
  alert_type: string;
  severity: string;
  status: string;
  triggered_at: Date | string;
  last_seen_at: Date | string | null;
  occurrence_count: number;
}

/**
 * Cảnh báo "có hoạt động trong cửa sổ": lần cuối thấy (`last_seen_at`, cảnh báo gộp lặp) hoặc
 * lúc phát sinh. Gộp cả nhóm `zone_id IS NULL` để báo số cảnh báo không định vị được.
 */
const ALERT_AGGREGATE_SQL = `
  SELECT zone_id,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status <> 'resolved')::int AS open,
         MAX(CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3
                           WHEN 'medium' THEN 2 WHEN 'low' THEN 1 END)
           FILTER (WHERE status <> 'resolved') AS top_open_rank
  FROM security_alerts
  WHERE COALESCE(last_seen_at, triggered_at) >= $1
  GROUP BY zone_id
`;

const LATEST_ALERTS_SQL = `
  SELECT id, zone_id, alert_type, severity, status, triggered_at, last_seen_at, occurrence_count
  FROM (
    SELECT a.*, ROW_NUMBER() OVER (
             PARTITION BY zone_id
             ORDER BY COALESCE(last_seen_at, triggered_at) DESC, id DESC
           ) AS rn
    FROM security_alerts a
    WHERE zone_id = ANY($1::uuid[])
      AND COALESCE(last_seen_at, triggered_at) >= $2
  ) t
  WHERE rn <= ${LATEST_ALERTS_PER_ZONE}
  ORDER BY zone_id, rn
`;

const toIso = (v: Date | string | null): string | null =>
  v == null ? null : new Date(v).toISOString();

/**
 * CampusMapService — dữ liệu cho "Bản đồ GIS khuôn viên": mỗi zone kèm toạ độ GPS, danh sách
 * thiết bị (camera) gắn zone, occupancy và cảnh báo an ninh gần đây. READ-ONLY (DATA-01).
 *
 * Vị trí camera = vị trí zone (bảng `iot_devices` không có toạ độ riêng).
 */
@Injectable()
export class CampusMapService {
  constructor(
    private readonly repo: CampusDashboardRepository,
    private readonly dataSource: DataSource,
  ) {}

  async getMap(query: QueryCampusMapDto): Promise<CampusMapResponseDto> {
    const now = new Date();
    const hours = query.hours ?? DEFAULT_HOURS;
    const since = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const zones = await this.repo.loadZoneHierarchy({
      building: query.building,
    });
    const zoneIds = zones.map((z) => z.id);

    const [stalenessMinutes, devices] = await Promise.all([
      this.repo.loadStalenessMinutes(),
      this.repo.loadDevicesByZone(zoneIds),
    ]);
    const aggregateRows: AlertAggregateRow[] = await this.dataSource.query(
      ALERT_AGGREGATE_SQL,
      [since],
    );
    const alertRows: AlertRow[] =
      zoneIds.length === 0
        ? []
        : await this.dataSource.query(LATEST_ALERTS_SQL, [zoneIds, since]);

    const aggregateByZone = new Map(aggregateRows.map((r) => [r.zone_id, r]));
    const latestByZone = new Map<string, MapAlertDto[]>();
    for (const row of alertRows) {
      const list = latestByZone.get(row.zone_id) ?? [];
      list.push({
        alertId: row.id,
        alertType: row.alert_type,
        severity: row.severity,
        status: row.status,
        triggeredAt: toIso(row.triggered_at)!,
        lastSeenAt: toIso(row.last_seen_at),
        occurrenceCount: Number(row.occurrence_count) || 1,
      });
      latestByZone.set(row.zone_id, list);
    }

    const mapZones: MapZoneDto[] = [];
    for (const zone of zones) {
      const devicesInZone = devices.filter((d) => d.zoneId === zone.id);
      const latestEvent = await this.repo.loadLatestCountEvent(zone.id);
      const agg = aggregateByZone.get(zone.id);
      const alerts: MapZoneAlertsDto = {
        total: agg ? Number(agg.total) : 0,
        open: agg ? Number(agg.open) : 0,
        topOpenSeverity: this.severityFromRank(agg?.top_open_rank ?? null),
        latest: latestByZone.get(zone.id) ?? [],
      };

      mapZones.push({
        zoneId: zone.id,
        zoneCode: zone.zoneCode,
        zoneName: zone.zoneName,
        zoneType: zone.zoneType,
        building: zone.building,
        floor: zone.floor,
        status: zone.status,
        coordinates: toZoneCoordinates(zone),
        occupancy: resolveOccupancyStatus(
          devicesInZone,
          latestEvent,
          stalenessMinutes,
          now,
        ),
        cameraStatus: resolveCameraStatus(devicesInZone),
        cameras: devicesInZone
          .map((d) => ({
            deviceId: d.id,
            deviceCode: d.deviceCode,
            deviceName: d.deviceName,
            deviceType: d.deviceType,
            status: d.status,
            lastSeenAt: d.lastSeenAt ? toIso(d.lastSeenAt) : null,
          }))
          .sort((a, b) => a.deviceCode.localeCompare(b.deviceCode)),
        alerts,
      });
    }

    const unlocated = aggregateByZone.get(null);
    return {
      generatedAt: now.toISOString(),
      hours,
      since: since.toISOString(),
      summary: {
        totalZones: mapZones.length,
        zonesWithCoordinates: mapZones.filter((z) => z.coordinates).length,
        totalCameras: devices.length,
        camerasOnline: mapZones.reduce((s, z) => s + z.cameraStatus.online, 0),
        alertsInWindow: mapZones.reduce((s, z) => s + z.alerts.total, 0),
        openAlertsInWindow: mapZones.reduce((s, z) => s + z.alerts.open, 0),
        unlocatedAlertsInWindow: unlocated ? Number(unlocated.total) : 0,
      },
      zones: mapZones,
    };
  }

  private severityFromRank(rank: number | null): string | null {
    if (rank == null) return null;
    const found = Object.entries(SEVERITY_RANK).find(
      ([, r]) => r === Number(rank),
    );
    return found ? found[0] : null;
  }
}
