import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import type { CameraTraceQueryDto } from '../dto/camera-trace-query.dto.js';

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const FACE_EVENT_TYPE = 'ivss_face_event';
const FULL_SCOPE_ROLES = ['SYSTEM_ADMIN', 'ADMIN', 'BUSINESS_ADMIN'];

export type CameraTraceKind = 'gate' | 'meeting' | 'zone';

export interface CameraTraceEventDto {
  id: string;
  time: string;
  kind: CameraTraceKind;
  /** gate: enter|leave · meeting: enter|leave|seen · zone: appear|disappear… */
  direction: string | null;
  userId: string | null;
  userName: string | null;
  employeeCode: string | null;
  plateNumber: string | null;
  roomName: string | null;
  /** Thông tin nguồn camera — luôn có đủ để biết "ai thấy ở đâu". */
  deviceId: string | null;
  deviceCode: string | null;
  deviceName: string | null;
  zoneId: string | null;
  zoneName: string | null;
  groupNames: string[];
  /** FK iot_device_events.id để hiện ảnh bằng chứng. */
  snapshotEventId: string | null;
}

export interface CameraTraceResponseDto {
  devices: Array<{ id: string; deviceCode: string; deviceName: string }>;
  events: CameraTraceEventDto[];
  page: number;
  limit: number;
  hasMore: boolean;
  /** Tổng số dòng khớp bộ lọc (sau gộp sự kiện), trên mọi trang. */
  total: number;
}

interface TraceRow {
  id: string;
  time: Date | string;
  kind: CameraTraceKind;
  direction: string | null;
  user_id: string | null;
  user_name: string | null;
  employee_code: string | null;
  plate_number: string | null;
  room_name: string | null;
  device_id: string | null;
  device_code: string | null;
  device_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  group_names: string[] | null;
  snapshot_event_id: string | null;
  total_count: number | string;
}

/** Cột sắp xếp được phép → biểu thức SQL (whitelist, không nối chuỗi từ người dùng). */
const SORT_EXPR: Record<NonNullable<CameraTraceQueryDto['sortBy']>, string> = {
  time: 'x.ev_time',
  person: 'lower(COALESCE(u.full_name, x.plate_number))',
  event: "x.kind || ':' || COALESCE(x.direction, '')",
  camera: 'lower(d.device_name)',
  zone: 'lower(z.zone_name)',
};

/**
 * CameraTraceService — truy vết theo camera / nhóm camera / khu vực (họp 20/10: tra mất đồ).
 * Ghép đúng 3 nguồn như UserJourney (cổng, họp qua khuôn mặt, hiện diện khu vực) nhưng lọc theo
 * THIẾT BỊ thay vì theo người. READ-ONLY. Sự kiện camera bắn liên tục (meeting/zone) được gộp
 * còn 1 dòng/phút/(camera, người, hướng) để danh sách đọc được.
 */
@Injectable()
export class CameraTraceService {
  private readonly logger = new Logger(CameraTraceService.name);

  constructor(private readonly dataSource: DataSource) {}

  async trace(callerId: string, q: CameraTraceQueryDto): Promise<CameraTraceResponseDto> {
    if (!q.groupId && !q.deviceId && !q.zoneId) {
      throw new BadRequestException({
        code: 'CAMERA_TRACE_FILTER_REQUIRED',
        message: 'Cần chọn nhóm camera, camera hoặc khu vực để truy vết.',
      });
    }
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException({ code: 'INVALID_TRACE_RANGE', message: 'Mốc kết thúc phải sau mốc bắt đầu.' });
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException({ code: 'INVALID_TRACE_RANGE', message: 'Khoảng thời gian tối đa 31 ngày.' });
    }
    const page = q.page ?? 1;
    const limit = q.limit ?? 100;

    const devices: Array<{ id: string; device_code: string; device_name: string }> = await this.dataSource.query(
      `SELECT d.id, d.device_code, d.device_name
         FROM iot_devices d
        WHERE ($1::uuid IS NULL OR d.id = $1::uuid)
          AND ($2::uuid IS NULL OR EXISTS (
                SELECT 1 FROM camera_group_members m WHERE m.group_id = $2::uuid AND m.device_id = d.id))
          AND ($3::uuid IS NULL OR d.zone_id = $3::uuid)
        ORDER BY d.device_name`,
      [q.deviceId ?? null, q.groupId ?? null, q.zoneId ?? null],
    );
    const base = {
      devices: devices.map((d) => ({ id: d.id, deviceCode: d.device_code, deviceName: d.device_name })),
      page,
      limit,
    };
    if (devices.length === 0) return { ...base, events: [], hasMore: false, total: 0 };

    // Tham số dựng dần để chỉ số $n luôn khớp dù thêm/bớt điều kiện.
    const params: unknown[] = [devices.map((d) => d.id), from, to, FACE_EVENT_TYPE];
    const bind = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    const scopeSql = await this.scopeClause(callerId, bind);
    const filters: string[] = [];
    if (q.kind) filters.push(`x.kind = ${bind(q.kind)}`);
    const needle = q.q?.trim();
    if (needle) {
      const like = bind(`%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      filters.push(`(u.full_name ILIKE ${like} OR u.employee_code ILIKE ${like} OR x.plate_number ILIKE ${like})`);
    }
    const dir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
    const sortExpr = SORT_EXPR[q.sortBy ?? 'time'];
    const limitRef = bind(limit + 1);
    const offsetRef = bind((page - 1) * limit);
    const rows: TraceRow[] = await this.dataSource.query(
      `WITH ev AS (
         SELECT g.id::text AS id, g.access_time AS ev_time, 'gate'::text AS kind, g.device_id, g.zone_id, g.user_id,
                g.direction, g.plate_number, NULL::text AS room_name, g.event_id::text AS snapshot_event_id
           FROM gate_access_logs g
          WHERE g.device_id = ANY($1::uuid[]) AND g.access_time >= $2 AND g.access_time < $3
         UNION ALL
         SELECT e.id::text, e.event_time, 'meeting', e.device_id, e.zone_id,
                NULLIF(e.payload_json->>'userId','')::uuid,
                e.payload_json->>'direction', NULL, r.room_name, e.id::text
           FROM iot_device_events e
           LEFT JOIN rooms r ON r.id = COALESCE(e.room_id, NULLIF(e.payload_json->>'roomId','')::uuid)
                            AND r.deleted_at IS NULL
          WHERE e.event_type = $4 AND e.device_id = ANY($1::uuid[]) AND e.event_time >= $2 AND e.event_time < $3
         UNION ALL
         SELECT p.id::text, p.event_time, 'zone', p.device_id, p.zone_id, p.user_id,
                p.event_type, NULL, NULL, p.metadata_json->>'sourceEventId'
           FROM zone_presence_events p
          WHERE p.event_type <> 'count' AND p.device_id = ANY($1::uuid[]) AND p.event_time >= $2 AND p.event_time < $3
       ),
       dedup AS (
         SELECT DISTINCT ON (kind, device_id, user_id, direction,
                             CASE WHEN kind = 'gate' THEN id ELSE date_trunc('minute', ev_time)::text END) ev.*
           FROM ev
          ORDER BY kind, device_id, user_id, direction,
                   CASE WHEN kind = 'gate' THEN id ELSE date_trunc('minute', ev_time)::text END, ev_time ASC
       )
       SELECT x.id, x.ev_time AS time, x.kind, x.direction, x.user_id, u.full_name AS user_name, u.employee_code,
              COUNT(*) OVER() AS total_count,
              x.plate_number, x.room_name, x.device_id, d.device_code, d.device_name,
              COALESCE(x.zone_id, d.zone_id) AS zone_id, z.zone_name, x.snapshot_event_id,
              (SELECT array_agg(cg.group_name ORDER BY cg.group_name)
                 FROM camera_group_members m JOIN camera_groups cg ON cg.id = m.group_id
                WHERE m.device_id = x.device_id) AS group_names
         FROM dedup x
         LEFT JOIN users u ON u.id = x.user_id
         LEFT JOIN iot_devices d ON d.id = x.device_id
         LEFT JOIN zones z ON z.id = COALESCE(x.zone_id, d.zone_id) AND z.deleted_at IS NULL
        WHERE 1 = 1 ${scopeSql} ${filters.map((f) => `AND ${f}`).join(' ')}
        ORDER BY ${sortExpr} ${dir} NULLS LAST, x.ev_time DESC, x.id
        LIMIT ${limitRef} OFFSET ${offsetRef}`,
      params,
    );

    const hasMore = rows.length > limit;
    const events: CameraTraceEventDto[] = rows.slice(0, limit).map((r) => ({
      id: r.id,
      time: new Date(r.time).toISOString(),
      kind: r.kind,
      direction: r.direction ?? null,
      userId: r.user_id,
      userName: r.user_name,
      employeeCode: r.employee_code,
      plateNumber: r.plate_number,
      roomName: r.room_name,
      deviceId: r.device_id,
      deviceCode: r.device_code,
      deviceName: r.device_name,
      zoneId: r.zone_id,
      zoneName: r.zone_name,
      groupNames: r.group_names ?? [],
      snapshotEventId: r.snapshot_event_id,
    }));

    await this.audit(callerId, q);
    return { ...base, events, hasMore, total: rows.length ? Number(rows[0].total_count) : 0 };
  }

  /** SYSTEM/BUSINESS_ADMIN thấy tất cả; role khác (MANAGER) chỉ thấy người cùng phòng ban/cấp dưới trực tiếp. */
  private async scopeClause(callerId: string, bind: (v: unknown) => string): Promise<string> {
    const roles = (await this.dataSource.query(
      `SELECT r.role_code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1 AND ur.is_active = true AND r.is_active = true`,
      [callerId],
    )) as Array<{ role_code: string }>;
    if (roles.some((r) => FULL_SCOPE_ROLES.includes(r.role_code))) return '';
    return `AND x.user_id IN (
              SELECT t.id FROM users t JOIN users c ON c.id = ${bind(callerId)}
               WHERE t.deleted_at IS NULL
                 AND (t.direct_manager_id = c.id
                      OR (c.department_id IS NOT NULL AND t.department_id = c.department_id)))`;
  }

  private async audit(callerId: string, q: CameraTraceQueryDto): Promise<void> {
    try {
      await this.dataSource.manager.insert(AuditLogEntity, {
        userId: callerId,
        actionType: 'camera_trace.view',
        entityType: q.groupId ? 'camera_group' : q.deviceId ? 'iot_device' : 'zone',
        entityId: (q.groupId ?? q.deviceId ?? q.zoneId) as string,
        severity: AuditLogSeverity.INFO,
        metadataJson: { from: q.from, to: q.to },
      });
    } catch (err) {
      this.logger.warn(`Không ghi được audit camera_trace.view: ${(err as Error).message}`);
    }
  }
}
