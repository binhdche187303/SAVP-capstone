import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier 1 demo data: room_bookings (1 cho moi meeting co room o 20260720000007),
 * 5 meeting_requests, meeting_events (start/end/cancel cho cac meeting da qua),
 * 7 meeting_notes. Phu thuoc: 20260720000007-SeedDemoMeetings.ts da chay truoc do.
 */
export class SeedDemoBookingsRequestsEvents20260720000008 implements MigrationInterface {
  name = 'SeedDemoBookingsRequestsEvents20260720000008';

  // meeting_code -> [bookingCode, bookingStatus, bookedByUsername]
  private readonly bookings: Array<{
    meetingCode: string;
    bookingCode: string;
    status: string;
    bookedBy: string;
  }> = [
    {
      meetingCode: 'MTG-2026-001',
      bookingCode: 'BK-2026-001',
      status: 'completed',
      bookedBy: 'manager.it',
    },
    {
      meetingCode: 'MTG-2026-002',
      bookingCode: 'BK-2026-002',
      status: 'completed',
      bookedBy: 'sysadmin',
    },
    {
      meetingCode: 'MTG-2026-003',
      bookingCode: 'BK-2026-003',
      status: 'completed',
      bookedBy: 'manager.hr',
    },
    {
      meetingCode: 'MTG-2026-004',
      bookingCode: 'BK-2026-004',
      status: 'completed',
      bookedBy: 'emp.it1',
    },
    {
      meetingCode: 'MTG-2026-005',
      bookingCode: 'BK-2026-005',
      status: 'completed',
      bookedBy: 'manager.sales',
    },
    {
      meetingCode: 'MTG-2026-006',
      bookingCode: 'BK-2026-006',
      status: 'completed',
      bookedBy: 'bizadmin.it',
    },
    {
      meetingCode: 'MTG-2026-007',
      bookingCode: 'BK-2026-007',
      status: 'completed',
      bookedBy: 'manager.it',
    },
    {
      meetingCode: 'MTG-2026-008',
      bookingCode: 'BK-2026-008',
      status: 'completed',
      bookedBy: 'bizadmin.hr',
    },
    {
      meetingCode: 'MTG-2026-009',
      bookingCode: 'BK-2026-009',
      status: 'completed',
      bookedBy: 'emp.hr1',
    },
    {
      meetingCode: 'MTG-2026-010',
      bookingCode: 'BK-2026-010',
      status: 'completed',
      bookedBy: 'manager.sales',
    },
    {
      meetingCode: 'MTG-2026-011',
      bookingCode: 'BK-2026-011',
      status: 'cancelled',
      bookedBy: 'sysadmin',
    },
    {
      meetingCode: 'MTG-2026-012',
      bookingCode: 'BK-2026-012',
      status: 'active',
      bookedBy: 'manager.it',
    },
    {
      meetingCode: 'MTG-2026-013',
      bookingCode: 'BK-2026-013',
      status: 'approved',
      bookedBy: 'manager.it',
    },
    {
      meetingCode: 'MTG-2026-014',
      bookingCode: 'BK-2026-014',
      status: 'pending',
      bookedBy: 'bizadmin.hr',
    },
    {
      meetingCode: 'MTG-2026-015',
      bookingCode: 'BK-2026-015',
      status: 'approved',
      bookedBy: 'manager.hr',
    },
    {
      meetingCode: 'MTG-2026-016',
      bookingCode: 'BK-2026-016',
      status: 'approved',
      bookedBy: 'sysadmin',
    },
    {
      meetingCode: 'MTG-2026-017',
      bookingCode: 'BK-2026-017',
      status: 'approved',
      bookedBy: 'manager.sales',
    },
    {
      meetingCode: 'MTG-2026-018',
      bookingCode: 'BK-2026-018',
      status: 'pending',
      bookedBy: 'manager.it',
    },
  ];

  private readonly meetingRequests: Array<{
    code: string;
    type: string;
    meetingCode: string | null;
    requestedBy: string;
    status: string;
    decisionBy: string | null;
    rejectionReason: string | null;
    notes: string;
  }> = [
    {
      code: 'REQ-2026-001',
      type: 'create_meeting',
      meetingCode: 'MTG-2026-013',
      requestedBy: 'manager.it',
      status: 'approved',
      decisionBy: 'bizadmin.it',
      rejectionReason: null,
      notes: 'Yeu cau tao Weekly IT Sync ky toi',
    },
    {
      code: 'REQ-2026-002',
      type: 'update_time',
      meetingCode: 'MTG-2026-014',
      requestedBy: 'bizadmin.hr',
      status: 'pending',
      decisionBy: null,
      rejectionReason: null,
      notes: 'De xuat doi gio hop Recruitment Review sang 10h',
    },
    {
      code: 'REQ-2026-003',
      type: 'book_room',
      meetingCode: 'MTG-2026-016',
      requestedBy: 'sysadmin',
      status: 'approved',
      decisionBy: 'sysadmin',
      rejectionReason: null,
      notes: 'Dat phong B301 cho QBR',
    },
    {
      code: 'REQ-2026-004',
      type: 'create_meeting',
      meetingCode: null,
      requestedBy: 'emp.sales1',
      status: 'rejected',
      decisionBy: 'manager.sales',
      rejectionReason:
        'Trung lich voi Sales Pipeline Review, de nghi doi khung gio khac',
      notes: 'Yeu cau tao hop voi khach hang trung gio',
    },
    {
      code: 'REQ-2026-005',
      type: 'extend_meeting',
      meetingCode: 'MTG-2026-012',
      requestedBy: 'manager.it',
      status: 'pending',
      decisionBy: null,
      rejectionReason: null,
      notes: 'Xin gia han standup demo them 15 phut',
    },
  ];

  // meeting_code -> notes
  private readonly notes: Array<{
    meetingCode: string;
    author: string;
    content: string;
    pinned: boolean;
  }> = [
    {
      meetingCode: 'MTG-2026-001',
      author: 'manager.it',
      content:
        'Team dong y uu tien fix bug production truoc khi lam feature moi.',
      pinned: true,
    },
    {
      meetingCode: 'MTG-2026-002',
      author: 'sysadmin',
      content: 'Board thong qua ngan sach mo rong nhan su Q4.',
      pinned: true,
    },
    {
      meetingCode: 'MTG-2026-003',
      author: 'manager.hr',
      content:
        'Nhan vien moi can hoan thanh checklist onboarding truoc ngay 30.',
      pinned: false,
    },
    {
      meetingCode: 'MTG-2026-005',
      author: 'manager.sales',
      content: 'Pipeline quy nay vuot 20% so voi ke hoach.',
      pinned: false,
    },
    {
      meetingCode: 'MTG-2026-007',
      author: 'manager.it',
      content: 'Se lam PoC kien truc moi trong 2 tuan toi.',
      pinned: false,
    },
    {
      meetingCode: 'MTG-2026-008',
      author: 'bizadmin.hr',
      content: 'Chinh sach nghi phep moi ap dung tu thang sau.',
      pinned: false,
    },
    {
      meetingCode: 'MTG-2026-010',
      author: 'manager.sales',
      content: 'Da lien he khach hang va cam ket phan hoi trong 48h.',
      pinned: true,
    },
  ];

  /** Dữ liệu demo đã gỡ khỏi luồng migration — chỉ giữ data thật. down() vẫn dọn được demo cũ. */
  public async up(): Promise<void> {}

  /** Seed demo cũ — không còn chạy tự động. */
  public async seedDemo(queryRunner: QueryRunner): Promise<void> {
    for (const b of this.bookings) {
      await queryRunner.query(
        `INSERT INTO room_bookings (booking_code, meeting_id, room_id, reserved_start_time, reserved_end_time, status, booked_by, approved_by, approved_at)
         SELECT $2::varchar, mt.id, mt.room_id, mt.start_time, mt.end_time, $3::varchar,
                (SELECT id FROM users WHERE lower(username) = lower($4)),
                (CASE WHEN $3 IN ('approved', 'active', 'completed') THEN (SELECT id FROM users WHERE lower(username) = 'sysadmin') ELSE NULL END),
                (CASE WHEN $3 IN ('approved', 'active', 'completed') THEN NOW() ELSE NULL END)
         FROM meetings mt
         WHERE mt.meeting_code = $1 AND mt.room_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM room_bookings WHERE booking_code = $2);`,
        [b.meetingCode, b.bookingCode, b.status, b.bookedBy],
      );
    }

    for (const r of this.meetingRequests) {
      await queryRunner.query(
        `INSERT INTO meeting_requests (
           request_code, meeting_id, request_type, requested_by, approval_status,
           decision_by, decision_at, rejection_reason, notes
         )
         SELECT $1::varchar,
                (CASE WHEN $3::varchar IS NULL THEN NULL ELSE (SELECT id FROM meetings WHERE meeting_code = $3) END),
                $2::varchar, (SELECT id FROM users WHERE lower(username) = lower($4)), $5::varchar,
                (CASE WHEN $6::varchar IS NULL THEN NULL ELSE (SELECT id FROM users WHERE lower(username) = lower($6)) END),
                (CASE WHEN $5 IN ('approved', 'rejected') THEN NOW() ELSE NULL END),
                $7::text, $8::text
         WHERE NOT EXISTS (SELECT 1 FROM meeting_requests WHERE request_code = $1);`,
        [
          r.code,
          r.type,
          r.meetingCode,
          r.requestedBy,
          r.status,
          r.decisionBy,
          r.rejectionReason,
          r.notes,
        ],
      );
    }

    // meeting_events: started/ended cho completed, cancelled event cho cancelled, started cho in_progress.
    await queryRunner.query(
      `INSERT INTO meeting_events (meeting_id, event_type, event_time, actor_user_id, source_type, description)
       SELECT mt.id, 'meeting_started', mt.actual_start_time, mt.organizer_id, 'manual', 'Cuoc hop bat dau'
       FROM meetings mt
       WHERE mt.status IN ('completed', 'in_progress') AND mt.actual_start_time IS NOT NULL
         AND mt.meeting_code LIKE 'MTG-2026-%'
         AND NOT EXISTS (
           SELECT 1 FROM meeting_events me WHERE me.meeting_id = mt.id AND me.event_type = 'meeting_started'
         );`,
    );
    await queryRunner.query(
      `INSERT INTO meeting_events (meeting_id, event_type, event_time, actor_user_id, source_type, description)
       SELECT mt.id, 'meeting_ended', mt.actual_end_time, mt.organizer_id, 'manual', 'Cuoc hop ket thuc'
       FROM meetings mt
       WHERE mt.status = 'completed' AND mt.actual_end_time IS NOT NULL
         AND mt.meeting_code LIKE 'MTG-2026-%'
         AND NOT EXISTS (
           SELECT 1 FROM meeting_events me WHERE me.meeting_id = mt.id AND me.event_type = 'meeting_ended'
         );`,
    );
    await queryRunner.query(
      `INSERT INTO meeting_events (meeting_id, event_type, event_time, actor_user_id, source_type, description, old_value_json, new_value_json)
       SELECT mt.id, 'status_changed', mt.updated_at, mt.organizer_id, 'manual', 'Cuoc hop bi huy: ' || COALESCE(mt.cancellation_reason, ''),
              '{"status":"scheduled"}'::jsonb, '{"status":"cancelled"}'::jsonb
       FROM meetings mt
       WHERE mt.status = 'cancelled' AND mt.meeting_code LIKE 'MTG-2026-%'
         AND NOT EXISTS (
           SELECT 1 FROM meeting_events me WHERE me.meeting_id = mt.id AND me.event_type = 'status_changed'
         );`,
    );

    for (const n of this.notes) {
      await queryRunner.query(
        `INSERT INTO meeting_notes (meeting_id, author_id, note_type, content, pinned)
         SELECT mt.id, (SELECT id FROM users WHERE lower(username) = lower($2)), 'in_meeting', $3::text, $4::boolean
         FROM meetings mt
         WHERE mt.meeting_code = $1
           AND NOT EXISTS (SELECT 1 FROM meeting_notes mn WHERE mn.meeting_id = mt.id AND mn.content = $3);`,
        [n.meetingCode, n.author, n.content, n.pinned],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const meetingCodes = this.bookings.map((b) => b.meetingCode);
    const meetingIdsSub = `(SELECT id FROM meetings WHERE meeting_code = ANY($1))`;

    await queryRunner.query(
      `DELETE FROM meeting_notes WHERE meeting_id IN ${meetingIdsSub};`,
      [meetingCodes],
    );
    await queryRunner.query(
      `DELETE FROM meeting_events WHERE meeting_id IN ${meetingIdsSub} AND event_type IN ('meeting_started', 'meeting_ended', 'status_changed');`,
      [meetingCodes],
    );
    await queryRunner.query(
      `DELETE FROM meeting_requests WHERE request_code = ANY($1);`,
      [this.meetingRequests.map((r) => r.code)],
    );
    await queryRunner.query(
      `DELETE FROM room_bookings WHERE booking_code = ANY($1);`,
      [this.bookings.map((b) => b.bookingCode)],
    );
  }
}
