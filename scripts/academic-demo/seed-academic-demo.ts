import { QueryRunner } from 'typeorm';
import { buildSessionTimes } from '../../src/modules/academic/utils/session-time.util.js';

/**
 * ACD-001 R11/R12 — dữ liệu DEMO Học vụ (KHÔNG phải migration, D10). Idempotent: mọi INSERT có
 * WHERE NOT EXISTS theo mã tự nhiên → chạy lại không nhân đôi. Không tự mở transaction —
 * caller (runner CLI hoặc test) quản lý.
 *
 * Dữ liệu: học kỳ FA26; môn PRN211/SWP391/MAE101; GV gv.demo; SV HE180001..HE180010;
 * phòng ACD-R101/ACD-R102 (training_room); lớp SE1801 (PRN211, R101, T2/T4 SLOT1, SV 1-6)
 * và SE1802 (SWP391, R102, T3/T5 SLOT2, SV 5-10); buổi học 2 tuần đầu kỳ.
 * Mật khẩu demo chung "Abcd1234@" (cùng hash với 20260720000003-SeedDemoUsers.ts).
 */
export const DEMO_PASSWORD_HASH =
  '$2b$10$szGAzI6OAO0nxSI4OSsCuuwQVvan0AJW2XjzvMlHb2VeNGgBusgm6';

async function idOf(
  runner: QueryRunner,
  sql: string,
  params: unknown[],
): Promise<string> {
  const rows = (await runner.query(sql, params)) as Array<{ id: string }>;
  if (!rows[0])
    throw new Error(`Không tìm thấy bản ghi: ${sql} ${JSON.stringify(params)}`);
  return rows[0].id;
}

async function ensureUser(
  runner: QueryRunner,
  username: string,
  fullName: string,
  position: string,
): Promise<string> {
  const email = `${username}@demo.savp.edu.vn`;
  await runner.query(
    `INSERT INTO users (username, email, password_hash, full_name, position_title,
                        employment_status, account_status, must_change_password)
     SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, 'active', 'active', false
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2))`,
    [username, email, DEMO_PASSWORD_HASH, fullName, position],
  );
  return idOf(
    runner,
    `SELECT id FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL`,
    [username],
  );
}

async function ensureRoom(
  runner: QueryRunner,
  code: string,
  name: string,
): Promise<string> {
  await runner.query(
    `INSERT INTO rooms (room_code, room_name, capacity, room_type, site_name)
     SELECT $1::varchar, $2::varchar, 40, 'training_room', 'Demo Học vụ'
     WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE room_code = $1 AND deleted_at IS NULL)`,
    [code, name],
  );
  return idOf(
    runner,
    `SELECT id FROM rooms WHERE room_code = $1 AND deleted_at IS NULL`,
    [code],
  );
}

const SUBJECTS: Array<[code: string, name: string, credits: number]> = [
  ['PRN211', 'Basic Cross-Platform Application Programming With .NET', 3],
  ['SWP391', 'Software development project', 3],
  ['MAE101', 'Mathematics for Engineering', 3],
];

const STUDENT_NAMES = [
  'Nguyễn Văn An',
  'Trần Thị Bình',
  'Lê Hoàng Cường',
  'Phạm Thu Dung',
  'Hoàng Minh Đức',
  'Vũ Ngọc Hà',
  'Đặng Quốc Huy',
  'Bùi Thanh Lan',
  'Đỗ Gia Long',
  'Ngô Bảo Ngọc',
];

interface SectionPlan {
  classCode: string;
  subjectCode: string;
  roomCode: string;
  shiftCode: string;
  dates: string[];
  studentNos: number[];
}

const SECTIONS: SectionPlan[] = [
  {
    classCode: 'SE1801',
    subjectCode: 'PRN211',
    roomCode: 'ACD-R101',
    shiftCode: 'SLOT1',
    dates: ['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16'], // T2, T4
    studentNos: [1, 2, 3, 4, 5, 6],
  },
  {
    classCode: 'SE1802',
    subjectCode: 'SWP391',
    roomCode: 'ACD-R102',
    shiftCode: 'SLOT2',
    dates: ['2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17'], // T3, T5
    studentNos: [5, 6, 7, 8, 9, 10],
  },
];

export async function seedAcademicDemo(runner: QueryRunner): Promise<void> {
  // Học kỳ
  await runner.query(
    `INSERT INTO semesters (semester_code, semester_name, academic_year, start_date, end_date, status)
     SELECT 'FA26', 'Fall 2026', '2026-2027', '2026-09-07', '2026-12-20', 'ongoing'
     WHERE NOT EXISTS (SELECT 1 FROM semesters WHERE semester_code = 'FA26' AND deleted_at IS NULL)`,
  );
  const semesterId = await idOf(
    runner,
    `SELECT id FROM semesters WHERE semester_code = 'FA26' AND deleted_at IS NULL`,
    [],
  );

  // Môn học
  for (const [code, name, credits] of SUBJECTS) {
    await runner.query(
      `INSERT INTO subjects (subject_code, subject_name, credits)
       SELECT $1::varchar, $2::varchar, $3::smallint
       WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE subject_code = $1 AND deleted_at IS NULL)`,
      [code, name, credits],
    );
  }

  // Giảng viên + sinh viên (mỗi SV 1 tài khoản users — D3)
  const lecturerId = await ensureUser(
    runner,
    'gv.demo',
    'Giảng viên Demo',
    'Giảng viên',
  );
  const studentIds = new Map<number, string>();
  for (let i = 1; i <= 10; i++) {
    const code = `HE18${String(i).padStart(4, '0')}`; // HE180001..HE180010
    const userId = await ensureUser(
      runner,
      code.toLowerCase(),
      STUDENT_NAMES[i - 1],
      'Sinh viên',
    );
    await runner.query(
      `INSERT INTO students (user_id, student_code, cohort, major, administrative_class)
       SELECT $1::uuid, $2::varchar, 'K18', 'Kỹ thuật phần mềm', 'SE18'
       WHERE NOT EXISTS (SELECT 1 FROM students WHERE student_code = $2 AND deleted_at IS NULL)`,
      [userId, code],
    );
    studentIds.set(
      i,
      await idOf(
        runner,
        `SELECT id FROM students WHERE student_code = $1 AND deleted_at IS NULL`,
        [code],
      ),
    );
  }

  // Lớp học phần + danh sách lớp + buổi học
  for (const plan of SECTIONS) {
    const roomId = await ensureRoom(
      runner,
      plan.roomCode,
      `Phòng học ${plan.roomCode.slice(4)}`,
    );
    const subjectId = await idOf(
      runner,
      `SELECT id FROM subjects WHERE subject_code = $1 AND deleted_at IS NULL`,
      [plan.subjectCode],
    );
    await runner.query(
      `INSERT INTO class_sections (class_code, semester_id, subject_id, lecturer_user_id, default_room_id, max_students, status)
       SELECT $1::varchar, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 30, 'open'
       WHERE NOT EXISTS (
         SELECT 1 FROM class_sections
          WHERE semester_id = $2 AND subject_id = $3 AND class_code = $1 AND deleted_at IS NULL)`,
      [plan.classCode, semesterId, subjectId, lecturerId, roomId],
    );
    const sectionId = await idOf(
      runner,
      `SELECT id FROM class_sections
        WHERE semester_id = $1 AND subject_id = $2 AND class_code = $3 AND deleted_at IS NULL`,
      [semesterId, subjectId, plan.classCode],
    );

    for (const no of plan.studentNos) {
      await runner.query(
        `INSERT INTO class_enrollments (class_section_id, student_id)
         VALUES ($1, $2) ON CONFLICT ("class_section_id", "student_id") DO NOTHING`,
        [sectionId, studentIds.get(no)],
      );
    }

    const [shift] = (await runner.query(
      `SELECT id, start_time::text AS start_time, end_time::text AS end_time
         FROM study_shifts WHERE shift_code = $1 AND deleted_at IS NULL`,
      [plan.shiftCode],
    )) as Array<{ id: string; start_time: string; end_time: string }>;
    if (!shift)
      throw new Error(
        `Thiếu ca ${plan.shiftCode} — chạy migration SeedStudyShifts trước`,
      );

    for (const [idx, date] of plan.dates.entries()) {
      const { startTime, endTime } = buildSessionTimes(
        date,
        shift.start_time,
        shift.end_time,
      );
      await runner.query(
        `INSERT INTO class_sessions (class_section_id, session_no, session_date, shift_id, room_id, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("class_section_id", "session_date", "shift_id") DO NOTHING`,
        [sectionId, idx + 1, date, shift.id, roomId, startTime, endTime],
      );
    }
  }
}
