// Dữ liệu cố định cho test truy vấn phân hệ Khách. Mọi tên mang tiền tố TAG để dọn gọn.
import type { DataSource } from 'typeorm';

export const TAG = 'fa11ed00';

export interface VisitFixture {
  deptA: string; deptB: string; hostA: string; hostB: string; zoneGate: string; zoneB1: string;
  ids: Record<string, string>;
}

const TODAY_VN = `date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`;

export async function cleanupVisitFixture(ds: DataSource): Promise<void> {
  await ds.query(`DELETE FROM visitor_visits WHERE purpose LIKE '${TAG}%'`);
  await ds.query(`DELETE FROM visitors WHERE full_name LIKE '${TAG}%'`);
  await ds.query(`DELETE FROM users WHERE employee_code LIKE '${TAG}-%' OR (email LIKE '%@visitor.invalid' AND full_name LIKE '${TAG}%')`);
  await ds.query(`DELETE FROM gate_access_logs WHERE zone_id IN (SELECT id FROM zones WHERE zone_code LIKE '${TAG}-%')`);
  await ds.query(`DELETE FROM zones WHERE zone_code LIKE '${TAG}-%'`);
  await ds.query(`DELETE FROM departments WHERE department_code LIKE '${TAG}%'`);
}

/**
 * Hôm nay (giờ VN): 12 lượt đủ trạng thái; hôm qua: 1 chưa ghi nhận giờ ra + 1 hết hạn; 5 ngày trước: 2 lượt đã rời.
 * Khách V1..V9 là người khác nhau, trừ V9 có hai lượt (để kiểm "các lượt của một khách").
 */
export async function seedVisitFixture(ds: DataSource): Promise<VisitFixture> {
  await cleanupVisitFixture(ds);
  const dept = async (code: string, name: string) =>
    (await ds.query(`INSERT INTO departments (department_code, department_name, is_active) VALUES ($1,$2,true) RETURNING id`, [`${TAG}${code}`, `${TAG} ${name}`]))[0].id as string;
  const deptA = await dept('A', 'Khoa A');
  const deptB = await dept('B', 'Khoa B');
  const host = async (c: string, name: string, d: string) =>
    (await ds.query(`INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id) VALUES ($1,$2,$3,'x',$4,$5) RETURNING id`,
      [`${TAG}-${c}`, `${TAG}${c}`, `${TAG}${c}@t.invalid`, `${TAG} ${name}`, d]))[0].id as string;
  const hostA = await host('HA', 'Chủ A', deptA);
  const hostB = await host('HB', 'Chủ B', deptB);
  const zone = async (c: string, name: string, type: string) =>
    (await ds.query(`INSERT INTO zones (zone_code, zone_name, zone_type, status) VALUES ($1,$2,$3,'active') RETURNING id`, [`${TAG}-${c}`, `${TAG} ${name}`, type]))[0].id as string;
  const zoneGate = await zone('G', 'Cổng', 'gate');
  const zoneB1 = await zone('B1', 'Tòa B1', 'building');

  const ids: Record<string, string> = {};
  let seq = 0;
  const visitor = async (name: string, org: string, withPhoto: boolean) => {
    seq += 1;
    const phone = `0944${String(seq).padStart(6, '0')}`;
    const u = (await ds.query(`INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id)
                               VALUES ($1,$2,$3,'x',$4,'8d4f3a2b-5c7b-4a3f-8e9d-2b3c4d5e6f70') RETURNING id`,
      [`${TAG}-V${seq}`, `${TAG}v${seq}`, `${TAG}v${seq}@visitor.invalid`, `${TAG} ${name}`]))[0].id;
    const vis = (await ds.query(`INSERT INTO visitors (user_id, full_name, id_number, phone_number, organization) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [u, `${TAG} ${name}`, `944${String(seq).padStart(9, '0')}`, phone, org]))[0].id;
    let photo: string | null = null;
    if (withPhoto) {
      photo = (await ds.query(`INSERT INTO media_files (file_name, file_type, mime_type, storage_provider, storage_key) VALUES ('p.jpg','image','image/jpeg','local',$1) RETURNING id`, [`${TAG}/${seq}.jpg`]))[0].id;
    }
    return { vis: vis as string, photo };
  };

  type Spec = { key: string; status: string; host: string; dept: string; day: number; fromH: number; toH: number; validToOffsetMin?: number; photo?: boolean;
                checkIn?: string; checkOut?: string; revoked?: boolean; org?: string; purpose?: string; visitorKey?: string };
  const specs: Spec[] = [
    { key: 'pending', status: 'pending_approval', host: hostA, dept: deptA, day: 0, fromH: 15, toH: 17 },
    { key: 'approvedNoPhoto', status: 'approved', host: hostA, dept: deptA, day: 0, fromH: 14, toH: 16, photo: false },
    { key: 'approved', status: 'approved', host: hostB, dept: deptB, day: 0, fromH: 16, toH: 18 },
    { key: 'insideOk', status: 'checked_in', host: hostA, dept: deptA, day: 0, fromH: 8, toH: 10, validToOffsetMin: 600, checkIn: 'now() - interval \'60 minutes\'' },
    { key: 'overstay', status: 'checked_in', host: hostB, dept: deptB, day: 0, fromH: 7, toH: 9, validToOffsetMin: -45, checkIn: 'now() - interval \'3 hours\'' },
    { key: 'mustLeave', status: 'must_leave', host: hostA, dept: deptA, day: 0, fromH: 8, toH: 12, validToOffsetMin: 600, checkIn: 'now() - interval \'2 hours\'', revoked: true },
    { key: 'out', status: 'checked_out', host: hostA, dept: deptA, day: 0, fromH: 8, toH: 9, validToOffsetMin: 600, checkIn: 'now() - interval \'5 hours\'', checkOut: 'now() - interval \'4 hours\'' },
    { key: 'rejected', status: 'rejected', host: hostA, dept: deptA, day: 0, fromH: 11, toH: 12 },
    { key: 'cancelled', status: 'cancelled', host: hostB, dept: deptB, day: 0, fromH: 11, toH: 12 },
    { key: 'yesterdayUnrecorded', status: 'exit_unrecorded', host: hostA, dept: deptA, day: -1, fromH: 9, toH: 11, checkIn: `${TODAY_VN} - interval '1 day' + interval '9 hours'` },
    { key: 'yesterdayExpired', status: 'expired', host: hostB, dept: deptB, day: -1, fromH: 9, toH: 11 },
    { key: 'old1', status: 'checked_out', host: hostA, dept: deptA, day: -5, fromH: 9, toH: 10, org: 'Công ty Cũ', checkIn: `${TODAY_VN} - interval '5 days' + interval '9 hours'`, checkOut: `${TODAY_VN} - interval '5 days' + interval '10 hours'`, visitorKey: 'repeat' },
    { key: 'old2', status: 'checked_out', host: hostB, dept: deptB, day: -5, fromH: 14, toH: 16, org: 'Công ty Cũ', checkIn: `${TODAY_VN} - interval '5 days' + interval '14 hours'`, checkOut: `${TODAY_VN} - interval '5 days' + interval '17 hours'`, visitorKey: 'repeat' },
  ];
  const repeat = await visitor('Khách Lặp', 'Công ty Cũ', true);
  let code = 0;
  for (const s of specs) {
    const v = s.visitorKey === 'repeat' ? repeat : await visitor(`Khách ${s.key}`, s.org ?? 'Công ty Mẫu', s.photo !== false);
    code += 1;
    const dayExpr = `(${TODAY_VN} + interval '${s.day} days')`;
    const validTo = s.validToOffsetMin !== undefined ? `now() + interval '${s.validToOffsetMin} minutes'` : `${dayExpr} + interval '${s.toH} hours' + interval '30 minutes'`;
    const rows = await ds.query(
      `INSERT INTO visitor_visits (visit_code, visitor_id, channel, status, host_user_id, department_id, purpose, scheduled_from, scheduled_to,
              valid_from, valid_to, check_in_at, check_out_at, revoked_at, photo_file_id, face_score, last_seen_at, last_seen_zone_id)
       VALUES ($1,$2,'online',$3,$4,$5,$6, ${dayExpr} + interval '${s.fromH} hours', ${dayExpr} + interval '${s.toH} hours',
               ${dayExpr} + interval '${s.fromH} hours' - interval '30 minutes', ${validTo},
               ${s.checkIn ?? 'NULL'}, ${s.checkOut ?? 'NULL'}, ${s.revoked ? "now() - interval '10 minutes'" : 'NULL'}, $7,
               ${s.checkIn ? '0.9300' : 'NULL'}, ${s.checkIn ? 'now() - interval \'30 minutes\'' : 'NULL'}, ${s.checkIn ? '$8' : 'NULL'}) RETURNING id`,
      s.checkIn ? [`VS-${TAG}-${String(code).padStart(2, '0')}`, v.vis, s.status, s.host, s.dept, `${TAG} ${s.key}`, v.photo, zoneGate]
        : [`VS-${TAG}-${String(code).padStart(2, '0')}`, v.vis, s.status, s.host, s.dept, `${TAG} ${s.key}`, v.photo],
    );
    ids[s.key] = rows[0].id;
    await ds.query(`INSERT INTO visitor_visit_zones (visit_id, zone_id) VALUES ($1,$2),($1,$3)`, [rows[0].id, zoneGate, zoneB1]);
  }
  // Một lần quét bị từ chối hôm nay, để quầy lễ tân có cảnh báo.
  await ds.query(`INSERT INTO visitor_visit_events (visit_id, event_type, zone_id, note) VALUES ($1,'access_denied',$2,'Ngoài khung giờ được cấp')`, [ids.approved, zoneGate]);
  return { deptA, deptB, hostA, hostB, zoneGate, zoneB1, ids };
}
