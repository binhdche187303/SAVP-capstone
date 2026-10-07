import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';
import { AuthModule } from '../auth/auth.module.js';
import { IoTDeviceEntity } from './entities/iot-device.entity.js';
import { IoTDeviceEventEntity } from './entities/iot-device-event.entity.js';
import { DeviceUserMappingEntity } from './entities/device-user-mapping.entity.js';
import { CaptureSessionEntity } from './entities/capture-session.entity.js';
import { CaptureSessionChannelEntity } from './entities/capture-session-channel.entity.js';
import { IotDevicesController } from './controllers/iot-devices.controller.js';
import { DeviceCallbacksController } from './controllers/device-callbacks.controller.js';
import { ShortDeviceCallbacksController } from './controllers/short-device-callbacks.controller.js';
import { VerifyShortDeviceCallbacksController } from './controllers/verify-short-device-callbacks.controller.js';
import { StrangerShortDeviceCallbacksController } from './controllers/stranger-short-device-callbacks.controller.js';
import { IotDevicesService } from './services/iot-devices.service.js';
import { IotDeviceEventsService } from './services/iot-device-events.service.js';
import { DeviceConnectionHistoryService } from './services/device-connection-history.service.js';
import { CameraSettingsService } from './services/camera-settings.service.js';
import { IotAuditRepository } from './repositories/iot-audit.repository.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IoTDeviceEntity,
      IoTDeviceEventEntity,
      DeviceUserMappingEntity,
      CaptureSessionEntity,
      CaptureSessionChannelEntity,
    ]),
    AuthModule,
    JwtModule.register({}),
    CacheModule.register(),
  ],
  controllers: [
    IotDevicesController,
    DeviceCallbacksController,
    ShortDeviceCallbacksController,
    VerifyShortDeviceCallbacksController,
    StrangerShortDeviceCallbacksController,
  ],
  providers: [
    IotDevicesService,
    IotDeviceEventsService,
    IotAuditRepository,
    DeviceConnectionHistoryService,
    CameraSettingsService,
  ],
  exports: [TypeOrmModule, IotDevicesService, IotDeviceEventsService],
})
export class IotModule {}
