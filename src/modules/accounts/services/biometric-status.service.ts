import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import {
  resolveBiometricReviewStatus,
  FaceProfileStatusRow,
  BiometricReviewStatus,
} from '../../../common/utils/biometric-status-resolver.util.js';
import { isBiometricExemptRole } from '../../../common/utils/biometric-exempt-roles.util.js';
import { getActiveRoleCodes } from '../utils/active-role-codes.util.js';
import {
  BiometricProfileViewDto,
  BiometricStatusResponseDto,
} from '../dto/biometric-status-response.dto.js';

/**
 * BiometricStatusService — ACCT-BIOMETRIC-SUBMIT-001 (US1, FR-001/002/005).
 *
 * [SỬA 2026-07-29] Đổi tên từ AvatarStatusService — luồng này là sinh trắc học, không
 * phải avatar hiển thị. Xem spec/features/account/feat-split-avatar-and-biometric/plan.md.
 *
 * Đọc toàn bộ row face_profiles (chưa soft-delete) của chính user, resolve trạng thái
 * theo BR-004. `users.avatar_url` (chỉ đọc, field `avatarUrl` GIỮ NGUYÊN tên trong response)
 * nay hoàn toàn độc lập với kết quả duyệt sinh trắc học — do feature `feat-update-avatar-photo`
 * quản lý (quyết định D2).
 */
@Injectable()
export class BiometricStatusService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(FaceProfileEntity)
    private readonly faceProfileRepo: Repository<FaceProfileEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async getStatus(userId: string): Promise<BiometricStatusResponseDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, avatarUrl: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Không tìm thấy tài khoản.',
      });
    }

    // @DeleteDateColumn → find() tự loại soft-deleted (deleted_at IS NULL).
    const profiles = await this.faceProfileRepo.find({
      where: { userId },
      select: {
        id: true,
        status: true,
        lastUpdatedAt: true,
        enrolledAt: true,
        sampleCount: true,
        primaryImageFileId: true,
        metadataJson: true,
      },
    });

    const rows: FaceProfileStatusRow[] = profiles.map((p) => ({
      status: p.status,
      lastUpdatedAt: p.lastUpdatedAt,
      enrolledAt: p.enrolledAt,
    }));

    const resolution = resolveBiometricReviewStatus(rows);
    const profile = await this.buildProfileView(profiles);

    // BA 2026-08-03: Business Admin/System Admin không cần sinh trắc học vì
    // không trực tiếp tham dự họp qua FaceGate — miễn trừ 2 cờ, giữ nguyên
    // biometricReviewStatus gốc (không thêm giá trị enum mới).
    const roleCodes = await getActiveRoleCodes(this.dataSource.manager, userId);
    if (isBiometricExemptRole(roleCodes)) {
      return {
        biometricReviewStatus: resolution.biometricReviewStatus,
        avatarUrl: user.avatarUrl,
        biometricRequired: false,
        shouldShowBiometricPopup: false,
        message:
          'Tài khoản Business Admin/System Admin không yêu cầu đăng ký sinh trắc học.',
        profile,
      };
    }

    return {
      biometricReviewStatus: resolution.biometricReviewStatus,
      avatarUrl: user.avatarUrl,
      biometricRequired: resolution.biometricRequired,
      shouldShowBiometricPopup: resolution.shouldShowBiometricPopup,
      message: this.buildMessage(resolution.biometricReviewStatus, rows),
      profile,
    };
  }

  /**
   * [2026-11-23] Chọn hồ sơ hiển thị (cùng thứ tự ưu tiên với resolver) + ảnh từng góc.
   * Ảnh lấy từ media_files gắn với hồ sơ; thứ tự góc theo metadata_json.poses.
   */
  private async buildProfileView(
    profiles: FaceProfileEntity[],
  ): Promise<BiometricProfileViewDto | null> {
    if (profiles.length === 0) return null;
    const ts = (p: FaceProfileEntity) =>
      (p.lastUpdatedAt ?? p.enrolledAt)?.getTime?.() ?? 0;
    const byRecent = [...profiles].sort((a, b) => ts(b) - ts(a));
    const chosen =
      byRecent.find((p) => p.status === FaceProfileStatus.PENDING_REVIEW) ??
      byRecent.find((p) => p.status === FaceProfileStatus.ACTIVE) ??
      byRecent[0];

    const meta = (chosen.metadataJson ?? {}) as {
      poses?: string[];
      flag?: { message?: string };
      review?: { rejectionReason?: string };
    };
    const media: Array<{
      id: string;
      file_url: string | null;
      file_name: string | null;
    }> = await this.dataSource.manager.query(
      `SELECT id, file_url, file_name
           FROM media_files
          WHERE deleted_at IS NULL
            AND related_entity_type = 'face_profile'
            AND related_entity_id = $1
          ORDER BY uploaded_at ASC, file_name ASC`,
      [chosen.id],
    );
    // fileName lưu dạng `<pose>-<publicId>` (submitScan) → suy góc, sắp theo thứ tự quét.
    const poses = meta.poses ?? [];
    const rank = (pose: string) => {
      const i = poses.indexOf(pose);
      return i < 0 ? poses.length : i;
    };
    const images = media
      .map((m, i) => {
        const prefix = m.file_name?.split('-')[0] ?? '';
        return {
          mediaFileId: m.id,
          pose: poses.includes(prefix) ? prefix : (poses[i] ?? `img${i + 1}`),
          url: m.file_url,
        };
      })
      .sort((a, b) => rank(a.pose) - rank(b.pose));
    // Hồ sơ cũ chỉ có primary_image_file_id (không qua related_entity) → vẫn trả 1 ảnh.
    if (images.length === 0 && chosen.primaryImageFileId) {
      const rows: Array<{ id: string; file_url: string | null }> =
        await this.dataSource.manager.query(
          `SELECT id, file_url FROM media_files WHERE id = $1 AND deleted_at IS NULL`,
          [chosen.primaryImageFileId],
        );
      for (const r of rows) {
        images.push({ mediaFileId: r.id, pose: 'front', url: r.file_url });
      }
    }

    return {
      faceProfileId: chosen.id,
      status: chosen.status,
      sampleCount: chosen.sampleCount ?? images.length,
      submittedAt:
        (chosen.enrolledAt ?? chosen.lastUpdatedAt)?.toISOString?.() ?? null,
      reason:
        chosen.status === FaceProfileStatus.PENDING_REVIEW
          ? (meta.flag?.message ?? null)
          : chosen.status === FaceProfileStatus.ACTIVE
            ? null
            : (meta.review?.rejectionReason ?? null),
      images,
    };
  }

  /**
   * Build message tiếng Việt theo trạng thái resolve.
   * Với 'rejected': phân biệt reject thật (có row status='rejected') vs
   * disabled/revoked (AC-016/AC-017 yêu cầu wording trung tính, không lộ lý do nội bộ).
   */
  private buildMessage(
    status: BiometricReviewStatus,
    rows: FaceProfileStatusRow[],
  ): string {
    switch (status) {
      case 'not_uploaded':
        return 'Bạn cần cập nhật ảnh sinh trắc học để phục vụ nhận diện khuôn mặt.';
      case 'pending_review':
        return 'Khuôn mặt của bạn cần quản trị viên kiểm tra thêm.';
      case 'approved':
        return 'Bạn đã đăng ký khuôn mặt (FaceID).';
      case 'rejected':
        return rows.some((row) => row.status === 'rejected')
          ? 'Ảnh sinh trắc học trước đó đã bị từ chối. Vui lòng nộp lại ảnh khác.'
          : 'Ảnh/hồ sơ khuôn mặt hiện tại không còn hợp lệ. Vui lòng upload lại ảnh khác.';
      default:
        return '';
    }
  }
}
