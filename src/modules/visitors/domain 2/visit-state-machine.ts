// Máy trạng thái lượt khách — hàm thuần (VIS-BE-001 §5). Chép từ FE `visitStateMachine.js`;
// khác FE: ngưỡng/đệm/số phút leo thang là tham số (từ VisitorConfigService) và so sánh "ngày" theo giờ Việt Nam.
import type { VisitStatus } from '../constants/visit-status.constant.js';

export type VisitAction =
  | 'approve' | 'reject' | 'cancel' | 'check_in' | 'check_out' | 'revoke'
  | 'expire' | 'close_manual' | 'mark_unrecorded';

/** Phần tối thiểu của một lượt mà các hàm dưới đây cần (cùng dạng `VisitView` của FE). */
export interface VisitLike {
  status: VisitStatus;
  visitor: { hasPhoto: boolean };
  access: { validFrom: string; validTo: string; zoneIds: string[] };
  revokedAt?: string | null;
}

export class VisitTransitionError extends Error {
  constructor(public readonly status: VisitStatus, public readonly action: VisitAction) {
    super(`Không thể thực hiện "${action}" khi lượt khách đang ở trạng thái "${status}"`);
    this.name = 'VisitTransitionError';
  }
}

const TRANSITIONS: Partial<Record<VisitStatus, Partial<Record<VisitAction, VisitStatus>>>> = {
  pending_approval: { approve: 'approved', reject: 'rejected', cancel: 'cancelled' },
  approved: { check_in: 'checked_in', revoke: 'revoked', cancel: 'cancelled', expire: 'expired' },
  // Thu hồi khi khách đang ở trong → phải rời nhưng vẫn được theo dõi tới khi ra (spec mockup §12.1).
  checked_in: { check_out: 'checked_out', revoke: 'must_leave', close_manual: 'checked_out', mark_unrecorded: 'exit_unrecorded' },
  must_leave: { check_out: 'checked_out', close_manual: 'checked_out', mark_unrecorded: 'exit_unrecorded' },
  exit_unrecorded: { close_manual: 'checked_out' },
};

export const TERMINAL_STATUSES: VisitStatus[] = ['checked_out', 'rejected', 'cancelled', 'revoked', 'expired'];

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

export const canTransition = (status: VisitStatus, action: VisitAction): boolean => Boolean(TRANSITIONS[status]?.[action]);

export const nextStatus = (status: VisitStatus, action: VisitAction): VisitStatus => {
  const to = TRANSITIONS[status]?.[action];
  if (!to) throw new VisitTransitionError(status, action);
  return to;
};

export const availableActions = (status: VisitStatus): VisitAction[] => Object.keys(TRANSITIONS[status] ?? {}) as VisitAction[];

export const canExtend = (visit: VisitLike, newValidTo: string | Date): boolean =>
  (visit.status === 'approved' || visit.status === 'checked_in') &&
  new Date(newValidTo).getTime() > new Date(visit.access.validTo).getTime();

export const isOnSite = (visit: Pick<VisitLike, 'status'>): boolean => visit.status === 'checked_in' || visit.status === 'must_leave';

export const isOverstay = (visit: VisitLike, now: Date = new Date()): boolean =>
  visit.status === 'checked_in' && now.getTime() > new Date(visit.access.validTo).getTime();

/** 0: trong hạn · 1: vừa quá giờ (báo người được gặp) · 2: quá `escalateMinutes` (báo bảo vệ). BR-V13. */
export const overstayLevel = (visit: VisitLike, now: Date = new Date(), escalateMinutes = 30): 0 | 1 | 2 => {
  if (!isOverstay(visit, now)) return 0;
  return now.getTime() - new Date(visit.access.validTo).getTime() >= escalateMinutes * MIN_MS ? 2 : 1;
};

/** BR-V15: sang ngày mới (giờ VN) sau ngày hết hiệu lực — khách phải rời: sau ngày bị thu hồi — mà chưa có giờ ra. */
export const shouldMarkExitUnrecorded = (visit: VisitLike, now: Date = new Date()): boolean => {
  if (!isOnSite(visit)) return false;
  const reference = new Date(visit.status === 'must_leave' && visit.revokedAt ? visit.revokedAt : visit.access.validTo).getTime();
  const startOfTodayVn = Math.floor((now.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
  return reference < startOfTodayVn;
};

export const shouldExpire = (visit: VisitLike, now: Date = new Date()): boolean =>
  visit.status === 'approved' && now.getTime() > new Date(visit.access.validTo).getTime();

export const defaultAccessWindow = (
  scheduledFrom: string | Date,
  scheduledTo: string | Date,
  bufferMinutes = 30,
): { validFrom: string; validTo: string } => ({
  validFrom: new Date(new Date(scheduledFrom).getTime() - bufferMinutes * MIN_MS).toISOString(),
  validTo: new Date(new Date(scheduledTo).getTime() + bufferMinutes * MIN_MS).toISOString(),
});

export type GateOutcome = 'checked_in' | 'manual_review' | 'access_denied';
export type GateReason =
  | 'access_revoked' | 'already_inside' | 'invalid_status' | 'outside_window'
  | 'zone_not_allowed' | 'no_photo' | 'low_score';

/** BR-V5, BR-V6. Thứ tự kiểm tra: trạng thái → khung giờ → khu vực → ảnh → độ khớp. */
export const evaluateGateAttempt = (
  visit: VisitLike,
  input: { at: string | Date; zoneId: string | null; score: number | null },
  threshold = 0.8,
): { outcome: GateOutcome; reason: GateReason | null } => {
  if (visit.status === 'must_leave') return { outcome: 'access_denied', reason: 'access_revoked' };
  if (visit.status === 'checked_in') return { outcome: 'access_denied', reason: 'already_inside' };
  if (visit.status !== 'approved') return { outcome: 'access_denied', reason: 'invalid_status' };
  const t = new Date(input.at).getTime();
  if (t < new Date(visit.access.validFrom).getTime() || t > new Date(visit.access.validTo).getTime()) {
    return { outcome: 'access_denied', reason: 'outside_window' };
  }
  if (!input.zoneId || !visit.access.zoneIds.includes(input.zoneId)) return { outcome: 'access_denied', reason: 'zone_not_allowed' };
  if (!visit.visitor.hasPhoto) return { outcome: 'manual_review', reason: 'no_photo' };
  if (input.score === null || input.score < threshold) return { outcome: 'manual_review', reason: 'low_score' };
  return { outcome: 'checked_in', reason: null };
};
