// test/academic/academic-schema.e2e-spec.ts
import { QueryRunner } from 'typeorm';
import { AppDataSource } from '../../src/database/data-source';

/**
 * ACD-001 — kiểm chứng ràng buộc DB R3–R10 trên Postgres local.
 * Chạy: RUN_DB_TESTS=1 npx jest --config ./test/jest-e2e.json test/academic --runInBand
 * Mỗi test chạy trong transaction và rollback — không để lại dữ liệu.
 */
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('ACD-001 academic schema constraints', () => {
  let qr: QueryRunner;

  beforeAll(async () => {
    await AppDataSource.initialize();
  });
  afterAll(async () => {
    await AppDataSource.destroy();
  });
  beforeEach(async () => {
    qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
  });
  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  /** Chạy SQL trong savepoint; trả mã lỗi Postgres (vd '23505') hoặc undefined nếu thành công. */
  async function pgError(
    sql: string,
    params: unknown[] = [],
  ): Promise<string | undefined> {
    await qr.query('SAVEPOINT t');
    try {
      await qr.query(sql, params);
      await qr.query('RELEASE SAVEPOINT t');
      return undefined;
    } catch (e) {
      await qr.query('ROLLBACK TO SAVEPOINT t');
      const err = e as { code?: string; driverError?: { code?: string } };
      return err.driverError?.code ?? err.code;
    }
  }

  async function one(sql: string, params: unknown[] = []): Promise<string> {
    const rows = (await qr.query(sql, params)) as Array<{ id: string }>;
    return rows[0].id;
  }

  const sfx = () => Math.random().toString(36).slice(2, 10);

  interface Fixture {
    deptId: string;
    userId: string;
    roomId: string;
    semesterId: string;
    subjectId: string;
    shiftId: string;
    studentId: string;
    sectionId: string;
  }

  async function fixture(): Promise<Fixture> {
    const s = sfx();
    const deptId = await one(
      `INSERT INTO departments (department_code, department_name) VALUES ($1, $2) RETURNING id`,
      [`T-${s}`, `Test dept ${s}`],
    );
    const userId = await one(
      `INSERT INTO users (username, email, password_hash, full_name)
       VALUES ($1, $2, 'x', 'Test SV') RETURNING id`,
      [`t_${s}`, `t_${s}@test.local`],
    );
    const roomId = await one(
      `INSERT INTO rooms (room_code, room_name, capacity, room_type)
       VALUES ($1, $2, 40, 'training_room') RETURNING id`,
      [`R-${s}`, `Room ${s}`],
    );
    const semesterId = await one(
      `INSERT INTO semesters (semester_code, semester_name, start_date, end_date)
       VALUES ($1, 'Test sem', '2026-09-07', '2026-12-20') RETURNING id`,
      [`S-${s}`],
    );
    const subjectId = await one(
      `INSERT INTO subjects (subject_code, subject_name, credits, department_id)
       VALUES ($1, 'Test subject', 3, $2) RETURNING id`,
      [`SB-${s}`, deptId],
    );
    const shiftId = await one(
      `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
       VALUES ($1, 'Test shift', 99, '07:30', '09:50') RETURNING id`,
      [`SH-${s}`],
    );
    const studentId = await one(
      `INSERT INTO students (user_id, student_code, department_id) VALUES ($1, $2, $3) RETURNING id`,
      [userId, `HE-${s}`, deptId],
    );
    const sectionId = await one(
      `INSERT INTO class_sections (class_code, semester_id, subject_id, lecturer_user_id, default_room_id, max_students)
       VALUES ('SE1801', $1, $2, $3, $4, 30) RETURNING id`,
      [semesterId, subjectId, userId, roomId],
    );
    return {
      deptId,
      userId,
      roomId,
      semesterId,
      subjectId,
      shiftId,
      studentId,
      sectionId,
    };
  }

  const insertSession = (
    f: Fixture,
    date = '2026-09-07',
    roomId = f.roomId,
    sectionId = f.sectionId,
  ) =>
    pgError(
      `INSERT INTO class_sessions (class_section_id, session_no, session_date, shift_id, room_id, start_time, end_time)
       VALUES ($1, 1, $2, $3, $4, ($2::date + time '07:30') AT TIME ZONE 'Asia/Ho_Chi_Minh',
                                  ($2::date + time '09:50') AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
      [sectionId, date, f.shiftId, roomId],
    );

  it('happy path: fixture + enrollment + session insert được', async () => {
    const f = await fixture();
    expect(
      await pgError(
        `INSERT INTO class_enrollments (class_section_id, student_id) VALUES ($1, $2)`,
        [f.sectionId, f.studentId],
      ),
    ).toBeUndefined();
    expect(await insertSession(f)).toBeUndefined();
  });

  describe('R3 — mã trùng đang sống bị chặn, tái dùng sau soft-delete', () => {
    it('semester_code trùng → 23505; soft-delete rồi tạo lại → OK', async () => {
      const f = await fixture();
      const [{ semester_code: code }] = (await qr.query(
        `SELECT semester_code FROM semesters WHERE id = $1`,
        [f.semesterId],
      )) as Array<{ semester_code: string }>;
      const dup = `INSERT INTO semesters (semester_code, semester_name, start_date, end_date)
                   VALUES ($1, 'Dup', '2026-01-01', '2026-02-01')`;
      expect(await pgError(dup, [code])).toBe('23505');
      await qr.query(`UPDATE semesters SET deleted_at = now() WHERE id = $1`, [
        f.semesterId,
      ]);
      expect(await pgError(dup, [code])).toBeUndefined();
    });

    it('subject_code trùng → 23505', async () => {
      const f = await fixture();
      expect(
        await pgError(
          `INSERT INTO subjects (subject_code, subject_name)
           SELECT subject_code, 'Dup' FROM subjects WHERE id = $1`,
          [f.subjectId],
        ),
      ).toBe('23505');
    });

    it('shift_code trùng → 23505; shift_order trùng → 23505', async () => {
      const f = await fixture();
      expect(
        await pgError(
          `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
           SELECT shift_code, 'Dup', 98, '10:00', '11:00' FROM study_shifts WHERE id = $1`,
          [f.shiftId],
        ),
      ).toBe('23505');
      expect(
        await pgError(
          `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
           VALUES ($1, 'Dup order', 99, '10:00', '11:00')`,
          [`SH-${sfx()}`],
        ),
      ).toBe('23505');
    });

    it('student_code trùng → 23505; cùng user_id 2 hồ sơ → 23505', async () => {
      const f = await fixture();
      const otherUser = await one(
        `INSERT INTO users (username, email, password_hash, full_name) VALUES ($1, $2, 'x', 'U2') RETURNING id`,
        [`u2_${sfx()}`, `u2_${sfx()}@test.local`],
      );
      expect(
        await pgError(
          `INSERT INTO students (user_id, student_code)
           SELECT $2, student_code FROM students WHERE id = $1`,
          [f.studentId, otherUser],
        ),
      ).toBe('23505');
      expect(
        await pgError(
          `INSERT INTO students (user_id, student_code) VALUES ($1, $2)`,
          [f.userId, `HE-${sfx()}`],
        ),
      ).toBe('23505');
    });

    it('(semester, subject, class_code) trùng → 23505', async () => {
      const f = await fixture();
      expect(
        await pgError(
          `INSERT INTO class_sections (class_code, semester_id, subject_id) VALUES ('SE1801', $1, $2)`,
          [f.semesterId, f.subjectId],
        ),
      ).toBe('23505');
    });
  });

  describe('R4 — CHECK giá trị', () => {
    it('semester end_date < start_date → 23514', async () => {
      expect(
        await pgError(
          `INSERT INTO semesters (semester_code, semester_name, start_date, end_date)
           VALUES ($1, 'Bad', '2026-12-01', '2026-11-01')`,
          [`S-${sfx()}`],
        ),
      ).toBe('23514');
    });

    it('shift end_time <= start_time → 23514', async () => {
      expect(
        await pgError(
          `INSERT INTO study_shifts (shift_code, shift_name, shift_order, start_time, end_time)
           VALUES ($1, 'Bad', 97, '09:50', '09:50')`,
          [`SH-${sfx()}`],
        ),
      ).toBe('23514');
    });

    it('session end_time <= start_time → 23514', async () => {
      const f = await fixture();
      expect(
        await pgError(
          `INSERT INTO class_sessions (class_section_id, session_date, shift_id, room_id, start_time, end_time)
           VALUES ($1, '2026-09-07', $2, $3, '2026-09-07T03:00:00Z', '2026-09-07T02:00:00Z')`,
          [f.sectionId, f.shiftId, f.roomId],
        ),
      ).toBe('23514');
    });

    it('credits < 0 → 23514; max_students = 0 → 23514', async () => {
      const f = await fixture();
      expect(
        await pgError(
          `INSERT INTO subjects (subject_code, subject_name, credits) VALUES ($1, 'Bad', -1)`,
          [`SB-${sfx()}`],
        ),
      ).toBe('23514');
      expect(
        await pgError(
          `INSERT INTO class_sections (class_code, semester_id, subject_id, max_students) VALUES ('SE9999', $1, $2, 0)`,
          [f.semesterId, f.subjectId],
        ),
      ).toBe('23514');
    });
  });

  describe('R5 — status ngoài tập cho phép → 23514', () => {
    it.each([
      ['semesters', 'status'],
      ['students', 'study_status'],
      ['class_sections', 'status'],
      ['class_enrollments', 'status'],
      ['class_sessions', 'status'],
    ])('%s.%s = "bogus"', async (table, col) => {
      const f = await fixture();
      await qr.query(
        `INSERT INTO class_enrollments (class_section_id, student_id) VALUES ($1, $2)`,
        [f.sectionId, f.studentId],
      );
      await insertSession(f);
      // cập nhật 1 dòng bất kỳ của bảng thuộc fixture này
      expect(
        await pgError(
          `UPDATE ${table} SET ${col} = 'bogus' WHERE id = (SELECT id FROM ${table} ORDER BY created_at DESC LIMIT 1)`,
        ),
      ).toBe('23514');
    });
  });

  it('R6 — 1 sinh viên 2 lần trong cùng lớp → 23505', async () => {
    const f = await fixture();
    const sql = `INSERT INTO class_enrollments (class_section_id, student_id) VALUES ($1, $2)`;
    expect(await pgError(sql, [f.sectionId, f.studentId])).toBeUndefined();
    expect(await pgError(sql, [f.sectionId, f.studentId])).toBe('23505');
  });

  it('R7 — cùng lớp trùng (ngày, ca) → 23505', async () => {
    const f = await fixture();
    const otherRoom = await one(
      `INSERT INTO rooms (room_code, room_name, capacity) VALUES ($1, $2, 40) RETURNING id`,
      [`R2-${sfx()}`, `Room2 ${sfx()}`],
    );
    expect(await insertSession(f)).toBeUndefined();
    expect(await insertSession(f, '2026-09-07', otherRoom)).toBe('23505');
  });

  describe('R8 — trùng phòng cùng (ngày, ca)', () => {
    it('lớp khác cùng phòng/ngày/ca → 23505', async () => {
      const f = await fixture();
      const section2 = await one(
        `INSERT INTO class_sections (class_code, semester_id, subject_id) VALUES ('SE1802', $1, $2) RETURNING id`,
        [f.semesterId, f.subjectId],
      );
      expect(await insertSession(f)).toBeUndefined();
      expect(await insertSession(f, '2026-09-07', f.roomId, section2)).toBe(
        '23505',
      );
    });

    it('buổi cũ cancelled → phòng được giải phóng', async () => {
      const f = await fixture();
      const section2 = await one(
        `INSERT INTO class_sections (class_code, semester_id, subject_id) VALUES ('SE1802', $1, $2) RETURNING id`,
        [f.semesterId, f.subjectId],
      );
      expect(await insertSession(f)).toBeUndefined();
      await qr.query(
        `UPDATE class_sessions SET status = 'cancelled' WHERE class_section_id = $1`,
        [f.sectionId],
      );
      expect(
        await insertSession(f, '2026-09-07', f.roomId, section2),
      ).toBeUndefined();
    });
  });

  describe('R9 — FK', () => {
    it('xoá cứng học kỳ đang có lớp → 23503', async () => {
      const f = await fixture();
      expect(
        await pgError(`DELETE FROM semesters WHERE id = $1`, [f.semesterId]),
      ).toBe('23503');
    });

    it('xoá cứng khoa → subjects.department_id và students.department_id = NULL', async () => {
      const f = await fixture();
      await qr.query(`DELETE FROM departments WHERE id = $1`, [f.deptId]);
      const [subj] = (await qr.query(
        `SELECT department_id FROM subjects WHERE id = $1`,
        [f.subjectId],
      )) as Array<{ department_id: string | null }>;
      const [stu] = (await qr.query(
        `SELECT department_id FROM students WHERE id = $1`,
        [f.studentId],
      )) as Array<{ department_id: string | null }>;
      expect(subj.department_id).toBeNull();
      expect(stu.department_id).toBeNull();
    });
  });

  it('R10 — đã seed đúng 6 ca học cố định', async () => {
    const rows = (await qr.query(
      `SELECT shift_code, shift_order, start_time::text AS start_time, end_time::text AS end_time
           FROM study_shifts WHERE deleted_at IS NULL AND shift_code LIKE 'SLOT%' ORDER BY shift_order`,
    )) as Array<{
      shift_code: string;
      shift_order: number;
      start_time: string;
      end_time: string;
    }>;
    expect(rows).toEqual([
      {
        shift_code: 'SLOT1',
        shift_order: 1,
        start_time: '07:30:00',
        end_time: '09:50:00',
      },
      {
        shift_code: 'SLOT2',
        shift_order: 2,
        start_time: '10:00:00',
        end_time: '12:20:00',
      },
      {
        shift_code: 'SLOT3',
        shift_order: 3,
        start_time: '12:50:00',
        end_time: '15:10:00',
      },
      {
        shift_code: 'SLOT4',
        shift_order: 4,
        start_time: '15:20:00',
        end_time: '17:40:00',
      },
      {
        shift_code: 'SLOT5',
        shift_order: 5,
        start_time: '18:00:00',
        end_time: '20:20:00',
      },
      {
        shift_code: 'SLOT6',
        shift_order: 6,
        start_time: '20:30:00',
        end_time: '22:50:00',
      },
    ]);
  });
});
