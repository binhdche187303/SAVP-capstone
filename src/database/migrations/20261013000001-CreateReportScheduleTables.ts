import { MigrationInterface, QueryRunner } from 'typeorm';

/** RPT-CENTER-BE-001 §6.1 — lịch gửi báo cáo và lịch sử lần chạy. */
export class CreateReportScheduleTables20261013000001 implements MigrationInterface {
  name = 'CreateReportScheduleTables20261013000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "report_schedules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(150) NOT NULL,
        "report_type" varchar(40) NOT NULL,
        "filters_json" jsonb NOT NULL DEFAULT '{}',
        "period" varchar(20) NOT NULL,
        "frequency" varchar(20) NOT NULL,
        "send_time" time NOT NULL,
        "day_of_week" smallint,
        "day_of_month" smallint,
        "last_day_of_month" boolean NOT NULL DEFAULT false,
        "formats" text[] NOT NULL,
        "recipients_json" jsonb NOT NULL DEFAULT '[]',
        "subject" varchar(200),
        "message" text,
        "enabled" boolean NOT NULL DEFAULT true,
        "next_run_at" timestamptz,
        "last_run_at" timestamptz,
        "owner_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_report_schedules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_report_schedules_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_report_schedules_period" CHECK ("period" IN ('yesterday','last_week','last_month')),
        CONSTRAINT "CK_report_schedules_frequency" CHECK ("frequency" IN ('daily','weekly','monthly')),
        CONSTRAINT "CK_report_schedules_dow" CHECK ("day_of_week" IS NULL OR "day_of_week" BETWEEN 0 AND 6),
        CONSTRAINT "CK_report_schedules_dom" CHECK ("day_of_month" IS NULL OR "day_of_month" BETWEEN 1 AND 28)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_report_schedules_due" ON "report_schedules" ("next_run_at") WHERE "enabled" = true AND "deleted_at" IS NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_report_schedules_owner" ON "report_schedules" ("owner_user_id") WHERE "deleted_at" IS NULL`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "report_schedule_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "schedule_id" uuid NOT NULL,
        "schedule_name" varchar(150) NOT NULL,
        "report_type" varchar(40) NOT NULL,
        "trigger" varchar(12) NOT NULL,
        "status" varchar(12) NOT NULL DEFAULT 'queued',
        "scheduled_for" timestamptz,
        "period_from" date NOT NULL,
        "period_to" date NOT NULL,
        "formats" text[] NOT NULL,
        "recipient_count" int NOT NULL DEFAULT 0,
        "output_file_ids" uuid[] NOT NULL DEFAULT '{}',
        "error_message" text,
        "retried_by_run_id" uuid,
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_report_schedule_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_report_schedule_runs_schedule" FOREIGN KEY ("schedule_id") REFERENCES "report_schedules" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_report_schedule_runs_trigger" CHECK ("trigger" IN ('scheduled','manual')),
        CONSTRAINT "CK_report_schedule_runs_status" CHECK ("status" IN ('queued','running','success','failed'))
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_report_schedule_runs_slot" ON "report_schedule_runs" ("schedule_id", "scheduled_for") WHERE "trigger" = 'scheduled'`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_report_schedule_runs_schedule_created" ON "report_schedule_runs" ("schedule_id", "created_at" DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_report_schedule_runs_status_created" ON "report_schedule_runs" ("status", "created_at" DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "report_schedule_runs"`);
    await q.query(`DROP TABLE IF EXISTS "report_schedules"`);
  }
}
