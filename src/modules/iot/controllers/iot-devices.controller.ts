import {
  Body,
  Controller,
  Post,
  Patch,
  Put,
  Get,
  Query,
  HttpCode,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CreateIotDeviceDto } from '../dto/create-iot-device.dto.js';
import { UpdateIotDeviceDto } from '../dto/update-iot-device.dto.js';
import { ListIotDevicesQueryDto } from '../dto/list-iot-devices-query.dto.js';
import { AssignRoomDto } from '../dto/assign-room.dto.js';
import { ConfigureRtspDto } from '../dto/configure-rtsp.dto.js';
import { ConfigureAiConfigDto } from '../dto/configure-ai-config.dto.js';
import { RevokeFaceServerTokenDto } from '../dto/revoke-face-server-token.dto.js';
import { ConfigureFaceServerDto } from '../dto/configure-face-server.dto.js';
import { ConnectionHistoryQueryDto } from '../dto/connection-history-query.dto.js';
import { IotDevicesService } from '../services/iot-devices.service.js';
import { DeviceConnectionHistoryService } from '../services/device-connection-history.service.js';
import { CameraSettingsService } from '../services/camera-settings.service.js';
import {
  AnprStatsQueryDto,
  ConfigureRecordingDto,
  SaveCameraLayoutDto,
} from '../dto/camera-settings.dto.js';
import { toIotDeviceResponse } from '../dto/iot-device-response.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
// A5 (IOT-005): route check-availability dùng guard auth THẬT (mirror B21).
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

@Controller('iot-devices')
export class IotDevicesController {
  constructor(
    private readonly iotDevicesService: IotDevicesService,
    private readonly connectionHistoryService: DeviceConnectionHistoryService,
    private readonly cameraSettingsService: CameraSettingsService,
  ) {}

  // IOT-013: liệt kê thiết bị (filter + phân trang). Read-only, query whitelist-only.
  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async list(@Query() query: ListIotDevicesQueryDto) {
    const { items, meta } = await this.iotDevicesService.findAll(query);

    return {
      success: true,
      message: 'IoT devices retrieved successfully',
      data: items,
      meta,
    };
  }

  // Tổng hợp trạng thái thiết bị (dashboard). Route STATIC — khai trước @Get(':id')
  // để không bị route động nuốt.
  @Get('status-summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.read')
  async statusSummary() {
    const data = await this.iotDevicesService.getStatusSummary();

    return {
      success: true,
      message: 'Device status summary retrieved successfully',
      data,
    };
  }

  // 2.2.1: số lượt xe theo từng camera biển số trong ngày. Route STATIC — trước @Get(':id').
  @Get('anpr-stats')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async anprStats(@Query() query: AnprStatsQueryDto) {
    const data = await this.cameraSettingsService.getAnprStats(query.date);

    return {
      success: true,
      message: 'ANPR camera stats retrieved successfully',
      data,
    };
  }

  // 2.2.7: dung lượng lưu trữ ghi hình (tổng ổ + theo camera). Route STATIC.
  @Get('recording-storage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.read')
  async recordingStorage() {
    const data = await this.cameraSettingsService.getStorageUsage();

    return {
      success: true,
      message: 'Recording storage usage retrieved successfully',
      data,
    };
  }

  // 2.2.4: lưu vị trí/hướng camera trên sơ đồ 1 tầng (metadata_json.layout).
  @Put('layout')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.update')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async saveLayout(
    @CurrentUser() user: { userId: string },
    @Body() dto: SaveCameraLayoutDto,
  ) {
    const data = await this.cameraSettingsService.saveLayout(
      user?.userId ?? null,
      dto,
    );

    return {
      success: true,
      message: 'Camera layout saved successfully',
      data,
    };
  }

  // 2.2.7: lịch ghi hình & thời gian lưu trữ của 1 camera (metadata_json.recording).
  @Patch(':id/recording-policy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.update')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async configureRecording(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfigureRecordingDto,
  ) {
    const device = await this.cameraSettingsService.configureRecording(
      user?.userId ?? null,
      id,
      dto,
    );

    return {
      success: true,
      message: 'Recording policy updated successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // Lịch sử kết nối (online/offline), uptime và sự cố của 1 thiết bị. Read-only.
  @Get(':id/connection-history')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async connectionHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ConnectionHistoryQueryDto,
  ) {
    const data = await this.connectionHistoryService.getHistory(id, query.days);

    return {
      success: true,
      message: 'Device connection history retrieved successfully',
      data,
    };
  }

  // IOT-013: chi tiết thiết bị. Read-only.
  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.read')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.iotDevicesService.findOne(id);

    return {
      success: true,
      message: 'IoT device retrieved successfully',
      data,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot_devices:create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async create(@Req() req: any, @Body() dto: CreateIotDeviceDto) {
    // Fallback manual mapping if ValidationPipe did not transform snake_case
    // class-transformer should handle it with @Expose if ValidationPipe has transform:true
    // We assume the DTO is mapped correctly here.

    // Extract userId from req.user (JwtAuthGuard maps it to userId, but fallback to id just in case)
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.create(userId, dto);

    return {
      success: true,
      data: toIotDeviceResponse(device),
    };
  }

  // IOT-014: chạy tay một lượt active probe online/offline (không body, không gate ENV).
  // Route static 'probe-status' — khai báo trước các route động @Post(':id/...').
  @Post('probe-status')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.probe')
  async probeStatus(@Req() req: any) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const data = await this.iotDevicesService.detectOfflineDevices(userId);

    return {
      success: true,
      message: 'Device status probe completed',
      data,
    };
  }

  @Post(':id/assign-room')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot_devices:assign_room')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async assignRoom(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoomDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.assignRoom(userId, id, dto);

    return {
      success: true,
      message: 'Room assigned successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // IOT-011: cập nhật thông tin mô tả/kết nối (allowlist 4 field). Pipe route-level
  // bật forbidNonWhitelisted=true để field ngoài allowlist => 400.
  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async update(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIotDeviceDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.update(userId, id, dto);

    return {
      success: true,
      message: 'IoT device updated successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // IOT-005: cấu hình RTSP cho IP/room camera. Password mã hóa AES-256-GCM (IOT-015);
  // response mask rtsp_password_encrypted. Route 2-segment ':id/rtsp-config' không
  // đụng ':id'. Pipe forbidNonWhitelisted=false để bỏ qua field thừa (giống assign-room).
  @Patch(':id/rtsp-config')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot_devices:configure_rtsp')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async configureRtsp(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfigureRtspDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.configureRtsp(userId, id, dto);

    return {
      success: true,
      message: 'RTSP configuration updated successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // IAC-001 (UC-96): bật/tắt chức năng AI của camera. Ghi metadata_json.ai_config (chỉ ghi DB,
  // KHÔNG đẩy xuống thiết bị). Route 2-segment ':id/ai-config' không đụng ':id'. Pipe
  // forbidNonWhitelisted=false (mirror rtsp-config). Permission dấu chấm iot.device.configure_ai.
  @Patch(':id/ai-config')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.configure_ai')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async configureAiConfig(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfigureAiConfigDto,
  ) {
    const device = await this.iotDevicesService.configureAiConfig(
      user.userId,
      id,
      dto,
    );

    return {
      success: true,
      message: 'AI configuration updated successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // TKR-001 (#11): cấu hình face-server (tạo mới HOẶC ghi đè config hiện có — service
  // configureFaceServer() KHÔNG check "đã config" nên gọi lại là upsert, không throw).
  // POST action 200. Trả one_time_callback_token (plaintext 1 lần, giống rotate).
  @Post(':id/face-server/configure')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot_devices:configure_face_server')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async configureFaceServer(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfigureFaceServerDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const result = await this.iotDevicesService.configureFaceServer(
      userId,
      id,
      dto,
    );

    return {
      success: true,
      message: 'Face server configured successfully',
      data: {
        device: toIotDeviceResponse(result.device),
        one_time_callback_token: result.oneTimeCallbackToken,
      },
    };
  }

  // TKR-001 (#11): thu hồi callback token face-server. POST action 200, body reason optional.
  @Post(':id/face-server/revoke')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot_devices:configure_face_server')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async revokeFaceServerToken(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeFaceServerTokenDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.revokeFaceServerToken(
      userId,
      id,
      dto,
    );

    return {
      success: true,
      message: 'Face server callback token revoked successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // TKR-001 (#11): xoay callback token face-server. POST action 200, không body.
  // Trả one_time_callback_token (plaintext 1 lần).
  @Post(':id/face-server/rotate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot_devices:configure_face_server')
  async rotateFaceServerToken(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const result = await this.iotDevicesService.rotateFaceServerToken(
      userId,
      id,
    );

    return {
      success: true,
      message: 'Face server callback token rotated successfully',
      data: {
        device: toIotDeviceResponse(result.device),
        one_time_callback_token: result.oneTimeCallbackToken,
      },
    };
  }

  // IOT-012: vô hiệu hóa thiết bị (status -> disabled). POST action, không body.
  // @HttpCode(200) vì POST mặc định trả 201.
  @Post(':id/disable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.disable')
  async disable(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.disable(userId, id);

    return {
      success: true,
      message: 'IoT device disabled successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // IOT-012: kích hoạt lại thiết bị (disabled -> offline). POST action, không body.
  @Post(':id/enable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.enable')
  async enable(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.enable(userId, id);

    return {
      success: true,
      message: 'IoT device enabled successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // A5 (IOT-005): chẩn đoán khả dụng camera (runtime RTSP probe / heartbeat).
  @Post(':id/check-availability')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('iot.device.check_availability')
  async checkAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: { userId: string },
  ) {
    const device = await this.iotDevicesService.checkAvailability(
      actor.userId,
      id,
    );

    const data = toIotDeviceResponse(device);
    // SEC (spec §8.4 / AC-14): checked_by chỉ lưu DB — KHÔNG trả ra response.
    const availability = data.metadata_json?.['last_availability_check'] as
      | Record<string, unknown>
      | undefined;
    if (availability) {
      delete availability.checked_by;
    }

    return {
      success: true,
      message: 'Camera availability checked successfully',
      data: { ...data, availability },
    };
  }
}
