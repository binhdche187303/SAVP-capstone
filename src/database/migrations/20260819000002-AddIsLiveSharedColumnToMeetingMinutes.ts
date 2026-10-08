import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MKM-LIVE-01 (feat-live-share-draft-minutes): them cot is_live_shared cho
 * phep Host bat/tat che do chia se truc tiep ban nhap. Default false ap
 * dung dung ngay cho toan bo du lieu cu (chua bao gio bat live-share).
 */
export class AddIsLiveSharedColumnToMeetingMinutes20260819000002 implements MigrationInterface {
  name = 'AddIsLiveSharedColumnToMeetingMinutes20260819000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meeting_minutes" ADD COLUMN IF NOT EXISTS "is_live_shared" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meeting_minutes" DROP COLUMN "is_live_shared"`,
    );
  }
}
