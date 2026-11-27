import { Injectable } from '@nestjs/common';
import { AuthUserSummary, LoginSuccessData } from '../types/login.types';

@Injectable()
export class LoginResponsePresenter {
  success(data: LoginSuccessData): {
    success: true;
    message: string;
    data: LoginSuccessData;
    meta: Record<string, never>;
  } {
    return {
      success: true,
      message: 'Đăng nhập thành công',
      data,
      meta: {},
    };
  }

  userSummary(user: AuthUserSummary): AuthUserSummary {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      biometricReviewStatus: user.biometricReviewStatus,
      biometricRequired: user.biometricRequired,
      shouldShowBiometricPopup: user.shouldShowBiometricPopup,
      departmentId: user.departmentId,
      roles: user.roles,
      permissions: user.permissions,
      mustChangePassword: user.mustChangePassword === true,
    };
  }
}
