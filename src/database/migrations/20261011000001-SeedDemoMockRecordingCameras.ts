import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed camera ảo cho demo recording trên môi trường deploy.
 *
 * RecordingSessionService chỉ dùng `mock://testsrc` khi:
 * - env MOCK_RECORDING_ENABLED=true
 * - iot_devices.metadata_json.mock_camera=true
 *
 * FE sẽ ưu tiên camera đã có trong phòng trước khi gọi /dev/mock-camera. Vì /dev chỉ
 * load ở NODE_ENV=development, migration này giúp production demo vẫn ghi hình được
 * bằng ffmpeg testsrc mà không cần route dev.
 */
export class SeedDemoMockRecordingCameras20261011000001
  implements MigrationInterface
{
  name = 'SeedDemoMockRecordingCameras20261011000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE iot_devices
         SET metadata_json = COALESCE(metadata_json, '{}'::jsonb)
              || jsonb_build_object(
                   'mock_camera', true,
                   'source', 'ffmpeg-testsrc',
                   'demo_recording', true
                 ),
             status = 'online',
             health_status = 'healthy',
             last_seen_at = NOW(),
             updated_at = NOW()
       WHERE device_code IN ('IOT-ROOMCAM-A101', 'IOT-ROOMCAM-A201')
          OR (
            device_type IN ('room_camera', 'ip_camera')
            AND device_code LIKE 'CAMAI-MOCK-ROOMCAM-%'
          )
    `);

    await queryRunner.query(`
      INSERT INTO iot_devices (
        device_code,
        device_name,
        device_type,
        room_id,
        status,
        health_status,
        last_seen_at,
        metadata_json,
        created_at,
        updated_at
      )
      SELECT
        'CAMAI-MOCK-ROOMCAM-' || r.room_code,
        'Camera ảo ghi hình - ' || r.room_name,
        'room_camera',
        r.id,
        'online',
        'healthy',
        NOW(),
        jsonb_build_object(
          'mock_camera', true,
          'source', 'ffmpeg-testsrc',
          'demo_recording', true
        ),
        NOW(),
        NOW()
      FROM rooms r
      WHERE r.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM iot_devices d
           WHERE d.room_id = r.id
             AND d.device_type = 'room_camera'
        )
        AND NOT EXISTS (
          SELECT 1
            FROM iot_devices d
           WHERE d.device_code = 'CAMAI-MOCK-ROOMCAM-' || r.room_code
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM iot_devices
       WHERE device_code LIKE 'CAMAI-MOCK-ROOMCAM-%'
         AND metadata_json->>'demo_recording' = 'true'
    `);

    await queryRunner.query(`
      UPDATE iot_devices
         SET metadata_json = metadata_json - 'mock_camera' - 'source' - 'demo_recording',
             updated_at = NOW()
       WHERE device_code IN ('IOT-ROOMCAM-A101', 'IOT-ROOMCAM-A201')
         AND metadata_json->>'demo_recording' = 'true'
    `);
  }
}
