import {
  Body,
  Controller,
  Get,
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

import { MinutesAiDraftService } from '../services/minutes-ai-draft.service.js';
import { CreateAiDraftJobDto } from '../dto/create-ai-draft-job.dto.js';
import { AiDraftJobResponseDto } from '../dto/ai-draft-job-response.dto.js';
import { AiDraftJobSummaryDto } from '../dto/ai-draft-job-summary.dto.js';
import { AiDraftConfigDto } from '../dto/ai-draft-config.dto.js';
import { AI_MINUTES_PERMISSION_CREATE } from '../constants/ai-minutes-draft.constants.js';

@Controller()
export class MinutesAiDraftController {
  constructor(private readonly minutesAiDraftService: MinutesAiDraftService) {}

  @Post('meetings/:meetingId/minutes/ai-draft-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(AI_MINUTES_PERMISSION_CREATE)
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
    summary: 'Tao AI draft minutes job (MKM-AI-01)',
    description:
      'Host cua cuoc hop (hoac System Admin) tao background job sinh ban nhap bien ban hop bang LLM self-hosted tu transcript da hoan tat. ' +
      'Xu ly bat dong bo — theo doi tien do qua GET /api/v1/background-jobs/:jobId; khi completed, result.minutesId tro toi ban nhap. ' +
      'AI chi tao draft, khong tu publish (FR-001).',
  })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiBody({ type: CreateAiDraftJobDto })
  @ApiResponse({
    status: 202,
    description: 'AI draft job da vao hang doi',
    type: AiDraftJobResponseDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description:
      'PERMISSION_DENIED / AI_SUMMARY_DISABLED / TRANSCRIPT_RESTRICTED',
  })
  @ApiResponse({
    status: 404,
    description: 'MEETING_NOT_FOUND / TRANSCRIPT_NOT_FOUND',
  })
  @ApiResponse({
    status: 409,
    description:
      'MINUTES_ALREADY_EXISTS / MINUTES_NOT_AI_DRAFT / AI_JOB_ALREADY_RUNNING',
  })
  @ApiResponse({ status: 422, description: 'TRANSCRIPT_NOT_READY' })
  async createAiDraftJob(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: CreateAiDraftJobDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: AiDraftJobResponseDto;
  }> {
    const result = await this.minutesAiDraftService.createAiDraftJob(
      meetingId,
      dto,
      { userId: user.userId },
    );

    return {
      success: true,
      message: 'AI draft job queued',
      data: result,
    };
  }

  @Get('meetings/:meetingId/minutes/ai-draft-jobs')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Liet ke AI draft job cua mot cuoc hop (MKM-AI-02)',
    description:
      'Tra ve danh sach background job sinh ban nhap bien ban bang AI cua meeting, sap xep moi -> cu. ' +
      'FE dung de resume theo doi tien do sau khi reload (lay job dang chay / job moi nhat, va minutesId khi completed). ' +
      'Auth: Host cua cuoc hop hoac Admin (SYSTEM_ADMIN/BUSINESS_ADMIN).',
  })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách tác vụ tạo biên bản nháp bằng AI',
    type: AiDraftJobSummaryDto,
    isArray: true,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  async listAiDraftJobs(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: AiDraftJobSummaryDto[];
  }> {
    const data = await this.minutesAiDraftService.listAiDraftJobs(meetingId, {
      userId: user.userId,
    });

    return {
      success: true,
      message: 'Danh sách tác vụ tạo biên bản nháp bằng AI',
      data,
    };
  }

  @Get('meetings/:meetingId/minutes/ai-draft-config')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Trang thai kha dung cua tinh nang AI draft (MKM-AI-03)',
    description:
      'Tra ve tap con AN TOAN cua system_configs[ai.minutes_summary] (enabled, requireHumanReview) ' +
      'de FE quyet dinh hien/an nut "Tao bang AI" va banner "can review". Luon 200 (enabled=false la trang thai hop le). ' +
      'Auth: Host cua cuoc hop hoac Admin (SYSTEM_ADMIN/BUSINESS_ADMIN).',
  })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Trang thai feature flag AI draft',
    type: AiDraftConfigDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  async getAiDraftConfig(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: AiDraftConfigDto;
  }> {
    const data = await this.minutesAiDraftService.getAiDraftAvailability(
      meetingId,
      { userId: user.userId },
    );

    return {
      success: true,
      message: 'Trạng thái tính năng tạo biên bản nháp bằng AI',
      data,
    };
  }
}
