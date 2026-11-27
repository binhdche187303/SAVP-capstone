import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bậc đào tạo + loại hình đào tạo của SV (lấy từ lớp hành chính UEL: bac_dao_tao, loai_hinh_dao_tao)
 * để hiển thị trên hồ sơ cá nhân sinh viên.
 */
export class AddStudentTrainingInfo20261127000001 implements MigrationInterface {
  name = 'AddStudentTrainingInfo20261127000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "education_level" varchar(50) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "training_type" varchar(100) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN IF EXISTS "training_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN IF EXISTS "education_level"`,
    );
  }
}
