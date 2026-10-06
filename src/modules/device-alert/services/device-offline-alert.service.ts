import { Injectable, Logger } from '@nestjs/common';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import type {
  DeviceOfflineAlertHook,
  DeviceOfflineAlertInput,
} from '../../../common/ports/device-offline-alert-hook.js';

/**
 * DeviceOfflineAlertService — camera IP chuyển online → offline (IOT-014 active probe)
 * → `security_alerts` (alertType `device_error`).
 *
 * Dedup dùng NGUYÊN `AlertsService.recordAlert()` (unique mở theo alertType+zoneId):
 * nhiều camera cùng khu vực rớt → 1 alert, các camera sau chỉ bump occurrence. Thông báo
 * (WS + in_app/email theo rule, người có quyền security_alert.read) do
 * `SecurityAlertNotifierService` gửi khi `recordAlert()` tạo alert MỚI — service này
 * KHÔNG tự gửi.
 *
 * NotThrow toàn bộ: lỗi cảnh báo KHÔNG được phá luồng probe trạng thái thiết bị.
 */
@Injectable()
export class DeviceOfflineAlertService implements DeviceOfflineAlertHook {
  private readonly logger = new Logger(DeviceOfflineAlertService.name);
  private static readonly ALERT_TYPE = 'device_error';

  constructor(
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
  ) {}

  async onDeviceOffline(evt: DeviceOfflineAlertInput): Promise<void> {
    try {
      const alertType = DeviceOfflineAlertService.ALERT_TYPE;

      // --- Step 1: Check alert_rules (rule tắt → suppressed) ---
      let ruleId: string | null = null;
      try {
        const { suppressed, rule } =
          await this.alertRulesService.findEffectiveRule(alertType, evt.zoneId);
        if (suppressed) {
          this.logger.debug(
            `Alert suppressed by rule (type=${alertType} device=${evt.deviceCode})`,
          );
          return;
        }
        ruleId = rule?.id ?? null;
      } catch (e) {
        this.logger.warn(
          `Alert rules check failed (type=${alertType}): ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }

      // --- Step 2: recordAlert (alert mới → notifier tự gửi thông báo) ---
      await this.alertsService.recordAlert({
        alertType,
        zoneId: evt.zoneId,
        ruleId,
        triggeredAt: evt.detectedAt,
        payloadJson: {
          reason: 'offline',
          deviceId: evt.deviceId,
          deviceCode: evt.deviceCode,
          deviceName: evt.deviceName,
        },
      });
    } catch (e) {
      this.logger.error(
        `Device offline alert failed (device=${evt.deviceCode}): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }
}
