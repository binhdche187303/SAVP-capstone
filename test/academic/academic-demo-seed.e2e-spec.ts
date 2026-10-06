import { AppDataSource } from '../../src/database/data-source';
import { seedAcademicDemo } from '../../scripts/academic-demo/seed-academic-demo';

/** ACD-001 R11/R12 — demo idempotent + truy vấn khớp camera §4.1 trả đúng 1 buổi. */
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

const COUNT_SQL = `SELECT
  (SELECT count(*) FROM semesters WHERE semester_code = 'FA26')::int AS semesters,
  (SELECT count(*) FROM subjects WHERE subject_code IN ('PRN211','SWP391','MAE101'))::int AS subjects,
  (SELECT count(*) FROM students WHERE student_code LIKE 'HE1800%')::int AS students,
  (SELECT count(*) FROM class_sections cs JOIN semesters s ON s.id = cs.semester_id WHERE s.semester_code = 'FA26')::int AS sections,
  (SELECT count(*) FROM class_enrollments ce JOIN students st ON st.id = ce.student_id WHERE st.student_code LIKE 'HE1800%')::int AS enrollments,
  (SELECT count(*) FROM class_sessions cs JOIN class_sections c ON c.id = cs.class_section_id
     JOIN semesters s ON s.id = c.semester_id WHERE s.semester_code = 'FA26')::int AS sessions`;

describeDb('ACD-001 academic demo seed', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });
  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('chạy 2 lần → số bản ghi không đổi; §4.1 khớp đúng 1 buổi', async () => {
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await seedAcademicDemo(qr);
      const [first] = (await qr.query(COUNT_SQL)) as Array<
        Record<string, number>
      >;
      expect(first).toEqual({
        semesters: 1,
        subjects: 3,
        students: 10,
        sections: 2,
        enrollments: 12,
        sessions: 8,
      });

      await seedAcademicDemo(qr);
      const [second] = (await qr.query(COUNT_SQL)) as Array<
        Record<string, number>
      >;
      expect(second).toEqual(first);

      // §4.1: camera phòng ACD-R101, 07:35 VN ngày 2026-09-07, SV HE180001 → buổi SE1801 PRN211
      const rows = (await qr.query(
        `SELECT c.class_code, cs.session_date::text AS session_date
           FROM class_sessions cs
           JOIN class_sections c ON c.id = cs.class_section_id
           JOIN class_enrollments ce ON ce.class_section_id = cs.class_section_id AND ce.status = 'active'
           JOIN students s ON s.id = ce.student_id AND s.deleted_at IS NULL
           JOIN rooms r ON r.id = cs.room_id
          WHERE r.room_code = 'ACD-R101'
            AND cs.status <> 'cancelled'
            AND $1::timestamptz BETWEEN cs.start_time - interval '15 minutes' AND cs.end_time
            AND s.student_code = 'HE180001'`,
        ['2026-09-07T07:35:00+07:00'],
      )) as Array<{ class_code: string; session_date: string }>;
      expect(rows).toEqual([
        { class_code: 'SE1801', session_date: '2026-09-07' },
      ]);
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});
