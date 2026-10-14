import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Body,
  Ip,
  Headers,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { AllowPartnerAccount } from '../../../common/decorators/allow-partner-account.decorator.js';

import { LiveMeetingService } from '../services/live-meeting.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { StartMeetingResponseDto } from '../dto/start-meeting-response.dto.js';
import { MeetingAttendanceResponseDto } from '../dto/attendance-response.dto.js';
import { AttendanceQueryDto } from '../dto/attendance-query.dto.js';
import {
  CreateNoteDto,
  ListNotesQueryDto,
  NoteResponseDto,
  ViewNotesQueryDto,
  ViewNoteResponseDto,
} from '../dto/index.js';
import { TimelineQueryDto } from '../dto/timeline-query.dto.js';
import { TimelineItemDto } from '../dto/timeline-item.dto.js';

import { EndMeetingResponseDto } from '../dto/end-meeting-response.dto.js';
import { PresentAttendeesResponseDto } from '../dto/present-attendees-response.dto.js';
import {
  ExtensionRequestDto,
  ExtensionRequestResponseDto,
  DecideExtensionDto,
  DecideExtensionResponseDto,
} from '../dto/index.js';

@ApiTags('live-meeting')
@Controller()
export class LiveMeetingController {
  constructor(
    private readonly liveMeetingService: LiveMeetingService,
    private readonly authzRepo: AuthzReadRepository,
  ) {}

  @Post('live-meetings/:meetingId/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.session.start')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bắt đầu phiên họp',
    description: 'Host/Organizer bắt đầu cuộc họp đã scheduled',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuộc họp',
  })
  @ApiResponse({ status: 200, description: 'Phiên họp đã bắt đầu thành công' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  @ApiResponse({ status: 403, description: 'Không có quyền' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy cuộc họp' })
  @ApiResponse({
    status: 409,
    description: 'Xung đột nghiệp vụ (trạng thái, time window, v.v.)',
  })
  async startMeeting(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: StartMeetingResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.liveMeetingService.startMeeting(
      meetingId,
      { userId: user!.userId },
      { ipAddress, userAgent },
    );

    const message = result.alreadyStarted
      ? 'Phiên họp đã được bắt đầu trước đó'
      : 'Phiên họp đã bắt đầu thành công';

    return {
      success: true,
      message,
      data: result,
    };
  }

  // ───────────────────────────────────────────────────────────
  //  UC-IMM-02: Request Meeting Extension
  // ───────────────────────────────────────────────────────────

  @Post('meetings/:meetingId/extension-requests')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.extension.request.own')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Yêu cầu gia hạn phiên họp',
    description: 'Host yêu cầu gia hạn phiên họp đang diễn ra',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuộc họp',
  })
  @ApiResponse({
    status: 200,
    description: 'Gia hạn thành công hoặc đã gửi yêu cầu đến Manager',
  })
  @ApiResponse({ status: 400, description: 'Thời lượng gia hạn không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  @ApiResponse({
    status: 403,
    description: 'Không có quyền hoặc không phải Host',
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy cuộc họp' })
  @ApiResponse({ status: 409, description: 'Xung đột nghiệp vụ' })
  async requestExtension(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() extensionRequestDto: ExtensionRequestDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: ExtensionRequestResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.liveMeetingService.requestExtension(
      meetingId,
      extensionRequestDto,
      { userId: user!.userId },
    );

    const message =
      result.status === 'applied'
        ? 'Gia hạn phiên họp thành công'
        : 'Phòng đã có lịch sau thời gian hiện tại. Yêu cầu gia hạn đã được gửi đến Manager để xử lý.';

    return {
      success: true,
      message,
      data: result,
    };
  }

  // ───────────────────────────────────────────────────────────
  //  UC-IMM-03: Decide Extension Request (Approve/Reject)
  // ───────────────────────────────────────────────────────────

  // @RequirePermissions() cố ý để trống — KHÔNG phải bug/thiếu tham số. PermissionsGuard
  // chỉ kiểm tra permission tĩnh theo role; quyền quyết định request này còn phụ thuộc
  // ruleSnapshotJson.approverIds theo TỪNG request cụ thể, guard route-level không biểu
  // đạt được. Uỷ quyền thật nằm ở LiveMeetingService.decideExtension →
  // checkDecidePermission() (gọi ngay dòng đầu, trước mọi mutation): ném ForbiddenException
  // nếu user không có 'meeting.session.extension.override' VÀ không (có
  // 'meeting.session.extension.decide' + có mặt trong approverIds của request). Xác nhận lại
  // qua đọc trực tiếp service trước khi đổi decorator này — KHÔNG thêm permission code vào
  // đây, sẽ chặn nhầm nhánh override hợp lệ.
  @Post('live-meetings/:meetingId/extension-requests/:requestId/decide')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Phê duyệt/từ chối yêu cầu gia hạn phiên họp',
    description:
      'Manager/Admin phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp đang pending',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuộc họp',
  })
  @ApiParam({
    name: 'requestId',
    type: String,
    format: 'uuid',
    description: 'ID yêu cầu gia hạn',
  })
  @ApiResponse({ status: 200, description: 'Xử lý yêu cầu gia hạn thành công' })
  @ApiResponse({ status: 400, description: 'UUID không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  @ApiResponse({ status: 403, description: 'Không có quyền' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy request/cuộc họp' })
  @ApiResponse({
    status: 409,
    description:
      'Xung đột nghiệp vụ (request đã xử lý, conflict re-validation, ...)',
  })
  @ApiResponse({ status: 422, description: 'Decision value không hợp lệ' })
  async decideExtension(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() decideDto: DecideExtensionDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: DecideExtensionResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    // Load user permissions to check decide/override
    const { permissions } =
      await this.authzRepo.getEffectiveRolesAndPermissions(user!.userId);
    const hasDecide = permissions.includes('meeting.session.extension.decide');
    const hasOverride = permissions.includes(
      'meeting.session.extension.override',
    );

    const result = await this.liveMeetingService.decideExtension(
      meetingId,
      requestId,
      decideDto,
      { userId: user!.userId },
      { hasDecide, hasOverride },
    );

    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  // ───────────────────────────────────────────────────────────
  //  UC-IMM-05: End Meeting Session
  // ───────────────────────────────────────────────────────────

  @Post('live-meetings/:meetingId/end')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.session.end')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ket thuc phien hop',
    description: 'Host/Business Admin ket thuc cuoc hop dang dien ra',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuoc hop',
  })
  @ApiResponse({ status: 200, description: 'Phien hop da ket thuc thanh cong' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen' })
  @ApiResponse({ status: 404, description: 'Khong tim thay cuoc hop' })
  @ApiResponse({
    status: 409,
    description: 'Xung dot nghiep vu (trang thai, da ket thuc, ...)',
  })
  @ApiResponse({ status: 422, description: 'UUID khong hop le' })
  async endMeeting(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EndMeetingResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.liveMeetingService.endMeeting(
      meetingId,
      { userId: user!.userId },
      { ipAddress, userAgent },
    );

    return {
      success: true,
      message: 'Phien hop da ket thuc thanh cong',
      data: result,
    };
  }

  // ------------------------------------------------------------------
  //  UC-IMM-07: View Live Meeting Participants
  // ------------------------------------------------------------------

  @Get('live-meetings/:meetingId/present-attendees')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.presence.read')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem danh sach nguoi tham du dang co mat',
    description:
      'Host/Business Admin xem danh sach nguoi dang co mat trong phien hop',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuoc hop',
  })
  @ApiQuery({
    name: 'search',
    type: String,
    required: false,
    description: 'Tim kiem theo ten/email',
  })
  @ApiQuery({
    name: 'departmentId',
    type: String,
    required: false,
    description: 'Loc theo phong ban',
  })
  @ApiQuery({
    name: 'page',
    type: Number,
    required: false,
    description: 'So trang',
  })
  @ApiQuery({
    name: 'limit',
    type: Number,
    required: false,
    description: 'So ban ghi moi trang',
  })
  @ApiQuery({
    name: 'sortBy',
    type: String,
    required: false,
    description:
      'Truong sap xep (full_name, department_name, presence_status, joined_at)',
  })
  @ApiQuery({
    name: 'sortOrder',
    type: String,
    required: false,
    description: 'asc/desc',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sach nguoi tham du dang co mat',
  })
  @ApiResponse({ status: 400, description: 'Tham so truy van khong hop le' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen' })
  @ApiResponse({ status: 404, description: 'Khong tim thay cuoc hop' })
  @ApiResponse({
    status: 409,
    description: 'Cuoc hop chua dien ra hoac da ket thuc',
  })
  async getPresentAttendees(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: PresentAttendeesResponseDto;
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const user = request['user'] as { userId: string } | undefined;

    // Validate and parse pagination params
    const parsedPage = Math.max(1, parseInt(page || '1', 10) || 1);
    const parsedLimit = Math.min(
      100,
      Math.max(1, parseInt(limit || '20', 10) || 20),
    );
    const allowedSortByFields = [
      'full_name',
      'department_name',
      'presence_status',
      'joined_at',
      'u.fullName',
    ];
    const safeSortBy =
      sortBy && allowedSortByFields.includes(sortBy) ? sortBy : 'u.fullName';
    const safeSortOrder = sortOrder === 'desc' ? 'desc' : 'asc';

    // Validate search length
    if (search && search.length > 100) {
      throw new BadRequestException({
        success: false,
        message: 'Search query vuot qua 100 ky tu',
        error: {
          code: 'INVALID_QUERY',
          details: { field: 'search', reason: 'max_length_100' },
        },
      });
    }

    // Validate departmentId UUID format (optional)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (departmentId && !uuidRegex.test(departmentId)) {
      throw new BadRequestException({
        success: false,
        message: 'departmentId khong dung dinh dang UUID',
        error: {
          code: 'INVALID_QUERY',
          details: { field: 'departmentId', reason: 'invalid_uuid' },
        },
      });
    }

    const result = await this.liveMeetingService.getPresentAttendees(
      meetingId,
      { userId: user!.userId },
      { ipAddress, userAgent },
      {
        search: search?.trim(),
        departmentId,
        page: parsedPage,
        limit: parsedLimit,
        sortBy: safeSortBy,
        sortOrder: safeSortOrder,
      },
    );

    return {
      success: true,
      message: 'Danh sach nguoi tham du dang co mat',
      data: result.data,
      meta: result.meta,
    };
  }

  // ------------------------------------------------------------------
  //  UC-IMM-08: View Participant Attendance Status
  //
  //  [P1 BE-05, 2026-07-27] Path đổi từ `meetings/:meetingId/attendance` sang
  //  `live-meetings/:meetingId/attendance` để hết trùng với
  //  `AttendanceController.getMeetingAttendance` (`attendance.controller.ts`).
  //  Hai route KHÔNG phải bản sao — UC-IMM-08 (ở đây) là điểm danh TRONG một
  //  live-meeting session đang chạy (dùng `LiveMeetingService`, có ghi audit
  //  qua ipAddress/userAgent, trả 409 nếu meeting chưa `in_progress`/đã kết
  //  thúc); UC-APM-02 (`attendance.controller.ts`) là danh sách điểm danh
  //  chung có phân trang, không gắn ràng buộc trạng thái phiên đang chạy.
  //  Trước đợt này, NestJS chỉ đăng ký được handler nào import module SAU
  //  cùng trong `app.module.ts` — thay đổi thứ tự import từng làm gãy route
  //  còn lại một cách âm thầm. Từ nay 2 path tách biệt, thứ tự import module
  //  không còn ảnh hưởng tới hành vi route.
  // ------------------------------------------------------------------

  @Get('live-meetings/:meetingId/attendance')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('attendance.read')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem trang thai diem danh nguoi tham du',
    description:
      'Host/Business Admin xem trang thai diem danh cua nguoi tham du trong cuoc hop',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuoc hop',
  })
  @ApiQuery({
    name: 'q',
    type: String,
    required: false,
    description: 'Tim kiem theo ten/email',
  })
  @ApiQuery({
    name: 'status',
    type: String,
    required: false,
    description: 'Loc theo trang thai (checked_in, late, absent)',
  })
  @ApiQuery({
    name: 'page',
    type: Number,
    required: false,
    description: 'So trang (default 1)',
  })
  @ApiQuery({
    name: 'pageSize',
    type: Number,
    required: false,
    description: 'So ban ghi moi trang (default 20, max 100)',
  })
  @ApiQuery({
    name: 'sortBy',
    type: String,
    required: false,
    description: 'Truong sap xep (full_name, attendance_status, check_in_time)',
  })
  @ApiQuery({
    name: 'sortOrder',
    type: String,
    required: false,
    description: 'asc/desc',
  })
  @ApiResponse({ status: 200, description: 'Danh sach diem danh cuoc hop' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen' })
  @ApiResponse({ status: 404, description: 'Khong tim thay cuoc hop' })
  @ApiResponse({
    status: 409,
    description: 'Cuoc hop khong o trang thai hoat dong hoac da ket thuc',
  })
  @ApiResponse({ status: 422, description: 'Tham so truy van khong hop le' })
  async getAttendance(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query?: AttendanceQueryDto,
  ): Promise<{
    success: boolean;
    message: string;
    data: MeetingAttendanceResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.liveMeetingService.getMeetingAttendance(
      meetingId,
      { userId: user!.userId },
      { ipAddress, userAgent },
      query || new AttendanceQueryDto(),
    );

    return {
      success: true,
      message: 'Danh sach diem danh cuoc hop',
      data: result,
    };
  }

  @Post('live-meetings/:meetingId/attendance/scan')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('attendance.manual.create')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Quet diem danh phong hop bang HGVision',
    description:
      'Host/nguoi co quyen diem danh gui anh snapshot tu camera phong hop; backend goi HGVision face search va ghi attendance_records/attendance_events.',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuoc hop',
  })
  async scanAttendance(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Body()
    body: {
      direction?: 'in' | 'out' | 'enter' | 'leave';
      snapshotImageBase64?: string;
      cameraName?: string;
    },
  ): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const data = await this.liveMeetingService.scanMeetingAttendanceWithHgVision(
      meetingId,
      { userId: user!.userId },
      { ipAddress, userAgent },
      body,
    );

    return {
      success: true,
      message: data.message ?? 'Meeting attendance scan processed',
      data,
    };
  }

  // ------------------------------------------------------------------
  //  UC-IMM-09: Create Meeting Note (UC-102)
  // ------------------------------------------------------------------

  @Post('meetings/:meetingId/notes')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.note.create')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tao ghi chu trong cuoc hop',
    description:
      'Host/Internal Participant tao ghi chu khi meeting in_progress',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuoc hop',
  })
  @ApiResponse({ status: 201, description: 'Tao ghi chu thanh cong' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({
    status: 403,
    description: 'Khong co quyen hoac NOTE_HOST_ONLY',
  })
  @ApiResponse({ status: 404, description: 'Khong tim thay cuoc hop' })
  @ApiResponse({
    status: 409,
    description: 'Cuoc hop khong o trang thai in_progress',
  })
  @ApiResponse({
    status: 422,
    description: 'Loai ghi chu system_note khong duoc phep',
  })
  async createNote(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() createNoteDto: CreateNoteDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: NoteResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.liveMeetingService.createMeetingNote(
      meetingId,
      createNoteDto,
      { userId: user!.userId },
    );

    return {
      success: true,
      message: 'Tao ghi chu thanh cong',
      data: result,
    };
  }

  // ------------------------------------------------------------------
  //  UC-IMM-09: List Meeting Notes (UC-103/104)
  // ------------------------------------------------------------------

  @Get('meetings/:meetingId/notes')
  @HttpCode(HttpStatus.OK)
  @AllowPartnerAccount()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.note.read')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem danh sach ghi chu cuoc hop (UC-IMM-10)',
    description:
      'Xem danh sach ghi chu cuoc hop voi filter, sort, pagination, va opt-in enrichment',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuoc hop',
  })
  @ApiQuery({
    name: 'noteType',
    type: String,
    required: false,
    description:
      'Loc theo loai ghi chu (in_meeting, private, host_note, system_note)',
  })
  @ApiQuery({
    name: 'visibility',
    type: String,
    required: false,
    description:
      'Loc theo muc do chia se (private, participants, public_internal, department)',
  })
  @ApiQuery({
    name: 'pinned',
    type: Boolean,
    required: false,
    description: 'Loc ghi chu da ghim',
  })
  @ApiQuery({
    name: 'from',
    type: String,
    required: false,
    description: 'Filter created_at >= from (ISO 8601)',
  })
  @ApiQuery({
    name: 'to',
    type: String,
    required: false,
    description: 'Filter created_at <= to (ISO 8601)',
  })
  @ApiQuery({
    name: 'includeSourceEvent',
    type: Boolean,
    required: false,
    description: 'Opt-in enrich voi sourceEventTime/sourceEventType',
  })
  @ApiQuery({
    name: 'page',
    type: Number,
    required: false,
    description: 'So trang (default 1)',
  })
  @ApiQuery({
    name: 'limit',
    type: Number,
    required: false,
    description: 'So ban ghi moi trang (default 20, max 100)',
  })
  @ApiQuery({
    name: 'sort',
    type: String,
    required: false,
    description: 'Sap xep (timeline_asc, timeline_desc)',
  })
  @ApiResponse({ status: 200, description: 'Danh sach ghi chu' })
  @ApiResponse({
    status: 400,
    description: 'Validation error hoac INVALID_DATE_RANGE',
  })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({
    status: 403,
    description: 'Khong co quyen hoac NOT_A_MEETING_PARTICIPANT',
  })
  @ApiResponse({ status: 404, description: 'Khong tim thay cuoc hop' })
  @ApiResponse({
    status: 422,
    description: 'Meeting status khong cho phep xem ghi chu',
  })
  async listNotes(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: ViewNotesQueryDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: ViewNoteResponseDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.liveMeetingService.viewMeetingNotes(
      meetingId,
      query,
      { userId: user!.userId },
    );

    return {
      success: true,
      message: result.message,
      data: result.data,
      meta: result.meta,
    };
  }

  // UC-99: Timeline cuộc họp (gộp meeting_events + attendance_events + meeting_notes).
  // Route leaf tĩnh 'timeline' — khác 'notes'/'attendance', không collision.
  @Get('meetings/:meetingId/timeline')
  @HttpCode(HttpStatus.OK)
  @AllowPartnerAccount()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.timeline.read')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem timeline cuoc hop (UC-99)',
    description:
      'Gop cac su kien start/end/warning/extension (meeting_events), check-in/out (attendance_events) va ghi chu (meeting_notes, ton trong visibility) thanh 1 timeline sap theo thoi gian, phan trang. Chi host/participant cua cuoc hop moi xem duoc.',
  })
  @ApiParam({
    name: 'meetingId',
    type: String,
    format: 'uuid',
    description: 'ID cuoc hop',
  })
  @ApiResponse({ status: 200, description: 'Timeline cuoc hop (phan trang)' })
  @ApiResponse({
    status: 400,
    description: 'Validation error / INVALID_DATE_RANGE',
  })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({
    status: 403,
    description: 'Khong co quyen hoac NOT_A_MEETING_PARTICIPANT',
  })
  @ApiResponse({ status: 404, description: 'Khong tim thay cuoc hop' })
  async getMeetingTimeline(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: TimelineQueryDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: TimelineItemDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const { data, total, page, limit } =
      await this.liveMeetingService.getMeetingTimeline(
        meetingId,
        query,
        user!.userId,
      );

    return {
      success: true,
      message: 'Lay timeline cuoc hop thanh cong',
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
