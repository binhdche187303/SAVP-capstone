import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  VehicleTrafficStatsQueryDto,
  TrafficStatsGroupBy,
} from '../dto/vehicle-traffic-stats-query.dto.js';
import { VehicleTrafficStatsResponseDto } from '../dto/vehicle-traffic-stats-response.dto.js';
import { VehicleTrafficStatsSummaryDto } from '../dto/vehicle-traffic-stats-summary.dto.js';
import { VehicleTrafficStatsBucketDto } from '../dto/vehicle-traffic-stats-bucket.dto.js';
import { KpiReadWindowService } from '../../kpi-rollup/services/kpi-read-window.service.js';
import { BUSINESS_TZ } from '../../kpi-rollup/kpi-rollup.constants.js';
import {
  rangeClause,
  SqlParams,
} from '../../kpi-rollup/utils/sql-params.util.js';
import type { ReadWindow } from '../../kpi-rollup/utils/kpi-window.types.js';

const VEHICLE_EVENT_TYPE = 'ivss_vehicle_event';

interface SummaryRow {
  total: number;
  matched: number;
  unmatched: number;
  enter_count: number;
  leave_count: number;
  seen_count: number;
  unique_vehicles?: number;
}

interface SeriesRow {
  bucket: string;
  direction: string | null;
  cnt: number;
}

/** Biểu thức cột theo nguồn — hằng trong code (SEC-03). */
interface SourceCols {
  zone: string;
  vehicleType: string;
  direction: string;
  matchState: string;
  plate: string;
  ts: string;
}
const AGG_COLS: SourceCols = {
  zone: 'zone_id',
  vehicleType: 'vehicle_type',
  direction: 'direction',
  matchState: 'match_state',
  plate: 'plate_number',
  ts: 'bucket_hour',
};
const RAW_COLS: SourceCols = {
  zone: 'zone_id',
  vehicleType: "payload_json->>'vehicleType'",
  direction: "payload_json->>'direction'",
  matchState: "payload_json->>'matchState'",
  plate: "payload_json->>'plateNumber'",
  ts: 'event_time',
};

/**
 * VehicleTrafficStatsService (VTS-001 / UC-114) — thống kê lưu lượng phương tiện.
 *
 * Nguồn: `iot_device_events WHERE event_type='ivss_vehicle_event'` — ĐÚNG PRE-2 SRS trích
 * dẫn "UC-ANPR-05" (sự kiện biển số thô), KHÔNG PHẢI `gate_access_logs`.
 * KPI-001: giờ tròn đã rollup đọc `kpi_vehicle_hourly` / `kpi_vehicle_plate_hourly`, mép +
 * phần chưa rollup đọc raw; bucket series theo giờ VN (trước đây theo UTC của session DB).
 *
 * DATA-02 (crux): phần raw luôn có `event_type = 'ivss_vehicle_event'` là điều kiện WHERE đầu tiên.
 * Vocabulary `direction` payload THẬT: `enter/leave/seen` (KHÔNG PHẢI `in/out`).
 */
@Injectable()
export class VehicleTrafficStatsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly kpiReadWindow: KpiReadWindowService,
  ) {}

  async getStats(
    query: VehicleTrafficStatsQueryDto,
  ): Promise<VehicleTrafficStatsResponseDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'Khoảng thời gian không hợp lệ',
      });
    }

    const window = await this.kpiReadWindow.resolve('vehicle_hourly', from, to);
    const groupBy: TrafficStatsGroupBy = query.groupBy ?? 'day';

    const summaryRows: SummaryRow[] = await this.runUnion(
      query,
      window,
      (cols, w) =>
        `SELECT ${cols.direction} AS direction, ${cols.matchState} AS match_state, ${
          cols === AGG_COLS ? 'event_count' : 'COUNT(*)'
        } AS cnt ${w}${cols === RAW_COLS ? ' GROUP BY 1, 2' : ''}`,
      (u) => `SELECT
         COALESCE(SUM(cnt), 0)::int AS total,
         COALESCE(SUM(cnt) FILTER (WHERE match_state = 'matched'), 0)::int AS matched,
         COALESCE(SUM(cnt) FILTER (WHERE match_state = 'unmatched'), 0)::int AS unmatched,
         COALESCE(SUM(cnt) FILTER (WHERE direction = 'enter'), 0)::int AS enter_count,
         COALESCE(SUM(cnt) FILTER (WHERE direction = 'leave'), 0)::int AS leave_count,
         COALESCE(SUM(cnt) FILTER (WHERE direction = 'seen'), 0)::int AS seen_count
       FROM (${u}) t`,
      'kpi_vehicle_hourly',
    );

    const uniqueRows: Array<{ unique_vehicles: number }> = await this.runUnion(
      query,
      window,
      (cols, w) => `SELECT ${cols.plate} AS plate ${w}`,
      (u) =>
        `SELECT COUNT(DISTINCT plate)::int AS unique_vehicles FROM (${u}) t`,
      'kpi_vehicle_plate_hourly',
    );

    const seriesRows: SeriesRow[] = await this.runUnion(
      query,
      window,
      (cols, w) =>
        `SELECT ${this.bucketExpr(groupBy, cols.ts)} AS bucket, ${cols.direction} AS direction, ${
          cols === AGG_COLS ? 'event_count' : 'COUNT(*)'
        } AS cnt ${w}${cols === RAW_COLS ? ' GROUP BY 1, 2' : ''}`,
      (u) => `SELECT bucket, direction, SUM(cnt)::int AS cnt FROM (${u}) t
              GROUP BY bucket, direction ORDER BY bucket ASC`,
      'kpi_vehicle_hourly',
    );

    return {
      summary: this.toSummaryDto(
        summaryRows[0],
        uniqueRows[0]?.unique_vehicles,
      ),
      series: this.pivotSeries(seriesRows),
    };
  }

  /**
   * Ghép `UNION ALL` giữa phần aggregate (nếu có) và phần raw. `select(cols, fromWhere)` dựng
   * SELECT của 1 nguồn; `wrap(union)` dựng query ngoài.
   */
  private runUnion<T>(
    query: VehicleTrafficStatsQueryDto,
    window: ReadWindow,
    select: (cols: SourceCols, fromWhere: string) => string,
    wrap: (union: string) => string,
    aggTable: 'kpi_vehicle_hourly' | 'kpi_vehicle_plate_hourly',
  ): Promise<T[]> {
    const p = new SqlParams();
    const parts: string[] = [];
    if (window.agg) {
      const where =
        `FROM ${aggTable} WHERE bucket_hour >= ${p.add(window.agg.from)}` +
        ` AND bucket_hour < ${p.add(window.agg.to)}` +
        this.filterSql(query, p, AGG_COLS);
      parts.push(select(AGG_COLS, where));
    }
    const rawWhere =
      `FROM iot_device_events WHERE event_type = '${VEHICLE_EVENT_TYPE}'` +
      ` AND ${rangeClause('event_time', window.raw, p)}` +
      this.filterSql(query, p, RAW_COLS);
    parts.push(select(RAW_COLS, rawWhere));
    return this.dataSource.manager.query(
      wrap(parts.join('\n UNION ALL \n')),
      p.values,
    );
  }

  /** Filter động, bind tham số nối tiếp (SEC-03). */
  private filterSql(
    query: VehicleTrafficStatsQueryDto,
    p: SqlParams,
    cols: SourceCols,
  ): string {
    let sql = '';
    if (query.zoneId) sql += ` AND ${cols.zone} = ${p.add(query.zoneId)}`;
    if (query.vehicleType)
      sql += ` AND ${cols.vehicleType} = ${p.add(query.vehicleType)}`;
    return sql;
  }

  /** CHỈ 2 nhánh cố định — KHÔNG nội suy giá trị query param vào biểu thức SQL (SEC-03). */
  private bucketExpr(groupBy: TrafficStatsGroupBy, tsColumn: string): string {
    const fmt = groupBy === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD';
    return `to_char(${tsColumn} AT TIME ZONE '${BUSINESS_TZ}', '${fmt}')`;
  }

  private toSummaryDto(
    row?: SummaryRow,
    uniqueVehicles?: number,
  ): VehicleTrafficStatsSummaryDto {
    return {
      total_events: row?.total ?? 0,
      total_matched: row?.matched ?? 0,
      total_unmatched: row?.unmatched ?? 0,
      total_enter: row?.enter_count ?? 0,
      total_leave: row?.leave_count ?? 0,
      total_seen: row?.seen_count ?? 0,
      unique_vehicles: uniqueVehicles ?? 0,
    };
  }

  /** Gộp `enter/leave/seen` theo bucket. Thiếu hướng nào = 0 (KHÔNG undefined). */
  private pivotSeries(rows: SeriesRow[]): VehicleTrafficStatsBucketDto[] {
    const map = new Map<string, VehicleTrafficStatsBucketDto>();
    for (const row of rows) {
      let entry = map.get(row.bucket);
      if (!entry) {
        entry = { bucket: row.bucket, enter: 0, leave: 0, seen: 0 };
        map.set(row.bucket, entry);
      }
      if (row.direction === 'enter') entry.enter = row.cnt;
      else if (row.direction === 'leave') entry.leave = row.cnt;
      else if (row.direction === 'seen') entry.seen = row.cnt;
    }
    return Array.from(map.values());
  }
}
