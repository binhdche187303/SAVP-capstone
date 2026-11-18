import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source.js';
import { SeedDemoRoomsEquipmentIot20260720000006 } from '../src/database/migrations/20260720000006-SeedDemoRoomsEquipmentIot.js';
import { SeedDemoMeetings20260720000007 } from '../src/database/migrations/20260720000007-SeedDemoMeetings.js';
import { SeedDemoBookingsRequestsEvents20260720000008 } from '../src/database/migrations/20260720000008-SeedDemoBookingsRequestsEvents.js';

/**
 * Dọn DỮ LIỆU GIẢ do các migration SeedDemo* tạo (cuộc họp, biên bản, yêu cầu đặt phòng,
 * thiết bị IoT/thiết bị phòng giả, camera ảo ghi hình) trên máy chủ dùng chung.
 * Dữ liệu giả chỉ nên tồn tại trên máy cá nhân để test.
 *
 * GIỮ NGUYÊN: tài khoản, phòng ban, phòng, cấu hình hệ thống, biển số xe.
 * Xóa đúng theo danh sách mã lấy từ chính các migration seed (không xóa theo mẫu LIKE rộng).
 * Bảng khác tham chiếu tới bản ghi bị xóa:
 *   - cột liên kết BẮT BUỘC (NOT NULL) → xóa dòng con (đệ quy),
 *   - cột liên kết KHÔNG bắt buộc → chỉ bỏ liên kết (SET NULL), giữ lại dòng (vd nhật ký thật).
 *
 * Chạy thử (mặc định, tự hoàn tác):  npx tsx scripts/cleanup-demo-data.ts
 * Xóa thật:                          npx tsx scripts/cleanup-demo-data.ts --apply
 */

const APPLY = process.argv.includes('--apply');
const MAX_DEPTH = 8;

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
const codesOf = (instance: unknown, field: string, key: string): string[] =>
  ((instance as any)[field] as Array<Record<string, string>>).map(
    (r) => r[key],
  );
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

const seed06 = new SeedDemoRoomsEquipmentIot20260720000006();
const seed07 = new SeedDemoMeetings20260720000007();
const seed08 = new SeedDemoBookingsRequestsEvents20260720000008();

interface Root {
  label: string;
  table: string;
  where: string;
  params: unknown[];
}

const ROOTS: Root[] = [
  {
    label: 'Cuộc họp giả (MTG-2026-xxx)',
    table: 'meetings',
    where: 'meeting_code = ANY($1)',
    params: [codesOf(seed07, 'meetings', 'code')],
  },
  {
    label: 'Yêu cầu đặt phòng giả (REQ-2026-xxx)',
    table: 'meeting_requests',
    where: 'request_code = ANY($1)',
    params: [codesOf(seed08, 'meetingRequests', 'code')],
  },
  {
    label: 'Lượt đặt phòng giả (BK-2026-xxx)',
    table: 'room_bookings',
    where: 'booking_code = ANY($1)',
    params: [codesOf(seed08, 'bookings', 'bookingCode')],
  },
  {
    label: 'File ghi hình/biên bản giả (demo-seed/)',
    table: 'media_files',
    where: "storage_key LIKE 'demo-seed/%'",
    params: [],
  },
  {
    label:
      'Thiết bị IoT giả (Face server, camera phòng, capture agent, camera ảo)',
    table: 'iot_devices',
    where: `device_code = ANY($1) OR (device_code LIKE 'CAMAI-MOCK-ROOMCAM-%' AND metadata_json->>'demo_recording' = 'true')`,
    params: [codesOf(seed06, 'iotDevices', 'code')],
  },
  {
    label: 'Thiết bị giả tạo từ chức năng dev (CAMAI-MOCK-*, MOCK-CAM-*)',
    table: 'iot_devices',
    where: `device_code LIKE 'CAMAI-MOCK-%' OR device_code LIKE 'MOCK-CAM-%'
            OR metadata_json->>'source' IN ('dev.mock-anpr', 'dev.mock-face-attendance', 'ffmpeg-testsrc')
            OR metadata_json->>'mock_camera' = 'true'`,
    params: [],
  },
  {
    label: 'Thiết bị phòng giả (EQ-xxx)',
    table: 'equipments',
    where: 'equipment_code = ANY($1)',
    params: [codesOf(seed06, 'equipments', 'code')],
  },
];

interface Fk {
  child: string;
  column: string;
  parent: string;
  parentColumn: string;
  nullable: boolean;
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
  await AppDataSource.initialize();
  // Chỉ in báo cáo, không in từng câu SQL (data-source bật log khi NODE_ENV=development).
  const noop = () => undefined;
  AppDataSource.logger = {
    logQuery: noop,
    logQueryError: noop,
    logQuerySlow: noop,
    logSchemaBuild: noop,
    logMigration: noop,
    log: noop,
  };
  const runner = AppDataSource.createQueryRunner();
  await runner.connect();
  const fks = (await runner.query(`
    SELECT c.conrelid::regclass::text AS child, a.attname AS column,
           c.confrelid::regclass::text AS parent, pa.attname AS "parentColumn",
           NOT a.attnotnull AS nullable
      FROM pg_constraint c
      JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
     WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
       AND c.connamespace = 'public'::regnamespace`)) as Fk[];

  const report: Array<{ action: string; table: string; rows: number }> = [];
  const note = (action: string, table: string, rows: number) => {
    if (rows > 0) report.push({ action, table, rows });
  };
  const affected = (res: unknown): number => {
    const r = res as [unknown, number] | { affected?: number };
    return Array.isArray(r) ? Number(r[1] ?? 0) : Number(r?.affected ?? 0);
  };

  // Xóa các dòng của `table` khớp `where`: xử lý bảng con trước rồi mới xóa dòng cha.
  const purge = async (
    table: string,
    where: string,
    params: unknown[],
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_DEPTH)
      throw new Error(`Quá sâu khi dò liên kết tại bảng ${table}`);
    for (const fk of fks.filter((f) => f.parent === table)) {
      const childWhere = `${q(fk.column)} IN (SELECT ${q(fk.parentColumn)} FROM ${q(table)} WHERE ${where})`;
      if (fk.child === table || fk.nullable) {
        const res: unknown = await runner.query(
          `UPDATE ${q(fk.child)} SET ${q(fk.column)} = NULL WHERE ${childWhere}`,
          params,
        );
        note('Bỏ liên kết', `${fk.child}.${fk.column}`, affected(res));
      } else {
        await purge(fk.child, childWhere, params, depth + 1);
      }
    }
    const res: unknown = await runner.query(
      `DELETE FROM ${q(table)} WHERE ${where}`,
      params,
    );
    note('Xóa', table, affected(res));
  };

  await runner.startTransaction();
  try {
    for (const root of ROOTS) {
      const [{ n }] = (await runner.query(
        `SELECT count(*)::int AS n FROM ${q(root.table)} WHERE ${root.where}`,
        root.params,
      )) as { n: number }[];
      console.log(`• ${root.label}: ${n} bản ghi`);
      if (n > 0) await purge(root.table, root.where, root.params, 0);
    }
    console.log('\nChi tiết theo bảng:');
    console.table(report);
    if (APPLY) {
      await runner.commitTransaction();
      console.log('\n✅ ĐÃ XÓA dữ liệu giả.');
    } else {
      await runner.rollbackTransaction();
      console.log(
        '\nℹ️  CHẠY THỬ: đã hoàn tác, dữ liệu chưa bị xóa. Thêm --apply để xóa thật.',
      );
    }
  } catch (e) {
    await runner.rollbackTransaction();
    console.error('\n❌ Lỗi, đã hoàn tác toàn bộ, không có gì bị xóa:', e);
    process.exitCode = 1;
  } finally {
    await runner.release();
    await AppDataSource.destroy();
  }
}

void main();
