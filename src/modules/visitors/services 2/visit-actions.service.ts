import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { VisitorConfigService } from '../config/visitor-config.service.js';
import type { VisitStatus } from '../constants/visit-status.constant.js';
import { VISITOR_PERMISSIONS } from '../constants/visitor-permission.constant.js';
import { nextStatus, VisitAction, VisitTransitionError } from '../domain/visit-state-machine.js';
import { VisitRow, VisitView } from '../presenters/visit-view.presenter.js';
import { Actor, err, VisitService } from './visit.service.js';
import { VisitorDeviceSync } from './visitor-device-sync.js';
import { VisitorNotifier } from './visitor-notifier.service.js';

type SetColumns = Partial<Record<
  | 'approved_by' | 'approved_at' | 'valid_from' | 'valid_to' | 'reject_reason' | 'check_in_at' | 'check_out_at' | 'revoked_at'
  | 'manual_exit' | 'not_found' | 'face_score' | 'overstay_notified_at' | 'overstay_escalated_at' | 'photo_file_id'
  | 'last_seen_at' | 'last_seen_zone_id' | 'consent_at',
  unknown
>>;
const COLUMN_RE = /^[a-z_]+$/;

const CLOSE_NOTES: Record<string, string> = {
  left_unrecorded: 'Khách đã rời, camera không ghi nhận',
  not_found: 'Không tìm thấy khách',
};

const GATE_ZONE_SQL = `(SELECT z.id FROM visitor_visit_zones vz JOIN zones z ON z.id = vz.zone_id
                         WHERE vz.visit_id = visitor_visits.id AND z.zone_type = 'gate' ORDER BY z.zone_name LIMIT 1)`;

/**
 * VisitActionsService — các thao tác ghi trên một lượt khách (VIS-BE-001 §5, §6).
 * Mẫu mỗi thao tác: nạp → kiểm quyền (403) → kiểm đầu vào (400) → kiểm chuyển trạng thái (409) → giao dịch
 * có điều kiện `WHERE status = <trạng thái đã đọc>` → hiệu ứng phụ (thiết bị, thông báo) không bao giờ làm hỏng thao tác.
 */
@Injectable()
export class VisitActionsService {
  private readonly logger = new Logger(VisitActionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: VisitorConfigService,
    private readonly visits: VisitService,
    private readonly notifier: VisitorNotifier,
    private readonly deviceSync: VisitorDeviceSync,
    private readonly faceProfiles: FaceProfileService,
    private readonly audit: AuditLogsService,
  ) {}

  // ───────────── Duyệt / từ chối / hủy / thu hồi ─────────────

  async approve(id: string, dto: { access?: { validFrom?: string; validTo?: string; zoneIds?: string[] } }, actor: Actor): Promise<VisitView> {
    const row = await this.load(id);
    await this.authorizeHostOrManage(row, actor);
    const to = this.guard(row.status, 'approve');
    const access = dto.access ? await this.validateAccess(dto.access) : null;

    await this.dataSource.transaction(async (m) => {
      const from = access?.validFrom ?? row.valid_from;
      const until = access?.validTo ?? row.valid_to;
      await this.visits.assertNoOverlap(m, row.visitor_id, new Date(from), new Date(until), row.id);
      await this.transition(m, row, to, {
        approved_by: actor.userId, approved_at: new Date(),
        ...(access ? { valid_from: access.validFrom, valid_to: access.validTo } : {}),
      });
      if (access) {
        await m.query(`DELETE FROM visitor_visit_zones WHERE visit_id = $1`, [row.id]);
        await m.query(`INSERT INTO visitor_visit_zones (visit_id, zone_id) SELECT $1, unnest($2::uuid[])`, [row.id, access.zoneIds]);
      }
      await this.visits.addEvent(m, row.id, 'approved', { actorUserId: actor.userId });
    });

    return this.finish(row.id, 'visitor_visit_approve', actor, async (view) => {
      if (await this.notifier.emailVisitor(view, 'approved')) {
        await this.visits.addEvent(this.dataSource.manager, row.id, 'email_sent', { note: `Đã gửi email tới ${view.visitor.email}` });
      }
    });
  }

  async reject(id: string, dto: { reason?: string }, actor: Actor): Promise<VisitView> {
    const row = await this.load(id);
    await this.authorizeHostOrManage(row, actor);
    const reason = String(dto.reason ?? '').trim();
    const to = this.guard(row.status, 'reject');
    if (!reason) throw err(400, 'VALIDATION_ERROR', 'Vui lòng nhập lý do từ chối');
    await this.dataSource.transaction(async (m) => {
      await this.transition(m, row, to, { reject_reason: reason });
      await this.visits.addEvent(m, row.id, 'rejected', { note: reason, actorUserId: actor.userId });
    });
    return this.finish(row.id, 'visitor_visit_reject', actor, async (view) => {
      if (await this.notifier.emailVisitor(view, 'rejected')) {
        await this.visits.addEvent(this.dataSource.manager, row.id, 'email_sent', { note: `Đã gửi email thông báo từ chối tới ${view.visitor.email}` });
      }
    });
  }

  async cancel(id: string, actor: Actor): Promise<VisitView> {
    const row = await this.load(id);
    await this.authorizeHostOrManage(row, actor);
    const to = this.guard(row.status, 'cancel');
    await this.dataSource.transaction(async (m) => {
      await this.transition(m, row, to, {});
      await this.visits.addEvent(m, row.id, 'cancelled', { actorUserId: actor.userId });
    });
    return this.finish(row.id, 'visitor_visit_cancel', actor);
  }

  /** Chưa đến → revoked. Đang ở trong → must_leave (BR-V11): vẫn được theo dõi, báo chủ nhà và bảo vệ, cổng vẫn cho ra. */
  async revoke(id: string, dto: { reason?: string }, actor: Actor): Promise<VisitView> {
    const row = await this.load(id);
    this.requireManage(actor);
    const reason = String(dto.reason ?? '').trim();
    const to = this.guard(row.status, 'revoke');
    if (!reason) throw err(400, 'VALIDATION_ERROR', 'Vui lòng nhập lý do thu hồi');
    await this.dataSource.transaction(async (m) => {
      await this.transition(m, row, to, to === 'must_leave' ? { revoked_at: new Date() } : {});
      await this.visits.addEvent(m, row.id, 'revoked', { note: reason, actorUserId: actor.userId });
      if (to === 'must_leave') {
        await this.visits.addEvent(m, row.id, 'host_notified', { note: 'Yêu cầu khách rời khuôn viên' });
        await this.visits.addEvent(m, row.id, 'security_notified', { note: 'Đã báo bảo vệ hỗ trợ khách rời khuôn viên' });
      }
    });
    return this.finish(row.id, 'visitor_visit_revoke', actor, async (view) => {
      if (to !== 'must_leave') return;
      await this.notifier.notifyHost(view, 'visitor_must_leave', `${view.visitor.fullName} đã bị thu hồi quyền ra vào, cần rời khuôn viên`);
      await this.notifier.alertSecurity(view, 'visitor_must_leave', view.lastSeen?.zoneId ?? null, reason);
    });
  }

  async extend(id: string, dto: { validTo?: string }, actor: Actor): Promise<VisitView> {
    const row = await this.load(id);
    this.requireManage(actor);
    if (row.status !== 'approved' && row.status !== 'checked_in') {
      throw err(409, 'VISIT_INVALID_TRANSITION', 'Chỉ gia hạn được lượt đã duyệt hoặc đang trong khuôn viên');
    }
    const validTo = new Date(String(dto.validTo ?? ''));
    if (Number.isNaN(validTo.getTime()) || validTo.getTime() <= new Date(row.valid_to).getTime()) {
      throw err(400, 'VALIDATION_ERROR', 'Thời điểm gia hạn phải sau hiệu lực hiện tại');
    }
    await this.dataSource.transaction(async (m) => {
      await this.visits.assertNoOverlap(m, row.visitor_id, new Date(row.valid_from), validTo, row.id);
      await this.conditionalUpdate(m, row, row.status, { valid_to: validTo, overstay_notified_at: null, overstay_escalated_at: null });
      await this.visits.addEvent(m, row.id, 'extended', { note: `Hiệu lực mới đến ${validTo.toISOString()}`, actorUserId: actor.userId });
    });
    return this.finish(row.id, 'visitor_visit_extend', actor);
  }

  async attachPhoto(id: string, dto: { photo?: string }, actor: Actor): Promise<VisitView> {
    const row = await this.load(id);
    const photo = this.visits.decodePhoto(dto.photo);
    if (!photo) throw err(400, 'INVALID_PHOTO', 'Ảnh không hợp lệ');
    if (row.status !== 'pending_approval' && row.status !== 'approved') {
      throw err(409, 'VISIT_INVALID_TRANSITION', 'Chỉ bổ sung ảnh cho lượt đang chờ duyệt hoặc đã duyệt');
    }
    // enrollPortrait dùng kết nối riêng; chạy ngoài giao dịch (tài khoản ẩn đã commit từ lúc đăng ký).
    const enrolled = await this.faceProfiles.enrollPortrait(
      row.visitor_user_id,
      { buffer: photo.buffer, mimetype: photo.mimeType, originalname: `visitor-${row.visitor_id}`, size: photo.buffer.length },
      actor.userId,
    );
    await this.dataSource.transaction(async (m) => {
      await this.conditionalUpdate(m, row, row.status, { photo_file_id: enrolled.mediaFileId });
      await this.visits.addEvent(m, row.id, 'photo_added', { actorUserId: actor.userId });
    });
    return this.finish(row.id, 'visitor_visit_photo', actor);
  }

  // ───────────── Lễ tân: vào / ra / đóng thủ công ─────────────

  async checkInManual(id: string, dto: { note?: string }, actor: Actor): Promise<VisitView> {
    const row = await this.load(id);
    const to = this.guard(row.status, 'check_in');
    const note = String(dto.note ?? '').trim();
    if (!note) throw err(400, 'VALIDATION_ERROR', 'Vui lòng nhập ghi chú xác minh');
    const now = new Date();
    await this.dataSource.transaction(async (m) => {
      await this.transition(m, row, to, { check_in_at: now, last_seen_at: now, last_seen_zone_id: this.raw(GATE_ZONE_SQL) });
      await this.visits.addEvent(m, row.id, 'check_in', { note, actorUserId: actor.userId });
      await this.visits.addEvent(m, row.id, 'host_notified', { note: 'Thông báo khách đã đến' });
    });
    return this.finish(row.id, 'visitor_visit_check_in', actor, (view) =>
      this.notifier.notifyHost(view, 'visitor_arrived', `${view.visitor.fullName} đã đến khuôn viên`).then(() => undefined));
  }

  async checkOut(id: string, dto: { zoneId?: string }, actor: Actor): Promise<VisitView> {
    const row = await this.load(id);
    const to = this.guard(row.status, 'check_out');
    await this.recordExit(row, to, new Date(), dto.zoneId ?? null, actor.userId);
    return this.finish(row.id, 'visitor_visit_check_out', actor, (view) =>
      this.notifier.notifyHost(view, 'visitor_left', `${view.visitor.fullName} đã rời khuôn viên`).then(() => undefined));
  }

  /** BR-V14: đóng lượt không có lượt ra tại cổng, bắt buộc có lý do. */
  async closeManually(id: string, dto: { reason?: string; exitAt?: string; note?: string }, actor: Actor): Promise<VisitView> {
    const row = await this.load(id);
    this.requireManage(actor);
    const closed = this.guard(row.status, 'close_manual');
    const reason = String(dto.reason ?? '');
    const note = String(dto.note ?? '').trim();
    if (!CLOSE_NOTES[reason]) throw err(400, 'VALIDATION_ERROR', 'Vui lòng chọn lý do đóng lượt');

    if (reason === 'not_found') {
      if (!note) throw err(400, 'VALIDATION_ERROR', 'Vui lòng ghi chú đã tìm khách ở đâu');
      const target: VisitStatus = row.status === 'exit_unrecorded' ? 'exit_unrecorded' : this.guard(row.status, 'mark_unrecorded');
      await this.dataSource.transaction(async (m) => {
        await this.conditionalUpdate(m, row, row.status, { not_found: true }, target);
        await this.visits.addEvent(m, row.id, 'security_notified', { note: `${CLOSE_NOTES.not_found}: ${note}`, actorUserId: actor.userId });
        await this.visits.addEvent(m, row.id, 'exit_unrecorded', { actorUserId: actor.userId });
      });
      return this.finish(row.id, 'visitor_visit_close_not_found', actor, async (view) => {
        await this.notifier.alertSecurity(view, 'visitor_overstay', view.lastSeen?.zoneId ?? null, `Không tìm thấy khách: ${note}`);
      });
    }

    if (!dto.exitAt) throw err(400, 'VALIDATION_ERROR', 'Vui lòng nhập giờ ra ước tính');
    const exitAt = new Date(dto.exitAt);
    const checkIn = row.check_in_at ? new Date(row.check_in_at).getTime() : 0;
    if (Number.isNaN(exitAt.getTime()) || exitAt.getTime() < checkIn || exitAt.getTime() > Date.now()) {
      throw err(400, 'VALIDATION_ERROR', 'Giờ ra phải sau giờ vào và không ở tương lai');
    }
    await this.dataSource.transaction(async (m) => {
      await this.transition(m, row, closed, { check_out_at: exitAt, manual_exit: true });
      await this.visits.addEvent(m, row.id, 'manual_close', {
        note: note ? `${CLOSE_NOTES.left_unrecorded}. ${note}` : CLOSE_NOTES.left_unrecorded, actorUserId: actor.userId,
      });
    });
    return this.finish(row.id, 'visitor_visit_close_manual', actor, (view) =>
      this.notifier.notifyHost(view, 'visitor_left', `${view.visitor.fullName} đã được ghi nhận rời khuôn viên (giờ ra nhập tay)`).then(() => undefined));
  }

  // ───────────── Thao tác của hệ thống (camera/thiết bị) ─────────────

  /** Camera nhận ra khách ở cổng. Trả null nếu lượt đã đổi trạng thái (thua tranh chấp) — không phải lỗi. */
  async systemCheckIn(
    visitId: string,
    input: { at: Date; zoneId: string | null; score: number | null; deviceEventId: string | null },
  ): Promise<VisitView | null> {
    return this.systemTransition(visitId, 'check_in', async (m, row, to) => {
      await this.transition(m, row, to, {
        check_in_at: input.at, face_score: input.score, last_seen_at: input.at, last_seen_zone_id: input.zoneId,
      });
      if (input.score !== null) await this.visits.addEvent(m, row.id, 'face_verified', { zoneId: input.zoneId, score: input.score, deviceEventId: input.deviceEventId, at: input.at });
      await this.visits.addEvent(m, row.id, 'check_in', { zoneId: input.zoneId, deviceEventId: input.deviceEventId, at: input.at });
      await this.visits.addEvent(m, row.id, 'host_notified', { note: 'Thông báo khách đã đến' });
    }, 'visitor_arrived', (v) => `${v.visitor.fullName} đã đến ${v.lastSeen?.zoneName ?? 'khuôn viên'}`);
  }

  async systemCheckOut(visitId: string, input: { at: Date; zoneId: string | null; deviceEventId: string | null }): Promise<VisitView | null> {
    return this.systemTransition(visitId, 'check_out', async (m, row, to) => {
      await this.recordExitIn(m, row, to, input.at, input.zoneId, null, input.deviceEventId);
    }, 'visitor_left', (v) => `${v.visitor.fullName} đã rời khuôn viên`);
  }

  async recordGateEvent(
    visitId: string,
    type: 'manual_review' | 'access_denied',
    input: { zoneId: string | null; score: number | null; note: string | null; deviceEventId: string | null; at?: Date },
  ): Promise<void> {
    await this.visits.addEvent(this.dataSource.manager, visitId, type, input);
  }

  /** Cập nhật "lần cuối camera thấy" — chỉ tiến lên (BR-V16). */
  async touchLastSeen(visitId: string, at: Date, zoneId: string | null): Promise<void> {
    await this.dataSource.query(
      `UPDATE visitor_visits SET last_seen_at = $2, last_seen_zone_id = COALESCE($3, last_seen_zone_id), updated_at = now()
        WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < $2)`,
      [visitId, at, zoneId],
    );
  }

  // ───────────── Nội bộ ─────────────

  private async systemTransition(
    visitId: string,
    action: VisitAction,
    work: (m: EntityManager, row: VisitRow, to: VisitStatus) => Promise<void>,
    hostType: 'visitor_arrived' | 'visitor_left',
    message: (v: VisitView) => string,
  ): Promise<VisitView | null> {
    const row = await this.visits.loadRow(visitId);
    if (!row) return null;
    let to: VisitStatus;
    try { to = nextStatus(row.status, action); } catch { return null; }
    try {
      await this.dataSource.transaction((m) => work(m, row, to));
    } catch (e) {
      if (e instanceof ConflictException) return null;
      throw e;
    }
    const view = await this.visits.getView(visitId);
    await this.notifier.notifyHost(view, hostType, message(view));
    await this.sync(visitId);
    return view;
  }

  private async recordExit(row: VisitRow, to: VisitStatus, at: Date, zoneId: string | null, actorId: string | null): Promise<void> {
    await this.dataSource.transaction((m) => this.recordExitIn(m, row, to, at, zoneId, actorId, null));
  }

  private async recordExitIn(m: EntityManager, row: VisitRow, to: VisitStatus, at: Date, zoneId: string | null, actorId: string | null, deviceEventId: string | null) {
    await this.transition(m, row, to, { check_out_at: at, last_seen_at: at, last_seen_zone_id: zoneId ?? this.raw(GATE_ZONE_SQL) });
    await this.visits.addEvent(m, row.id, 'check_out', { zoneId, actorUserId: actorId, deviceEventId, at });
    await this.visits.addEvent(m, row.id, 'host_notified', { note: 'Thông báo khách đã rời' });
  }

  private async load(id: string): Promise<VisitRow> {
    const row = /^[0-9a-f-]{36}$/i.test(id) ? await this.visits.loadRow(id) : null;
    if (!row) throw err(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách');
    return row;
  }

  private requireManage(actor: Actor): void {
    if (!actor.permissions.includes(VISITOR_PERMISSIONS.VISIT_MANAGE)) {
      throw new ForbiddenException({ success: false, message: 'Bạn không có quyền thực hiện thao tác này', error: { code: 'VISIT_FORBIDDEN', details: {} } });
    }
  }

  /** BR-V18: người có quyền quản lý, hoặc chính người được gặp khi `approver_mode = host_or_manager`. */
  private async authorizeHostOrManage(row: VisitRow, actor: Actor): Promise<void> {
    if (actor.permissions.includes(VISITOR_PERMISSIONS.VISIT_MANAGE)) return;
    const mode = (await this.config.get()).approverMode;
    if (mode === 'host_or_manager' && actor.userId && actor.userId === row.host_user_id) return;
    throw new ForbiddenException({ success: false, message: 'Bạn không có quyền thực hiện thao tác này', error: { code: 'VISIT_FORBIDDEN', details: {} } });
  }

  private guard(status: VisitStatus, action: VisitAction): VisitStatus {
    try {
      return nextStatus(status, action);
    } catch (e) {
      if (e instanceof VisitTransitionError) throw err(409, 'VISIT_INVALID_TRANSITION', e.message);
      throw e;
    }
  }

  private async validateAccess(a: { validFrom?: string; validTo?: string; zoneIds?: string[] }) {
    const validFrom = new Date(String(a.validFrom ?? ''));
    const validTo = new Date(String(a.validTo ?? ''));
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime()) || validTo.getTime() <= validFrom.getTime()) {
      throw err(400, 'VALIDATION_ERROR', 'Hiệu lực đến phải sau hiệu lực từ');
    }
    const zoneIds = [...new Set(a.zoneIds ?? [])];
    if (zoneIds.length === 0) throw err(400, 'VALIDATION_ERROR', 'Chọn ít nhất một khu vực được phép');
    const found = await this.dataSource.query(`SELECT id FROM zones WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [zoneIds]);
    if (found.length !== zoneIds.length) throw err(400, 'VALIDATION_ERROR', 'Có khu vực không tồn tại');
    return { validFrom, validTo, zoneIds };
  }

  private raw(sql: string) {
    return { __raw: sql };
  }

  private async transition(m: EntityManager, row: VisitRow, to: VisitStatus, set: SetColumns): Promise<void> {
    await this.conditionalUpdate(m, row, row.status, set, to);
  }

  /** UPDATE có điều kiện trạng thái; 0 dòng → 409 (người khác vừa thao tác). Tên cột lấy từ hằng, không từ người dùng. */
  private async conditionalUpdate(m: EntityManager, row: VisitRow, expected: VisitStatus, set: SetColumns, to?: VisitStatus): Promise<void> {
    const params: unknown[] = [row.id, expected];
    const parts: string[] = ['updated_at = now()'];
    if (to) { params.push(to); parts.push(`status = $${params.length}`); }
    for (const [col, val] of Object.entries(set)) {
      if (!COLUMN_RE.test(col)) throw new Error(`Tên cột không hợp lệ: ${col}`);
      if (val && typeof val === 'object' && '__raw' in (val as object)) {
        parts.push(`${col} = ${(val as { __raw: string }).__raw}`);
      } else {
        params.push(val);
        parts.push(`${col} = $${params.length}`);
      }
    }
    const rows = await m.query(`UPDATE visitor_visits SET ${parts.join(', ')} WHERE id = $1 AND status = $2 AND deleted_at IS NULL RETURNING id`, params);
    if (rows.length === 0) throw err(409, 'VISIT_STATE_CONFLICT', 'Lượt khách vừa được người khác thay đổi, vui lòng tải lại');
  }

  private async sync(visitId: string): Promise<void> {
    try {
      await this.deviceSync.syncVisit(visitId);
    } catch (e) {
      this.logger.warn(`Đồng bộ thiết bị lượt ${visitId} thất bại: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  private async finish(visitId: string, auditAction: string, actor: Actor, after?: (view: VisitView) => Promise<unknown>): Promise<VisitView> {
    await this.sync(visitId);
    let view = await this.visits.getView(visitId);
    if (after) {
      try { await after(view); } catch (e) { this.logger.warn(`Hiệu ứng phụ ${auditAction} lỗi: ${e instanceof Error ? e.message : 'unknown'}`); }
      view = await this.visits.getView(visitId);
    }
    if (actor.userId) {
      void this.audit
        .logAction({ userId: actor.userId, actionType: auditAction, entityType: 'visitor_visits', entityId: visitId, metadataJson: { code: view.code, status: view.status } })
        .catch((e) => this.logger.warn(`audit lỗi: ${e instanceof Error ? e.message : 'unknown'}`));
    }
    return view;
  }
}
