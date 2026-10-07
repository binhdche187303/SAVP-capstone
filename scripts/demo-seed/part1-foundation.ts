import * as bcrypt from 'bcryptjs';
import { db, insertTracked, pick } from './lib';

/**
 * PHẦN 1 — dữ liệu nền: phòng ban, user (đủ vai trò), zone (có toạ độ cho bản đồ), phòng họp,
 * thiết bị (camera/cảm biến nhiều trạng thái). Các phần sau đọc lại qua trackedIds().
 */

export const PART = 'part1';
export const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'Demo@12345';

const DEPARTMENTS = [
  ['DEMO-KD', 'Phòng Kinh doanh'],
  ['DEMO-KT', 'Phòng Kỹ thuật'],
  ['DEMO-TC', 'Phòng Tài chính - Kế toán'],
  ['DEMO-MKT', 'Phòng Marketing'],
  ['DEMO-CSKH', 'Phòng Chăm sóc khách hàng'],
] as const;

const NAMES = [
  'Nguyễn Văn An',
  'Trần Thị Bình',
  'Lê Hoàng Cường',
  'Phạm Thu Dung',
  'Hoàng Minh Đức',
  'Vũ Thị Hà',
  'Đặng Quốc Huy',
  'Bùi Thị Hương',
  'Đỗ Mạnh Hùng',
  'Ngô Thanh Lan',
  'Dương Văn Long',
  'Lý Thị Mai',
  'Phan Đức Minh',
  'Trịnh Thị Nga',
  'Hồ Văn Nam',
  'Mai Thị Oanh',
  'Tạ Quang Phúc',
  'Đinh Thị Quỳnh',
  'Lương Văn Sơn',
  'Cao Thị Thảo',
  'Chu Minh Tuấn',
  'Kiều Thị Uyên',
  'La Văn Vinh',
  'Âu Thị Xuân',
  'Thái Hoàng Yến',
  'Quách Văn Bảo',
  'Tôn Thị Châu',
  'Lâm Gia Khánh',
  'Mạc Thị Linh',
  'Văn Đình Phong',
];

const POSITIONS = [
  'Chuyên viên',
  'Nhân viên',
  'Chuyên viên cao cấp',
  'Kỹ sư',
  'Trợ lý',
];

/** [code, tên, loại, toà, tầng] — toạ độ lệch nhẹ quanh 1 điểm để hiện trên bản đồ. */
const ZONES = [
  ['DEMO-A-GATE-MAIN', 'Cổng chính', 'gate', 'Tòa A', 'G'],
  ['DEMO-A-GATE-SIDE', 'Cổng phụ', 'gate', 'Tòa A', 'G'],
  ['DEMO-A-LOBBY', 'Sảnh chính Tòa A', 'lobby', 'Tòa A', 'G'],
  ['DEMO-A-COR-1', 'Hành lang tầng 1', 'corridor', 'Tòa A', '1'],
  ['DEMO-A-COR-2', 'Hành lang tầng 2', 'corridor', 'Tòa A', '2'],
  ['DEMO-A-SERVER', 'Phòng máy chủ (khu hạn chế)', 'corridor', 'Tòa A', '2'],
  ['DEMO-B-LOBBY', 'Sảnh Tòa B', 'lobby', 'Tòa B', 'G'],
  ['DEMO-B-COR-1', 'Hành lang Tòa B tầng 1', 'corridor', 'Tòa B', '1'],
  ['DEMO-B-COR-3', 'Hành lang Tòa B tầng 3', 'corridor', 'Tòa B', '3'],
  ['DEMO-PARKING', 'Bãi đỗ xe', 'parking', 'Tòa B', 'B1'],
] as const;

/** [code, tên, sức chứa, loại, toà, tầng, trạng thái hành chính] */
const ROOMS = [
  ['DEMO-R101', 'Phòng họp Sen', 8, 'meeting_room', 'Tòa A', '1', 'available'],
  ['DEMO-R102', 'Phòng họp Mai', 6, 'meeting_room', 'Tòa A', '1', 'available'],
  ['DEMO-R201', 'Phòng họp Lan', 12, 'meeting_room', 'Tòa A', '2', 'available'],
  ['DEMO-R202', 'Phòng Hội đồng', 20, 'board_room', 'Tòa A', '2', 'available'],
  [
    'DEMO-R301',
    'Phòng Đào tạo 1',
    30,
    'training_room',
    'Tòa B',
    '3',
    'available',
  ],
  ['DEMO-R302', 'Phòng họp Cúc', 10, 'meeting_room', 'Tòa B', '3', 'available'],
  ['DEMO-R103', 'Không gian mở', 16, 'open_space', 'Tòa B', '1', 'available'],
  [
    'DEMO-R303',
    'Phòng họp Đào (bảo trì)',
    8,
    'meeting_room',
    'Tòa B',
    '3',
    'maintenance',
  ],
] as const;

const BASE_LAT = 21.0136;
const BASE_LNG = 105.5268;

function slug(i: number): string {
  return String(i + 1).padStart(3, '0');
}

export async function seedPart1(log: (m: string) => void): Promise<void> {
  const [admin]: Array<{ id: string }> = await db.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.role_code = 'SYSTEM_ADMIN' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1`,
  );
  const createdBy = admin?.id ?? null;

  const deptIds = await insertTracked(
    PART,
    'departments',
    DEPARTMENTS.map(([code, name]) => ({
      department_code: code,
      department_name: name,
      description: 'Dữ liệu demo',
      created_by: createdBy,
    })),
  );
  log(`  ✔ ${deptIds.length} phòng ban`);

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userIds = await insertTracked(
    PART,
    'users',
    NAMES.map((name, i) => ({
      employee_code: `DEMO-E${slug(i)}`,
      username: `demo.e${slug(i)}`,
      email: `demo.e${slug(i)}@demo.local`,
      password_hash: hash,
      full_name: name,
      phone_number: `09${String(10000000 + i * 7919).slice(0, 8)}`,
      department_id: deptIds[i % deptIds.length],
      // 5 người đầu là trưởng phòng
      position_title: i < 5 ? 'Trưởng phòng' : pick(POSITIONS),
      password_updated_at: new Date(),
    })),
  );
  // Trưởng phòng + quản lý trực tiếp
  for (let d = 0; d < deptIds.length; d++) {
    await db.query(
      `UPDATE departments SET manager_user_id = $1 WHERE id = $2`,
      [userIds[d], deptIds[d]],
    );
  }
  for (let i = 5; i < userIds.length; i++) {
    await db.query(`UPDATE users SET direct_manager_id = $1 WHERE id = $2`, [
      userIds[i % 5],
      userIds[i],
    ]);
  }
  log(`  ✔ ${userIds.length} người dùng (mật khẩu chung: ${DEMO_PASSWORD})`);

  const roles: Array<{ id: string; role_code: string }> = await db.query(
    `SELECT id, role_code FROM roles`,
  );
  const roleId = (code: string) => roles.find((r) => r.role_code === code)?.id;
  // 0-4 MANAGER, 5-6 BUSINESS_ADMIN, còn lại EMPLOYEE
  const roleOf = (i: number) =>
    i < 5 ? 'MANAGER' : i < 7 ? 'BUSINESS_ADMIN' : 'EMPLOYEE';
  const urIds = await insertTracked(
    PART,
    'user_roles',
    userIds.map((uid, i) => ({
      user_id: uid,
      role_id: roleId(roleOf(i)),
      assigned_by: createdBy,
    })),
  );
  log(
    `  ✔ ${urIds.length} gán vai trò (5 quản lý, 2 business admin, 23 nhân viên)`,
  );

  const zoneIds = await insertTracked(
    PART,
    'zones',
    ZONES.map(([code, name, type, building, floor], i) => ({
      zone_code: code,
      zone_name: name,
      zone_type: type,
      building,
      floor,
      description: 'Dữ liệu demo',
      latitude: (BASE_LAT + (i % 4) * 0.00035).toFixed(6),
      longitude: (BASE_LNG + Math.floor(i / 4) * 0.0005).toFixed(6),
      metadata_json: { demo: true },
    })),
  );
  log(`  ✔ ${zoneIds.length} khu vực (zone)`);

  const roomIds = await insertTracked(
    PART,
    'rooms',
    ROOMS.map(([code, name, cap, type, building, floor, adminStatus]) => ({
      room_code: code,
      room_name: name,
      site_name: 'Campus DEMO',
      area_name: `${building} - Tầng ${floor}`,
      location_description: 'Dữ liệu demo',
      capacity: cap,
      room_type: type,
      administrative_status: adminStatus,
      has_camera: true,
      has_microphone: true,
      has_display: true,
      allow_recording: type !== 'open_space',
      created_by: createdBy,
    })),
  );
  log(`  ✔ ${roomIds.length} phòng`);

  // Thiết bị: mỗi zone 1 camera IP, mỗi phòng 1 camera phòng + 1 cảm biến; trạng thái đa dạng
  const now = new Date();
  const statusMix = [
    'online',
    'online',
    'online',
    'online',
    'offline',
    'maintenance',
  ];
  const devices: Record<string, unknown>[] = [];
  ZONES.forEach(([code, name], i) => {
    const status = statusMix[i % statusMix.length];
    devices.push({
      device_code: `DEMO-CAM-${code.replace('DEMO-', '')}`,
      device_name: `Camera ${name}`,
      device_type: 'ip_camera',
      zone_id: zoneIds[i],
      ip_address: `10.20.1.${11 + i}`,
      status,
      health_status: status === 'online' ? 'healthy' : 'unknown',
      last_seen_at:
        status === 'online' ? now : new Date(now.getTime() - 86_400_000),
      metadata_json: { demo: true },
    });
  });
  ROOMS.forEach(([code, name], i) => {
    const status = statusMix[(i + 2) % statusMix.length];
    devices.push(
      {
        device_code: `DEMO-RCAM-${code.replace('DEMO-', '')}`,
        device_name: `Camera ${name}`,
        device_type: 'room_camera',
        room_id: roomIds[i],
        ip_address: `10.20.2.${11 + i}`,
        status,
        health_status: status === 'online' ? 'healthy' : 'unknown',
        last_seen_at:
          status === 'online' ? now : new Date(now.getTime() - 3_600_000),
        metadata_json: { demo: true },
      },
      {
        device_code: `DEMO-SENS-${code.replace('DEMO-', '')}`,
        device_name: `Cảm biến hiện diện ${name}`,
        device_type: 'occupancy_sensor',
        room_id: roomIds[i],
        ip_address: `10.20.3.${11 + i}`,
        status: 'online',
        health_status: 'healthy',
        last_seen_at: now,
        metadata_json: { demo: true },
      },
    );
  });
  const devIds = await insertTracked(PART, 'iot_devices', devices);
  log(`  ✔ ${devIds.length} thiết bị (camera khu vực, camera phòng, cảm biến)`);
}
