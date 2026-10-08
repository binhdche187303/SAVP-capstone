// Giai đoạn A1 — tài khoản mới (đủ mọi role), ảnh đại diện, hồ sơ khuôn mặt.
import { asset, did, insert, vnTime } from './lib.mjs';

// Hash bcrypt của "Abcd1234@" — cùng hash với các tài khoản demo hiện có.
export const DEMO_PASSWORD_HASH =
  '$2b$10$szGAzI6OAO0nxSI4OSsCuuwQVvan0AJW2XjzvMlHb2VeNGgBusgm6';

// [role, giới tính, họ tên, username, phòng ban, chức danh, phòng ban của manager trực tiếp]
const STAFF = [
  ['SYSTEM_ADMIN', 'M', 'Trần Quang Vinh', 'vinh.tq', 'IT', 'Quản trị hệ thống'],
  ['BUSINESS_ADMIN', 'F', 'Nguyễn Thị Thu Hà', 'ha.ntt', 'FAC', 'Quản trị nghiệp vụ - Vận hành'],
  ['BUSINESS_ADMIN', 'M', 'Phạm Đức Thành', 'thanh.pd', 'SALES', 'Quản trị nghiệp vụ - Kinh doanh'],
  ['MANAGER', 'F', 'Lê Thị Phương Anh', 'anh.ltp', 'ADM', 'Trưởng phòng Hành chính'],
  ['MANAGER', 'M', 'Đặng Văn Hiếu', 'hieu.dv', 'FAC', 'Trưởng phòng Vận hành'],
  ['MANAGER', 'M', 'Ngô Minh Tâm', 'tam.nm', 'IT', 'Trưởng nhóm Phát triển'],
  ['MANAGER', 'F', 'Vũ Thị Hồng Nhung', 'nhung.vth', 'SALES', 'Trưởng nhóm Kinh doanh'],
  ['GUARD', 'M', 'Trịnh Văn Dũng', 'dung.tv', 'FAC', 'Bảo vệ cổng chính'],
  ['GUARD', 'M', 'Lương Quốc Bảo', 'bao.lq', 'FAC', 'Bảo vệ cổng phụ'],
  ['EMPLOYEE', 'F', 'Hoàng Thị Lan Anh', 'lananh.ht', 'IT', 'Lập trình viên'],
  ['EMPLOYEE', 'F', 'Bùi Thị Ngọc Mai', 'mai.btn', 'IT', 'Kiểm thử phần mềm'],
  ['EMPLOYEE', 'M', 'Cao Văn Lộc', 'loc.cv', 'IT', 'Lập trình viên'],
  ['EMPLOYEE', 'F', 'Đỗ Thị Thanh Tâm', 'tam.dtt', 'HR', 'Chuyên viên Nhân sự'],
  ['EMPLOYEE', 'F', 'Phan Thị Kim Ngân', 'ngan.ptk', 'SALES', 'Chuyên viên Kinh doanh'],
  ['EMPLOYEE', 'F', 'Dương Thị Hải Yến', 'yen.dth', 'SALES', 'Chuyên viên Chăm sóc khách hàng'],
  ['EMPLOYEE', 'F', 'Lý Thị Bích Phượng', 'phuong.ltb', 'ADM', 'Lễ tân'],
  ['EMPLOYEE', 'F', 'Mai Thị Thu Trang', 'trang.mtt', 'ADM', 'Nhân viên Hành chính'],
  ['EMPLOYEE', 'M', 'Tạ Quốc Khánh', 'khanh.tq', 'FAC', 'Kỹ thuật viên Cơ sở vật chất'],
];

const TEACHERS = [
  ['Nguyễn Thị Hồng Gấm', 'gam.nth', 'Giảng viên Kỹ thuật phần mềm'],
  ['Trần Thị Lệ Quyên', 'quyen.ttl', 'Giảng viên Cơ sở dữ liệu'],
];

const STUDENTS = [
  ['F', 'Nguyễn Thị Minh Châu'], ['F', 'Trần Thu Hương'], ['F', 'Lê Khánh Linh'],
  ['F', 'Phạm Ngọc Diệp'], ['F', 'Hoàng Bảo Trâm'], ['F', 'Vũ Hà My'],
  ['M', 'Đinh Quang Huy'], ['M', 'Nguyễn Hữu Phước'], ['M', 'Bùi Anh Tuấn'],
  ['M', 'Lưu Đức Mạnh'], ['M', 'Trương Gia Bảo'],
];

// Phân bổ trạng thái hồ sơ khuôn mặt để màn hình duyệt có đủ trạng thái.
const FACE_STATUS_CYCLE = [
  'active', 'active', 'active', 'active', 'active', 'active', 'active', 'active',
  'active', 'active', 'pending_review', 'pending_review', 'active', 'rejected',
  'active', 'revoked', 'active', 'active', 'pending_review', 'disabled',
];

export async function seedPeople(ctx) {
  const { c, ref, out, now, snap } = ctx;
  const faces = asset('faces.json');
  const take = { staffF: 0, staffM: 0, studentF: 0, studentM: 0, teacherF: 0 };
  const nextFace = (group) => faces[group][take[group]++];

  const users = [];
  const userRoles = [];
  const mediaRows = [];
  const faceRows = [];
  let nU = 0, nM = 0, nF = 0;

  const deptId = (code) => ref.dept[code];
  const managerOf = {}; // dept → user id (manager mới tạo, fallback manager có sẵn)
  managerOf.HR = ref.user['manager.hr'];
  const roleId = (code) => ref.role[code];

  const addUser = (u) => {
    nU++;
    const id = did('users', nU);
    users.push({
      id,
      employee_code: u.code,
      username: u.username,
      email: u.email,
      password_hash: DEMO_PASSWORD_HASH,
      full_name: u.name,
      phone_number: u.phone,
      avatar_url: u.avatar,
      department_id: u.dept ? deptId(u.dept) : null,
      direct_manager_id: u.manager ?? null,
      position_title: u.title,
      employment_status: u.employment ?? 'active',
      account_status: u.account ?? 'active',
      must_change_password: false,
      password_updated_at: vnTime(-20, 9, 0, now),
      failed_login_count: 0,
      last_login_at: u.lastLogin ?? vnTime(-1, 8, 30 + (nU % 25), now),
      created_at: vnTime(-45, 9, 0, now),
      updated_at: vnTime(-3, 9, 0, now),
    });
    userRoles.push({
      id: did('user_roles', nU),
      user_id: id,
      role_id: roleId(u.role),
      assigned_by: ref.user['sysadmin'],
      assigned_at: vnTime(-45, 9, 5, now),
      is_active: true,
    });
    // Ảnh đại diện + hồ sơ khuôn mặt (staff & students)
    if (u.faceGroup) {
      const f = nextFace(u.faceGroup);
      users[users.length - 1].avatar_url = f.uri;
      nM++;
      const realMedia = snap.get(`U-${u.code}`); // ảnh thật đã có trên storage backend
      const mediaId = realMedia ?? did('media_files', nM);
      (realMedia ? [] : mediaRows).push({
        id: mediaId,
        file_code: `FACE-${u.code}`,
        related_entity_type: 'face_profile',
        uploaded_by: id,
        file_name: `${u.code}.jpg`,
        file_type: 'image',
        mime_type: 'image/jpeg',
        storage_provider: 'cloud_provider', // backend tải ảnh từ file_url (data URI) — không cần file trên storage
        storage_key: `demo-seed/faces/${u.code}.jpg`,
        file_url: f.uri,
        file_size_bytes: Math.round(f.uri.length * 0.75),
        version_no: 1,
        visibility_level: 'internal',
        is_active: true,
        uploaded_at: vnTime(-30, 10, nU % 50, now),
        metadata_json: { seed: 'DEMO-2026-10', source: 'ai_generated' },
      });
      nF++;
      const status = FACE_STATUS_CYCLE[(nF - 1) % FACE_STATUS_CYCLE.length];
      const approved = status === 'active' || status === 'revoked' || status === 'disabled';
      faceRows.push({
        id: did('face_profiles', nF),
        user_id: id,
        profile_code: `FP-DEMO-${String(nF).padStart(4, '0')}`,
        status,
        consent_at: vnTime(-30, 10, nU % 50, now),
        model_version: approved ? 'arcface-r100-v2' : null,
        primary_image_file_id: mediaId,
        embedding_storage_key: approved ? `demo-seed/embeddings/${u.code}.bin` : null,
        quality_score: approved ? (0.86 + ((nF * 7) % 12) / 100).toFixed(2) : (0.62 + ((nF * 5) % 15) / 100).toFixed(2),
        sample_count: 3 + (nF % 3),
        enrolled_by: id,
        enrolled_at: vnTime(-30, 10, nU % 50, now),
        last_updated_at: vnTime(-12, 14, nU % 50, now),
        metadata_json: { seed: 'DEMO-2026-10', ...(status === 'rejected' ? { rejectReason: 'Ảnh bị mờ, vui lòng chụp lại' } : {}) },
      });
      u._userId = id;
      u._faceProfileId = did('face_profiles', nF);
      u._faceMediaId = mediaId;
      u._faceUri = f.uri;
      u._faceStatus = status;
    }
    u.id = id;
    return u;
  };

  // --- Staff (SYSTEM_ADMIN / BUSINESS_ADMIN / MANAGER / GUARD / EMPLOYEE) ---
  const staffOut = [];
  let empNo = 101;
  for (const [role, g, name, username, dept, title] of STAFF) {
    const manager =
      role === 'MANAGER' ? ref.user['sysadmin']
      : role === 'EMPLOYEE' || role === 'GUARD' ? managerOf[dept] ?? null
      : null;
    const u = addUser({
      role, name, username, dept, title, manager,
      code: `EMP${empNo++}`,
      email: `${username}@meetingsys.vn`,
      phone: `09${String(10000000 + nU * 137911).slice(0, 8)}`,
      faceGroup: g === 'F' ? 'staffF' : 'staffM',
      employment: username === 'khanh.tq' ? 'probation' : 'active',
    });
    if (role === 'MANAGER') managerOf[dept] = u.id;
    staffOut.push({ ...u, role, dept, gender: g });
  }
  // sau khi có manager mới, gán lại direct_manager cho nhân viên cùng phòng
  for (const row of users) {
    const s = staffOut.find((x) => x.id === row.id);
    if (s && (s.role === 'EMPLOYEE' || s.role === 'GUARD')) row.direct_manager_id = managerOf[s.dept] ?? null;
  }

  // --- Giảng viên ---
  const teacherOut = [];
  let gv = 101;
  for (const [name, username, title] of TEACHERS) {
    const u = addUser({
      role: 'TEACHER', name, username, dept: 'IT', title,
      code: `GV${gv++}`, email: `${username}@savp.edu.vn`,
      phone: `09${String(20000000 + nU * 91337).slice(0, 8)}`,
      faceGroup: 'teacherF', manager: managerOf.IT,
    });
    teacherOut.push(u);
  }

  // --- Sinh viên ---
  const studentOut = [];
  let sv = 1;
  for (const [g, name] of STUDENTS) {
    const code = `HE19${String(sv).padStart(4, '0')}`;
    const u = addUser({
      role: 'STUDENT', name, username: code.toLowerCase(), dept: 'IT', title: 'Sinh viên',
      code, email: `${code.toLowerCase()}@student.savp.edu.vn`,
      phone: `03${String(30000000 + nU * 77123).slice(0, 8)}`,
      faceGroup: g === 'F' ? 'studentF' : 'studentM',
      account: sv === 11 ? 'pending_reset' : 'active',
    });
    studentOut.push({ ...u, gender: g });
    sv++;
  }

  const n = {};
  n.users = await insert(c, 'users', users);
  n.user_roles = await insert(c, 'user_roles', userRoles);
  n.media_files = await insert(c, 'media_files', mediaRows);
  n.face_profiles = await insert(c, 'face_profiles', faceRows);

  out.staff = staffOut;
  out.teachers = teacherOut;
  out.students = studentOut;
  out.managerOf = managerOf;
  out.mediaCounter = nM;
  return n;
}
