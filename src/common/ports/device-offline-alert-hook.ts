/**
 * DEVICE_OFFLINE_ALERT_HOOK — port nối `iot` → `device-alert` (camera online → offline).
 *
 * Đặt ở `common` (leaf, không import module nào) để `iot` inject hook mà KHÔNG import
 * `alerts`/`notifications` → tránh circular dependency
 * (`IotModule → AlertsModule → NotificationsModule → WebsocketModule → GuestAccessModule
 * → RecordingModule → IotModule`). Mẫu y hệt STRANGER_ALERT_HOOK: `DeviceAlertModule` là
 * `@Global()` và provide token này bằng `useExisting: DeviceOfflineAlertService`.
 */
export interface DeviceOfflineAlertInput {
  /** iot_devices.id của camera vừa mất kết nối. */
  deviceId: string;
  /** device_code (để log/hiển thị). */
  deviceCode: string;
  /** device_name (để hiển thị trong thông báo). */
  deviceName: string;
  /** Khu vực gắn thiết bị (iot_devices.zone_id), có thể null. */
  zoneId: string | null;
  /** Thời điểm phát hiện offline (server time). */
  detectedAt: Date;
}

export interface DeviceOfflineAlertHook {
  /**
   * Các camera vừa online → offline trong CÙNG 1 lượt quét — gộp theo khu vực, mỗi khu vực
   * 1 cảnh báo/1 thông báo (không phải mỗi camera 1 thông báo).
   */
  onDevicesOffline(evts: DeviceOfflineAlertInput[]): Promise<void>;
  /** Các camera offline → online (có tín hiệu lại) trong cùng 1 lượt quét — gộp theo cảnh báo. */
  onDevicesOnline?(evts: DeviceOfflineAlertInput[]): Promise<void>;
}

/** Injection token cho hook camera offline → cảnh báo. */
export const DEVICE_OFFLINE_ALERT_HOOK = Symbol('DEVICE_OFFLINE_ALERT_HOOK');
