import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { MinutesService } from '../services/minutes.service.js';
import { CreateDraftMinutesDto } from '../dto/create-draft-minutes.dto.js';
import { DraftMinutesResponseDto } from '../dto/draft-minutes-response.dto.js';

@Controller()
export class MinutesController {
  constructor(private readonly minutesService: MinutesService) {}

  @Post('meetings/:meetingId/minutes')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tao bien ban hop nhap (UC-MKM-01)',
    description:
      'Cho phep Host cua cuoc hop tao ban ghi bien ban hop o trang thai DRAFT ngay khi cuoc hop dang dien ra hoac da ket thuc. Ke thua thong tin meeting va danh sach diem danh tai thoi diem tao.',
  })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiBody({ type: CreateDraftMinutesDto, required: false })
  @ApiResponse({ status: 201, description: 'Tao bien ban hop nhap thanh cong' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / NOT_MEETING_HOST' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'MEETING_HOST_NOT_ASSIGNED / MEETING_NOT_STARTED / MEETING_CANCELLED / MINUTES_ALREADY_EXISTS',
  })
  async createDraftMinutes(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: CreateDraftMinutesDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: DraftMinutesResponseDto;
  }> {
    const result = await this.minutesService.createDraft(meetingId, dto, {
      userId: user.userId,
    });

    return {
      success: true,
      message: 'Biên bản họp nháp đã được tạo thành công',
      data: result,
    };
  }
}
