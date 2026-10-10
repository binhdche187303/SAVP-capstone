import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedClassAttendanceSettings20261011000004
  implements MigrationInterface
{
  name = 'SeedClassAttendanceSettings20261011000004';

  private readonly entries = [
    {
      key: 'class_attendance.default_start_time',
      value: '08:00',
      type: 'string',
      description: 'Giờ bắt đầu vào học mặc định cho điểm danh lớp học',
    },
    {
      key: 'class_attendance.late_threshold_minutes',
      value: '10',
      type: 'number',
      description:
        'Số phút cho phép sau giờ vào học trước khi đánh dấu đi muộn',
    },
    {
      key: 'class_attendance.auto_scan_interval_seconds',
      value: '4',
      type: 'number',
      description: 'Chu kỳ quét FaceID tự động cho điểm danh lớp học',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const entry of this.entries) {
      await queryRunner.query(
        `INSERT INTO system_configs (
           config_key, config_value, value_type, config_group, description,
           is_sensitive, is_active, version_no
         )
         SELECT $1::varchar, $2::text, $3::varchar, 'class_attendance',
                $4::text, false, true, 1
         WHERE NOT EXISTS (
           SELECT 1 FROM system_configs WHERE config_key = $1::varchar
         );`,
        [entry.key, entry.value, entry.type, entry.description],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM system_configs WHERE config_key = ANY($1::varchar[])`,
      [this.entries.map((entry) => entry.key)],
    );
  }
}
