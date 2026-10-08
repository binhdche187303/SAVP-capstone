import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  VehicleTrafficStatsQueryDto,
  TrafficStatsGroupBy,
} from '../dto/vehicle-traffic-stats-query.dto.js';
import { VehicleTrafficStatsResponseDto } from '../dto/vehicle-traffic-stats-response.dto.js';
import { VehicleTrafficStatsSummaryDto } from '../dto/vehicle-traffic-stats-summary.dto.js';
import { VehicleTrafficStatsBucketDto } from '../dto/vehicle-traffic-stats-bucket.dto.js';

const VEHICLE_EVENT_TYPES = ['ivss_vehicle_event', 'camera_vehicle_event'];

interface SummaryRow {
  total: number;
  matched: number;
  unmatched: number;
  enter_count: number;
  leave_count: number;
  seen_count: number;
  unique_vehicles: number;
}

interface SeriesRow {
  bucket: string;
  direction: string | null;
  cnt: number;
}

/**
 * VehicleTrafficStatsService (VTS-001 / UC-114) — thống kê lưu lượng phương tiện.
 *
 * Nguồn: `iot_device_events` với event ANPR (`ivss_vehicle_event` legacy bridge +
 * `camera_vehicle_event` camera ảo/camera thật độc lập), KHÔNG PHẢI `gate_access_logs`. Raw SQL qua
 * `DataSource` mirror CHÍNH XÁC `VehicleHistoryService` (cùng bảng, cùng event_type) — KHÔNG
 * `@InjectRepository` (enum entity `IoTDeviceEventType` không có giá trị này).
 *
 * DATA-02 (crux): `event_type IN (...)` LUÔN là điều kiện WHERE đầu tiên.
 * Vocabulary `direction` payload THẬT: `enter/leave/seen` (KHÔNG PHẢI `in/out`).
 */
@Injectable()
export class VehicleTrafficStatsService {
  constructor(private readonly dataSource: DataSource) {}

  async getStats(
    query: VehicleTrafficStatsQueryDto,
  ): Promise<VehicleTrafficStatsResponseDto> {
    if (new Date(query.from).getTime() > new Date(query.to).getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'Khoảng thời gian không hợp lệ',
      });
    }

    const { where, params } = this.buildWhere(query);
    const groupBy: TrafficStatsGroupBy = query.groupBy ?? 'day';

    const summaryRows: SummaryRow[] = await this.dataSource.manager.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE payload_json->>'matchState' = 'matched')::int AS matched,
         COUNT(*) FILTER (WHERE payload_json->>'matchState' = 'unmatched')::int AS unmatched,
         COUNT(*) FILTER (WHERE payload_json->>'direction' = 'enter')::int AS enter_count,
         COUNT(*) FILTER (WHERE payload_json->>'direction' = 'leave')::int AS leave_count,
         COUNT(*) FILTER (WHERE payload_json->>'direction' = 'seen')::int AS seen_count,
         COUNT(DISTINCT payload_json->>'plateNumber')::int AS unique_vehicles
       FROM iot_device_events WHERE ${where}`,
      params,
    );

    const seriesRows: SeriesRow[] = await this.dataSource.manager.query(
      `SELECT ${this.bucketExpr(groupBy)} AS bucket, payload_json->>'direction' AS direction, COUNT(*)::int AS cnt
         FROM iot_device_events WHERE ${where}
        GROUP BY bucket, direction ORDER BY bucket ASC`,
      params,
    );

    return {
      summary: this.toSummaryDto(summaryRows[0]),
      series: this.pivotSeries(seriesRows),
    };
  }

  /** Filter động: `event_type` LUÔN đầu tiên, bind tham số nối tiếp (SEC-03). */
  private buildWhere(query: VehicleTrafficStatsQueryDto): {
    where: string;
    params: unknown[];
  } {
    const params: unknown[] = [...VEHICLE_EVENT_TYPES];
    let where = `event_type IN (${VEHICLE_EVENT_TYPES.map(
      (_, idx) => `$${idx + 1}`,
    ).join(', ')})`;

    params.push(query.from);
    where += ` AND event_time >= $${params.length}`;
    params.push(query.to);
    where += ` AND event_time <= $${params.length}`;

    if (query.zoneId) {
      params.push(query.zoneId);
      where += ` AND zone_id = $${params.length}`;
    }
    if (query.vehicleType) {
      params.push(query.vehicleType);
      where += ` AND payload_json->>'vehicleType' = $${params.length}`;
    }

    return { where, params };
  }

  /** CHỈ 2 nhánh cố định — KHÔNG nội suy giá trị query param vào biểu thức SQL (SEC-03). */
  private bucketExpr(groupBy: TrafficStatsGroupBy): string {
    return groupBy === 'hour'
      ? "to_char(event_time, 'YYYY-MM-DD HH24:00')"
      : "to_char(event_time, 'YYYY-MM-DD')";
  }

  private toSummaryDto(row?: SummaryRow): VehicleTrafficStatsSummaryDto {
    return {
      total_events: row?.total ?? 0,
      total_matched: row?.matched ?? 0,
      total_unmatched: row?.unmatched ?? 0,
      total_enter: row?.enter_count ?? 0,
      total_leave: row?.leave_count ?? 0,
      total_seen: row?.seen_count ?? 0,
      unique_vehicles: row?.unique_vehicles ?? 0,
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
