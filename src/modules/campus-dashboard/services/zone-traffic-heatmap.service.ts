import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { KpiReadWindowService } from '../../kpi-rollup/services/kpi-read-window.service.js';
import {
  rangeClause,
  SqlParams,
} from '../../kpi-rollup/utils/sql-params.util.js';
import type { ReadWindow } from '../../kpi-rollup/utils/kpi-window.types.js';
import {
  mergeZoneHeatmapParts,
  type ZoneHeatmapPart,
} from '../utils/merge-zone-heatmap.util.js';
import type {
  TrafficResponseDto,
  TrafficSeriesPointDto,
  ZoneHeatmapDto,
} from '../dto/zone-traffic-response.dto.js';

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000; // 31 ngày (mirror ZonePresenceTimelineService)

interface SeriesRow {
  zone_id: string;
  hour_bucket: string | Date;
  occupancy_sum: string | number;
  sample_count: string | number;
  peak_occupancy: string | number | null;
}

interface HeatmapPartRow {
  zone_id: string;
  event_count: string | number;
  occupancy_sum: string | number | null;
  sample_count: string | number;
  peak_occupancy: string | number | null;
  peak_at: string | Date | null;
}

/**
 * ZoneTrafficHeatmapService (ZTH-001 / UC-120) — lưu lượng theo giờ (series) + mật độ tương
 * đối theo zone (heatmap). 100% READ-ONLY, đọc lai aggregate + raw (KPI-001): giờ tròn đã
 * rollup đọc `kpi_zone_hourly`, mép + phần chưa rollup đọc raw `zone_presence_events`
 * (tận dụng `IDX_zpe_count`, spec §2.7), rồi gộp.
 */
@Injectable()
export class ZoneTrafficHeatmapService {
  constructor(
    private readonly repo: CampusDashboardRepository,
    private readonly dataSource: DataSource,
    private readonly kpiReadWindow: KpiReadWindowService,
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

    const window = await this.kpiReadWindow.resolve('zone_hourly', from, to);
    const [seriesRows, heatmapRows] = await Promise.all([
      this.querySeries(zoneIds, window),
      this.queryHeatmapParts(zoneIds, window),
    ]);

    const zoneById = new Map(zones.map((z) => [z.id, z]));
    const series: TrafficSeriesPointDto[] = seriesRows.map((row) => {
      const samples = Number(row.sample_count);
      return {
        zoneId: row.zone_id,
        hourBucket: new Date(row.hour_bucket).toISOString(),
        avgOccupancy: samples > 0 ? Number(row.occupancy_sum) / samples : 0,
        peakOccupancy: Number(row.peak_occupancy),
      };
    });

    const merged = mergeZoneHeatmapParts(
      heatmapRows.map((r) => this.toPart(r)),
    );
    const maxPeak = Math.max(0, ...merged.map((r) => r.peakOccupancy ?? 0));

    const heatmap: ZoneHeatmapDto[] = merged.map((row) => {
      const zone = zoneById.get(row.zoneId);
      const peakOccupancy = row.peakOccupancy ?? 0;
      return {
        zoneId: row.zoneId,
        zoneName: zone?.zoneName ?? '',
        building: zone?.building ?? null,
        floor: zone?.floor ?? null,
        avgOccupancy: row.avgOccupancy ?? 0,
        peakOccupancy,
        peakAt: row.peakAt ? row.peakAt.toISOString() : null,
        relativeDensity: maxPeak === 0 ? 0 : peakOccupancy / maxPeak,
        coordinates: null, // BLOCKED — kế thừa UC-126 §2.1
      };
    });

    return { series, heatmap };
  }

  private toPart(r: HeatmapPartRow): ZoneHeatmapPart {
    return {
      zoneId: r.zone_id,
      eventCount: Number(r.event_count),
      occupancySum: Number(r.occupancy_sum ?? 0),
      sampleCount: Number(r.sample_count),
      peakOccupancy:
        r.peak_occupancy === null ? null : Number(r.peak_occupancy),
      peakAt: r.peak_at ? new Date(r.peak_at) : null,
    };
  }

  /** Mỗi (zone, giờ) đến từ đúng 1 nguồn (§5.1) ⇒ chỉ cần nối, không gộp. */
  private async querySeries(
    zoneIds: string[],
    window: ReadWindow,
  ): Promise<SeriesRow[]> {
    const p = new SqlParams();
    const zones = p.add(zoneIds);
    const parts: string[] = [];
    if (window.agg) {
      parts.push(`
        SELECT zone_id, bucket_hour AS hour_bucket, occupancy_sum, sample_count,
               occupancy_peak AS peak_occupancy
        FROM kpi_zone_hourly
        WHERE zone_id = ANY(${zones}::uuid[])
          AND bucket_hour >= ${p.add(window.agg.from)} AND bucket_hour < ${p.add(window.agg.to)}`);
    }
    parts.push(`
        SELECT zone_id, date_trunc('hour', event_time, 'UTC') AS hour_bucket,
               COALESCE(SUM(occupancy_count), 0) AS occupancy_sum,
               COUNT(occupancy_count) AS sample_count,
               MAX(occupancy_count) AS peak_occupancy
        FROM zone_presence_events
        WHERE zone_id = ANY(${zones}::uuid[])
          AND event_type = 'count'
          AND ${rangeClause('event_time', window.raw, p)}
        GROUP BY zone_id, hour_bucket`);
    const sql = `
      SELECT zone_id, hour_bucket, occupancy_sum, sample_count, peak_occupancy
      FROM (${parts.join('\n UNION ALL \n')}) t
      ORDER BY hour_bucket ASC, zone_id ASC`;
    return this.dataSource.query(sql, p.values);
  }

  /** Mỗi phần trả 1 dòng/zone: tổng cộng dồn + event thắng đỉnh của phần đó. */
  private async queryHeatmapParts(
    zoneIds: string[],
    window: ReadWindow,
  ): Promise<HeatmapPartRow[]> {
    const queries: Array<Promise<HeatmapPartRow[]>> = [];
    if (window.agg) {
      queries.push(
        this.dataSource.query(
          `SELECT DISTINCT ON (zone_id) zone_id,
                  SUM(event_count) OVER w AS event_count,
                  SUM(occupancy_sum) OVER w AS occupancy_sum,
                  SUM(sample_count) OVER w AS sample_count,
                  occupancy_peak AS peak_occupancy,
                  peak_at
           FROM kpi_zone_hourly
           WHERE zone_id = ANY($1::uuid[]) AND bucket_hour >= $2 AND bucket_hour < $3
           WINDOW w AS (PARTITION BY zone_id)
           ORDER BY zone_id, occupancy_peak DESC NULLS LAST, peak_at DESC`,
          [zoneIds, window.agg.from, window.agg.to],
        ),
      );
    }
    const p = new SqlParams();
    const zones = p.add(zoneIds);
    queries.push(
      this.dataSource.query(
        `SELECT DISTINCT ON (zone_id) zone_id,
                COUNT(*) OVER w AS event_count,
                SUM(occupancy_count) OVER w AS occupancy_sum,
                COUNT(occupancy_count) OVER w AS sample_count,
                occupancy_count AS peak_occupancy,
                event_time AS peak_at
         FROM zone_presence_events
         WHERE zone_id = ANY(${zones}::uuid[])
           AND event_type = 'count'
           AND ${rangeClause('event_time', window.raw, p)}
         WINDOW w AS (PARTITION BY zone_id)
         ORDER BY zone_id, occupancy_count DESC NULLS LAST, event_time DESC`,
        p.values,
      ),
    );
    return (await Promise.all(queries)).flat();
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
