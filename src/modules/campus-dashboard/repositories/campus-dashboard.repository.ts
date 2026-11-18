import { filterWhere, type FilterSelection } from '../../../common/utils/filter-selection.js';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { GateAccessLogEntity } from '../../zones/entities/gate-access-log.entity.js';
import type { GateDirection } from '../../zones/constants/gate-direction.constant.js';
import { IoTDeviceEntity } from '../../iot/entities/iot-device.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

const STALENESS_CONFIG_GROUP = 'campus_dashboard';
const STALENESS_CONFIG_KEY = 'campus_dashboard.occupancy_staleness_minutes';
const DEFAULT_STALENESS_MINUTES = 15;

export interface ZoneHierarchyFilter {
  building?: FilterSelection<string>;
  floor?: FilterSelection<string>;
}

/**
 * CampusDashboardRepository (CDB-001 / UC-126) — helper query DÙNG CHUNG cho UC-126/119/120.
 *
 * Module `campus-dashboard` tự `forFeature` lại entity của `zones`/`iot` (KHÔNG import
 * `ZonesModule`/`IotModule` — mirror lý do đã dùng ở `restricted-zone`/`crowd-alert`: tránh
 * kéo theo provider/controller không cần, tránh rủi ro vòng phụ thuộc).
 */
@Injectable()
export class CampusDashboardRepository {
  constructor(
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    @InjectRepository(ZonePresenceEventEntity)
    private readonly presenceRepo: Repository<ZonePresenceEventEntity>,
    @InjectRepository(GateAccessLogEntity)
    private readonly gateLogRepo: Repository<GateAccessLogEntity>,
    @InjectRepository(IoTDeviceEntity)
    private readonly deviceRepo: Repository<IoTDeviceEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async loadZoneHierarchy(filter: ZoneHierarchyFilter): Promise<ZoneEntity[]> {
    const where: Record<string, unknown> = { deletedAt: IsNull() };
    if (filter.building) where.building = filterWhere(filter.building);
    if (filter.floor) where.floor = filterWhere(filter.floor);

    return this.zoneRepo.find({
      where,
      order: { building: 'ASC', floor: 'ASC', zoneName: 'ASC' },
    });
  }

  /** Tận dụng `IDX_zpe_count` (zone_id, event_time DESC WHERE event_type='count'). */
  async loadLatestCountEvent(
    zoneId: string,
  ): Promise<ZonePresenceEventEntity | null> {
    const rows = await this.presenceRepo.find({
      where: { zoneId, eventType: 'count' },
      order: { eventTime: 'DESC' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  async loadDevicesByZone(zoneIds: string[]): Promise<IoTDeviceEntity[]> {
    if (zoneIds.length === 0) return [];
    return this.deviceRepo.find({ where: { zoneId: In(zoneIds) } });
  }

  async countGateLogsToday(
    zoneId: string,
    direction: GateDirection,
    startOfDay: Date,
  ): Promise<number> {
    return this.gateLogRepo.count({
      where: { zoneId, direction, accessTime: MoreThanOrEqual(startOfDay) },
    });
  }

  /** Fallback code-side nếu chưa có dòng cấu hình — KHÔNG tự seed dòng mặc định (mirror UC-116). */
  async loadStalenessMinutes(): Promise<number> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const existing = await repo.findOne({
      where: {
        configGroup: STALENESS_CONFIG_GROUP,
        configKey: STALENESS_CONFIG_KEY,
      },
    });
    if (existing?.configValue) {
      const parsed = Number(existing.configValue);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
    return DEFAULT_STALENESS_MINUTES;
  }

  /**
   * CDB-RS-001 — occupancy mới nhất (event `count`) của MỌI zone active, dùng cho
   * `business-admin-summary.zoneOccupancy` (tổng hợp toàn trường, khác `loadLatestCountEvent`
   * vốn per-zone của UC-126). Trả kèm devices trong zone để gọi `resolveOccupancyStatus`.
   */
  async loadAllZonesWithLatestOccupancy(): Promise<
    Array<{
      zone: ZoneEntity;
      latestEvent: ZonePresenceEventEntity | null;
      devicesInZone: IoTDeviceEntity[];
    }>
  > {
    const zones = await this.zoneRepo.find({ where: { deletedAt: IsNull() } });
    if (zones.length === 0) return [];

    const devices = await this.loadDevicesByZone(zones.map((z) => z.id));
    const result: Array<{
      zone: ZoneEntity;
      latestEvent: ZonePresenceEventEntity | null;
      devicesInZone: IoTDeviceEntity[];
    }> = [];
    for (const zone of zones) {
      const latestEvent = await this.loadLatestCountEvent(zone.id);
      result.push({
        zone,
        latestEvent,
        devicesInZone: devices.filter((d) => d.zoneId === zone.id),
      });
    }
    return result;
  }

  /**
   * CDB-RS-001 — biến thể KHÔNG filter `zoneId` của `countGateLogsToday`, dùng cho
   * `business-admin-summary.gateTrafficToday` (tổng toàn tổ chức, không theo từng zone).
   */
  async countGateLogsAllZonesToday(
    direction: GateDirection,
    startOfDay: Date,
  ): Promise<number> {
    return this.gateLogRepo.count({
      where: { direction, accessTime: MoreThanOrEqual(startOfDay) },
    });
  }
}
