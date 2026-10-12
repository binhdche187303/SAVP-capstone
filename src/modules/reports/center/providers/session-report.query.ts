import { DataSource } from 'typeorm';
import { SESSIONS_CTE } from '../../../gate-access/services/gate-access-history.service.js';
import type { ReportFilters, ReportPage, ResolvedScope } from '../report-model.js';

const TZ = `'Asia/Ho_Chi_Minh'`;

/** Cột sắp xếp được: khóa cột của báo cáo → biểu thức SQL (danh sách trắng, SEC-03). */
export const SESSION_SORT: Record<string, string> = {
  zoneName: 'zone_name', code: 'employee_code', fullName: 'full_name', departmentName: 'department_name', plateNumber: 'plate_number',
  checkInTime: 'check_in_time', checkOutTime: 'check_out_time', durationSeconds: 'duration_seconds',
  vehicleTypeLabel: 'vehicle_class', ownerName: 'owner_name', statusLabel: 'registration_label',
};

const ENRICHED = `
  , enriched AS (
    SELECT s.*, gl.vehicle_registration_id,
           p.employee_code, p.full_name, p.department_id, pd.department_name,
           CASE WHEN s.user_id IS NULL THEN 'unknown'
                WHEN pd.department_code = 'VISITOR' THEN 'visitor'
                WHEN EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                              WHERE ur.user_id = s.user_id AND ur.is_active = true AND r.role_code = 'STUDENT') THEN 'student'
                ELSE 'staff' END AS subject_type,
           (vr.id IS NOT NULL) AS registered,
           CASE WHEN lower(COALESCE(vr.vehicle_type, s.metadata_json->>'vehicleType', '')) ~ '(moto|bike|xe may|xe_may|scooter)' THEN 'motorbike'
                WHEN lower(COALESCE(vr.vehicle_type, s.metadata_json->>'vehicleType', '')) ~ '(car|truck|bus|van|suv|o to|taxi)' THEN 'car'
                ELSE 'other' END AS vehicle_class,
           ou.full_name AS owner_name,
           EXISTS (SELECT 1 FROM vehicle_control_list c WHERE c.plate_number = s.plate_number AND c.active = true AND c.deleted_at IS NULL) AS in_control_list
      FROM sessions s
      LEFT JOIN gate_access_logs gl ON gl.id = s.id
      LEFT JOIN users p ON p.id = s.user_id
      LEFT JOIN departments pd ON pd.id = p.department_id
      LEFT JOIN vehicle_registrations vr ON vr.id = gl.vehicle_registration_id AND vr.deleted_at IS NULL
      LEFT JOIN users ou ON ou.id = COALESCE(vr.user_id, s.user_id)
  )`;

export interface SessionQueryOptions {
  filters: ReportFilters;
  scope: ResolvedScope;
  now: Date;
  /** Chỉ các phiên có biển số (báo cáo phương tiện). */
  plateOnly?: boolean;
  /** Bảng chỉ liệt kê phiên hoàn tất (báo cáo ra vào). */
  completedOnly?: boolean;
}

export interface SessionAggregates {
  entries: number;
  exits: number;
  total: number;
  onSite: number;
  avgStaySeconds: number | null;
  cars: number;
  motorbikes: number;
  unregistered: number;
  watchlist: number;
  hourlyIn: Map<number, number>;
  hourlyOut: Map<number, number>;
  byZone: Array<{ name: string; entries: number }>;
  byClass: Array<{ name: string; count: number }>;
}

class Where {
  readonly params: unknown[] = [];
  readonly parts: string[] = [];
  add(sql: string, ...values: unknown[]): void {
    let text = sql;
    for (const v of values) {
      this.params.push(v);
      text = text.replace('?', `$${this.params.length}`);
    }
    this.parts.push(text);
  }
  get clause(): string {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}

const buildWhere = (o: SessionQueryOptions, withPeriod: boolean): Where => {
  const w = new Where();
  const f = o.filters;
  if (withPeriod) {
    w.add(`COALESCE(check_in_time, check_out_time) >= (?::date)::timestamp AT TIME ZONE ${TZ}`, f.from);
    w.add(`COALESCE(check_in_time, check_out_time) < ((?::date) + 1)::timestamp AT TIME ZONE ${TZ}`, f.to);
  }
  if (o.plateOnly) w.add(`plate_number IS NOT NULL AND plate_number <> ''`);
  if (f['zoneId']) w.add('zone_id = ?::uuid', f['zoneId']);
  if (f['departmentId']) w.add('department_id = ?::uuid', f['departmentId']);
  if (f['subjectType']) w.add('subject_type = ?', f['subjectType']);
  if (f['vehicleType']) w.add('vehicle_class = ?', f['vehicleType']);
  const reg = f['registrationStatus'];
  if (reg === 'registered') w.add('registered = true');
  else if (reg === 'unregistered') w.add('registered = false');
  else if (reg === 'watchlist') w.add('in_control_list = true');
  if (f.q) {
    w.add(`(unaccent(lower(COALESCE(full_name, ''))) LIKE '%' || unaccent(lower(?)) || '%' OR lower(COALESCE(plate_number, '')) LIKE '%' || lower(?) || '%' OR lower(COALESCE(employee_code, '')) LIKE '%' || lower(?) || '%')`, f.q, f.q, f.q);
  }
  if (!o.scope.unrestricted) w.add('department_id = ANY(?::uuid[])', o.scope.departmentIds ?? []);
  return w;
};

export async function aggregateSessions(ds: Pick<DataSource, 'query'>, o: SessionQueryOptions): Promise<SessionAggregates> {
  const w = buildWhere(o, true);
  const base = `${SESSIONS_CTE}${ENRICHED}`;
  const head: Array<Record<string, string | null>> = await ds.query(
    `${base} SELECT
        count(*) FILTER (WHERE check_in_time IS NOT NULL)::int AS entries,
        count(*) FILTER (WHERE check_out_time IS NOT NULL)::int AS exits,
        count(*)::int AS total,
        avg(duration_seconds) FILTER (WHERE session_status = 'completed') AS avg_s,
        count(*) FILTER (WHERE vehicle_class = 'car')::int AS cars,
        count(*) FILTER (WHERE vehicle_class = 'motorbike')::int AS motorbikes,
        count(*) FILTER (WHERE registered = false)::int AS unregistered,
        count(*) FILTER (WHERE in_control_list = true)::int AS watchlist
       FROM enriched ${w.clause}`,
    w.params,
  );
  const hours: Array<{ k: string; h: number; n: number }> = await ds.query(
    `${base}
     SELECT 'in' AS k, extract(hour FROM check_in_time AT TIME ZONE ${TZ})::int AS h, count(*)::int AS n FROM enriched ${w.clause}${w.parts.length ? ' AND' : ' WHERE'} check_in_time IS NOT NULL GROUP BY 2
     UNION ALL
     SELECT 'out', extract(hour FROM check_out_time AT TIME ZONE ${TZ})::int, count(*)::int FROM enriched ${w.clause}${w.parts.length ? ' AND' : ' WHERE'} check_out_time IS NOT NULL GROUP BY 2`,
    w.params,
  );
  const byZone: Array<{ name: string; entries: number }> = await ds.query(
    `${base} SELECT COALESCE(zone_name, 'Không rõ') AS name, count(*)::int AS entries FROM enriched ${w.clause}${w.parts.length ? ' AND' : ' WHERE'} check_in_time IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1`,
    w.params,
  );
  const byClass: Array<{ name: string; count: number }> = await ds.query(
    `${base} SELECT CASE vehicle_class WHEN 'car' THEN 'Ô tô' WHEN 'motorbike' THEN 'Xe máy' ELSE 'Khác' END AS name, count(*)::int AS count
       FROM enriched ${w.clause} GROUP BY vehicle_class ORDER BY 2 DESC, 1`,
    w.params,
  );

  // Đang trong khuôn viên: phiên mở của hôm nay (giờ VN), không phụ thuộc kỳ đã chọn.
  const ow = buildWhere(o, false);
  ow.add('check_in_time IS NOT NULL AND check_out_time IS NULL');
  ow.add(`check_in_time >= ((?::timestamptz AT TIME ZONE ${TZ})::date)::timestamp AT TIME ZONE ${TZ}`, o.now);
  const onSite: Array<{ n: number }> = await ds.query(`${base} SELECT count(*)::int AS n FROM enriched ${ow.clause}`, ow.params);

  const hourlyIn = new Map<number, number>();
  const hourlyOut = new Map<number, number>();
  for (const r of hours) (r.k === 'in' ? hourlyIn : hourlyOut).set(r.h, r.n);
  const h = head[0] ?? {};
  return {
    entries: Number(h['entries'] ?? 0), exits: Number(h['exits'] ?? 0), total: Number(h['total'] ?? 0),
    onSite: onSite[0]?.n ?? 0,
    avgStaySeconds: h['avg_s'] === null || h['avg_s'] === undefined ? null : Number(h['avg_s']),
    cars: Number(h['cars'] ?? 0), motorbikes: Number(h['motorbikes'] ?? 0),
    unregistered: Number(h['unregistered'] ?? 0), watchlist: Number(h['watchlist'] ?? 0),
    hourlyIn, hourlyOut, byZone, byClass,
  };
}

export interface SessionRow {
  zone_name: string | null; employee_code: string | null; full_name: string | null; department_name: string | null;
  plate_number: string | null; check_in_time: Date | null; check_out_time: Date | null; duration_seconds: number | null;
  vehicle_class: string; owner_name: string | null; registered: boolean; in_control_list: boolean; registration_label: string;
}

export async function listSessions(
  ds: Pick<DataSource, 'query'>,
  o: SessionQueryOptions,
  page: ReportPage | null,
): Promise<{ rows: SessionRow[]; total: number }> {
  const w = buildWhere(o, true);
  if (o.completedOnly) w.add(`session_status = 'completed'`);
  const sortCol = (page?.sortKey && SESSION_SORT[page.sortKey]) || 'check_in_time';
  const dir = page?.sortKey ? (page.sortDir === 'desc' ? 'DESC' : 'ASC') : 'DESC';
  const params = [...w.params];
  let paging = '';
  if (page) {
    params.push(page.limit, (page.page - 1) * page.limit);
    paging = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const rows: Array<SessionRow & { total: number }> = await ds.query(
    `${SESSIONS_CTE}${ENRICHED}
     SELECT zone_name, employee_code, full_name, department_name, plate_number, check_in_time, check_out_time, duration_seconds,
            vehicle_class, owner_name, registered, in_control_list,
            CASE WHEN in_control_list THEN 'Danh sách kiểm soát' WHEN registered THEN 'Đã đăng ký' ELSE 'Chưa đăng ký' END AS registration_label,
            count(*) OVER()::int AS total
       FROM enriched ${w.clause}
      ORDER BY ${sortCol} ${dir} NULLS LAST, check_in_time DESC NULLS LAST ${paging}`,
    params,
  );
  if (rows.length === 0 && page && page.page > 1) {
    const c: Array<{ n: number }> = await ds.query(`${SESSIONS_CTE}${ENRICHED} SELECT count(*)::int AS n FROM enriched ${w.clause}`, w.params);
    return { rows, total: c[0]?.n ?? 0 };
  }
  return { rows, total: rows[0]?.total ?? 0 };
}
