import { Injectable } from '@nestjs/common';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { resolveOccupancyStatus } from '../utils/resolve-occupancy-status.util.js';
import { resolveCameraStatus } from '../utils/resolve-camera-status.util.js';
import { toZoneCoordinates } from '../utils/to-zone-coordinates.util.js';
import type { QueryDashboardOverviewDto } from '../dto/query-dashboard-overview.dto.js';
import type {
  BuildingOverviewDto,
  DashboardOverviewResponseDto,
  FloorOverviewDto,
  ZoneOverviewDto,
} from '../dto/dashboard-overview-response.dto.js';
import type { ZoneEntity } from '../../zones/entities/zone.entity.js';
import type { IoTDeviceEntity } from '../../iot/entities/iot-device.entity.js';

/** startOfDay theo server local timezone (mirror pattern UC-126 §2.4). */
function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * DashboardOverviewService (CDB-001 / UC-126) — tổng hợp JSON phân cấp Tòa→Tầng→Zone.
 * Module 100% READ-ONLY (DATA-01) — không INSERT/UPDATE/DELETE bảng nào.
 */
@Injectable()
export class DashboardOverviewService {
  constructor(private readonly repo: CampusDashboardRepository) {}

  async getOverview(
    query: QueryDashboardOverviewDto,
  ): Promise<DashboardOverviewResponseDto> {
    const now = new Date();
    const zones = await this.repo.loadZoneHierarchy({
      building: query.building,
      floor: query.floor,
    });

    if (zones.length === 0) {
      return { generatedAt: now.toISOString(), buildings: [] };
    }

    const stalenessMinutes = await this.repo.loadStalenessMinutes();
    const devices = await this.repo.loadDevicesByZone(zones.map((z) => z.id));
    const todayStart = startOfDay(now);

    const zoneOverviews: ZoneOverviewDto[] = [];
    for (const zone of zones) {
      zoneOverviews.push(
        await this.buildZoneOverview(
          zone,
          devices,
          stalenessMinutes,
          now,
          todayStart,
        ),
      );
    }

    return {
      generatedAt: now.toISOString(),
      buildings: this.groupByBuildingFloor(zones, zoneOverviews),
    };
  }

  private async buildZoneOverview(
    zone: ZoneEntity,
    allDevices: IoTDeviceEntity[],
    stalenessMinutes: number,
    now: Date,
    todayStart: Date,
  ): Promise<ZoneOverviewDto> {
    const devicesInZone = allDevices.filter((d) => d.zoneId === zone.id);
    const latestEvent = await this.repo.loadLatestCountEvent(zone.id);
    const occupancy = resolveOccupancyStatus(
      devicesInZone,
      latestEvent,
      stalenessMinutes,
      now,
    );
    const cameraStatus = resolveCameraStatus(devicesInZone);
    const [entriesToday, exitsToday] = await Promise.all([
      this.repo.countGateLogsToday(zone.id, 'enter', todayStart),
      this.repo.countGateLogsToday(zone.id, 'leave', todayStart),
    ]);

    return {
      zoneId: zone.id,
      zoneCode: zone.zoneCode,
      zoneName: zone.zoneName,
      zoneType: zone.zoneType,
      coordinates: toZoneCoordinates(zone),
      occupancy,
      gateTraffic: { entriesToday, exitsToday },
      cameraStatus,
    };
  }

  private groupByBuildingFloor(
    zones: ZoneEntity[],
    overviews: ZoneOverviewDto[],
  ): BuildingOverviewDto[] {
    const overviewByZoneId = new Map(overviews.map((o) => [o.zoneId, o]));
    const buildingMap = new Map<
      string | null,
      Map<string | null, ZoneOverviewDto[]>
    >();

    for (const zone of zones) {
      const overview = overviewByZoneId.get(zone.id);
      if (!overview) continue;

      if (!buildingMap.has(zone.building)) {
        buildingMap.set(zone.building, new Map());
      }
      const floorMap = buildingMap.get(zone.building)!;
      if (!floorMap.has(zone.floor)) {
        floorMap.set(zone.floor, []);
      }
      floorMap.get(zone.floor)!.push(overview);
    }

    const buildings: BuildingOverviewDto[] = [];
    for (const [building, floorMap] of buildingMap) {
      const floors: FloorOverviewDto[] = [];
      for (const [floor, zoneList] of floorMap) {
        floors.push({ floor, zones: zoneList });
      }
      buildings.push({ building, floors });
    }
    return buildings;
  }
}
