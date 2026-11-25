import type { BiometricReviewStatus } from '../../../common/utils/biometric-status-resolver.util.js';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 (FR-005) — Response cho GET /api/v1/me/biometric-status.
 *
 * `avatarUrl` GIỮ NGUYÊN tên field — nhưng từ nay chỉ đọc thẳng `users.avatar_url`,
 * do feature độc lập `feat-update-avatar-photo` quản lý, KHÔNG còn liên quan đến
 * kết quả duyệt sinh trắc học (xem feat-split-avatar-and-biometric/plan.md quyết định D2).
 */
export class BiometricStatusResponseDto {
  biometricReviewStatus: BiometricReviewStatus;
  avatarUrl: string | null;
  biometricRequired: boolean;
  shouldShowBiometricPopup: boolean;
  message: string;
  /**
   * [2026-11-23] Hồ sơ đang hiển thị cho user (ưu tiên: Cần kiểm tra > Đã đăng ký > gần nhất).
   * null khi chưa đăng ký.
   */
  profile?: BiometricProfileViewDto | null;
}

export class BiometricProfileImageDto {
  mediaFileId: string;
  pose: string;
  url: string | null;
}

export class BiometricProfileViewDto {
  faceProfileId: string;
  status: string;
  sampleCount: number;
  submittedAt: string | null;
  /** Lý do "Cần kiểm tra" hoặc "Bị gỡ" (nếu có). */
  reason: string | null;
  images: BiometricProfileImageDto[];
}
