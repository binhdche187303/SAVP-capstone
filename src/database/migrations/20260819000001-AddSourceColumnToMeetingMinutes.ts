import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSourceColumnToMeetingMinutes20260819000001 implements MigrationInterface {
  name = 'AddSourceColumnToMeetingMinutes20260819000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Add column as nullable first (safe for existing data)
    await queryRunner.query(
      `ALTER TABLE "meeting_minutes" ADD COLUMN IF NOT EXISTS "source" varchar(10)`,
    );

    // Step 2: Backfill — ai_summary_json IS NULL → 'manual', otherwise → 'ai'
    await queryRunner.query(
      `UPDATE "meeting_minutes" SET "source" = CASE WHEN "ai_summary_json" IS NULL THEN 'manual' ELSE 'ai' END`,
    );

    // Step 3: Set NOT NULL after backfill
    await queryRunner.query(
      `ALTER TABLE "meeting_minutes" ALTER COLUMN "source" SET NOT NULL`,
    );

    // Step 4: Create partial unique index — at most 1 active per (meeting_id, source)
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ux_meeting_minutes_meeting_source_active" ON "meeting_minutes" ("meeting_id", "source") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ux_meeting_minutes_meeting_source_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_minutes" DROP COLUMN "source"`,
    );
  }
}
