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
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { VehicleControlListService } from '../services/vehicle-control-list.service.js';
import { CreateVehicleControlListDto } from '../dto/create-vehicle-control-list.dto.js';
import { UpdateVehicleControlListDto } from '../dto/update-vehicle-control-list.dto.js';
import { ListVehicleControlListQueryDto } from '../dto/list-vehicle-control-list-query.dto.js';
import { toVehicleControlListResponse } from '../dto/vehicle-control-list-response.dto.js';

const CONTROL_LIST_PIPE = new ValidationPipe({
  whitelist: true,
  transform: true,
});

/**
 * VehicleControlListController (VCL-001 / UC8) — CRUD danh sách kiểm soát phương tiện
 * (blocklist/watchlist). Khác `VehicleRegistrationController` (biển hợp lệ của user tự
 * quản) — bảng này không có ownership, KHÔNG route self-service; toàn bộ 5 route đều
 * admin/security-gated bằng `PermissionsGuard`.
 */
@ApiTags('ANPR - Vehicle Control List')
@Controller('anpr/admin/control-list')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VehicleControlListController {
  constructor(
    private readonly vehicleControlListService: VehicleControlListService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('vehicle_control.create')
  @UsePipes(CONTROL_LIST_PIPE)
  @ApiOperation({
    summary: 'Thêm 1 biển số vào danh sách kiểm soát (blocklist/watchlist)',
  })
  async create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateVehicleControlListDto,
  ) {
    const entity = await this.vehicleControlListService.create(
      user.userId,
      dto,
    );
    return {
      success: true,
      message: 'Control list entry created successfully',
      data: toVehicleControlListResponse(entity),
    };
  }

  @Get()
  @RequirePermissions('vehicle_control.read')
  @UsePipes(CONTROL_LIST_PIPE)
  @ApiOperation({
    summary: 'Xem danh sách biển số kiểm soát, có phân trang + lọc',
  })
  async list(@Query() query: ListVehicleControlListQueryDto) {
    const { items, meta } = await this.vehicleControlListService.list(query);
    return {
      success: true,
      message: 'Control list retrieved successfully',
      data: items.map(toVehicleControlListResponse),
      meta,
    };
  }

  @Get(':id')
  @RequirePermissions('vehicle_control.read')
  @ApiOperation({
    summary: 'Xem chi tiết 1 mục trong danh sách kiểm soát biển số theo ID',
  })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const entity = await this.vehicleControlListService.getDetail(id);
    return {
      success: true,
      message: 'Control list entry retrieved successfully',
      data: toVehicleControlListResponse(entity),
    };
  }

  @Patch(':id')
  @RequirePermissions('vehicle_control.update')
  @UsePipes(CONTROL_LIST_PIPE)
  @ApiOperation({ summary: 'Cập nhật 1 mục trong danh sách kiểm soát biển số' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleControlListDto,
  ) {
    const entity = await this.vehicleControlListService.update(id, dto);
    return {
      success: true,
      message: 'Control list entry updated successfully',
      data: toVehicleControlListResponse(entity),
    };
  }

  @Post(':id/hgvision-sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vehicle_control.update')
  @ApiOperation({
    summary: 'Đồng bộ lại 1 biển số kiểm soát sang HGVision',
  })
  async resync(@Param('id', ParseUUIDPipe) id: string) {
    const entity = await this.vehicleControlListService.resync(id);
    return {
      success: true,
      message: 'Control list entry synced',
      data: toVehicleControlListResponse(entity),
    };
  }

  @Delete(':id')
  @RequirePermissions('vehicle_control.delete')
  @ApiOperation({ summary: 'Xóa mềm 1 mục khỏi danh sách kiểm soát biển số' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.vehicleControlListService.softDelete(id);
    return {
      success: true,
      message: 'Control list entry deleted successfully',
      data: null,
    };
  }
}
