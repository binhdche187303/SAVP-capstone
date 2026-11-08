import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đồng bộ UEL — phần vận hành.
 *
 * 1. uel_sync_runs: lịch sử từng lượt đồng bộ (bấm tay hoặc lịch tự động) để xem lại sau khi
 *    server khởi động lại; trước đây kết quả chỉ nằm trong bộ nhớ.
 * 2. system_configs nhóm `uel_sync`: học kỳ hiện tại (nam_hoc, hoc_ky) cho lịch tự động và số
 *    ngày lịch học kéo trước. Bảng system_configs không có unique trên config_key nên seed bằng
 *    WHERE NOT EXISTS.
 */
const CONFIGS: [key: string, value: string, type: string, desc: string][] = [
  [
    'uel_sync.nam_hoc',
    '',
    'string',
    'Năm học hiện tại cho đồng bộ UEL tự động (nam_hoc, vd 2026-2027). Trống = bỏ qua lớp HP và đăng ký.',
  ],
  [
    'uel_sync.hoc_ky',
    '',
    'string',
    'Học kỳ hiện tại cho đồng bộ UEL tự động (hoc_ky, vd 1).',
  ],
  [
    'uel_sync.session_days_ahead',
    '14',
    'number',
    'Số ngày lịch học kéo trước, tính từ hôm nay (1..120).',
  ],
];

export class CreateUelSyncRunsAndSettings20261108000001 implements MigrationInterface {
  name = 'CreateUelSyncRunsAndSettings20261108000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS uel_sync_runs (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        trigger varchar(20) NOT NULL,
        requested_by uuid NULL,
        status varchar(20) NOT NULL DEFAULT 'running',
        options jsonb NOT NULL DEFAULT '{}'::jsonb,
        results jsonb NOT NULL DEFAULT '[]'::jsonb,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz NULL,
        CONSTRAINT "PK_uel_sync_runs_id" PRIMARY KEY (id),
        CONSTRAINT "FK_uel_sync_runs_requested_by" FOREIGN KEY (requested_by)
          REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT "CK_uel_sync_runs_trigger" CHECK (trigger IN ('manual', 'schedule')),
        CONSTRAINT "CK_uel_sync_runs_status" CHECK (status IN ('running', 'succeeded', 'partial', 'failed'))
      );
      CREATE INDEX IF NOT EXISTS "IDX_uel_sync_runs_started_at" ON uel_sync_runs (started_at DESC);
    `);

    for (const [key, value, type, desc] of CONFIGS) {
      await q.query(
        `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_active)
         SELECT $1::varchar, $2::text, $3::varchar, 'uel_sync', $4::text, true
          WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = $1::varchar)`,
        [key, value, type, desc],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM system_configs WHERE config_key = ANY($1)`, [
      CONFIGS.map(([key]) => key),
    ]);
    await q.query(`DROP TABLE IF EXISTS uel_sync_runs`);
  }
}
