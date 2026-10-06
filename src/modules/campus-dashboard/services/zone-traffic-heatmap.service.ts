import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { toZoneCoordinates } from '../utils/to-zone-coordinates.util.js';
import type {
  TrafficResponseDto,
  TrafficSeriesPointDto,
  ZoneHeatmapDto,
} from '../dto/zone-traffic-response.dto.js';

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000; // 31 ngày (mirror ZonePresenceTimelineService)

interface SeriesRow {
  zone_id: string;
  hour_bucket: string;
  avg_occupancy: string;
  peak_occupancy: string;
}

interface HeatmapRow {
  zone_id: string;
  avg_occupancy: string;
  peak_occupancy: string;
  peak_at: string | null;
}

/**
 * ZoneTrafficHeatmapService (ZTH-001 / UC-120) — lưu lượng theo giờ (series) + mật độ tương
 * đối theo zone (heatmap). 100% READ-ONLY, tận dụng `IDX_zpe_count` (spec §2.7).
 */
@Injectable()
export class ZoneTrafficHeatmapService {
  constructor(
    private readonly repo: CampusDashboardRepository,
    private readonly dataSource: DataSource,
  ) {}

  async getTraffic(
    from: Date,
    to: Date,
    building?: string,
    floor?: string,
  ): Promise<TrafficResponseDto> {
    this.validateRange(from, to);

    const zones = await this.repo.loadZoneHierarchy({ building, floor });
    const zoneIds = zones.map((z) => z.id);
    if (zoneIds.length === 0) {
      return { series: [], heatmap: [] };
    }

    const [seriesRows, heatmapRows] = await Promise.all([
      this.querySeries(zoneIds, from, to),
      this.queryHeatmapAggregate(zoneIds, from, to),
    ]);

    const zoneById = new Map(zones.map((z) => [z.id, z]));
    const series: TrafficSeriesPointDto[] = seriesRows.map((row) => ({
      zoneId: row.zone_id,
      hourBucket: new Date(row.hour_bucket).toISOString(),
      avgOccupancy: Number(row.avg_occupancy),
      peakOccupancy: Number(row.peak_occupancy),
    }));

    const maxPeak = Math.max(
      0,
      ...heatmapRows.map((r) => Number(r.peak_occupancy) || 0),
    );

    const heatmap: ZoneHeatmapDto[] = heatmapRows.map((row) => {
      const zone = zoneById.get(row.zone_id);
      const peakOccupancy = Number(row.peak_occupancy) || 0;
      return {
        zoneId: row.zone_id,
        zoneName: zone?.zoneName ?? '',
        building: zone?.building ?? null,
        floor: zone?.floor ?? null,
        avgOccupancy: Number(row.avg_occupancy) || 0,
        peakOccupancy,
        peakAt: row.peak_at ? new Date(row.peak_at).toISOString() : null,
        relativeDensity: maxPeak === 0 ? 0 : peakOccupancy / maxPeak,
        coordinates: toZoneCoordinates(zone),
      };
    });

    return { series, heatmap };
  }

  private async querySeries(
    zoneIds: string[],
    from: Date,
    to: Date,
  ): Promise<SeriesRow[]> {
    const sql = `
      SELECT
        zone_id,
        date_trunc('hour', event_time) AS hour_bucket,
        AVG(occupancy_count) AS avg_occupancy,
        MAX(occupancy_count) AS peak_occupancy
      FROM zone_presence_events
      WHERE zone_id = ANY($1::uuid[])
        AND event_type = 'count'
        AND event_time BETWEEN $2 AND $3
      GROUP BY zone_id, hour_bucket
      ORDER BY hour_bucket ASC
    `;
    return this.dataSource.query(sql, [zoneIds, from, to]);
  }

  private async queryHeatmapAggregate(
    zoneIds: string[],
    from: Date,
    to: Date,
  ): Promise<HeatmapRow[]> {
    const sql = `
      SELECT
        zone_id,
        AVG(occupancy_count) AS avg_occupancy,
        MAX(occupancy_count) AS peak_occupancy,
        (
          SELECT event_time
          FROM zone_presence_events e2
          WHERE e2.zone_id = e1.zone_id
            AND e2.event_type = 'count'
            AND e2.event_time BETWEEN $2 AND $3
          ORDER BY e2.occupancy_count DESC NULLS LAST, e2.event_time DESC
          LIMIT 1
        ) AS peak_at
      FROM zone_presence_events e1
      WHERE zone_id = ANY($1::uuid[])
        AND event_type = 'count'
        AND event_time BETWEEN $2 AND $3
      GROUP BY zone_id
    `;
    return this.dataSource.query(sql, [zoneIds, from, to]);
  }

  private validateRange(from: Date, to: Date): void {
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException({
        code: 'INVALID_TRAFFIC_RANGE',
        message: 'Khoảng thời gian tối đa 31 ngày',
      });
    }
  }
}
