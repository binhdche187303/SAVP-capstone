import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { RoomsService } from '../services/rooms.service.js';
import { RoomStatusService } from '../services/room-status.service.js';
import { RoomSearchService } from '../services/room-search.service.js';
import { CreateRoomDto } from '../dto/create-room.dto.js';
import { CreateRoomResponseDto } from '../dto/create-room-response.dto.js';
import { RealtimeStatusQueryDto } from '../dto/realtime-status-query.dto.js';
import { UpdateRoomDto } from '../dto/update-room.dto.js';
import { UpdateRoomResponseDto } from '../dto/update-room-response.dto.js';
import { UpdateRoomAdministrativeStatusDto } from '../dto/update-room-administrative-status.dto.js';
import { UpdateRoomAdministrativeStatusResponseDto } from '../dto/update-room-administrative-status-response.dto.js';
import { SearchRoomsQueryDto } from '../dto/search-rooms-query.dto.js';
import { AvailableRoomsQueryDto } from '../dto/available-rooms-query.dto.js';
import { AvailableRoomItemDto } from '../dto/available-room-item.dto.js';
import { DeletionImpactResponseDto } from '../dto/deletion-impact-response.dto.js';
import { DeleteRoomResponseDto } from '../dto/delete-room-response.dto.js';
import { RoomDetailResponseDto } from '../dto/room-detail-response.dto.js';

@ApiTags('Rooms')
@Controller('rooms')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly roomStatusService: RoomStatusService,
    private readonly roomSearchService: RoomSearchService,
  ) {}

  // UC-ROOM-04: tim kiem/liet ke danh sach phong (moi user da dang nhap, khong
  // permission rieng). Khai TRUOC ':roomId/status' de tranh route param nuot mat
  // (dam bao an toan du 'search' chi 1 segment, ':roomId/status' 2 segment, khong
  // thuc su xung dot — giu quy uoc khai static route truoc de nhat quan).
  @Get('filter-options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Danh mục vị trí và loại phòng để lọc phòng họp' })
  async filterOptions() {
    return {
      success: true,
      data: await this.roomSearchService.filterOptions(),
    };
  }

  @Get('search')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Tim kiem/liet ke danh sach phong hop' })
  @ApiResponse({
    status: 200,
    description: 'Danh sach phong hop duoc truy xuat thanh cong',
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  async search(@Query() query: SearchRoomsQueryDto) {
    const result = await this.roomSearchService.search(query);
    const message =
      result.rooms.length === 0
        ? 'Không có phòng họp nào khớp với các tiêu chí hiện tại. Vui lòng điều chỉnh bộ lọc của bạn.'
        : 'Danh sách phòng họp được truy xuất thành công';
    return {
      success: true,
      message,
      data: result.rooms,
      meta: result.meta,
    };
  }

  // Yeu cau FE (Docs/Nam_Sent/backend_api_requirements_available_rooms.md):
  // loc phong trong theo khung gio (khong bi trung lich) + suc chua toi thieu.
  // Khai TRUOC ':roomId' (cung 1 segment, giong 'search'/'realtime-status').
  @Get('available')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Tim phong hop trong theo khung gio' })
  @ApiResponse({ status: 200, description: 'Danh sach phong trong' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  async available(
    @Query() query: AvailableRoomsQueryDto,
  ): Promise<{ success: boolean; data: AvailableRoomItemDto[] }> {
    const data = await this.roomSearchService.getAvailableRooms(query);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Tao phong hop moi' })
  @ApiBody({ type: CreateRoomDto })
  @ApiResponse({ status: 201, description: 'Tao phong thanh cong' })
  @ApiResponse({ status: 400, description: 'Thieu truong bat buoc' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen room.create' })
  @ApiResponse({ status: 409, description: 'Trung roomCode hoac roomName' })
  @ApiResponse({ status: 422, description: 'Du lieu khong hop le' })
  async create(
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
    @Req() req: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: CreateRoomResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.roomsService.create(dto, userId, ipAddress);

    return {
      success: true,
      message: 'Room created successfully',
      data: result,
    };
  }

  // UC-ROOM-02: cap nhat thong tin phong hop.
  @Patch(':roomId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Cap nhat thong tin phong hop' })
  @ApiBody({ type: UpdateRoomDto })
  @ApiResponse({ status: 200, description: 'Cap nhat thanh cong' })
  @ApiResponse({ status: 400, description: 'Thieu truong bat buoc' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen room.update' })
  @ApiResponse({ status: 404, description: 'Khong tim thay phong' })
  @ApiResponse({ status: 409, description: 'Trung roomName' })
  async update(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UpdateRoomResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.roomsService.update(
      roomId,
      dto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Cập nhật thông tin phòng họp thành công',
      data: result,
    };
  }

  // feat-room-realtime-status: admin dat/go trang thai CHU DONG cua phong
  // (maintenance/inactive/available), tach bach khoi trang thai occupied/
  // reserved/available von duoc tinh real-time. 2 segment (":roomId/..."),
  // an toan voi ':roomId' 1-segment ke ben — cung quy uoc voi ':roomId/status'.
  @Patch(':roomId/administrative-status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Dat/go trang thai chu dong cua phong hop' })
  @ApiBody({ type: UpdateRoomAdministrativeStatusDto })
  @ApiResponse({ status: 200, description: 'Cap nhat thanh cong' })
  @ApiResponse({ status: 400, description: 'Gia tri status khong hop le' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen room.update' })
  @ApiResponse({ status: 404, description: 'Khong tim thay phong' })
  async updateAdministrativeStatus(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: UpdateRoomAdministrativeStatusDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UpdateRoomAdministrativeStatusResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.roomsService.updateAdministrativeStatus(
      roomId,
      dto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Cập nhật trạng thái phòng họp thành công',
      data: result,
    };
  }

  // UC-ROOM-03: xem truoc tac dong xoa phong (preview, read-only).
  @Get(':roomId/deletion-impact')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.delete')
  @ApiOperation({ summary: 'Xem truoc tac dong cua viec xoa phong hop' })
  @ApiResponse({
    status: 200,
    description: 'Thong tin tac dong da duoc truy xuat',
  })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen room.delete' })
  @ApiResponse({ status: 404, description: 'Khong tim thay phong' })
  async deletionImpact(
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: DeletionImpactResponseDto;
  }> {
    const result = await this.roomsService.getDeletionImpact(roomId);
    return {
      success: true,
      message: 'Thông tin tác động đã được truy xuất',
      data: result,
    };
  }

  // UC-ROOM-03: xoa (soft-delete) phong hop.
  @Delete(':roomId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.delete')
  async deleteRoom(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: DeleteRoomResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.roomsService.deleteRoom(
      roomId,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Xóa phòng họp thành công',
      data: result,
    };
  }

  // RMS-001 (UC-36): tổng quan trạng thái phòng realtime.
  // Khai TRƯỚC :roomId/status để route param không nuốt.
  @Get('realtime-status')
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.utilization.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async realtimeStatus(@Query() query: RealtimeStatusQueryDto) {
    const data = await this.roomStatusService.getRealtimeStatus(query);
    return {
      success: true,
      message: 'Room realtime status retrieved',
      data,
    };
  }

  // RMS-001 (UC-38): chi tiết trạng thái 1 phòng.
  @Get(':roomId/status')
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.utilization.read')
  async roomStatus(@Param('roomId', ParseUUIDPipe) roomId: string) {
    const data = await this.roomStatusService.getRoomStatus(roomId);
    return {
      success: true,
      message: 'Room status retrieved',
      data,
    };
  }

  // ROOM-VIEW-DETAIL-001 (UC-ROOM-VIEW-DETAIL): Xem chi tiet 1 phong hop (admin only).
  // FR-009: khai SAU 'search' va 'realtime-status' (2 route literal 1-segment) de tranh
  // route param ':roomId' nuot mat chung. An toan voi ':roomId/status' va ':roomId/deletion-impact'
  // vi khac so segment.
  @Get(':roomId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.detail.read')
  @ApiOperation({ summary: 'Xem chi tiet 1 phong hop (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiet phong duoc truy xuat thanh cong',
  })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen room.detail.read' })
  @ApiResponse({ status: 404, description: 'Khong tim thay phong' })
  async getDetail(@Param('roomId', ParseUUIDPipe) roomId: string): Promise<{
    success: boolean;
    message: string;
    data: RoomDetailResponseDto;
  }> {
    const data = await this.roomsService.getRoomDetail(roomId);
    return { success: true, message: 'Room detail retrieved', data };
  }
}
