import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Headers,
  Patch,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Delete,
  Put,
  UploadedFile,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';

import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AllowPartnerAccount } from '../../../common/decorators/allow-partner-account.decorator.js';

import { MeetingsService } from '../services/meetings.service.js';

import type { UpdateMeetingTimeResponse } from '../services/meetings.service.js';

import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { MeetingPrepService } from '../services/meeting-prep.service.js';
import { MeetingSeriesService } from '../services/meeting-series.service.js';

import { CancelMeetingDto } from '../dto/cancel-meeting.dto.js';

import { CancelMeetingResponseDto } from '../dto/cancel-meeting-response.dto.js';

import { CreateMeetingDto } from '../dto/create-meeting.dto.js';

import { CreateMeetingResponseDto } from '../dto/create-meeting-response.dto.js';

import { UpdateMeetingTimeDto } from '../dto/update-meeting-time.dto.js';

import { UpdateMeetingRoomDto } from '../dto/update-meeting-room.dto.js';

import type { UpdateMeetingRoomResponseDto } from '../dto/update-meeting-room-response.dto.js';

import type { AvailableRoomDto } from '../dto/available-room.dto.js';

import { AddInternalParticipantDto } from '../dto/add-internal-participant.dto.js';

import type { IAddInternalParticipantResponse } from '../dto/add-internal-participant-response.dto.js';

import { ApproveMeetingRequestDto } from '../dto/approve-meeting-request.dto.js';

import { RejectMeetingRequestDto } from '../dto/reject-meeting-request.dto.js';

import { ApproveResponseDto } from '../dto/approve-response.dto.js';

import { RejectResponseDto } from '../dto/reject-response.dto.js';

import { MyScheduleQueryDto } from '../dto/my-schedule-query.dto.js';

import { ScheduleResponseDto } from '../dto/schedule-response.dto.js';

import { MyScheduleDetailDto } from '../dto/my-schedule-detail.dto.js';

import { MeetingHistoryQueryDto } from '../dto/meeting-history-query.dto.js';

import { MeetingHistoryResponseDto } from '../dto/meeting-history-response.dto.js';

import { RemoveParticipantParamsDto } from '../dto/remove-participant-params.dto.js';

import { RemoveParticipantBodyDto } from '../dto/remove-participant-body.dto.js';

import { RemoveParticipantResponseDto } from '../dto/remove-participant-response.dto.js';
import { AddExternalParticipantDto } from '../dto/add-external-participant.dto.js';
import type { IAddExternalParticipantResponse } from '../dto/add-external-participant-response.dto.js';
import { RemoveExternalParticipantParamsDto } from '../dto/remove-external-participant-params.dto.js';
import { RemoveExternalParticipantBodyDto } from '../dto/remove-external-participant-body.dto.js';
import { RemoveExternalParticipantResponseDto } from '../dto/remove-external-participant-response.dto.js';

import { ReplaceAgendaDto } from '../dto/replace-agenda.dto.js';
import { UpdateAgendaItemDto } from '../dto/update-agenda-item.dto.js';

import {
  AgendaListResponseDto,
  ReplaceAgendaResponseDto,
  AgendaItemUpdateResponseDto,
  DeleteAgendaItemResponseDto,
} from '../dto/agenda-response.dto.js';
import {
  AgendaAttachmentUploadResponseDto,
  DeleteAgendaAttachmentResponseDto,
} from '../dto/agenda-attachment.dto.js';
import type { UploadedAgendaAttachmentFile } from '../services/meetings.service.js';

import { ClientContext } from '../services/meetings.service.js';

import { ParticipantImportService } from '../services/participant-import.service.js';
import { ImportParticipantsDto } from '../dto/import-participants.dto.js';
import { ImportParticipantsReportDto } from '../dto/import-participants-response.dto.js';
import { XLSX_MIME } from '../constants/import-participants.constants.js';

import { MeetingListService } from '../services/meeting-list.service.js';
import { MeetingListQueryDto } from '../dto/meeting-list-query.dto.js';
import { MeetingListItemDto } from '../dto/meeting-list-item.dto.js';

import { MeetingUpdateService } from '../services/meeting-update.service.js';
import { UpdateMeetingDto } from '../dto/update-meeting.dto.js';
import { UpdateMeetingResponseDto } from '../dto/update-meeting-response.dto.js';

// @Controller() de rong co y: moi route trong class nay tu khai bao day du path
// (vd 'meetings/:meetingId/agendas'), khong dua vao prefix chung cua controller.
// Ly do: mot so route chi co 1 segment ('meetings') con nhung route con lai
// can nam duoi 'meetings/:meetingId/...'. Khai prefix chung se gay nham lan
// khi doc code va da tung dan den bug thieu prefix 'meetings/' o 5 route
// agenda/participant (BE-06, 2026-07-26). Khi them route moi, LUON viet day du
// path bat dau bang 'meetings' neu route thuoc ve resource meeting.
@Controller()
export class MeetingsController {
  constructor(
    private readonly meetingsService: MeetingsService,

    private readonly meetingRequestReviewService: MeetingRequestReviewService,

    private readonly participantImportService: ParticipantImportService,

    private readonly meetingListService: MeetingListService,

    private readonly meetingUpdateService: MeetingUpdateService,

    private readonly meetingPrepService: MeetingPrepService,

    private readonly meetingSeriesService: MeetingSeriesService,
  ) {}

  @Post('meetings')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async createMeeting(
    @Body() dto: CreateMeetingDto,

    @Req() request: Request,

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;

    message: string;

    data: CreateMeetingResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const authUserId = user?.userId;

    // Lịch UEL mục 16: có quy tắc lặp ⇒ tạo cả chuỗi (trả về lần đầu + danh sách).
    const result = dto.recurrence
      ? await this.meetingSeriesService.createSeries(dto, { userId: authUserId! }, { ipAddress, userAgent })
      : await this.meetingsService.create(
          dto,

          { userId: authUserId! },

          { ipAddress, userAgent },
        );
    if (!dto.recurrence) {
      await this.meetingPrepService.applyCreateOptions(result.id, {
        reportRequirement: dto.reportRequirement,
        signoff: dto.signoff,
      });
    }

    return {
      success: true,

      message: 'Yeu cau tao cuoc hop da duoc gui thanh cong',

      data: result,
    };
  }

  @Patch('meetings/:meetingId/time')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.time.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async updateMeetingTime(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,

    @Body() dto: UpdateMeetingTimeDto,

    @Req() request: Request,

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;

    message: string;

    data: UpdateMeetingTimeResponse;

    meta: { requestId: string };
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const requestId = `req-${Date.now()}`;

    const result = await this.meetingsService.updateMeetingTime(
      meetingId,

      dto,

      { userId: user!.userId },

      { ipAddress, userAgent },
    );

    return {
      success: true,

      message: 'Thoi gian cuoc hop da duoc cap nhat thanh cong',

      data: result,

      meta: { requestId },
    };
  }

  @Get('meetings')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  // Không gắn 'meeting.read.all' ở guard: MANAGER cũng dùng route này (màn Chuyên cần phòng ban)
  // nhưng chỉ thấy cuộc họp của phòng ban mình — service tự phân phạm vi (admin = toàn bộ).
  @RequirePermissions()
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary:
      'Danh sach cuoc hop (admin: toan bo; manager: phong ban minh quan ly)',
  })
  @ApiResponse({ status: 200, description: 'Danh sach cuoc hop' })
  @ApiResponse({ status: 403, description: 'Khong co quyen meeting.read.all' })
  async listMeetings(
    @Query() query: MeetingListQueryDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MeetingListItemDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const result = await this.meetingListService.list(
      query,
      currentUser.userId,
    );
    return {
      success: true,
      message: 'Lay danh sach cuoc hop thanh cong',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('meetings/:meetingId')
  @HttpCode(HttpStatus.OK)
  @AllowPartnerAccount()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Xem chi tiết cuộc họp' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Chi tiết cuộc họp' })
  @ApiResponse({ status: 403, description: 'Không có quyền xem cuộc họp này' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy cuộc họp' })
  async getMeetingById(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{ success: boolean; message: string; data: object }> {
    const result = await this.meetingsService.getMyScheduleDetail(
      currentUser.userId,
      meetingId,
    );
    return {
      success: true,
      message: 'Chi tiết cuộc họp',
      data: result,
    };
  }

  // BE-03 (2026-07-26): Pham vi CO Y HEP chi title/description. Time/room/
  // participants/agenda/recording da co endpoint chuyen trach rieng (xem
  // spec/features/meeting/feat-update-meeting-metadata/spec.md).
  @Patch('meetings/:meetingId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.update.own')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary: 'Cap nhat thong tin co ban cuoc hop (chi title/description)',
  })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateMeetingDto })
  @ApiResponse({ status: 200, description: 'Cap nhat thanh cong' })
  @ApiResponse({
    status: 400,
    description:
      'Body rong (EMPTY_UPDATE_PAYLOAD) hoac gui field ngoai title/description (forbidNonWhitelisted)',
  })
  @ApiResponse({
    status: 403,
    description: 'Khong phai organizer/host cua cuoc hop',
  })
  @ApiResponse({ status: 404, description: 'Khong tim thay cuoc hop' })
  @ApiResponse({
    status: 409,
    description: 'Cuoc hop da huy hoac da ket thuc, khong the sua',
  })
  async updateMeeting(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: UpdateMeetingDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: UpdateMeetingResponseDto;
  }> {
    const user = request['user'] as { userId: string };
    const result = await this.meetingUpdateService.update(meetingId, dto, {
      userId: user.userId,
    });
    return {
      success: true,
      message: 'Cap nhat cuoc hop thanh cong',
      data: result,
    };
  }

  @Get('meetings/:meetingId/available-rooms')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getAvailableRoomsForMeeting(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,

    @Query('capacityWarningMode') capacityWarningMode?: string,

    @Query('includeCurrentRoom') includeCurrentRoom?: string,

    // Override khung giờ để FE kiểm tra real-time theo giờ ĐANG GÕ THỬ khi
    // sửa cuộc họp (chưa lưu) — không truyền thì dùng giờ đã lưu của meeting.
    @Query('startTime') startTime?: string,

    @Query('endTime') endTime?: string,
  ): Promise<{
    success: boolean;

    message: string;

    data: AvailableRoomDto[];
  }> {
    const options = {
      capacityWarningMode: capacityWarningMode === 'true',

      includeCurrentRoom: includeCurrentRoom === 'true',

      startTime: startTime ? new Date(startTime) : undefined,

      endTime: endTime ? new Date(endTime) : undefined,
    };

    const rooms = await this.meetingsService.getAvailableRoomsForMeeting(
      meetingId,

      options,
    );

    return {
      success: true,

      message: 'Danh sach phong kha dung',

      data: rooms,
    };
  }

  @Post('meetings/:meetingId/participants/internal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.participant.add.internal')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async addInternalParticipant(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,

    @Body() dto: AddInternalParticipantDto,

    @Req() request: Request,

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;

    message: string;

    data: IAddInternalParticipantResponse;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingsService.addInternalParticipant(
      meetingId,

      dto,

      { userId: user!.userId },

      { ipAddress, userAgent },
    );

    return {
      success: true,

      message: 'Thanh vien noi bo da duoc them vao cuoc hop thanh cong',

      data: result,
    };
  }

  @Get('meetings/:meetingId/participants/import/template')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.participant.import')
  @ApiBearerAuth()
  @ApiTags('Meetings')
  @ApiOperation({
    summary: 'Tải tệp Excel mẫu để import thành viên',
    description:
      'Trả về file .xlsx chứa header chuẩn (Email, Mã nhân viên, Họ và tên, Tổ chức/Công ty, Số điện thoại), dòng ví dụ và sheet hướng dẫn. Định dạng TRÙNG KHÍT với file mẫu ở màn Đặt lịch họp — 1 template dùng chung cho cả 2 màn.',
  })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  async downloadImportTemplate(
    @Param('meetingId', ParseUUIDPipe) _meetingId: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.participantImportService.generateTemplate();
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="SmarTracking_Template_Them_Danh_Sach.xlsx"',
    );
    res.send(buffer);
  }

  @Post('meetings/:meetingId/participants/import')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.participant.import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth()
  @ApiTags('Meetings')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import thành viên cuộc họp bằng Excel',
    description:
      'Tải lên file .xlsx danh sách thành viên. Loại (nội bộ / khách ngoài) được tự nhận diện theo Email/Mã nhân viên. Lần đầu (forceAddWithWarnings=false) nếu có dòng cảnh báo HOẶC dòng lỗi sẽ trả 422 kèm preview từng dòng. Gửi lại với forceAddWithWarnings=true để thêm các dòng hợp lệ. Xử lý partial-success theo từng dòng.',
  })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        forceAddWithWarnings: { type: 'boolean' },
      },
      required: ['file'],
    },
  })
  async importParticipants(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @UploadedFile()
    file:
      | {
          buffer: Buffer;
          mimetype?: string;
          size?: number;
          originalname?: string;
        }
      | undefined,
    @Body() dto: ImportParticipantsDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: ImportParticipantsReportDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.participantImportService.importParticipants(
      meetingId,
      file,
      { forceAddWithWarnings: dto.forceAddWithWarnings },
      { userId: user!.userId },
      { ipAddress, userAgent },
    );

    return {
      success: true,
      message: 'Import thành viên hoàn tất',
      data: result,
    };
  }

  @Patch('meetings/:meetingId/room')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.room.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async updateMeetingRoom(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,

    @Body() dto: UpdateMeetingRoomDto,

    @Req() request: Request,

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;

    message: string;

    data: UpdateMeetingRoomResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingsService.updateMeetingRoom(
      meetingId,

      dto,

      { userId: user!.userId },

      { ipAddress, userAgent },
    );

    return {
      success: true,

      message: 'Phong hop da duoc cap nhat thanh cong',

      data: result,
    };
  }

  @Post('meetings/:meetingId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.cancel.own')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  @ApiTags('Meetings')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Huy cuoc hop da len lich',

    description:
      'Cho phep Meeting Organizer, Meeting Host hoac System Admin huy cuoc hop dang o trang thai scheduled va chua bat dau. Khi huy, phong hop duoc giai phong, events + audit logs duoc ghi, va notification duoc queue gui den participants.',
  })
  @ApiParam({
    name: 'meetingId',

    type: 'string',

    format: 'uuid',

    description: 'ID cua cuoc hop can huy',
  })
  @ApiBody({ type: CancelMeetingDto, required: false })
  @ApiResponse({
    status: 200,

    description: 'Cuoc hop da duoc huy thanh cong',

    type: CancelMeetingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Meeting not found' })
  @ApiResponse({ status: 409, description: 'Conflict' })
  async cancelMeeting(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,

    @Body() dto: CancelMeetingDto,

    @Req() request: Request,

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;

    message: string;

    data: CancelMeetingResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingsService.cancelMeeting(
      meetingId,

      { userId: user!.userId },

      { ipAddress, userAgent },

      dto.cancellationReason ?? dto.reason,
    );

    return {
      success: true,

      message: 'Cuoc hop da duoc huy thanh cong',

      data: result,
    };
  }

  @Get('rooms/available')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getAvailableRooms(
    @Query('startTime') startTime: string,

    @Query('endTime') endTime: string,

    @Query('minCapacity') minCapacity?: string,
  ): Promise<{ success: boolean; message: string; data: object[] }> {
    if (!startTime || !endTime) {
      return {
        success: false,

        message: 'startTime va endTime la bat buoc',

        data: [],
      };
    }

    const start = new Date(startTime);

    const end = new Date(endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return {
        success: false,

        message: 'startTime hoac endTime khong dung dinh dang',

        data: [],
      };
    }

    if (end <= start) {
      return {
        success: false,

        message: 'endTime phai sau startTime',

        data: [],
      };
    }

    const capacity = minCapacity ? Number(minCapacity) : undefined;

    const rooms = await this.meetingsService.getAvailableRooms(
      start,

      end,

      capacity,
    );

    // Nhóm D (2026-08-08) — cảnh báo mềm: request pending khác đang xin cùng
    // phòng/giờ, không loại phòng khỏi danh sách trả về.
    const pendingConflictsMap =
      await this.meetingsService.getPendingRoomConflictsMap(
        rooms.map((room) => room.id),
        start,
        end,
      );
    const faultyEquipmentsMap =
      await this.meetingsService.getFaultyEquipmentsMap(
        rooms.map((room) => room.id),
      );

    return {
      success: true,

      message: 'Danh sach phong kha dung',

      data: rooms.map((room) => ({
        id: room.id,

        roomCode: room.roomCode,

        roomName: room.roomName,

        capacity: room.capacity,

        roomType: room.roomType,

        siteName: room.siteName,

        areaName: room.areaName,

        locationDescription: room.locationDescription,

        hasCamera: room.hasCamera,

        hasMicrophone: room.hasMicrophone,

        hasDisplay: room.hasDisplay,

        allowRecording: room.allowRecording,

        pendingConflicts: pendingConflictsMap.get(room.id) ?? [],

        faultyEquipments: faultyEquipmentsMap.get(room.id) ?? [],
      })),
    };
  }

  @Post('meeting-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting_request.approve')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async approveMeetingRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,

    @Body() dto: ApproveMeetingRequestDto,

    @Req() request: Request,

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent?: string,
  ): Promise<{ success: boolean; message: string; data: ApproveResponseDto }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingRequestReviewService.approve(
      requestId,

      dto,

      { userId: user!.userId },

      { ipAddress, userAgent },
    );

    return {
      success: true,

      message: 'Yeu cau cuoc hop da duoc phe duyet thanh cong',

      data: result,
    };
  }

  @Post('meeting-requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting_request.reject')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async rejectMeetingRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,

    @Body() dto: RejectMeetingRequestDto,

    @Req() request: Request,

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent?: string,
  ): Promise<{ success: boolean; message: string; data: RejectResponseDto }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingRequestReviewService.reject(
      requestId,

      dto,

      { userId: user!.userId },

      { ipAddress, userAgent },
    );

    return {
      success: true,

      message: 'Yeu cau cuoc hop da bi tu choi',

      data: result,
    };
  }

  @Get('me/schedule')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('schedule.read.self')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async getMySchedule(
    @CurrentUser() user: { userId: string },

    @Query() dto: MyScheduleQueryDto,
  ): Promise<{ success: boolean; message: string; data: ScheduleResponseDto }> {
    const result = await this.meetingsService.getMySchedule(user.userId, dto);

    return {
      success: true,

      message: 'Lay lich thanh cong',

      data: result,
    };
  }

  @Get('me/meetings/history')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('schedule.read.self')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async getMyMeetingHistory(
    @CurrentUser() user: { userId: string },

    @Query() dto: MeetingHistoryQueryDto,
  ): Promise<{
    success: boolean;
    message: string;
    data: MeetingHistoryResponseDto;
  }> {
    const result = await this.meetingsService.getMyMeetingHistory(
      user.userId,
      dto,
    );

    return {
      success: true,

      message: 'Lay lich su cuoc hop thanh cong',

      data: result,
    };
  }

  @Get('me/schedule/:meetingId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('schedule.read.self')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,
    }),
  )
  async getMyScheduleDetail(
    @CurrentUser() user: { userId: string },

    @Param('meetingId', ParseUUIDPipe) meetingId: string,
  ): Promise<{ success: boolean; message: string; data: MyScheduleDetailDto }> {
    const result = await this.meetingsService.getMyScheduleDetail(
      user.userId,

      meetingId,
    );

    return {
      success: true,

      message: 'Chi tiet cuoc hop',

      data: result,
    };
  }

  @Delete('meetings/:meetingId/participants/:participantUserId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async removeParticipant(
    @Param() params: RemoveParticipantParamsDto,

    @Body() body: RemoveParticipantBodyDto,

    @Req() request: Request,

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;

    message: string;

    data: RemoveParticipantResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingsService.removeParticipant(
      params.meetingId,

      params.participantUserId,

      { userId: user!.userId },

      { ipAddress, userAgent },

      body,
    );

    return {
      success: true,

      message: 'Da go bo thanh vien khoi cuoc hop thanh cong',

      data: result,
    };
  }

  // ------------------------------------------------------------
  /**
   * [2026-08-23] BỎ PermissionsGuard có chủ đích — KHÔNG phải quên.
   *
   * Trước đây endpoint này yêu cầu `meeting.participant.add.external`, mà EMPLOYEE
   * không được cấp -> nhân viên là Host/Organizer mời được khách ngoài LÚC ĐẶT LỊCH
   * (POST /meetings nhận `externalParticipants` mà không cần permission nào) nhưng
   * lại bị 403 khi mời thêm sau đó. Cùng một hành vi nghiệp vụ, hai luật khác nhau.
   * Chính sách cũ cũng đã hở sẵn: EMPLOYEE có `meeting.participant.import` và file
   * import cho phép dòng khách ngoài.
   *
   * Nay theo đúng pattern của DELETE .../participants/external ngay bên dưới: guard
   * chỉ còn JwtAuthGuard, quyền được quyết định trong service —
   * `isOwner (organizer/host) || checkUserPermission('meeting.participant.add.external')`,
   * cộng thêm chặn theo status và theo visibility PRIVATE. Nhờ vậy Host/Organizer tự
   * mời khách được, còn nhân viên KHÔNG liên quan tới cuộc họp vẫn bị 403 — chặt hơn
   * so với việc cấp permission này cho cả role EMPLOYEE.
   */
  @Post('meetings/:meetingId/participants/external')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async addExternalParticipant(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: AddExternalParticipantDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: IAddExternalParticipantResponse;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const result = await this.meetingsService.addExternalParticipant(
      meetingId,
      dto,
      { userId: user!.userId },
      { ipAddress, userAgent },
    );
    return {
      success: true,
      message: 'Đã thêm khách mời bên ngoài vào cuộc họp thành công',
      data: result,
    };
  }

  @Delete('meetings/:meetingId/participants/external/:externalParticipantId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async removeExternalParticipant(
    @Param() params: RemoveExternalParticipantParamsDto,
    @Body() body: RemoveExternalParticipantBodyDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: RemoveExternalParticipantResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const result = await this.meetingsService.removeExternalParticipant(
      params.meetingId,
      params.externalParticipantId,
      { userId: user!.userId },
      { ipAddress, userAgent },
      body,
    );
    return {
      success: true,
      message: 'Đã gỡ bỏ khách mời bên ngoài khỏi cuộc họp thành công',
      data: result,
    };
  }

  // Agenda endpoints (UC-MM-09)

  // ------------------------------------------------------------

  @Get('meetings/:meetingId/agendas')
  @AllowPartnerAccount()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Xem danh sach agenda cua cuoc hop' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Danh sach agenda',
    type: AgendaListResponseDto,
  })
  @ApiResponse({ status: 403, description: 'AGENDA_READ_FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  async getAgendas(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,

    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: AgendaListResponseDto;
  }> {
    const result = await this.meetingsService.getAgendas(
      meetingId,

      currentUser.userId,
    );

    return {
      success: true,

      message: 'Lay danh sach agenda thanh cong',

      data: result,
    };
  }

  @Put('meetings/:meetingId/agendas')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Luu toan bo chuong trinh hop (atomic replace)' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiBody({ type: ReplaceAgendaDto })
  @ApiResponse({
    status: 200,
    description: 'Luu agenda thanh cong',
    type: ReplaceAgendaResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'AGENDA_ITEMS_REQUIRED / AGENDA_INVALID_PAYLOAD',
  })
  @ApiResponse({ status: 403, description: 'AGENDA_WRITE_FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'AGENDA_MEETING_STATUS_BLOCKED / MEETING_TIME_INVALID_FOR_AGENDA',
  })
  @ApiResponse({ status: 422, description: 'Validation errors' })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async replaceAgendas(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,

    @Body() dto: ReplaceAgendaDto,

    @CurrentUser() currentUser: { userId: string },

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: ReplaceAgendaResponseDto;
  }> {
    const clientContext: ClientContext = {
      ipAddress,

      userAgent: userAgent || undefined,
    };

    const result = await this.meetingsService.replaceAgendas(
      meetingId,

      dto,

      currentUser.userId,

      clientContext,
    );

    return {
      success: true,

      message: 'Luu chuong trinh hop thanh cong',

      data: result,
    };
  }

  @Patch('meetings/:meetingId/agendas/:agendaId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cap nhat mot muc agenda cu the (partial update)' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'agendaId', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateAgendaItemDto })
  @ApiResponse({
    status: 200,
    description: 'Cap nhat muc agenda thanh cong',
    type: AgendaItemUpdateResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'AGENDA_UPDATE_PAYLOAD_EMPTY / AGENDA_INVALID_PAYLOAD',
  })
  @ApiResponse({ status: 403, description: 'AGENDA_WRITE_FORBIDDEN' })
  @ApiResponse({
    status: 404,
    description: 'MEETING_NOT_FOUND / AGENDA_ITEM_NOT_FOUND',
  })
  @ApiResponse({
    status: 409,
    description:
      'AGENDA_MEETING_STATUS_BLOCKED / MEETING_TIME_INVALID_FOR_AGENDA',
  })
  @ApiResponse({ status: 422, description: 'Validation errors' })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted: true,
    }),
  )
  async updateAgendaItem(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,

    @Param('agendaId', ParseUUIDPipe) agendaId: string,

    @Body() dto: UpdateAgendaItemDto,

    @CurrentUser() currentUser: { userId: string },

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: AgendaItemUpdateResponseDto;
  }> {
    const clientContext: ClientContext = {
      ipAddress,

      userAgent: userAgent || undefined,
    };

    const result = await this.meetingsService.updateAgendaItem(
      meetingId,

      agendaId,

      dto,

      currentUser.userId,

      clientContext,
    );

    return {
      success: true,

      message: 'Cap nhat chuong trinh hop thanh cong',

      data: result,
    };
  }

  @Delete('meetings/:meetingId/agendas/:agendaId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Xoa mot muc agenda cu the' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'agendaId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Xoa muc agenda thanh cong',
    type: DeleteAgendaItemResponseDto,
  })
  @ApiResponse({ status: 403, description: 'AGENDA_WRITE_FORBIDDEN' })
  @ApiResponse({
    status: 404,
    description: 'MEETING_NOT_FOUND / AGENDA_ITEM_NOT_FOUND',
  })
  @ApiResponse({ status: 409, description: 'AGENDA_MEETING_STATUS_BLOCKED' })
  async deleteAgendaItem(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,

    @Param('agendaId', ParseUUIDPipe) agendaId: string,

    @CurrentUser() currentUser: { userId: string },

    @Ip() ipAddress: string,

    @Headers('user-agent') userAgent: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: DeleteAgendaItemResponseDto;
  }> {
    const clientContext: ClientContext = {
      ipAddress,

      userAgent: userAgent || undefined,
    };

    const result = await this.meetingsService.deleteAgendaItem(
      meetingId,

      agendaId,

      currentUser.userId,

      clientContext,
    );

    return {
      success: true,

      message: 'Xoa muc agenda thanh cong',

      data: result,
    };
  }

  // Agenda Attachment endpoints (đính kèm tài liệu cho agenda item)
  // Xem spec/features/meeting/feat-attach-meeting-agenda-document/

  @Post('meetings/:meetingId/agendas/:agendaId/attachments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Dinh kem tai lieu cho mot muc agenda' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'agendaId', type: 'string', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Dinh kem thanh cong',
    type: AgendaAttachmentUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'AGENDA_ATTACHMENT_FILE_REQUIRED / AGENDA_ATTACHMENT_FILE_TOO_LARGE / AGENDA_ATTACHMENT_FILE_TYPE_INVALID',
  })
  @ApiResponse({ status: 403, description: 'AGENDA_WRITE_FORBIDDEN' })
  @ApiResponse({
    status: 404,
    description: 'MEETING_NOT_FOUND / AGENDA_ITEM_NOT_FOUND',
  })
  @ApiResponse({
    status: 409,
    description:
      'AGENDA_MEETING_STATUS_BLOCKED / AGENDA_ATTACHMENT_LIMIT_EXCEEDED',
  })
  async addAgendaAttachment(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('agendaId', ParseUUIDPipe) agendaId: string,
    @UploadedFile() file: UploadedAgendaAttachmentFile | undefined,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: AgendaAttachmentUploadResponseDto;
  }> {
    const result = await this.meetingsService.addAgendaAttachment(
      meetingId,
      agendaId,
      file,
      currentUser.userId,
    );

    return {
      success: true,
      message: 'Da dinh kem tai lieu thanh cong',
      data: result,
    };
  }

  @Delete('meetings/:meetingId/agendas/:agendaId/attachments/:fileId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Go tai lieu dinh kem cua mot muc agenda' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'agendaId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'fileId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Xoa tai lieu dinh kem thanh cong',
    type: DeleteAgendaAttachmentResponseDto,
  })
  @ApiResponse({ status: 403, description: 'AGENDA_WRITE_FORBIDDEN' })
  @ApiResponse({
    status: 404,
    description:
      'MEETING_NOT_FOUND / AGENDA_ITEM_NOT_FOUND / AGENDA_ATTACHMENT_NOT_FOUND',
  })
  @ApiResponse({ status: 409, description: 'AGENDA_MEETING_STATUS_BLOCKED' })
  async removeAgendaAttachment(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('agendaId', ParseUUIDPipe) agendaId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: DeleteAgendaAttachmentResponseDto;
  }> {
    const result = await this.meetingsService.removeAgendaAttachment(
      meetingId,
      agendaId,
      fileId,
      currentUser.userId,
    );

    return {
      success: true,
      message: 'Da go tai lieu dinh kem',
      data: result,
    };
  }
}
