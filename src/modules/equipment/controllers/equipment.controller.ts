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

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { EquipmentService } from '../services/equipment.service.js';
import { CreateEquipmentDto } from '../dto/create-equipment.dto.js';
import { ReportEquipmentFaultDto } from '../dto/report-equipment-fault.dto.js';
import { ConfirmEquipmentFaultDto } from '../dto/confirm-equipment-fault.dto.js';
import { ResolveEquipmentFaultDto } from '../dto/resolve-equipment-fault.dto.js';
import { ListEquipmentsQueryDto } from '../dto/list-equipments-query.dto.js';
import { AssignEquipmentDto } from '../dto/assign-equipment.dto.js';
import { EquipmentResponseDto } from '../dto/equipment-response.dto.js';
import { EquipmentFaultConfirmationResponseDto } from '../dto/equipment-fault-confirmation-response.dto.js';
import { EquipmentFaultHistoryItemDto } from '../dto/equipment-fault-history-item.dto.js';
import { RoomEquipmentGapItemDto } from '../dto/room-equipment-gap-item.dto.js';

@ApiTags('Equipment')
@Controller('equipments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Dang ky thiet bi hop moi' })
  @ApiBody({ type: CreateEquipmentDto })
  @ApiResponse({ status: 201, description: 'Đăng ký thiết bị thành công' })
  @ApiResponse({
    status: 400,
    description: 'Thieu truong bat buoc / field cam',
  })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.create' })
  @ApiResponse({
    status: 409,
    description: 'Trung serialNumber hoac equipmentCode',
  })
  @ApiResponse({ status: 422, description: 'Du lieu khong hop le' })
  async create(
    @Body() dto: CreateEquipmentDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EquipmentResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.equipmentService.create(dto, userId, ipAddress);

    return {
      success: true,
      message: 'Đăng ký thiết bị thành công',
      data: result,
    };
  }

  @Patch(':equipmentId/fault')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.report_fault')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Bao loi / chuyen bao tri thiet bi' })
  @ApiBody({ type: ReportEquipmentFaultDto })
  @ApiResponse({
    status: 200,
    description: 'Cap nhat trang thai loi thanh cong',
  })
  @ApiResponse({ status: 400, description: 'Du lieu DTO khong hop le' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({
    status: 403,
    description: 'Khong co quyen equipment.report_fault',
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy thiết bị' })
  @ApiResponse({
    status: 409,
    description: 'Thiet bi retired/lost khong the bao loi',
  })
  @ApiResponse({ status: 422, description: 'Khong co status thay doi' })
  async reportFault(
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
    @Body() dto: ReportEquipmentFaultDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EquipmentResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.equipmentService.reportFault(
      equipmentId,
      dto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Cập nhật trạng thái lỗi thiết bị thành công',
      data: result,
    };
  }

  @Delete(':equipmentId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.delete')
  @ApiOperation({ summary: 'Xoa mem thiet bi (soft delete)' })
  @ApiResponse({ status: 200, description: 'Xóa thiết bị thành công' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.delete' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy thiết bị' })
  async deleteEquipment(
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    await this.equipmentService.deleteEquipment(equipmentId, userId, ipAddress);

    return {
      success: true,
      message: 'Xóa thiết bị thành công',
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.read')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Tim kiem / loc kho thiet bi (co phan trang)' })
  @ApiResponse({ status: 200, description: 'Danh sách thiết bị' })
  @ApiResponse({ status: 400, description: 'Query khong hop le' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.read' })
  async listEquipments(@Query() query: ListEquipmentsQueryDto): Promise<{
    success: boolean;
    message: string;
    data: EquipmentResponseDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { data, total } = await this.equipmentService.listEquipments(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    return {
      success: true,
      message: 'Danh sách thiết bị',
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('rooms-missing-equipment')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.read')
  @ApiOperation({
    summary: 'Danh sach phong da dang ky thiet bi nhung chua duoc gan du',
  })
  @ApiResponse({ status: 200, description: 'Danh sách phòng còn thiếu thiết bị' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.read' })
  async getRoomsMissingEquipment(): Promise<{
    success: boolean;
    message: string;
    data: RoomEquipmentGapItemDto[];
    meta: { totalRoomsMissing: number };
  }> {
    const { data, totalRoomsMissing } =
      await this.equipmentService.getRoomsMissingEquipment();

    return {
      success: true,
      message: 'Danh sách phòng còn thiếu thiết bị',
      data,
      meta: { totalRoomsMissing },
    };
  }

  @Patch(':equipmentId/assignment')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.assign')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Phan bo thiet bi vao phong hop' })
  @ApiBody({ type: AssignEquipmentDto })
  @ApiResponse({ status: 200, description: 'Phan bo thiet bi thanh cong' })
  @ApiResponse({ status: 400, description: 'Du lieu DTO khong hop le' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.assign' })
  @ApiResponse({ status: 404, description: 'Khong tim thay thiet bi / phong' })
  @ApiResponse({
    status: 409,
    description: 'Thiet bi / phong khong o trang thai co the gan',
  })
  async assignToRoom(
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
    @Body() dto: AssignEquipmentDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EquipmentResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.equipmentService.assignToRoom(
      equipmentId,
      dto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Phân bổ thiết bị vào phòng thành công',
      data: result,
    };
  }

  @Delete(':equipmentId/assignment')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.assign')
  @ApiOperation({ summary: 'Go thiet bi khoi phong dang gan' })
  @ApiResponse({ status: 200, description: 'Gỡ thiết bị khỏi phòng thành công' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.assign' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy thiết bị' })
  @ApiResponse({
    status: 409,
    description: 'Thiết bị hiện không được gán vào phòng nào',
  })
  async unassignFromRoom(
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EquipmentResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.equipmentService.unassignFromRoom(
      equipmentId,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Gỡ thiết bị khỏi phòng thành công',
      data: result,
    };
  }

  @Patch(':equipmentId/fault-confirmation')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.confirm_fault')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Xac nhan loi thiet bi la that' })
  @ApiBody({ type: ConfirmEquipmentFaultDto })
  @ApiResponse({
    status: 200,
    description: 'Xác nhận lỗi thiết bị thành công',
  })
  @ApiResponse({ status: 400, description: 'Du lieu DTO khong hop le' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({
    status: 403,
    description: 'Khong co quyen equipment.confirm_fault',
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy thiết bị' })
  @ApiResponse({
    status: 409,
    description: 'Thiet bi dang o trang thai binh thuong, khong co loi active',
  })
  async confirmFault(
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
    @Body() dto: ConfirmEquipmentFaultDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EquipmentFaultConfirmationResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.equipmentService.confirmFault(
      equipmentId,
      dto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Xác nhận lỗi thiết bị thành công',
      data: result,
    };
  }

  @Patch(':equipmentId/fault-resolution')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.resolve_fault')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Cap nhat thiet bi da sua xong' })
  @ApiBody({ type: ResolveEquipmentFaultDto })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thiết bị đã sửa xong thành công',
  })
  @ApiResponse({ status: 400, description: 'Du lieu DTO khong hop le' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({
    status: 403,
    description: 'Khong co quyen equipment.resolve_fault',
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy thiết bị' })
  @ApiResponse({
    status: 409,
    description: 'Thiet bi dang o trang thai binh thuong, khong co loi active',
  })
  async resolveFault(
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
    @Body() dto: ResolveEquipmentFaultDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EquipmentResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.equipmentService.resolveFault(
      equipmentId,
      dto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Cập nhật thiết bị đã sửa xong thành công',
      data: result,
    };
  }

  @Get(':equipmentId/fault-history')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.read')
  @ApiOperation({
    summary: 'Lich su bao hong / xac nhan / khac phuc cua 1 thiet bi',
  })
  @ApiResponse({ status: 200, description: 'Lịch sử báo hỏng thiết bị' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.read' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy thiết bị' })
  async getFaultHistory(
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EquipmentFaultHistoryItemDto[];
  }> {
    const data = await this.equipmentService.getFaultHistory(equipmentId);

    return {
      success: true,
      message: 'Lịch sử báo hỏng thiết bị',
      data,
    };
  }
}
