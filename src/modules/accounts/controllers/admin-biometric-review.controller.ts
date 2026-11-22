import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  UseFilters,
  UsePipes,
  ValidationPipe,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { AdminBiometricReviewService } from '../services/admin-biometric-review.service.js';
import { ListBiometricSubmissionsQueryDto } from '../dto/list-biometric-submissions-query.dto.js';
import { RejectBiometricSubmissionDto } from '../dto/reject-biometric-submission.dto.js';
import { biometricSubmissionIdPipe } from '../pipes/biometric-submission-id.pipe.js';
import { AdminBiometricReviewHttpExceptionFilter } from '../filters/admin-biometric-review-http-exception.filter.js';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

/**
 * AdminBiometricReviewController — ACCT-BIOMETRIC-REVIEW-001.
 *
 * [SỬA 2026-07-29] Đổi tên từ AdminAvatarReviewController — luồng này duyệt ảnh sinh
 * trắc học bắt buộc cho FaceGate, KHÔNG phải avatar hiển thị. Xem
 * spec/features/account/feat-split-avatar-and-biometric/plan.md.
 */
@Controller('admin/biometric-submissions')
@UseFilters(AdminBiometricReviewHttpExceptionFilter)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminBiometricReviewController {
  constructor(private readonly service: AdminBiometricReviewService) {}

  @Get()
  @RequirePermissions('account.biometric.review')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async list(@Query() query: ListBiometricSubmissionsQueryDto) {
    const result = await this.service.listBiometricSubmissions(query);
    return {
      success: true,
      message: 'Biometric submissions retrieved successfully',
      ...result,
    };
  }

  @Get(':faceProfileId')
  @RequirePermissions('account.biometric.review')
  async detail(
    @Param('faceProfileId', biometricSubmissionIdPipe()) faceProfileId: string,
  ) {
    const data = await this.service.getBiometricSubmissionDetail(faceProfileId);
    return {
      success: true,
      message: 'Biometric submission detail retrieved successfully',
      data,
    };
  }

  @Get(':faceProfileId/download-url')
  @RequirePermissions('account.biometric.download')
  async downloadUrl(
    @Param('faceProfileId', biometricSubmissionIdPipe()) faceProfileId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const data = await this.service.getBiometricDownloadUrl(
      faceProfileId,
      request.user.userId,
    );
    return {
      success: true,
      message: 'Download URL generated successfully',
      data,
    };
  }

  @Post(':faceProfileId/approve')
  @HttpCode(200)
  @RequirePermissions('account.biometric.review')
  async approve(
    @Param('faceProfileId', biometricSubmissionIdPipe()) faceProfileId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const data = await this.service.approveBiometricSubmission(
      faceProfileId,
      request.user.userId,
    );
    return {
      success: true,
      message: 'Ảnh sinh trắc học đã được duyệt thành công',
      data,
    };
  }

  @Post(':faceProfileId/reject')
  @HttpCode(200)
  @RequirePermissions('account.biometric.review')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async reject(
    @Param('faceProfileId', biometricSubmissionIdPipe()) faceProfileId: string,
    @Body() dto: RejectBiometricSubmissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const data = await this.service.rejectBiometricSubmission(
      faceProfileId,
      dto.reason,
      request.user.userId,
    );
    return { success: true, message: 'Ảnh sinh trắc học đã bị từ chối', data };
  }

  @Delete(':faceProfileId')
  @HttpCode(200)
  @RequirePermissions('account.biometric.delete')
  async remove(
    @Param('faceProfileId', biometricSubmissionIdPipe()) faceProfileId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const data = await this.service.deleteBiometricSubmission(
      faceProfileId,
      request.user.userId,
    );
    return { success: true, message: 'Ảnh sinh trắc học đã được xóa', data };
  }
}
