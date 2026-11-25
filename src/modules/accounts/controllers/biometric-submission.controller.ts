import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { BiometricStatusService } from '../services/biometric-status.service.js';
import {
  BiometricSubmissionService,
  UploadedBiometricFile,
} from '../services/biometric-submission.service.js';
import { BiometricStatusResponseDto } from '../dto/biometric-status-response.dto.js';
import { BiometricSubmissionResponseDto } from '../dto/biometric-submission-response.dto.js';
import { SubmitBiometricDto } from '../dto/submit-biometric.dto.js';
import { BiometricHttpExceptionFilter } from '../filters/biometric-http-exception.filter.js';

/**
 * BiometricSubmissionController — ACCT-BIOMETRIC-SUBMIT-001 (self-service sinh trắc học).
 *
 * [SỬA 2026-07-29] Đổi tên từ AvatarController — luồng này bắt buộc + phải duyệt cho
 * FaceGate, KHÔNG phải avatar hiển thị (avatar hiển thị tự do, không duyệt, ở
 * AvatarPhotoController). Xem spec/features/account/feat-split-avatar-and-biometric/plan.md.
 *
 * Mọi thao tác chỉ áp dụng cho chính user đã xác thực (userId lấy từ JWT, BR-001/FR-003).
 * Dùng guard THẬT (JwtAuthGuard + PermissionsGuard) — KHÔNG dùng MockPermissionsGuard.
 */
@ApiTags('Accounts - Biometric (self-service)')
@Controller('me')
export class BiometricSubmissionController {
  constructor(
    private readonly biometricStatusService: BiometricStatusService,
    private readonly biometricSubmissionService: BiometricSubmissionService,
  ) {}

  // ACCT-BIOMETRIC-SUBMIT-001 (FR-005): xem trạng thái sinh trắc học của chính mình.
  @Get('biometric-status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('profile.biometric.read_status')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem trạng thái ảnh sinh trắc học của chính mình',
    description:
      'Trả về biometricReviewStatus/biometricRequired/shouldShowBiometricPopup tính theo BR-004 từ face_profiles của user.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Trạng thái sinh trắc học.',
  })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập / token không hợp lệ.',
  })
  @ApiForbiddenResponse({
    description: 'Thiếu permission profile.biometric.read_status.',
  })
  async getBiometricStatus(
    @CurrentUser() currentUser: { userId: string } | undefined,
  ): Promise<{ success: boolean; data: BiometricStatusResponseDto }> {
    const data = await this.biometricStatusService.getStatus(
      currentUser!.userId,
    );
    return { success: true, data };
  }

  // ACCT-BIOMETRIC-SUBMIT-001 (FR-006): tự nộp/nộp lại ảnh sinh trắc học của chính mình.
  @Post('biometric-submission')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('profile.biometric.submit')
  @UseFilters(BiometricHttpExceptionFilter)
  // KHÔNG set limits.fileSize ở Multer: để service trả đúng BIOMETRIC_FILE_TOO_LARGE
  // theo precedence §11.2 (Multer limit sẽ ném lỗi sai code trước khi tới service).
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tự nộp/nộp lại ảnh sinh trắc học',
    description:
      'User tự upload ảnh; lưu Cloudinary + media_files, tạo face_profiles status=pending_review.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        consentAccepted: { type: 'boolean' },
      },
      required: ['file', 'consentAccepted'],
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Nộp ảnh thành công, đang chờ duyệt.',
  })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập / token không hợp lệ.',
  })
  @ApiForbiddenResponse({
    description:
      'Thiếu permission profile.biometric.submit hoặc account không active.',
  })
  async submitBiometric(
    @CurrentUser() currentUser: { userId: string } | undefined,
    @UploadedFile() file: UploadedBiometricFile | undefined,
    @Body() body: SubmitBiometricDto,
  ): Promise<{ success: boolean; data: BiometricSubmissionResponseDto }> {
    const data = await this.biometricSubmissionService.submit(
      currentUser!.userId,
      file,
      body?.consentAccepted,
    );
    return { success: true, data };
  }

  // [2026-11-23] Quét FaceID qua webcam 5 góc — TỰ DUYỆT (không chờ duyệt tay).
  // Ảnh qua 3 lớp kiểm tra (client chất lượng → server 1 mặt/ảnh → trùng định danh).
  @Post('biometric-scan')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('profile.biometric.submit')
  @UseFilters(BiometricHttpExceptionFilter)
  @UseInterceptors(FilesInterceptor('files', 5))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Đăng ký FaceID bằng quét webcam 5 góc (tự duyệt)',
    description:
      'files[] theo thứ tự poses (front,left,right,up,down). Qua kiểm tra → active + đẩy HGVision; trùng định danh người khác → pending_review ("Cần kiểm tra").',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        poses: { type: 'string', example: 'front,left,right,up,down' },
        consentAccepted: { type: 'boolean' },
        clientMeta: {
          type: 'string',
          description: 'JSON số đo chất lượng phía client',
        },
      },
      required: ['files', 'poses', 'consentAccepted'],
    },
  })
  async submitBiometricScan(
    @CurrentUser() currentUser: { userId: string } | undefined,
    @UploadedFiles() files: UploadedBiometricFile[] | undefined,
    @Body()
    body: { poses?: string; consentAccepted?: unknown; clientMeta?: string },
  ): Promise<{ success: boolean; data: BiometricSubmissionResponseDto }> {
    let clientMeta: unknown;
    try {
      clientMeta = body?.clientMeta ? JSON.parse(body.clientMeta) : undefined;
    } catch {
      clientMeta = undefined;
    }
    const poses = String(body?.poses ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const data = await this.biometricSubmissionService.submitScan(
      currentUser!.userId,
      files ?? [],
      poses,
      body?.consentAccepted,
      { clientMeta },
    );
    return { success: true, data };
  }
}
