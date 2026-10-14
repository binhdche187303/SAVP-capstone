import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeparateSubjectAndClassSectionCodes20261014000002 implements MigrationInterface {
  name = 'SeparateSubjectAndClassSectionCodes20261014000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE class_sections cs
         SET class_code = cs.class_code || '-01',
             updated_at = now()
        FROM subjects subj
       WHERE subj.id = cs.subject_id
         AND cs.deleted_at IS NULL
         AND cs.class_code = subj.subject_code
         AND subj.subject_code IN ('WEB101', 'AI202', 'DB303')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE class_sections cs
         SET class_code = subj.subject_code,
             updated_at = now()
        FROM subjects subj
       WHERE subj.id = cs.subject_id
         AND cs.deleted_at IS NULL
         AND cs.class_code = subj.subject_code || '-01'
         AND subj.subject_code IN ('WEB101', 'AI202', 'DB303')
    `);
  }
}
