import { MigrationInterface, QueryRunner } from 'typeorm';

interface DemoLogRow {
  userCode: string | null;
  plateNumber: string | null;
  direction: 'in' | 'out';
  accessTime: string;
}

const SEED_BATCH_TAG = 'GAP-001-verify-20';
const ZONE_CODE = 'TEST-GATE-01';

/**
 * Seed 20 log `gate_access_logs` lệch cặp để verify GAP-001 (UC-116 ghép cặp) + GAH-001
 * (UC-117 tra cứu) bằng dữ liệu thật trên RDS chung, theo đúng yêu cầu roadmap "dev bằng
 * dữ liệu tự seed vào gate_access_logs" (Bước 2 `LO_TRINH_SAVP_TAI.md`).
 *
 * `zones` đang RỖNG trên RDS (xác nhận qua query trực tiếp trước khi viết migration này) —
 * migration tự seed thêm 1 zone loại "gate" (`TEST-GATE-01`) để có FK hợp lệ, KHÔNG đụng
 * migration/schema của Hải.
 *
 * Idempotent: kiểm tra `metadata_json->>'seed_batch' = 'GAP-001-verify-20'` trước khi insert —
 * chạy `up()` nhiều lần KHÔNG tạo trùng dữ liệu.
 *
 * 5 nhóm case (20 dòng — xem README trong JSDoc từng khối):
 * - A: 5 cặp ghép ĐÚNG theo `user_id` (10 dòng).
 * - B: 2 cặp ghép qua FALLBACK `plate_number` khi `user_id` NULL (4 dòng).
 * - C: 2 dòng "Vào" đơn lẻ, KHÔNG BAO GIỜ có "Ra" tương ứng → mãi "Chưa hoàn tất" (EX1).
 * - D: 1 dòng "Ra" đơn lẻ, không có "Vào" nào trong 24h trước → "Không xác định thời điểm
 *      vào" (EX2).
 * - E: 2 dòng "Vào" cùng user + 1 dòng "Ra" → kiểm tra BR1 (ghép ứng viên GẦN NHẤT, dòng
 *      "Vào" xa hơn phải bị bỏ lại "Chưa hoàn tất").
 *
 * CHỈ dùng để verify thủ công — `down()` xóa sạch đúng batch này (và zone test nếu không
 * còn tham chiếu nào khác), an toàn dọn dẹp sau khi verify xong.
 */
export class SeedGateAccessDemoLogsForVerify20260723000004 implements MigrationInterface {
  name = 'SeedGateAccessDemoLogsForVerify20260723000004';

  /** Dữ liệu demo đã gỡ khỏi luồng migration — chỉ giữ data thật. down() vẫn dọn được demo cũ. */
  public async up(): Promise<void> {}

  /** Seed demo cũ — không còn chạy tự động. */
  public async seedDemo(queryRunner: QueryRunner): Promise<void> {
    const already = (await queryRunner.query(
      `SELECT COUNT(*)::int AS c FROM gate_access_logs WHERE metadata_json->>'seed_batch' = $1`,
      [SEED_BATCH_TAG],
    )) as Array<{ c: number }>;
    if (already[0].c > 0) {
      return; // idempotent — đã seed rồi
    }

    const zoneId = await this.ensureZone(queryRunner);

    const emp1 = await this.resolveUserId(queryRunner, 'EMP001');
    const emp2 = await this.resolveUserId(queryRunner, 'EMP002');
    const emp3 = await this.resolveUserId(queryRunner, 'EMP003');
    const emp4 = await this.resolveUserId(queryRunner, 'EMP004');
    const emp5 = await this.resolveUserId(queryRunner, 'EMP005');
    const emp6 = await this.resolveUserId(queryRunner, 'EMP006');

    const rows: DemoLogRow[] = [
      // ── Case A: 5 cặp ghép theo user_id (10 dòng) ──
      {
        userCode: emp1,
        plateNumber: '30A12345',
        direction: 'in',
        accessTime: '2026-07-20T07:55:00+07:00',
      },
      {
        userCode: emp1,
        plateNumber: '30A12345',
        direction: 'out',
        accessTime: '2026-07-20T17:10:00+07:00',
      },
      {
        userCode: emp2,
        plateNumber: '29H167890',
        direction: 'in',
        accessTime: '2026-07-20T08:02:00+07:00',
      },
      {
        userCode: emp2,
        plateNumber: '29H167890',
        direction: 'out',
        accessTime: '2026-07-20T17:30:00+07:00',
      },
      {
        userCode: emp3,
        plateNumber: null,
        direction: 'in',
        accessTime: '2026-07-21T07:40:00+07:00',
      },
      {
        userCode: emp3,
        plateNumber: null,
        direction: 'out',
        accessTime: '2026-07-21T18:05:00+07:00',
      },
      {
        userCode: emp4,
        plateNumber: '29G123456',
        direction: 'in',
        accessTime: '2026-07-21T08:15:00+07:00',
      },
      {
        userCode: emp4,
        plateNumber: '29G123456',
        direction: 'out',
        accessTime: '2026-07-21T17:45:00+07:00',
      },
      {
        userCode: emp5,
        plateNumber: null,
        direction: 'in',
        accessTime: '2026-07-22T07:50:00+07:00',
      },
      {
        userCode: emp5,
        plateNumber: null,
        direction: 'out',
        accessTime: '2026-07-22T17:20:00+07:00',
      },

      // ── Case B: 2 cặp ghép qua fallback plate_number (user_id NULL) (4 dòng) ──
      {
        userCode: null,
        plateNumber: 'SEEDTEST01',
        direction: 'in',
        accessTime: '2026-07-20T09:00:00+07:00',
      },
      {
        userCode: null,
        plateNumber: 'SEEDTEST01',
        direction: 'out',
        accessTime: '2026-07-20T16:00:00+07:00',
      },
      {
        userCode: null,
        plateNumber: 'SEEDTEST02',
        direction: 'in',
        accessTime: '2026-07-21T09:10:00+07:00',
      },
      {
        userCode: null,
        plateNumber: 'SEEDTEST02',
        direction: 'out',
        accessTime: '2026-07-21T16:20:00+07:00',
      },

      // ── Case C (EX1): "Vào" đơn lẻ, không bao giờ có "Ra" (2 dòng) ──
      {
        userCode: emp6,
        plateNumber: 'SEEDTEST03',
        direction: 'in',
        accessTime: '2026-07-19T08:00:00+07:00',
      },
      {
        userCode: null,
        plateNumber: 'SEEDTEST04',
        direction: 'in',
        accessTime: '2026-07-19T08:30:00+07:00',
      },

      // ── Case D (EX2): "Ra" đơn lẻ, không có "Vào" trong 24h trước (1 dòng) ──
      {
        userCode: null,
        plateNumber: 'SEEDTEST05',
        direction: 'out',
        accessTime: '2026-07-22T20:00:00+07:00',
      },

      // ── Case E (BR1 FIFO): 2 "Vào" cùng user + 1 "Ra" → phải ghép ứng viên GẦN NHẤT (3 dòng) ──
      {
        userCode: emp1,
        plateNumber: '30A12345',
        direction: 'in',
        accessTime: '2026-07-22T07:00:00+07:00',
      },
      {
        userCode: emp1,
        plateNumber: '30A12345',
        direction: 'in',
        accessTime: '2026-07-22T07:50:00+07:00',
      },
      {
        userCode: emp1,
        plateNumber: '30A12345',
        direction: 'out',
        accessTime: '2026-07-22T08:10:00+07:00',
      },
    ];

    for (const r of rows) {
      await queryRunner.query(
        `INSERT INTO gate_access_logs (zone_id, user_id, plate_number, direction, access_time, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          zoneId,
          r.userCode,
          r.plateNumber,
          r.direction,
          r.accessTime,
          JSON.stringify({ seed_batch: SEED_BATCH_TAG }),
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM gate_access_logs WHERE metadata_json->>'seed_batch' = $1`,
      [SEED_BATCH_TAG],
    );
    // Chỉ xóa zone test nếu KHÔNG còn bảng nào khác tham chiếu (an toàn, defensive).
    await queryRunner.query(
      `DELETE FROM zones z
        WHERE z.zone_code = $1
          AND NOT EXISTS (SELECT 1 FROM gate_access_logs WHERE zone_id = z.id)
          AND NOT EXISTS (SELECT 1 FROM iot_devices WHERE zone_id = z.id)
          AND NOT EXISTS (SELECT 1 FROM iot_device_events WHERE zone_id = z.id)
          AND NOT EXISTS (SELECT 1 FROM zone_presence_events WHERE zone_id = z.id)`,
      [ZONE_CODE],
    );
  }

  private async ensureZone(queryRunner: QueryRunner): Promise<string> {
    const existing = (await queryRunner.query(
      `SELECT id FROM zones WHERE zone_code = $1 AND deleted_at IS NULL`,
      [ZONE_CODE],
    )) as Array<{ id: string }>;
    if (existing[0]) {
      return existing[0].id;
    }
    const inserted = (await queryRunner.query(
      `INSERT INTO zones (zone_code, zone_name, zone_type, building, floor, description, status)
       VALUES ($1, $2, 'gate', 'Test Building', 'G', $3, 'active')
       RETURNING id`,
      [
        ZONE_CODE,
        'Cổng Test Seed Bước 2',
        'Zone seed phục vụ verify GAP-001/GAH-001 (Bước 2 SAVP) — có thể xóa sau khi verify xong qua down() migration này',
      ],
    )) as Array<{ id: string }>;
    return inserted[0].id;
  }

  private async resolveUserId(
    queryRunner: QueryRunner,
    employeeCode: string,
  ): Promise<string> {
    const rows = (await queryRunner.query(
      `SELECT id FROM users WHERE employee_code = $1 AND deleted_at IS NULL LIMIT 1`,
      [employeeCode],
    )) as Array<{ id: string }>;
    if (!rows[0]) {
      throw new Error(
        `SeedGateAccessDemoLogsForVerify: không tìm thấy user ${employeeCode} — cần seed demo users trước (20260720000003)`,
      );
    }
    return rows[0].id;
  }
}
