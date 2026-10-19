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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AttendanceExcuseService } from '../services/attendance-excuse.service.js';
import {
  ReviewAttendanceExcuseDto,
  SubmitAttendanceExcuseDto,
} from '../dto/attendance-excuse.dto.js';

/**
 * Lý do vắng / trễ / về sớm. Quyền kiểm tra trong service:
 * gửi = thành viên cuộc họp; duyệt = chủ trì / thư ký / admin.
 */
@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('meetings/:meetingId/attendance/excuse')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
export class AttendanceExcuseController {
  constructor(private readonly service: AttendanceExcuseService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thành viên gửi lý do vắng mặt / đi trễ / về sớm (1 lần)' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  async submit(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: SubmitAttendanceExcuseDto,
    @CurrentUser() actor: { userId: string },
  ) {
    const data = await this.service.submit(meetingId, actor.userId, dto.reason);
    return { success: true, message: 'Đã gửi lý do, chờ chủ trì / thư ký duyệt', data };
  }

  @Post(':userId/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chủ trì / thư ký duyệt hoặc từ chối lý do' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  async review(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReviewAttendanceExcuseDto,
    @CurrentUser() actor: { userId: string },
  ) {
    const data = await this.service.review(meetingId, userId, dto.approve, dto.note, actor.userId);
    return {
      success: true,
      message: dto.approve ? 'Đã duyệt lý do' : 'Đã từ chối lý do',
      data,
    };
  }
}
