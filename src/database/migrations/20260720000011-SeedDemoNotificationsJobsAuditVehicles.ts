import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier 2 demo data (phan cuoi): notifications, background_jobs, audit_logs,
 * vehicle_registrations, system_configs bo sung. Hoan tat 41/41 bang co du lieu demo
 * (tru face_profiles — co chu y bo qua, xem ghi chu cuoi migration nay).
 */
export class SeedDemoNotificationsJobsAuditVehicles20260720000011 implements MigrationInterface {
  name = 'SeedDemoNotificationsJobsAuditVehicles20260720000011';

  private readonly vehicleRegs: Array<{
    username: string;
    plateRaw: string;
    plateNumber: string;
    type: string;
  }> = [
    {
      username: 'sysadmin',
      plateRaw: '30A-123.45',
      plateNumber: '30A12345',
      type: 'car',
    },
    {
      username: 'manager.it',
      plateRaw: '29H1-678.90',
      plateNumber: '29H167890',
      type: 'motorbike',
    },
    {
      username: 'emp.it1',
      plateRaw: '30F-555.66',
      plateNumber: '30F55566',
      type: 'car',
    },
    {
      username: 'emp.hr1',
      plateRaw: '29G1-234.56',
      plateNumber: '29G123456',
      type: 'motorbike',
    },
    {
      username: 'manager.sales',
      plateRaw: '30K-888.99',
      plateNumber: '30K88899',
      type: 'car',
    },
  ];

  private readonly systemConfigs: Array<{
    key: string;
    group: string;
    valueType: string;
    value: string | null;
    json: object | null;
    description: string;
  }> = [
    {
      key: 'org.timezone_default',
      group: 'organization',
      valueType: 'string',
      value: 'Asia/Ho_Chi_Minh',
      json: null,
      description: 'Mui gio mac dinh cho toan he thong (demo seed data)',
    },
    {
      key: 'no_show.auto_release_enabled',
      group: 'utilization',
      valueType: 'boolean',
      value: 'false',
      json: null,
      description:
        'Bat/tat auto-release phong khi phat hien no-show (demo seed data, mac dinh tat theo CLAUDE.md muc 23)',
    },
    {
      key: 'recording.retention_days_default',
      group: 'recording',
      valueType: 'number',
      value: '90',
      json: null,
      description:
        'So ngay luu tru mac dinh cho file recording (demo seed data)',
    },
  ];

  /** Dữ liệu demo đã gỡ khỏi luồng migration — chỉ giữ data thật. down() vẫn dọn được demo cũ. */
  public async up(): Promise<void> {}

  /** Seed demo cũ — không còn chạy tự động. */
  public async seedDemo(queryRunner: QueryRunner): Promise<void> {
    const sysAdminRow = (await queryRunner.query(
      `SELECT id FROM users WHERE lower(username) = 'sysadmin';`,
    )) as Array<{ id: string }>;
    const sysAdminId = sysAdminRow[0]?.id ?? null;

    // notifications
    const notifications: Array<{
      type: string;
      channel: string;
      subject: string;
      content: string;
      entityType: string | null;
      entityMeetingCode: string | null;
      sentBy: string;
    }> = [
      {
        type: 'meeting_invite',
        channel: 'in_app',
        subject: 'Loi moi hop: IT Weekly Sync',
        content: 'Ban duoc moi tham gia cuoc hop IT Weekly Sync.',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-013',
        sentBy: 'manager.it',
      },
      {
        type: 'reminder',
        channel: 'in_app',
        subject: 'Nhac lich: Recruitment Review',
        content: 'Cuoc hop Recruitment Review se bat dau trong 30 phut nua.',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-014',
        sentBy: 'bizadmin.hr',
      },
      {
        type: 'cancellation',
        channel: 'email',
        subject: 'Cuoc hop da bi huy: Executive Weekly',
        content:
          'Cuoc hop Executive Weekly da bi huy. Ly do: Trung lich cong tac cua Ban Giam doc.',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-011',
        sentBy: 'sysadmin',
      },
      {
        type: 'no_show_alert',
        channel: 'in_app',
        subject: 'Canh bao no-show: Executive Weekly',
        content:
          'Khong phat hien participant check-in cho cuoc hop Executive Weekly.',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-011',
        sentBy: 'sysadmin',
      },
      {
        type: 'minutes_distribution',
        channel: 'email',
        subject: 'Bien ban hop da phat hanh: Weekly IT Sync',
        content:
          'Bien ban cuoc hop Weekly IT Sync da duoc phat hanh, xem chi tiet trong he thong.',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-001',
        sentBy: 'manager.it',
      },
      {
        type: 'late_checkin_alert',
        channel: 'in_app',
        subject: 'Canh bao check-in tre: Sprint Planning',
        content:
          'Mot thanh vien check-in tre 12 phut trong cuoc hop Sprint Planning.',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-004',
        sentBy: 'emp.it1',
      },
      {
        type: 'meeting_request_approved',
        channel: 'in_app',
        subject: 'Yeu cau hop da duoc duyet',
        content: 'Yeu cau tao cuoc hop IT Weekly Sync da duoc phe duyet.',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-013',
        sentBy: 'bizadmin.it',
      },
      {
        type: 'account_welcome',
        channel: 'email',
        subject: 'Chao mung ban den voi he thong',
        content:
          'Tai khoan cua ban da duoc tao. Vui long dang nhap va doi mat khau lan dau.',
        entityType: null,
        entityMeetingCode: null,
        sentBy: 'sysadmin',
      },
    ];

    for (const n of notifications) {
      await queryRunner.query(
        `INSERT INTO notifications (
           notification_type, channel, subject, content, related_entity_type, related_entity_id,
           recipient_scope, delivery_status, sent_at, sent_by, created_by
         )
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::text, $5::varchar,
                (CASE WHEN $6::varchar IS NULL THEN NULL ELSE (SELECT id FROM meetings WHERE meeting_code = $6) END),
                'user_list', 'sent', NOW(),
                (SELECT id FROM users WHERE lower(username) = lower($7)),
                (SELECT id FROM users WHERE lower(username) = lower($7))
         WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE subject = $3 AND content = $4);`,
        [
          n.type,
          n.channel,
          n.subject,
          n.content,
          n.entityType,
          n.entityMeetingCode,
          n.sentBy,
        ],
      );
    }

    // background_jobs
    const jobs: Array<{
      type: string;
      entityType: string | null;
      entityMeetingCode: string | null;
      requestedBy: string;
      input: object;
    }> = [
      {
        type: 'transcription',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-001',
        requestedBy: 'manager.it',
        input: { note: 'Demo seed transcription job' },
      },
      {
        type: 'export_minutes',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-002',
        requestedBy: 'sysadmin',
        input: { format: 'pdf' },
      },
      {
        type: 'send_email',
        entityType: null,
        entityMeetingCode: null,
        requestedBy: 'sysadmin',
        input: { batch: 'demo-seed-notifications' },
      },
    ];
    for (const j of jobs) {
      await queryRunner.query(
        `INSERT INTO background_jobs (
           job_type, related_entity_type, related_entity_id, requested_by, status,
           started_at, completed_at, input_json, output_json
         )
         SELECT $1::varchar, $2::varchar,
                (CASE WHEN $3::varchar IS NULL THEN NULL ELSE (SELECT id FROM meetings WHERE meeting_code = $3) END),
                (SELECT id FROM users WHERE lower(username) = lower($4)), 'completed',
                NOW() - interval '1 hour', NOW() - interval '55 minutes', $5::jsonb, '{"result": "ok (demo seed)"}'::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM background_jobs WHERE job_type = $1 AND input_json = $5::jsonb
         );`,
        [
          j.type,
          j.entityType,
          j.entityMeetingCode,
          j.requestedBy,
          JSON.stringify(j.input),
        ],
      );
    }

    // audit_logs
    const auditEntries: Array<{
      username: string | null;
      action: string;
      entityType: string;
      entityMeetingCode: string | null;
      severity: string;
    }> = [
      {
        username: 'sysadmin',
        action: 'login_success',
        entityType: 'user',
        entityMeetingCode: null,
        severity: 'info',
      },
      {
        username: 'sysadmin',
        action: 'user_create',
        entityType: 'user',
        entityMeetingCode: null,
        severity: 'info',
      },
      {
        username: 'bizadmin.it',
        action: 'role_assign',
        entityType: 'user_role',
        entityMeetingCode: null,
        severity: 'info',
      },
      {
        username: 'sysadmin',
        action: 'meeting_cancel',
        entityType: 'meeting',
        entityMeetingCode: 'MTG-2026-011',
        severity: 'warning',
      },
      {
        username: 'manager.it',
        action: 'meeting_request_approve',
        entityType: 'meeting_request',
        entityMeetingCode: 'MTG-2026-013',
        severity: 'info',
      },
      {
        username: null,
        action: 'login_failed',
        entityType: 'user',
        entityMeetingCode: null,
        severity: 'warning',
      },
    ];
    for (const a of auditEntries) {
      await queryRunner.query(
        `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
         SELECT (CASE WHEN $1::varchar IS NULL THEN NULL ELSE (SELECT id FROM users WHERE lower(username) = lower($1)) END),
                $2::varchar, $3::varchar,
                (CASE WHEN $4::varchar IS NULL THEN NULL ELSE (SELECT id FROM meetings WHERE meeting_code = $4) END),
                $5::varchar, '{"source": "demo-seed"}'::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM audit_logs WHERE action_type = $2 AND entity_type = $3 AND metadata_json ->> 'source' = 'demo-seed'
             AND (($1::varchar IS NULL AND user_id IS NULL) OR user_id = (SELECT id FROM users WHERE lower(username) = lower($1)))
         );`,
        [a.username, a.action, a.entityType, a.entityMeetingCode, a.severity],
      );
    }

    // vehicle_registrations
    for (const v of this.vehicleRegs) {
      await queryRunner.query(
        `INSERT INTO vehicle_registrations (user_id, plate_number, plate_raw, vehicle_type, status)
         SELECT u.id, $2::varchar, $3::varchar, $4::varchar, 'active'
         FROM users u
         WHERE lower(u.username) = lower($1)
           AND NOT EXISTS (SELECT 1 FROM vehicle_registrations WHERE plate_number = $2 AND deleted_at IS NULL);`,
        [v.username, v.plateNumber, v.plateRaw, v.type],
      );
    }

    // system_configs bo sung
    for (const c of this.systemConfigs) {
      await queryRunner.query(
        `INSERT INTO system_configs (config_key, config_value, config_json, value_type, config_group, description, updated_by)
         SELECT $1::varchar, $2::text, $3::jsonb, $4::varchar, $5::varchar, $6::text, $7::uuid
         WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = $1);`,
        [
          c.key,
          c.value,
          c.json ? JSON.stringify(c.json) : null,
          c.valueType,
          c.group,
          c.description,
          sysAdminId,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM system_configs WHERE config_key = ANY($1);`,
      [this.systemConfigs.map((c) => c.key)],
    );
    await queryRunner.query(
      `DELETE FROM vehicle_registrations WHERE plate_number = ANY($1);`,
      [this.vehicleRegs.map((v) => v.plateNumber)],
    );
    await queryRunner.query(
      `DELETE FROM audit_logs WHERE metadata_json ->> 'source' = 'demo-seed';`,
    );
    await queryRunner.query(
      `DELETE FROM background_jobs WHERE input_json ->> 'note' = 'Demo seed transcription job' OR input_json ->> 'batch' = 'demo-seed-notifications' OR (input_json ->> 'format') = 'pdf';`,
    );
    await queryRunner.query(
      `DELETE FROM notifications WHERE subject LIKE '%IT Weekly Sync%' OR subject LIKE '%Recruitment Review%' OR subject LIKE '%Executive Weekly%' OR subject LIKE '%Sprint Planning%' OR subject LIKE '%Yeu cau hop%' OR subject LIKE '%Chao mung%';`,
    );
  }
}
