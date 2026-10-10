import { toPublicVisitView, toVisitView, VisitRow } from './visit-view.presenter.js';

const row = (over: Partial<VisitRow> = {}): VisitRow => ({
  id: 'v1', visit_code: 'VS-261012-0001', channel: 'online', status: 'checked_in', host_user_id: 'h1', department_id: 'd1',
  purpose: 'Họp', companions: 1, plate_number: '30A-123.45', scheduled_from: new Date('2026-10-12T02:00:00Z'),
  scheduled_to: new Date('2026-10-12T04:00:00Z'), valid_from: new Date('2026-10-12T01:30:00Z'), valid_to: new Date('2026-10-12T04:30:00Z'),
  check_in_at: new Date('2026-10-12T02:05:00Z'), check_out_at: null, face_score: '0.9300', reject_reason: null, revoked_at: null,
  manual_exit: false, not_found: false, last_seen_at: new Date('2026-10-12T03:00:00Z'), last_seen_zone_id: 'z1', photo_file_id: 'm1',
  created_at: new Date('2026-10-11T02:00:00Z'), visitor_id: 'vis1', visitor_user_id: 'u1', visitor_name: 'Trần Thị Demo',
  id_number: '001099000111', phone_number: '0912345678', visitor_email: 'demo@example.com', organization: 'Công ty A',
  host_name: 'Nguyễn Văn An', department_name: 'Khoa CNTT', last_seen_zone_name: 'Cổng chính',
  zones: [{ id: 'z1', name: 'Cổng chính' }, { id: 'z2', name: 'Tòa B1' }],
  events: [{ at: '2026-10-12T02:05:00Z', type: 'check_in', note: 'ghi chú nội bộ', zoneId: 'z1', score: '0.9300', actor: null }],
  ...over,
});

const FE_KEYS = [
  'id', 'code', 'channel', 'status', 'visitor', 'hostId', 'hostName', 'departmentId', 'departmentName', 'purpose', 'companions',
  'scheduledFrom', 'scheduledTo', 'access', 'zoneNames', 'checkInAt', 'checkOutAt', 'faceScore', 'rejectReason', 'revokedAt',
  'manualExit', 'notFound', 'lastSeen', 'events', 'createdAt', 'overstay', 'overstayLevel', 'availableActions',
];

describe('visit-view.presenter', () => {
  it('có đủ các khóa FE đang đọc', () => {
    const v = toVisitView(row(), new Date('2026-10-12T03:00:00Z'));
    FE_KEYS.forEach((k) => expect(v).toHaveProperty(k));
    ['fullName', 'idNumber', 'phone', 'email', 'organization', 'plateNumber', 'photo', 'hasPhoto'].forEach((k) => expect(v.visitor).toHaveProperty(k));
    expect(v.access.zoneIds).toEqual(['z1', 'z2']);
    expect(v.faceScore).toBe(0.93);
    expect(v.lastSeen).toEqual({ at: '2026-10-12T03:00:00.000Z', zoneId: 'z1', zoneName: 'Cổng chính' });
  });

  it('quá giờ và mức leo thang', () => {
    expect(toVisitView(row(), new Date('2026-10-12T04:40:00Z')).overstayLevel).toBe(1);
    expect(toVisitView(row(), new Date('2026-10-12T05:05:00Z')).overstayLevel).toBe(2);
    expect(toVisitView(row(), new Date('2026-10-12T03:00:00Z')).overstay).toBe(false);
  });

  it('thao tác khả dụng không lộ thao tác hệ thống', () => {
    const v = toVisitView(row({ status: 'approved' }), new Date());
    expect(v.availableActions).toEqual(['check_in', 'revoke', 'cancel']);
    expect(toVisitView(row({ status: 'checked_in' }), new Date()).availableActions).not.toContain('mark_unrecorded');
  });

  it('không có ảnh → hasPhoto=false', () => {
    expect(toVisitView(row({ photo_file_id: null }), new Date()).visitor.hasPhoto).toBe(false);
  });

  it('bản công khai không chứa dữ liệu cá nhân', () => {
    const pub = JSON.stringify(toPublicVisitView(toVisitView(row(), new Date())));
    ['001099000111', '0912345678', 'demo@example.com', 'ghi chú nội bộ', '30A-123.45'].forEach((s) => expect(pub).not.toContain(s));
    expect(pub).toContain('Trần Thị Demo');
  });
});
