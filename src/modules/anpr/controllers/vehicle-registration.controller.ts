import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { VehicleRegistrationService } from '../services/vehicle-registration.service.js';
import { CreateVehicleRegistrationDto } from '../dto/create-vehicle-registration.dto.js';
import { AdminCreateVehicleRegistrationDto } from '../dto/admin-create-vehicle-registration.dto.js';
import { UpdateVehicleRegistrationDto } from '../dto/update-vehicle-registration.dto.js';
import { UpdateVehicleStatusDto } from '../dto/update-vehicle-status.dto.js';
import { ListVehicleRegistrationsQueryDto } from '../dto/list-vehicle-registrations-query.dto.js';
import { AdminListVehicleRegistrationsQueryDto } from '../dto/admin-list-vehicle-registrations-query.dto.js';
import { ListUnknownVehiclesQueryDto } from '../dto/list-unknown-vehicles-query.dto.js';
import { ListVehicleHistoryQueryDto } from '../dto/list-vehicle-history-query.dto.js';
import { toVehicleRegistrationResponse } from '../dto/vehicle-registration-response.dto.js';
import { toAdminVehicleRegistrationResponse } from '../dto/admin-vehicle-registration-response.dto.js';
import { VehicleUnknownService } from '../services/vehicle-unknown.service.js';
import { VehicleHistoryService } from '../services/vehicle-history.service.js';
import { AllowPartnerAccount } from '../../../common/decorators/allow-partner-account.decorator.js';

const REGISTER_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * VehicleRegistrationController (VPR-001 / UC1) — đăng ký biển số xe.
 *
 * 2 route (OQ-1):
 * - USER  POST /api/v1/anpr/vehicle-registrations        — JwtAuthGuard, user_id từ @CurrentUser.
 * - ADMIN POST /api/v1/anpr/admin/vehicle-registrations  — gate THẬT (PermissionsGuard +
 *         @RequirePermissions), user_id từ body.
 * Cả 2 dùng chung service.register + cùng response mapper + envelope 201.
 */
@ApiTags('ANPR - Vehicle Registration')
@Controller('anpr')
export class VehicleRegistrationController {
  constructor(
    private readonly vehicleRegistrationService: VehicleRegistrationService,
    private readonly vehicleUnknownService: VehicleUnknownService,
    private readonly vehicleHistoryService: VehicleHistoryService,
  ) {}

  // ── UC7 (VHI-001): lịch sử ra/vào — path tách (KHÔNG dưới :id), đặt TRƯỚC route :id ──

  // USER: lịch sử xe CỦA MÌNH (chỉ matched). userId từ JWT (SEC-01).
  @Get('vehicle-history')
  @UseGuards(JwtAuthGuard)
  @UsePipes(REGISTER_PIPE)
  @AllowPartnerAccount()
  @ApiOperation({
    summary:
      'Xem lịch sử ra/vào cổng của xe THUỘC VỀ chính user đang đăng nhập (chỉ matched)',
  })
  async historyOwn(
    @CurrentUser() user: { userId: string },
    @Query() query: ListVehicleHistoryQueryDto,
  ) {
    const { items, meta } = await this.vehicleHistoryService.listForUser(
      user.userId,
      query,
    );
    return {
      success: true,
      message: 'Vehicle history retrieved',
      data: items,
      meta,
    };
  }

  // ADMIN: TẤT CẢ lượt ra/vào (matched + unmatched) — admin-gated.
  @Get('admin/vehicle-history')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAnyPermissions('anpr.vehicle.history_view', 'gate.access.read')
  @UsePipes(REGISTER_PIPE)
  @ApiOperation({
    summary:
      'Admin xem TOÀN BỘ lịch sử ra/vào cổng của mọi xe (matched + unmatched), có thông tin chủ xe',
  })
  async historyAll(@Query() query: ListVehicleHistoryQueryDto) {
    const { items, meta } = await this.vehicleHistoryService.listAll(query);
    return {
      success: true,
      message: 'Vehicle history retrieved',
      data: items,
      meta,
    };
  }

  // ── UC6 (VUN-001): admin xem danh sách biển lạ (unmatched) — read-only, admin-gated ──
  @Get('admin/unknown-vehicles')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('anpr.vehicle.unknown_view', 'vehicle_alert.read')
  @UsePipes(REGISTER_PIPE)
  @ApiOperation({
    summary:
      'Admin xem danh sách biển số lạ (đi qua camera nhưng chưa khớp đăng ký nào)',
  })
  async listUnknown(@Query() query: ListUnknownVehiclesQueryDto) {
    const { items, meta } = await this.vehicleUnknownService.listUnknown(query);
    return {
      success: true,
      message: 'Unknown vehicles retrieved',
      data: items,
      meta,
    };
  }

  // ── UC-101 (VPL-002): ADMIN xem/tra cứu biển của MỌI người — read-only, admin-gated ──
  //
  // ⚠ THỨ TỰ KHAI: đặt TRƯỚC @Get('vehicle-registrations/:id'). Tiêu chí xung đột route
  // ĐÚNG là "cùng literal prefix + có :param ở vị trí khác biệt", KHÔNG phải "cùng số segment":
  //   admin/vehicle-registrations  vs  vehicle-registrations/:id  → KHÔNG xung đột (segment
  //   đầu literal khác nhau: 'admin' ≠ 'vehicle-registrations').
  //   vehicle-registrations/summary vs vehicle-registrations/:id  → XUNG ĐỘT (cùng prefix).
  // Kỹ thuật không bắt buộc đặt trước, nhưng khai trong nhóm admin cho nhất quán tiền lệ.
  @Get('admin/vehicle-registrations')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('anpr.vehicle.admin_read')
  @UsePipes(REGISTER_PIPE)
  @ApiOperation({
    summary: 'Admin xem/tra cứu biển số đăng ký của TẤT CẢ user trong hệ thống',
  })
  async listAll(@Query() query: AdminListVehicleRegistrationsQueryDto) {
    const { items, meta } =
      await this.vehicleRegistrationService.listAll(query);
    return {
      success: true,
      message: 'Vehicle registrations retrieved',
      data: items.map(toAdminVehicleRegistrationResponse),
      meta,
    };
  }

  // ── UC3 (VPL-001): xem danh sách / chi tiết — chỉ biển CỦA MÌNH (list trước detail) ──

  // List biển của current user (phân trang + filter status). userId từ JWT (SEC-01).
  @Get('vehicle-registrations')
  @UseGuards(JwtAuthGuard)
  @UsePipes(REGISTER_PIPE)
  @AllowPartnerAccount()
  @ApiOperation({
    summary:
      'Xem danh sách biển số xe đã đăng ký CỦA CHÍNH user đang đăng nhập, có phân trang + lọc',
  })
  async list(
    @CurrentUser() user: { userId: string },
    @Query() query: ListVehicleRegistrationsQueryDto,
  ) {
    const { items, meta } = await this.vehicleRegistrationService.list(
      user.userId,
      query,
    );
    return {
      success: true,
      message: 'Vehicle registrations retrieved',
      data: items.map(toVehicleRegistrationResponse),
      meta,
    };
  }

  // Detail 1 biển của current user — không thuộc/đã xóa → 404.
  @Get('vehicle-registrations/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Xem chi tiết 1 biển số đã đăng ký CỦA CHÍNH user đang đăng nhập (không thuộc/đã xóa → 404)',
  })
  async detail(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const entity = await this.vehicleRegistrationService.getDetail(
      id,
      user.userId,
    );
    return {
      success: true,
      message: 'Vehicle registration retrieved',
      data: toVehicleRegistrationResponse(entity),
    };
  }

  // USER: tự đăng ký biển của mình — user_id LẤY TỪ JWT (KHÔNG body) — SEC-01.
  @Post('vehicle-registrations')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @UsePipes(REGISTER_PIPE)
  @ApiOperation({
    summary:
      'User tự đăng ký 1 biển số xe cho chính mình (userId lấy từ JWT, không nhận từ body)',
  })
  async registerOwn(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateVehicleRegistrationDto,
  ) {
    const entity = await this.vehicleRegistrationService.register(
      user.userId,
      dto,
    );
    return {
      success: true,
      message: 'Vehicle registered successfully',
      data: toVehicleRegistrationResponse(entity),
    };
  }

  // ADMIN: đăng ký hộ user bất kỳ — gate THẬT + user_id TỪ BODY.
  @Post('admin/vehicle-registrations')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('anpr.vehicle.admin_register')
  @UsePipes(REGISTER_PIPE)
  @ApiOperation({
    summary:
      'Admin đăng ký hộ 1 biển số xe cho user bất kỳ (userId nhận từ body)',
  })
  async registerForUser(@Body() dto: AdminCreateVehicleRegistrationDto) {
    const entity = await this.vehicleRegistrationService.register(
      dto.userId,
      dto,
    );
    return {
      success: true,
      message: 'Vehicle registered successfully',
      data: toVehicleRegistrationResponse(entity),
    };
  }

  // ADMIN: xóa mềm bất kỳ biển số (không fold userId — khác route user). VPT-BE-05.
  @Delete('admin/vehicle-registrations/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('anpr.vehicle.admin_delete')
  @ApiOperation({
    summary:
      'Admin xoá mềm 1 biển số của bất kỳ user nào (không cần là chủ xe)',
  })
  async removeAsAdmin(@Param('id', ParseUUIDPipe) id: string) {
    await this.vehicleRegistrationService.adminSoftDelete(id);
    return {
      success: true,
      message: 'Vehicle deleted successfully',
      data: null,
    };
  }

  // ── UC2 (VPM-001): sửa / disable / xóa-mềm — chỉ biển CỦA MÌNH (ownership trong service) ──

  // Sửa metadata (note/vehicle_type). userId từ JWT; biển không thuộc → 404.
  @Patch('vehicle-registrations/:id')
  @UseGuards(JwtAuthGuard)
  @UsePipes(REGISTER_PIPE)
  @ApiOperation({
    summary:
      'Sửa metadata (ghi chú/loại xe) của 1 biển số CỦA CHÍNH user đang đăng nhập',
  })
  async update(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleRegistrationDto,
  ) {
    const entity = await this.vehicleRegistrationService.updateMetadata(
      id,
      user.userId,
      dto,
    );
    return {
      success: true,
      message: 'Vehicle updated successfully',
      data: toVehicleRegistrationResponse(entity),
    };
  }

  // Enable/disable (active↔disabled). Route /status tách riêng (OQ-3).
  @Patch('vehicle-registrations/:id/status')
  @UseGuards(JwtAuthGuard)
  @UsePipes(REGISTER_PIPE)
  @ApiOperation({
    summary:
      'Bật/tắt (active↔disabled) 1 biển số CỦA CHÍNH user đang đăng nhập',
  })
  async updateStatus(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleStatusDto,
  ) {
    const entity = await this.vehicleRegistrationService.setStatus(
      id,
      user.userId,
      dto.status,
    );
    return {
      success: true,
      message: 'Vehicle status updated successfully',
      data: toVehicleRegistrationResponse(entity),
    };
  }

  // Xóa-mềm. DELETE trả data:null (OQ-4).
  @Delete('vehicle-registrations/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Xóa mềm 1 biển số CỦA CHÍNH user đang đăng nhập' })
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.vehicleRegistrationService.softDeleteOwned(id, user.userId);
    return {
      success: true,
      message: 'Vehicle deleted successfully',
      data: null,
    };
  }
}
