import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chuẩn bị schema để đồng bộ dữ liệu từ API Đào tạo UEL (api.uel.edu.vn/gw/v1/uelapi, 13 API).
 *
 * 1. class_sessions.external_id  = ma_lich_hoc (key upsert buổi học) + period_start/period_count (tiết).
 * 2. study_periods (tiết → giờ); class_sessions.shift_id nullable (UEL trả tiết, không trả ca).
 * 3. rooms.building_code / campus_code (ma_day_nha / ma_co_so); capacity DEFAULT 0;
 *    class_sessions.room_id nullable (không có API danh sách phòng).
 * 4. semesters.start_date / end_date nullable (không có API học kỳ).
 * 5. users.password_hash nullable (tài khoản đồng bộ về không có mật khẩu).
 * 6. Bỏ unique theo tên đơn vị (key thật là ma_phong_ban).
 * 7. source ('manual' | 'uel_api') + last_synced_at trên các bảng được đồng bộ.
 */
const SYNCED_TABLES = [
  'departments',
  'users',
  'students',
  'subjects',
  'semesters',
  'class_sections',
  'class_enrollments',
  'class_sessions',
  'rooms',
] as const;

export class AlignSchemaWithUelApi20261107000001 implements MigrationInterface {
  name = 'AlignSchemaWithUelApi20261107000001';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Buổi học: key nguồn + tiết
    await q.query(`
      ALTER TABLE class_sessions
        ADD COLUMN IF NOT EXISTS external_id varchar(50) NULL,
        ADD COLUMN IF NOT EXISTS period_start smallint NULL,
        ADD COLUMN IF NOT EXISTS period_count smallint NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_class_sessions_external_id"
        ON class_sessions (external_id) WHERE external_id IS NOT NULL;
    `);
    await q.query(`
      ALTER TABLE class_sessions DROP CONSTRAINT IF EXISTS "CK_class_sessions_periods";
      ALTER TABLE class_sessions ADD CONSTRAINT "CK_class_sessions_periods"
        CHECK ((period_start IS NULL OR period_start > 0) AND (period_count IS NULL OR period_count > 0));
    `);

    // 2. Bảng tiết học + shift_id nullable
    await q.query(`
      CREATE TABLE IF NOT EXISTS study_periods (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        period_no smallint NOT NULL,
        start_time time NOT NULL,
        end_time time NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_study_periods_id" PRIMARY KEY (id),
        CONSTRAINT "UQ_study_periods_no" UNIQUE (period_no),
        CONSTRAINT "CK_study_periods_no" CHECK (period_no > 0),
        CONSTRAINT "CK_study_periods_time" CHECK (end_time > start_time)
      );
      ALTER TABLE class_sessions ALTER COLUMN shift_id DROP NOT NULL;
    `);

    // 3. Phòng học
    await q.query(`
      ALTER TABLE rooms
        ADD COLUMN IF NOT EXISTS building_code varchar(50) NULL,
        ADD COLUMN IF NOT EXISTS campus_code varchar(50) NULL;
      ALTER TABLE rooms ALTER COLUMN capacity SET DEFAULT 0;
      ALTER TABLE class_sessions ALTER COLUMN room_id DROP NOT NULL;
    `);

    // 4. Học kỳ
    await q.query(`
      ALTER TABLE semesters
        ALTER COLUMN start_date DROP NOT NULL,
        ALTER COLUMN end_date DROP NOT NULL;
    `);

    // 5. Mật khẩu
    await q.query(
      `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`,
    );

    // 6. Tên đơn vị không còn unique
    await q.query(`DROP INDEX IF EXISTS ux_departments_name;`);

    // 7. Nguồn dữ liệu + lần đồng bộ cuối
    for (const t of SYNCED_TABLES) {
      await q.query(`
        ALTER TABLE ${t}
          ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'manual',
          ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL;
        ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS "CK_${t}_source";
        ALTER TABLE ${t} ADD CONSTRAINT "CK_${t}_source" CHECK (source IN ('manual', 'uel_api'));
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of SYNCED_TABLES) {
      await q.query(`
        ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS "CK_${t}_source";
        ALTER TABLE ${t} DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS last_synced_at;
      `);
    }

    // Lưu ý: down sẽ lỗi nếu đã có dữ liệu NULL / trùng tên do đồng bộ — cần dọn trước.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_name
        ON departments (department_name) WHERE deleted_at IS NULL;
    `);
    await q.query(`ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;`);
    await q.query(`
      ALTER TABLE semesters
        ALTER COLUMN start_date SET NOT NULL,
        ALTER COLUMN end_date SET NOT NULL;
    `);
    await q.query(`
      ALTER TABLE class_sessions ALTER COLUMN room_id SET NOT NULL;
      ALTER TABLE rooms ALTER COLUMN capacity DROP DEFAULT;
      ALTER TABLE rooms DROP COLUMN IF EXISTS building_code, DROP COLUMN IF EXISTS campus_code;
    `);
    await q.query(`
      ALTER TABLE class_sessions ALTER COLUMN shift_id SET NOT NULL;
      DROP TABLE IF EXISTS study_periods;
    `);
    await q.query(`
      ALTER TABLE class_sessions DROP CONSTRAINT IF EXISTS "CK_class_sessions_periods";
      DROP INDEX IF EXISTS "UQ_class_sessions_external_id";
      ALTER TABLE class_sessions
        DROP COLUMN IF EXISTS external_id,
        DROP COLUMN IF EXISTS period_start,
        DROP COLUMN IF EXISTS period_count;
    `);
  }
}
