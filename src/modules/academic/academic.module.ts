import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SemesterEntity } from './entities/semester.entity.js';
import { SubjectEntity } from './entities/subject.entity.js';
import { StudyShiftEntity } from './entities/study-shift.entity.js';
import { StudentEntity } from './entities/student.entity.js';
import { ClassSectionEntity } from './entities/class-section.entity.js';
import { ClassEnrollmentEntity } from './entities/class-enrollment.entity.js';
import { ClassSessionEntity } from './entities/class-session.entity.js';

/**
 * AcademicModule (ACD-001) — SCHEMA-ONLY: chỉ đăng ký entity Học vụ (R13, R14).
 * KHÔNG controller/provider — nghiệp vụ (CRUD/import, điểm danh theo ca #23) làm ở task sau.
 * Mirror ZonesModule. Module khác dùng entity Học vụ thì import AcademicModule (ADR-003).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SemesterEntity,
      SubjectEntity,
      StudyShiftEntity,
      StudentEntity,
      ClassSectionEntity,
      ClassEnrollmentEntity,
      ClassSessionEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class AcademicModule {}
