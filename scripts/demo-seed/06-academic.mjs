// Giai đoạn D — học vụ: học kỳ, môn, sinh viên, lớp học phần, danh sách lớp, buổi học.
import { did, insert, rng, vnTime, addMin } from './lib.mjs';

const SUBJECTS = [
  ['PRN211', 'Lập trình ứng dụng đa nền tảng với .NET', 3], ['SWP391', 'Dự án phát triển phần mềm', 3],
  ['MAE101', 'Toán cho kỹ thuật', 3], ['DBI202', 'Cơ sở dữ liệu', 3], ['SSL101c', 'Kỹ năng học tập đại học', 3],
  ['PRJ301', 'Lập trình Java Web', 3],
];

// [mã lớp, môn, phòng, ca, thứ trong tuần (1=T2..5=T6), người dạy, trạng thái, danh sách chỉ số sinh viên]
const SECTIONS = [
  ['SE1901', 'PRN211', 'ACD-R101', 'SLOT1', [1, 3], 'gv0', 'open', [0, 1, 2, 3, 4, 5, 11]],
  ['SE1902', 'SWP391', 'ACD-R102', 'SLOT2', [2, 4], 'gv1', 'open', [2, 3, 4, 5, 6, 7, 11]],
  ['SE1903', 'DBI202', 'ACD-R103', 'SLOT3', [1, 4], 'gv1', 'open', [5, 6, 7, 8, 9, 10]],
  ['AI1901', 'MAE101', 'ACD-R101', 'SLOT4', [2, 5], 'demo', 'open', [0, 1, 8, 9, 10, 11]],
  ['SE1904', 'SSL101c', 'ACD-R102', 'SLOT1', [3, 5], 'gv0', 'planned', [0, 1, 2]],
];

export async function seedAcademic(ctx) {
  const { c, ref, out, now } = ctx;
  const R = rng(1357);
  const cutoff = out.cutoff;
  const n = {};
  const cnt = {};
  const id = (t) => did(t, (cnt[t] = (cnt[t] ?? 0) + 1));
  const dept = ref.dept['IT'];

  const sems = [
    ['FA26', 'Fall 2026', '2026-2027', '2026-09-07', '2026-12-20', 'ongoing'],
    ['SU26', 'Summer 2026', '2025-2026', '2026-05-11', '2026-08-30', 'closed'],
    ['SP27', 'Spring 2027', '2026-2027', '2027-01-11', '2027-04-25', 'upcoming'],
  ].map(([code, name, year, s, e, st]) => ({ id: id('semesters'), semester_code: code, semester_name: name, academic_year: year, start_date: s, end_date: e, status: st }));
  n.semesters = await insert(c, 'semesters', sems);
  const fa = sems[0];

  const subs = SUBJECTS.map(([code, name, cr]) => ({ id: id('subjects'), subject_code: code, subject_name: name, credits: cr, department_id: dept, is_active: true }));
  n.subjects = await insert(c, 'subjects', subs);
  const subjectId = Object.fromEntries(subs.map((s) => [s.subject_code, s.id]));

  // Sinh viên: 11 sinh viên mới + student.demo
  const stuUsers = [...out.students.map((s) => ({ userId: s.id, code: s.code, status: s.account === 'pending_reset' ? 'suspended' : 'studying' })),
    ...(ref.user['student.demo'] ? [{ userId: ref.user['student.demo'], code: 'HE190100', status: 'studying' }] : [])];
  const students = stuUsers.map((s, i) => ({
    id: id('students'), user_id: s.userId, student_code: s.code, cohort: 'K19', major: i % 4 === 3 ? 'Trí tuệ nhân tạo' : 'Kỹ thuật phần mềm',
    administrative_class: i % 4 === 3 ? 'AI1901' : 'SE1901', department_id: dept, study_status: s.status,
  }));
  n.students = await insert(c, 'students', students);

  const { rows: shiftRows } = await c.query(`SELECT shift_code, id, start_time::text AS st, end_time::text AS et FROM public.study_shifts WHERE deleted_at IS NULL`);
  const shift = Object.fromEntries(shiftRows.map((s) => [s.shift_code, s]));
  const lecturer = { gv0: out.teachers[0].id, gv1: out.teachers[1].id, demo: ref.user['teacher.demo'] ?? out.teachers[0].id };

  const sections = [], enrolls = [], sessions = [];
  SECTIONS.forEach(([code, subj, roomCode, shiftCode, dows, lec, status, stuIdx]) => {
    const sid = id('class_sections');
    sections.push({ id: sid, class_code: code, semester_id: fa.id, subject_id: subjectId[subj], lecturer_user_id: lecturer[lec], default_room_id: out.room[roomCode],
      max_students: 35, status, note: status === 'planned' ? 'Chờ mở lớp' : null });
    stuIdx.forEach((si, k) => {
      if (!students[si]) return;
      enrolls.push({ id: id('class_enrollments'), class_section_id: sid, student_id: students[si].id, enrolled_at: vnTime(-35, 9, k, now),
        status: k === stuIdx.length - 1 && status === 'open' ? 'dropped' : 'active', note: k === stuIdx.length - 1 && status === 'open' ? 'Rút lớp theo nguyện vọng' : null });
    });
    if (status !== 'open') return;
    const sh = shift[shiftCode];
    let no = 0;
    for (let off = -31; off <= 14; off++) {
      const d = vnTime(off, 12, 0, now);
      const vn = new Date(d.getTime() + 7 * 3600000);
      const dow = vn.getUTCDay();
      if (!dows.includes(dow)) continue;
      const dateStr = vn.toISOString().slice(0, 10);
      if (dateStr < fa.start_date) continue;
      const start = new Date(`${dateStr}T${sh.st}+07:00`);
      const end = new Date(`${dateStr}T${sh.et}+07:00`);
      no++;
      const st = +end <= +cutoff ? 'completed' : +start <= +cutoff ? 'ongoing' : 'scheduled';
      sessions.push({ id: id('class_sessions'), class_section_id: sid, session_no: no, session_date: dateStr, shift_id: sh.id, room_id: out.room[roomCode],
        start_time: start, end_time: end, status: no === 6 ? 'cancelled' : st, note: no === 6 ? 'Giảng viên bận, học bù tuần sau' : null });
    }
  });
  n.class_sections = await insert(c, 'class_sections', sections);
  n.class_enrollments = await insert(c, 'class_enrollments', enrolls);
  n.class_sessions = await insert(c, 'class_sessions', sessions);
  return n;
}
