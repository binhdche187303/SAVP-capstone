import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier 1 demo data: 2 meeting_recurrence_rules, 18 meetings (10 completed, 1 cancelled,
 * 1 in_progress "hom nay", 6 scheduled), meeting_participants, 2 meeting_external_participants,
 * meeting_agendas cho 8 meeting quan trong.
 *
 * Thoi gian duoc tinh TUONG DOI theo thoi diem chay migration (new Date() trong JS,
 * khong hardcode ngay thang tuyet doi) de du lieu demo luon "tuoi" bat ke migration
 * chay luc nao. Phu thuoc: 20260720000001 (departments), 20260720000003 (users),
 * 20260720000006 (rooms) da chay truoc do.
 */
export class SeedDemoMeetings20260720000007 implements MigrationInterface {
  name = 'SeedDemoMeetings20260720000007';

  private readonly recurrenceRules: Array<{
    key: string;
    type: string;
    interval: number;
    daysOfWeek: string | null;
  }> = [
    { key: 'weekly-it-sync', type: 'weekly', interval: 1, daysOfWeek: 'MO' },
    { key: 'monthly-qbr', type: 'monthly', interval: 1, daysOfWeek: null },
  ];

  private readonly meetings: Array<{
    code: string;
    title: string;
    description: string;
    organizer: string;
    host: string;
    roomCode: string;
    offsetDays: number;
    hour: number;
    minute: number;
    durationMinutes: number;
    status: string;
    type: string;
    cancellationReason?: string;
    participants: string[];
    agenda?: Array<{ title: string; owner: string; minutes: number }>;
    external?: Array<{ name: string; email: string; org: string }>;
    recurrenceKey?: string;
    parentMeetingCode?: string;
  }> = [
    {
      code: 'MTG-2026-001',
      title: 'Weekly IT Sync',
      description: 'Dong bo cong viec tuan cua team IT',
      organizer: 'manager.it',
      host: 'manager.it',
      roomCode: 'RM-A101',
      offsetDays: -20,
      hour: 9,
      minute: 0,
      durationMinutes: 60,
      status: 'completed',
      type: 'normal',
      participants: ['manager.it', 'emp.it1', 'emp.it2'],
      agenda: [
        { title: 'Review sprint truoc', owner: 'manager.it', minutes: 20 },
        { title: 'Ke hoach sprint moi', owner: 'manager.it', minutes: 30 },
      ],
    },
    {
      code: 'MTG-2026-002',
      title: 'Board Strategy Review',
      description: 'Ra soat chien luoc quy',
      organizer: 'sysadmin',
      host: 'sysadmin',
      roomCode: 'RM-B301',
      offsetDays: -18,
      hour: 14,
      minute: 0,
      durationMinutes: 90,
      status: 'completed',
      type: 'normal',
      participants: ['sysadmin', 'bizadmin.it', 'bizadmin.hr', 'manager.sales'],
      agenda: [
        { title: 'Ket qua kinh doanh quy', owner: 'sysadmin', minutes: 30 },
        { title: 'Dinh huong quy toi', owner: 'sysadmin', minutes: 40 },
      ],
    },
    {
      code: 'MTG-2026-003',
      title: 'Onboarding Training Q3',
      description: 'Dao tao hoi nhap nhan vien moi',
      organizer: 'manager.hr',
      host: 'manager.hr',
      roomCode: 'RM-A201',
      offsetDays: -15,
      hour: 9,
      minute: 0,
      durationMinutes: 120,
      status: 'completed',
      type: 'training',
      participants: ['manager.hr', 'emp.hr1', 'emp.hr2', 'emp.admin1'],
    },
    {
      code: 'MTG-2026-004',
      title: 'Sprint Planning',
      description: 'Len ke hoach sprint',
      organizer: 'emp.it1',
      host: 'emp.it1',
      roomCode: 'RM-A102',
      offsetDays: -14,
      hour: 10,
      minute: 0,
      durationMinutes: 45,
      status: 'completed',
      type: 'normal',
      participants: ['emp.it1', 'emp.it2', 'manager.it'],
    },
    {
      code: 'MTG-2026-005',
      title: 'Sales Pipeline Review',
      description: 'Ra soat pipeline ban hang',
      organizer: 'manager.sales',
      host: 'manager.sales',
      roomCode: 'RM-B302',
      offsetDays: -12,
      hour: 15,
      minute: 0,
      durationMinutes: 60,
      status: 'completed',
      type: 'normal',
      participants: ['manager.sales', 'emp.sales1', 'emp.sales2'],
      agenda: [
        {
          title: 'So lieu pipeline hien tai',
          owner: 'manager.sales',
          minutes: 25,
        },
        { title: 'Ke hoach chot deal', owner: 'manager.sales', minutes: 25 },
      ],
    },
    {
      code: 'MTG-2026-006',
      title: 'IT Budget Review',
      description: 'Ra soat ngan sach IT',
      organizer: 'bizadmin.it',
      host: 'bizadmin.it',
      roomCode: 'RM-A101',
      offsetDays: -10,
      hour: 11,
      minute: 0,
      durationMinutes: 60,
      status: 'completed',
      type: 'normal',
      participants: ['bizadmin.it', 'manager.it', 'sysadmin'],
    },
    {
      code: 'MTG-2026-007',
      title: 'Tech Talk: System Architecture',
      description: 'Chia se kien truc he thong',
      organizer: 'manager.it',
      host: 'manager.it',
      roomCode: 'RM-A201',
      offsetDays: -9,
      hour: 14,
      minute: 0,
      durationMinutes: 90,
      status: 'completed',
      type: 'normal',
      participants: ['manager.it', 'emp.it1', 'emp.it2', 'bizadmin.it'],
      agenda: [
        {
          title: 'Tong quan kien truc hien tai',
          owner: 'manager.it',
          minutes: 30,
        },
        { title: 'De xuat cai tien', owner: 'emp.it1', minutes: 30 },
        { title: 'Hoi dap', owner: 'manager.it', minutes: 20 },
      ],
    },
    {
      code: 'MTG-2026-008',
      title: 'HR Policy Update',
      description: 'Cap nhat chinh sach nhan su moi',
      organizer: 'sysadmin',
      host: 'bizadmin.hr',
      roomCode: 'RM-B301',
      offsetDays: -7,
      hour: 9,
      minute: 30,
      durationMinutes: 60,
      status: 'completed',
      type: 'normal',
      participants: ['bizadmin.hr', 'manager.hr', 'emp.hr1', 'emp.hr2'],
    },
    {
      code: 'MTG-2026-009',
      title: '1:1 Sync HR',
      description: 'Trao doi 1-1 dinh ky',
      organizer: 'emp.hr1',
      host: 'emp.hr1',
      roomCode: 'RM-A102',
      offsetDays: -5,
      hour: 10,
      minute: 0,
      durationMinutes: 30,
      status: 'completed',
      type: 'normal',
      participants: ['emp.hr1', 'manager.hr'],
    },
    {
      code: 'MTG-2026-010',
      title: 'Customer Escalation Review',
      description: 'Xu ly khieu nai khach hang lon',
      organizer: 'manager.sales',
      host: 'manager.sales',
      roomCode: 'RM-A101',
      offsetDays: -3,
      hour: 13,
      minute: 0,
      durationMinutes: 45,
      status: 'completed',
      type: 'normal',
      participants: ['manager.sales', 'emp.sales1'],
      external: [
        {
          name: 'Nguyen Van Khach',
          email: 'khach.hang@clientcorp.vn',
          org: 'ClientCorp JSC',
        },
      ],
      agenda: [
        { title: 'Tom tat van de', owner: 'manager.sales', minutes: 15 },
        { title: 'Phuong an xu ly', owner: 'manager.sales', minutes: 20 },
      ],
    },
    {
      code: 'MTG-2026-011',
      title: 'Executive Weekly',
      description: 'Hop giao ban lanh dao tuan',
      organizer: 'sysadmin',
      host: 'sysadmin',
      roomCode: 'RM-B301',
      offsetDays: -1,
      hour: 9,
      minute: 0,
      durationMinutes: 60,
      status: 'cancelled',
      type: 'normal',
      cancellationReason: 'Trung lich cong tac cua Ban Giam doc',
      participants: ['sysadmin', 'bizadmin.it', 'bizadmin.hr'],
    },
    {
      code: 'MTG-2026-012',
      title: 'Daily Standup Demo',
      description: 'Standup demo dang dien ra (seed de test live-meeting)',
      organizer: 'manager.it',
      host: 'manager.it',
      roomCode: 'RM-A201',
      offsetDays: 0,
      hour: 0,
      minute: 0,
      durationMinutes: 60,
      status: 'in_progress',
      type: 'normal',
      participants: ['manager.it', 'emp.it1', 'emp.it2'],
    },
    {
      code: 'MTG-2026-013',
      title: 'IT Weekly Sync',
      description: 'Dong bo cong viec tuan cua team IT',
      organizer: 'manager.it',
      host: 'manager.it',
      roomCode: 'RM-A101',
      offsetDays: 1,
      hour: 9,
      minute: 0,
      durationMinutes: 60,
      status: 'scheduled',
      type: 'normal',
      participants: ['manager.it', 'emp.it1', 'emp.it2'],
      recurrenceKey: 'weekly-it-sync',
    },
    {
      code: 'MTG-2026-014',
      title: 'Recruitment Review',
      description: 'Ra soat tien do tuyen dung',
      organizer: 'bizadmin.hr',
      host: 'bizadmin.hr',
      roomCode: 'RM-B302',
      offsetDays: 2,
      hour: 10,
      minute: 0,
      durationMinutes: 60,
      status: 'scheduled',
      type: 'normal',
      participants: ['bizadmin.hr', 'manager.hr', 'emp.hr1'],
    },
    {
      code: 'MTG-2026-015',
      title: 'New Hire Orientation',
      description: 'Dinh huong nhan vien moi',
      organizer: 'manager.hr',
      host: 'manager.hr',
      roomCode: 'RM-A201',
      offsetDays: 3,
      hour: 9,
      minute: 0,
      durationMinutes: 120,
      status: 'scheduled',
      type: 'training',
      participants: [
        'manager.hr',
        'emp.hr1',
        'emp.hr2',
        'emp.admin1',
        'emp.facility1',
      ],
    },
    {
      code: 'MTG-2026-016',
      title: 'Quarterly Business Review',
      description: 'Ra soat ket qua kinh doanh quy',
      organizer: 'sysadmin',
      host: 'sysadmin',
      roomCode: 'RM-B301',
      offsetDays: 5,
      hour: 14,
      minute: 0,
      durationMinutes: 120,
      status: 'scheduled',
      type: 'normal',
      participants: [
        'sysadmin',
        'bizadmin.it',
        'bizadmin.hr',
        'manager.it',
        'manager.hr',
        'manager.sales',
      ],
      recurrenceKey: 'monthly-qbr',
      agenda: [
        { title: 'Bao cao tai chinh quy', owner: 'sysadmin', minutes: 40 },
        {
          title: 'Bao cao van hanh cac phong ban',
          owner: 'sysadmin',
          minutes: 40,
        },
        { title: 'Dinh huong quy toi', owner: 'sysadmin', minutes: 40 },
      ],
    },
    {
      code: 'MTG-2026-017',
      title: 'Client Demo Prep',
      description: 'Chuan bi demo san pham cho khach hang',
      organizer: 'manager.sales',
      host: 'manager.sales',
      roomCode: 'RM-A102',
      offsetDays: 7,
      hour: 11,
      minute: 0,
      durationMinutes: 45,
      status: 'scheduled',
      type: 'normal',
      participants: ['manager.sales', 'emp.sales1', 'emp.sales2'],
      external: [
        {
          name: 'Tran Thi Doi Tac',
          email: 'doitac@partnerco.vn',
          org: 'PartnerCo Ltd',
        },
      ],
    },
    {
      code: 'MTG-2026-018',
      title: 'IT Weekly Sync',
      description: 'Dong bo cong viec tuan cua team IT (occurrence ke tiep)',
      organizer: 'manager.it',
      host: 'manager.it',
      roomCode: 'RM-A101',
      offsetDays: 8,
      hour: 9,
      minute: 0,
      durationMinutes: 60,
      status: 'scheduled',
      type: 'normal',
      participants: ['manager.it', 'emp.it1', 'emp.it2'],
      recurrenceKey: 'weekly-it-sync',
      parentMeetingCode: 'MTG-2026-013',
    },
  ];

  private buildTime(offsetDays: number, hour: number, minute: number): Date {
    const base = new Date();
    base.setSeconds(0, 0);
    base.setDate(base.getDate() + offsetDays);
    base.setHours(hour, minute, 0, 0);
    return base;
  }

  /** Dữ liệu demo đã gỡ khỏi luồng migration — chỉ giữ data thật. down() vẫn dọn được demo cũ. */
  public async up(): Promise<void> {}

  /** Seed demo cũ — không còn chạy tự động. */
  public async seedDemo(queryRunner: QueryRunner): Promise<void> {
    const ruleIdByKey = new Map<string, string>();
    for (const rule of this.recurrenceRules) {
      await queryRunner.query(
        `INSERT INTO meeting_recurrence_rules (recurrence_type, interval_value, days_of_week, start_date)
         SELECT $1::varchar, $2::integer, $3::varchar, CURRENT_DATE
         WHERE NOT EXISTS (
           SELECT 1 FROM meeting_recurrence_rules WHERE recurrence_type = $1 AND COALESCE(days_of_week, '') = COALESCE($3, '')
         );`,
        [rule.type, rule.interval, rule.daysOfWeek],
      );
      const row = (await queryRunner.query(
        `SELECT id FROM meeting_recurrence_rules WHERE recurrence_type = $1 AND COALESCE(days_of_week, '') = COALESCE($2, '') ORDER BY created_at ASC LIMIT 1;`,
        [rule.type, rule.daysOfWeek],
      )) as Array<{ id: string }>;
      if (row[0]?.id) ruleIdByKey.set(rule.key, row[0].id);
    }

    for (const m of this.meetings) {
      const startTime =
        m.status === 'in_progress'
          ? new Date(Date.now() - 30 * 60000)
          : this.buildTime(m.offsetDays, m.hour, m.minute);
      const endTime =
        m.status === 'in_progress'
          ? new Date(Date.now() + 30 * 60000)
          : new Date(startTime.getTime() + m.durationMinutes * 60000);
      const isPast = m.status === 'completed' || m.status === 'cancelled';
      const actualStart = isPast
        ? startTime
        : m.status === 'in_progress'
          ? startTime
          : null;
      const actualEnd = m.status === 'completed' ? endTime : null;
      const recurrenceRuleId = m.recurrenceKey
        ? (ruleIdByKey.get(m.recurrenceKey) ?? null)
        : null;

      await queryRunner.query(
        `INSERT INTO meetings (
           meeting_code, title, description, organizer_id, host_id, room_id,
           meeting_type, meeting_mode, status, start_time, end_time,
           actual_start_time, actual_end_time, recurrence_rule_id, parent_meeting_id,
           cancellation_reason, created_by
         )
         SELECT
           $1::varchar, $2::varchar, $3::text,
           (SELECT id FROM users WHERE lower(username) = lower($4)),
           (SELECT id FROM users WHERE lower(username) = lower($5)),
           (SELECT id FROM rooms WHERE room_code = $6),
           $7::varchar, 'offline', $8::varchar, $9::timestamptz, $10::timestamptz,
           $11::timestamptz, $12::timestamptz, $13::uuid,
           (CASE WHEN $14::varchar IS NULL THEN NULL ELSE (SELECT id FROM meetings WHERE meeting_code = $14) END),
           $15,
           (SELECT id FROM users WHERE lower(username) = lower($4))
         WHERE NOT EXISTS (SELECT 1 FROM meetings WHERE meeting_code = $1);`,
        [
          m.code,
          m.title,
          m.description,
          m.organizer,
          m.host,
          m.roomCode,
          m.type,
          m.status,
          startTime,
          endTime,
          actualStart,
          actualEnd,
          recurrenceRuleId,
          m.parentMeetingCode ?? null,
          m.cancellationReason ?? null,
        ],
      );

      for (const username of m.participants) {
        const role = username === m.host ? 'host' : 'attendee';
        await queryRunner.query(
          `INSERT INTO meeting_participants (meeting_id, user_id, participant_role, invitation_status, attendance_status)
           SELECT mt.id, u.id, $3, $4, $5
           FROM meetings mt, users u
           WHERE mt.meeting_code = $1 AND lower(u.username) = lower($2)
             AND NOT EXISTS (
               SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = mt.id AND mp.user_id = u.id
             );`,
          [
            m.code,
            username,
            role,
            isPast || m.status === 'in_progress' ? 'accepted' : 'pending',
            isPast ? 'present' : 'not_checked_in',
          ],
        );
      }

      if (m.external) {
        for (const ext of m.external) {
          await queryRunner.query(
            `INSERT INTO meeting_external_participants (meeting_id, full_name, email, organization_name, invitation_status)
             SELECT mt.id, $2::varchar, $3::varchar, $4::varchar, 'accepted'
             FROM meetings mt
             WHERE mt.meeting_code = $1
               AND NOT EXISTS (
                 SELECT 1 FROM meeting_external_participants ep WHERE ep.meeting_id = mt.id AND ep.email = $3
               );`,
            [m.code, ext.name, ext.email, ext.org],
          );
        }
      }

      if (m.agenda) {
        let order = 1;
        for (const item of m.agenda) {
          await queryRunner.query(
            `INSERT INTO meeting_agendas (meeting_id, agenda_order, title, owner_id, planned_duration_minutes, status)
             SELECT mt.id, $2::integer, $3::varchar, (SELECT id FROM users WHERE lower(username) = lower($4)), $5::integer, $6::varchar
             FROM meetings mt
             WHERE mt.meeting_code = $1
               AND NOT EXISTS (
                 SELECT 1 FROM meeting_agendas ma WHERE ma.meeting_id = mt.id AND ma.agenda_order = $2
               );`,
            [
              m.code,
              order,
              item.title,
              item.owner,
              item.minutes,
              isPast ? 'done' : 'planned',
            ],
          );
          order += 1;
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = this.meetings.map((m) => m.code);
    await queryRunner.query(
      `DELETE FROM meeting_agendas WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code = ANY($1));`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM meeting_external_participants WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code = ANY($1));`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM meeting_participants WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code = ANY($1));`,
      [codes],
    );
    // Go parent_meeting_id truoc khi xoa de tranh vi pham self-FK.
    await queryRunner.query(
      `UPDATE meetings SET parent_meeting_id = NULL WHERE meeting_code = ANY($1);`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM meetings WHERE meeting_code = ANY($1);`,
      [codes],
    );
    const ruleTypes = this.recurrenceRules.map((r) => r.type);
    await queryRunner.query(
      `DELETE FROM meeting_recurrence_rules WHERE recurrence_type = ANY($1) AND id NOT IN (SELECT recurrence_rule_id FROM meetings WHERE recurrence_rule_id IS NOT NULL);`,
      [ruleTypes],
    );
  }
}
