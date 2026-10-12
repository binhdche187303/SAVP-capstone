import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * VIS-BE-001 (2.10) — 5 bảng của phân hệ Khách đến làm việc.
 * Spec: spec/features/visitors/feat-visitor-management-be/spec.md §4.
 * ADD-ONLY: chỉ tạo bảng mới, FK trỏ tới users/zones/departments/iot_device_events/media_files.
 * Enum = varchar + CHECK. Xóa mềm cho visitors/visitor_visits; bảng sự kiện chỉ ghi thêm (DATA-01).
 */
export class CreateVisitorTables20261012000001 implements MigrationInterface {
  name = 'CreateVisitorTables20261012000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "visitors" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "full_name" varchar(150) NOT NULL,
        "id_number" varchar(30),
        "phone_number" varchar(20) NOT NULL,
        "email" varchar(255),
        "organization" varchar(200),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_visitors_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_visitors_user" UNIQUE ("user_id"),
        CONSTRAINT "FK_visitors_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_visitors_id_number" ON "visitors" ("id_number") WHERE "id_number" IS NOT NULL AND "deleted_at" IS NULL`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_visitors_phone_no_id" ON "visitors" ("phone_number") WHERE "id_number" IS NULL AND "deleted_at" IS NULL`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "visitor_visits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "visit_code" varchar(16) NOT NULL,
        "visitor_id" uuid NOT NULL,
        "channel" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL,
        "host_user_id" uuid NOT NULL,
        "department_id" uuid,
        "purpose" varchar(120) NOT NULL,
        "companions" smallint NOT NULL DEFAULT 0,
        "plate_number" varchar(16),
        "scheduled_from" timestamptz NOT NULL,
        "scheduled_to" timestamptz NOT NULL,
        "valid_from" timestamptz NOT NULL,
        "valid_to" timestamptz NOT NULL,
        "check_in_at" timestamptz,
        "check_out_at" timestamptz,
        "face_score" numeric(5,4),
        "reject_reason" text,
        "revoked_at" timestamptz,
        "manual_exit" boolean NOT NULL DEFAULT false,
        "not_found" boolean NOT NULL DEFAULT false,
        "overstay_notified_at" timestamptz,
        "overstay_escalated_at" timestamptz,
        "last_seen_at" timestamptz,
        "last_seen_zone_id" uuid,
        "consent_at" timestamptz,
        "photo_file_id" uuid,
        "created_by" uuid,
        "approved_by" uuid,
        "approved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_visitor_visits_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_visitor_visits_code" UNIQUE ("visit_code"),
        CONSTRAINT "CK_visitor_visits_schedule" CHECK ("scheduled_to" > "scheduled_from" AND "valid_to" > "valid_from"),
        CONSTRAINT "CK_visitor_visits_channel" CHECK ("channel" IN ('online','host_invite','walk_in')),
        CONSTRAINT "CK_visitor_visits_status" CHECK ("status" IN ('pending_approval','approved','checked_in','checked_out','rejected','cancelled','revoked','expired','must_leave','exit_unrecorded')),
        CONSTRAINT "FK_visitor_visits_visitor" FOREIGN KEY ("visitor_id") REFERENCES "visitors" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_visitor_visits_host" FOREIGN KEY ("host_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_visitor_visits_department" FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_visitor_visits_last_zone" FOREIGN KEY ("last_seen_zone_id") REFERENCES "zones" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_visitor_visits_photo" FOREIGN KEY ("photo_file_id") REFERENCES "media_files" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_visitor_visits_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_visitor_visits_approved_by" FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_visitor_visits_status_from" ON "visitor_visits" ("status", "scheduled_from")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_visitor_visits_host_status" ON "visitor_visits" ("host_user_id", "status")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_visitor_visits_visitor_from" ON "visitor_visits" ("visitor_id", "scheduled_from" DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_visitor_visits_dept_from" ON "visitor_visits" ("department_id", "scheduled_from")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_visitor_visits_active_valid_to" ON "visitor_visits" ("valid_to") WHERE "status" IN ('approved','checked_in','must_leave')`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "visitor_visit_zones" (
        "visit_id" uuid NOT NULL,
        "zone_id" uuid NOT NULL,
        CONSTRAINT "PK_visitor_visit_zones" PRIMARY KEY ("visit_id", "zone_id"),
        CONSTRAINT "FK_visitor_visit_zones_visit" FOREIGN KEY ("visit_id") REFERENCES "visitor_visits" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_visitor_visit_zones_zone" FOREIGN KEY ("zone_id") REFERENCES "zones" ("id") ON DELETE RESTRICT
      )
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "visitor_visit_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "visit_id" uuid NOT NULL,
        "event_type" varchar(30) NOT NULL,
        "event_time" timestamptz NOT NULL DEFAULT now(),
        "zone_id" uuid,
        "device_event_id" uuid,
        "score" numeric(5,4),
        "actor_user_id" uuid,
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_visitor_visit_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_visitor_visit_events_visit" FOREIGN KEY ("visit_id") REFERENCES "visitor_visits" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_visitor_visit_events_zone" FOREIGN KEY ("zone_id") REFERENCES "zones" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_visitor_visit_events_device_event" FOREIGN KEY ("device_event_id") REFERENCES "iot_device_events" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_visitor_visit_events_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_visitor_visit_events_visit_time" ON "visitor_visit_events" ("visit_id", "event_time")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_visitor_visit_events_gate_alerts" ON "visitor_visit_events" ("event_type", "event_time") WHERE "event_type" IN ('access_denied','manual_review')`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "visitor_visit_code_counters" (
        "day" date NOT NULL,
        "last_no" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_visitor_visit_code_counters" PRIMARY KEY ("day")
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "visitor_visit_code_counters"`);
    await q.query(`DROP TABLE IF EXISTS "visitor_visit_events"`);
    await q.query(`DROP TABLE IF EXISTS "visitor_visit_zones"`);
    await q.query(`DROP TABLE IF EXISTS "visitor_visits"`);
    await q.query(`DROP TABLE IF EXISTS "visitors"`);
  }
}
