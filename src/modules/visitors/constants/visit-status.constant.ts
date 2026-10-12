export const VISIT_STATUSES = [
  'pending_approval', 'approved', 'checked_in', 'checked_out', 'rejected',
  'cancelled', 'revoked', 'expired', 'must_leave', 'exit_unrecorded',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_CHANNELS = ['online', 'host_invite', 'walk_in'] as const;
export type VisitChannel = (typeof VISIT_CHANNELS)[number];

export const VISIT_EVENT_TYPES = [
  'registered', 'approved', 'rejected', 'cancelled', 'revoked', 'extended', 'photo_added',
  'face_verified', 'manual_review', 'access_denied', 'check_in', 'check_out', 'expired',
  'face_removed', 'email_sent', 'host_notified', 'security_notified', 'manual_close', 'exit_unrecorded',
] as const;
export type VisitEventType = (typeof VISIT_EVENT_TYPES)[number];

/** Nhóm "đã đóng" của tab Từ chối / Hết hạn (FE: status=closed). */
export const CLOSED_STATUSES: VisitStatus[] = ['rejected', 'cancelled', 'revoked', 'expired', 'exit_unrecorded'];
/** Lượt đang giữ quyền ra vào hoặc đang ở trong khuôn viên. */
export const ACTIVE_STATUSES: VisitStatus[] = ['approved', 'checked_in', 'must_leave'];

export const VISITOR_DEPARTMENT_ID = '8d4f3a2b-5c7b-4a3f-8e9d-2b3c4d5e6f70';
export const VISITOR_DEPARTMENT_CODE = 'VISITOR';
