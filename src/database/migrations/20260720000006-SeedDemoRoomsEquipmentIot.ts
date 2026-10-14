import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier 1 demo data: 6 rooms, 10 equipments, 8 iot_devices, 6 device_user_mappings.
 * Phu thuoc: 20260720000001 (departments), 20260720000003 (users) da chay truoc do
 * (dung sysadmin lam created_by/registered_by).
 */
export class SeedDemoRoomsEquipmentIot20260720000006 implements MigrationInterface {
  name = 'SeedDemoRoomsEquipmentIot20260720000006';

  private readonly rooms: Array<{
    code: string;
    name: string;
    site: string;
    area: string;
    capacity: number;
    type: string;
    status: string;
    camera: boolean;
    mic: boolean;
    display: boolean;
    recording: boolean;
  }> = [
    {
      code: 'RM-A101',
      name: 'Phòng họp A101',
      site: 'Tòa nhà A',
      area: 'Tầng 1',
      capacity: 8,
      type: 'meeting_room',
      status: 'available',
      camera: true,
      mic: true,
      display: true,
      recording: true,
    },
    {
      code: 'RM-A102',
      name: 'Phòng họp A102',
      site: 'Tòa nhà A',
      area: 'Tầng 1',
      capacity: 4,
      type: 'meeting_room',
      status: 'available',
      camera: false,
      mic: false,
      display: true,
      recording: false,
    },
    {
      code: 'RM-A201',
      name: 'Phòng đào tạo A201',
      site: 'Tòa nhà A',
      area: 'Tầng 2',
      capacity: 20,
      type: 'training_room',
      status: 'available',
      camera: true,
      mic: true,
      display: true,
      recording: true,
    },
    {
      code: 'RM-B301',
      name: 'Phòng họp Ban Giám đốc B301',
      site: 'Tòa nhà B',
      area: 'Tầng 3',
      capacity: 12,
      type: 'board_room',
      status: 'available',
      camera: true,
      mic: true,
      display: true,
      recording: true,
    },
    {
      code: 'RM-B302',
      name: 'Phòng họp nhỏ B302',
      site: 'Tòa nhà B',
      area: 'Tầng 3',
      capacity: 6,
      type: 'meeting_room',
      status: 'available',
      camera: false,
      mic: false,
      display: true,
      recording: false,
    },
    {
      code: 'RM-C401',
      name: 'Phòng họp C401',
      site: 'Tòa nhà C',
      area: 'Tầng 4',
      capacity: 15,
      type: 'meeting_room',
      status: 'maintenance',
      camera: false,
      mic: false,
      display: false,
      recording: false,
    },
  ];

  private readonly equipments: Array<{
    code: string;
    name: string;
    type: string;
    roomCode: string;
    serial: string;
  }> = [
    {
      code: 'EQ-CAM-A101',
      name: 'Camera phong A101',
      type: 'camera',
      roomCode: 'RM-A101',
      serial: 'SN-CAM-A101',
    },
    {
      code: 'EQ-MIC-A101',
      name: 'Microphone phong A101',
      type: 'microphone',
      roomCode: 'RM-A101',
      serial: 'SN-MIC-A101',
    },
    {
      code: 'EQ-DISP-A102',
      name: 'Man hinh phong A102',
      type: 'display',
      roomCode: 'RM-A102',
      serial: 'SN-DISP-A102',
    },
    {
      code: 'EQ-CAM-A201',
      name: 'Camera phong A201',
      type: 'camera',
      roomCode: 'RM-A201',
      serial: 'SN-CAM-A201',
    },
    {
      code: 'EQ-MIC-A201',
      name: 'Microphone phong A201',
      type: 'microphone',
      roomCode: 'RM-A201',
      serial: 'SN-MIC-A201',
    },
    {
      code: 'EQ-CAP-A201',
      name: 'Capture agent phong A201',
      type: 'capture_agent',
      roomCode: 'RM-A201',
      serial: 'SN-CAP-A201',
    },
    {
      code: 'EQ-CAM-B301',
      name: 'Camera phong B301',
      type: 'camera',
      roomCode: 'RM-B301',
      serial: 'SN-CAM-B301',
    },
    {
      code: 'EQ-MIC-B301',
      name: 'Microphone phong B301',
      type: 'microphone',
      roomCode: 'RM-B301',
      serial: 'SN-MIC-B301',
    },
    {
      code: 'EQ-CAP-B301',
      name: 'Capture agent phong B301',
      type: 'capture_agent',
      roomCode: 'RM-B301',
      serial: 'SN-CAP-B301',
    },
    {
      code: 'EQ-DISP-B302',
      name: 'Man hinh phong B302',
      type: 'display',
      roomCode: 'RM-B302',
      serial: 'SN-DISP-B302',
    },
  ];

  private readonly iotDevices: Array<{
    code: string;
    name: string;
    type: string;
    roomCode: string;
    equipmentCode: string | null;
    status: string;
  }> = [
    {
      code: 'IOT-FACE-A101',
      name: 'Face Server cua A101',
      type: 'face_server',
      roomCode: 'RM-A101',
      equipmentCode: null,
      status: 'online',
    },
    {
      code: 'IOT-ROOMCAM-A101',
      name: 'Room Camera A101',
      type: 'room_camera',
      roomCode: 'RM-A101',
      equipmentCode: 'EQ-CAM-A101',
      status: 'online',
    },
    {
      code: 'IOT-FACE-A201',
      name: 'Face Server cua A201',
      type: 'face_server',
      roomCode: 'RM-A201',
      equipmentCode: null,
      status: 'online',
    },
    {
      code: 'IOT-ROOMCAM-A201',
      name: 'Room Camera A201',
      type: 'room_camera',
      roomCode: 'RM-A201',
      equipmentCode: 'EQ-CAM-A201',
      status: 'online',
    },
    {
      code: 'IOT-CAPAGENT-A201',
      name: 'Capture Agent A201',
      type: 'capture_agent',
      roomCode: 'RM-A201',
      equipmentCode: 'EQ-CAP-A201',
      status: 'online',
    },
    {
      code: 'IOT-FACE-B301',
      name: 'Face Server cua B301',
      type: 'face_server',
      roomCode: 'RM-B301',
      equipmentCode: null,
      status: 'online',
    },
    {
      code: 'IOT-ROOMCAM-B301',
      name: 'Room Camera B301',
      type: 'room_camera',
      roomCode: 'RM-B301',
      equipmentCode: 'EQ-CAM-B301',
      status: 'online',
    },
    {
      code: 'IOT-CAPAGENT-B301',
      name: 'Capture Agent B301',
      type: 'capture_agent',
      roomCode: 'RM-B301',
      equipmentCode: 'EQ-CAP-B301',
      status: 'offline',
    },
  ];

  // Map user -> face_server device de test flow diem danh cua/face.
  private readonly deviceUserMappings: Array<{
    deviceCode: string;
    username: string;
    personCode: string;
  }> = [
    {
      deviceCode: 'IOT-FACE-A101',
      username: 'manager.it',
      personCode: 'FACE-EMP004',
    },
    {
      deviceCode: 'IOT-FACE-A101',
      username: 'emp.it1',
      personCode: 'FACE-EMP007',
    },
    {
      deviceCode: 'IOT-FACE-A101',
      username: 'emp.it2',
      personCode: 'FACE-EMP008',
    },
    {
      deviceCode: 'IOT-FACE-A201',
      username: 'manager.hr',
      personCode: 'FACE-EMP005',
    },
    {
      deviceCode: 'IOT-FACE-A201',
      username: 'emp.hr1',
      personCode: 'FACE-EMP009',
    },
    {
      deviceCode: 'IOT-FACE-B301',
      username: 'sysadmin',
      personCode: 'FACE-EMP001',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sysAdminRow = (await queryRunner.query(
      `SELECT id FROM users WHERE lower(username) = 'sysadmin';`,
    )) as Array<{ id: string }>;
    const sysAdminId = sysAdminRow[0]?.id ?? null;

    for (const r of this.rooms) {
      await queryRunner.query(
        `INSERT INTO rooms (
           room_code, room_name, site_name, area_name, capacity, room_type, current_status,
           has_camera, has_microphone, has_display, allow_recording, created_by
         )
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::integer, $6::varchar, $7::varchar,
                $8::boolean, $9::boolean, $10::boolean, $11::boolean, $12::uuid
         WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE room_code = $1);`,
        [
          r.code,
          r.name,
          r.site,
          r.area,
          r.capacity,
          r.type,
          r.status,
          r.camera,
          r.mic,
          r.display,
          r.recording,
          sysAdminId,
        ],
      );
    }

    for (const eq of this.equipments) {
      await queryRunner.query(
        `INSERT INTO equipments (
           equipment_code, equipment_name, equipment_type, serial_number, asset_status, health_status,
           current_room_id, assigned_by, assigned_at
         )
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, 'assigned', 'healthy',
                (SELECT id FROM rooms WHERE room_code = $5), $6::uuid, NOW()
         WHERE NOT EXISTS (SELECT 1 FROM equipments WHERE equipment_code = $1);`,
        [eq.code, eq.name, eq.type, eq.serial, eq.roomCode, sysAdminId],
      );
    }

    for (const d of this.iotDevices) {
      await queryRunner.query(
        `INSERT INTO iot_devices (device_code, device_name, device_type, room_id, equipment_id, status, health_status, last_seen_at)
         SELECT $1::varchar, $2::varchar, $3::varchar, (SELECT id FROM rooms WHERE room_code = $4),
                (SELECT id FROM equipments WHERE equipment_code = $5::varchar),
                $6::varchar, 'healthy', NOW()
         WHERE NOT EXISTS (SELECT 1 FROM iot_devices WHERE device_code = $1);`,
        [d.code, d.name, d.type, d.roomCode, d.equipmentCode, d.status],
      );
    }

    for (const m of this.deviceUserMappings) {
      await queryRunner.query(
        `INSERT INTO device_user_mappings (
           device_id, user_id, device_person_id, device_person_code, device_person_name,
           face_registered, registered_at, registered_by, sync_status, last_synced_at
         )
         SELECT (SELECT id FROM iot_devices WHERE device_code = $1),
                u.id, $3::varchar, $3::varchar, u.full_name, true, NOW(), $4::uuid, 'synced', NOW()
         FROM users u
         WHERE lower(u.username) = lower($2)
           AND NOT EXISTS (
             SELECT 1 FROM device_user_mappings dum
             JOIN iot_devices dev ON dev.id = dum.device_id
             WHERE dev.device_code = $1 AND dum.user_id = u.id AND dum.deleted_at IS NULL
           );`,
        [m.deviceCode, m.username, m.personCode, sysAdminId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const deviceCodes = this.iotDevices.map((d) => d.code);
    const equipmentCodes = this.equipments.map((e) => e.code);
    const roomCodes = this.rooms.map((r) => r.code);

    await queryRunner.query(
      `DELETE FROM device_user_mappings WHERE device_id IN (SELECT id FROM iot_devices WHERE device_code = ANY($1));`,
      [deviceCodes],
    );
    await queryRunner.query(
      `DELETE FROM iot_devices WHERE device_code = ANY($1);`,
      [deviceCodes],
    );
    await queryRunner.query(
      `DELETE FROM equipments WHERE equipment_code = ANY($1);`,
      [equipmentCodes],
    );
    await queryRunner.query(`DELETE FROM rooms WHERE room_code = ANY($1);`, [
      roomCodes,
    ]);
  }
}
