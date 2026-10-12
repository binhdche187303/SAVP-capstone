// Dữ liệu mẫu Trung tâm báo cáo (tiền tố fa11ed01). Giờ ghi theo UTC, ghi chú kèm giờ Việt Nam (UTC+7).
import { DataSource } from 'typeorm';

export const RTAG = 'fa11ed01';
export const VISITOR_DEPT = '8d4f3a2b-5c7b-4a3f-8e9d-2b3c4d5e6f70';
/** "Bây giờ" của bài test: 16/09/2026 19:00 giờ VN. */
export const NOW = new Date('2026-09-16T12:00:00Z');
export const PERIOD = { from: '2026-09-14', to: '2026-09-16' };

export interface ReportFixture {
  g1: string; g2: string; deptA: string; deptB: string; staffA: string; staffB: string; student: string; visitor: string;
  insertedStudentRole: boolean;
}

export async function cleanupReportFixture(ds: DataSource): Promise<void> {
  await ds.query(`DELETE FROM gate_access_logs WHERE zone_id IN (SELECT id FROM zones WHERE zone_code LIKE '${RTAG}-%')`);
  await ds.query(`DELETE FROM vehicle_control_list WHERE plate_number LIKE '${RTAG.toUpperCase()}%'`);
  await ds.query(`DELETE FROM vehicle_registrations WHERE plate_number LIKE '${RTAG.toUpperCase()}%'`);
  await ds.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE employee_code LIKE '${RTAG}-%')`);
  await ds.query(`DELETE FROM users WHERE employee_code LIKE '${RTAG}-%'`);
  await ds.query(`DELETE FROM zones WHERE zone_code LIKE '${RTAG}-%'`);
  await ds.query(`DELETE FROM departments WHERE department_code LIKE '${RTAG}%'`);
  await ds.query(`DELETE FROM roles WHERE role_code = 'STUDENT' AND description = '${RTAG}'`);
}

export async function seedReportFixture(ds: DataSource): Promise<ReportFixture> {
  await cleanupReportFixture(ds);
  const q = async (sql: string, p: unknown[] = []) => (await ds.query(sql, p))[0].id as string;
  const zone = (c: string, n: string) => q(`INSERT INTO zones (zone_code, zone_name, zone_type, status) VALUES ($1,$2,'gate','active') RETURNING id`, [`${RTAG}-${c}`, `${RTAG} ${n}`]);
  const dept = (c: string, n: string) => q(`INSERT INTO departments (department_code, department_name, is_active) VALUES ($1,$2,true) RETURNING id`, [`${RTAG}${c}`, `${RTAG} ${n}`]);
  const user = (c: string, n: string, d: string) =>
    q(`INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id) VALUES ($1,$2,$3,'x',$4,$5) RETURNING id`, [`${RTAG}-${c}`, `${RTAG}${c}`.toLowerCase(), `${RTAG}${c}@t.invalid`.toLowerCase(), n, d]);

  const g1 = await zone('G1', 'Cổng 1');
  const g2 = await zone('G2', 'Cổng 2');
  const deptA = await dept('A', 'Khoa A');
  const deptB = await dept('B', 'Khoa B');
  const staffA = await user('A1', 'Nguyễn Văn An', deptA);
  const staffB = await user('B1', 'Trần Thị Bình', deptB);
  const student = await user('S1', 'Lê Sinh Viên', deptA);
  const visitor = await user('V1', 'Phạm Khách', VISITOR_DEPT);

  let insertedStudentRole = false;
  if (!(await ds.query(`SELECT 1 FROM roles WHERE role_code = 'STUDENT'`)).length) {
    await ds.query(`INSERT INTO roles (role_code, role_name, description) VALUES ('STUDENT','Sinh viên','${RTAG}')`);
    insertedStudentRole = true;
  }
  await ds.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE role_code = 'STUDENT'`, [student]);

  await ds.query(`INSERT INTO vehicle_registrations (user_id, plate_number, plate_raw, vehicle_type, status) VALUES ($1,'${RTAG.toUpperCase()}A','${RTAG.toUpperCase()}A','car','active')`, [staffA]);
  await ds.query(`INSERT INTO vehicle_registrations (user_id, plate_number, plate_raw, vehicle_type, status) VALUES ($1,'${RTAG.toUpperCase()}B','${RTAG.toUpperCase()}B','motorbike','active')`, [staffB]);
  await ds.query(`INSERT INTO vehicle_control_list (plate_number, plate_raw, list_type, active) VALUES ('${RTAG.toUpperCase()}X','${RTAG.toUpperCase()}X','watchlist',true)`);
  const regA = await q(`SELECT id FROM vehicle_registrations WHERE plate_number = '${RTAG.toUpperCase()}A'`);
  const regB = await q(`SELECT id FROM vehicle_registrations WHERE plate_number = '${RTAG.toUpperCase()}B'`);

  type S = { user: string | null; zone: string; inAt: string; outAt: string | null; plate?: string; reg?: string; meta?: Record<string, string> };
  const sessions: S[] = [
    { user: staffA, zone: g1, inAt: '2026-09-14T01:00:00Z', outAt: '2026-09-14T10:00:00Z', plate: `${RTAG.toUpperCase()}A`, reg: regA },   // 14/9 08:00–17:00 VN
    { user: staffA, zone: g1, inAt: '2026-09-15T01:30:00Z', outAt: '2026-09-15T10:30:00Z' },                                           // 15/9 08:30–17:30
    { user: staffA, zone: g2, inAt: '2026-09-16T00:30:00Z', outAt: '2026-09-16T09:30:00Z' },                                           // 16/9 07:30–16:30
    { user: staffB, zone: g2, inAt: '2026-09-14T02:00:00Z', outAt: '2026-09-14T05:00:00Z', plate: `${RTAG.toUpperCase()}B`, reg: regB },  // 09:00–12:00
    { user: staffB, zone: g2, inAt: '2026-09-15T02:00:00Z', outAt: '2026-09-15T04:00:00Z' },                                           // 09:00–11:00
    { user: student, zone: g1, inAt: '2026-09-14T00:00:00Z', outAt: '2026-09-14T04:00:00Z' },                                         // 07:00–11:00
    { user: student, zone: g1, inAt: '2026-09-15T00:00:00Z', outAt: '2026-09-15T04:00:00Z' },
    { user: visitor, zone: g1, inAt: '2026-09-15T03:00:00Z', outAt: '2026-09-15T05:00:00Z', plate: `${RTAG.toUpperCase()}V`, meta: { vehicleType: 'Car' } },  // 10:00–12:00
    { user: null, zone: g2, inAt: '2026-09-13T23:30:00Z', outAt: '2026-09-14T00:30:00Z', plate: `${RTAG.toUpperCase()}X`, meta: { vehicleType: 'Motorbike' } }, // 14/9 06:30–07:30
    { user: null, zone: g2, inAt: '2026-09-15T23:30:00Z', outAt: '2026-09-16T00:30:00Z', plate: `${RTAG.toUpperCase()}X`, meta: { vehicleType: 'Motorbike' } }, // 16/9 06:30–07:30
    { user: staffA, zone: g1, inAt: '2026-09-15T16:30:00Z', outAt: '2026-09-15T18:30:00Z' },                                         // 15/9 23:30 → 16/9 01:30 VN (vắt qua nửa đêm)
    { user: staffA, zone: g1, inAt: '2026-09-14T13:00:00Z', outAt: null },                                                            // 14/9 20:00 VN, chưa ra (phiên mở cũ)
    { user: staffB, zone: g2, inAt: '2026-09-16T11:00:00Z', outAt: null },                                                            // 16/9 18:00 VN, chưa ra (hôm nay)
  ];
  for (const s of sessions) {
    const enter = await q(
      `INSERT INTO gate_access_logs (zone_id, user_id, vehicle_registration_id, plate_number, direction, access_time, metadata_json)
       VALUES ($1,$2,$3,$4,'enter',$5,$6) RETURNING id`,
      [s.zone, s.user, s.reg ?? null, s.plate ?? null, s.inAt, s.meta ? JSON.stringify(s.meta) : null]);
    if (!s.outAt) continue;
    const secs = Math.round((Date.parse(s.outAt) - Date.parse(s.inAt)) / 1000);
    const leave = await q(
      `INSERT INTO gate_access_logs (zone_id, user_id, vehicle_registration_id, plate_number, direction, access_time, paired_log_id, duration_seconds, metadata_json)
       VALUES ($1,$2,$3,$4,'leave',$5,$6,$7,$8) RETURNING id`,
      [s.zone, s.user, s.reg ?? null, s.plate ?? null, s.outAt, enter, secs, s.meta ? JSON.stringify(s.meta) : null]);
    await ds.query(`UPDATE gate_access_logs SET paired_log_id = $2, duration_seconds = $3 WHERE id = $1`, [enter, leave, secs]);
  }
  return { g1, g2, deptA, deptB, staffA, staffB, student, visitor, insertedStudentRole };
}
