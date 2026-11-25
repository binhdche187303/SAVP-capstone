import {
  Controller,
  Post,
  Param,
  Req,
  HttpCode,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseUUIDPipe,
  Body,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import {
  BiometricSubmissionService,
  UploadedBiometricFile,
} from '../services/biometric-submission.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

const PORTRAIT_LIMIT =
  Number(process.env.FACE_PORTRAIT_MAX_BYTES) || 5 * 1024 * 1024;

@Controller()
export class FaceProfileController {
  constructor(
    private readonly biometricSubmissionService: BiometricSubmissionService,
  ) {}
  // UC-17: admin đăng ký khuôn mặt hộ user.
  // [2026-11-23] Tự duyệt: đi qua CÙNG các lớp kiểm tra như tự quét (1 mặt/ảnh, trùng
  // định danh → "Cần kiểm tra"). Nhận `file` (1 ảnh, tương thích cũ) hoặc `files` (nhiều góc).
  @Post('users/:userId/face-profile')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('account.face.register')
  @UseInterceptors(
    AnyFilesInterceptor({ limits: { fileSize: PORTRAIT_LIMIT, files: 5 } }),
  )
  async enroll(
    @Param('userId', ParseUUIDPipe) userId: string,
    @UploadedFiles()
    files: Array<UploadedBiometricFile & { fieldname: string }> | undefined,
    @Body() body: { poses?: string },
    @Req()
    req: { user?: { userId?: string; sub?: string; id?: string } },
  ) {
    const enrolledBy: string | null =
      req.user?.userId || req.user?.sub || req.user?.id || null;
    const picked = (files ?? []).filter(
      (f) => f.fieldname === 'file' || f.fieldname === 'files',
    );
    const poses = String(body?.poses ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const result = await this.biometricSubmissionService.submitScan(
      userId,
      picked,
      poses.length ? poses : ['front'],
      true,
      {
        minImages: 1,
        actorId: enrolledBy ?? undefined,
        source: 'admin_upload',
        skipConsent: true,
      },
    );
    return {
      success: true,
      message: 'Face portrait enrolled',
      data: {
        ...result,
        status:
          result.biometricReviewStatus === 'approved'
            ? 'active'
            : 'pending_review',
      },
    };
  }
}
