import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import { UserEntity } from '../entities/user.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { ListBiometricSubmissionsQueryDto } from '../dto/list-biometric-submissions-query.dto.js';

const SORT_FIELD_MAP: Record<string, string> = {
  submittedAt: 'fp.enrolledAt',
  userFullName: 'u.fullName',
  employeeCode: 'u.employeeCode',
  departmentName: 'd.departmentName',
  status: 'fp.status',
  qualityScore: 'fp.qualityScore',
};

/**
 * Giá trị `device_user_mappings.metadata_json->>'source'` của KHO CHÂN DUNG THƯỜNG TRỰC.
 *
 * Phải khớp hằng `MAPPING_SOURCE` trong `ivss/services/ivss-portrait-sync.service.ts`.
 * Khai lại (không import) vì `IvssModule` đã import `AccountsModule` — import ngược lại
 * sẽ tạo vòng phụ thuộc, mà repo cấm `forwardRef`. **Đổi thì phải đổi CẢ HAI.**
 *
 * Lưu ý: đây là khoá trong `metadata_json`, KHÔNG phải cột `source` —
 * `device_user_mappings` không có cột đó.
 */
const PORTRAIT_MAPPING_SOURCE = 'portrait';

type UserClassSection = {
  id: string;
  code: string;
  name: string;
};

type UserRoleSummary = {
  roleCode: string;
  roleName: string;
};

/**
 * AdminBiometricReviewService — ACCT-BIOMETRIC-REVIEW-001.
 *
 * [SỬA 2026-07-29] Đổi tên từ AdminAvatarReviewService — luồng này duyệt ảnh sinh trắc
 * học bắt buộc cho FaceGate, KHÔNG phải avatar hiển thị. Xem
 * spec/features/account/feat-split-avatar-and-biometric/plan.md.
 *
 * Quyết định D2: approve KHÔNG còn cập nhật `users.avatar_url` — avatar hiển thị là
 * dữ liệu độc lập, quản lý bởi feature `feat-update-avatar-photo` (không duyệt).
 */
@Injectable()
export class AdminBiometricReviewService {
  private readonly logger = new Logger(AdminBiometricReviewService.name);

  constructor(
    @InjectRepository(FaceProfileEntity)
    private readonly faceProfileRepo: Repository<FaceProfileEntity>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  // ── US1: List ────────────────────────────────────────────────────────

  async listBiometricSubmissions(query: ListBiometricSubmissionsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const status = query.status ?? 'pending_review';
    const sortBy = query.sortBy ?? 'submittedAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const qb = this.faceProfileRepo
      .createQueryBuilder('fp')
      .innerJoin('fp.user', 'u')
      .leftJoin('u.department', 'd')
      .where('fp.deletedAt IS NULL')
      .andWhere('fp.status = :status', { status });

    if (query.q) {
      const searchPattern = `%${query.q}%`;
      qb.andWhere(
        '(u.fullName ILIKE :q OR u.email ILIKE :q OR u.employeeCode ILIKE :q)',
        { q: searchPattern },
      );
    }

    if (query.departmentId) {
      qb.andWhere('u.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    }

    if (query.role) {
      qb.andWhere(
        `
        EXISTS (
          SELECT 1
            FROM user_roles ur
            JOIN roles r
              ON r.id = ur.role_id
             AND r.is_active = true
           WHERE ur.user_id = u.id
             AND ur.is_active = true
             AND r.role_code = :roleCode
        )
        `,
        { roleCode: query.role },
      );
    }

    if (query.classId) {
      const classIdentifier = query.classId.trim();
      const normalizedClassCode = classIdentifier
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase();
      qb.andWhere(
        `
        (
          EXISTS (
            SELECT 1
              FROM students st
              JOIN class_enrollments ce
                ON ce.student_id = st.id
               AND ce.status = 'active'
              JOIN class_sections cs
                ON cs.id = ce.class_section_id
               AND cs.deleted_at IS NULL
             WHERE st.user_id = u.id
               AND st.deleted_at IS NULL
               AND (
                 cs.id::text = :classIdentifier
                 OR lower(cs.class_code) = lower(:classIdentifier)
                 OR regexp_replace(lower(cs.class_code), '[^a-z0-9]', '', 'g') = :normalizedClassCode
               )
          )
          OR EXISTS (
            SELECT 1
              FROM class_sections cs
             WHERE cs.lecturer_user_id = u.id
               AND cs.deleted_at IS NULL
               AND (
                 cs.id::text = :classIdentifier
                 OR lower(cs.class_code) = lower(:classIdentifier)
                 OR regexp_replace(lower(cs.class_code), '[^a-z0-9]', '', 'g') = :normalizedClassCode
               )
          )
        )
        `,
        { classIdentifier, normalizedClassCode },
      );
    }

    const sortColumn = SORT_FIELD_MAP[sortBy] ?? 'fp.enrolledAt';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    qb.orderBy(sortColumn, order);

    if (sortBy === 'qualityScore') {
      qb.addOrderBy('fp.qualityScore', order, 'NULLS LAST');
    }

    qb.skip((page - 1) * limit).take(limit);

    qb.select([
      'fp.id',
      'fp.userId',
      'fp.status',
      'fp.enrolledAt',
      'fp.consentAt',
      'fp.primaryImageFileId',
      'fp.qualityScore',
      'u.id',
      'u.fullName',
      'u.email',
      'u.employeeCode',
      // [FIX 2026-08-11] avatarUrl HIỆN TẠI — CHỈ nhận diện "đây là ai", KHÔNG liên quan
      // primaryImageFileId (giữ nguyên tách biệt D2). u đã JOIN sẵn, chỉ thêm cột SELECT.
      'u.avatarUrl',
      'd.id',
      'd.departmentName',
    ]);

    const [items, total] = await qb.getManyAndCount();
    const userIds = items.map((fp) => fp.userId).filter(Boolean);
    const classSectionsByUser = await this.getClassSectionsByUserIds(userIds);
    const roleByUser = await this.getPrimaryRoleByUserIds(userIds);

    return {
      data: items.map((fp) => ({
        faceProfileId: fp.id,
        userId: fp.userId,
        fullName: fp.user?.fullName ?? null,
        email: fp.user?.email ?? null,
        employeeCode: fp.user?.employeeCode ?? null,
        avatarUrl: fp.user?.avatarUrl ?? null,
        departmentName: fp.user?.department?.departmentName ?? null,
        status: fp.status,
        submittedAt: fp.enrolledAt,
        consentAt: fp.consentAt,
        primaryImageFileId: fp.primaryImageFileId,
        qualityScore: fp.qualityScore !== null ? Number(fp.qualityScore) : null,
        classSections: classSectionsByUser.get(fp.userId) ?? [],
        roleCode: roleByUser.get(fp.userId)?.roleCode ?? null,
        roleName: roleByUser.get(fp.userId)?.roleName ?? null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── US1: Detail ──────────────────────────────────────────────────────

  async getBiometricSubmissionDetail(faceProfileId: string) {
    const fp = await this.faceProfileRepo.findOne({
      where: { id: faceProfileId, deletedAt: IsNull() },
      relations: { user: { department: true } },
    });

    if (!fp) {
      throw new NotFoundException({
        code: 'BIOMETRIC_SUBMISSION_NOT_FOUND',
        message: 'Biometric submission not found.',
      });
    }

    const user = fp.user as UserEntity | undefined;
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Owning user not found.',
      });
    }

    let imageFile: Record<string, unknown> | null = null;
    let hasPreview = false;

    if (fp.primaryImageFileId) {
      const rows: Array<{
        file_name: string;
        mime_type: string;
        file_size_bytes: string | null;
        storage_provider: string;
      }> = await this.dataSource.manager.query(
        `SELECT file_name, mime_type, file_size_bytes, storage_provider FROM media_files WHERE id = $1 AND deleted_at IS NULL`,
        [fp.primaryImageFileId],
      );
      if (rows.length > 0) {
        imageFile = {
          fileName: rows[0].file_name,
          mimeType: rows[0].mime_type,
          fileSizeBytes: rows[0].file_size_bytes,
          storageProvider: rows[0].storage_provider,
        };
        hasPreview = true;
      }
    }

    let reviewMetadata: Record<string, unknown> | null = null;
    if (fp.metadataJson?.review) {
      reviewMetadata = fp.metadataJson.review as Record<string, unknown>;
    }

    return {
      faceProfileId: fp.id,
      userId: fp.userId,
      userFullName: user.fullName,
      userEmail: user.email,
      // [FIX 2026-08-11] avatarUrl HIỆN TẠI — mirror cách lấy ở list(), user đã load đủ
      // qua relations:{user:true} (không select riêng) nên không cần query thêm.
      avatarUrl: user.avatarUrl,
      // [FIX 2026-08-23] FE modal "Chi tiết yêu cầu duyệt ảnh sinh trắc học" cần
      // employeeCode + department nhưng response cũ không có (spec 6.2 cũng thiếu) —
      // bổ sung để khớp phần list() đã trả sẵn các field này.
      employeeCode: user.employeeCode,
      department: user.department
        ? { id: user.department.id, departmentName: user.department.departmentName }
        : null,
      classSections: (await this.getClassSectionsByUserIds([user.id])).get(user.id) ?? [],
      status: fp.status,
      primaryImageFileId: fp.primaryImageFileId,
      imageFile,
      hasPreview,
      submittedAt: fp.enrolledAt,
      consentAt: fp.consentAt,
      reviewMetadata,
    };
  }

  private async getClassSectionsByUserIds(userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return new Map<string, UserClassSection[]>();
    }

    const rows = (await this.dataSource.manager.query(
      `
      WITH user_classes AS (
        SELECT
          st.user_id,
          cs.id,
          cs.class_code,
          subj.subject_name
        FROM students st
        JOIN class_enrollments ce
          ON ce.student_id = st.id
         AND ce.status = 'active'
        JOIN class_sections cs
          ON cs.id = ce.class_section_id
         AND cs.deleted_at IS NULL
        JOIN subjects subj
          ON subj.id = cs.subject_id
         AND subj.deleted_at IS NULL
        WHERE st.deleted_at IS NULL
          AND st.user_id = ANY($1::uuid[])

        UNION

        SELECT
          cs.lecturer_user_id AS user_id,
          cs.id,
          cs.class_code,
          subj.subject_name
        FROM class_sections cs
        JOIN subjects subj
          ON subj.id = cs.subject_id
         AND subj.deleted_at IS NULL
        WHERE cs.deleted_at IS NULL
          AND cs.lecturer_user_id = ANY($1::uuid[])
      )
      SELECT
        user_id,
        json_agg(
          json_build_object(
            'id', id,
            'code', class_code,
            'name', subject_name
          )
          ORDER BY class_code
        ) AS class_sections
      FROM user_classes
      GROUP BY user_id
      `,
      [uniqueUserIds],
    )) as Array<{
      user_id: string;
      class_sections: UserClassSection[] | string | null;
    }>;

    return new Map(
      rows.map((row) => {
        const parsed = Array.isArray(row.class_sections)
          ? row.class_sections
          : row.class_sections
            ? (JSON.parse(row.class_sections) as UserClassSection[])
            : [];
        return [row.user_id, parsed] as const;
      }),
    );
  }

  private async getPrimaryRoleByUserIds(userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return new Map<string, UserRoleSummary>();
    }

    const rows = (await this.dataSource.manager.query(
      `
      SELECT DISTINCT ON (ur.user_id)
        ur.user_id,
        r.role_code,
        r.role_name
      FROM user_roles ur
      JOIN roles r
        ON r.id = ur.role_id
       AND r.is_active = true
      WHERE ur.is_active = true
        AND ur.user_id = ANY($1::uuid[])
      ORDER BY ur.user_id, r.is_system_role DESC, r.role_code ASC
      `,
      [uniqueUserIds],
    )) as Array<{
      user_id: string;
      role_code: string;
      role_name: string;
    }>;

    return new Map(
      rows.map((row) => [
        row.user_id,
        { roleCode: row.role_code, roleName: row.role_name },
      ]),
    );
  }

  // ── US2: Download URL ────────────────────────────────────────────────

  async getBiometricDownloadUrl(faceProfileId: string, adminUserId: string) {
    const fp = await this.faceProfileRepo.findOne({
      where: { id: faceProfileId, deletedAt: IsNull() },
    });

    if (!fp)
      throw new NotFoundException({
        code: 'BIOMETRIC_SUBMISSION_NOT_FOUND',
        message: 'Biometric submission not found.',
      });
    if (!fp.primaryImageFileId)
      throw new NotFoundException({
        code: 'BIOMETRIC_MEDIA_NOT_FOUND',
        message: 'Biometric media file not found.',
      });

    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM media_files WHERE id = $1 AND deleted_at IS NULL`,
      [fp.primaryImageFileId],
    );
    if (rows.length === 0)
      throw new NotFoundException({
        code: 'BIOMETRIC_MEDIA_NOT_FOUND',
        message: 'Biometric media file not found.',
      });

    const baseUrl = this.configService.get<string>(
      'API_PUBLIC_BASE_URL',
      'http://localhost:3000',
    );
    const ttl = this.configService.get<number>(
      'MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS',
      600,
    );

    let signed: { token: string; expiresAt: string };
    try {
      signed = this.storageService.generateSignedDownloadToken(rows[0].id, ttl);
    } catch (err) {
      this.logger.error(
        `Failed to generate signed download token: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException({
        code: 'BIOMETRIC_DOWNLOAD_URL_FAILED',
        message: 'Failed to generate download URL.',
      });
    }

    const downloadUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/media-files/${rows[0].id}/secure-download?token=${signed.token}`;

    try {
      await this.dataSource.manager.insert(AuditLogEntity, {
        userId: adminUserId,
        actionType: 'biometric.download',
        entityType: 'face_profile',
        entityId: faceProfileId,
        severity: AuditLogSeverity.INFO,
        metadataJson: {
          targetUserId: fp.userId,
          mediaFileId: rows[0].id,
          expiresAt: signed.expiresAt,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for download: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { downloadUrl, expiresAt: signed.expiresAt };
  }

  // ── US3: Approve (transaction) ───────────────────────────────────────

  async approveBiometricSubmission(faceProfileId: string, adminUserId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const fpRows: FaceProfileEntity[] = await manager
          .createQueryBuilder(FaceProfileEntity, 'fp')
          .setLock('pessimistic_write')
          .where('fp.id = :id', { id: faceProfileId })
          .andWhere('fp.deletedAt IS NULL')
          .getMany();

        const fp = fpRows[0];
        if (!fp)
          throw new NotFoundException({
            code: 'BIOMETRIC_SUBMISSION_NOT_FOUND',
            message: 'Biometric submission not found.',
          });

        if (fp.status !== FaceProfileStatus.PENDING_REVIEW) {
          throw new ConflictException({
            code: 'BIOMETRIC_SUBMISSION_NOT_PENDING',
            message: 'Biometric submission is not in pending_review status.',
          });
        }

        const userRows: UserEntity[] = await manager
          .createQueryBuilder(UserEntity, 'u')
          .setLock('pessimistic_write')
          .where('u.id = :userId', { userId: fp.userId })
          .getMany();

        const user = userRows[0];
        if (!user || user.accountStatus !== 'active' || user.deletedAt) {
          throw new NotFoundException({
            code: 'USER_NOT_FOUND',
            message: 'User not found, inactive, or deleted.',
          });
        }

        if (!fp.primaryImageFileId) {
          throw new InternalServerErrorException({
            code: 'BIOMETRIC_APPROVE_FAILED',
            message: 'Primary image file ID is missing.',
          });
        }

        // [SỬA 2026-07-29] Trước đây SELECT file_url để đồng bộ users.avatar_url — nay chỉ
        // xác nhận media_files còn tồn tại (data integrity), KHÔNG còn dùng file_url.
        const mediaRows: Array<{ id: string }> = await manager.query(
          `SELECT id FROM media_files WHERE id = $1 AND deleted_at IS NULL`,
          [fp.primaryImageFileId],
        );
        if (mediaRows.length === 0) {
          throw new InternalServerErrorException({
            code: 'BIOMETRIC_APPROVE_FAILED',
            message: 'Media file record not found.',
          });
        }

        const now = new Date();

        const oldActive: FaceProfileEntity[] = await manager
          .createQueryBuilder(FaceProfileEntity, 'fp')
          .where('fp.userId = :userId', { userId: fp.userId })
          .andWhere('fp.status = :status', { status: FaceProfileStatus.ACTIVE })
          .andWhere('fp.id != :id', { id: faceProfileId })
          .andWhere('fp.deletedAt IS NULL')
          .getMany();

        if (oldActive.length > 0) {
          await manager.update(FaceProfileEntity, oldActive[0].id, {
            status: FaceProfileStatus.REVOKED,
            lastUpdatedAt: now,
          });
        }

        await manager.update(FaceProfileEntity, faceProfileId, {
          status: FaceProfileStatus.ACTIVE,
          lastUpdatedAt: now,
        });
        // [SỬA 2026-07-29] ĐÃ XOÁ: manager.update(UserEntity, fp.userId, { avatarUrl: ... }).
        // Approve KHÔNG còn cập nhật users.avatar_url (quyết định D2) — avatar hiển thị là
        // dữ liệu độc lập, quản lý bởi feature feat-update-avatar-photo.

        // [2026-07-30] Duyệt ảnh MỚI phải kéo theo KHO CHÂN DUNG THƯỜNG TRỰC.
        //
        // Hai luồng đẩy ảnh theo cuộc họp (`ivss-person-sync`, `face-provisioning`) tự cứu:
        // họp xong là deprovision mapping ⇒ họp sau enroll lại, tự lấy ảnh ACTIVE mới nhất.
        // Kho thường trực (`ivss-portrait-sync`) thì KHÔNG — mapping của nó là VĨNH VIỄN.
        // Để nguyên `synced`, reconcile sẽ coi như "đã đẩy rồi" và người đổi ảnh sẽ mãi bị
        // nhận diện bằng ảnh CŨ trên thiết bị.
        //
        // Hạ về 'pending' thay vì soft-delete — KHÁC BIỆT QUAN TRỌNG, đừng "tối ưu" thành
        // `deleted_at = now()`:
        //   · reconcile (1) lọc `NOT EXISTS(... sync_status='synced')` → user vào lại hàng đợi ✓
        //   · `enrollPortrait` dedupe theo `sync_status='synced'` → không noop nữa ✓
        //   · bước dọn person cũ trên IVSS lọc `deleted_at IS NULL` → VẪN thấy mapping để xoá
        //     ảnh cũ trước khi đẩy ảnh mới. Soft-delete làm bước này MÙ ⇒ ảnh cũ ở lại thiết bị
        //     và sinh trùng szUID (đúng thứ "Nợ #2" trong portrait-sync đang chống) ✗
        //   · reconcile (2) chỉ remove khi user KHÔNG còn face_profile active → không đụng ✓
        // 'pending' nằm trong CHECK `chk_device_user_mappings_sync_status`.
        //
        // Raw SQL trong CHÍNH transaction (atomic với approve): `IvssModule` đã import
        // `AccountsModule`, gọi ngược service bên đó sẽ tạo vòng phụ thuộc (repo cấm `forwardRef`).
        // CHỈ đụng source='portrait' — mapping theo cuộc họp đụng vào sẽ gây enroll thừa.
        const portraitReset: Array<{ id: string }> = await manager.query(
          `UPDATE device_user_mappings
              SET sync_status = 'pending',
                  face_registered = false,
                  last_sync_error = NULL,
                  updated_at = now()
            WHERE user_id = $1
              AND deleted_at IS NULL
              AND sync_status <> 'pending'
              AND metadata_json->>'source' = $2
          RETURNING id`,
          [fp.userId, PORTRAIT_MAPPING_SOURCE],
        );

        await manager.insert(AuditLogEntity, {
          userId: adminUserId,
          actionType: 'biometric.approve',
          entityType: 'face_profile',
          entityId: faceProfileId,
          oldValueJson: { status: FaceProfileStatus.PENDING_REVIEW },
          newValueJson: {
            status: FaceProfileStatus.ACTIVE,
            oldActiveFaceProfileId:
              oldActive.length > 0 ? oldActive[0].id : undefined,
            // Số mapping kho thường trực bị đánh dấu cần đẩy lại (0 khi cron chưa bật).
            portraitMappingsReset: portraitReset.length,
          },
          severity: AuditLogSeverity.INFO,
        });

        return {
          faceProfileId,
          userId: fp.userId,
          status: FaceProfileStatus.ACTIVE,
          approvedAt: now.toISOString(),
        };
      });
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ConflictException)
        throw err;
      this.logger.error(
        `Approve biometric failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException({
        code: 'BIOMETRIC_APPROVE_FAILED',
        message: 'Failed to approve biometric submission.',
      });
    }
  }

  // ── US4: Reject (transaction + notification) ──────────────────────────

  async rejectBiometricSubmission(
    faceProfileId: string,
    reason: string,
    adminUserId: string,
  ) {
    const normalizedReason = reason.trim().normalize('NFC');
    if (normalizedReason.length === 0) {
      throw new UnprocessableEntityException({
        code: 'BIOMETRIC_REJECTION_REASON_REQUIRED',
        message: 'Rejection reason is required.',
      });
    }
    if (Array.from(normalizedReason).length > 500) {
      throw new UnprocessableEntityException({
        code: 'BIOMETRIC_REJECTION_REASON_TOO_LONG',
        message: 'Rejection reason must not exceed 500 characters.',
      });
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const fpRows: FaceProfileEntity[] = await manager
          .createQueryBuilder(FaceProfileEntity, 'fp')
          .setLock('pessimistic_write')
          .where('fp.id = :id', { id: faceProfileId })
          .andWhere('fp.deletedAt IS NULL')
          .getMany();

        const fp = fpRows[0];
        if (!fp)
          throw new NotFoundException({
            code: 'BIOMETRIC_SUBMISSION_NOT_FOUND',
            message: 'Biometric submission not found.',
          });
        if (fp.status !== FaceProfileStatus.PENDING_REVIEW) {
          throw new ConflictException({
            code: 'BIOMETRIC_SUBMISSION_NOT_PENDING',
            message: 'Biometric submission is not in pending_review status.',
          });
        }

        const userRows: UserEntity[] = await manager
          .createQueryBuilder(UserEntity, 'u')
          .setLock('pessimistic_write')
          .where('u.id = :userId', { userId: fp.userId })
          .getMany();

        const user = userRows[0];
        if (!user || user.accountStatus !== 'active' || user.deletedAt) {
          throw new NotFoundException({
            code: 'USER_NOT_FOUND',
            message: 'User not found, inactive, or deleted.',
          });
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const reasonEscaped = normalizedReason.replace(/'/g, "''");

        await manager
          .createQueryBuilder()
          .update(FaceProfileEntity)
          .set({
            status: FaceProfileStatus.REJECTED,
            metadataJson: () =>
              `jsonb_set(COALESCE(metadata_json, '{}'::jsonb), '{review}', '{"rejectionReason": "${reasonEscaped}", "reviewedBy": "${adminUserId}", "reviewedAt": "${nowIso}"}')`,
            lastUpdatedAt: now,
          })
          .where('id = :id', { id: faceProfileId })
          .execute();

        await manager.insert(AuditLogEntity, {
          userId: adminUserId,
          actionType: 'biometric.reject',
          entityType: 'face_profile',
          entityId: faceProfileId,
          oldValueJson: { status: FaceProfileStatus.PENDING_REVIEW },
          newValueJson: { status: FaceProfileStatus.REJECTED },
          severity: AuditLogSeverity.INFO,
          metadataJson: { rejectionReason: normalizedReason },
        });

        await manager.insert(NotificationEntity, {
          notificationType: NotificationType.BIOMETRIC_REJECTED,
          channel: NotificationChannel.IN_APP,
          subject: 'Ảnh sinh trắc học không được chấp nhận',
          content: normalizedReason
            ? `Ảnh sinh trắc học của bạn không được chấp nhận. Vui lòng nộp lại ảnh khác.\nLý do: ${normalizedReason}`
            : 'Ảnh sinh trắc học của bạn không được chấp nhận. Vui lòng nộp lại ảnh khác.',
          relatedEntityType: 'face_profile',
          relatedEntityId: faceProfileId,
          recipientUserIdsJson: [fp.userId],
          deliveryStatus: NotificationDeliveryStatus.QUEUED,
          priority: NotificationPriority.NORMAL,
          createdBy: adminUserId,
          payloadJson: {
            reason: normalizedReason,
            reviewedBy: adminUserId,
            reviewedAt: nowIso,
          },
        });

        return {
          faceProfileId,
          userId: fp.userId,
          status: FaceProfileStatus.REJECTED,
          rejectedAt: nowIso,
        };
      });
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof UnprocessableEntityException
      )
        throw err;
      this.logger.error(
        `Reject biometric failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException({
        code: 'BIOMETRIC_REJECT_FAILED',
        message: 'Failed to reject biometric submission.',
      });
    }
  }

  // ── US5: Delete (transaction) ──────────────────────────────────────────
  //
  // Soft-delete qua face_profiles.deleted_at (cột đã có sẵn ở entity). KHÔNG cần
  // tự tay hạ device_user_mappings (source='portrait') như approve() — khi ảnh bị
  // xoá, IvssPortraitSyncService.reconcilePortraits() bước (2) tự nhận ra user
  // "NOT EXISTS (face_profiles.status='active' AND deleted_at IS NULL)" ở lượt cron
  // kế tiếp và tự gỡ mapping/person trên IVSS — xem ivss-portrait-sync.service.ts:366-390.

  async deleteBiometricSubmission(faceProfileId: string, adminUserId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const fpRows: FaceProfileEntity[] = await manager
          .createQueryBuilder(FaceProfileEntity, 'fp')
          .setLock('pessimistic_write')
          .where('fp.id = :id', { id: faceProfileId })
          .andWhere('fp.deletedAt IS NULL')
          .getMany();

        const fp = fpRows[0];
        if (!fp)
          throw new NotFoundException({
            code: 'BIOMETRIC_SUBMISSION_NOT_FOUND',
            message: 'Biometric submission not found.',
          });

        const now = new Date();

        await manager.update(FaceProfileEntity, faceProfileId, {
          deletedAt: now,
          lastUpdatedAt: now,
        });

        await manager.insert(AuditLogEntity, {
          userId: adminUserId,
          actionType: 'biometric.delete',
          entityType: 'face_profile',
          entityId: faceProfileId,
          oldValueJson: { status: fp.status },
          newValueJson: { deletedAt: now.toISOString() },
          severity: AuditLogSeverity.INFO,
          metadataJson: { targetUserId: fp.userId },
        });

        return {
          faceProfileId,
          userId: fp.userId,
          deletedAt: now.toISOString(),
        };
      });
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(
        `Delete biometric failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException({
        code: 'BIOMETRIC_DELETE_FAILED',
        message: 'Failed to delete biometric submission.',
      });
    }
  }
}
