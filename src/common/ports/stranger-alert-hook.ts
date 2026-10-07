/**
 * STRANGER_ALERT_HOOK (SAL-001 / Face-access #20) — port nối `iot` → `face-access`.
 *
 * Đặt ở `common` (leaf, không import module nào) để `iot` inject hook mà KHÔNG
 * import `face-access` → tránh circular dependency (mẫu y hệt FACE_VERIFY_HOOK).
 * `face-access` là `@Global()` và provide token này bằng `useExisting: StrangerAlertService`.
 */
export interface StrangerAlertInput {
  /** iot_devices.id của Face Terminal gửi stranger. */
  deviceId: string;
  /** device_code (để log/hiển thị). */
  deviceCode: string;
  /** Phòng gắn thiết bị (iot_devices.room_id), có thể null. */
  roomId: string | null;
  /** stranger_id thiết bị báo (nếu có). */
  strangerId: string | null;
  /** Độ tương đồng (chuỗi thô từ payload, nếu có). */
  similarity: string | null;
  /** Thời điểm phát hiện (server-received). */
  capturedAt: Date;
  /** iot_device_events.id vừa lưu — gắn vào từng lượt của cảnh báo (ảnh + đánh dấu theo dõi). */
  eventId?: string | null;
}

export interface StrangerAlertHook {
  onStranger(evt: StrangerAlertInput): Promise<void>;
}

/** Injection token cho hook stranger → cảnh báo. */
export const STRANGER_ALERT_HOOK = Symbol('STRANGER_ALERT_HOOK');
