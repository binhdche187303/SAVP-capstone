import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { CameraGroupDevicesDto, CreateCameraGroupDto, UpdateCameraGroupDto } from '../dto/camera-group.dto.js';
import { CameraGroupsService } from '../services/camera-groups.service.js';

const PIPE = new ValidationPipe({ whitelist: true, transform: true });

@Controller('camera-groups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UsePipes(PIPE)
export class CameraGroupsController {
  constructor(private readonly service: CameraGroupsService) {}

  @Get()
  @RequirePermissions('iot.camera_group.read')
  async list(@Query('search') search?: string) {
    return { success: true, message: 'Camera groups retrieved successfully', data: await this.service.list(search) };
  }

  @Get(':id')
  @RequirePermissions('iot.camera_group.read')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, message: 'Camera group retrieved successfully', data: await this.service.get(id) };
  }

  @Post()
  @RequirePermissions('iot.camera_group.manage')
  async create(@Body() dto: CreateCameraGroupDto, @CurrentUser() user: { userId: string }) {
    return { success: true, message: 'Camera group created successfully', data: await this.service.create(dto, user.userId) };
  }

  @Patch(':id')
  @RequirePermissions('iot.camera_group.manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCameraGroupDto) {
    return { success: true, message: 'Camera group updated successfully', data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('iot.camera_group.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
    return { success: true, message: 'Camera group deleted successfully' };
  }

  @Post(':id/devices')
  @HttpCode(200)
  @RequirePermissions('iot.camera_group.manage')
  async addDevices(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CameraGroupDevicesDto) {
    return { success: true, message: 'Devices added to camera group', data: await this.service.addDevices(id, dto) };
  }

  @Delete(':id/devices/:deviceId')
  @HttpCode(200)
  @RequirePermissions('iot.camera_group.manage')
  async removeDevice(@Param('id', ParseUUIDPipe) id: string, @Param('deviceId', ParseUUIDPipe) deviceId: string) {
    return { success: true, message: 'Device removed from camera group', data: await this.service.removeDevice(id, deviceId) };
  }
}
