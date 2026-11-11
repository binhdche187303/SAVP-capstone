import type { BiometricReviewStatus } from '../../../common/utils/biometric-status-resolver.util';

export interface AuthUserSummary {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  // ACCT-BIOMETRIC-SUBMIT-001 (BR-016): field derived trạng thái sinh trắc học cho FE popup.
  // [SỬA 2026-07-29] avatarReviewStatus→biometricReviewStatus, avatarRequired→biometricRequired,
  // shouldShowAvatarPopup→shouldShowBiometricPopup — breaking API contract change, báo FE.
  // avatarUrl GIỮ NGUYÊN tên, nay độc lập hoàn toàn (feature feat-update-avatar-photo).
  biometricReviewStatus: BiometricReviewStatus;
  biometricRequired: boolean;
  shouldShowBiometricPopup: boolean;
  departmentId: string | null;
  roles: string[];
  permissions: string[];
}

export interface LoginSuccessData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUserSummary;
}

export interface RequestContextInfo {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuthenticatedUserRecord {
  id: string;
  email: string;
  /** Null với tài khoản đồng bộ từ UEL chưa đặt mật khẩu. */
  passwordHash: string | null;
  fullName: string;
  avatarUrl: string | null;
  departmentId: string | null;
  accountStatus: string;
  accountExpiresAt: Date | null;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
}

/** Cách user được xác thực — ghi vào audit_logs.metadata_json.method (bỏ qua khi 'password'). */
export type LoginMethod = 'password' | 'uel_sso';
