import { Global, Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module.js';
import { DEVICE_OFFLINE_ALERT_HOOK } from '../../common/ports/device-offline-alert-hook.js';
import { DeviceOfflineAlertService } from './services/device-offline-alert.service.js';

/**
 * DeviceAlertModule — cảnh báo camera mất kết nối (online → offline).
 *
 * @Global() + provide DEVICE_OFFLINE_ALERT_HOOK (mẫu FaceAccessModule/STRANGER_ALERT_HOOK):
 * `IotModule` inject hook qua token mà KHÔNG import module này — import thẳng
 * `AlertsModule` từ `IotModule` sẽ tạo vòng `Iot → Alerts → Notifications → Websocket →
 * GuestAccess → Recording → Iot`.
 */
@Global()
@Module({
  imports: [AlertsModule],
  providers: [
    DeviceOfflineAlertService,
    {
      provide: DEVICE_OFFLINE_ALERT_HOOK,
      useExisting: DeviceOfflineAlertService,
    },
  ],
  exports: [DEVICE_OFFLINE_ALERT_HOOK],
})
export class DeviceAlertModule {}
