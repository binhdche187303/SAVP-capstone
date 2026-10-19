import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { MeetingPrepService } from '../services/meeting-prep.service.js';
import { MeetingSeriesService } from '../services/meeting-series.service.js';
import { MeetingsService } from '../services/meetings.service.js';
import type { UploadedAgendaAttachmentFile } from '../services/meetings.service.js';

class SubmitSignoffDto {
  @IsUUID()
  @IsOptional()
  minutesId?: string;
}

class ReviewSignoffDto {
  @IsIn(['approve', 'return'])
  decision: 'approve' | 'return';

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  note?: string;
}

class SeriesCancelDto {
  @IsIn(['this', 'following'])
  scope: 'this' | 'following';

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}

class SeriesTimeDto {
  @IsIn(['this', 'following'])
  scope: 'this' | 'following';

  @IsISO8601()
  startTime: string;

  @IsISO8601()
  endTime: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  changeReason?: string;
}

type Actor = { userId: string };

/** Kho biên bản › "Cần xử lý" (việc trình ký của chủ trì / thư ký / người ký). */
@ApiTags('Meetings - Report / Signoff / Series')
@ApiBearerAuth()
@Controller('minutes-inbox')
@UseGuards(JwtAuthGuard)
export class MinutesInboxController {
  constructor(private readonly prep: MeetingPrepService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách biên bản cần xử lý của tôi' })
  async inbox(@CurrentUser() actor: Actor) {
    return { success: true, message: 'OK', data: await this.prep.minutesInbox(actor.userId) };
  }
}
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

/** Nộp báo cáo trước họp, trình ký biên bản, thao tác theo chuỗi lịch lặp. */
@ApiTags('Meetings - Report / Signoff / Series')
@ApiBearerAuth()
@Controller('meetings/:meetingId')
@UseGuards(JwtAuthGuard)
export class MeetingPrepController {
  constructor(
    private readonly prep: MeetingPrepService,
    private readonly series: MeetingSeriesService,
    private readonly meetings: MeetingsService,
  ) {}

  @Get('prep')
  @ApiOperation({ summary: 'Báo cáo cần nộp + trạng thái trình ký + chuỗi lặp' })
  async getPrep(@Param('meetingId', ParseUUIDPipe) meetingId: string, @CurrentUser() actor: Actor) {
    const isAdmin = await this.meetings.checkUserPermission(actor.userId, 'admin.all');
    const data = await this.prep.getPrep(meetingId, actor.userId, isAdmin);
    const series = await this.series.getSeries(meetingId);
    return { success: true, message: 'OK', data: { ...data, series } };
  }

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Nộp / nộp lại file báo cáo trước họp' })
  async submitReport(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() actor: Actor,
    @UploadedFile() file: UploadedAgendaAttachmentFile | undefined,
  ) {
    const data = await this.prep.submitReport(meetingId, actor.userId, file);
    return { success: true, message: 'Đã nộp báo cáo', data };
  }

  @Post('signoff/submit')
  @UsePipes(pipe)
  @ApiOperation({ summary: 'Trình ký biên bản nháp' })
  async submitSignoff(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() actor: Actor,
    @Body() dto: SubmitSignoffDto,
  ) {
    const isAdmin = await this.meetings.checkUserPermission(actor.userId, 'admin.all');
    const data = await this.prep.submitSignoff(meetingId, actor.userId, isAdmin, dto.minutesId);
    return { success: true, message: 'Đã trình ký biên bản', data };
  }

  @Post('signoff/review')
  @UsePipes(pipe)
  @ApiOperation({ summary: 'Người ký duyệt hoặc trả lại biên bản' })
  async reviewSignoff(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() actor: Actor,
    @Body() dto: ReviewSignoffDto,
  ) {
    const data = await this.prep.reviewSignoff(meetingId, actor.userId, dto.decision, dto.note);
    return { success: true, message: dto.decision === 'approve' ? 'Đã ký duyệt' : 'Đã trả lại biên bản', data };
  }

  @Post('series/cancel')
  @UsePipes(pipe)
  @ApiOperation({ summary: 'Huỷ lần họp này hoặc lần này và các lần sau' })
  async cancelSeries(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() actor: Actor,
    @Body() dto: SeriesCancelDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const data = await this.series.cancelSeries(meetingId, dto.scope, actor, { ipAddress, userAgent }, dto.reason);
    return { success: true, message: `Đã huỷ ${data.updated.length} cuộc họp`, data };
  }

  @Patch('series/time')
  @UsePipes(pipe)
  @ApiOperation({ summary: 'Đổi giờ lần họp này hoặc lần này và các lần sau' })
  async updateSeriesTime(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() actor: Actor,
    @Body() dto: SeriesTimeDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const data = await this.series.updateSeriesTime(meetingId, dto.scope, dto, actor, { ipAddress, userAgent });
    return { success: true, message: `Đã đổi giờ ${data.updated.length} cuộc họp`, data };
  }
}
