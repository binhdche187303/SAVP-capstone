import { AppDataSource } from '../../src/database/data-source';
import { SemesterEntity } from '../../src/modules/academic/entities/semester.entity';
import { SubjectEntity } from '../../src/modules/academic/entities/subject.entity';
import { StudyShiftEntity } from '../../src/modules/academic/entities/study-shift.entity';
import { StudentEntity } from '../../src/modules/academic/entities/student.entity';
import { ClassSectionEntity } from '../../src/modules/academic/entities/class-section.entity';
import { ClassEnrollmentEntity } from '../../src/modules/academic/entities/class-enrollment.entity';
import { ClassSessionEntity } from '../../src/modules/academic/entities/class-session.entity';

/** ACD-001 R13 — entity map 1-1 với DDL (tên cột + nullable); date/time đọc ra là string. */
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

const ENTITIES = [
  SemesterEntity,
  SubjectEntity,
  StudyShiftEntity,
  StudentEntity,
  ClassSectionEntity,
  ClassEnrollmentEntity,
  ClassSessionEntity,
];

describeDb('ACD-001 academic entities ↔ schema', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });
  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it.each(ENTITIES.map((e) => [e.name, e]))(
    '%s: cột + nullable khớp DB',
    async (_name, entity) => {
      const meta = AppDataSource.getMetadata(entity);
      const dbCols: Array<{ column_name: string; is_nullable: 'YES' | 'NO' }> =
        await AppDataSource.query(
          `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
          [meta.tableName],
        );
      const fromDb = Object.fromEntries(
        dbCols.map((c) => [c.column_name, c.is_nullable === 'YES']),
      );
      const fromEntity = Object.fromEntries(
        meta.columns.map((c) => [c.databaseName, c.isNullable]),
      );
      expect(fromEntity).toEqual(fromDb);
    },
  );

  it('date/time đọc qua repository là string (không lệch múi giờ)', async () => {
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const repo = qr.manager.getRepository(SemesterEntity);
      const saved = await repo.save(
        repo.create({
          semesterCode: `E2E-${Date.now()}`,
          semesterName: 'Entity test',
          startDate: '2026-09-07',
          endDate: '2026-12-20',
        }),
      );
      const found = await repo.findOneByOrFail({ id: saved.id });
      expect(found.startDate).toBe('2026-09-07');
      expect(found.status).toBe('upcoming');

      const shift = await qr.manager
        .getRepository(StudyShiftEntity)
        .findOneByOrFail({ shiftCode: 'SLOT1' });
      expect(shift.startTime).toBe('07:30:00');
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});
