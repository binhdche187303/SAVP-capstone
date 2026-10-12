import type { VisitStatus } from '../constants/visit-status.constant.js';
import { availableActions, isOverstay, overstayLevel, type VisitAction, type VisitLike } from '../domain/visit-state-machine.js';

/** Câu SQL đọc một lượt kèm mọi thứ `VisitView` cần (một truy vấn, không N+1). Điều kiện WHERE ghép thêm ở nơi dùng. */
export const VISIT_VIEW_SELECT = `
  SELECT v.id, v.visit_code, v.channel, v.status, v.host_user_id, v.department_id, v.purpose, v.companions,
         v.plate_number, v.scheduled_from, v.scheduled_to, v.valid_from, v.valid_to, v.check_in_at, v.check_out_at,
         v.face_score, v.reject_reason, v.revoked_at, v.manual_exit, v.not_found, v.last_seen_at, v.last_seen_zone_id,
         v.photo_file_id, v.created_at, v.visitor_id,
         vis.user_id AS visitor_user_id, vis.full_name AS visitor_name, vis.id_number, vis.phone_number, vis.email AS visitor_email,
         vis.organization,
         host.full_name AS host_name, d.department_name, lz.zone_name AS last_seen_zone_name,
         COALESCE((SELECT json_agg(json_build_object('id', z.id, 'name', z.zone_name) ORDER BY z.zone_name)
                     FROM visitor_visit_zones vz JOIN zones z ON z.id = vz.zone_id WHERE vz.visit_id = v.id), '[]'::json) AS zones,
         COALESCE((SELECT json_agg(json_build_object('at', e.event_time, 'type', e.event_type, 'note', e.note,
                                                    'zoneId', e.zone_id, 'score', e.score, 'actor', u.full_name)
                                   ORDER BY e.event_time, e.created_at)
                     FROM visitor_visit_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.visit_id = v.id), '[]'::json) AS events
    FROM visitor_visits v
    JOIN visitors vis ON vis.id = v.visitor_id
    JOIN users host ON host.id = v.host_user_id
    LEFT JOIN departments d ON d.id = v.department_id
    LEFT JOIN zones lz ON lz.id = v.last_seen_zone_id
   WHERE v.deleted_at IS NULL`;

export interface VisitRow {
  id: string; visit_code: string; channel: string; status: VisitStatus; host_user_id: string; department_id: string | null;
  purpose: string; companions: number; plate_number: string | null; scheduled_from: Date; scheduled_to: Date;
  valid_from: Date; valid_to: Date; check_in_at: Date | null; check_out_at: Date | null; face_score: string | null;
  reject_reason: string | null; revoked_at: Date | null; manual_exit: boolean; not_found: boolean;
  last_seen_at: Date | null; last_seen_zone_id: string | null; photo_file_id: string | null; created_at: Date; visitor_id: string;
  visitor_user_id: string; visitor_name: string; id_number: string | null; phone_number: string; visitor_email: string | null;
  organization: string | null; host_name: string; department_name: string | null; last_seen_zone_name: string | null;
  zones: Array<{ id: string; name: string }>;
  events: Array<{ at: string; type: string; note: string | null; zoneId: string | null; score: string | null; actor: string | null }>;
}

export interface VisitViewEvent {
  at: string; type: string; note: string | null; zoneId: string | null; score: number | null; actor: string | null;
}

/** Đúng các khóa FE đang đọc (`VisitView` của lớp giả). */
export interface VisitView {
  id: string; code: string; channel: string; status: VisitStatus;
  visitor: { id: string; fullName: string; idNumber: string | null; phone: string; email: string | null; organization: string | null; plateNumber: string | null; photo: string | null; hasPhoto: boolean };
  hostId: string; hostName: string; departmentId: string | null; departmentName: string; purpose: string; companions: number;
  scheduledFrom: string; scheduledTo: string;
  access: { validFrom: string; validTo: string; zoneIds: string[] };
  zoneNames: string[];
  checkInAt: string | null; checkOutAt: string | null; faceScore: number | null; rejectReason: string | null;
  revokedAt: string | null; manualExit: boolean; notFound: boolean;
  lastSeen: { at: string; zoneId: string | null; zoneName: string | null } | null;
  events: VisitViewEvent[]; createdAt: string;
  overstay: boolean; overstayLevel: 0 | 1 | 2; availableActions: VisitAction[];
}

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

export function toVisitView(row: VisitRow, now: Date, escalateMinutes = 30): VisitView {
  const access = { validFrom: iso(row.valid_from) as string, validTo: iso(row.valid_to) as string, zoneIds: row.zones.map((z) => z.id) };
  const like: VisitLike = { status: row.status, visitor: { hasPhoto: row.photo_file_id !== null }, access, revokedAt: iso(row.revoked_at) };
  return {
    id: row.id,
    code: row.visit_code,
    channel: row.channel,
    status: row.status,
    visitor: {
      id: row.visitor_id,
      fullName: row.visitor_name,
      idNumber: row.id_number,
      phone: row.phone_number,
      email: row.visitor_email,
      organization: row.organization,
      plateNumber: row.plate_number,
      photo: null,
      hasPhoto: row.photo_file_id !== null,
    },
    hostId: row.host_user_id,
    hostName: row.host_name,
    departmentId: row.department_id,
    departmentName: row.department_name ?? '',
    purpose: row.purpose,
    companions: row.companions,
    scheduledFrom: iso(row.scheduled_from) as string,
    scheduledTo: iso(row.scheduled_to) as string,
    access,
    zoneNames: row.zones.map((z) => z.name),
    checkInAt: iso(row.check_in_at),
    checkOutAt: iso(row.check_out_at),
    faceScore: row.face_score === null ? null : Number(row.face_score),
    rejectReason: row.reject_reason,
    revokedAt: iso(row.revoked_at),
    manualExit: row.manual_exit,
    notFound: row.not_found,
    lastSeen: row.last_seen_at ? { at: iso(row.last_seen_at) as string, zoneId: row.last_seen_zone_id, zoneName: row.last_seen_zone_name } : null,
    events: row.events.map((e) => ({ at: iso(e.at) as string, type: e.type, note: e.note, zoneId: e.zoneId, score: e.score === null ? null : Number(e.score), actor: e.actor })),
    createdAt: iso(row.created_at) as string,
    overstay: isOverstay(like, now),
    overstayLevel: overstayLevel(like, now, escalateMinutes),
    availableActions: availableActions(row.status).filter((a) => a !== 'expire' && a !== 'mark_unrecorded'),
  };
}

/** Trang công khai: KHÔNG số giấy tờ, điện thoại, email, ảnh, ghi chú sự kiện (SEC-01). */
export function toPublicVisitView(view: VisitView): Record<string, unknown> {
  return {
    id: view.id,
    code: view.code,
    status: view.status,
    visitor: { fullName: view.visitor.fullName, organization: view.visitor.organization, hasPhoto: view.visitor.hasPhoto },
    hostName: view.hostName,
    departmentName: view.departmentName,
    purpose: view.purpose,
    scheduledFrom: view.scheduledFrom,
    scheduledTo: view.scheduledTo,
    access: view.access,
    zoneNames: view.zoneNames,
    rejectReason: view.rejectReason,
    overstay: view.overstay,
    events: view.events.map((e) => ({ at: e.at, type: e.type })),
  };
}
