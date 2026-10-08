import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * feat-manual-minutes-content-format: them cot content_format cho phep nguoi
 * soan bien ban thu cong chon viet theo "trang trang" (blank) hoac "template"
 * (structured — decisions/action items nhu hien tai). Default 'template' de
 * khop hanh vi cu (bien ban AI luon la 'template', bien ban thu cong da tao
 * truoc migration nay cung duoc coi la 'template').
 */
export class AddContentFormatColumnToMeetingMinutes20260819000003
  implements MigrationInterface
{
  name = 'AddContentFormatColumnToMeetingMinutes20260819000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meeting_minutes" ADD COLUMN IF NOT EXISTS "content_format" varchar(20) NOT NULL DEFAULT 'template'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meeting_minutes" DROP COLUMN "content_format"`,
    );
  }
}
