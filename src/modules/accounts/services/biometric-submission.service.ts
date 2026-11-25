import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import { UserEntity, AccountStatus } from '../entities/user.entity.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
} from '../../recording/entities/media-file.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { CloudinaryService } from '../../storage/cloudinary.service.js';
import { detectImageMimeType } from '../utils/image-magic-bytes.util.js';
import { generateFaceProfileCode } from '../utils/face-profile-code.util.js';
import { getActiveRoleCodes } from '../utils/active-role-codes.util.js';
import { isBiometricExemptRole } from '../../../common/utils/biometric-exempt-roles.util.js';
import {
  FaceEnrollmentHook,
  FaceImageInspection,
} from './face-enrollment.hook.js';
import { BiometricSubmissionResponseDto } from '../dto/biometric-submission-response.dto.js';

export interface UploadedBiometricFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const UNIQUE_VIOLATION_CODE = '23505';

/** Số góc mặt bắt buộc khi tự quét (thẳng, trái, phải, ngẩng, cúi). */
export const REQUIRED_SCAN_POSES = 5;

/** Ngưỡng điểm (0..1) coi là trùng định danh người khác — chỉnh qua FACE_DUPLICATE_MIN_SCORE. */
const DEFAULT_DUP_SCORE = 0.6;

/**
 * BiometricSubmissionService — ACCT-BIOMETRIC-SUBMIT-001 (US2).
 *
 * [SỬA 2026-07-29] Đổi tên từ AvatarSubmissionService — luồng này là sinh trắc học bắt buộc
 * cho FaceGate (phải duyệt), tách biệt hoàn toàn khỏi avatar hiển thị. Xem
 * spec/features/account/feat-split-avatar-and-biometric/plan.md.
 *
 * Xử lý POST /api/v1/me/biometric-submission theo đúng precedence (spec §11.2) và
 * transaction/insert order pre-generate UUID (spec §18.7), best-effort cleanup
 * Cloudinary khi DB transaction fail (EH-01 / EC-004).
 */
@Injectable()
export class BiometricSubmissionService {
  private readonly logger = new Logger(BiometricSubmissionService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(FaceProfileEntity)
    private readonly faceProfileRepo: Repository<FaceProfileEntity>,
    private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService,
    private readonly faceEnrollmentHook: FaceEnrollmentHook,
  ) {}

  /** Luồng cũ 1 ảnh (giữ tương thích) — đi qua cùng các lớp kiểm tra tự động. */
  async submit(
    userId: string,
    file: UploadedBiometricFile | undefined,
    consentAccepted: unknown,
  ): Promise<BiometricSubmissionResponseDto> {
    return this.submitScan(
      userId,
      file ? [file] : [],
      ['front'],
      consentAccepted,
      { minImages: 1, source: 'single_upload' },
    );
  }

  /**
   * [2026-11-23] Đăng ký FaceID TỰ DUYỆT (không còn hàng chờ duyệt tay).
   *
   * Lớp 1 (client): cổng chất lượng khi quét 5 góc. Server làm lớp 2 + 3 qua HGVision
   * `faces/search`: mỗi ảnh đúng 1 khuôn mặt; khuôn mặt khớp định danh CỦA NGƯỜI KHÁC
   * (≥ FACE_DUPLICATE_MIN_SCORE) → hồ sơ "Cần kiểm tra" (pending_review) thay vì active.
   * Không có checker (CAMERA_PROVIDER ≠ hgvision) hoặc kho lỗi → vẫn duyệt, serverCheck='skipped'.
   * Hồ sơ active cũ chỉ bị thay khi bộ mới qua kiểm tra.
   */
  async submitScan(
    userId: string,
    files: UploadedBiometricFile[],
    poses: string[],
    consentAccepted: unknown,
    opts: {
      minImages?: number;
      actorId?: string;
      source?: string;
      clientMeta?: unknown;
      skipConsent?: boolean;
    } = {},
  ): Promise<BiometricSubmissionResponseDto> {
    const actorId = opts.actorId ?? userId;
    const minImages = opts.minImages ?? REQUIRED_SCAN_POSES;
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, accountStatus: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Không tìm thấy tài khoản.',
      });
    }
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: 'Tài khoản không ở trạng thái active.',
      });
    }
    const roleCodes = await getActiveRoleCodes(this.dataSource.manager, userId);
    if (isBiometricExemptRole(roleCodes)) {
      throw new ForbiddenException({
        code: 'BIOMETRIC_NOT_APPLICABLE_FOR_ROLE',
        message:
          'Tài khoản Business Admin/System Admin không cần đăng ký sinh trắc học vì không trực tiếp tham dự họp qua FaceGate.',
      });
    }
    const valid = (files ?? []).filter((f) => f?.buffer && f.buffer.length > 0);
    if (valid.length === 0) {
      throw new BadRequestException({
        code: 'BIOMETRIC_FILE_REQUIRED',
        message: 'Vui lòng đính kèm ảnh sinh trắc học.',
      });
    }
    if (valid.length < minImages) {
      throw new BadRequestException({
        code: 'BIOMETRIC_SCAN_INCOMPLETE',
        message: `Cần đủ ${minImages} ảnh (các góc mặt), mới nhận ${valid.length}.`,
      });
    }
    const maxBytes = this.configService.get<number>(
      'FACE_PORTRAIT_MAX_BYTES',
      DEFAULT_MAX_BYTES,
    );
    const mimes: string[] = [];
    for (const f of valid) {
      if (f.size > maxBytes) {
        throw new BadRequestException({
          code: 'BIOMETRIC_FILE_TOO_LARGE',
          message: `Ảnh vượt quá giới hạn ${maxBytes} bytes.`,
        });
      }
      const m = detectImageMimeType(f.buffer);
      if (!m) {
        throw new BadRequestException({
          code: 'BIOMETRIC_FILE_TYPE_INVALID',
          message: 'Ảnh phải có định dạng JPEG, PNG hoặc WEBP.',
        });
      }
      mimes.push(m);
    }
    if (!opts.skipConsent) {
      const consentOk = consentAccepted === true || consentAccepted === 'true';
      if (!consentOk) {
        throw new BadRequestException({
          code: 'BIOMETRIC_CONSENT_REQUIRED',
          message:
            'Bạn phải đồng ý sử dụng ảnh cho mục đích nhận diện khuôn mặt.',
        });
      }
    }
    const poseOf = (i: number) => poses?.[i] || `img${i + 1}`;

    // ── Lớp 2 + 3: kiểm tra ở server TRƯỚC khi upload (hỏng thì không phải dọn kho) ──
    const checker = this.faceEnrollmentHook.imageChecker;
    let serverCheck: 'passed' | 'skipped' = 'skipped';
    const duplicates: Array<{
      pose: string;
      faceIdent: string;
      score: number;
    }> = [];
    if (checker) {
      const minScore = Number(
        this.configService.get('FACE_DUPLICATE_MIN_SCORE', DEFAULT_DUP_SCORE),
      );
      let ownIdent: string | null = null;
      try {
        ownIdent = await checker.faceIdentOf(userId);
      } catch {
        ownIdent = null;
      }
      let checkFailed = false;
      for (let i = 0; i < valid.length; i++) {
        let res: FaceImageInspection;
        try {
          res = await checker.inspect(valid[i].buffer, mimes[i]);
        } catch (e) {
          // Kho định danh không phản hồi → không chặn người dùng; đánh dấu skipped.
          this.logger.warn(
            `Kiểm tra ảnh ${poseOf(i)} của ${userId} lỗi: ${e instanceof Error ? e.message : String(e)}`,
          );
          checkFailed = true;
          break;
        }
        if (res.faceCount !== 1) {
          throw new UnprocessableEntityException({
            code:
              res.faceCount === 0
                ? 'BIOMETRIC_NO_FACE'
                : 'BIOMETRIC_MULTIPLE_FACES',
            message:
              res.faceCount === 0
                ? `Không thấy khuôn mặt trong ảnh góc "${poseOf(i)}". Vui lòng quét lại.`
                : `Ảnh góc "${poseOf(i)}" có ${res.faceCount} khuôn mặt — chỉ được có 1 người trong khung hình.`,
            details: { pose: poseOf(i), faceCount: res.faceCount },
          });
        }
        for (const m of res.matches) {
          // HGVision có thể trả thang 0..100 — quy về 0..1.
          const s = m.score > 1 ? m.score / 100 : m.score;
          if (s >= minScore && m.faceIdent && m.faceIdent !== ownIdent) {
            duplicates.push({
              pose: poseOf(i),
              faceIdent: m.faceIdent,
              score: s,
            });
            break;
          }
        }
      }
      if (!checkFailed) serverCheck = 'passed';
    }
    const flagged = duplicates.length > 0;

    // ── Upload Cloudinary ──
    const uploads: Array<{ publicId: string; secureUrl: string }> = [];
    try {
      for (const f of valid) {
        uploads.push(await this.cloudinaryService.uploadImage(f.buffer));
      }
    } catch (error) {
      for (const u of uploads) await this.cleanupCloudinary(u.publicId);
      this.logger.error(
        `Cloudinary upload failed for user ${userId}.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException({
        code: 'BIOMETRIC_STORAGE_FAILED',
        message: 'Không thể lưu ảnh lên kho lưu trữ. Vui lòng thử lại.',
      });
    }
    const faceProfileId = randomUUID();
    const mediaIds = uploads.map(() => randomUUID());

    const now = new Date();
    // Luôn tự duyệt: trùng người khác chỉ GẮN CỜ (metadata.flag + audit) để quản trị
    // hậu kiểm / gỡ — người dùng không phải chờ.
    const status = FaceProfileStatus.ACTIVE;
    const metadata: Record<string, unknown> = {
      source: opts.source ?? 'webcam_scan',
      poses: uploads.map((_, i) => poseOf(i)),
      serverCheck,
      ...(opts.clientMeta ? { client: opts.clientMeta } : {}),
      ...(flagged
        ? {
            flag: {
              reason: 'duplicate_identity',
              message:
                'Khuôn mặt trùng với định danh của người khác trong hệ thống.',
              matches: duplicates,
              flaggedAt: now.toISOString(),
            },
          }
        : {}),
    };
    try {
      await this.dataSource.transaction(async (manager) => {
        const existing: FaceProfileEntity[] = await manager
          .createQueryBuilder(FaceProfileEntity, 'fp')
          .setLock('pessimistic_write')
          .where('fp.userId = :userId', { userId })
          .andWhere('fp.deletedAt IS NULL')
          .andWhere('fp.status IN (:...st)', {
            st: [FaceProfileStatus.PENDING_REVIEW, FaceProfileStatus.ACTIVE],
          })
          .getMany();
        // Bộ "Cần kiểm tra" cũ bị thay bằng lần quét mới.
        for (const p of existing.filter(
          (x) => x.status === FaceProfileStatus.PENDING_REVIEW,
        )) {
          await manager.update(FaceProfileEntity, p.id, {
            status: FaceProfileStatus.REJECTED,
            metadataJson: {
              ...(p.metadataJson ?? {}),
              supersededBy: faceProfileId,
              supersededAt: now.toISOString(),
            },
            lastUpdatedAt: now,
          });
        }
        let revokedId: string | undefined;
        const oldActive = existing.find(
          (x) => x.status === FaceProfileStatus.ACTIVE,
        );
        if (oldActive) {
          revokedId = oldActive.id;
          await manager.update(FaceProfileEntity, oldActive.id, {
            status: FaceProfileStatus.REVOKED,
            metadataJson: {
              ...(oldActive.metadataJson ?? {}),
              replacedBy: faceProfileId,
              replacedAt: now.toISOString(),
            },
            lastUpdatedAt: now,
          });
        }
        await manager.getRepository(MediaFileEntity).insert(
          uploads.map((u, i) => ({
            id: mediaIds[i],
            fileName: `${poseOf(i)}-${u.publicId.split('/').pop() ?? u.publicId}`,
            fileType: MediaFileType.IMAGE,
            mimeType: mimes[i],
            storageProvider:
              this.cloudinaryService.resolveMediaStorageProvider(),
            storageKey: u.publicId,
            fileUrl: u.secureUrl,
            relatedEntityType: 'face_profile',
            relatedEntityId: faceProfileId,
            uploadedBy: actorId,
            isActive: true,
          })),
        );

        await manager.getRepository(FaceProfileEntity).insert({
          id: faceProfileId,
          userId,
          profileCode: generateFaceProfileCode(),
          status,
          primaryImageFileId: mediaIds[0],
          consentAt: now,
          enrolledBy: actorId,
          enrolledAt: now,
          lastUpdatedAt: now,
          sampleCount: uploads.length,
          // jsonb: kiểu QueryDeepPartial của TypeORM không nhận Record<string, unknown>.
          metadataJson: metadata as never,
        });
        // Kho chân dung IVSS thường trực: hạ mapping về pending để đẩy lại ảnh mới
        // (cùng lý do như approve ở AdminBiometricReviewService).
        await manager.query(
          `UPDATE device_user_mappings
              SET sync_status = 'pending', face_registered = false, updated_at = now()
            WHERE user_id = $1 AND deleted_at IS NULL
              AND sync_status <> 'pending'
              AND metadata_json->>'source' = 'portrait'`,
          [userId],
        );

        await manager.getRepository(AuditLogEntity).insert({
          userId: actorId,
          actionType: 'biometric.auto_approve',
          entityType: 'face_profile',
          entityId: faceProfileId,
          oldValueJson: revokedId ? { revokedFaceProfileId: revokedId } : null,
          newValueJson: {
            status,
            targetUserId: userId,
            sampleCount: uploads.length,
            serverCheck,
            source: String(metadata.source),
            ...(flagged ? { flagged: true, duplicates } : {}),
          },
        });
      });
    } catch (error) {
      for (const u of uploads) await this.cleanupCloudinary(u.publicId);
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { driverError?: { code?: string } }).driverError
          ?.code === UNIQUE_VIOLATION_CODE
      ) {
        throw new ConflictException({
          code: 'BIOMETRIC_SUBMIT_IN_PROGRESS',
          message: 'Đang xử lý một lần đăng ký khác, vui lòng thử lại.',
        });
      }
      this.logger.error(
        `Biometric scan DB transaction failed for user ${userId}.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException({
        code: 'BIOMETRIC_UPLOAD_FAILED',
        message: 'Xử lý đăng ký khuôn mặt thất bại. Vui lòng thử lại.',
      });
    }
    await this.faceEnrollmentHook.notifyChanged(userId);

    return {
      faceProfileId,
      biometricReviewStatus: 'approved',
      submittedAt: now.toISOString(),
      sampleCount: uploads.length,
      serverCheck,
    };
  }

  /** Best-effort xóa Cloudinary object orphan; KHÔNG ném lỗi ra ngoài (EH-01). */
  private async cleanupCloudinary(publicId: string): Promise<void> {
    try {
      await this.cloudinaryService.deleteImage(publicId);
      this.logger.log(`Cleaned up orphan Cloudinary object: ${publicId}`);
    } catch (cleanupError) {
      this.logger.warn(
        `Failed to clean up orphan Cloudinary object ${publicId}.`,
        cleanupError instanceof Error ? cleanupError.stack : undefined,
      );
    }
  }
}
