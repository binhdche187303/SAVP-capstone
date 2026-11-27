import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import {
  AvatarPhotoService,
  UploadedAvatarPhotoFile,
} from '../services/avatar-photo.service.js';
import { AvatarPhotoResponseDto } from '../dto/avatar-photo-response.dto.js';
import { UPLOAD_CEILING } from '../../../common/utils/upload-limits.js';

/**
 * AvatarPhotoController — ACCT-AVATAR-PHOTO-001 (avatar hiển thị, tự do, không duyệt).
 *
 * Tách biệt hoàn toàn khỏi BiometricSubmissionController (sinh trắc học, bắt buộc,
 * phải duyệt). Xem spec/features/account/feat-update-avatar-photo/spec.md.
 */
@ApiTags('Accounts - Avatar Photo (self-service, no review)')
@Controller('me')
export class AvatarPhotoController {
  constructor(private readonly avatarPhotoService: AvatarPhotoService) {}

  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('profile.avatar.update')
  // Trần cứng = 2× giới hạn nghiệp vụ: file vượt nhẹ vẫn tới service (AVATAR_PHOTO_FILE_TOO_LARGE),
  // file khổng lồ bị Multer cắt ngay (không nạp hết vào RAM).
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING.avatar } }))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tự cập nhật ảnh đại diện (không cần duyệt)',
    description:
      'User tự upload ảnh; lưu Cloudinary + media_files, cập nhật users.avatar_url ngay lập tức, không qua bước duyệt.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cập nhật ảnh đại diện thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập / token không hợp lệ.',
  })
  @ApiForbiddenResponse({
    description:
      'Thiếu permission profile.avatar.update hoặc account không active.',
  })
  async updateAvatar(
    @CurrentUser() currentUser: { userId: string } | undefined,
    @UploadedFile() file: UploadedAvatarPhotoFile | undefined,
  ): Promise<{
    success: boolean;
    message: string;
    data: AvatarPhotoResponseDto;
  }> {
    const data = await this.avatarPhotoService.updateAvatarPhoto(
      currentUser!.userId,
      file,
    );
    return {
      success: true,
      message: 'Cập nhật ảnh đại diện thành công',
      data,
    };
  }
}
