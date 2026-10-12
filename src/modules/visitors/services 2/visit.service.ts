import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { decodeBase64Image } from '../../../common/utils/decode-base64-image.util.js';
import { resolveNonStaffDepartmentIds } from '../../../common/utils/non-staff-department.util.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { VisitorConfigService } from '../config/visitor-config.service.js';
import type { VisitChannel, VisitEventType, VisitStatus } from '../constants/visit-status.constant.js';
import { defaultAccessWindow } from '../domain/visit-state-machine.js';
import { validateVisitPayload, VisitPayload, VisitValidationError } from '../domain/visit-validators.js';
import { toVisitView, VISIT_VIEW_SELECT, VisitRow, VisitView } from '../presenters/visit-view.presenter.js';
import { VisitCodeService } from './visit-code.service.js';
import { VisitorIdentityService } from './visitor-identity.service.js';
import { VisitorNotifier } from './visitor-notifier.service.js';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_PHOTO_MIME = ['image/jpeg', 'image/png'];

export interface Actor {
  userId: string | null;
  permissions: string[];
}

export const err = (status: 400 | 404 | 409, code: string, message: string) => {
  const body = { success: false, message, error: { code, details: {} } };
  if (status === 404) return new NotFoundException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
};

/**
 * VisitService — nghiệp vụ ghi lượt khách (VIS-BE-001). Mọi thay đổi trạng thái dùng cập nhật có điều kiện
 * (`UPDATE … WHERE status = ANY(expected)`) để hai người cùng thao tác chỉ một người thắng (ARCH-03).
 */
@Injectable()
export class VisitService {
  private readonly logger = new Logger(VisitService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: VisitorConfigService,
    private readonly identity: VisitorIdentityService,
    private readonly codes: VisitCodeService,
    private readonly faceProfiles: FaceProfileService,
    private readonly notifier: VisitorNotifier,
    private readonly audit: AuditLogsService,
  ) {}

  // ───────────── Đọc ─────────────

  async loadRow(id: string, manager?: EntityManager): Promise<VisitRow | null> {
    const rows: VisitRow[] = await (manager ?? this.dataSource).query(`${VISIT_VIEW_SELECT} AND v.id = $1`, [id]);
    return rows[0] ?? null;
  }

  async loadRowByCode(code: string): Promise<VisitRow | null> {
    const rows: VisitRow[] = await this.dataSource.query(`${VISIT_VIEW_SELECT} AND v.visit_code = $1`, [code.trim().toUpperCase()]);
    return rows[0] ?? null;
  }

  async getView(id: string, manager?: EntityManager): Promise<VisitView> {
    const row = await this.loadRow(id, manager);
    if (!row) throw err(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách');
    return toVisitView(row, new Date(), (await this.config.get()).overstayEscalateMinutes);
  }

  // ───────────── Tạo lượt ─────────────

  /**
   * Tạo lượt khách ở ba kênh. `online` (công khai, không actor) → chờ duyệt; `walk_in`/`host_invite` → duyệt luôn.
   * Thứ tự: kiểm tra → định danh khách (giao dịch riêng) → ảnh khuôn mặt → giao dịch tạo lượt → thông báo.
   * Định danh và ảnh nằm ngoài giao dịch lượt vì `enrollPortrait` dùng kết nối riêng, cần dòng `users` đã commit.
   */
  async create(channel: VisitChannel, payload: VisitPayload, actor: Actor | null): Promise<VisitView> {
    const cfg = await this.config.get();
    const now = new Date();
    const hostUserId = channel === 'host_invite' && actor?.userId ? actor.userId : payload.hostId;
    const hostRow = hostUserId ? await this.findActiveHost(hostUserId) : null;

    try {
      validateVisitPayload({ ...payload, hostId: hostUserId }, channel, now, cfg, Boolean(hostRow));
    } catch (e) {
      if (e instanceof VisitValidationError) throw err(400, e.code, e.message);
      throw e;
    }

    const photo = this.decodePhoto(payload.visitor?.photo);
    const v = payload.visitor ?? {};
    const identity = await this.identity.resolve({
      fullName: String(v.fullName), idNumber: v.idNumber, phone: String(v.phone), email: v.email, organization: v.organization,
    });

    let photoFileId: string | null = null;
    if (photo) {
      const enrolled = await this.faceProfiles.enrollPortrait(
        identity.userId,
        { buffer: photo.buffer, mimetype: photo.mimeType, originalname: `visitor-${identity.visitorId}`, size: photo.buffer.length },
        actor?.userId ?? null,
      );
      photoFileId = enrolled.mediaFileId;
    }

    const from = new Date(String(payload.scheduledFrom));
    const to = new Date(String(payload.scheduledTo));
    const approvedNow = channel !== 'online';
    const window = defaultAccessWindow(from, to, cfg.accessBufferMinutes);
    const status: VisitStatus = approvedNow ? 'approved' : 'pending_approval';

    const visitId = await this.dataSource.transaction(async (m) => {
      if (approvedNow) await this.assertNoOverlap(m, identity.visitorId, new Date(window.validFrom), new Date(window.validTo));
      const code = await this.codes.next(m, from);
      const rows: Array<{ id: string }> = await m.query(
        `INSERT INTO visitor_visits (visit_code, visitor_id, channel, status, host_user_id, department_id, purpose, companions,
                plate_number, scheduled_from, scheduled_to, valid_from, valid_to, consent_at, photo_file_id, created_by,
                approved_by, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [
          code, identity.visitorId, channel, status, hostRow!.id, hostRow!.department_id, String(payload.purpose).trim(),
          payload.companions ?? 0, v.plateNumber?.trim() || null, from, to, window.validFrom, window.validTo,
          payload.consent === true ? now : null, photoFileId, actor?.userId ?? null,
          approvedNow ? (actor?.userId ?? hostRow!.id) : null, approvedNow ? now : null,
        ],
      );
      const id = rows[0].id;
      await m.query(
        `INSERT INTO visitor_visit_zones (visit_id, zone_id)
         SELECT $1, z.id FROM zones z WHERE z.deleted_at IS NULL AND z.status = 'active' AND (z.zone_type = 'gate' OR z.zone_code = ANY($2))`,
        [id, cfg.defaultZoneCodes],
      );
      await this.addEvent(m, id, 'registered', { actorUserId: actor?.userId ?? null });
      if (approvedNow) await this.addEvent(m, id, 'approved', { actorUserId: actor?.userId ?? hostRow!.id });
      return id;
    });

    const created = await this.getView(visitId);
    await this.afterCreate(created, channel, actor);
    return this.getView(visitId); // đọc lại để có sự kiện email_sent
  }

  private async afterCreate(view: VisitView, channel: VisitChannel, actor: Actor | null): Promise<void> {
    const emailKind = channel === 'online' ? 'received' : 'approved';
    if (await this.notifier.emailVisitor(view, emailKind)) {
      await this.addEvent(this.dataSource.manager, view.id, 'email_sent', { note: `Đã gửi email tới ${view.visitor.email}` });
    }
    if (channel === 'online') await this.notifier.notifyHost(view, 'visitor_pending_approval', `${view.visitor.fullName} (${view.visitor.organization || 'khách'}) xin gặp bạn, đang chờ duyệt`);
    if (channel === 'walk_in') await this.notifier.notifyHost(view, 'visitor_registered', `Lễ tân đã đăng ký khách ${view.visitor.fullName} đến gặp bạn`);
    if (actor?.userId) {
      void this.audit.logAction({ userId: actor.userId, actionType: 'visitor_visit_create', entityType: 'visitor_visits', entityId: view.id, metadataJson: { channel, code: view.code } })
        .catch((e) => this.logger.warn(`audit lỗi: ${e instanceof Error ? e.message : 'unknown'}`));
    }
  }

  // ───────────── Tiện ích dùng chung ─────────────

  async addEvent(
    manager: EntityManager,
    visitId: string,
    type: VisitEventType,
    opts: { note?: string | null; zoneId?: string | null; score?: number | null; actorUserId?: string | null; deviceEventId?: string | null; at?: Date } = {},
  ): Promise<void> {
    await manager.query(
      `INSERT INTO visitor_visit_events (visit_id, event_type, event_time, zone_id, device_event_id, score, actor_user_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [visitId, type, opts.at ?? new Date(), opts.zoneId ?? null, opts.deviceEventId ?? null, opts.score ?? null, opts.actorUserId ?? null, opts.note ?? null],
    );
  }

  /** BR-V17: cùng một khách không có hai lượt đang giữ quyền chồng khung hiệu lực. */
  async assertNoOverlap(manager: EntityManager, visitorId: string, from: Date, to: Date, excludeVisitId?: string): Promise<void> {
    // Khóa theo khách trong giao dịch: hai lượt cùng khách được duyệt đồng thời không cùng vượt qua kiểm tra chồng lấn.
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [`visitor:${visitorId}`]);
    const rows = await manager.query(
      `SELECT 1 FROM visitor_visits
        WHERE visitor_id = $1 AND deleted_at IS NULL AND status IN ('approved','checked_in','must_leave')
          AND ($4::uuid IS NULL OR id <> $4)
          AND tstzrange(valid_from, valid_to) && tstzrange($2::timestamptz, $3::timestamptz) LIMIT 1`,
      [visitorId, from, to, excludeVisitId ?? null],
    );
    if (rows.length) throw err(409, 'VISIT_OVERLAP', 'Khách đã có một lượt khác đang hiệu lực trong khung giờ này');
  }

  /** Giải mã ảnh data URL (chỉ JPEG/PNG, ≤ 2 MB). Null nếu không có ảnh. */
  decodePhoto(raw: string | null | undefined) {
    if (!raw) return null;
    if (!/^data:image\/(jpeg|png);base64,/i.test(raw)) throw err(400, 'INVALID_PHOTO', 'Ảnh không hợp lệ');
    const decoded = decodeBase64Image(raw);
    if (!decoded || !ALLOWED_PHOTO_MIME.includes(decoded.mimeType)) throw err(400, 'INVALID_PHOTO', 'Ảnh không hợp lệ');
    if (decoded.buffer.length > MAX_PHOTO_BYTES) {
      throw new PayloadTooLargeException({ success: false, message: 'Ảnh khuôn mặt tối đa 2 MB', error: { code: 'PHOTO_TOO_LARGE', details: {} } });
    }
    return decoded;
  }

  /** Người được gặp: nhân sự đang hoạt động, không thuộc đơn vị đối tác/khách (BR-V20). */
  async findActiveHost(userId: string): Promise<{ id: string; department_id: string | null } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
    const nonStaff = await resolveNonStaffDepartmentIds(this.dataSource);
    const rows: Array<{ id: string; department_id: string | null }> = await this.dataSource.query(
      `SELECT id, department_id FROM users
        WHERE id = $1 AND deleted_at IS NULL AND account_status = 'active' AND employment_status IN ('active','probation')
          AND (department_id IS NULL OR NOT (department_id = ANY($2::uuid[])))`,
      [userId, nonStaff],
    );
    return rows[0] ?? null;
  }
}
