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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ZonesService } from '../services/zones.service.js';
import { CreateZoneDto } from '../dto/create-zone.dto.js';
import { UpdateZoneDto } from '../dto/update-zone.dto.js';
import { ListZonesQueryDto } from '../dto/list-zones-query.dto.js';
import { AssignZoneDevicesDto } from '../dto/assign-zone-devices.dto.js';
import { toZoneResponse } from '../dto/zone-response.dto.js';

// Repo KHÔNG có global ValidationPipe (main.ts) ⇒ phải khai tường minh ở controller.
const ZONE_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * ZonesController (ZNC-001 / UC-90 + ZNU-001 / UC-91) — tạo và cập nhật khu vực.
 *
 * 7 route (prefix `api/v1` set ở main.ts):
 * - GET    /api/v1/zones                        — danh sách + filter + phân trang (UC-93).
 * - GET    /api/v1/zones/:id                    — chi tiết (UC-93).
 * - POST   /api/v1/zones                        — tạo khu vực (UC-90).
 * - PATCH  /api/v1/zones/:id/devices            — gán thiết bị vào khu vực (UC-94).
 * - PATCH  /api/v1/zones/:id                    — cập nhật khu vực, GỘP cả `status` (UC-91).
 * - DELETE /api/v1/zones/:id/devices/:deviceId  — gỡ thiết bị khỏi khu vực (UC-94).
 * - DELETE /api/v1/zones/:id                    — xóa mềm, chặn khi còn thiết bị (UC-92).
 *
 * ⚠ `@RequirePermissions` là BẮT BUỘC: `PermissionsGuard` trả `true` khi handler không có
 * metadata (permissions.guard.ts) ⇒ thiếu decorator = endpoint hở im lặng, không lỗi nào báo.
 */
@Controller('zones')
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  // ── UC-93 (ZNL-001): đọc dữ liệu ──
  //
  // ⚠ LUẬT MODULE: mọi route STATIC phải khai TRƯỚC route động `:id`. Route `@Get(':id')`
  // sẽ nuốt bất kỳ path static nào khai sau nó (vd `/zones/statistics`), và lỗi hiện ra dưới
  // dạng 400 của `ParseUUIDPipe` — rất khó đoán. Mirror `iot-devices.controller.ts`.

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAnyPermissions('zones.zone.read', 'gate.access.monitor')
  @UsePipes(ZONE_PIPE)
  async list(@Query() query: ListZonesQueryDto) {
    const { items, meta } = await this.zonesService.list(query);

    return {
      success: true,
      message: 'Zones retrieved successfully',
      data: items.map((item) => toZoneResponse(item)),
      meta,
    };
  }

  // Route ĐỘNG — luôn khai SAU mọi route static của cùng method.
  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAnyPermissions('zones.zone.read', 'gate.access.monitor')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const { zone, devices } = await this.zonesService.getDetail(id);

    return {
      success: true,
      message: 'Zone retrieved successfully',
      data: toZoneResponse(zone, devices),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.zone.create')
  @UsePipes(ZONE_PIPE)
  async create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateZoneDto,
  ) {
    const entity = await this.zonesService.create(dto, user.userId);

    return {
      success: true,
      message: 'Zone created successfully',
      data: toZoneResponse(entity),
    };
  }

  /**
   * UC-94 (ZNA-001): gán một lô thiết bị vào khu vực. ALL-OR-NOTHING — một thiết bị lỗi thì cả
   * lô bị từ chối. Response CHỈ phản chiếu id client gửi, KHÔNG trả thông tin thiết bị (không
   * biến endpoint của `zones` thành cửa đọc dữ liệu `iot`).
   *
   * ⚠ THỨ TỰ KHAI — ĐÍNH CHÍNH luật module: luật "route static khai TRƯỚC route động" chỉ áp
   * dụng khi hai pattern CÙNG SỐ SEGMENT (vd `@Get('statistics')` vs `@Get(':id')`). Ở đây
   * `:id/devices` là 2 segment còn `:id` là 1 segment nên KHÔNG xung đột; đặt trước chỉ để nhất
   * quán và tránh người sau hiểu nhầm luật.
   */
  @Patch(':id/devices')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.zone.assign_device')
  @UsePipes(ZONE_PIPE)
  async assignDevices(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignZoneDevicesDto,
  ) {
    const { zone, assignedDeviceIds } = await this.zonesService.assignDevices(
      id,
      dto,
      user.userId,
    );

    return {
      success: true,
      message: 'Devices assigned to zone successfully',
      data: {
        zone: toZoneResponse(zone),
        assigned_device_ids: assignedDeviceIds,
      },
    };
  }

  /**
   * UC-94 (ZNA-001): gỡ 1 thiết bị khỏi khu vực (`zone_id` về NULL). Dùng chung permission với
   * route gán (OQ-8). Khai trước `@Delete(':id')` theo cùng lý do ở `assignDevices`.
   */
  @Delete(':id/devices/:deviceId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.zone.assign_device')
  async unassignDevice(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    const { zone, unassignedDeviceId } = await this.zonesService.unassignDevice(
      id,
      deviceId,
      user.userId,
    );

    return {
      success: true,
      message: 'Device unassigned from zone successfully',
      data: {
        zone: toZoneResponse(zone),
        unassigned_device_id: unassignedDeviceId,
      },
    };
  }

  /**
   * UC-91 (ZNU-001): cập nhật khu vực. KHÔNG `@HttpCode` — PATCH mặc định 200, kể cả khi
   * service trả no-op (không có field nào đổi giá trị thật).
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.zone.update')
  @UsePipes(ZONE_PIPE)
  async update(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateZoneDto,
  ) {
    const entity = await this.zonesService.update(id, dto, user.userId);

    return {
      success: true,
      message: 'Zone updated successfully',
      data: toZoneResponse(entity),
    };
  }

  /**
   * UC-92 (ZND-001): xoá mềm khu vực. KHÔNG `@HttpCode` — DELETE mặc định 200 (OQ-3:
   * trả envelope với `data: null`, KHÔNG dùng 204). KHÔNG `ZONE_PIPE` vì không có body/query.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.zone.delete')
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.zonesService.remove(id, user.userId);

    return {
      success: true,
      message: 'Zone deleted successfully',
      data: null,
    };
  }
}
