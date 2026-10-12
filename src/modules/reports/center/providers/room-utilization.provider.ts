import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { REPORT_DEFINITIONS } from '../report-definition.registry.js';
import { describeFilters } from '../report-filter-lines.js';
import type { ReportFilters, ReportModel, ReportPage, ReportProvider, ResolvedScope } from '../report-model.js';
import { pageRows, pct, round1, vnDayKey, vnDayLabel } from './report-provider.util.js';

const TZ = `'Asia/Ho_Chi_Minh'`;
// Cùng công thức và trạng thái với RoomUtilizationReportDataService (không sửa service đó): đặt = thời lượng đặt,
// thực dùng = actual_start..actual_end, nếu thiếu thì first_presence..last_presence.
const ACTUAL_HOURS = `CASE
    WHEN rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL THEN EXTRACT(EPOCH FROM (rbu.actual_end_time - rbu.actual_start_time)) / 3600
    WHEN rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL THEN EXTRACT(EPOCH FROM (rbu.last_presence_at - rbu.first_presence_at)) / 3600
    ELSE 0 END`;

interface Row { room_id: string; room_name: string; building: string | null; capacity: number; day: Date; booked: string; used: string; meetings: string; no_show: string }

/** Sử dụng phòng họp (2.13): theo phòng và theo ngày VN; lọc `building` (rooms.site_name) và `roomId`. */
@Injectable()
export class RoomUtilizationReportProvider implements ReportProvider {
  readonly type = 'room-utilization' as const;

  constructor(private readonly dataSource: DataSource) {}

  async build(filters: ReportFilters, _scope: ResolvedScope, page: ReportPage | null, _now: Date): Promise<ReportModel> {
    const def = REPORT_DEFINITIONS['room-utilization'];
    const params: unknown[] = [filters.from, filters.to];
    let roomClause = '';
    if (filters['roomId']) { params.push(filters['roomId']); roomClause += ` AND r.id = $${params.length}::uuid`; }
    if (filters['building']) { params.push(filters['building']); roomClause += ` AND r.site_name = $${params.length}`; }

    const rows: Row[] = await this.dataSource.query(
      `SELECT r.id AS room_id, r.room_name, r.site_name AS building, r.capacity,
              (rb.reserved_start_time AT TIME ZONE ${TZ})::date::timestamp AT TIME ZONE ${TZ} AS day,
              COALESCE(SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 3600), 0)::text AS booked,
              COALESCE(SUM(${ACTUAL_HOURS}), 0)::text AS used,
              COUNT(DISTINCT rb.id)::text AS meetings,
              COUNT(DISTINCT rb.id) FILTER (WHERE EXISTS (SELECT 1 FROM no_show_cases nsc WHERE nsc.booking_id = rb.id AND nsc.detection_status IN ('confirmed','released')))::text AS no_show
         FROM room_bookings rb
         JOIN rooms r ON r.id = rb.room_id AND r.deleted_at IS NULL
         LEFT JOIN room_booking_usages rbu ON rbu.booking_id = rb.id
        WHERE rb.status IN ('approved','active','completed','released')
          AND rb.reserved_start_time >= ($1::date)::timestamp AT TIME ZONE ${TZ}
          AND rb.reserved_start_time < (($2::date) + 1)::timestamp AT TIME ZONE ${TZ}
          ${roomClause}
        GROUP BY r.id, r.room_name, r.site_name, r.capacity, 5`,
      params,
    );

    const byRoom = new Map<string, { roomName: string; building: string | null; capacity: number; booked: number; used: number; meetings: number; noShow: number }>();
    const byDay = new Map<string, { label: string; used: number }>();
    for (const r of rows) {
      const cur = byRoom.get(r.room_id) ?? { roomName: r.room_name, building: r.building, capacity: r.capacity, booked: 0, used: 0, meetings: 0, noShow: 0 };
      cur.booked += Number(r.booked); cur.used += Number(r.used); cur.meetings += Number(r.meetings); cur.noShow += Number(r.no_show);
      byRoom.set(r.room_id, cur);
      const key = vnDayKey(r.day);
      const day = byDay.get(key) ?? { label: vnDayLabel(r.day), used: 0 };
      day.used += Number(r.used);
      byDay.set(key, day);
    }
    const rooms = [...byRoom.values()].sort((a, b) => a.roomName.localeCompare(b.roomName, 'vi'));
    const totals = rooms.reduce((t, r) => ({ booked: t.booked + r.booked, used: t.used + r.used, meetings: t.meetings + r.meetings, noShow: t.noShow + r.noShow }), { booked: 0, used: 0, meetings: 0, noShow: 0 });

    const tableRows = rooms.map((r) => ({
      roomName: r.roomName, building: r.building, capacity: r.capacity, meetingCount: r.meetings,
      bookedHours: round1(r.booked), usedHours: round1(r.used), utilizationRate: pct(r.used, r.booked), noShowCount: r.noShow,
    }));
    const paged = pageRows(tableRows, page, filters.q, ['roomName', 'building']);
    return {
      type: 'room-utilization',
      title: def.title,
      period: { from: filters.from, to: filters.to },
      filterLines: await describeFilters(this.dataSource, def, filters),
      kpis: [
        { key: 'meetingCount', label: 'Số cuộc họp', value: totals.meetings, format: 'number' },
        { key: 'utilizationRate', label: 'Tỷ lệ sử dụng', value: pct(totals.used, totals.booked), format: 'percent' },
        { key: 'noShowRate', label: 'Tỷ lệ không đến', value: pct(totals.noShow, totals.meetings), format: 'percent' },
        { key: 'usedHours', label: 'Tổng giờ dùng', value: round1(totals.used), format: 'hours' },
      ],
      charts: [
        { key: 'daily', data: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, d]) => ({ date: d.label, usedHours: round1(d.used) })) },
        { key: 'byRoom', data: tableRows.map((r) => ({ name: r.roomName, utilizationRate: r.utilizationRate })) },
      ],
      columns: def.columns,
      rows: paged.rows,
      total: paged.total,
    };
  }
}
